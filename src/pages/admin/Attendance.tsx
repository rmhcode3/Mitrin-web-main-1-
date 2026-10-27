import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, XCircle, CalendarClock } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { loadApprovedTeachers } from '../../lib/domain'
import { addDays, browserTz, fmtDateTime, label, todayIn, zonedToUtc } from '../../lib/format'
import { SESSION_SELECT, SessionPanel, names } from '../../components/scheduling'
import { Button, DataTable, Empty, ErrorBox, ExportMenu, Field, Input, PageHeader, Spinner, Stat, StatusBadge, Tabs, Badge } from '../../components/ui'

type Tab = 'student' | 'teacher' | 'pending' | 'sessions'

export default function Attendance() {
  const { can } = useAuth()
  const tz = browserTz()
  const today = todayIn(tz)
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [tab, setTab] = useState<Tab>('student')
  const [open, setOpen] = useState<Row | null>(null)
  const lo = zonedToUtc(from, '00:00', tz).toISOString()
  const hi = zonedToUtc(addDays(to, 1), '00:00', tz).toISOString()

  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, teachers, changes] = await Promise.all([
      select('sessions', SESSION_SELECT, (q) => q.gte('start_at', lo).lt('start_at', hi).order('start_at', { ascending: false })),
      loadApprovedTeachers(),
      select('session_changes', 'id', (q) => q.gte('created_at', lo).lt('created_at', hi)),
    ])
    return { sessions, teachers, changes }
  }, [lo, hi])

  const tName = (id: string) => data?.teachers.find((t) => t.id === id)?.name ?? 'Tutor'
  const calc = useMemo(() => {
    const s = data?.sessions ?? []
    const stu = new Map<string, { name: string; lang: string; registered: number; present: number; absent: number; cancelled: number }>()
    const tea = new Map<string, { name: string; conducted: number; present: number; cancelled: number; pending: number }>()
    const nowMs = Date.now()
    for (const x of s) {
      const t = tea.get(x.teacher_id) ?? { name: tName(x.teacher_id), conducted: 0, present: 0, cancelled: 0, pending: 0 }
      if (x.status === 'completed') t.conducted++
      if (x.status === 'cancelled') t.cancelled++
      if (x.status === 'scheduled' && +new Date(x.end_at) < nowMs) t.pending++
      for (const p of x.session_participants as Row[]) {
        const e = p.enrollments; const key = p.enrollment_id
        const r = stu.get(key) ?? { name: e?.students?.full_name ?? '—', lang: e?.languages?.name ?? '', registered: 0, present: 0, absent: 0, cancelled: 0 }
        r.registered++
        if (x.status === 'cancelled') r.cancelled++
        else if (p.attendance === 'present') { r.present++; t.present++ }
        else if (p.attendance === 'absent') r.absent++
        stu.set(key, r)
      }
      tea.set(x.teacher_id, t)
    }
    return {
      stu: [...stu.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name)),
      tea: [...tea.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name)),
      pending: s.filter((x) => x.status === 'scheduled' && +new Date(x.end_at) < nowMs),
      conducted: s.filter((x) => x.status === 'completed').length, cancelled: s.filter((x) => x.status === 'cancelled').length,
      absent: s.flatMap((x) => x.session_participants as Row[]).filter((p) => p.attendance === 'absent').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  const rate = (r: { present: number; absent: number }) => (r.present + r.absent ? Math.round((r.present / (r.present + r.absent)) * 100) : null)

  return (
    <>
      <PageHeader title="Attendance & class tracking" subtitle="Monitor completed classes, absences, cancellations and unmarked sessions. Absent learners keep their class for a makeup." />
      <div className="rounded-2xl border border-line bg-white p-4 mb-5 flex flex-wrap items-end gap-4">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button onClick={() => void reload()}><RefreshCw size={15} /> Refresh</Button>
        <span className="ml-auto text-xs font-mono text-ink-soft">{data?.sessions.length ?? 0} sessions in range</span>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Conducted classes" value={calc.conducted} tone="green" icon={<CheckCircle2 size={20} />} />
            <Stat label="Absent learners" value={calc.absent} tone="red" icon={<XCircle size={20} />} sub="Class kept for makeup" />
            <Stat label="Rescheduled entries" value={data?.changes.length ?? 0} tone="orange" icon={<RefreshCw size={20} />} />
            <Stat label="Cancelled sessions" value={calc.cancelled} icon={<CalendarClock size={20} />} sub={`${calc.pending.length} awaiting attendance`} tone={calc.pending.length ? 'yellow' : 'gray'} />
          </div>
          <div className="mb-4"><Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'student', label: 'Summary by student' }, { id: 'teacher', label: 'Summary by teacher' }, { id: 'pending', label: 'Needs attendance', count: calc.pending.length }, { id: 'sessions', label: 'All sessions' }]} /></div>

          {tab === 'student' && <>
            <div className="flex justify-end mb-2"><ExportMenu name="attendance-by-student" rows={calc.stu} cols={[{ header: 'Student', value: (r) => r.name }, { header: 'Course', value: (r) => r.lang }, { header: 'Registered classes', value: (r) => r.registered }, { header: 'Attended', value: (r) => r.present }, { header: 'Absent', value: (r) => r.absent }, { header: 'Cancelled', value: (r) => r.cancelled }, { header: 'Attendance %', value: (r) => rate(r) ?? '' }]} /></div>
            <DataTable grid rows={calc.stu} rowKey={(r) => r.id} empty={<Empty title="No classes in this range" />} columns={[
              { h: 'Student', primary: true, cell: (r) => <div><b>{r.name}</b><div className="text-xs text-ink-soft">{r.lang}</div></div> }, { h: 'Registered', cell: (r) => r.registered }, { h: 'Attended', cell: (r) => <span className="text-emerald-700 font-semibold">{r.present}</span> },
              { h: 'Absent', cell: (r) => <span className={r.absent ? 'text-red-700 font-semibold' : ''}>{r.absent}</span> }, { h: 'Cancelled', cell: (r) => r.cancelled },
              { h: 'Attendance', cell: (r) => { const p = rate(r); return p === null ? '—' : <Badge tone={p >= 80 ? 'green' : p >= 60 ? 'yellow' : 'red'}>{p}%</Badge> } }]} /></>}

          {tab === 'teacher' && <>
            <div className="flex justify-end mb-2"><ExportMenu name="attendance-by-teacher" rows={calc.tea} cols={[{ header: 'Tutor', value: (r) => r.name }, { header: 'Classes conducted', value: (r) => r.conducted }, { header: 'Learners present', value: (r) => r.present }, { header: 'Cancelled', value: (r) => r.cancelled }, { header: 'Awaiting attendance', value: (r) => r.pending }]} /></div>
            <DataTable grid rows={calc.tea} rowKey={(r) => r.id} empty={<Empty title="No classes in this range" />} columns={[
              { h: 'Tutor', primary: true, cell: (r) => <b>{r.name}</b> }, { h: 'Conducted', cell: (r) => r.conducted }, { h: 'Learners present', cell: (r) => r.present }, { h: 'Cancelled', cell: (r) => r.cancelled },
              { h: 'Awaiting attendance', cell: (r) => (r.pending ? <Badge tone="yellow">{r.pending}</Badge> : '—') }]} /></>}

          {tab === 'pending' && (
            <DataTable grid rows={calc.pending} rowKey={(r) => r.id} onRowClick={setOpen} empty={<Empty title="Everything is marked" hint="Classes that have ended without attendance appear here." />} columns={[
              { h: 'Class', primary: true, cell: (r) => <b>{names(r).join(', ')}</b> }, { h: 'Tutor', cell: (r) => tName(r.teacher_id) }, { h: 'When', cell: (r) => fmtDateTime(r.start_at, tz) },
              { h: '', cell: () => <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertCircle size={14} /> Mark attendance</span> }]} />
          )}
          {tab === 'sessions' && (
            <>
              <div className="flex justify-end mb-2"><ExportMenu name="sessions" rows={data?.sessions ?? []} cols={[{ header: 'Date', value: (r: Row) => r.start_at }, { header: 'Tutor', value: (r: Row) => tName(r.teacher_id) }, { header: 'Learners', value: (r: Row) => names(r).join('; ') }, { header: 'Status', value: (r: Row) => label[r.status] }, { header: 'Present', value: (r: Row) => (r.session_participants as Row[]).filter((p) => p.attendance === 'present').length }, { header: 'Absent', value: (r: Row) => (r.session_participants as Row[]).filter((p) => p.attendance === 'absent').length }]} /></div>
              <DataTable grid rows={data?.sessions ?? []} rowKey={(r) => r.id} onRowClick={setOpen} empty={<Empty title="No sessions in this range" />} columns={[
                { h: 'Class', primary: true, cell: (r) => <b>{names(r).join(', ')}</b> }, { h: 'Tutor', cell: (r) => tName(r.teacher_id) }, { h: 'When', cell: (r) => fmtDateTime(r.start_at, tz) }, { h: 'Status', cell: (r) => <StatusBadge status={r.status} text={label[r.status]} /> }]} />
            </>
          )}
        </>
      )}
      {open && data && <SessionPanel editable session={open} teachers={data.teachers} tz={tz} admin canCoordinate={can('coordinator')} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </>
  )
}
