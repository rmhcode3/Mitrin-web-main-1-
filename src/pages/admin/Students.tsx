import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { AGE_GROUPS, LEVELS, loadLanguages } from '../../lib/domain'
import { TIMEZONES, digits, fmtDateTime, label } from '../../lib/format'
import { Badge, Button, DataTable, Empty, ErrorBox, ExportMenu, Field, Input, Modal, PageHeader, SearchBox, Select, Spinner, StatusBadge } from '../../components/ui'
import { StudentDrawer } from './StudentDrawer'
import { DateRangeFilter, useDateRange } from '../../components/DateRange'

const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

function NewStudent({ languages, onClose, onDone }: { languages: Row[]; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ full_name: '', parent_name: '', phone: '', email: '', language_id: '', level: 'Beginner', age_group: 'Adult (18+)', timezone: 'Asia/Kolkata', agreed_classes: '', preferred_timing: '' })
  const [err, setErr] = useState('')
  const { busy, run } = useAction()
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = () => run(async () => {
    setErr('')
    if (f.full_name.trim().length < 2) return setErr('Enter the learner’s name.')
    if (!f.language_id) return setErr('Choose a language.')
    if (f.phone && !/^[0-9]{7,15}$/.test(digits(f.phone))) return setErr('Phone must be 7–15 digits.')
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Enter a valid email.')
    const stu = await unwrap(supabase.from('students').insert({ full_name: f.full_name.trim(), level: f.level, age_group: f.age_group, timezone: f.timezone }).select('id').single()) as Row
    await unwrap(supabase.from('student_contacts').insert({ student_id: stu.id, parent_name: f.parent_name.trim() || null, phone: f.phone ? digits(f.phone) : null, email: f.email.trim() || null }))
    const en = await unwrap(supabase.from('enrollments').insert({ student_id: stu.id, language_id: f.language_id, agreed_classes: f.agreed_classes ? Number(f.agreed_classes) : null, preferred_timing: f.preferred_timing.trim() || null }).select('id').single()) as Row
    onDone(en.id)
  }, 'Student created')
  return (
    <Modal open wide onClose={onClose} title="Add student directly" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Create student</Button></>}>
      <p className="text-sm text-ink-soft mb-4">Most students arrive by converting an enquiry. Use this for learners who enrol without one.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Learner name" required><Input value={f.full_name} onChange={s('full_name')} /></Field>
        <Field label="Language" required><Select value={f.language_id} onChange={s('language_id')}><option value="">Choose…</option>{languages.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Parent / contact name"><Input value={f.parent_name} onChange={s('parent_name')} /></Field>
        <Field label="WhatsApp / phone"><Input inputMode="tel" value={f.phone} onChange={s('phone')} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={s('email')} /></Field>
        <Field label="Time zone"><Select value={f.timezone} onChange={s('timezone')}>{TIMEZONES.map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Level"><Select value={f.level} onChange={s('level')}>{LEVELS.map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Age group"><Select value={f.age_group} onChange={s('age_group')}>{AGE_GROUPS.map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Agreed classes (optional)"><Input inputMode="numeric" value={f.agreed_classes} onChange={s('agreed_classes')} /></Field>
        <Field label="Preferred timing (optional)"><Input value={f.preferred_timing} onChange={s('preferred_timing')} /></Field>
      </div>
      {err && <p role="alert" className="text-sm text-red-600 mt-3">{err}</p>}
    </Modal>
  )
}

export default function Students() {
  const { can } = useAuth()
  const coord = can('coordinator')
  const lowAt = useSetting<number>('credits.low_balance_warning_at', 2)
  const [sp, setSp] = useSearchParams()
  const openId = sp.get('open')
  const [q, setQ] = useState('')
  const range = useDateRange()
  const [status, setStatus] = useState('')
  const [lang, setLang] = useState('')
  const [tutor, setTutor] = useState('')
  const [pay, setPay] = useState('')
  const [low, setLow] = useState(false)
  const [adding, setAdding] = useState(false)

  const { data, loading, error, reload } = useAsync(async () => {
    const [enr, bal, mk, ps, up, tutors, languages] = await Promise.all([
      select('enrollments', '*, students(*, student_contacts(*)), languages(name)', (x) => x.order('created_at', { ascending: false })),
      select('enrollment_balances'), select('enrollment_makeup'), select('enrollment_payment_status'),
      select('session_participants', 'enrollment_id, sessions!inner(start_at,status)', (x) => x.eq('sessions.status', 'scheduled').gte('sessions.start_at', new Date().toISOString())),
      select('profiles', 'id, full_name, teacher_profiles!user_id(languages, approval_status)', (x) => x.eq('role', 'teacher')), loadLanguages(),
    ])
    const by = <T extends Row>(rows: T[]) => new Map(rows.map((r) => [r.enrollment_id as string, r]))
    const next = new Map<string, string>()
    for (const r of up) { const t = one<Row>(r.sessions)?.start_at as string; if (t && (!next.get(r.enrollment_id) || t < next.get(r.enrollment_id)!)) next.set(r.enrollment_id, t) }
    const teachers = tutors.map((t) => ({ id: t.id, name: t.full_name, languages: (one<Row>(t.teacher_profiles)?.languages ?? []) as string[], approved: one<Row>(t.teacher_profiles)?.approval_status === 'approved' }))
    return { enr, bal: by(bal), mk: by(mk), ps: by(ps), next, teachers, languages }
  })

  const rows = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.enr.filter((e) => {
      const st = e.students as Row; const c = one<Row>(st.student_contacts) ?? {}
      if (s && ![st.full_name, c.parent_name, c.phone, c.email, e.languages?.name].some((v) => String(v ?? '').toLowerCase().includes(s))) return false
      if (status && e.status !== status) return false
      if (lang && e.language_id !== lang) return false
      if (tutor && e.primary_teacher_id !== tutor) return false
      if (pay && data.ps.get(e.id)?.state !== pay) return false
      if (low && !((data.bal.get(e.id)?.remaining ?? 0) <= lowAt && ['active', 'pending_completion'].includes(e.status))) return false
      if (!range.inRange(e.created_at)) return false
      return true
    })
  }, [data, q, status, lang, tutor, pay, low, lowAt, range.from, range.to])

  const tName = (id: string | null) => data?.teachers.find((t) => t.id === id)?.name ?? '—'
  const cols = [
    { header: 'Student', value: (e: Row) => e.students.full_name }, { header: 'Parent', value: (e: Row) => one<Row>(e.students.student_contacts)?.parent_name }, { header: 'Phone', value: (e: Row) => one<Row>(e.students.student_contacts)?.phone },
    { header: 'Course', value: (e: Row) => e.languages?.name }, { header: 'Level', value: (e: Row) => e.students.level }, { header: 'Tutor', value: (e: Row) => tName(e.primary_teacher_id) },
    { header: 'Status', value: (e: Row) => label[e.status] }, { header: 'Classes remaining', value: (e: Row) => data?.bal.get(e.id)?.remaining ?? 0 }, { header: 'Payment status', value: (e: Row) => label[data?.ps.get(e.id)?.state ?? ''] },
  ]

  return (
    <>
      <PageHeader title="Enrollment" subtitle="One row per course enrollment. A learner can have several courses, each with its own classes, tutor and calendar."
        actions={<><ExportMenu name="students" rows={rows} cols={cols} />{coord && <Button variant="dark" onClick={() => setAdding(true)}><Plus size={16} /> Add student</Button>}</>} />
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <SearchBox className="flex-1 min-w-52" value={q} onChange={setQ} placeholder="Search name, parent, phone or language…" />
        <Select aria-label="Status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['draft', 'awaiting_tutor', 'active', 'on_hold', 'pending_completion', 'completed', 'withdrawn'].map((s) => <option key={s} value={s}>{label[s]}</option>)}</Select>
        <Select aria-label="Language" className="w-40" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">All languages</option>{data?.languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        <Select aria-label="Tutor" className="w-44" value={tutor} onChange={(e) => setTutor(e.target.value)}><option value="">All tutors</option>{data?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select aria-label="Payment" className="w-40" value={pay} onChange={(e) => setPay(e.target.value)}><option value="">Any payment</option>{['cleared', 'due', 'overdue', 'on_hold', 'no_plan'].map((s) => <option key={s} value={s}>{label[s] ?? s}</option>)}</Select>
        <label className="inline-flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="accent-brand-500 h-4 w-4" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low classes (≤{lowAt})</label>
      </div>

      <div className="mb-4"><DateRangeFilter range={range} /></div>

      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <DataTable grid rows={rows} rowKey={(e) => e.id} onRowClick={(e) => setSp({ open: e.id })} empty={<Empty title="No students match" hint="Convert an enquiry or add a student to get started." />}
          columns={[
            { h: 'Student', primary: true, cell: (e) => <div><b>{e.students.full_name}</b><div className="text-xs text-ink-soft">{one<Row>(e.students.student_contacts)?.parent_name ?? ''}</div></div> },
            { h: 'Course', cell: (e) => <span>{e.languages?.name}{e.students.level && <span className="text-ink-soft"> · {e.students.level}</span>}</span> },
            { h: 'Tutor', cell: (e) => tName(e.primary_teacher_id) },
            { h: 'Status', cell: (e) => <StatusBadge status={e.status} text={label[e.status]} /> },
            { h: 'Remaining', cell: (e) => { const r = data?.bal.get(e.id)?.remaining ?? 0; return <b className={r <= lowAt && ['active', 'pending_completion'].includes(e.status) ? 'text-amber-700' : ''}>{r}</b> } },
            { h: 'Makeup', cell: (e) => { const m = Math.min(data?.mk.get(e.id)?.missed ?? 0, data?.bal.get(e.id)?.remaining ?? 0); return m ? <Badge tone="orange">{m} to arrange</Badge> : '—' } },
            { h: 'Next class', cell: (e) => { const n = data?.next.get(e.id); return n ? fmtDateTime(n) : '—' } },
            { h: 'Payment', cell: (e) => { const p = data?.ps.get(e.id)?.state; return p ? <StatusBadge status={p} text={label[p]} /> : '—' } },
          ]} />
      )}

      {openId && data && <StudentDrawer key={openId} enrollmentId={openId} teachers={data.teachers} onClose={() => setSp({})} onChanged={() => void reload()} />}
      {adding && data && <NewStudent languages={data.languages} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); void reload(); setSp({ open: id }) }} />}
    </>
  )
}
