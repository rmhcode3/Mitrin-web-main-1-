import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ExternalLink } from 'lucide-react'
import { rpc, select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { loadApprovedTeachers } from '../../lib/domain'
import { fmtDateTime, label } from '../../lib/format'
import { DemoScheduler } from '../../components/DemoScheduler'
import { Button, DataTable, Empty, ErrorBox, ExportMenu, Input, Modal, PageHeader, SearchBox, Select, Spinner, StatusBadge, Tabs } from '../../components/ui'

type Tab = 'awaiting' | 'upcoming' | 'done' | 'closed' | 'all'

export default function Demos() {
  const { can } = useAuth()
  const canWrite = can('coordinator')
  const followup = useSetting<number>('demo.followup_hours', 24)
  const [tab, setTab] = useState<Tab>('awaiting')
  const [q, setQ] = useState('')
  const [tutor, setTutor] = useState('')
  const [resched, setResched] = useState<Row | null>(null)
  const [outcomeFor, setOutcomeFor] = useState<{ d: Row; status: string } | null>(null)
  const [note, setNote] = useState('')
  const { busy, run } = useAction()

  const { data, loading, error, reload } = useAsync(async () => {
    const [demos, teachers] = await Promise.all([select('demos', '*, leads(*, languages(name))', (x) => x.order('start_at', { ascending: false })), loadApprovedTeachers()])
    return { demos, teachers }
  })

  const tName = (id: string) => data?.teachers.find((t) => t.id === id)?.name ?? 'Tutor'
  const rows = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.demos.filter((d) => {
      const g = { awaiting: d.status === 'awaiting_tutor', upcoming: d.status === 'accepted', done: ['completed', 'tutor_no_show', 'student_no_show'].includes(d.status), closed: ['declined', 'cancelled', 'rescheduled'].includes(d.status), all: true }[tab]
      return g && (!tutor || d.teacher_id === tutor) && (!s || [d.learner_name, d.leads?.enquirer_name, d.leads?.phone].some((v) => String(v ?? '').toLowerCase().includes(s)))
    })
  }, [data, tab, q, tutor])

  const count = (f: (d: Row) => boolean) => data?.demos.filter(f).length ?? 0
  const stale = (d: Row) => d.status === 'awaiting_tutor' && Date.now() - +new Date(d.created_at) > followup * 3600_000

  const submitOutcome = () => run(async () => {
    await rpc('record_demo_outcome', { p_demo: outcomeFor!.d.id, p_status: outcomeFor!.status, p_outcome: note || null })
    setOutcomeFor(null); setNote(''); await reload()
  }, 'Demo outcome recorded')

  return (
    <>
      <PageHeader title="Demos & trial classes" subtitle="A demo is confirmed only after the tutor accepts. Demos reserve calendar time but never use a class credit or create a payout."
        actions={<ExportMenu name="demos" rows={rows} cols={[
          { header: 'Learner', value: (d: Row) => d.learner_name }, { header: 'Tutor', value: (d: Row) => tName(d.teacher_id) }, { header: 'Start', value: (d: Row) => d.start_at }, { header: 'Attempt', value: (d: Row) => d.attempt },
          { header: 'Status', value: (d: Row) => label[d.status] }, { header: 'Outcome', value: (d: Row) => d.outcome }, { header: 'Decline reason', value: (d: Row) => d.decline_reason }]} />} />
      <div className="mb-4">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: 'awaiting', label: 'Awaiting tutor', count: count((d) => d.status === 'awaiting_tutor') }, { id: 'upcoming', label: 'Accepted', count: count((d) => d.status === 'accepted') },
          { id: 'done', label: 'Held / missed', count: count((d) => ['completed', 'tutor_no_show', 'student_no_show'].includes(d.status)) },
          { id: 'closed', label: 'Declined / cancelled', count: count((d) => ['declined', 'cancelled', 'rescheduled'].includes(d.status)) }, { id: 'all', label: 'All' }]} />
      </div>
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search learner, enquirer or phone…" />
        <Select aria-label="Tutor" className="w-52" value={tutor} onChange={(e) => setTutor(e.target.value)}><option value="">All tutors</option>{data?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </div>

      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <DataTable rows={rows} rowKey={(d) => d.id} empty={<Empty title="No demos here" hint="Schedule demos from the Leads pipeline." />}
          columns={[
            { h: 'Learner', primary: true, cell: (d) => <div><b>{d.learner_name}</b><div className="text-xs text-ink-soft">{d.leads?.languages?.name} · attempt {d.attempt}</div></div> },
            { h: 'Tutor', cell: (d) => tName(d.teacher_id) },
            { h: 'When', cell: (d) => fmtDateTime(d.start_at) },
            { h: 'Status', cell: (d) => <span className="inline-flex items-center gap-2"><StatusBadge status={d.status} text={label[d.status]} />{stale(d) && <span title={`No reply for over ${followup} hours`} className="text-amber-600"><AlertTriangle size={15} /></span>}</span> },
            { h: 'Details', cell: (d) => <span className="text-xs text-ink-soft">{d.decline_reason ? `Declined: ${d.decline_reason}` : d.outcome ?? ''}{d.meeting_link && <a href={d.meeting_link} target="_blank" rel="noreferrer" className="ml-2 inline-flex text-brand-700" aria-label="Open meeting link"><ExternalLink size={13} /></a>}</span> },
            {
              h: 'Actions', cell: (d) => canWrite ? (
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {['awaiting_tutor', 'accepted', 'declined'].includes(d.status) && !['converted', 'lost'].includes(d.leads?.stage) && <Button size="sm" onClick={() => setResched(d)}><CalendarDays size={13} /> {d.status === 'declined' ? 'Reassign' : 'Reschedule'}</Button>}
                  {d.status === 'accepted' && <><Button size="sm" variant="primary" onClick={() => setOutcomeFor({ d, status: 'completed' })}>Held</Button><Button size="sm" onClick={() => setOutcomeFor({ d, status: 'student_no_show' })}>No-show</Button></>}
                  {['awaiting_tutor', 'accepted'].includes(d.status) && <Button size="sm" onClick={() => setOutcomeFor({ d, status: 'cancelled' })}>Cancel</Button>}
                </div>) : null,
            },
          ]} />
      )}

      <Modal open={!!resched} onClose={() => setResched(null)} wide title={`Reschedule demo for ${resched?.learner_name ?? ''}`}>
        {resched && data && <DemoScheduler lead={resched.leads} replaces={resched.id} teachers={data.teachers} onDone={() => { setResched(null); void reload() }} />}
      </Modal>
      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title={`Record: ${outcomeFor ? label[outcomeFor.status] : ''}`}
        footer={<><Button onClick={() => setOutcomeFor(null)}>Back</Button><Button variant="primary" loading={busy} onClick={() => void submitOutcome()}>Save outcome</Button></>}>
        <Input aria-label="Outcome note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): learner interested, wants a different time…" />
        {outcomeFor?.d.status === 'accepted' && outcomeFor.status !== 'cancelled' && <p className="text-xs text-ink-soft mt-3">A completed demo moves the enquiry to “Demo Completed”.</p>}
      </Modal>
    </>
  )
}
