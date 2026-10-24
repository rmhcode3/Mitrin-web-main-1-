import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarCheck, ClipboardCheck, Clock, GraduationCap, Lock, Target, UserCheck, Wallet } from 'lucide-react'
import { rpc, select, type Row } from '../../lib/api'
import { roleLabel, useAuth } from '../../lib/auth'
import { useAsync, useSetting } from '../../lib/hooks'
import { LEAD_STAGES, fmtDateTime, inr, label } from '../../lib/format'
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../../components/ui'

function Task({ to, icon, title, hint, count, tone = 'orange' }: { to: string; icon: ReactNode; title: string; hint: string; count: number; tone?: 'orange' | 'red' | 'blue' }) {
  if (!count) return null
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3.5 hover:border-brand-200 hover:shadow-sm transition min-h-16">
      <span className={`rounded-lg p-2 ${tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'blue' ? 'bg-sky-50 text-sky-600' : 'bg-brand-50 text-brand-700'}`}>{icon}</span>
      <span className="flex-1 min-w-0"><b className="block">{title}</b><span className="text-xs text-ink-soft">{hint}</span></span>
      <Badge tone={tone === 'red' ? 'red' : tone === 'blue' ? 'blue' : 'orange'}>{count}</Badge><ArrowRight size={16} className="text-ink-soft shrink-0" />
    </Link>
  )
}

export default function Dashboard() {
  const { can, profile } = useAuth()
  const coord = can('coordinator')
  const fin = can('finance')
  const lowAt = useSetting<number>('credits.low_balance_warning_at', 2)
  const followup = useSetting<number>('demo.followup_hours', 24)
  const agingDays = useSetting<number>('credits.pending_age_warning_days', 14)

  // Flags courses whose term ended with classes still owed (idempotent; harmless if the migration is not deployed).
  useEffect(() => { if (coord) void rpc('sync_enrollment_completion').catch(() => {}) }, [coord])

  const { data, loading, error, reload } = useAsync(async () => {
    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const [leads, demos, tps, enr, bal, mk, leaves, past, today, fees, items, paySt] = await Promise.all([
      select('leads', 'id, stage'),
      select('demos', 'id, status, created_at, start_at, learner_name', (q) => q.in('status', ['awaiting_tutor', 'accepted'])),
      select('teacher_profiles', 'user_id, approval_status'),
      select('enrollments', 'id, status, assignment_status, students(full_name)'),
      select('enrollment_balances'), select('enrollment_makeup'),
      select('teacher_leaves', 'id, status', (q) => q.eq('status', 'pending')),
      select('sessions', 'id', (q) => q.eq('status', 'scheduled').lt('end_at', now.toISOString())),
      select('sessions', 'id, start_at, status', (q) => q.gte('start_at', dayStart.toISOString()).lt('start_at', dayEnd.toISOString()).neq('status', 'cancelled')),
      fin ? select('fee_plan_summary') : Promise.resolve([]),
      fin ? select('earning_items', 'id, rate_snapshot, payout_id') : Promise.resolve([]),
      select('enrollment_payment_status'),
    ])
    return { leads, demos, tps, enr, bal, mk, leaves, past, today, fees, items, paySt, now }
  })

  const d = data
  const stale = d?.demos.filter((x) => x.status === 'awaiting_tutor' && Date.now() - +new Date(x.created_at) > followup * 3600_000).length ?? 0
  const balBy = new Map((d?.bal ?? []).map((b) => [b.enrollment_id, b]))
  const open = d?.enr.filter((e) => ['active', 'pending_completion'].includes(e.status)) ?? []
  const low = open.filter((e) => (balBy.get(e.id)?.remaining ?? 0) <= lowAt)
  const aging = (d?.mk ?? []).filter((m) => m.oldest_missed && Math.min(m.missed, balBy.get(m.enrollment_id)?.remaining ?? 0) > 0 && Date.now() - +new Date(m.oldest_missed) > agingDays * 86400000).length
  const overdue = (d?.fees ?? []).filter((f) => Number(f.overdue_amount) > 0)
  const noRate = (d?.items ?? []).filter((i) => i.rate_snapshot == null && !i.payout_id).length

  return (
    <>
      <PageHeader title={`Welcome, ${profile?.full_name?.split(' ')[0] ?? ''}`} subtitle={`${roleLabel(profile)} workspace. Urgent items are listed first; nothing is shown unless it needs attention.`} />
      {loading && !d ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Classes today" value={d.today.length} icon={<CalendarCheck size={20} />} tone="blue" />
            <Stat label="Active courses" value={d.enr.filter((e) => e.status === 'active').length} icon={<GraduationCap size={20} />} tone="green" />
            {coord && <Stat label="Open enquiries" value={d.leads.filter((l) => !['converted', 'lost'].includes(l.stage)).length} icon={<Target size={20} />} tone="orange" />}
            {fin ? <Stat label="Overdue" value={inr(overdue.reduce((a, f) => a + Number(f.overdue_amount), 0))} icon={<Wallet size={20} />} tone={overdue.length ? 'red' : 'gray'} sub={`${overdue.length} account${overdue.length === 1 ? '' : 's'}`} /> : <Stat label="On payment hold" value={d.paySt.filter((p) => p.state === 'on_hold').length} icon={<Lock size={20} />} tone="gray" />}
          </div>

          <section>
            <h2 className="font-extrabold text-lg mb-3">Needs attention</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {coord && <>
                <Task to="/admin/teachers" icon={<UserCheck size={18} />} title="Tutor applications to review" hint="Tutors cannot teach until approved" count={d.tps.filter((t) => t.approval_status === 'pending_review').length} />
                <Task to="/admin/demos" icon={<CalendarCheck size={18} />} title="Demo requests awaiting a tutor" hint={stale ? `${stale} unanswered for over ${followup} hours` : 'Waiting for the tutor to accept'} count={d.demos.filter((x) => x.status === 'awaiting_tutor').length} tone={stale ? 'red' : 'orange'} />
                <Task to="/admin/teachers" icon={<Clock size={18} />} title="Leave requests to decide" hint="Pending leave blocks new bookings" count={d.leaves.length} />
                <Task to="/admin/teachers" icon={<UserCheck size={18} />} title="Student assignments not accepted" hint="Awaiting tutor or declined" count={d.enr.filter((e) => ['awaiting_tutor', 'declined'].includes(e.assignment_status) && !['completed', 'withdrawn'].includes(e.status)).length} />
                <Task to="/admin/students" icon={<GraduationCap size={18} />} title={`Students with ${lowAt} or fewer classes left`} hint="Allocate more classes when they renew" count={low.length} tone="blue" />
                <Task to="/admin/students" icon={<AlertTriangle size={18} />} title="Makeup classes waiting too long" hint={`Missed over ${agingDays} days ago. They never expire.`} count={aging} tone="red" />
                <Task to="/admin/students" icon={<Clock size={18} />} title="Courses pending completion" hint="Term ended with classes still owed" count={d.enr.filter((e) => e.status === 'pending_completion').length} />
              </>}
              <Task to="/admin/attendance" icon={<ClipboardCheck size={18} />} title="Classes ended without attendance" hint="Tutors should mark Present or Absent" count={d.past.length} tone="red" />
              {fin && <>
                <Task to="/admin/fees" icon={<Wallet size={18} />} title="Overdue fee accounts" hint="Follow up with the family" count={overdue.length} tone="red" />
                <Task to="/admin/payouts" icon={<AlertTriangle size={18} />} title="Earnings with no tutor rate" hint="Set a rate so they can be paid" count={noRate} />
              </>}
            </div>
            {![d.past.length, ...(coord ? [d.tps.filter((t) => t.approval_status === 'pending_review').length, d.demos.filter((x) => x.status === 'awaiting_tutor').length, d.leaves.length, low.length, aging] : []), ...(fin ? [overdue.length, noRate] : [])].some(Boolean) && <Card className="p-2"><Empty title="You are all caught up" hint="Nothing urgent right now." /></Card>}
          </section>

          {coord && (
            <section>
              <h2 className="font-extrabold text-lg mb-3">Enquiry pipeline</h2>
              <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">{LEAD_STAGES.map((s) => <Link key={s.v} to="/admin/leads" className="rounded-xl border border-line bg-white p-3 text-center hover:border-brand-200"><p className="text-2xl font-extrabold">{d.leads.filter((l) => l.stage === s.v).length}</p><p className="text-meta uppercase font-bold tracking-wide text-ink-soft">{s.l}</p></Link>)}</div>
            </section>
          )}

          {!!d.demos.filter((x: Row) => x.status === 'accepted').length && coord && (
            <section>
              <h2 className="font-extrabold text-lg mb-3">Upcoming demos</h2>
              <Card className="divide-y divide-line">{d.demos.filter((x: Row) => x.status === 'accepted').sort((a: Row, b: Row) => +new Date(a.start_at) - +new Date(b.start_at)).slice(0, 5).map((x: Row) => <div key={x.id} className="px-4 py-3 flex justify-between gap-3 text-sm"><b>{x.learner_name}</b><span className="text-ink-soft">{fmtDateTime(x.start_at)} · {label[x.status]}</span></div>)}</Card>
            </section>
          )}
        </div>
      )}
    </>
  )
}
