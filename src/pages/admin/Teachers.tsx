import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Mail, Phone, ShieldOff, UserCheck, X } from 'lucide-react'
import { select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { addDays, digits, fmtClock, fmtDate, fmtDateTime, inr, label, mondayOf, todayIn, WEEKDAYS } from '../../lib/format'
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, KV, Modal, Notice, PageHeader, SearchBox, Section, Select, Spinner, StatusBadge, Tabs, Textarea, useConfirm } from '../../components/ui'

type Tab = 'active' | 'pending' | 'inactive' | 'requests'
const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

export default function Teachers() {
  const { can, profile } = useAuth()
  const coord = can('coordinator')
  const nav = useNavigate()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('active')
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Row | null>(null)
  const [why, setWhy] = useState('')
  const { busy, run } = useAction()

  const { data, loading, error, reload } = useAsync(async () => {
    const [tps, enr, demos, conf, leaves] = await Promise.all([
      select('teacher_profiles', '*, profiles!user_id(id,full_name,email,phone,status,created_at)'),
      select('enrollments', 'id, status, assignment_status, primary_teacher_id, students(full_name), languages(name), created_at'),
      select('demos', 'id, teacher_id, status, start_at', (x) => x.in('status', ['awaiting_tutor', 'accepted']).gte('start_at', new Date().toISOString())),
      select('availability_confirmations'), select('teacher_leaves', '*', (x) => x.order('start_date', { ascending: false })),
    ])
    return { tps, enr, demos, conf, leaves }
  })

  const nextMonday = (tz: string) => addDays(mondayOf(todayIn(tz)), 7)
  const onLeave = (t: Row) => { const today = todayIn(t.timezone); return !!data?.leaves.some((l) => l.teacher_id === t.user_id && l.status === 'approved' && l.start_date <= today && l.end_date >= today) }
  const rows = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.tps.filter((t) => {
      const p = t.profiles as Row
      if (s && ![p.full_name, p.email, ...(t.languages as string[])].some((v) => String(v).toLowerCase().includes(s))) return false
      const suspended = p.status === 'suspended'
      if (st === 'on_leave' ? !onLeave(t) : st === 'available' && onLeave(t)) return false
      return tab === 'active' ? t.approval_status === 'approved' && !suspended : tab === 'pending' ? t.approval_status === 'pending_review' && !suspended : tab === 'inactive' ? suspended || t.approval_status === 'rejected' : false
    })
  }, [data, tab, q, st])
  const PAGE = 9
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages)
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE)

  const requests = useMemo(() => data?.enr.filter((e) => ['awaiting_tutor', 'declined'].includes(e.assignment_status) && !['completed', 'withdrawn'].includes(e.status)) ?? [], [data])
  const tName = (id: string) => data?.tps.find((t) => t.user_id === id)?.profiles?.full_name ?? '—'

  const decide = (t: Row, approval_status: 'approved' | 'rejected', note?: string) => run(async () => {
    await unwrap(supabase.from('teacher_profiles').update({ approval_status, approved_at: approval_status === 'approved' ? new Date().toISOString() : null, approved_by: approval_status === 'approved' ? profile!.id : null, ...(note ? { admin_notes: note } : {}) }).eq('user_id', t.user_id))
    setRejecting(null); setWhy(''); await reload()
  }, approval_status === 'approved' ? 'Tutor approved. They can now see their teaching records.' : 'Application rejected')

  const setActive = async (t: Row, status: 'active' | 'suspended') => {
    if (status === 'suspended') { const c = await confirm({ title: `Suspend ${t.profiles.full_name}?`, body: <p>They lose access immediately. Teaching records and history stay intact.</p>, danger: true, confirmText: 'Suspend' }); if (!c.ok) return }
    await run(async () => { await unwrap(supabase.from('profiles').update({ status }).eq('id', t.user_id)); await reload() }, status === 'active' ? 'Account reactivated' : 'Account suspended')
  }

  const TeacherCard = ({ t }: { t: Row }) => {
    const p = t.profiles as Row
    const mine = data!.enr.filter((e) => e.primary_teacher_id === t.user_id && e.assignment_status === 'accepted' && ['active', 'on_hold', 'pending_completion'].includes(e.status))
    const demos = data!.demos.filter((d) => d.teacher_id === t.user_id).length
    const confirmed = data!.conf.some((c) => c.teacher_id === t.user_id && c.week_start === nextMonday(t.timezone))
    const pend = data!.enr.filter((e) => e.primary_teacher_id === t.user_id && e.assignment_status === 'awaiting_tutor').length
    return (
      <Card className="p-4 cursor-pointer hover:border-brand-200 hover:shadow-md transition" onClick={() => setOpenId(t.user_id)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0"><div className="h-11 w-11 rounded-full bg-brand-100 text-brand-700 font-extrabold flex items-center justify-center shrink-0">{p.full_name.slice(0, 1)}</div><div className="min-w-0"><p className="font-bold truncate">{p.full_name}</p><p className="text-xs text-ink-soft truncate">{p.email}</p></div></div>
          <StatusBadge status={p.status === 'suspended' ? 'suspended' : t.approval_status} text={p.status === 'suspended' ? 'Suspended' : label[t.approval_status]} />
        </div>
        <div className="flex flex-wrap gap-1 mt-3">{(t.languages as string[]).map((l) => <Badge key={l} tone="orange">{l}</Badge>)}{!(t.languages as string[]).length && <span className="text-xs text-ink-soft">No languages</span>}</div>
        <p className="text-xs text-ink-soft mt-2 line-clamp-2">{t.experience_years != null ? `${t.experience_years} yrs · ` : ''}{t.qualifications ?? 'No qualifications listed'}</p>
        {t.approval_status === 'approved' && (
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div className="rounded-lg bg-sand py-1.5"><p className="font-extrabold">{mine.length}</p><p className="text-[10px] text-ink-soft uppercase">Students</p></div>
            <div className="rounded-lg bg-sand py-1.5"><p className="font-extrabold">{demos}</p><p className="text-[10px] text-ink-soft uppercase">Demos</p></div>
            <div className={`rounded-lg py-1.5 ${confirmed ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="font-extrabold">{confirmed ? 'Yes' : 'No'}</p><p className="text-[10px] text-ink-soft uppercase">Next wk</p></div>
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-xs text-ink-soft">
          <span>Joined {fmtDate(p.created_at)}</span><span className="text-brand-700 font-semibold">View profile →</span>
        </div>
        {pend > 0 && <p className="text-xs text-amber-700 mt-2 font-semibold">{pend} assignment request{pend > 1 ? 's' : ''} awaiting reply</p>}
        {coord && t.approval_status === 'pending_review' && p.status !== 'suspended' && (
          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void decide(t, 'approved')}><Check size={14} /> Approve</Button>
            <Button size="sm" onClick={() => setRejecting(t)}><X size={14} /> Reject</Button>
          </div>
        )}
      </Card>
    )
  }

  const pendingN = data?.tps.filter((t) => t.approval_status === 'pending_review' && t.profiles.status !== 'suspended').length

  return (
    <>
      <PageHeader title="Teacher roster" subtitle="Approve applications, monitor assignments and open any tutor’s full teaching profile." />
      <div className="mb-4"><Tabs<Tab> value={tab} onChange={(v) => { setTab(v); setPage(1) }} tabs={[{ id: 'active', label: 'Active' }, { id: 'pending', label: 'Pending approval', count: pendingN }, { id: 'inactive', label: 'Suspended / rejected' }, { id: 'requests', label: 'Assignment requests', count: requests.length }]} /></div>
      {data && (
        <Card className="grid gap-3 sm:grid-cols-3 p-4 mb-4 divide-y sm:divide-y-0 sm:divide-x divide-line">
          {[['Active tutors', `${data.tps.filter((t) => t.approval_status === 'approved' && t.profiles.status !== 'suspended').length} active`, 'bg-emerald-50 text-emerald-700'],
            ['Tutors on leave today', `${data.tps.filter(onLeave).length} on leave`, 'bg-amber-50 text-amber-700'],
            ['Languages covered', `${new Set(data.tps.filter((t) => t.approval_status === 'approved').flatMap((t) => t.languages as string[])).size} languages`, 'bg-brand-50 text-brand-700']].map(([k, v, c]) => (
            <div key={k} className="flex items-center gap-3 sm:px-3 pt-3 sm:pt-0 first:pt-0"><div className={`h-10 w-10 rounded-lg flex items-center justify-center font-extrabold ${c}`}>{v.split(' ')[0]}</div><div><p className="text-meta uppercase tracking-wider text-ink-soft">{k}</p><p className="font-bold">{v}</p></div></div>
          ))}
        </Card>
      )}
      {tab !== 'requests' && (
        <Card className="p-3 mb-4 flex flex-wrap gap-3 items-center">
          <SearchBox className="flex-1 min-w-52" value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search by name, email or language…" />
          <Select aria-label="Availability" className="w-48" value={st} onChange={(e) => { setSt(e.target.value); setPage(1) }}><option value="">All statuses</option><option value="available">Available</option><option value="on_leave">On leave today</option></Select>
        </Card>
      )}
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : tab === 'requests' ? (
        !requests.length ? <Empty title="No open assignment requests" hint="Requests appear here until the tutor accepts." /> : (
          <div className="grid gap-3 md:grid-cols-2">{requests.map((e) => (
            <Card key={e.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-bold">{e.students?.full_name} <span className="font-normal text-ink-soft">· {one<Row>(e.languages)?.name}</span></p><p className="text-sm text-ink-soft">{e.primary_teacher_id ? `Requested: ${tName(e.primary_teacher_id)}` : 'No tutor chosen'}</p></div>
              <div className="flex items-center gap-2"><StatusBadge status={e.assignment_status} text={label[e.assignment_status]} /><Button size="sm" onClick={() => nav(`/admin/students?open=${e.id}`)}>Reassign</Button></div>
            </Card>))}</div>
        )
      ) : !rows.length ? <Empty title="No tutors here" /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((t) => <TeacherCard key={t.user_id} t={t} />)}</div>
          {pages > 1 && (
            <Card className="mt-4 px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-ink-soft">Showing <b className="text-ink">{(cur - 1) * PAGE + 1}</b> to <b className="text-ink">{Math.min(rows.length, cur * PAGE)}</b> of <b className="text-ink">{rows.length}</b> tutors</span>
              <div className="flex gap-2"><Button size="sm" disabled={cur === 1} onClick={() => setPage(cur - 1)}>Previous</Button><Button size="sm" disabled={cur === pages} onClick={() => setPage(cur + 1)}>Next</Button></div>
            </Card>
          )}
        </>
      )}

      {openId && data && <TeacherProfile t={data.tps.find((t) => t.user_id === openId)!} data={data} coord={coord} onClose={() => setOpenId(null)} reload={() => void reload()}
        onApprove={(t) => void decide(t, 'approved')} onReject={(t) => setRejecting(t)} onActive={(t, s) => void setActive(t, s)} />}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.profiles?.full_name ?? ''}`}
        footer={<><Button onClick={() => setRejecting(null)}>Back</Button><Button variant="danger" disabled={why.trim().length < 3} loading={busy} onClick={() => void decide(rejecting!, 'rejected', why.trim())}>Reject application</Button></>}>
        <Field label="Reason (kept in the tutor’s admin notes)" required><Textarea value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </Modal>
    </>
  )
}

type PTab = 'overview' | 'students' | 'schedule' | 'availability' | 'leave' | 'teaching' | 'earnings' | 'assign'

function TeacherProfile({ t, data, coord, onClose, reload, onApprove, onReject, onActive }: { t: Row; data: Row; coord: boolean; onClose: () => void; reload: () => void; onApprove: (t: Row) => void; onReject: (t: Row) => void; onActive: (t: Row, s: 'active' | 'suspended') => void }) {
  const { can } = useAuth()
  const p = t.profiles as Row
  const [tab, setTab] = useState<PTab>('overview')
  const { busy, run } = useAction()

  const extra = useAsync(async () => {
    const [rules, sessions, rates, items, exc] = await Promise.all([
      select('teacher_availability_rules', '*', (x) => x.eq('teacher_id', t.user_id).order('weekday').order('start_time')),
      select('sessions', 'id, start_at, status, session_participants(attendance)', (x) => x.eq('teacher_id', t.user_id).order('start_at', { ascending: false }).limit(200)),
      can('finance') ? select('teacher_rates', '*', (x) => x.eq('teacher_id', t.user_id).order('effective_from', { ascending: false })) : Promise.resolve([]),
      can('finance') ? select('earning_items', '*', (x) => x.eq('teacher_id', t.user_id)) : Promise.resolve([]),
      select('availability_exceptions', '*', (x) => x.eq('teacher_id', t.user_id).gte('on_date', todayIn('Asia/Kolkata')).order('on_date')),
    ])
    return { rules, sessions, rates, items, exc }
  }, [t.user_id])

  const mine = (data.enr as Row[]).filter((e) => e.primary_teacher_id === t.user_id)
  const leaves = (data.leaves as Row[]).filter((l) => l.teacher_id === t.user_id)
  const sess = (extra.data?.sessions ?? []) as Row[]
  const parts = sess.flatMap((s) => (s.session_participants as Row[]).map((x): Row => ({ ...x, status: s.status })))
  const decideLeave = (l: Row, status: 'approved' | 'rejected') => run(async () => {
    await unwrap(supabase.from('teacher_leaves').update({ status, decided_at: new Date().toISOString() }).eq('id', l.id)); reload()
  }, `Leave ${status}`)
  const earnTotal = (extra.data?.items as Row[] | undefined)?.reduce((a, i) => a + Number(i.rate_snapshot ?? 0), 0) ?? 0

  return (
    <Drawer open onClose={onClose} width="md:max-w-3xl" badge={<StatusBadge status={p.status === 'suspended' ? 'suspended' : t.approval_status} text={p.status === 'suspended' ? 'Suspended' : label[t.approval_status]} />} title={p.full_name}
      subtitle={`Languages: ${(t.languages as string[]).join(', ') || '—'} · Joined ${fmtDate(p.created_at)}`}>
      <Tabs<PTab> value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'students', label: 'Students', count: mine.filter((e) => e.assignment_status === 'accepted' && ['active', 'on_hold'].includes(e.status)).length }, { id: 'schedule', label: 'Schedule' }, { id: 'availability', label: 'Availability' }, { id: 'leave', label: 'Leave', count: leaves.filter((l) => l.status === 'pending').length || undefined }, { id: 'teaching', label: 'Teaching' }, ...(can('finance') ? [{ id: 'earnings' as const, label: 'Earnings' }] : []), { id: 'assign', label: 'Assignments' }]} />

      {tab === 'overview' && (
        <>
          <Section title="Contact & profile">
            {coord ? <TeacherEditForm key={`${t.user_id}-${t.updated_at}-${p.updated_at}`} t={t} onSaved={reload} /> : (
              <dl className="grid sm:grid-cols-2 gap-4">
                <KV k="Email" v={<a className="inline-flex gap-1.5 items-center" href={`mailto:${p.email}`}><Mail size={14} />{p.email}</a>} /><KV k="Phone" v={p.phone ? <span className="inline-flex gap-1.5 items-center"><Phone size={14} />{p.phone}</span> : null} />
                <KV k="Experience" v={t.experience_years != null ? `${t.experience_years} years` : null} /><KV k="Approved" v={t.approved_at ? fmtDate(t.approved_at) : null} />
                <KV k="Qualifications" v={t.qualifications} />
                <KV k="Languages taught" v={(t.languages as string[]).join(', ') || null} />
              </dl>
            )}
          </Section>
          {coord && (
            <div className="flex flex-wrap gap-2">
              {t.approval_status === 'pending_review' && <><Button variant="primary" onClick={() => onApprove(t)}><UserCheck size={15} /> Approve</Button><Button onClick={() => onReject(t)}>Reject</Button></>}
              {t.approval_status === 'rejected' && <Button onClick={() => onApprove(t)}>Approve after all</Button>}
              {p.status === 'active' ? <Button variant="danger" onClick={() => onActive(t, 'suspended')}><ShieldOff size={15} /> Suspend access</Button> : <Button onClick={() => onActive(t, 'active')}>Reactivate account</Button>}
            </div>
          )}
        </>
      )}

      {tab === 'students' && <Section title="Assigned students">{!mine.length ? <Empty title="No students assigned" /> : <ul className="divide-y divide-line text-sm">{mine.map((e) => <li key={e.id} className="py-2.5 flex justify-between gap-3"><span><b>{e.students?.full_name}</b> <span className="text-ink-soft">· {one<Row>(e.languages)?.name}</span></span><span className="flex gap-1.5"><StatusBadge status={e.assignment_status} text={label[e.assignment_status]} /><StatusBadge status={e.status} text={label[e.status]} /></span></li>)}</ul>}</Section>}

      {tab === 'schedule' && <Section title="Class schedule (latest 200)">{extra.loading ? <Spinner /> : !sess.length ? <Empty title="No classes yet" /> : <ul className="divide-y divide-line text-sm">{sess.slice(0, 60).map((s) => <li key={s.id} className="py-2 flex justify-between gap-3"><span>{fmtDateTime(s.start_at)}</span><span className="flex gap-2 items-center text-ink-soft">{(s.session_participants as Row[]).length} learner{(s.session_participants as Row[]).length === 1 ? '' : 's'}<StatusBadge status={s.status} text={label[s.status]} /></span></li>)}</ul>}</Section>}

      {tab === 'availability' && (
        <Section title="Weekly hours">
          {extra.loading ? <Spinner /> : !extra.data?.rules.length ? <Empty title="No weekly hours set yet" /> : <ul className="space-y-1.5 text-sm">{extra.data.rules.map((r) => <li key={r.id} className="flex justify-between"><b>{WEEKDAYS[r.weekday]}</b><span>{fmtClock(r.start_time)} – {fmtClock(r.end_time)}</span></li>)}</ul>}
          {!!extra.data?.exc.length && <><p className="font-bold text-sm mt-4 mb-1.5">Upcoming exceptions</p><ul className="text-sm space-y-1">{extra.data.exc.map((x) => <li key={x.id}>{fmtDate(x.on_date)} · {x.start_time ? `${fmtClock(x.start_time)} – ${fmtClock(x.end_time)}` : 'All day'} {x.note && <span className="text-ink-soft">({x.note})</span>}</li>)}</ul></>}
        </Section>
      )}

      {tab === 'leave' && (
        <Section title="Leave history">
          {!leaves.length ? <Empty title="No leave recorded" /> : <ul className="divide-y divide-line text-sm">{leaves.map((l) => (
            <li key={l.id} className="py-2.5 flex flex-wrap justify-between gap-2 items-center"><span><b>{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}</b> <span className="text-ink-soft">· {l.reason}{l.note ? ` · ${l.note}` : ''}</span></span>
              <span className="flex gap-2 items-center"><StatusBadge status={l.status} text={label[l.status]} />{coord && l.status === 'pending' && <><Button size="sm" variant="primary" disabled={busy} onClick={() => void decideLeave(l, 'approved')}>Approve</Button><Button size="sm" disabled={busy} onClick={() => void decideLeave(l, 'rejected')}>Decline</Button></>}</span></li>))}</ul>}
          <p className="text-xs text-ink-soft mt-3">Leave days block new bookings. Classes already booked on those days must be rescheduled, cancelled or reassigned from the scheduler.</p>
        </Section>
      )}

      {tab === 'teaching' && (
        <Section title="Teaching history">
          {extra.loading ? <Spinner /> : (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4"><KV k="Classes completed" v={sess.filter((s) => s.status === 'completed').length} /><KV k="Cancelled" v={sess.filter((s) => s.status === 'cancelled').length} /><KV k="Learners present" v={parts.filter((x) => x.attendance === 'present' && x.status === 'completed').length} /><KV k="Learners absent" v={parts.filter((x) => x.attendance === 'absent').length} /></dl>
          )}
        </Section>
      )}

      {tab === 'earnings' && (
        <Section title="Rates & earnings (Finance)">
          {!extra.data?.rates.length ? <Notice>No rate set yet. Set one under Tutor payouts so attended classes can earn.</Notice> : <ul className="text-sm space-y-1.5 mb-4">{extra.data.rates.map((r) => <li key={r.id} className="flex justify-between"><span>{r.enrollment_id ? 'Student-specific rate' : 'Default rate'} from {fmtDate(r.effective_from)}</span><b>{inr(r.amount)}</b></li>)}</ul>}
          <p className="text-sm"><b>{extra.data?.items.length ?? 0}</b> attended learner-sessions · earned so far <b>{inr(earnTotal)}</b></p>
        </Section>
      )}

      {tab === 'assign' && (
        <Section title="Assignment history">
          {!mine.length ? <Empty title="No assignments yet" /> : <ul className="divide-y divide-line text-sm">{mine.map((e) => <li key={e.id} className="py-2.5 flex justify-between gap-2"><span>{e.students?.full_name} · {one<Row>(e.languages)?.name}<span className="text-ink-soft"> · since {fmtDate(e.created_at)}</span></span><StatusBadge status={e.assignment_status} text={label[e.assignment_status]} /></li>)}</ul>}
        </Section>
      )}
    </Drawer>
  )
}

function TeacherEditForm({ t, onSaved }: { t: Row; onSaved: () => void }) {
  const p = t.profiles as Row
  const [f, setF] = useState({ full_name: p.full_name ?? '', phone: p.phone ?? '', experience_years: t.experience_years != null ? String(t.experience_years) : '', qualifications: t.qualifications ?? '', languages: (t.languages as string[]).join(', '), admin_notes: t.admin_notes ?? '' })
  const [err, setErr] = useState('')
  const { busy, run } = useAction()
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = () => run(async () => {
    setErr('')
    if (f.full_name.trim().length < 2) return setErr('Enter the tutor’s name.')
    if (f.phone && !/^[0-9]{7,15}$/.test(digits(f.phone))) return setErr('Phone must be 7–15 digits.')
    if (f.experience_years !== '' && !/^\d{1,2}$/.test(f.experience_years.trim())) return setErr('Experience must be a whole number of years.')
    await unwrap(supabase.from('profiles').update({ full_name: f.full_name.trim(), phone: f.phone ? digits(f.phone) : null }).eq('id', t.user_id))
    await unwrap(supabase.from('teacher_profiles').update({
      experience_years: f.experience_years === '' ? null : Number(f.experience_years), qualifications: f.qualifications.trim() || null,
      languages: f.languages.split(',').map((x) => x.trim()).filter(Boolean), admin_notes: f.admin_notes.trim() || null,
    }).eq('user_id', t.user_id))
    onSaved()
  }, 'Tutor details saved')
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name" required><Input value={f.full_name} onChange={s('full_name')} /></Field>
        <Field label="Email" hint="Login email. It cannot be changed here."><Input value={p.email ?? ''} disabled readOnly /></Field>
        <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={s('phone')} /></Field>
        <Field label="Experience (years)"><Input inputMode="numeric" value={f.experience_years} onChange={s('experience_years')} /></Field>
        <Field label="Languages taught" hint="Comma separated, for example: English, Tamil" className="sm:col-span-2"><Input value={f.languages} onChange={s('languages')} /></Field>
        <Field label="Qualifications" className="sm:col-span-2"><Textarea value={f.qualifications} onChange={s('qualifications')} /></Field>
        <Field label="Admin notes (private)" className="sm:col-span-2"><Textarea value={f.admin_notes} onChange={s('admin_notes')} /></Field>
      </div>
      {err && <p role="alert" className="text-sm text-red-600 mt-3">{err}</p>}
      <div className="mt-4"><Button variant="primary" loading={busy} onClick={() => void save()}>Save changes</Button></div>
    </>
  )
}
