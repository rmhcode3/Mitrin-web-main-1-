import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Lock, Plus, Unlock, Wallet } from 'lucide-react'
import { rpc, select, type Row } from '../../lib/api'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { PAY_METHODS } from '../../lib/domain'
import { addDays, fmtDate, inr, label, todayIn } from '../../lib/format'
import { Badge, Button, DataTable, Drawer, Empty, ErrorBox, ExportMenu, Field, Input, KV, Modal, Notice, PageHeader, SearchBox, Section, Select, Spinner, Stat, StatusBadge, Textarea, useConfirm } from '../../components/ui'

const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)
type Filter = 'all' | 'pending' | 'overdue' | 'paid'

function addMonthsKeepDay(date: string, n: number, day: number) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n)
  return `${d.toISOString().slice(0, 8)}${String(day).padStart(2, '0')}`
}

function PlanModal({ enrollments, onClose, onDone }: { enrollments: Row[]; onClose: () => void; onDone: () => void }) {
  const defDay = useSetting<number>('fees.default_installment_day', 1)
  const [enr, setEnr] = useState('')
  const [total, setTotal] = useState('')
  const [classes, setClasses] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<{ due_date: string; amount: string; label: string }[]>([])
  const { busy, run } = useAction()
  const sum = rows.reduce((a, r) => a + Number(r.amount || 0), 0)
  const t = Number(total)

  const preset = (n: number) => {
    if (!(t > 0)) return
    const first = todayIn('Asia/Kolkata')
    const base = Math.floor((t * 100) / n) / 100
    setRows(Array.from({ length: n }, (_, i) => ({ due_date: addMonthsKeepDay(first, i + (first.slice(8) > String(defDay).padStart(2, '0') ? 1 : 0), defDay), amount: String(i === n - 1 ? Math.round((t - base * (n - 1)) * 100) / 100 : base), label: n === 1 ? 'Full course' : `Installment ${i + 1}` })))
  }
  const valid = enr && t > 0 && rows.length > 0 && Math.abs(sum - t) < 0.005 && rows.every((r) => r.due_date && Number(r.amount) > 0)

  return (
    <Modal open wide onClose={onClose} title="Set course fee plan" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={() => void run(async () => {
      await rpc('create_fee_plan', { p_enrollment: enr, p_total: t, p_installments: rows.map((r) => ({ due_date: r.due_date, amount: Number(r.amount), label: r.label })), p_classes: classes ? Number(classes) : null, p_notes: notes || null }); onDone()
    }, 'Fee plan created')}>Create plan</Button></>}>
      <div className="space-y-4">
        <Field label="Course enrollment" required><Select value={enr} onChange={(e) => { setEnr(e.target.value); const x = enrollments.find((y) => y.id === e.target.value); if (x?.agreed_classes) setClasses(String(x.agreed_classes)) }}><option value="">Choose…</option>{enrollments.map((e) => <option key={e.id} value={e.id}>{e.students?.full_name} · {one<Row>(e.languages)?.name}</option>)}</Select></Field>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Total fee (INR)" required><Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></Field><Field label="Total classes covered"><Input inputMode="numeric" value={classes} onChange={(e) => setClasses(e.target.value)} /></Field></div>
        <div>
          <p className="text-[13px] font-semibold mb-1.5">Installments</p>
          <div className="flex flex-wrap gap-2 mb-3">{[1, 2, 3, 6].map((n) => <Button key={n} size="sm" disabled={!(t > 0)} onClick={() => preset(n)}>{n === 1 ? 'Pay in full' : `${n} monthly`}</Button>)}<Button size="sm" onClick={() => setRows([...rows, { due_date: todayIn('Asia/Kolkata'), amount: '', label: '' }])}><Plus size={13} /> Custom installment</Button></div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-2 items-center">
              <Input aria-label="Due date" type="date" value={r.due_date} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} />
              <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Input aria-label="Label" className="hidden sm:block" placeholder="Label" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove installment" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>
            </div>))}
          {rows.length > 0 && <p className={`text-sm font-semibold ${Math.abs(sum - t) < 0.005 ? 'text-emerald-700' : 'text-red-600'}`}>Installments {inr(sum)} of {inr(t)}{Math.abs(sum - t) >= 0.005 && ` · ${inr(t - sum)} ${t > sum ? 'left to assign' : 'over'}`}</p>}
        </div>
        <Field label="Notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agreement details, mid-month proration basis…" /></Field>
        <p className="text-xs text-ink-soft">Mid-month joiners: bill from the expected remaining planned classes and adjust later with a traceable adjustment.</p>
      </div>
    </Modal>
  )
}

function PaymentModal({ plan, onClose, onDone }: { plan: Row; onClose: () => void; onDone: (r: Row) => void }) {
  const [f, setF] = useState({ amount: '', paid_on: todayIn('Asia/Kolkata'), method: 'UPI', reference: '', payer: '', note: '' })
  const [fx, setFx] = useState(false)
  const [cur, setCur] = useState('USD')
  const [orig, setOrig] = useState('')
  const [rate, setRate] = useState('')
  const { busy, run } = useAction()
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const amt = fx ? Math.round(Number(orig) * Number(rate) * 100) / 100 : Number(f.amount)
  const needRef = ['UPI', 'Bank Transfer'].includes(f.method)
  const valid = amt > 0 && f.paid_on <= todayIn('Asia/Kolkata') && (!fx || (cur.trim().length === 3 && Number(orig) > 0 && Number(rate) > 0))
  return (
    <Modal open onClose={onClose} title={`Record payment · ${plan.students?.full_name ?? ''}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={() => void run(async () => {
      const r = await rpc<Row>('record_payment', { p_plan: plan.plan_id, p_paid_on: f.paid_on, p_amount: amt, p_method: f.method, p_reference: f.reference || null, p_payer: f.payer || null, p_note: f.note || null, p_orig_currency: fx ? cur.toUpperCase() : null, p_orig_amount: fx ? Number(orig) : null, p_fx: fx ? Number(rate) : null }); onDone(r)
    })}>Record {valid ? inr(amt) : ''}</Button></>}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={fx} onChange={(e) => setFx(e.target.checked)} /> Foreign-currency payment (enter the INR equivalent yourself)</label>
        {fx ? (
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-sand p-3">
            <Field label="Currency" required><Input maxLength={3} value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label="Amount paid" required><Input inputMode="decimal" value={orig} onChange={(e) => setOrig(e.target.value)} /></Field>
            <Field label="Rate to INR" required><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <p className="col-span-3 text-sm">INR equivalent: <b>{amt > 0 ? inr(amt) : '—'}</b> <span className="text-xs text-ink-soft">(you supply the rate; no live exchange rate is used)</span></p>
          </div>
        ) : <Field label="Amount received (INR)" required><Input inputMode="decimal" value={f.amount} onChange={s('amount')} autoFocus /></Field>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Date received" required error={f.paid_on > todayIn('Asia/Kolkata') ? 'A payment cannot be dated in the future.' : null}><Input type="date" value={f.paid_on} onChange={s('paid_on')} /></Field>
          <Field label="Method"><Select value={f.method} onChange={s('method')}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label={needRef ? 'UTR / reference (recommended)' : 'Receipt number / reason'}><Input value={f.reference} onChange={s('reference')} /></Field>
          <Field label="Paid by"><Input value={f.payer} onChange={s('payer')} placeholder="Parent or payer name" /></Field>
        </div>
        <Field label="Note"><Input value={f.note} onChange={s('note')} /></Field>
        <p className="text-xs text-ink-soft">The payment is applied to the oldest unpaid installment first, including future ones, so a prepaid period is never demanded again. Anything extra is kept as an advance.</p>
      </div>
    </Modal>
  )
}

function AdjustModal({ plan, onClose, onDone }: { plan: Row; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('charge')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const { busy, run } = useAction()
  const ok = Number(amount) > 0 && reason.trim().length > 2
  return (
    <Modal open onClose={onClose} title={`Update bill · ${plan.students?.full_name ?? ''}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={busy} onClick={() => void run(async () => { await rpc('record_adjustment', { p_plan: plan.plan_id, p_kind: kind, p_amount: Number(amount), p_reason: reason.trim() }); onDone() }, 'Adjustment recorded')}>Record</Button></>}>
      <div className="space-y-4">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="charge">Extra charge / manual invoice (adds to the bill)</option><option value="waiver">Waiver / discount (reduces the bill)</option><option value="refund">Refund paid out (reduces amount paid)</option></Select></Field>
        <Field label="Amount (INR)" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Mid-month joining adjustment, fee change, withdrawal refund" /></Field>
        <p className="text-xs text-ink-soft">Adjustments cannot be edited or deleted. A mistake is corrected by recording another adjustment.</p>
      </div>
    </Modal>
  )
}

function PlanDrawer({ plan, onClose }: { plan: Row; onClose: () => void }) {
  const h = useAsync(async () => {
    const [inst, alloc, pays, adj, holds] = await Promise.all([
      select('fee_installments', '*', (q) => q.eq('plan_id', plan.plan_id).order('due_date')), select('payment_allocations', '*, payments!inner(plan_id)', (q) => q.eq('payments.plan_id', plan.plan_id)),
      select('payments', '*', (q) => q.eq('plan_id', plan.plan_id).order('paid_on', { ascending: false })), select('fee_adjustments', '*', (q) => q.eq('plan_id', plan.plan_id).order('created_at', { ascending: false })),
      select('holds', '*', (q) => q.eq('enrollment_id', plan.enrollment_id).order('imposed_at', { ascending: false })),
    ])
    return { inst, alloc, pays, adj, holds }
  }, [plan.plan_id])
  const alloc = (id: string) => (h.data?.alloc ?? []).filter((a) => a.installment_id === id).reduce((s, a) => s + Number(a.amount), 0)
  return (
    <Drawer open onClose={onClose} width="md:max-w-3xl" badge={<StatusBadge status={plan.state} text={label[plan.state]} />} title={plan.students?.full_name} subtitle={`${one<Row>(plan.languages)?.name} · plan total ${inr(plan.total_amount)}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Total due" value={inr(plan.total_due)} /><Stat label="Paid" value={inr(plan.paid)} tone="green" /><Stat label="Outstanding" value={inr(Math.max(0, plan.outstanding))} tone={plan.overdue_amount > 0 ? 'red' : 'gray'} /><Stat label="Advance" value={inr(Math.max(0, -plan.outstanding))} tone="blue" /></div>
      {h.loading ? <Spinner /> : h.error ? <ErrorBox message={h.error} /> : (
        <>
          <Section title="Installments"><ul className="divide-y divide-line text-sm">{h.data!.inst.map((i) => { const a = alloc(i.id); const open = Number(i.amount) - a; return <li key={i.id} className="py-2.5 flex flex-wrap justify-between gap-2"><span><b>{fmtDate(i.due_date)}</b> <span className="text-ink-soft">{i.label}</span></span><span className="flex items-center gap-2">{inr(i.amount)}{open <= 0 ? <Badge tone="green">Covered</Badge> : a > 0 ? <Badge tone="yellow">{inr(open)} left</Badge> : <Badge tone={i.due_date < todayIn('Asia/Kolkata') ? 'red' : 'blue'}>Unpaid</Badge>}</span></li> })}</ul></Section>
          <Section title="Payments received">{!h.data!.pays.length ? <p className="text-sm text-ink-soft">No payments yet.</p> : <ul className="divide-y divide-line text-sm">{h.data!.pays.map((p) => <li key={p.id} className="py-2.5"><div className="flex justify-between"><b>{inr(p.amount)}</b><span className="text-ink-soft">{fmtDate(p.paid_on)} · {p.method}</span></div><div className="text-xs text-ink-soft">{[p.reference && `Ref ${p.reference}`, p.payer_name && `by ${p.payer_name}`, p.original_currency && `${p.original_amount} ${p.original_currency} @ ${p.fx_rate}`, p.note].filter(Boolean).join(' · ')}</div></li>)}</ul>}</Section>
          {!!h.data!.adj.length && <Section title="Adjustments"><ul className="divide-y divide-line text-sm">{h.data!.adj.map((a) => <li key={a.id} className="py-2.5 flex justify-between gap-3"><span><b className="capitalize">{a.kind}</b> <span className="text-ink-soft">· {a.reason}</span></span><span>{a.kind === 'charge' ? '+' : '−'}{inr(a.amount)} <span className="text-xs text-ink-soft">{fmtDate(a.created_at)}</span></span></li>)}</ul></Section>}
          {!!h.data!.holds.length && <Section title="Hold history"><ul className="text-sm space-y-1.5">{h.data!.holds.map((x) => <li key={x.id}>{fmtDate(x.imposed_at)} · {x.reason} {x.released_at ? <span className="text-ink-soft">→ released {fmtDate(x.released_at)}{x.release_note ? ` (${x.release_note})` : ''}</span> : <Badge tone="red">Open</Badge>}</li>)}</ul></Section>}
          <ExportMenu name={`fees-${plan.students?.full_name}`} rows={h.data!.pays} cols={[{ header: 'Date', value: (p: Row) => p.paid_on }, { header: 'Amount (INR)', value: (p: Row) => p.amount }, { header: 'Method', value: (p: Row) => p.method }, { header: 'Reference', value: (p: Row) => p.reference }, { header: 'Payer', value: (p: Row) => p.payer_name }, { header: 'Currency', value: (p: Row) => p.original_currency }, { header: 'Original amount', value: (p: Row) => p.original_amount }, { header: 'Rate', value: (p: Row) => p.fx_rate }]} />
        </>
      )}
    </Drawer>
  )
}

export default function Fees() {
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [modal, setModal] = useState<null | { t: 'plan' } | { t: 'pay' | 'adjust' | 'view'; plan: Row }>(null)
  const { busy, run } = useAction()
  const [receipt, setReceipt] = useState<Row | null>(null)

  const { data, loading, error, reload } = useAsync(async () => {
    const [summ, plans, enr, status, pays] = await Promise.all([
      select('fee_plan_summary'), select('fee_plans', '*'),
      select('enrollments', 'id, status, agreed_classes, students(full_name, student_contacts(phone)), languages(name)'), select('enrollment_payment_status'),
      select('payments', 'amount, paid_on', (x) => x.gte('paid_on', todayIn('Asia/Kolkata').slice(0, 8) + '01')),
    ])
    const eMap = new Map(enr.map((e) => [e.id, e])); const sMap = new Map(status.map((s) => [s.enrollment_id, s.state]))
    const plansBy = new Map(plans.map((p) => [p.id, p]))
    const rows = summ.filter((s) => plansBy.get(s.plan_id)?.status === 'active').map((s): Row => { const e = eMap.get(s.enrollment_id) ?? {}; return { ...s, students: e.students, languages: e.languages, state: sMap.get(s.enrollment_id) ?? 'due', enr: e } })
    const withPlan = new Set(plans.filter((p) => p.status === 'active').map((p) => p.enrollment_id))
    const needPlan = enr.filter((e) => !withPlan.has(e.id) && !['completed', 'withdrawn'].includes(e.status))
    return { rows, needPlan, collected: pays.reduce((a, p) => a + Number(p.amount), 0) }
  })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.rows ?? []).filter((r) => (!s || String(r.students?.full_name).toLowerCase().includes(s)) && (filter === 'all' || (filter === 'overdue' ? r.state === 'overdue' : filter === 'paid' ? r.state === 'cleared' : ['due', 'on_hold'].includes(r.state))))
  }, [data, q, filter])
  const overdue = (data?.rows ?? []).filter((r) => r.overdue_amount > 0)
  const upcoming = (data?.rows ?? []).filter((r) => r.outstanding > 0 && r.overdue_amount <= 0 && r.next_due && r.next_due <= addDays(todayIn('Asia/Kolkata'), 30))

  const hold = async (r: Row) => {
    if (r.state === 'on_hold') {
      const c = await confirm({ title: 'Release payment hold?', body: <p>The tutor will be able to book new classes. Cancelled classes are not restored automatically; they rebook fresh times.</p>, reason: 'Release note (e.g. payment cleared, reference)', confirmText: 'Release hold' })
      if (c.ok) await run(async () => { await rpc('release_hold', { p_enrollment: r.enrollment_id, p_note: c.reason || null }); await reload() }, 'Hold released')
    } else {
      const c = await confirm({ title: `Place ${r.students?.full_name} on hold?`, body: <p>Their upcoming classes are removed (other group members are unaffected). Unused credits are kept and no new classes can be booked until released.</p>, reason: 'Reason for the hold', danger: true, confirmText: 'Place on hold' })
      if (c.ok) await run(async () => { const n = await rpc<number>('place_hold', { p_enrollment: r.enrollment_id, p_reason: c.reason }); await reload(); return n }, 'Hold placed')
    }
  }

  return (
    <>
      <PageHeader title="Fees & payment tracking" subtitle="Student billing is kept separate from class credits and tutor payouts. Payments are recorded manually: UPI, bank transfer or cash."
        actions={<><ExportMenu name="fees" rows={rows} cols={[{ header: 'Student', value: (r: Row) => r.students?.full_name }, { header: 'Course', value: (r: Row) => one<Row>(r.languages)?.name }, { header: 'Total due', value: (r: Row) => r.total_due }, { header: 'Paid', value: (r: Row) => r.paid }, { header: 'Outstanding', value: (r: Row) => r.outstanding }, { header: 'Overdue', value: (r: Row) => r.overdue_amount }, { header: 'Next due', value: (r: Row) => r.next_due }, { header: 'Status', value: (r: Row) => label[r.state] }]} /><Button variant="dark" onClick={() => setModal({ t: 'plan' })}><Plus size={16} /> Set fee plan</Button></>} />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-5">
            <Stat label="Overdue accounts" tone="red" icon={<AlertTriangle size={20} />} value={inr(overdue.reduce((a, r) => a + Number(r.overdue_amount), 0))} sub={`${overdue.length} account${overdue.length === 1 ? '' : 's'}`} />
            <Stat label="Due in next 30 days" tone="blue" icon={<CalendarClock size={20} />} value={inr(upcoming.reduce((a, r) => a + Number(r.outstanding), 0))} sub={`${upcoming.length} account${upcoming.length === 1 ? '' : 's'}`} />
            <Stat label="Collected this month" tone="green" icon={<CheckCircle2 size={20} />} value={inr(data.collected)} sub="Payments recorded since the 1st" />
          </div>
          {!!data.needPlan.length && <div className="mb-5"><Notice>{data.needPlan.length} open course{data.needPlan.length === 1 ? ' has' : 's have'} no fee plan yet: {data.needPlan.slice(0, 4).map((e) => e.students?.full_name).join(', ')}{data.needPlan.length > 4 && '…'}. <button className="underline font-semibold" onClick={() => setModal({ t: 'plan' })}>Set a plan</button></Notice></div>}
          <div className="flex flex-wrap gap-3 mb-4">
            <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search by student name…" />
            <Select aria-label="Invoice filter" className="w-44" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">All invoices</option><option value="pending">Pending</option><option value="overdue">Overdue</option><option value="paid">Paid</option></Select>
          </div>
          <DataTable rows={rows} rowKey={(r) => r.plan_id} onRowClick={(r) => setModal({ t: 'view', plan: r })} empty={<Empty title="No fee accounts" hint="Set a fee plan for an enrollment to start tracking." />}
            columns={[
              { h: 'Student', primary: true, cell: (r) => <div><b>{r.students?.full_name}</b><div className="text-xs text-ink-soft">{one<Row>(r.languages)?.name}</div></div> },
              { h: 'Next due', cell: (r) => (r.next_due ? fmtDate(r.next_due) : '—') }, { h: 'Total due', cell: (r) => inr(r.total_due) }, { h: 'Paid', cell: (r) => inr(r.paid) },
              { h: 'Outstanding', cell: (r) => <b className={r.overdue_amount > 0 ? 'text-red-700' : ''}>{inr(Math.max(0, r.outstanding))}</b> },
              { h: 'Status', cell: (r) => <StatusBadge status={r.state} text={label[r.state]} /> },
              { h: 'Actions', cell: (r) => (
                <div className="flex flex-wrap gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="primary" onClick={() => setModal({ t: 'pay', plan: r })}><Wallet size={13} /> Payment</Button>
                  <Button size="sm" onClick={() => setModal({ t: 'adjust', plan: r })}>Update bill</Button>
                  <Button size="sm" disabled={busy || ['completed', 'withdrawn'].includes(r.enr?.status)} onClick={() => void hold(r)}>{r.state === 'on_hold' ? <><Unlock size={13} /> Release</> : <><Lock size={13} /> Hold</>}</Button>
                </div>) },
            ]} />
        </>
      )}
      {modal?.t === 'plan' && data && <PlanModal enrollments={data.needPlan} onClose={() => setModal(null)} onDone={() => { setModal(null); void reload() }} />}
      {modal?.t === 'pay' && <PaymentModal plan={modal.plan} onClose={() => setModal(null)} onDone={(r) => { setModal(null); setReceipt(r); void reload() }} />}
      {modal?.t === 'adjust' && <AdjustModal plan={modal.plan} onClose={() => setModal(null)} onDone={() => { setModal(null); void reload() }} />}
      {modal?.t === 'view' && <PlanDrawer plan={modal.plan} onClose={() => setModal(null)} />}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Payment recorded" footer={<Button variant="primary" onClick={() => setReceipt(null)}>Done</Button>}>
        <dl className="grid grid-cols-2 gap-4"><KV k="Applied to installments" v={inr(receipt?.allocated)} /><KV k="Kept as advance" v={inr(receipt?.advance)} /></dl>
      </Modal>
    </>
  )
}
