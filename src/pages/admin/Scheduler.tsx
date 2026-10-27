import { useMemo, useState } from 'react'
import { CalendarDays, List, Plus } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { loadApprovedTeachers } from '../../lib/domain'
import { addDays, fmtDateTime, fmtTime, label, todayIn, zonedToUtc } from '../../lib/format'
import { Calendar, CalendarToolbar, NewClassModal, SESSION_SELECT, SessionPanel, names, rangeFor, sessionEvent, type CalEvent, type CalView } from '../../components/scheduling'
import { DateRangeFilter, useDateRange } from '../../components/DateRange'
import { Badge, Button, DataTable, Drawer, Empty, ErrorBox, KV, PageHeader, SearchBox, Select, Spinner, Stat, StatusBadge, cx } from '../../components/ui'

export default function Scheduler() {
  const { can } = useAuth()
  const coord = can('coordinator')
  const tz = 'Asia/Kolkata'
  const [mode, setMode] = useState<'table' | 'calendar'>('table')
  const [q, setQ] = useState('')
  const range = useDateRange()
  const [view, setView] = useState<CalView>('week')
  const [anchor, setAnchor] = useState(todayIn(tz))
  const [tutor, setTutor] = useState('')
  const [status, setStatus] = useState('')
  const [showDemos, setShowDemos] = useState(true)
  const [open, setOpen] = useState<CalEvent | null>(null)
  const [creating, setCreating] = useState(false)

  const [a, b] = rangeFor(view, anchor)
  const table = mode === 'table'
  const lo = table ? (range.from ? zonedToUtc(range.from, '00:00', tz).toISOString() : '') : zonedToUtc(a, '00:00', tz).toISOString()
  const hi = table ? (range.to ? zonedToUtc(addDays(range.to, 1), '00:00', tz).toISOString() : '') : zonedToUtc(addDays(b, 1), '00:00', tz).toISOString()

  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, demos, teachers] = await Promise.all([
      select('sessions', SESSION_SELECT, (x) => { let r = x; if (lo) r = r.gte('start_at', lo); if (hi) r = r.lt('start_at', hi); return r.order('start_at', { ascending: !table }).limit(table ? 500 : 2000) }),
      select('demos', '*', (x) => { let r = x; if (lo) r = r.gte('start_at', lo); if (hi) r = r.lt('start_at', hi); return r.in('status', ['awaiting_tutor', 'accepted', 'completed']).limit(500) }),
      loadApprovedTeachers(),
    ])
    return { sessions, demos, teachers }
  }, [lo, hi, table])

  const events = useMemo<CalEvent[]>(() => {
    if (!data) return []
    const tn = (id: string) => data.teachers.find((t) => t.id === id)?.name
    const s = data.sessions.filter((x) => (!tutor || x.teacher_id === tutor) && (!status || x.status === status)).map((x) => sessionEvent(x, tn(x.teacher_id)))
    const d = showDemos && !status ? data.demos.filter((x) => !tutor || x.teacher_id === tutor).map<CalEvent>((x) => ({ id: x.id, start: x.start_at, end: x.end_at, title: `Demo: ${x.learner_name}`, sub: tn(x.teacher_id), tone: x.status === 'accepted' ? 'purple' : 'yellow', kind: 'demo', raw: x })) : []
    return [...s, ...d]
  }, [data, tutor, status, showDemos])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return events.map((e) => {
      const raw = e.raw, isS = e.kind === 'session'
      return {
        e, status: raw.status as string, link: raw.meeting_link as string | null, tutor: e.sub ?? '—',
        student: isS ? names(raw).join(', ') || 'Class' : String(raw.learner_name ?? 'Demo'),
        course: isS ? [...new Set((raw.session_participants as Row[]).map((p) => p.enrollments?.languages?.name).filter(Boolean))].join(', ') : 'Demo class',
      }
    }).filter((r) => !s || [r.student, r.course, r.tutor].some((v) => v.toLowerCase().includes(s)))
  }, [events, q])
  const count = (st: string) => data?.sessions.filter((x) => (!tutor || x.teacher_id === tutor) && x.status === st).length ?? 0

  const sess = open?.kind === 'session' ? data?.sessions.find((x) => x.id === open.id) : undefined
  const demo = open?.kind === 'demo' ? open.raw : undefined

  return (
    <>
      <PageHeader title="Lesson scheduler" subtitle="Monitor every class and demo. Overlapping classes for a tutor or learner are blocked, and classes are only booked against available credits."
        actions={<>
          <div className="inline-flex rounded-xl border border-line bg-white p-1">
            {([["table", "List", List], ["calendar", "Calendar", CalendarDays]] as const).map(([v, l, I]) => (
              <button key={v} onClick={() => setMode(v)} aria-pressed={mode === v} className={cx("min-h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5", mode === v ? "bg-navy text-white" : "text-ink-soft")}><I size={15} /><span className="hidden sm:inline">{l}</span></button>
            ))}
          </div>
          {coord && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Schedule class</Button>}
        </>} />
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {table && <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search by student, tutor or language…" />}
        <Select aria-label="Tutor" className="w-52" value={tutor} onChange={(e) => setTutor(e.target.value)}><option value="">All tutors</option>{data?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select aria-label="Status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select>
        <label className="inline-flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={showDemos} onChange={(e) => setShowDemos(e.target.checked)} /> Show demos</label>
        {!table && <div className="ml-auto flex gap-3 text-xs text-ink-soft"><span><Badge tone="blue">Scheduled</Badge></span><span><Badge tone="green">Completed</Badge></span><span><Badge tone="red">Cancelled</Badge></span><span><Badge tone="purple">Demo</Badge></span></div>}
      </div>
      {table && <div className="mb-4"><DateRangeFilter range={range} /></div>}
      {table ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Scheduled" value={count('scheduled')} tone="gray" /><Stat label="Completed" value={count('completed')} tone="green" />
            <Stat label="Cancelled" value={count('cancelled')} tone="red" /><Stat label="Demos" value={showDemos ? data?.demos.filter((x) => !tutor || x.teacher_id === tutor).length ?? 0 : 0} tone="orange" />
          </div>
          {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : (
            <DataTable grid rows={rows} rowKey={(r) => `${r.e.kind}-${r.e.id}`} onRowClick={(r) => setOpen(r.e)} empty={<Empty title="No classes match" hint="Adjust the filters or the date range." />}
              columns={[
                { h: 'Student & course', primary: true, cell: (r) => <div><b>{r.student}</b><div className="text-xs text-ink-soft">{r.course}</div></div> },
                { h: 'Tutor', cell: (r) => r.tutor },
                { h: 'Date & time', cell: (r) => <span>{fmtDateTime(r.e.start, tz)} – {fmtTime(r.e.end, tz)}</span> },
                { h: 'Meeting link', cell: (r) => r.link ? <a href={r.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-xs text-brand-700 underline">Open link</a> : <span className="text-xs text-ink-soft">—</span> },
                { h: 'Status', cell: (r) => <span className="inline-flex items-center gap-1.5"><StatusBadge status={r.status} text={label[r.status] ?? r.status} />{r.e.kind === 'demo' && <Badge tone="purple">Demo</Badge>}</span> },
                { h: 'Actions', cell: (r) => <Button size="sm" onClick={(ev) => { ev.stopPropagation(); setOpen(r.e) }}>Details</Button> },
              ]} />
          )}
          {rows.length >= 500 && <p className="text-xs text-ink-soft mt-2">Showing the latest 500. Narrow the date range to see older classes.</p>}
        </>
      ) : (
        <>
          <CalendarToolbar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} tz={tz} />
          {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : <Calendar view={view} anchor={anchor} events={events} tz={tz} onOpen={setOpen} onDay={(d) => { setAnchor(d); setView('day') }} />}
        </>
      )}

      {sess && data && <SessionPanel session={sess} teachers={data.teachers} tz={tz} admin canCoordinate={coord} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
      {demo && data && (
        <Drawer open onClose={() => setOpen(null)} badge={<StatusBadge status={demo.status} text={label[demo.status]} />} title={`Demo: ${demo.learner_name}`} subtitle={fmtDateTime(demo.start_at, tz)}>
          <dl className="grid grid-cols-2 gap-4"><KV k="Tutor" v={data.teachers.find((t) => t.id === demo.teacher_id)?.name} /><KV k="Attempt" v={demo.attempt} /><KV k="Level" v={demo.level} /><KV k="Meeting link" v={demo.meeting_link} /></dl>
          <p className="text-sm text-ink-soft">Manage demos from Demos & trials. Demos use no class credit and create no payout.</p>
        </Drawer>
      )}
      {creating && data && <NewClassModal teachers={data.teachers} defaultTz={tz} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void reload() }} />}
    </>
  )
}
