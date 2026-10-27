import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { CalendarDays, ChevronDown, Filter, KanbanSquare, List, MessageCircle, Phone, Plus, UserCheck, XCircle } from 'lucide-react'
import { rpc, select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { GROUP_PREFS, LEVELS, SOURCES, loadApprovedTeachers, loadLanguages, noteField, waLink } from '../../lib/domain'
import { digits, fmtDate, fmtDateTime, label } from '../../lib/format'
import { one } from '../../lib/tutor'
import { DemoScheduler } from '../../components/DemoScheduler'
import { Badge, Button, Card, Drawer, Empty, ErrorBox, ExportMenu, Field, Input, KV, Modal, PageHeader, SearchBox, Section, Select, Spinner, StatusBadge, Textarea, cx, toneClass, useConfirm } from '../../components/ui'
import { useToast } from '../../lib/toast'
import { DateRangeFilter, useDateRange } from '../../components/DateRange'

const schema = z.object({
  enquirer_name: z.string().trim().min(2, 'Enter the lead name'),
  age_group: z.string().trim().regex(/^[0-9]{1,3}$/, 'Enter the age in years'),
  phone: z.string().refine((v) => /^[0-9]{7,15}$/.test(digits(v)), 'Enter 7–15 digits'),
  email: z.string().trim().refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email or leave blank'),
  language_id: z.string().min(1, 'Choose a language'),
})

// "Demo Accepted" is derived: a Demo Scheduled lead whose demo the tutor has accepted (see the loader in Leads()).
const STAGES = [
  { v: 'new', l: 'New Lead' }, { v: 'contacted', l: 'Contacted' }, { v: 'demo_scheduled', l: 'Demo Scheduled' }, { v: 'demo_accepted', l: 'Demo Accepted' },
  { v: 'demo_done', l: 'Demo Completed' }, { v: 'converted', l: 'Converted' }, { v: 'lost', l: 'Lost Lead' },
] as const
// The ten-step project flow shown in the lead panel. `tutor` marks the steps the tutor performs.
const FLOW = [
  { t: 'Enquiry comes in', d: 'Coordinator adds the lead' },
  { t: 'Demo booked', d: 'Coordinator picks free tutor' },
  { t: 'Tutor accepts demo', d: 'Done, no-show or re-demo', tutor: true },
  { t: 'Enrollment created', d: 'Course, classes, term dates' },
  { t: 'Fees set', d: 'Finance adds installments' },
  { t: 'Class credits given', d: 'Coordinator allocates classes' },
  { t: 'Tutor accepts student', d: 'Schedules classes, shares link', tutor: true },
  { t: 'Class and attendance', d: 'Absent becomes makeup', tutor: true },
  { t: 'Monthly tutor payout', d: 'Finance finalizes, locks' },
  { t: 'Course closed', d: 'Completed or withdrawn' },
] as { t: string; d: string; tutor?: boolean }[]
const formatLabel =(v: string) => GROUP_PREFS.find((g) => g.v === v)?.l ?? '—'
const stageLabel = (v: string) => STAGES.find((s) => s.v === v)?.l ?? v

const blank = { enquirer_name: '', learner_name: '', phone: '', email: '', language_id: '', level: 'Beginner', age_group: '', preferred_timing: '', group_preference: 'either', source: 'Call', notes: '', tz: 'Asia/Kolkata' }

function StageMenu({ lead, onPick }: { lead: Row; onPick: (stage: string) => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const close = () => setPos(null)
  return (
    <>
      <button aria-label={`Move ${lead.learner_name} to stage`} aria-haspopup="menu" aria-expanded={!!pos}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos(pos ? null : { left: Math.max(8, r.right - 176), top: r.bottom + 6 }) }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft min-h-8">
        {stageLabel(lead.stage)} <ChevronDown size={12} />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div role="menu" style={{ left: pos.left, top: pos.top }} className="fixed z-50 w-44 rounded-xl border border-line bg-white p-1.5 shadow-lg">
            <p className="px-2.5 py-1.5 text-xs text-ink-soft">Move stage</p>
            {STAGES.map((s) => (
              <button key={s.v} role="menuitem" onClick={() => { close(); if (s.v !== lead.stage) onPick(s.v) }}
                className={cx('w-full text-left rounded-lg px-2.5 min-h-8 text-xs font-medium', s.v === lead.stage ? 'bg-sand text-ink' : 'text-ink-soft hover:bg-sand/70')}>{s.l}</button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function LeadForm({ open, lead, languages, leads, onClose, onSaved, inline }: { open: boolean; lead?: Row | null; languages: Row[]; leads: Row[]; onClose: () => void; onSaved: () => void; inline?: boolean }) {
  const init = useMemo(() => lead ? {
    ...blank, enquirer_name: lead.enquirer_name, learner_name: lead.learner_name, phone: lead.phone ?? '', email: lead.email ?? '', language_id: lead.language_id ?? '',
    level: lead.level ?? 'Beginner', age_group: /^[0-9]{1,3}$/.test(lead.age_group ?? '') ? lead.age_group : '', preferred_timing: lead.preferred_timing ?? '', group_preference: lead.group_preference, source: lead.source,
    notes: (lead.notes ?? '').split('\n').filter((l: string) => !/^Timezone:/i.test(l)).join('\n'), tz: noteField(lead.notes, 'Timezone') || 'Asia/Kolkata',
  } : blank, [lead])
  const [f, setF] = useState(init)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [dupe, setDupe] = useState<Row | null>(null)
  const { busy, run } = useAction()
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  const save = () => run(async () => {
    const p = schema.safeParse(f)
    if (!p.success) { const m: Record<string, string> = {}; for (const i of p.error.issues) m[String(i.path[0])] = i.message; setErrs(m); return }
    setErrs({})
    const phone = digits(f.phone)
    // same learner + same phone = probably the same enquiry. Different learner with the same phone (siblings) is fine.
    const twin = leads.find((l) => l.id !== lead?.id && l.phone === phone && l.learner_name.trim().toLowerCase() === f.enquirer_name.trim().toLowerCase() && !['lost'].includes(l.stage))
    if (twin && !dupe) { setDupe(twin); return }
    const notes = [f.notes.trim(), f.tz !== 'Asia/Kolkata' ? `Timezone: ${f.tz}` : ''].filter(Boolean).join('\n') || null
    const row = { enquirer_name: f.enquirer_name.trim(), learner_name: f.enquirer_name.trim(), phone, email: f.email.trim() || null, language_id: f.language_id, level: f.level, age_group: f.age_group.trim(), preferred_timing: f.preferred_timing.trim() || null, group_preference: f.group_preference, source: f.source, notes }
    if (lead) await unwrap(supabase.from('leads').update(row).eq('id', lead.id))
    else await unwrap(supabase.from('leads').insert(row))
    onSaved()
  }, lead ? 'Enquiry updated' : 'Lead added to the pipeline')

  const saveBtn = <Button variant="primary" onClick={() => void save()} loading={busy}>{dupe ? 'Add anyway' : lead ? 'Save changes' : 'Create Lead'}</Button>
  const body = (
    <>
      {dupe &&<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">An open enquiry for <b>{dupe.learner_name}</b> with this phone already exists (stage: {stageLabel(dupe.stage)}). Tap <b>Add anyway</b> if this is a separate enquiry.</div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Lead Name" required error={errs.enquirer_name}><Input value={f.enquirer_name} onChange={set('enquirer_name')} /></Field>
        <Field label="WhatsApp / phone" required error={errs.phone}><Input inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="919876543210" /></Field>
        <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} placeholder="name@domain.com" /></Field>
        <Field label="Language interested" required error={errs.language_id}><Select value={f.language_id} onChange={set('language_id')}><option value="">Choose…</option>{languages.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Level"><Select value={f.level} onChange={set('level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
        <Field label="Age" required error={errs.age_group}><Input inputMode="numeric" maxLength={3} value={f.age_group} onChange={set('age_group')} placeholder="e.g. 25" /></Field>
        <Field label="Class format"><Select value={f.group_preference} onChange={set('group_preference')}>{GROUP_PREFS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}</Select></Field>
        <Field label="Lead source"><Select value={f.source} onChange={set('source')}>{[...new Set([f.source, ...SOURCES])].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Follow-up notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} placeholder="What was discussed, what to do next" /></Field>
      </div>
    </>
  )
  if (inline) return <>{body}<div className="mt-4">{saveBtn}</div></>
  return (
    <Modal open={open} onClose={onClose} wide title={lead ? 'Edit enquiry' : 'Log incoming prospect enquiry'}
      footer={<><Button onClick={onClose}>Cancel</Button>{saveBtn}</>}>
      {body}
    </Modal>
  )
}

function LeadDrawer({ id, leads, demos, teachers, languages, canWrite, onClose, reload }: { id: string | null; leads: Row[]; demos: Row[]; teachers: Row[]; languages: Row[]; canWrite: boolean; onClose: () => void; reload: () => void }) {
  const lead = leads.find((l) => l.id === id)
  const nav = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const { can } = useAuth()
  const [mode, setMode] = useState<'view' | 'schedule' | { replace: string }>('view')
  const demoBox = useRef<HTMLDivElement>(null)
  // The form opens inside the Demo class box further down the panel, so bring it into view.
  const openSchedule = (m: 'schedule' | { replace: string } = 'schedule') => { setMode(m); setTimeout(() => demoBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState('')
  const { busy, run } = useAction()
  const audit = useAsync(() => (id && can('super_admin') ? select('audit_events', '*', (q) => q.eq('entity_type', 'leads').eq('entity_id', id).order('created_at', { ascending: false }).limit(30)) : Promise.resolve([])), [id])
  // While a demo waits for the tutor, re-check every 20 seconds so the step ticks itself once they accept.
  const waitingTutor = demos.some((d) => d.lead_id === id && d.status === 'awaiting_tutor')
  useEffect(() => { if (!waitingTutor) return; const t = setInterval(reload, 20000); return () => clearInterval(t) }, [waitingTutor, reload])
  const enrId = lead?.converted_enrollment_id as string | undefined
  // Facts for steps 5-10 of the flow; each read is optional because coordinators cannot read fees or payouts.
  const flow = useAsync(async () => {
    if (!enrId) return null
    const [enr, plans, credits, parts, earns] = await Promise.all([
      select('enrollments', 'id, status, assignment_status, primary_teacher_id', (q) => q.eq('id', enrId)).catch(() => []),
      select('fee_plan_summary', '*', (q) => q.eq('enrollment_id', enrId)).catch(() => []),
      select('credit_movements', 'quantity', (q) => q.eq('enrollment_id', enrId)).catch(() => []),
      select('session_participants', 'enrollment_id, sessions!inner(status)', (q) => q.eq('enrollment_id', enrId)).catch(() => []),
      select('earning_items', 'id, payout_id', (q) => q.eq('enrollment_id', enrId)).catch(() => []),
    ])
    const sess = parts.map((p) => one<Row>(p.sessions)?.status as string)
    return { enr: enr[0], fees: plans.length > 0, credits: credits.reduce((n, c) => n + Number(c.quantity), 0), booked: sess.filter((s) => s !== 'cancelled').length, delivered: sess.filter((s) => s === 'completed').length, paid: earns.some((x) => x.payout_id) }
  }, [enrId])
  if (!lead) return null
  const myDemos = demos.filter((d) => d.lead_id === lead.id).sort((a, b) => a.attempt - b.attempt)
  const active = myDemos.find((d) => ['awaiting_tutor', 'accepted'].includes(d.status))
  const tName = (tid: string) => teachers.find((t) => t.id === tid)?.name ?? 'Tutor'
  const closed = ['converted', 'lost'].includes(lead.stage)
  const editable = canWrite && !closed
  const wa = waLink(lead.phone)

  // The 10-step flow. `done[i]` is whether step i+1 is finished; the first unfinished step is the current one.
  const f = flow.data
  const converted = lead.stage === 'converted'
  const live = myDemos.filter((d) => d.status !== 'cancelled')
  const done = [
    true,
    converted || live.length > 0,
    converted || myDemos.some((d) => ['accepted', 'completed'].includes(d.status)),
    converted,
    !!f?.fees,
    (f?.credits ?? 0) > 0,
    f?.enr?.assignment_status === 'accepted' && (f?.booked ?? 0) > 0,
    (f?.delivered ?? 0) > 0,
    !!f?.paid,
    ['completed', 'withdrawn'].includes(f?.enr?.status),
  ]
  const firstOpen = done.indexOf(false)
  const current = lead.stage === 'lost' ? -1 : firstOpen === -1 ? 10 : firstOpen
  const accepted = myDemos.find((d) => d.status === 'accepted')
  const waiting = myDemos.find((d) => d.status === 'awaiting_tutor')
  const nextBtn = (text: string, onClick: () => void, loadingNow = false) => <Button variant="primary" loading={loadingNow} onClick={onClick}>{text}</Button>
  const nextAction = (): { hint: string; btn?: ReactNode } => {
    switch (current) {
      case 1: return { hint: 'Pick a free tutor and book the demo.', btn: nextBtn(myDemos.length ? 'Schedule another demo' : 'Schedule demo', () => openSchedule()) }
      case 2:
        if (waiting) return { hint: `Waiting for ${tName(waiting.teacher_id)} to accept the demo.` }
        return { hint: 'The last demo did not go ahead. Book another one.', btn: nextBtn('Schedule another demo', () => openSchedule()) }
      case 3: return accepted
        ? { hint: 'The tutor accepted the demo. After it is held, mark it completed, then enrol the learner.', btn: <div className="flex flex-wrap gap-2">{nextBtn('Mark demo completed', () => void outcomeFor(accepted, 'completed'), busy)}{nextBtn('Enrol: convert to student', () => void convert(), busy)}</div> }
        : { hint: 'The learner is ready to start. Create the student and enrollment.', btn: nextBtn('Enrol: convert to student', () => void convert(), busy) }
      case 4: return { hint: 'Finance adds the fee installments for this enrollment.', btn: can('finance') ? nextBtn('Set fees', () => nav('/admin/fees')) : undefined }
      case 5: return { hint: 'Allocate the classes the learner has paid for.', btn: nextBtn('Allocate classes', () => nav(`/admin/students?open=${enrId}`)) }
      case 6: return { hint: f?.enr?.assignment_status === 'accepted' ? 'The tutor accepted. Waiting for classes to be scheduled and the link shared.' : f?.enr?.primary_teacher_id ? 'Waiting for the tutor to accept the student.' : 'Assign a tutor. They accept the student, then schedule classes.', btn: f?.enr?.assignment_status === 'accepted' ? undefined : nextBtn('Assign tutor', () => nav(`/admin/students?open=${enrId}`)) }
      case 7: return { hint: 'Classes are booked. Attendance is marked after each class; absences become makeups.', btn: nextBtn('Open attendance', () => nav('/admin/attendance')) }
      case 8: return { hint: 'Finance finalizes the tutor payout for the month, which locks it.', btn: can('finance') ? nextBtn('Open payouts', () => nav('/admin/payouts')) : undefined }
      case 9: return { hint: 'Close the enrollment when the course is completed or the learner withdraws.', btn: nextBtn('Open enrollment', () => nav(`/admin/students?open=${enrId}`)) }
      default: return { hint: 'All ten steps are finished.' }
    }
  }
  const next = current >= 0 ? nextAction() : null

  const addNote = () => run(async () => {
    const stamp = `${new Date().toISOString().slice(0, 10)}: ${note.trim()}`
    await unwrap(supabase.from('leads').update({ notes: [lead.notes, stamp].filter(Boolean).join('\n') }).eq('id', lead.id))
    setNote(''); reload()
  }, 'Note added')

  const convert = () => run(async () => {
    const attempt = async (allow: boolean) => rpc<{ student_id: string; enrollment_id: string }>('convert_lead', { p_lead: lead.id, p_allow_duplicate: allow })
    let r
    try { r = await attempt(false) } catch (e) {
      if (!/already exists/.test((e as Error).message)) throw e
      const c = await confirm({ title: 'Possible duplicate student', body: <p>{(e as Error).message}</p>, confirmText: 'Convert anyway' })
      if (!c.ok) return
      r = await attempt(true)
    }
    const tz = noteField(lead.notes, 'Timezone')
    if (tz) await supabase.from('students').update({ timezone: tz }).eq('id', r.student_id)
    reload(); toast.ok('Converted. Continue with the enrollment.')
    nav(`/admin/students?open=${r.enrollment_id}`)
  })

  const lose = async () => {
    const c = await confirm({ title: 'Mark as lost', body: <p>The enquiry moves to Lost and any pending demo is cancelled. You can restore it later.</p>, reason: 'Why was this lead lost?', danger: true, confirmText: 'Mark lost' })
    if (c.ok) await run(async () => { await rpc('close_leads', { p_ids: [lead.id], p_reason: c.reason }); reload() }, 'Marked as lost')
  }
  const outcomeFor = (d: Row, st: string) => run(async () => { await rpc('record_demo_outcome', { p_demo: d.id, p_status: st, p_outcome: outcome || null }); setOutcome(''); reload() }, 'Demo outcome recorded')

  return (
    <Drawer open onClose={onClose} badge={<StatusBadge status={lead.stage} text={stageLabel(lead.stage)} />} title={lead.learner_name}
      subtitle={`Enquiry from ${lead.enquirer_name} via ${lead.source} on ${fmtDate(lead.created_at)}`}>
      <Section title="Next step">
        <ol className="grid grid-cols-2 gap-2 mb-3">
          {FLOW.map((s, i) => {
            const isDone = done[i], isNow = i === current
            const tone = isDone ? 'border-emerald-300 bg-emerald-50' : isNow ? 'border-brand-300 bg-brand-50 ring-2 ring-brand-200' : 'border-line bg-white opacity-60'
            return (
              <li key={s.t} className={cx('rounded-xl border p-2.5 text-sm', tone)}>
                <p className="font-bold leading-tight">{isDone ? '✓ ' : ''}{i + 1}. {s.t}</p>
                <p className="text-xs text-ink-soft mt-0.5">{s.d}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider mt-1 text-ink-soft">{s.tutor ? 'Tutor' : 'Staff'}</p>
              </li>
            )
          })}
        </ol>
        {lead.stage === 'lost' ? <p className="text-sm text-ink-soft">This enquiry is marked lost. Restore it at the bottom of this panel to continue the flow.</p> : next && (
          <div className="rounded-xl border border-brand-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Step {current + 1} of 10 · {FLOW[current]?.t}</p>
            <p className="text-sm mt-1">{next.hint}</p>
            {canWrite && next.btn && <div className="mt-3">{next.btn}</div>}
          </div>
        )}
      </Section>

      <Section title="Requirements">
        {editable ? <LeadForm key={`${lead.id}-${lead.updated_at}`} inline open lead={lead} languages={languages} leads={leads} onClose={onClose} onSaved={reload} /> : (
        <dl className="grid grid-cols-2 gap-4">
          <KV k="WhatsApp" v={<span className="inline-flex items-center gap-2">{lead.phone || '—'}{wa && <a href={wa} target="_blank" rel="noreferrer" aria-label="Open WhatsApp" className="text-emerald-600"><MessageCircle size={16} /></a>}</span>} />
          <KV k="Email" v={lead.email} />
          <KV k="Language" v={`${lead.languages?.name ?? '—'}${lead.level ? ` (${lead.level})` : ''}`} />
          <KV k="Age group" v={lead.age_group} />
          <KV k="Preferred timing" v={lead.preferred_timing} />
          <KV k="Format" v={GROUP_PREFS.find((g) => g.v === lead.group_preference)?.l} />
          <KV k="Learner time zone" v={noteField(lead.notes, 'Timezone') || 'Asia/Kolkata'} />
        </dl>
        )}
      </Section>

      <div ref={demoBox} className="scroll-mt-4"><Section title="Demo class">
        {myDemos.length === 0 && mode === 'view' && <p className="text-sm text-ink-soft mb-3">No demo arranged yet.</p>}
        <ol className="space-y-3 mb-3">
          {myDemos.map((d) => (
            <li key={d.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><b>Attempt {d.attempt} · {tName(d.teacher_id)}</b><StatusBadge status={d.status} text={label[d.status]} /></div>
              <p className="text-ink-soft mt-0.5">{fmtDateTime(d.start_at)}</p>
              {d.decline_reason && <p className="mt-1">Declined: “{d.decline_reason}”</p>}
              {d.outcome && <p className="mt-1">Outcome: {d.outcome}</p>}
              {d.meeting_link && <a className="text-brand-700 underline break-all" href={d.meeting_link} target="_blank" rel="noreferrer">{d.meeting_link}</a>}
              {canWrite && ['awaiting_tutor', 'accepted', 'declined'].includes(d.status) && !closed && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => openSchedule({ replace: d.id })}><CalendarDays size={14} /> Reschedule / change tutor</Button>
                  {d.status !== 'declined' && <Button size="sm" variant="primary" onClick={() => void run(async () => { await rpc('record_demo_outcome', { p_demo: d.id, p_status: 'cancelled', p_outcome: outcome || null }); reload() }, 'Demo cancelled')}>Cancel demo</Button>}
                </div>
              )}
              {canWrite && d.status === 'accepted' && (
                <div className="mt-3 space-y-2">
                  <Input aria-label="Outcome note" placeholder="Outcome note (optional)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void outcomeFor(d, 'completed')}>Completed</Button>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void outcomeFor(d, 'student_no_show')}>Student no-show</Button>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void outcomeFor(d, 'tutor_no_show')}>Tutor no-show</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
        {canWrite && !closed && mode === 'view' && !active && <Button variant="primary" onClick={() => openSchedule()}><CalendarDays size={16} /> {myDemos.length ? 'Schedule another demo' : 'Schedule demo'}</Button>}
        {mode !== 'view' && (
          <div className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="font-bold mb-3">{typeof mode === 'object' ? 'Reschedule demo' : 'Schedule demo'}</p>
            <DemoScheduler lead={lead} teachers={teachers} replaces={typeof mode === 'object' ? mode.replace : undefined} onDone={() => { setMode('view'); reload() }} />
            <Button variant="ghost" className="mt-2" onClick={() => setMode('view')}>Cancel</Button>
          </div>
        )}
      </Section></div>

      {!editable && <Section title="Follow-up notes">
        <pre className="whitespace-pre-wrap font-sans text-sm mb-3">{lead.notes || 'No notes yet.'}</pre>
        {canWrite && <div className="flex gap-2"><Input aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a follow-up note…" /><Button disabled={!note.trim()} loading={busy} onClick={() => void addNote()}>Add</Button></div>}
      </Section>}

      {can('super_admin') && (
        <Section title="Activity history">
          {audit.loading ? <Spinner /> : !audit.data?.length ? <p className="text-sm text-ink-soft">No recorded activity.</p> : (
            <ul className="space-y-1.5 text-sm">{audit.data.map((a: Row) => <li key={a.id} className="flex justify-between gap-3"><span>{a.action === 'insert' ? 'Created' : a.before_value?.stage !== a.after_value?.stage ? `Stage: ${stageLabel(a.before_value?.stage)} → ${stageLabel(a.after_value?.stage)}` : 'Details updated'}</span><span className="text-ink-soft text-xs shrink-0">{fmtDateTime(a.created_at)}</span></li>)}</ul>
          )}
        </Section>
      )}

      {canWrite && (
        <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Enrollment pipeline actions</p>
          {lead.stage === 'converted' ? (
            <div className="mt-2 flex items-center gap-3"><Badge tone="green">Converted</Badge>{lead.converted_enrollment_id && <Button size="sm" onClick={() => nav(`/admin/students?open=${lead.converted_enrollment_id}`)}>Open student</Button>}</div>
          ) : lead.stage === 'lost' ? (
            <Button className="mt-2" onClick={() => void run(async () => { await rpc('restore_leads', { p_ids: [lead.id] }); reload() }, 'Enquiry restored')}>Restore enquiry</Button>
          ) : (
            <>
              <p className="text-sm text-ink-soft mt-1">Once the learner agrees to start, convert to create the student and enrollment. The enquiry is linked, never duplicated.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" className="bg-emerald-600 hover:bg-emerald-700" loading={busy} onClick={() => void convert()}><UserCheck size={16} /> Enrol: convert to student</Button>
                <Button onClick={() => void lose()}><XCircle size={16} /> Mark lost</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  )
}

export default function Leads() {
  const { can } = useAuth()
  const canWrite = can('coordinator')
  const confirm = useConfirm()
  const [view, setView] = useState<'kanban' | 'roster'>('roster')
  const [q, setQ] = useState('')
  const [lang, setLang] = useState('')
  const [source, setSource] = useState('')
  const [stage, setStage] = useState('')
  const [tutor, setTutor] = useState('')
  const range = useDateRange()
  const [showFilters, setShowFilters] = useState(false)
  const [form, setForm] = useState<{ lead: Row | null } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { run } = useAction()

  const { data, loading, error, reload } = useAsync(async () => {
    const [leads, demos, teachers, languages] = await Promise.all([
      select('leads', '*, languages(name)', (x) => x.order('created_at', { ascending: false })),
      select('demos', '*', (x) => x.order('attempt')),
      loadApprovedTeachers(), loadLanguages(),
    ])
    const accepted = new Set(demos.filter((d) => d.status === 'accepted').map((d) => d.lead_id))
    return { leads: leads.map((l) => (l.stage === 'demo_scheduled' && accepted.has(l.id) ? { ...l, stage: 'demo_accepted' } : l)), demos, teachers, languages }
  })

  const filtered = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.leads.filter((l) => {
      if (s && ![l.learner_name, l.enquirer_name, l.phone, l.email, l.languages?.name].some((v) => String(v ?? '').toLowerCase().includes(s))) return false
      if (lang && l.language_id !== lang) return false
      if (source && l.source !== source) return false
      if (stage && l.stage !== stage) return false
      if (tutor && !data.demos.some((d) => d.lead_id === l.id && d.teacher_id === tutor)) return false
      return range.inRange(l.created_at)
    })
  }, [data, q, lang, source, stage, tutor, range.from, range.to])

  const nextDemo = (id: string) => data?.demos.filter((d) => d.lead_id === id && ['awaiting_tutor', 'accepted'].includes(d.status)).sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at))[0]

  const moveStage = async (l: Row, to: string) => {
    if (to === l.stage) return
    if (to === 'demo_scheduled' || to === 'demo_accepted' || to === 'demo_done' || to === 'converted') { setOpenId(l.id); return }
    if (to === 'lost') {
      const c = await confirm({ title: 'Mark as lost', body: <p>Pending demos for this enquiry will be cancelled.</p>, reason: 'Why was this lead lost?', danger: true, confirmText: 'Mark lost' })
      if (c.ok) await run(async () => { await rpc('close_leads', { p_ids: [l.id], p_reason: c.reason }); await reload() }, 'Marked as lost')
      return
    }
    await run(async () => {
      if (l.stage === 'lost') await rpc('restore_leads', { p_ids: [l.id] })
      if (to !== 'new' || l.stage !== 'lost') await unwrap(supabase.from('leads').update({ stage: to }).eq('id', l.id))
      await reload()
    }, `Moved to ${stageLabel(to)}`)
  }

  // Class format stays editable in every stage, including Converted and Lost.
  const setFormat = (l: Row, v: string) => run(async () => {
    await unwrap(supabase.from('leads').update({ group_preference: v }).eq('id', l.id))
    await reload()
  }, 'Class format updated')

  const Card1 =({ l }: { l: Row }) => {
    const d = nextDemo(l.id)
    return (
      <Card className="p-3.5 cursor-pointer hover:border-brand-200 hover:shadow-md transition" onClick={() => setOpenId(l.id)}>
        <p className="font-bold leading-tight">{l.learner_name}</p>
        {l.enquirer_name !== l.learner_name && <p className="text-meta text-ink-soft">via {l.enquirer_name}</p>}
        <div className="flex flex-wrap gap-1 mt-1.5"><Badge>{l.languages?.name ?? 'No language'}</Badge>{l.level && <Badge tone="orange">{l.level}</Badge>}</div>
        <p className="mt-2 text-xs text-ink-soft flex items-center gap-1.5"><Phone size={12} />{l.phone || '—'}</p>
        {d && <p className="mt-1 text-xs font-semibold flex items-center gap-1.5"><CalendarDays size={12} />Demo: {fmtDate(d.start_at)} <span className="font-normal text-ink-soft">({label[d.status]})</span></p>}
        <div className="mt-2.5 pt-2.5 border-t border-line flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="text-xs font-bold text-brand-700 min-h-8" onClick={() => setOpenId(l.id)}>Details</button>
          {canWrite && l.stage !== 'converted' ? (
            <StageMenu lead={l} onPick={(to) => void moveStage(l, to)} />
          ) : <span className="text-xs text-ink-soft">{stageLabel(l.stage)}</span>}
        </div>
      </Card>
    )
  }

  const exportCols = [
    { header: 'Learner', value: (l: Row) => l.learner_name }, { header: 'Enquirer', value: (l: Row) => l.enquirer_name }, { header: 'Phone', value: (l: Row) => l.phone }, { header: 'Email', value: (l: Row) => l.email },
    { header: 'Language', value: (l: Row) => l.languages?.name }, { header: 'Level', value: (l: Row) => l.level }, { header: 'Class format', value: (l: Row) => formatLabel(l.group_preference) },{ header: 'Source', value: (l: Row) => l.source }, { header: 'Stage', value: (l: Row) => stageLabel(l.stage) }, { header: 'Created', value: (l: Row) => String(l.created_at).slice(0, 10) },
  ]

  return (
    <>
      <PageHeader title="Leads" subtitle="Manage enquiries, trial scheduling and conversions before full enrollment. Works even when Runo is offline."
        actions={<>
          <div className="inline-flex rounded-xl border border-line bg-white p-1">
            {([['kanban', 'Kanban board', KanbanSquare], ['roster', 'Roster view', List]] as const).map(([v, l, I]) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('min-h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5', view === v ? 'bg-navy text-white' : 'text-ink-soft')}><I size={15} /><span className="hidden sm:inline">{l}</span></button>
            ))}
          </div>
          {canWrite && <Button variant="dark" onClick={() => setForm({ lead: null })}><Plus size={16} /> Add lead</Button>}
        </>} />

      <Card className="p-3 sm:p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-center">
          <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search by name, phone, email or language…" />
          <Button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><Filter size={15} /> Filters</Button>
          <Select aria-label="Language" className="w-44" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">All languages</option>{data?.languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <span className="text-xs text-ink-soft font-mono ml-auto">Total prospects: {filtered.length} lead{filtered.length === 1 ? '' : 's'}</span>
        </div>
        {showFilters && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4 pt-4 border-t border-line">
            <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Any stage</option>{STAGES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</Select></Field>
            <Field label="Source"><Select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Any source</option>{[...new Set([...SOURCES, ...(data?.leads.map((l) => l.source) ?? [])])].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Demo tutor"><Select value={tutor} onChange={(e) => setTutor(e.target.value)}><option value="">Any tutor</option>{data?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          </div>
        )}
      </Card>

      <div className="mb-4"><DateRangeFilter range={range} /></div>

      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data ? null : view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto scroll-thin pb-4 snap-x -mx-4 px-4 sm:mx-0 sm:px-0">
          {STAGES.map((s) => {
            const items = filtered.filter((l) => l.stage === s.v)
            return (
              <div key={s.v} className="snap-start shrink-0 w-[272px] rounded-2xl bg-sand/60 border border-line p-3 min-h-64">
                <div className="flex items-center justify-between mb-3"><Badge tone={({ new: 'blue', contacted: 'yellow', demo_scheduled: 'purple', demo_accepted: 'teal', demo_done: 'orange', converted: 'green', lost: 'gray' } as const)[s.v]}>{s.l}</Badge><span className="text-xs font-bold text-ink-soft">{items.length}</span></div>
                <div className="space-y-3">{items.map((l) => <Card1 key={l.id} l={l} />)}{!items.length && <p className="text-xs text-ink-soft text-center py-6">No leads</p>}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-3"><ExportMenu rows={filtered} cols={exportCols} name="leads" /></div>
          {!filtered.length ? <Empty title="No leads match" hint="Try clearing a filter." /> : (
            <div className="overflow-x-auto scroll-thin border border-line bg-white">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-meta uppercase tracking-wider text-ink-soft bg-sand/60">
                    {['Learner', 'Language', 'Class format', 'Phone', 'Source', 'Demo', 'Stage', 'Created'].map((h) => <th key={h} className="px-3 py-2 font-bold border border-line whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const d = nextDemo(l.id)
                    return (
                      <tr key={l.id} onClick={() => setOpenId(l.id)} className="cursor-pointer hover:bg-brand-50/50">
                        <td className="px-3 py-2 border border-line"><b>{l.learner_name}</b>{l.enquirer_name !== l.learner_name && <div className="text-xs text-ink-soft">via {l.enquirer_name}</div>}</td>
                        <td className="px-3 py-2 border border-line whitespace-nowrap">{`${l.languages?.name ?? '—'}${l.level ? ' · ' + l.level : ''}`}</td>
                        <td className="px-1 py-1 border border-line whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {canWrite ? (
                            <select aria-label={`Class format for ${l.learner_name}`} value={l.group_preference} onChange={(e) => void setFormat(l, e.target.value)}
                              className="min-h-8 border-0 bg-transparent px-2 text-sm cursor-pointer">
                              {GROUP_PREFS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
                            </select>
                          ) : <span className="px-2">{formatLabel(l.group_preference)}</span>}
                        </td>
                        <td className="px-3 py-2 border border-line whitespace-nowrap">{l.phone ?? '—'}</td>
                        <td className="px-3 py-2 border border-line whitespace-nowrap">{l.source}</td>
                        <td className="px-3 py-2 border border-line whitespace-nowrap">{d ? fmtDate(d.start_at) : '—'}</td>
                        <td className="px-1 py-1 border border-line" onClick={(e) => e.stopPropagation()}>
                          {canWrite && l.stage !== 'converted' ? (
                            <select aria-label={`Stage for ${l.learner_name}`} value={l.stage} onChange={(e) => void moveStage(l, e.target.value)}
                              className={cx('min-w-40 min-h-8 rounded-full border px-3 text-xs font-bold uppercase tracking-wide cursor-pointer', toneClass(l.stage))}>
                              {STAGES.map((s) => <option key={s.v} value={s.v} className={toneClass(s.v)}>{s.l}</option>)}
                            </select>
                          ) : <span className="px-2"><StatusBadge status={l.stage} text={stageLabel(l.stage)} /></span>}
                        </td>
                        <td className="px-3 py-2 border border-line whitespace-nowrap">{fmtDate(l.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {data && form && <LeadForm open lead={form.lead} languages={data.languages} leads={data.leads} onClose={() => setForm(null)}
        onSaved={() => { setForm(null); void reload() }} />}
      {data && <LeadDrawer id={openId} leads={data.leads} demos={data.demos} teachers={data.teachers} languages={data.languages} canWrite={canWrite} onClose={() => setOpenId(null)} reload={() => void reload()} />}
    </>
  )
}
