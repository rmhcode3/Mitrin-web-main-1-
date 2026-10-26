import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Link2, Repeat } from 'lucide-react'
import { rpc, select, type Row } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useAsync, useSetting } from '../lib/hooks'
import { ABSENCE_REASONS } from '../lib/domain'
import { WD3, addDays, fmtDate, fmtDateTime, fmtTime, inTz, label, shortTz, todayIn, zonedToUtc, dow, mondayOf } from '../lib/format'
import { useToast } from '../lib/toast'
import { Badge, Button, Drawer, Empty, Field, Input, Modal, Notice, Section, Select, Spinner, StatusBadge, Textarea, cx, type Tone, useConfirm } from './ui'

export const SESSION_SELECT = 'id, teacher_id, start_at, end_at, status, meeting_link, series_id, cancel_reason, session_participants(enrollment_id, attendance, absence_reason, enrollments(id, student_id, primary_teacher_id, students(full_name, timezone), languages(name)))'

export interface CalEvent { id: string; start: string; end: string; title: string; sub?: string; tone: Tone; kind: 'session' | 'demo'; raw: Row }

const toneBar: Record<Tone, string> = { gray: 'bg-gray-300', orange: 'bg-brand-500', green: 'bg-emerald-500', red: 'bg-red-400', blue: 'bg-sky-500', purple: 'bg-violet-500', yellow: 'bg-amber-400', teal: 'bg-teal-500' }

export const names = (s: Row) => (s.session_participants as Row[]).map((p) => p.enrollments?.students?.full_name).filter(Boolean) as string[]

export function sessionEvent(s: Row, teacher?: string): CalEvent {
  const n = names(s)
  const tone: Tone = s.status === 'cancelled' ? 'red' : s.status === 'completed' ? 'green' : 'blue'
  return { id: s.id, start: s.start_at, end: s.end_at, title: n.length ? (n.length > 2 ? `${n.slice(0, 2).join(', ')} +${n.length - 2}` : n.join(', ')) : 'Class', sub: [teacher, n.length > 1 ? 'Group' : ''].filter(Boolean).join(' · '), tone, kind: 'session', raw: s }
}

export type CalView = 'day' | 'week' | 'month'

export function rangeFor(view: CalView, anchor: string): [string, string] {
  if (view === 'day') return [anchor, anchor]
  if (view === 'week') { const m = mondayOf(anchor); return [m, addDays(m, 6)] }
  const first = anchor.slice(0, 7) + '-01'
  const next = new Date(first + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1)
  const last = addDays(next.toISOString().slice(0, 10), -1)
  return [mondayOf(first), addDays(mondayOf(last), 6)]
}

export function shiftAnchor(view: CalView, anchor: string, dir: number) {
  if (view === 'day') return addDays(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  const d = new Date(anchor.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + dir)
  return d.toISOString().slice(0, 10)
}

export function CalendarToolbar({ view, setView, anchor, setAnchor, tz }: { view: CalView; setView: (v: CalView) => void; anchor: string; setAnchor: (a: string) => void; tz: string }) {
  const [a, b] = rangeFor(view, anchor)
  const title = view === 'day' ? fmtDate(anchor, 'UTC') : view === 'week' ? `${fmtDate(a, 'UTC')} – ${fmtDate(b, 'UTC')}` : new Date(anchor.slice(0, 7) + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <div className="flex flex-wrap items-center gap-2 justify-between mb-3">
      <div className="flex items-center gap-1.5">
        <Button size="sm" aria-label="Previous" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}><ChevronLeft size={16} /></Button>
        <Button size="sm" onClick={() => setAnchor(todayIn(tz))}>Today</Button>
        <Button size="sm" aria-label="Next" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}><ChevronRight size={16} /></Button>
        <p className="font-extrabold ml-2">{title}</p>
      </div>
      <div className="inline-flex rounded-xl border border-line bg-white p-1">
        {(['day', 'week', 'month'] as CalView[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={cx('min-h-9 px-3.5 rounded-lg text-sm font-semibold capitalize', view === v ? 'bg-navy text-white' : 'text-ink-soft')}>{v}</button>)}
      </div>
    </div>
  )
}

function EventChip({ e, tz, onOpen, compact }: { e: CalEvent; tz: string; onOpen: (e: CalEvent) => void; compact?: boolean }) {
  return (
    <button onClick={() => onOpen(e)} className={cx('w-full text-left rounded-lg border border-line bg-white hover:border-brand-200 hover:shadow-sm flex overflow-hidden', e.tone === 'red' && 'opacity-70')}>
      <span className={cx('w-1.5 shrink-0', toneBar[e.tone])} />
      <span className={cx('min-w-0 flex-1', compact ? 'px-2 py-1' : 'px-3 py-2')}>
        <span className="block text-[11px] font-bold text-ink-soft">{fmtTime(e.start, tz)}{e.kind === 'demo' && ' · DEMO'}</span>
        <span className={cx('block font-semibold truncate', compact ? 'text-xs' : 'text-sm')}>{e.title}</span>
        {!compact && e.sub && <span className="block text-xs text-ink-soft truncate">{e.sub}</span>}
      </span>
    </button>
  )
}

export function Calendar({ view, anchor, events, tz, onOpen, onDay }: { view: CalView; anchor: string; events: CalEvent[]; tz: string; onOpen: (e: CalEvent) => void; onDay: (d: string) => void }) {
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of [...events].sort((a, b) => +new Date(a.start) - +new Date(b.start))) { const k = inTz(e.start, tz).date; m.set(k, [...(m.get(k) ?? []), e]) }
    return m
  }, [events, tz])
  const today = todayIn(tz)

  if (view === 'day') {
    const list = byDay.get(anchor) ?? []
    return list.length ? <div className="space-y-2 max-w-2xl">{list.map((e) => <EventChip key={e.id} e={e} tz={tz} onOpen={onOpen} />)}</div> : <Empty title="No classes this day" />
  }
  if (view === 'week') {
    const m = mondayOf(anchor)
    return (
      <div className="grid gap-3 md:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => addDays(m, i)).map((d) => (
          <div key={d} className={cx('rounded-xl border p-2 min-h-24 md:min-h-64', d === today ? 'border-brand-500 bg-brand-50/40' : 'border-line bg-sand/40')}>
            <button onClick={() => onDay(d)} className="text-xs font-extrabold mb-2 block w-full text-left">{WD3[dow(d)]} <span className="text-ink-soft font-semibold">{d.slice(8)}/{d.slice(5, 7)}</span></button>
            <div className="space-y-1.5">{(byDay.get(d) ?? []).map((e) => <EventChip key={e.id} e={e} tz={tz} onOpen={onOpen} compact />)}</div>
            {!(byDay.get(d) ?? []).length && <p className="text-[11px] text-ink-soft/70 md:hidden">No classes</p>}
          </div>
        ))}
      </div>
    )
  }
  const [a, b] = rangeFor('month', anchor)
  const days: string[] = []
  for (let d = a; d <= b; d = addDays(d, 1)) days.push(d)
  return (
    <>
      <div className="hidden md:grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-line bg-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-sand text-center text-meta font-bold uppercase py-2 text-ink-soft">{d}</div>)}
        {days.map((d) => {
          const ev = byDay.get(d) ?? []; const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
          return (
            <button key={d} onClick={() => onDay(d)} className={cx('bg-white min-h-24 p-1.5 text-left align-top hover:bg-brand-50/40', !inMonth && 'bg-sand/60 text-ink-soft/50', d === today && 'ring-2 ring-inset ring-brand-500')}>
              <span className="text-xs font-bold">{+d.slice(8)}</span>
              {ev.slice(0, 2).map((e) => <span key={e.id} className="mt-1 flex items-center gap-1 text-[11px] truncate"><span className={cx('h-1.5 w-1.5 rounded-full shrink-0', toneBar[e.tone])} />{fmtTime(e.start, tz).replace(' ', '').toLowerCase()} {e.title}</span>)}
              {ev.length > 2 && <span className="text-[11px] text-brand-700 font-bold">+{ev.length - 2} more</span>}
            </button>
          )
        })}
      </div>
      <div className="md:hidden space-y-2">
        {days.filter((d) => d.slice(0, 7) === anchor.slice(0, 7) && (byDay.get(d) ?? []).length).map((d) => (
          <div key={d}><p className="text-xs font-extrabold text-ink-soft mb-1">{fmtDate(d, 'UTC')}</p><div className="space-y-1.5">{(byDay.get(d) ?? []).map((e) => <EventChip key={e.id} e={e} tz={tz} onOpen={onOpen} />)}</div></div>
        ))}
        {!events.length && <Empty title="No classes this month" />}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ attendance */
export function AttendanceMarker({ session, admin, onSaved, saveLabel = 'Save attendance' }: { session: Row; admin?: boolean; onSaved: (r: { completed: boolean }) => void; saveLabel?: string }) {
  const parts = session.session_participants as Row[]
  const [m, setM] = useState<Record<string, { att: string; reason: string }>>(() => Object.fromEntries(parts.map((p) => [p.enrollment_id, { att: p.attendance, reason: p.absence_reason ?? '' }])))
  const { busy, run } = useAction()
  const toast = useToast()
  const marked = Object.entries(m).filter(([, v]) => v.att !== 'unmarked')
  const bad = marked.some(([, v]) => v.att === 'absent' && !v.reason.trim())
  const save = () => run(async () => {
    const r = await rpc<{ completed: boolean; missing_rate: number }>('mark_attendance', { p_session: session.id, p_marks: marked.map(([id, v]) => ({ enrollment_id: id, attendance: v.att, reason: v.reason })) })
    if (admin && r.missing_rate > 0) toast.err(`${r.missing_rate} attended learner(s) have no tutor rate yet. Finance needs to set one.`)
    onSaved(r)
  }, 'Attendance saved')
  return (
    <div className="space-y-3">
      {parts.map((p) => {
        const v = m[p.enrollment_id]
        const set = (att: string) => setM({ ...m, [p.enrollment_id]: { att, reason: att === 'absent' ? v.reason : '' } })
        return (
          <div key={p.enrollment_id} className="rounded-xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-bold">{p.enrollments?.students?.full_name}</p><p className="text-xs text-ink-soft">{p.enrollments?.languages?.name}</p></div>
              <div className="inline-flex rounded-xl border border-line overflow-hidden" role="group" aria-label={`Attendance for ${p.enrollments?.students?.full_name}`}>
                <button aria-pressed={v.att === 'present'} onClick={() => set('present')} className={cx('min-h-11 px-5 text-sm font-bold', v.att === 'present' ? 'bg-emerald-600 text-white' : 'bg-white text-ink-soft')}>Present</button>
                <button aria-pressed={v.att === 'absent'} onClick={() => set('absent')} className={cx('min-h-11 px-5 text-sm font-bold border-l border-line', v.att === 'absent' ? 'bg-red-600 text-white' : 'bg-white text-ink-soft')}>Absent</button>
              </div>
            </div>
            {v.att === 'unmarked' && <p className="text-meta text-ink-soft mt-1.5">Not marked yet. Unmarked is not the same as absent.</p>}
            {v.att === 'absent' && (
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                <Select aria-label="Absence reason" value={ABSENCE_REASONS.includes(v.reason as never) ? v.reason : v.reason ? 'Other' : ''} onChange={(e) => setM({ ...m, [p.enrollment_id]: { ...v, reason: e.target.value === 'Other' ? 'Other: ' : e.target.value } })}>
                  <option value="">Reason…</option>{ABSENCE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </Select>
                {v.reason.startsWith('Other') && <Input aria-label="Other reason" value={v.reason.replace(/^Other:? ?/, '')} onChange={(e) => setM({ ...m, [p.enrollment_id]: { ...v, reason: `Other: ${e.target.value}` } })} placeholder="Describe the reason" />}
              </div>
            )}
          </div>
        )
      })}
      <p className="text-xs text-ink-soft">The learner’s class is kept for a makeup when they are absent. Other learners in the group are not affected.</p>
      <Button variant="primary" className="w-full sm:w-auto" disabled={!marked.length || bad} loading={busy} onClick={() => void save()}>{saveLabel}</Button>
      {bad && <p className="text-xs text-red-600">Please give a reason for each absent learner.</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ session panel */
export function SessionPanel({ session, teachers, tz, admin, canCoordinate, onClose, onChanged }: { session: Row; teachers: Row[]; tz: string; admin: boolean; canCoordinate: boolean; onClose: () => void; onChanged: () => void }) {
  const { isAdmin } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()
  const [panel, setPanel] = useState<null | 'attendance' | 'time' | 'reassign' | 'link'>(null)
  const { busy, run } = useAction()
  const tName = teachers.find((t) => t.id === session.teacher_id)?.name
  const started = new Date(session.start_at) <= new Date()
  const upcoming = session.status === 'scheduled' && new Date(session.end_at) > new Date()
  const changes = useAsync(() => select('session_changes', '*', (q) => q.eq('session_id', session.id).order('created_at', { ascending: false })), [session.id])
  const hasSeries = Boolean(session.series_id)
  const canEdit = session.status === 'scheduled'

  const cancel = async () => {
    const c = await confirm({ title: 'Cancel this class?', body: <div className="space-y-2"><p>Each learner keeps their class credit. It becomes a makeup to arrange.</p>{hasSeries && <p className="text-xs text-ink-soft">Part of a repeating plan, so you can also cancel all later classes in it.</p>}</div>, reason: 'Reason for cancelling', danger: true, confirmText: 'Cancel class' })
    if (!c.ok) return
    let scope = 'this'
    if (hasSeries) { const all = await confirm({ title: 'Cancel later classes too?', body: <p>Cancel this class only, or this and all later classes in the repeat plan?</p>, confirmText: 'This and later classes' }); if (all.ok) scope = 'future' }
    await run(async () => { const n = await rpc<number>('cancel_session', { p_session: session.id, p_reason: c.reason, p_scope: scope }); toast.ok(`${n} class${n === 1 ? '' : 'es'} cancelled`); onChanged(); onClose() })
  }

  return (
    <Drawer open onClose={onClose} badge={<StatusBadge status={session.status} text={label[session.status]} />} title={names(session).join(', ') || 'Class'}
      subtitle={`${fmtDateTime(session.start_at, tz)} – ${fmtTime(session.end_at, tz)} (${shortTz(tz, new Date(session.start_at))})${tName && admin ? ` · ${tName}` : ''}`}>
      <Section title="Learners">
        <ul className="divide-y divide-line">
          {(session.session_participants as Row[]).map((p) => (
            <li key={p.enrollment_id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <span><b>{p.enrollments?.students?.full_name}</b> <span className="text-ink-soft">· {p.enrollments?.languages?.name}</span></span>
              <span className="flex items-center gap-2"><StatusBadge status={p.attendance} text={label[p.attendance]} />{p.absence_reason && <span className="text-xs text-ink-soft">{p.absence_reason}</span>}</span>
            </li>
          ))}
        </ul>
        {session.status === 'cancelled' && <p className="text-sm text-red-700 mt-2">Cancelled{session.cancel_reason ? `: ${session.cancel_reason}` : ''}. Classes are kept as makeups.</p>}
      </Section>

      <Section title="Meeting link" action={isAdmin || !admin ? <Button size="sm" onClick={() => setPanel('link')}>{session.meeting_link ? 'Change' : 'Add link'}</Button> : undefined}>
        {session.meeting_link ? (
          <div className="flex flex-wrap items-center gap-2"><a className="text-brand-700 underline break-all text-sm" href={session.meeting_link} target="_blank" rel="noreferrer">{session.meeting_link}</a>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(session.meeting_link).then(() => toast.ok('Link copied'))}><Copy size={13} /> Copy</Button>
            <a href={session.meeting_link} target="_blank" rel="noreferrer"><Button size="sm" variant="primary"><ExternalLink size={13} /> Open</Button></a></div>
        ) : <p className="text-sm text-ink-soft">No link yet. Add your Zoom or Google Meet link, then share it in your WhatsApp group.</p>}
      </Section>

      {panel === 'attendance' ? (
        <Section title="Mark attendance"><AttendanceMarker session={session} admin={admin} onSaved={() => { setPanel(null); onChanged(); onClose() }} /></Section>
      ) : panel === 'time' ? (
        <Section title="Change time"><ChangeTime session={session} tz={tz} hasSeries={hasSeries} onDone={() => { onChanged(); onClose() }} /></Section>
      ) : panel === 'reassign' ? (
        <Section title="Reassign to another tutor"><Reassign session={session} teachers={teachers} onDone={() => { onChanged(); onClose() }} /></Section>
      ) : panel === 'link' ? (
        <Section title="Meeting link"><LinkForm session={session} onDone={() => { setPanel(null); onChanged(); onClose() }} /></Section>
      ) : (
        <div className="flex flex-wrap gap-2">
          {session.status !== 'cancelled' && started && <Button variant="primary" onClick={() => setPanel('attendance')}>Mark attendance</Button>}
          {session.status !== 'cancelled' && !started && <p className="text-xs text-ink-soft w-full">Attendance opens when the class starts.</p>}
          {canEdit && upcoming && <Button onClick={() => setPanel('time')}>Change time</Button>}
          {canEdit && upcoming && canCoordinate && <Button onClick={() => setPanel('reassign')}>Reassign tutor</Button>}
          {canEdit && upcoming && <Button variant="danger" loading={busy} onClick={() => void cancel()}>Cancel class</Button>}
        </div>
      )}

      {!!changes.data?.length && (
        <Section title="Change history">
          <ul className="text-sm space-y-2">{changes.data.map((c: Row) => <li key={c.id}><b>{fmtDateTime(c.old_start, tz)}</b> → <b>{fmtDateTime(c.new_start, tz)}</b><div className="text-xs text-ink-soft">{c.reason} · {fmtDate(c.created_at)}</div></li>)}</ul>
        </Section>
      )}
      {changes.loading && <Spinner />}
    </Drawer>
  )
}

function ChangeTime({ session, tz, hasSeries, onDone }: { session: Row; tz: string; hasSeries: boolean; onDone: () => void }) {
  const cur = inTz(session.start_at, tz)
  const mins = Math.round((+new Date(session.end_at) - +new Date(session.start_at)) / 60000)
  const [date, setDate] = useState(cur.date)
  const [time, setTime] = useState(cur.time)
  const [dur, setDur] = useState(String(mins))
  const [scope, setScope] = useState<'this' | 'future'>('this')
  const [reason, setReason] = useState('')
  const { busy, run } = useAction()
  const step = useSetting<number>('schedule.slot_step_minutes', 15)
  const start = zonedToUtc(date, time, tz)
  const valid = reason.trim() && Number(dur) > 0
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3"><Field label="New date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="New start time"><Input type="time" step={step * 60} value={time} onChange={(e) => setTime(e.target.value)} /></Field></div>
      <Field label="Length (minutes)"><Input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} /></Field>
      <Field label="Apply to">
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'this' | 'future')}><option value="this">Only this class</option><option value="future" disabled={!hasSeries}>This and all future classes in the plan{hasSeries ? '' : ' (not a repeating plan)'}</option></Select>
      </Field>
      <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="text-xs text-ink-soft">The old time, new time, reason and who changed it are kept in the class history. Clashes are checked for the tutor and every learner.</p>
      <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void run(async () => { await rpc('reschedule_session', { p_session: session.id, p_new_start: start.toISOString(), p_new_end: new Date(+start + Number(dur) * 60000).toISOString(), p_scope: scope, p_reason: reason }); onDone() }, 'Class time changed')}>Save new time</Button>
    </div>
  )
}

function Reassign({ session, teachers, onDone }: { session: Row; teachers: Row[]; onDone: () => void }) {
  const [t, setT] = useState('')
  const { busy, run } = useAction()
  return (
    <div className="space-y-3">
      <Field label="New tutor" hint="Used for illness or leave. The tutor must teach the language and be free at this time."><Select value={t} onChange={(e) => setT(e.target.value)}><option value="">Choose…</option>{teachers.filter((x) => x.id !== session.teacher_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      <Button variant="primary" disabled={!t} loading={busy} onClick={() => void run(async () => { await rpc('reassign_session', { p_session: session.id, p_teacher: t }); onDone() }, 'Class reassigned')}>Reassign class</Button>
    </div>
  )
}

function LinkForm({ session, onDone }: { session: Row; onDone: () => void }) {
  const [link, setLink] = useState(session.meeting_link ?? '')
  const [all, setAll] = useState(false)
  const { busy, run } = useAction()
  const ok = /^https?:\/\/\S+$/i.test(link.trim())
  return (
    <div className="space-y-3">
      <Field label="Zoom / Google Meet link" error={link && !ok ? 'Enter a full link starting with https://' : null}><Input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/…" /></Field>
      <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={all} onChange={(e) => setAll(e.target.checked)} /> <Repeat size={14} /> Use this link for all my upcoming classes with these learners</label>
      <p className="text-xs text-ink-soft">Mitrin stores the link only. It is not created or checked automatically.</p>
      <Button variant="primary" disabled={!ok} loading={busy} onClick={() => void run(async () => { await rpc('set_meeting_link', { p_session: session.id, p_link: link.trim(), p_all_upcoming: all }); onDone() }, 'Meeting link saved')}><Link2 size={15} /> Save link</Button>
    </div>
  )
}

/* ------------------------------------------------------------------ new class */
export function NewClassModal({ teacherId, teachers, defaultTz, preselect, onClose, onDone }: { teacherId?: string; teachers: Row[]; defaultTz: string; preselect?: string[]; onClose: () => void; onDone: () => void }) {
  const [teacher, setTeacher] = useState(teacherId ?? '')
  const [pick, setPick] = useState<string[]>(preselect ?? [])
  const [tz, setTz] = useState(defaultTz)
  const [date, setDate] = useState(todayIn(defaultTz))
  const [time, setTime] = useState('17:00')
  const [mins, setMins] = useState('60')
  const [link, setLink] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [days, setDays] = useState<number[]>([])
  const [weeks, setWeeks] = useState('4')
  const [result, setResult] = useState<Row | null>(null)
  const maxWeeks = useSetting<number>('schedule.max_series_weeks', 26)
  const step = useSetting<number>('schedule.slot_step_minutes', 15)
  const { busy, run } = useAction()

  const list = useAsync(async () => {
    if (!teacher) return []
    const [enr, bal] = await Promise.all([
      select('enrollments', 'id, status, assignment_status, students(full_name), languages(name)', (q) => q.eq('primary_teacher_id', teacher).eq('assignment_status', 'accepted').in('status', ['active', 'on_hold'])),
      select('enrollment_balances'),
    ])
    const b = new Map(bal.map((x) => [x.enrollment_id, x.remaining as number]))
    return enr.map((e): Row => ({ ...e, remaining: b.get(e.id) ?? 0 }))
  }, [teacher])

  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const start = zonedToUtc(date, time, tz)
  const end = new Date(+start + Number(mins) * 60000)
  const valid = teacher && pick.length > 0 && date && time && Number(mins) > 0 && (!repeat || days.length > 0)

  const save = () => run(async () => {
    if (repeat) {
      const r = await rpc<Row>('schedule_series', { p_teacher: teacher, p_enrollments: pick, p_first_start: start.toISOString(), p_minutes: Number(mins), p_weekdays: days, p_weeks: Number(weeks), p_tz: tz, p_link: link || null })
      if (r.created === 0) throw new Error(r.skipped?.[0]?.reason ?? 'No classes could be booked.')
      setResult(r)
    } else {
      await rpc('schedule_session', { p_teacher: teacher, p_enrollments: pick, p_start: start.toISOString(), p_end: end.toISOString(), p_link: link || null })
      onDone()
    }
  })

  if (result) {
    return (
      <Modal open onClose={() => { onDone() }} title="Classes booked" footer={<Button variant="primary" onClick={onDone}>Done</Button>}>
        <p className="text-sm"><b>{result.created}</b> class{result.created === 1 ? '' : 'es'} booked.</p>
        {result.stopped_for_credits && <Notice tone="yellow">Booking stopped because a learner ran out of class credits. Ask Mitrin to allocate more classes.</Notice>}
        {!!result.skipped?.length && <><p className="text-sm font-bold mt-3">Skipped dates</p><ul className="text-sm text-ink-soft list-disc pl-5">{(result.skipped as Row[]).map((s) => <li key={s.date}>{fmtDate(s.date, 'UTC')}: {s.reason}</li>)}</ul></>}
      </Modal>
    )
  }

  return (
    <Modal open wide onClose={onClose} title="Schedule a class" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={() => void save()}>{repeat ? 'Book repeating classes' : 'Book class'}</Button></>}>
      <div className="space-y-4">
        {!teacherId && <Field label="Tutor" required><Select value={teacher} onChange={(e) => { setTeacher(e.target.value); setPick([]); const t = teachers.find((x) => x.id === e.target.value); if (t) setTz(t.timezone) }}><option value="">Choose…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        <div>
          <p className="text-[13px] font-semibold mb-1.5">Learners <span className="text-red-600">*</span></p>
          {list.loading ? <Spinner /> : !teacher ? <p className="text-sm text-ink-soft">Choose a tutor first.</p> : !list.data?.length ? <Notice>No learners with an accepted assignment. Accept assignment requests first.</Notice> : (
            <div className="grid sm:grid-cols-2 gap-2">
              {list.data.map((e) => {
                const blocked = e.status === 'on_hold' || e.remaining < 1
                return (
                  <label key={e.id} className={cx('flex items-center gap-3 rounded-xl border p-3 min-h-12', blocked ? 'opacity-55 bg-sand cursor-not-allowed' : 'cursor-pointer', pick.includes(e.id) ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                    <input type="checkbox" className="accent-brand-500 h-4 w-4" disabled={blocked} checked={pick.includes(e.id)} onChange={() => toggle(e.id)} />
                    <span className="flex-1 min-w-0"><b className="block truncate">{e.students?.full_name}</b><span className="text-xs text-ink-soft">{(Array.isArray(e.languages) ? e.languages[0] : e.languages)?.name}</span></span>
                    {e.status === 'on_hold' ? <Badge tone="red">On hold - contact Mitrin</Badge> : <Badge tone={e.remaining < 1 ? 'red' : 'green'}>{e.remaining} left</Badge>}
                  </label>
                )
              })}
            </div>
          )}
          <p className="text-meta text-ink-soft mt-1.5">Each learner uses one class credit. A group class can include learners with different regular days.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Start time" required><Input type="time" step={step * 60} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Length (min)"><Input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-ink-soft -mt-2">Times in {tz} ({shortTz(tz, start)}). {Number(mins) > 0 && date && `Ends ${fmtTime(end, tz)}.`}</p>
        <Field label="Meeting link (optional)"><Input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://zoom.us/j/…" /></Field>
        <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> <Repeat size={14} /> Repeat weekly</label>
        {repeat && (
          <div className="rounded-xl bg-sand p-3 space-y-3">
            <div><p className="text-[13px] font-semibold mb-1.5">On these days</p><div className="flex flex-wrap gap-1.5">{WD3.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={cx('min-h-10 min-w-12 rounded-lg border px-2 text-sm font-semibold', days.includes(i) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-line')}>{d}</button>)}</div></div>
            <Field label={`For how many weeks (up to ${maxWeeks})`}><Input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /></Field>
            <p className="text-xs text-ink-soft">Classes are only booked while every learner has credits left. The plan stops automatically when a learner runs out.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
