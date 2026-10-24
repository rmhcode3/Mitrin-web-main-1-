import { useState } from 'react'
import { Lock } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { fmtDate, fmtMonth, inr, todayIn } from '../../lib/format'
import { Badge, Card, DataTable, Empty, ErrorBox, ExportMenu, Input, Notice, PageHeader, Spinner, Stat } from '../../components/ui'
import { one } from '../../lib/tutor'

export default function TutorEarnings() {
  const [month, setMonth] = useState(todayIn('Asia/Kolkata').slice(0, 7))
  const { data, loading, error, reload } = useAsync(async () => {
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const items = await select('earning_items', '*, enrollments(students(full_name), languages(name))', (q) => q.gte('earned_on', `${month}-01`).lte('earned_on', last).order('earned_on', { ascending: false }))
    const payouts: Row[] | null = await select('payouts', '*', (q) => q.eq('period_month', `${month}-01`)).catch(() => null)
    return { items, payout: payouts?.[0] ?? null }
  }, [month])

  const items = data?.items ?? []
  const total = items.reduce((s, i) => s + Number(i.rate_snapshot ?? 0), 0)
  const unrated = items.filter((i) => i.rate_snapshot == null).length
  const status = data?.payout ? (data.payout.status === 'paid' ? 'Paid' : 'Finalized, payment coming') : 'In progress'
  const cols = [{ header: 'Date', value: (r: Row) => r.earned_on }, { header: 'Learner', value: (r: Row) => r.enrollments?.students?.full_name }, { header: 'Course', value: (r: Row) => one<Row>(r.enrollments?.languages)?.name }, { header: 'Amount (INR)', value: (r: Row) => r.rate_snapshot }]

  return (
    <>
      <PageHeader title="My earnings" subtitle="You earn for each learner who attended a class. A learner who was absent does not earn for that class. Makeups are paid in the month they are taught."
        actions={<><Input aria-label="Month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /><ExportMenu name={`my-earnings-${month}`} rows={items} cols={cols} /></>} />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-3"><Stat label={`${fmtMonth(month)} earnings`} value={inr(data.payout ? data.payout.total : total)} tone="green" sub={data.payout && Number(data.payout.adjustments_total) !== 0 ? `Includes adjustments ${inr(data.payout.adjustments_total)}` : undefined} /><Stat label="Attended learner-classes" value={items.length} /><Stat label="Payout status" value={status} tone={data.payout?.status === 'paid' ? 'green' : 'orange'} sub={data.payout?.paid_at ? `Paid ${fmtDate(data.payout.paid_at)}` : data.payout ? `Finalized ${fmtDate(data.payout.finalized_at)}` : undefined} /></div>
          {unrated > 0 && <Notice>{unrated} class{unrated === 1 ? ' is' : 'es are'} waiting for Mitrin to set your rate. They will be added once it is set.</Notice>}
          {data.payout && <Notice tone="gray"><Lock size={14} className="inline mr-1.5" />This month is finalized. Its attendance is locked and the amounts cannot change. Any correction appears as a separate adjustment.</Notice>}
          <DataTable rows={items} rowKey={(r) => r.id} empty={<Card><Empty title={`No attended classes in ${fmtMonth(month)}`} /></Card>}
            columns={[{ h: 'Date', primary: true, cell: (r) => <b>{fmtDate(r.earned_on)}</b> }, { h: 'Learner', cell: (r) => r.enrollments?.students?.full_name }, { h: 'Course', cell: (r) => one<Row>(r.enrollments?.languages)?.name }, { h: 'Amount', cell: (r) => (r.rate_snapshot == null ? <Badge tone="yellow">Rate pending</Badge> : <b>{inr(r.rate_snapshot)}</b>) }]} />
        </div>
      )}
    </>
  )
}
