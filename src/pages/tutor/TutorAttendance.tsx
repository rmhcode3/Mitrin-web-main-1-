import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { fmtDateTime, label } from '../../lib/format'
import { AttendanceMarker, SESSION_SELECT, names } from '../../components/scheduling'
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Tabs, StatusBadge, cx } from '../../components/ui'
import { useTutorTz } from '../../lib/tutor'

type Tab = 'todo' | 'recent'

export default function TutorAttendance() {
  const tz = useTutorTz()
  const [tab, setTab] = useState<Tab>('todo')
  const [sel, setSel] = useState<string | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const now = new Date()
    const [todo, recent] = await Promise.all([
      select('sessions', SESSION_SELECT, (q) => q.eq('status', 'scheduled').lte('start_at', now.toISOString()).order('start_at')),
      select('sessions', SESSION_SELECT, (q) => q.eq('status', 'completed').gte('start_at', new Date(+now - 14 * 86400000).toISOString()).order('start_at', { ascending: false })),
    ])
    return { todo, recent }
  })

  const list: Row[] = (tab === 'todo' ? data?.todo : data?.recent) ?? []
  const current = list.find((s) => s.id === sel) ?? list[0]

  return (
    <>
      <PageHeader title="Mark attendance" subtitle="Mark each learner Present or Absent. Unmarked is not the same as absent. Use Save & Next to catch up at the end of the day." />
      <div className="mb-4"><Tabs<Tab> value={tab} onChange={(t) => { setTab(t); setSel(null) }} tabs={[{ id: 'todo', label: 'To update', count: data?.todo.length }, { id: 'recent', label: 'Recently marked (edit)' }]} /></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : !list.length ? (
        <Card><Empty title={tab === 'todo' ? 'All caught up' : 'Nothing marked in the last 14 days'} hint={tab === 'todo' ? 'Classes that have started and are not marked yet appear here.' : undefined} /></Card>
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-5">
          <div className="space-y-2 lg:max-h-[70vh] overflow-y-auto scroll-thin">
            {list.map((s) => (
              <button key={s.id} onClick={() => setSel(s.id)} className={cx('w-full text-left rounded-xl border p-3 min-h-16', current?.id === s.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-white')}>
                <p className="text-xs font-bold text-ink-soft">{fmtDateTime(s.start_at, tz)}</p><p className="font-bold truncate">{names(s).join(', ')}</p>
                <div className="mt-1">{s.status === 'completed' ? <Badge tone="green">Marked</Badge> : <Badge tone="yellow">Needs attendance</Badge>}</div>
              </button>
            ))}
          </div>
          {current && (
            <Card className="p-5 self-start" key={current.id}>
              <p className="text-sm font-bold text-brand-700">{fmtDateTime(current.start_at, tz)}</p>
              <h2 className="text-xl font-extrabold mb-4">{names(current).join(', ')}</h2>
              {current.status === 'completed' && <p className="text-sm text-ink-soft mb-3 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /> Already marked. You can correct it until Finance finalizes the month’s payout.</p>}
              <AttendanceMarker session={current} saveLabel={tab === 'todo' && list.length > 1 ? 'Save & next' : 'Save attendance'}
                onSaved={() => { const i = list.findIndex((s) => s.id === current.id); const nxt = tab === 'todo' ? list[i + 1]?.id ?? null : current.id; setSel(nxt); void reload() }} />
              <div className="mt-4 flex flex-wrap gap-2">{(current.session_participants as Row[]).map((p) => <StatusBadge key={p.enrollment_id} status={p.attendance} text={`${p.enrollments?.students?.full_name}: ${label[p.attendance]}`} />)}</div>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
