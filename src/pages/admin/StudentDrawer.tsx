import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Plus, UserCog } from 'lucide-react'
import { rpc, select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { AGE_GROUPS, LEVELS } from '../../lib/domain'
import { digits, fmtDate, fmtDateTime, inr, label, todayIn } from '../../lib/format'
import { Badge, Button, Drawer, Empty, Field, Input, KV, Modal, Notice, Section, Select, Spinner, Stat, StatusBadge, Tabs, Textarea, useConfirm } from '../../components/ui'

type Tab = 'overview' | 'schedule' | 'credits' | 'attendance' | 'notes' | 'payments' | 'history'
const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

export const CREDIT_REASONS = ['New enrollment', 'Renewal', 'Adjustment', 'Migration']

export function StudentDrawer({ enrollmentId, teachers, onClose, onChanged }: { enrollmentId: string; teachers: Row[]; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth()
  const nav = useNavigate()
  const confirm = useConfirm()
  const lowAt = useSetting<number>('credits.low_balance_warning_at', 2)
  const agingDays = useSetting<number>('credits.pending_age_warning_days', 14)
  const [tab, setTab] = useState<Tab>('overview')
  const [modal, setModal] = useState<null | 'credits' | 'assign' | 'course' | 'withdraw'>(null)
  const { busy, run } = useAction()
  const coord = can('coordinator')

  const d = useAsync(async () => {
    const e = (await select('enrollments', '*, students(*, student_contacts(*)), languages(name)', (q) => q.eq('id', enrollmentId)))[0]
    if (!e) throw new Error('Enrollment not found or you cannot see it.')
    const [bal, mk, pay, moves, parts, siblings] = await Promise.all([
      select('enrollment_balances', '*', (q) => q.eq('enrollment_id', enrollmentId)),
      select('enrollment_makeup', '*', (q) => q.eq('enrollment_id', enrollmentId)),
      select('enrollment_payment_status', '*', (q) => q.eq('enrollment_id', enrollmentId)),
      select('credit_movements', '*', (q) => q.eq('enrollment_id', enrollmentId).order('created_at', { ascending: false })),
      select('session_participants', 'attendance, absence_reason, sessions!inner(id,start_at,end_at,status,teacher_id,meeting_link)', (q) => q.eq('enrollment_id', enrollmentId)),
      select('enrollments', 'id, status, languages(name)', (q) => q.eq('student_id', e.student_id)),
    ])
    return { e, bal: bal[0], mk: mk[0], pay: pay[0], moves, parts: parts.sort((a, b) => +new Date(b.sessions.start_at) - +new Date(a.sessions.start_at)), siblings }
  }, [enrollmentId])

  const fin = useAsync(async () => (tab === 'payments' && can('finance') ? select('fee_plan_summary', '*', (q) => q.eq('enrollment_id', enrollmentId)) : []), [tab, enrollmentId])
  const hist = useAsync(async () => {
    if (tab !== 'history' || !can('super_admin') || !d.data) return []
    return select('audit_events', '*', (q) => q.or(`and(entity_type.eq.enrollments,entity_id.eq.${enrollmentId}),and(entity_type.eq.students,entity_id.eq.${d.data!.e.student_id})`).order('created_at', { ascending: false }).limit(60))
  }, [tab, d.data?.e.id])
  const notes = useAsync(async () => (tab === 'notes' ? select('student_notes', '*, profiles!author_id(full_name)', (q) => q.eq('student_id', d.data!.e.student_id).order('created_at', { ascending: false })) : []), [tab, d.data?.e.student_id])
  const [note, setNote] = useState('')

  if (d.loading && !d.data) return <Drawer open onClose={onClose} title="Loading…"><Spinner /></Drawer>
  if (!d.data) return <Drawer open onClose={onClose} title="Student"><Notice tone="red">{d.error}</Notice></Drawer>
  const { e, bal, mk, pay, moves, parts } = d.data
  const stu = e.students as Row
  const c = one<Row>(stu.student_contacts) ?? {}
  const tName = (id: string | null) => (id ? teachers.find((t) => t.id === id)?.name ?? 'Tutor' : 'Not assigned')
  const remaining = bal?.remaining ?? 0
  const owed = (bal?.allocated ?? 0) - (bal?.fulfilled ?? 0)
  const makeup = Math.min(mk?.missed ?? 0, remaining)
  const aging = mk?.oldest_missed && makeup > 0 && Date.now() - +new Date(mk.oldest_missed) > agingDays * 86400000
  const now = Date.now()
  const upcoming = parts.filter((p) => p.sessions.status === 'scheduled' && +new Date(p.sessions.end_at) >= now).reverse()
  const past = parts.filter((p) => !(p.sessions.status === 'scheduled' && +new Date(p.sessions.end_at) >= now))
  const termEnded = e.term_end && e.term_end < todayIn('Asia/Kolkata') && e.status === 'active'

  const refresh = async () => { await d.reload(); onChanged() }
  const setStatus = (status: string, ok: string) => run(async () => { await unwrap(supabase.from('enrollments').update({ status }).eq('id', e.id)); await refresh() }, ok)

  const complete = async () => {
    if (owed > 0) return
    const c2 = await confirm({ title: 'Mark course as completed?', body: <p>All {bal?.allocated ?? 0} allocated classes are fulfilled. This closes the course.</p>, confirmText: 'Mark completed' })
    if (c2.ok) await setStatus('completed', 'Course completed')
  }

  return (
    <>
      <Drawer open onClose={onClose} width="md:max-w-3xl" badge={<div className="flex gap-2"><StatusBadge status={e.status} text={label[e.status]} />{pay && coord !== undefined && <StatusBadge status={pay.state} text={pay.state === 'on_hold' ? 'On hold — payment' : label[pay.state]} />}</div>}
        title={stu.full_name} subtitle={`${e.languages?.name}${stu.level ? ` · ${stu.level}` : ''} · enrolled ${fmtDate(e.created_at)}`}>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: 'overview', label: 'Overview' }, { id: 'schedule', label: 'Schedule', count: upcoming.length }, { id: 'credits', label: 'Credits' }, { id: 'attendance', label: 'Attendance' }, { id: 'notes', label: 'Notes' },
          ...(can('finance') ? [{ id: 'payments' as const, label: 'Payments' }] : []), ...(can('super_admin') ? [{ id: 'history' as const, label: 'History' }] : []),
        ]} />

        {e.status === 'on_hold' && <Notice tone="red">Payment hold. New classes cannot be booked. Other students in the same group are not affected. Finance releases the hold once payment clears.</Notice>}
        {termEnded && owed > 0 && <Notice>The term ended on {fmtDate(e.term_end)} with {owed} class{owed === 1 ? '' : 'es'} still owed. {coord && <button className="underline font-semibold" onClick={() => void setStatus('pending_completion', 'Marked as pending completion')}>Mark as Pending completion</button>}</Notice>}

        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Classes remaining" value={remaining} tone={remaining <= lowAt ? 'yellow' : 'gray'} sub={remaining <= lowAt ? 'Time to renew' : undefined} />
              <Stat label="Booked" value={bal?.reserved ?? 0} /><Stat label="Delivered" value={bal?.fulfilled ?? 0} tone="green" />
              <Stat label="Makeup to arrange" value={makeup} tone={aging ? 'red' : makeup ? 'orange' : 'gray'} sub={aging ? `Oldest over ${agingDays} days` : undefined} />
            </div>
            <Section title="Lead">
              {coord ? <EditForm key={`${e.id}-${e.updated_at}-${stu.updated_at}`} stu={stu} contact={c} e={e} onDone={() => void refresh()} /> : (
                <>
                  <dl className="grid sm:grid-cols-2 gap-4">
                    <KV k="Parent / contact" v={c.parent_name} /><KV k="WhatsApp" v={c.phone} /><KV k="Email" v={c.email} /><KV k="Level" v={stu.level} />
                    <KV k="Age group" v={stu.age_group} />
                  </dl>
                  {stu.notes && <p className="text-sm mt-3 whitespace-pre-wrap text-ink-soft">{stu.notes}</p>}
                </>
              )}
            </Section>
            <Section title="Course & teacher" action={coord && !['completed', 'withdrawn'].includes(e.status) ? <Button size="sm" onClick={() => setModal('assign')}><UserCog size={14} /> {e.primary_teacher_id ? 'Change tutor' : 'Assign tutor'}</Button> : undefined}>
              <dl className="grid sm:grid-cols-2 gap-4">
                <KV k="Language" v={e.languages?.name} /><KV k="Tutor" v={<span>{tName(e.primary_teacher_id)} {e.primary_teacher_id && <Badge tone={e.assignment_status === 'accepted' ? 'green' : e.assignment_status === 'declined' ? 'red' : 'yellow'}>{label[e.assignment_status]}</Badge>}</span>} />
                {!coord && <><KV k="Term" v={e.term_start || e.term_end ? `${fmtDate(e.term_start)} → ${fmtDate(e.term_end)}` : 'Not set'} /><KV k="Agreed classes" v={e.agreed_classes} />
                <KV k="Preferred timing" v={e.preferred_timing} /><KV k="Meeting link" v={e.meeting_link ? <a className="text-brand-700 underline break-all" href={e.meeting_link} target="_blank" rel="noreferrer">{e.meeting_link}</a> : null} /></>}
              </dl>
              {!e.primary_teacher_id && !['completed', 'withdrawn'].includes(e.status) && <p className="text-sm text-amber-700 mt-3">No tutor yet. Assign a tutor; classes can be booked once the tutor accepts.</p>}
              {e.primary_teacher_id && e.assignment_status === 'awaiting_tutor' && <p className="text-sm text-amber-700 mt-3">Waiting for {tName(e.primary_teacher_id)} to accept. The status becomes Active once they do.</p>}
              {e.assignment_status === 'declined' && <p className="text-sm text-red-700 mt-3">The tutor declined. Assign another tutor to continue.</p>}
            </Section>
            {(bal?.allocated ?? 0) > 0 && (
              <Section title="Course information">
                <dl className="grid sm:grid-cols-2 gap-4">
                  <KV k="Course" v={`${e.languages?.name ?? '—'}${stu.level ? ` · ${stu.level}` : ''}`} />
                  <KV k="Classes allocated" v={bal.allocated} />
                  <KV k="Booked" v={bal.reserved ?? 0} /><KV k="Delivered" v={bal.fulfilled ?? 0} />
                  <KV k="Remaining" v={remaining} /><KV k="Preferred timing" v={e.preferred_timing} />
                </dl>
                {!!moves.length && <ul className="mt-3 text-sm divide-y divide-line">{moves.slice(0, 5).map((m) => <li key={m.id} className="py-1.5 flex justify-between gap-3"><span><b>+{m.quantity}</b> classes · {m.reason}</span><span className="text-xs text-ink-soft">{fmtDate(m.created_at)}</span></li>)}</ul>}
                <p className="font-bold text-sm mt-4 mb-1.5">Class timing</p>
                {e.assignment_status !== 'accepted' ? <p className="text-sm text-ink-soft">Class timings appear here once the tutor accepts.</p>
                  : !upcoming.length ? <p className="text-sm text-ink-soft">{tName(e.primary_teacher_id)} accepted. Class times appear here once they are booked.</p>
                  : <ul className="text-sm divide-y divide-line">{upcoming.slice(0, 8).map((p) => <li key={p.sessions.id} className="py-1.5 flex flex-wrap justify-between gap-2"><span><b>{fmtDateTime(p.sessions.start_at)}</b> <span className="text-ink-soft">with {tName(p.sessions.teacher_id)}</span></span>{p.sessions.meeting_link && <a className="text-brand-700 underline" href={p.sessions.meeting_link} target="_blank" rel="noreferrer">Join link</a>}</li>)}</ul>}
              </Section>
            )}
            {d.data.siblings.length > 1 && <Section title="Other courses for this learner"><div className="flex flex-wrap gap-2">{d.data.siblings.filter((s) => s.id !== e.id).map((s) => <Badge key={s.id}>{one<Row>(s.languages)?.name} · {label[s.status]}</Badge>)}</div></Section>}
            {coord && !['completed', 'withdrawn'].includes(e.status) && (
              <Section title="Enrollment actions">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setModal('credits')}><Plus size={15} /> Allocate classes</Button>
                  <Button onClick={() => setModal('course')}>Add another course</Button>
                  {e.status === 'pending_completion' && <Button onClick={() => void setStatus('active', 'Course reactivated')}>Back to active</Button>}
                  {['active', 'pending_completion'].includes(e.status) && <Button disabled={owed > 0} title={owed > 0 ? `${owed} classes are still owed` : ''} onClick={() => void complete()}><CheckCircle2 size={15} /> Mark completed</Button>}
                  <Button variant="danger" onClick={() => setModal('withdraw')}>Withdraw / close</Button>
                </div>
                {['active', 'pending_completion'].includes(e.status) && owed > 0 && <p className="text-xs text-ink-soft mt-2">Completion needs every allocated class fulfilled ({owed} still owed). To close early, withdraw with a documented settlement.</p>}
                {!can('finance') ? null : <p className="text-xs text-ink-soft mt-2">Fee plans and holds are managed under Fees & payments.</p>}
              </Section>
            )}
          </>
        )}

        {tab === 'schedule' && (
          <Section title="Upcoming classes" action={coord ? <Button size="sm" onClick={() => nav('/admin/scheduler')}>Open scheduler</Button> : undefined}>
            {!upcoming.length ? <Empty title="No upcoming classes" hint={remaining > 0 ? `${remaining} class credits are available. The tutor books the times.` : 'No credits available. Allocate classes first.'} /> : (
              <ul className="divide-y divide-line">{upcoming.map((p) => <li key={p.sessions.id} className="py-2.5 flex flex-wrap justify-between gap-2 text-sm"><span><b>{fmtDateTime(p.sessions.start_at)}</b> <span className="text-ink-soft">with {tName(p.sessions.teacher_id)}</span></span>{p.sessions.meeting_link && <a className="text-brand-700 underline" href={p.sessions.meeting_link} target="_blank" rel="noreferrer">Join link</a>}</li>)}</ul>
            )}
          </Section>
        )}

        {tab === 'credits' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Allocated" value={bal?.allocated ?? 0} /><Stat label="Booked" value={bal?.reserved ?? 0} /><Stat label="Delivered" value={bal?.fulfilled ?? 0} tone="green" /><Stat label="Remaining" value={remaining} tone="orange" /></div>
            <Section title="Allocation history" action={coord && !['completed', 'withdrawn'].includes(e.status) ? <Button size="sm" onClick={() => setModal('credits')}><Plus size={14} /> Allocate</Button> : undefined}>
              {!moves.length ? <Empty title="No classes allocated yet" /> : <ul className="divide-y divide-line text-sm">{moves.map((m) => <li key={m.id} className="py-2.5 flex justify-between gap-3"><span><b>+{m.quantity}</b> · {m.reason} <span className="text-ink-soft">(period {String(m.allocation_period).slice(0, 7)})</span></span><span className="text-xs text-ink-soft">{fmtDate(m.created_at)}</span></li>)}</ul>}
              <p className="text-xs text-ink-soft mt-3">One credit = one class for one learner, whatever its length. Missed classes never expire.</p>
            </Section>
          </>
        )}

        {tab === 'attendance' && (
          <Section title="Attendance & makeup history">
            {aging && <p className="text-sm text-red-700 flex gap-2 mb-3"><AlertTriangle size={16} /> A missed class has been waiting over {agingDays} days.</p>}
            {!past.length ? <Empty title="No past classes yet" /> : <ul className="divide-y divide-line text-sm">{past.map((p) => (
              <li key={p.sessions.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                <span><b>{fmtDateTime(p.sessions.start_at)}</b> <span className="text-ink-soft">· {tName(p.sessions.teacher_id)}</span></span>
                <span className="flex items-center gap-2">{p.sessions.status === 'cancelled' ? <StatusBadge status="cancelled" text="Cancelled (owed)" /> : <StatusBadge status={p.attendance} text={label[p.attendance]} />}{p.absence_reason && <span className="text-xs text-ink-soft">{p.absence_reason}</span>}</span>
              </li>))}</ul>}
          </Section>
        )}

        {tab === 'notes' && (
          <Section title="Lessons & consultation notes">
            {coord && <div className="flex gap-2 mb-4"><Input aria-label="New note" value={note} onChange={(e2) => setNote(e2.target.value)} placeholder="Call review, preference update or general note…" />
              <Button variant="dark" disabled={!note.trim()} loading={busy} onClick={() => void run(async () => { await unwrap(supabase.from('student_notes').insert({ student_id: stu.id, body: note.trim() })); setNote(''); await notes.reload() }, 'Note posted')}>Post note</Button></div>}
            {notes.error ? <Notice>{notes.error}</Notice> : notes.loading ? <Spinner /> : !notes.data?.length ? <Empty title="No notes yet" /> : (
              <ul className="space-y-3">{notes.data.map((n: Row) => <li key={n.id} className="rounded-xl border border-line bg-white p-3 text-sm"><div className="flex justify-between text-xs text-ink-soft mb-1"><span>By {n.profiles?.full_name ?? 'Staff'}</span><span>{fmtDate(n.created_at)}</span></div>{n.body}</li>)}</ul>
            )}
          </Section>
        )}

        {tab === 'payments' && (
          <Section title="Fee summary" action={<Button size="sm" onClick={() => nav('/admin/fees')}>Open Fees</Button>}>
            {fin.loading ? <Spinner /> : !fin.data?.length ? <Empty title="No fee plan yet" hint="Finance sets the fee plan from Fees & payments." /> : (
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4"><KV k="Total due" v={inr(fin.data[0].total_due)} /><KV k="Paid" v={inr(fin.data[0].paid)} /><KV k="Outstanding" v={inr(fin.data[0].outstanding)} /><KV k="Next due" v={fmtDate(fin.data[0].next_due)} /></dl>
            )}
          </Section>
        )}

        {tab === 'history' && (
          <Section title="Audit history">
            {hist.loading ? <Spinner /> : !hist.data?.length ? <Empty title="No recorded changes" /> : (
              <ul className="space-y-2 text-sm">{hist.data.map((a: Row) => <li key={a.id} className="flex justify-between gap-3"><span><b>{a.entity_type}</b> {a.action}{a.after_value?.status && a.before_value?.status !== a.after_value.status ? `: ${a.before_value?.status ?? '—'} → ${a.after_value.status}` : ''}{a.after_value?.primary_teacher_id && a.before_value?.primary_teacher_id !== a.after_value.primary_teacher_id ? ` · tutor → ${tName(a.after_value.primary_teacher_id)}` : ''}</span><span className="text-xs text-ink-soft shrink-0">{fmtDateTime(a.created_at)}</span></li>)}</ul>
            )}
          </Section>
        )}
      </Drawer>

      {modal === 'credits' && <CreditsModal enrollment={e} onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh() }} />}
      {modal === 'assign' && <AssignModal e={e} teachers={teachers} onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh() }} />}
      {modal === 'course' && <CourseModal studentId={stu.id} onClose={() => setModal(null)} onDone={(id) => { setModal(null); onChanged(); nav(`/admin/students?open=${id}`) }} />}
      {modal === 'withdraw' && <WithdrawModal e={e} stu={stu} owed={owed} onClose={() => setModal(null)} onDone={() => { setModal(null); void refresh() }} />}
    </>
  )
}

function CreditsModal({ enrollment, onClose, onDone }: { enrollment: Row; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(CREDIT_REASONS[0])
  const [month, setMonth] = useState(todayIn('Asia/Kolkata').slice(0, 7))
  const { busy, run } = useAction()
  const n = Number(qty)
  const valid = Number.isInteger(n) && n > 0 && n <= 500
  return (
    <Modal open onClose={onClose} title="Allocate classes" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={() => void run(async () => {
      await unwrap(supabase.from('credit_movements').insert({ enrollment_id: enrollment.id, quantity: n, reason, allocation_period: `${month}-01` })); onDone()
    }, `${n} classes allocated`)}>Allocate {valid ? n : ''}</Button></>}>
      <div className="space-y-4">
        <Field label="Number of classes" required hint="One credit is one class for one learner, regardless of its length."><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{CREDIT_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Allocation month" hint="Kept for ageing reports. Earlier allocations are never overwritten."><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <p className="text-xs text-ink-soft">Credits cannot be removed once allocated. A correction is recorded as a separate adjustment.</p>
      </div>
    </Modal>
  )
}

function EditForm({ stu, contact, e, onDone }: { stu: Row; contact: Row; e: Row; onDone: () => void }) {
  const [f, setF] = useState({ full_name: stu.full_name, level: stu.level ?? '', age_group: stu.age_group ?? '', timezone: stu.timezone, notes: stu.notes ?? '', parent_name: contact.parent_name ?? '', phone: contact.phone ?? '', email: contact.email ?? '',
    term_start: e.term_start ?? '', term_end: e.term_end ?? '', agreed_classes: e.agreed_classes ?? '', preferred_timing: e.preferred_timing ?? '', meeting_link: e.meeting_link ?? '' })
  const [err, setErr] = useState('')
  const { busy, run } = useAction()
  const s = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value })
  const save = () => run(async () => {
    setErr('')
    if (f.full_name.trim().length < 2) return setErr('Enter the learner’s name.')
    if (f.phone && !/^[0-9]{7,15}$/.test(digits(f.phone))) return setErr('Phone must be 7–15 digits.')
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Enter a valid email.')
    if (f.term_start && f.term_end && f.term_end < f.term_start) return setErr('The term cannot end before it starts.')
    if (f.agreed_classes !== '' && !(Number(f.agreed_classes) > 0)) return setErr('Agreed classes must be more than zero.')
    if (f.meeting_link && !/^https?:\/\//i.test(f.meeting_link)) return setErr('The meeting link must start with http:// or https://')
    await unwrap(supabase.from('students').update({ full_name: f.full_name.trim(), level: f.level || null, age_group: f.age_group || null, timezone: f.timezone, notes: f.notes.trim() || null }).eq('id', stu.id))
    await unwrap(supabase.from('student_contacts').upsert({ student_id: stu.id, parent_name: f.parent_name.trim() || null, phone: f.phone ? digits(f.phone) : null, email: f.email.trim() || null }))
    await unwrap(supabase.from('enrollments').update({ term_start: f.term_start || null, term_end: f.term_end || null, agreed_classes: f.agreed_classes === '' ? null : Number(f.agreed_classes), preferred_timing: f.preferred_timing.trim() || null, meeting_link: f.meeting_link.trim() || null }).eq('id', e.id))
    onDone()
  }, 'Details saved')
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Learner name" required><Input value={f.full_name} onChange={s('full_name')} /></Field>
        <Field label="Level"><Select value={f.level} onChange={s('level')}><option value="">—</option>{[...new Set([f.level, ...LEVELS].filter(Boolean))].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Age group"><Select value={f.age_group} onChange={s('age_group')}><option value="">—</option>{[...new Set([f.age_group, ...AGE_GROUPS].filter(Boolean))].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Parent / contact name"><Input value={f.parent_name} onChange={s('parent_name')} /></Field>
        <Field label="WhatsApp / phone"><Input inputMode="tel" value={f.phone} onChange={s('phone')} /></Field>
        <Field label="Email" className="sm:col-span-2"><Input type="email" value={f.email} onChange={s('email')} /></Field>
        <Field label="Term starts"><Input type="date" value={f.term_start} onChange={s('term_start')} /></Field>
        <Field label="Term ends"><Input type="date" value={f.term_end} onChange={s('term_end')} /></Field>
        <Field label="Agreed classes" hint="Commitment only. Classes become bookable when allocated."><Input inputMode="numeric" value={f.agreed_classes} onChange={s('agreed_classes')} /></Field>
        <Field label="Preferred timing"><Input value={f.preferred_timing} onChange={s('preferred_timing')} /></Field>
        <Field label="Meeting link" className="sm:col-span-2"><Input type="url" value={f.meeting_link} onChange={s('meeting_link')} placeholder="https://meet.google.com/…" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={s('notes')} /></Field>
      </div>
      {err && <p role="alert" className="text-sm text-red-600 mt-3">{err}</p>}
      <div className="mt-4"><Button variant="primary" loading={busy} onClick={() => void save()}>Save changes</Button></div>
    </>
  )
}

function AssignModal({ e, teachers, onClose, onDone }: { e: Row; teachers: Row[]; onClose: () => void; onDone: () => void }) {
  const lang = (one<Row>(e.languages)?.name ?? '').toLowerCase()
  const eligible = teachers.filter((t) => t.approved !== false && (t.languages as string[]).some((l) => l.toLowerCase() === lang))
  const [pick, setPick] = useState(e.primary_teacher_id ?? '')
  const { busy, run } = useAction()
  return (
    <Modal open onClose={onClose} title="Assign tutor" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick || pick === e.primary_teacher_id && e.assignment_status !== 'declined'} loading={busy} onClick={() => void run(async () => { await rpc('assign_teacher', { p_enrollment: e.id, p_teacher: pick }); onDone() }, 'Request sent. The tutor must accept before teaching.')}>Send request</Button></>}>
      <Field label={`Approved ${one<Row>(e.languages)?.name} tutors`} hint="The tutor must accept before they can manage this learner's classes. Tutor changes with upcoming classes need those classes cancelled or reassigned first.">
        <Select value={pick} onChange={(ev) => setPick(ev.target.value)}><option value="">Choose a tutor…</option>{eligible.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </Field>
      {!eligible.length && <Notice>No approved tutor teaches this language yet.</Notice>}
    </Modal>
  )
}

function CourseModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: (id: string) => void }) {
  const langs = useAsync(() => select('languages', '*', (q) => q.eq('active', true).order('name')))
  const [lang, setLang] = useState('')
  const [classes, setClasses] = useState('')
  const [timing, setTiming] = useState('')
  const { busy, run } = useAction()
  return (
    <Modal open onClose={onClose} title="Add another course" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!lang} loading={busy} onClick={() => void run(async () => {
      const r = await unwrap(supabase.from('enrollments').insert({ student_id: studentId, language_id: lang, agreed_classes: classes ? Number(classes) : null, preferred_timing: timing || null }).select('id').single()) as Row
      onDone(r.id)
    }, 'Course added')}>Create course</Button></>}>
      <div className="space-y-4">
        <Field label="Language / course" required><Select value={lang} onChange={(e) => setLang(e.target.value)}><option value="">Choose…</option>{langs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Agreed classes (optional)"><Input inputMode="numeric" value={classes} onChange={(e) => setClasses(e.target.value)} /></Field>
        <Field label="Preferred timing (optional)"><Input value={timing} onChange={(e) => setTiming(e.target.value)} /></Field>
        <p className="text-xs text-ink-soft">The new course has its own credits, tutor, fees and calendar. Earlier courses and pending classes are untouched.</p>
      </div>
    </Modal>
  )
}

function WithdrawModal({ e, stu, owed, onClose, onDone }: { e: Row; stu: Row; owed: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [settle, setSettle] = useState('No fees outstanding')
  const [detail, setDetail] = useState('')
  const { busy, run } = useAction()
  const ok = reason.trim().length > 2 && (settle === 'No fees outstanding' || detail.trim().length > 2)
  return (
    <Modal open onClose={onClose} title={`Withdraw ${stu.full_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!ok} loading={busy} onClick={() => void run(async () => {
      const line = `Withdrawn ${todayIn('Asia/Kolkata')}: ${reason.trim()} | Settlement: ${settle}${detail.trim() ? ` (${detail.trim()})` : ''} | ${owed} classes unfulfilled`
      await unwrap(supabase.from('students').update({ notes: [stu.notes, line].filter(Boolean).join('\n') }).eq('id', stu.id))
      await unwrap(supabase.from('enrollments').update({ status: 'withdrawn' }).eq('id', e.id))
      onDone()
    }, 'Course closed as withdrawn')}>Withdraw course</Button></>}>
      <div className="space-y-4">
        {owed > 0 && <Notice>{owed} allocated class{owed === 1 ? ' is' : 'es are'} unfulfilled. Say how that is settled below.</Notice>}
        <Field label="Reason for withdrawal" required><Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
        <Field label="How are remaining obligations settled?" required><Select value={settle} onChange={(ev) => setSettle(ev.target.value)}>{['No fees outstanding', 'Refund recorded', 'Waiver agreed', 'Settled with the family'].map((o) => <option key={o}>{o}</option>)}</Select></Field>
        {settle !== 'No fees outstanding' && <Field label="Settlement details" required hint="Finance records any refund or waiver amount under Fees & payments."><Textarea value={detail} onChange={(ev) => setDetail(ev.target.value)} /></Field>}
        <p className="text-xs text-ink-soft">Attendance, credit and financial history are kept in full.</p>
      </div>
    </Modal>
  )
}
