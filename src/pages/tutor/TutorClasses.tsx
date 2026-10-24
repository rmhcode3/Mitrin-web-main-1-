import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarOff, Plus } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { addDays, shortTz, todayIn, zonedToUtc } from '../../lib/format'
import { Calendar, CalendarToolbar, NewClassModal, SESSION_SELECT, SessionPanel, rangeFor, sessionEvent, type CalEvent, type CalView } from '../../components/scheduling'
import { Button, ErrorBox, PageHeader, Spinner } from '../../components/ui'
import { useTutorTz } from '../../lib/tutor'

export default function TutorClasses() {
  const { profile } = useAuth()
  const tz = useTutorTz()
  const [view, setView] = useState<CalView>(() => (window.innerWidth < 768 ? 'day' : 'week'))
  const [anchor, setAnchor] = useState(todayIn(tz))
  const [open, setOpen] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)
  const [a, b] = rangeFor(view, anchor)
  const lo = zonedToUtc(a, '00:00', tz).toISOString()
  const hi = zonedToUtc(addDays(b, 1), '00:00', tz).toISOString()

  const { data, loading, error, reload } = useAsync(async () => ({
    sessions: await select('sessions', SESSION_SELECT, (q) => q.gte('start_at', lo).lt('start_at', hi).order('start_at')),
    demos: await select('demos', '*', (q) => q.gte('start_at', lo).lt('start_at', hi).in('status', ['awaiting_tutor', 'accepted'])),
  }), [lo, hi])

  const events = useMemo<CalEvent[]>(() => [
    ...(data?.sessions ?? []).map((s) => sessionEvent(s)),
    ...(data?.demos ?? []).map<CalEvent>((d) => ({ id: d.id, start: d.start_at, end: d.end_at, title: `Demo: ${d.learner_name}`, tone: d.status === 'accepted' ? 'purple' : 'yellow', kind: 'demo', raw: d, sub: d.status === 'accepted' ? 'Accepted' : 'Awaiting your reply' })),
  ], [data])
  const sess = open && data?.sessions.find((s) => s.id === open.id)

  return (
    <>
      <PageHeader title="My classes" subtitle={`All times in your time zone (${tz}, ${shortTz(tz)}). Tap a class to join, mark attendance or change its time.`}
        actions={<><Link to="/tutor/availability"><Button><CalendarOff size={16} /> Availability & leave</Button></Link><Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Schedule class</Button></>} />
      <CalendarToolbar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} tz={tz} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : (
        <Calendar view={view} anchor={anchor} events={events} tz={tz} onDay={(d) => { setAnchor(d); setView('day') }}
          onOpen={(e) => { if (e.kind === 'session') setOpen(e.raw) }} />
      )}
      {sess && <SessionPanel session={sess} teachers={[]} tz={tz} admin={false} canCoordinate={false} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
      {creating && <NewClassModal teacherId={profile!.id} teachers={[]} defaultTz={tz} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void reload() }} />}
    </>
  )
}
