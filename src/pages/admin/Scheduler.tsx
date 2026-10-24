import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { select } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { loadApprovedTeachers } from '../../lib/domain'
import { TIMEZONES, addDays, browserTz, fmtDateTime, label, shortTz, todayIn, zonedToUtc } from '../../lib/format'
import { Calendar, CalendarToolbar, NewClassModal, SESSION_SELECT, SessionPanel, rangeFor, sessionEvent, type CalEvent, type CalView } from '../../components/scheduling'
import { Badge, Button, Drawer, ErrorBox, KV, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui'

export default function Scheduler() {
  const { can } = useAuth()
  const coord = can('coordinator')
  const [tz, setTz] = useState(browserTz())
  const [view, setView] = useState<CalView>('week')
  const [anchor, setAnchor] = useState(todayIn(tz))
  const [tutor, setTutor] = useState('')
  const [status, setStatus] = useState('')
  const [showDemos, setShowDemos] = useState(true)
  const [open, setOpen] = useState<CalEvent | null>(null)
  const [creating, setCreating] = useState(false)

  const [a, b] = rangeFor(view, anchor)
  const lo = zonedToUtc(a, '00:00', tz).toISOString()
  const hi = zonedToUtc(addDays(b, 1), '00:00', tz).toISOString()

  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, demos, teachers] = await Promise.all([
      select('sessions', SESSION_SELECT, (q) => q.gte('start_at', lo).lt('start_at', hi).order('start_at')),
      select('demos', '*', (q) => q.gte('start_at', lo).lt('start_at', hi).in('status', ['awaiting_tutor', 'accepted', 'completed'])),
      loadApprovedTeachers(),
    ])
    return { sessions, demos, teachers }
  }, [lo, hi])

  const events = useMemo<CalEvent[]>(() => {
    if (!data) return []
    const tn = (id: string) => data.teachers.find((t) => t.id === id)?.name
    const s = data.sessions.filter((x) => (!tutor || x.teacher_id === tutor) && (!status || x.status === status)).map((x) => sessionEvent(x, tn(x.teacher_id)))
    const d = showDemos && !status ? data.demos.filter((x) => !tutor || x.teacher_id === tutor).map<CalEvent>((x) => ({ id: x.id, start: x.start_at, end: x.end_at, title: `Demo: ${x.learner_name}`, sub: tn(x.teacher_id), tone: x.status === 'accepted' ? 'purple' : 'yellow', kind: 'demo', raw: x })) : []
    return [...s, ...d]
  }, [data, tutor, status, showDemos])

  const sess = open?.kind === 'session' ? data?.sessions.find((x) => x.id === open.id) : undefined
  const demo = open?.kind === 'demo' ? open.raw : undefined

  return (
    <>
      <PageHeader title="Lesson scheduler" subtitle="Monitor every class and demo. Overlapping classes for a tutor or learner are blocked, and classes are only booked against available credits."
        actions={<>
          <Select aria-label="Time zone" className="w-44" value={tz} onChange={(e) => { setTz(e.target.value); setAnchor(todayIn(e.target.value)) }}>{[...new Set([browserTz(), ...TIMEZONES])].map((z) => <option key={z} value={z}>{z} ({shortTz(z)})</option>)}</Select>
          {coord && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Schedule class</Button>}
        </>} />
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Select aria-label="Tutor" className="w-52" value={tutor} onChange={(e) => setTutor(e.target.value)}><option value="">All tutors</option>{data?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select aria-label="Status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select>
        <label className="inline-flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={showDemos} onChange={(e) => setShowDemos(e.target.checked)} /> Show demos</label>
        <div className="ml-auto flex gap-3 text-xs text-ink-soft"><span><Badge tone="blue">Scheduled</Badge></span><span><Badge tone="green">Completed</Badge></span><span><Badge tone="red">Cancelled</Badge></span><span><Badge tone="purple">Demo</Badge></span></div>
      </div>
      <CalendarToolbar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} tz={tz} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : <Calendar view={view} anchor={anchor} events={events} tz={tz} onOpen={setOpen} onDay={(d) => { setAnchor(d); setView('day') }} />}

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
