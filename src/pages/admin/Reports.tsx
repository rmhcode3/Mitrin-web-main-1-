import { useMemo, useState } from 'react'
import { select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync, useSetting } from '../../lib/hooks'
import { LEAD_STAGES, addDays, fmtDate, inr, label, mondayOf, stageLabel, todayIn } from '../../lib/format'
import type { Col } from '../../lib/export'
import { Badge, DataTable, Empty, ErrorBox, ExportMenu, Field, Input, PageHeader, SearchBox, Spinner, Tabs } from '../../components/ui'

type Tab = 'ledger' | 'tutors' | 'finance' | 'settlement' | 'admissions'
const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

function Report<T>({ rows, cols, name, empty }: { rows: T[]; cols: (Col<T> & { cell?: (r: T) => React.ReactNode })[]; name: string; empty: string }) {
  return (
    <>
      <div className="flex justify-between items-center mb-3"><p className="text-sm text-ink-soft">{rows.length} row{rows.length === 1 ? '' : 's'}</p><ExportMenu name={name} rows={rows} cols={cols} /></div>
      <DataTable grid rows={rows} rowKey={(_, i) => String(i)} empty={<Empty title={empty} />}
        columns={cols.map((c, i) => ({ h: c.header, primary: i === 0, cell: (r: T) => c.cell?.(r) ?? String(c.value(r) ?? '—') }))} />
    </>
  )
}

export default function Reports() {
  const { can } = useAuth()
  const agingDays = useSetting<number>('credits.pending_age_warning_days', 14)
  const today = todayIn('Asia/Kolkata')
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [q, setQ] = useState('')
  const coord = can('coordinator'), fin = can('finance')
  const tabs = [
    ...(coord || fin ? [{ id: 'ledger' as const, label: 'Student ledger' }] : []), ...(coord ? [{ id: 'tutors' as const, label: 'Tutor operations' }, { id: 'admissions' as const, label: 'Admissions' }] : []),
    ...(fin ? [{ id: 'finance' as const, label: 'Finance' }, { id: 'settlement' as const, label: 'Tutor settlement' }] : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'ledger')

  const { data, loading, error, reload } = useAsync(async () => {
    const lo = `${from}T00:00:00+05:30`, hi = `${addDays(to, 1)}T00:00:00+05:30`
    const needTeach = coord || fin
    const [enr, bal, mk, moves, tps, sess, leads, demos, items, fees, conf, payouts, tnames, leaves, adjs] = await Promise.all([
      needTeach ? select('enrollments', 'id, status, assignment_status, primary_teacher_id, students(full_name), languages(name)') : [],
      needTeach ? select('enrollment_balances') : [], needTeach ? select('enrollment_makeup') : [],
      needTeach ? select('credit_movements', 'enrollment_id, quantity, allocation_period') : [],
      coord ? select('teacher_profiles', 'user_id, approval_status, profiles!user_id(full_name)') : [],
      coord ? select('sessions', 'id, teacher_id, status, start_at, end_at', (x) => x.gte('start_at', lo).lt('start_at', hi)) : [],
      coord ? select('leads', '*, languages(name)', (x) => x.gte('created_at', lo).lt('created_at', hi)) : [],
      coord ? select('demos', 'id, lead_id, status, attempt, teacher_id', (x) => x.gte('created_at', lo).lt('created_at', hi)) : [],
      fin ? select('earning_items', '*, enrollments(students(full_name), languages(name))', (x) => x.gte('earned_on', from).lte('earned_on', to)) : [],
      fin ? select('fee_plan_summary') : [], coord ? select('availability_confirmations', '*', (x) => x.eq('week_start', addDays(mondayOf(today), 7))) : [],
      fin ? select('payouts', '*').catch(() => []) : [], fin ? select('profiles', 'id, full_name', (x) => x.eq('role', 'teacher')) : [],
      coord ? select('teacher_leaves', 'teacher_id, start_date, end_date, status', (x) => x.eq('status', 'approved').lte('start_date', to).gte('end_date', from)) : [],
      fin ? select('payout_adjustments', '*', (x) => x.gte('created_at', lo).lt('created_at', hi)).catch(() => []) : [],
    ])
    return { enr, bal, mk, moves, tps, sess, leads, demos, items, fees, conf, payouts, tnames, leaves, adjs }
  }, [from, to])

  const s = q.trim().toLowerCase()
  const d = data

  const ledger = useMemo(() => {
    if (!d) return []
    const b = new Map(d.bal.map((x) => [x.enrollment_id, x])); const m = new Map(d.mk.map((x) => [x.enrollment_id, x]))
    const periods = new Map<string, Map<string, number>>()
    for (const mv of d.moves) { const p = String(mv.allocation_period).slice(0, 7); const e = periods.get(mv.enrollment_id) ?? new Map(); e.set(p, (e.get(p) ?? 0) + mv.quantity); periods.set(mv.enrollment_id, e) }
    return d.enr.filter((e) => !s || String(e.students?.full_name).toLowerCase().includes(s)).map((e) => {
      const bb = b.get(e.id) ?? {}; const mm = m.get(e.id) ?? {}
      const makeup = Math.min(mm.missed ?? 0, bb.remaining ?? 0)
      const ageDays = mm.oldest_missed && makeup > 0 ? Math.floor((Date.now() - +new Date(mm.oldest_missed)) / 86400000) : null
      return { name: e.students?.full_name, course: one<Row>(e.languages)?.name, status: label[e.status], allocated: bb.allocated ?? 0, reserved: bb.reserved ?? 0, fulfilled: bb.fulfilled ?? 0, remaining: bb.remaining ?? 0, makeup, age: ageDays, periods: [...(periods.get(e.id) ?? new Map()).entries()].sort().map(([p, n]) => `${p}: ${n}`).join('; ') }
    })
  }, [d, s])

  const tutors = useMemo(() => d?.tps.filter((t) => t.approval_status === 'approved').map((t) => {
    const mine = d.sess.filter((x) => x.teacher_id === t.user_id)
    const days = d.leaves.filter((l) => l.teacher_id === t.user_id).reduce((a, l) => a + Math.max(1, Math.round((+new Date(l.end_date) - +new Date(l.start_date)) / 86400000) + 1), 0)
    return { name: one<Row>(t.profiles)?.full_name as string, students: d.enr.filter((e) => e.primary_teacher_id === t.user_id && e.assignment_status === 'accepted' && ['active', 'on_hold'].includes(e.status)).length, scheduled: mine.filter((x) => x.status === 'scheduled').length, completed: mine.filter((x) => x.status === 'completed').length, cancelled: mine.filter((x) => x.status === 'cancelled').length, overdue: mine.filter((x) => x.status === 'scheduled' && +new Date(x.end_at) < Date.now()).length, leave: days, awaiting: d.enr.filter((e) => e.primary_teacher_id === t.user_id && e.assignment_status === 'awaiting_tutor').length, confirmed: d.conf.some((c) => c.teacher_id === t.user_id) ? 'Yes' : 'No' }
  }).filter((r) => !s || r.name.toLowerCase().includes(s)) ?? [], [d, s])

  const finance = useMemo(() => d?.fees.map((f) => { const e = d.enr.find((x) => x.id === f.enrollment_id); return { name: e?.students?.full_name as string, course: one<Row>(e?.languages)?.name as string, total: Number(f.total_due), paid: Number(f.paid), outstanding: Math.max(0, Number(f.outstanding)), advance: Math.max(0, -Number(f.outstanding)), overdue: Number(f.overdue_amount), next: f.next_due as string | null, status: e?.status as string } }).filter((r) => !s || String(r.name).toLowerCase().includes(s)) ?? [], [d, s])

  const settlement = useMemo(() => {
    if (!d) return []
    const tn = (id: string) => d.tnames.find((t) => t.id === id)?.full_name as string
    const po = (id: string | null) => (id ? d.payouts.find((p: Row) => p.id === id) : undefined)
    const earned = d.items.map((i) => {
      const p = po(i.payout_id)
      return { tutor: tn(i.teacher_id), type: 'Earning', date: i.earned_on as string, learner: i.enrollments?.students?.full_name as string, course: one<Row>(i.enrollments?.languages)?.name as string, rate: i.rate_snapshot as number | null, amount: (i.rate_snapshot ?? null) as number | null, month: (p?.period_month ?? '') as string, paidOn: (p?.paid_at ? String(p.paid_at).slice(0, 10) : '') as string, state: p ? (p.status === 'paid' ? 'Paid' : 'Finalized') : 'Draft' }
    })
    const adjusted = d.adjs.map((a: Row) => {
      const p = po(a.applied_payout_id)
      return { tutor: tn(a.teacher_id), type: 'Adjustment', date: String(a.created_at).slice(0, 10), learner: '—', course: a.reason as string, rate: null, amount: Number(a.amount), month: (p?.period_month ?? '') as string, paidOn: (p?.paid_at ? String(p.paid_at).slice(0, 10) : '') as string, state: p ? (p.status === 'paid' ? 'Paid' : 'Finalized') : 'Pending' }
    })
    return [...earned, ...adjusted].filter((r) => !s || [r.tutor, r.learner, r.course].some((v) => String(v).toLowerCase().includes(s)))
  }, [d, s])

  const admissions = useMemo(() => {
    if (!d) return { rows: [] as { k: string; v: number }[] }
    const L = d.leads; const D = d.demos
    const bySource = [...new Set(L.map((l) => l.source))].map((src) => ({ k: `Source: ${src}`, v: L.filter((l) => l.source === src).length }))
    return { rows: [
      { k: 'Enquiries received', v: L.length }, ...bySource, ...LEAD_STAGES.map((st) => ({ k: `Stage now: ${stageLabel(st.v)}`, v: L.filter((l) => l.stage === st.v).length })),
      { k: 'Demos arranged', v: D.length }, { k: 'Demos completed', v: D.filter((x) => x.status === 'completed').length }, { k: 'Student no-shows', v: D.filter((x) => x.status === 'student_no_show').length },
      { k: 'Tutor no-shows', v: D.filter((x) => x.status === 'tutor_no_show').length }, { k: 'Declined by tutor', v: D.filter((x) => x.status === 'declined').length }, { k: 'Re-demos (attempt 2+)', v: D.filter((x) => x.attempt > 1).length },
      { k: 'Converted', v: L.filter((l) => l.stage === 'converted').length }, { k: 'Conversion rate', v: L.length ? Math.round((L.filter((l) => l.stage === 'converted').length / L.length) * 100) : 0 },
    ] }
  }, [d])

  if (!tabs.length) return <Empty title="No reports for your role" />
  const dateFree = tab === 'ledger' || tab === 'finance'
  return (
    <>
      <PageHeader title="Reports" subtitle="Filter by date, search, and export what your role is allowed to see. Exports contain only rows and columns you have permission for." />
      <div className="mb-4"><Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} /></div>
      <div className="rounded-2xl border border-line bg-white p-4 mb-5 flex flex-wrap items-end gap-4">
        {!dateFree && <><Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field></>}
        {tab !== 'admissions' && <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search…" />}
        {dateFree && <p className="text-xs text-ink-soft ml-auto">Shows the current position; the date range does not apply.</p>}
      </div>
      {loading && !d ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : d && (
        <>
          {tab === 'ledger' && <Report name="student-ledger" empty="No enrollments" rows={ledger} cols={[
            { header: 'Student', value: (r) => r.name }, { header: 'Course', value: (r) => r.course }, { header: 'Status', value: (r) => r.status }, { header: 'Allocated', value: (r) => r.allocated }, { header: 'Booked', value: (r) => r.reserved }, { header: 'Delivered', value: (r) => r.fulfilled }, { header: 'Remaining', value: (r) => r.remaining },
            { header: 'Makeup to arrange', value: (r) => r.makeup }, { header: 'Oldest makeup (days)', value: (r) => r.age ?? '', cell: (r) => (r.age === null ? '—' : <Badge tone={r.age > agingDays ? 'red' : 'gray'}>{r.age}d</Badge>) }, { header: 'Allocated by month', value: (r) => r.periods }]} />}
          {tab === 'tutors' && <Report name="tutor-operations" empty="No approved tutors" rows={tutors} cols={[
            { header: 'Tutor', value: (r) => r.name }, { header: 'Students', value: (r) => r.students }, { header: 'Scheduled', value: (r) => r.scheduled }, { header: 'Completed', value: (r) => r.completed }, { header: 'Cancelled', value: (r) => r.cancelled }, { header: 'Overdue attendance', value: (r) => r.overdue }, { header: 'Leave days', value: (r) => r.leave },
            { header: 'Assignments awaiting reply', value: (r) => r.awaiting }, { header: 'Next week confirmed', value: (r) => r.confirmed }]} />}
          {tab === 'finance' && <Report name="finance" empty="No fee plans" rows={finance} cols={[
            { header: 'Student', value: (r) => r.name }, { header: 'Course', value: (r) => r.course }, { header: 'Total due (INR)', value: (r) => r.total, cell: (r) => inr(r.total) }, { header: 'Paid (INR)', value: (r) => r.paid, cell: (r) => inr(r.paid) }, { header: 'Outstanding (INR)', value: (r) => r.outstanding, cell: (r) => inr(r.outstanding) },
            { header: 'Advance (INR)', value: (r) => r.advance, cell: (r) => inr(r.advance) }, { header: 'Overdue (INR)', value: (r) => r.overdue, cell: (r) => (r.overdue ? <b className="text-red-700">{inr(r.overdue)}</b> : '—') }, { header: 'Next due', value: (r) => r.next ?? '', cell: (r) => fmtDate(r.next) }, { header: 'Course status', value: (r) => label[r.status ?? ''] ?? r.status }]} />}
          {tab === 'settlement' && <Report name="tutor-settlement" empty="No earning items in this range" rows={settlement} cols={[
            { header: 'Tutor', value: (r) => r.tutor }, { header: 'Type', value: (r) => r.type }, { header: 'Date', value: (r) => r.date, cell: (r) => fmtDate(r.date) }, { header: 'Learner', value: (r) => r.learner }, { header: 'Course / reason', value: (r) => r.course },
            { header: 'Rate snapshot (INR)', value: (r) => r.rate ?? '', cell: (r) => (r.type === 'Adjustment' ? '—' : r.rate == null ? <Badge tone="yellow">No rate</Badge> : inr(r.rate)) }, { header: 'Amount (INR)', value: (r) => r.amount ?? '', cell: (r) => (r.amount == null ? '—' : inr(r.amount)) },
            { header: 'Payout month', value: (r) => r.month ? String(r.month).slice(0, 7) : '', cell: (r) => (r.month ? String(r.month).slice(0, 7) : '—') }, { header: 'Payout status', value: (r) => r.state }, { header: 'Paid on', value: (r) => r.paidOn, cell: (r) => (r.paidOn ? fmtDate(r.paidOn) : '—') }]} />}
          {tab === 'admissions' && <Report name="admissions" empty="No enquiries in this range" rows={admissions.rows} cols={[{ header: 'Measure', value: (r) => r.k }, { header: 'Count', value: (r) => (r.k === 'Conversion rate' ? `${r.v}%` : r.v) }]} />}
        </>
      )}
    </>
  )
}
