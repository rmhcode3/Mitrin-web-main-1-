import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ExternalLink, MessageCircle } from 'lucide-react'
import { rpc, select, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { loadApprovedTeachers, noteField, waLink } from '../../lib/domain'
import { fmtDateTime, label } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { DemoScheduler } from '../../components/DemoScheduler'
import { Button, DataTable, Empty, ErrorBox, ExportMenu, Input, Modal, PageHeader, SearchBox, Select, Spinner, StatusBadge, Tabs, useConfirm } from '../../components/ui'

type Tab = 'awaiting' | 'upcoming' | 'rescheduled' | 'completed' | 'enrolled' | 'dropped' | 'all'

export default function Demos() {
  const { can } = useAuth()
  const nav = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
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
      const g = { awaiting: d.status === 'awaiting_tutor', upcoming: d.status === 'accepted', rescheduled: d.status === 'rescheduled', completed: d.status === 'completed', enrolled: d.leads?.stage === 'converted', dropped: d.leads?.stage === 'lost', all: true }[tab]
      return g && (!tutor || d.teacher_id === tutor) && (!s || [d.learner_name, d.leads?.enquirer_name, d.leads?.phone].some((v) => String(v ?? '').toLowerCase().includes(s)))
    })
  }, [data, tab, q, tutor])

  const count = (f: (d: Row) => boolean) => data?.demos.filter(f).length ?? 0
  const stale = (d: Row) => d.status === 'awaiting_tutor' && Date.now() - +new Date(d.created_at) > followup * 3600_000

  const submitOutcome = () => run(async () => {
    await rpc('record_demo_outcome', { p_demo: outcomeFor!.d.id, p_status: outcomeFor!.status, p_outcome: note || null })
    setOutcomeFor(null); setNote(''); await reload()
  }, 'Demo outcome recorded')

  const enrol = (d: Row) => run(async () => {
    const lead = d.leads
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
    await reload(); toast.ok('Converted. Continue with the enrollment.')
    nav(`/admin/students?open=${r.enrollment_id}`)
  })

  const drop = async (d: Row) => {
    const c = await confirm({ title: 'Mark as dropped', body: <p>The enquiry moves to Lost and any pending demo is cancelled. You can restore it later from Leads.</p>, reason: 'Why did this lead drop?', danger: true, confirmText: 'Mark dropped' })
    if (c.ok) await run(async () => { await rpc('close_leads', { p_ids: [d.leads.id], p_reason: c.reason }); await reload() }, 'Marked as dropped')
  }

  const actionsFor = (d: Row) => {
    const open = !['converted', 'lost'].includes(d.leads?.stage)
    return [
      { v: 'resched', l: 'Reschedule', ok: open && ['awaiting_tutor', 'accepted', 'declined'].includes(d.status), go: () => setResched(d) },
      { v: 'completed', l: 'Completed', ok: d.status === 'accepted', go: () => setOutcomeFor({ d, status: 'completed' }) },
      { v: 'enrolled', l: 'Enrolled', ok: open && ['accepted', 'completed'].includes(d.status), go: () => void enrol(d) },
      { v: 'dropped', l: 'Dropped', ok: open, go: () => void drop(d) },
      { v: 'cancel', l: 'Cancel', ok: ['awaiting_tutor', 'accepted'].includes(d.status), go: () => setOutcomeFor({ d, status: 'cancelled' }) },
    ]
  }

  return (
    <>
      <PageHeader title="Demos & trial classes" subtitle="A demo is confirmed only after the tutor accepts. Demos reserve calendar time but never use a class credit or create a payout."
        actions={<ExportMenu name="demos" rows={rows} cols={[
          { header: 'Learner', value: (d: Row) => d.learner_name }, { header: 'Tutor', value: (d: Row) => tName(d.teacher_id) }, { header: 'Start', value: (d: Row) => d.start_at }, { header: 'Attempt', value: (d: Row) => d.attempt },
          { header: 'Status', value: (d: Row) => label[d.status] }, { header: 'Outcome', value: (d: Row) => d.outcome }, { header: 'Decline reason', value: (d: Row) => d.decline_reason }]} />} />
      <div className="mb-4">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: 'awaiting', label: 'Awaiting tutor', count: count((d) => d.status === 'awaiting_tutor') }, { id: 'upcoming', label: 'Accepted', count: count((d) => d.status === 'accepted') },
          { id: 'rescheduled', label: 'Rescheduled', count: count((d) => d.status === 'rescheduled') },
          { id: 'completed', label: 'Completed', count: count((d) => d.status === 'completed') },
          { id: 'enrolled', label: 'Enrolled', count: count((d) => d.leads?.stage === 'converted') },
          { id: 'dropped', label: 'Dropped', count: count((d) => d.leads?.stage === 'lost') }, { id: 'all', label: 'All' }]} />
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
            { h: 'Status', cell: (d) => <div><span className="inline-flex items-center gap-2"><StatusBadge status={d.status} text={label[d.status]} />{stale(d) && <span title={`No reply for over ${followup} hours`} className="text-amber-600"><AlertTriangle size={15} /></span>}</span>{(d.decline_reason || d.outcome) && <div className="text-xs text-ink-soft mt-1">{d.decline_reason ? `Declined: ${d.decline_reason}` : d.outcome}</div>}</div> },
            { h: 'Meeting Link', cell: (d) => d.meeting_link ? <a href={d.meeting_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 underline" aria-label="Open meeting link">Open link <ExternalLink size={13} /></a> : <span className="text-xs text-ink-soft">—</span> },
            {
              h: 'Actions', cell: (d) => { const o = canWrite ? actionsFor(d) : []; return o.some((x) => x.ok) ? (
                <Select aria-label={`Actions for ${d.learner_name}`} className="w-40" value="" onChange={(e) => { o.find((x) => x.v === e.target.value && x.ok)?.go() }}>
                  <option value="">Actions…</option>{o.map((x) => <option key={x.v} value={x.v} disabled={!x.ok}>{x.l}</option>)}
                </Select>) : null },
            },
            {
              h: 'WhatsApp', cell: (d) => {
                const base = waLink(d.leads?.phone)
                if (!canWrite || !base) return <span className="text-xs text-ink-soft">—</span>
                const text = `Hello ${d.leads?.enquirer_name ?? d.learner_name}, your ${d.leads?.languages?.name ?? ''} demo class is on ${fmtDateTime(d.start_at, 'Asia/Kolkata')} (IST) with ${tName(d.teacher_id)}.${d.meeting_link ? ` Join here: ${d.meeting_link}` : ''}`
                return <a href={`${base}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg border border-line bg-white text-sm font-semibold text-emerald-700 hover:bg-emerald-50"><MessageCircle size={15} /> Send via WhatsApp</a>
              },
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
