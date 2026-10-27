import { useMemo, useState } from 'react'
import { BadgeIndianRupee, ChevronDown, Lock, Plus } from 'lucide-react'
import { rpc, select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { PAY_METHODS } from '../../lib/domain'
import { fmtDate, fmtMonth, inr, todayIn } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, ExportMenu, Field, Input, Modal, Notice, PageHeader, Section, Select, Spinner, Stat, StatusBadge, Textarea, useConfirm } from '../../components/ui'

const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

function RateModal({ teachers, onClose, onDone }: { teachers: Row[]; onClose: () => void; onDone: () => void }) {
  const { profile } = useAuth()
  const [teacher, setTeacher] = useState('')
  const [scope, setScope] = useState('')
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState(todayIn('Asia/Kolkata'))
  const [note, setNote] = useState('')
  const { busy, run } = useAction()
  const enr = useAsync(async () => (teacher ? select('enrollments', 'id, students(full_name), languages(name)', (q) => q.eq('primary_teacher_id', teacher)) : []), [teacher])
  return (
    <Modal open onClose={onClose} title="Set tutor rate" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!teacher || !(Number(amount) > 0)} loading={busy} onClick={() => void run(async () => {
      await unwrap(supabase.from('teacher_rates').insert({ teacher_id: teacher, enrollment_id: scope || null, amount: Number(amount), currency: 'INR', effective_from: from, note: note || null, created_by: profile!.id })); onDone()
    }, 'Rate saved. It applies to future attended classes only.')}>Save rate</Button></>}>
      <div className="space-y-4">
        <Field label="Tutor" required><Select value={teacher} onChange={(e) => { setTeacher(e.target.value); setScope('') }}><option value="">Choose…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
        <Field label="Applies to" hint="A student-specific rate wins over the tutor’s default rate."><Select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!teacher}><option value="">All learners (tutor default)</option>{enr.data?.map((e) => <option key={e.id} value={e.id}>{e.students?.full_name} · {one<Row>(e.languages)?.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Rate per attending learner (INR)" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Effective from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-ink-soft">Earnings already counted keep the rate they were given. Finalized payouts never change.</p>
      </div>
    </Modal>
  )
}

export default function Payouts() {
  const confirm = useConfirm()
  const [month, setMonth] = useState(todayIn('Asia/Kolkata').slice(0, 7))
  const [rate, setRate] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<Row | null>(null)
  const [adj, setAdj] = useState<Row | null>(null)
  const { busy, run } = useAction()

  const { data, loading, error, reload } = useAsync(async () => {
    const [y, m] = month.split('-').map(Number)
    const first = `${month}-01`
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const [items, teachers, rates, adjs] = await Promise.all([
      select('earning_items', '*, enrollments(students(full_name), languages(name))', (q) => q.gte('earned_on', first).lte('earned_on', last).order('earned_on')),
      select('profiles', 'id, full_name', (q) => q.eq('role', 'teacher')), select('teacher_rates', '*', (q) => q.order('effective_from', { ascending: false })),
      select('payout_adjustments', '*', (q) => q.order('created_at', { ascending: false })).catch(() => null),
    ])
    const payouts: Row[] | null = await select('payouts', '*', (q) => q.eq('period_month', first)).catch(() => null)
    return { items, teachers, rates, payouts, adjs }
  }, [month])

  const tName = (id: string) => data?.teachers.find((t) => t.id === id)?.full_name ?? 'Tutor'
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>()
    for (const i of data?.items ?? []) by.set(i.teacher_id, [...(by.get(i.teacher_id) ?? []), i])
    for (const p of data?.payouts ?? []) if (!by.has(p.teacher_id)) by.set(p.teacher_id, [])
    return [...by.entries()].map(([id, items]) => {
      const payout = data?.payouts?.find((p) => p.teacher_id === id)
      const pendingAdj = (data?.adjs ?? []).filter((a) => a.teacher_id === id && !a.applied_payout_id)
      const appliedAdj = payout ? (data?.adjs ?? []).filter((a) => a.applied_payout_id === payout.id) : []
      return { id, name: tName(id), items, payout, noRate: items.filter((i) => i.rate_snapshot == null).length, total: items.reduce((s, i) => s + Number(i.rate_snapshot ?? 0), 0), pendingAdj, appliedAdj }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const totals = { open: groups.filter((g) => !g.payout).reduce((s, g) => s + g.total + g.pendingAdj.reduce((a, x) => a + Number(x.amount), 0), 0), final: groups.filter((g) => g.payout?.status === 'finalized').reduce((s, g) => s + Number(g.payout?.total), 0), paid: groups.filter((g) => g.payout?.status === 'paid').reduce((s, g) => s + Number(g.payout?.total), 0) }
  const missing = groups.filter((g) => !g.payout).reduce((s, g) => s + g.noRate, 0)

  const finalize = async (g: (typeof groups)[number]) => {
    const adjTotal = g.pendingAdj.reduce((a, x) => a + Number(x.amount), 0)
    const c = await confirm({
      title: `Finalize ${g.name} · ${fmtMonth(month)}`, confirmText: 'Finalize payout',
      body: <div className="space-y-2"><p><b>{g.items.length}</b> attended learner-sessions = <b>{inr(g.total)}</b>{adjTotal !== 0 && <> plus adjustments <b>{inr(adjTotal)}</b></>}.</p><p className="text-ink-soft">Finalizing <b>locks the attendance</b> behind these earnings and freezes the amounts, even before the bank transfer. Later corrections can only be recorded as a separate adjustment.</p></div>,
    })
    if (c.ok) await run(async () => { await rpc('finalize_payout', { p_teacher: g.id, p_month: `${month}-01` }); await reload() }, 'Payout finalized and attendance locked')
  }

  const cols = [{ header: 'Tutor', value: (r: Row) => tName(r.teacher_id) }, { header: 'Date', value: (r: Row) => r.earned_on }, { header: 'Learner', value: (r: Row) => r.enrollments?.students?.full_name }, { header: 'Course', value: (r: Row) => one<Row>(r.enrollments?.languages)?.name }, { header: 'Rate (INR)', value: (r: Row) => r.rate_snapshot }, { header: 'Payout', value: (r: Row) => (r.payout_id ? 'Finalized' : 'Open') }]

  return (
    <>
      <PageHeader title="Tutor earnings & payouts" subtitle="A tutor earns the rate for each learner marked Present. Absent learners earn nothing. Makeups pay the tutor who delivered them, in the month delivered."
        actions={<><Input aria-label="Month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /><ExportMenu name={`earnings-${month}`} rows={data?.items ?? []} cols={cols} /><Button variant="dark" onClick={() => setRate(true)}><Plus size={16} /> Set rate</Button></>} />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <>
          {data.payouts === null && <div className="mb-4"><Notice>Payout finalization is not available until migration <b>20261024000014</b> is deployed (see CHANGES.md). Earnings below are live.</Notice></div>}
          <div className="grid sm:grid-cols-3 gap-3 mb-5"><Stat label="Open (not finalized)" value={inr(totals.open)} tone="orange" icon={<BadgeIndianRupee size={20} />} /><Stat label="Finalized, awaiting payment" value={inr(totals.final)} tone="blue" icon={<Lock size={20} />} /><Stat label="Paid" value={inr(totals.paid)} tone="green" /></div>
          {missing > 0 && (
            <div className="mb-4"><Notice>{missing} attended learner-session{missing === 1 ? ' has' : 's have'} no rate yet, so no earning amount. Set the tutor’s rate, then <button className="underline font-semibold" onClick={() => void run(async () => { const n = await rpc<number>('apply_missing_rates'); await reload(); return n }, 'Rates applied to open earnings')}>apply rates to open earnings</button>.</Notice></div>
          )}
          {!groups.length ? <Empty title={`No attended classes in ${fmtMonth(month)}`} hint="Earnings appear when a tutor marks learners Present." /> : (
            <div className="space-y-3">
              {groups.map((g) => (
                <Card key={g.id}>
                  <div className="p-4 flex flex-wrap items-center gap-3 justify-between">
                    <button className="flex items-center gap-2 text-left min-h-11" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                      <ChevronDown size={18} className={open === g.id ? '' : '-rotate-90'} /><div><p className="font-bold">{g.name}</p><p className="text-xs text-ink-soft">{g.items.length} attended learner-session{g.items.length === 1 ? '' : 's'}{g.noRate > 0 && <span className="text-amber-700 font-semibold"> · {g.noRate} without a rate</span>}</p></div>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-lg">{inr(g.payout ? g.payout.total : g.total + g.pendingAdj.reduce((a, x) => a + Number(x.amount), 0))}</b>
                      {g.payout ? <StatusBadge status={g.payout.status === 'paid' ? 'paid' : 'finalized'} text={g.payout.status === 'paid' ? 'Paid' : 'Finalized'} /> : <Badge tone="orange">Draft</Badge>}
                      {!g.payout && data.payouts && <Button size="sm" variant="primary" disabled={busy || g.noRate > 0 || (!g.items.length && !g.pendingAdj.length)} title={g.noRate > 0 ? 'Set a rate first' : ''} onClick={() => void finalize(g)}>Finalize</Button>}
                      {g.payout?.status === 'finalized' && <Button size="sm" variant="primary" onClick={() => setPaying(g.payout as Row)}>Mark paid</Button>}
                      {data.adjs && <Button size="sm" onClick={() => setAdj({ id: g.id, name: g.name, payout: g.payout })}>Adjustment</Button>}
                    </div>
                  </div>
                  {open === g.id && (
                    <div className="border-t border-line p-4 space-y-3">
                      {g.payout && <p className="text-xs text-ink-soft">Finalized {fmtDate(g.payout.finalized_at)} · {g.payout.item_count} items {inr(g.payout.items_total)}{Number(g.payout.adjustments_total) !== 0 && ` + adjustments ${inr(g.payout.adjustments_total)}`}{g.payout.paid_at && ` · paid ${fmtDate(g.payout.paid_at)} via ${g.payout.pay_method}${g.payout.pay_reference ? ` (${g.payout.pay_reference})` : ''}`}</p>}
                      <ul className="divide-y divide-line text-sm">{g.items.map((i) => <li key={i.id} className="py-2 flex justify-between gap-3"><span>{fmtDate(i.earned_on)} · <b>{i.enrollments?.students?.full_name}</b> <span className="text-ink-soft">{one<Row>(i.enrollments?.languages)?.name}</span></span><span><span className="text-xs text-ink-soft">rate snapshot </span>{i.rate_snapshot == null ? <Badge tone="yellow">No rate</Badge> : inr(i.rate_snapshot)} {i.payout_id && <Lock size={12} className="inline text-ink-soft" />}</span></li>)}</ul>
                      {g.appliedAdj.map((a) => <p key={a.id} className="text-sm"><Badge tone="purple">Adjustment</Badge> {inr(a.amount)} · {a.reason} <span className="text-xs text-ink-soft">(included in this payout · recorded {fmtDate(a.created_at)})</span></p>)}
                      {g.pendingAdj.map((a) => <p key={a.id} className="text-sm"><Badge tone="purple">Adjustment</Badge> {inr(a.amount)} · {a.reason} <span className="text-xs text-ink-soft">(applies at next finalization)</span></p>)}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
          <div className="mt-8">
            <Section title="Tutor rates (effective-dated)">
              {!data.rates.length ? <p className="text-sm text-ink-soft">No rates yet.</p> : <ul className="divide-y divide-line text-sm">{data.rates.map((r) => <li key={r.id} className="py-2 flex flex-wrap justify-between gap-2"><span><b>{tName(r.teacher_id)}</b> <span className="text-ink-soft">· {r.enrollment_id ? 'student-specific' : 'default'}{r.note ? ` · ${r.note}` : ''}</span></span><span><b>{inr(r.amount)}</b> <span className="text-ink-soft">from {fmtDate(r.effective_from)}</span></span></li>)}</ul>}
              <p className="text-xs text-ink-soft mt-3">Order of use: student-specific rate, then the tutor’s default. Each earning keeps the rate it had when attendance was saved.</p>
            </Section>
          </div>
        </>
      )}

      {rate && data && <RateModal teachers={data.teachers} onClose={() => setRate(false)} onDone={() => { setRate(false); void reload() }} />}
      {paying && <PaidModal payout={paying} name={tName(paying.teacher_id)} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void reload() }} />}
      {adj && <AdjModal t={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); void reload() }} />}
    </>
  )
}

function PaidModal({ payout, name, onClose, onDone }: { payout: Row; name: string; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('UPI')
  const [ref, setRef] = useState('')
  const { busy, run } = useAction()
  return (
    <Modal open onClose={onClose} title={`Mark paid · ${name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void run(async () => { await rpc('mark_payout_paid', { p_payout: payout.id, p_method: method, p_reference: ref || null }); onDone() }, 'Payout marked as paid')}>Mark {inr(payout.total)} paid</Button></>}>
      <div className="space-y-4"><Field label="Paid by"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field><Field label="Transfer reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>
    </Modal>
  )
}

function AdjModal({ t, onClose, onDone }: { t: Row; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const { busy, run } = useAction()
  const n = Number(amount)
  return (
    <Modal open onClose={onClose} title={`Payout adjustment · ${t.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!n || reason.trim().length < 3} loading={busy} onClick={() => void run(async () => { await rpc('add_payout_adjustment', { p_teacher: t.id, p_amount: n, p_reason: reason.trim(), p_related: t.payout?.id ?? null }); onDone() }, 'Adjustment recorded for the next settlement')}>Record adjustment</Button></>}>
      <div className="space-y-4">
        <Field label="Amount (INR, negative to deduct)" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Correction: class marked absent in error (April)" /></Field>
        <p className="text-xs text-ink-soft">The original payout and attendance stay untouched. This amount is added to the next payout you finalize for this tutor, including a closing settlement when they leave.</p>
      </div>
    </Modal>
  )
}
