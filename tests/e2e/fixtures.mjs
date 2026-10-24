// Network fixtures for the browser smoke test. They mimic what PostgREST returns (including embedded rows)
// so every screen can be rendered and clicked through without real credentials. They are NOT a substitute for
// a live login: see tests/db-scenarios.mjs for the proof that the real database rules hold.
const now = Date.now()
const H = 3600_000
const iso = (h) => new Date(now + h * H).toISOString()
const day = (d) => new Date(now + d * 24 * H).toISOString().slice(0, 10)

export const ID = {
  admin: '00000000-0000-4000-8000-000000000001', coord: '00000000-0000-4000-8000-000000000002', fin: '00000000-0000-4000-8000-000000000003',
  t1: '00000000-0000-4000-8000-0000000000a1', t2: '00000000-0000-4000-8000-0000000000a2', tp: '00000000-0000-4000-8000-0000000000a3',
  L1: '00000000-0000-4000-8000-0000000000b1', L2: '00000000-0000-4000-8000-0000000000b2',
  s1: '00000000-0000-4000-8000-0000000000c1', s2: '00000000-0000-4000-8000-0000000000c2', s3: '00000000-0000-4000-8000-0000000000c3',
  e1: '00000000-0000-4000-8000-0000000000d1', e2: '00000000-0000-4000-8000-0000000000d2', e3: '00000000-0000-4000-8000-0000000000d3',
}

export const profiles = {
  admin: { id: ID.admin, role: 'admin', full_name: 'Alex Rivers', email: 'admin@example.test', phone: null, status: 'active', admin_permissions: ['super_admin'], created_at: iso(-900) },
  coord: { id: ID.coord, role: 'admin', full_name: 'Coordinator One', email: 'coord@example.test', phone: null, status: 'active', admin_permissions: ['coordinator'], created_at: iso(-800) },
  fin: { id: ID.fin, role: 'admin', full_name: 'Finance One', email: 'fin@example.test', phone: null, status: 'active', admin_permissions: ['finance'], created_at: iso(-700) },
  t1: { id: ID.t1, role: 'teacher', full_name: 'Priya Sharma', email: 'priya@example.test', phone: '919876543210', status: 'active', admin_permissions: [], created_at: iso(-600) },
  tp: { id: ID.tp, role: 'teacher', full_name: 'Pending Tutor', email: 'pending@example.test', phone: null, status: 'active', admin_permissions: [], created_at: iso(-5) },
}

const tpRow = (id, status, langs, p) => ({ user_id: id, approval_status: status, languages: langs, experience_years: 4, qualifications: 'M.A. Linguistics', timezone: 'Asia/Kolkata', admin_notes: null, approved_at: status === 'approved' ? iso(-500) : null, approved_by: null, created_at: iso(-600), profiles: p, })
const teacher_profiles = [tpRow(ID.t1, 'approved', ['Hindi', 'English'], profiles.t1), tpRow(ID.t2, 'approved', ['English'], { id: ID.t2, full_name: 'Sam Teacher', email: 'sam@example.test', phone: null, status: 'active', created_at: iso(-400) }), tpRow(ID.tp, 'pending_review', ['Hindi'], profiles.tp)]

const lang = (id, name) => ({ id, name })
const stu = (id, name) => ({ id, full_name: name, level: 'Beginner', age_group: 'Adult (18+)', timezone: 'Asia/Kolkata', notes: null, created_at: iso(-300), student_contacts: { student_id: id, parent_name: `${name} Parent`, phone: '919000000001', email: 'p@example.test' } })
const enr = (id, s, st, status, assign, l = ID.L1, name = 'Hindi') => ({ id, student_id: s.id, language_id: l, status, term_start: null, term_end: null, agreed_classes: 10, preferred_timing: 'Mon/Wed evenings', primary_teacher_id: ID.t1, assignment_status: assign, meeting_link: null, created_at: iso(-200), updated_at: iso(-1), students: s, languages: { name } })
const S1 = stu(ID.s1, 'Aarav Mehta'), S2 = stu(ID.s2, 'Diya Sen'), S3 = stu(ID.s3, 'Kabir Rao')
const enrollments = [enr(ID.e1, S1, null, 'active', 'accepted'), enr(ID.e2, S2, null, 'awaiting_tutor', 'awaiting_tutor'), enr(ID.e3, S3, null, 'on_hold', 'accepted')]

const part = (e, name, att) => ({ enrollment_id: e, attendance: att, absence_reason: null, enrollments: { id: e, student_id: e, primary_teacher_id: ID.t1, students: { full_name: name, timezone: 'Asia/Kolkata' }, languages: { name: 'Hindi' } } })
const ses = (id, a, b, status, parts) => ({ id, teacher_id: ID.t1, start_at: iso(a), end_at: iso(b), status, meeting_link: null, series_id: null, cancel_reason: null, session_participants: parts })
const sessions = [ses('s-past', -3, -2, 'scheduled', [part(ID.e1, 'Aarav Mehta', 'unmarked'), part(ID.e3, 'Kabir Rao', 'unmarked')]), ses('s-soon', 1, 2, 'scheduled', [part(ID.e1, 'Aarav Mehta', 'unmarked')]), ses('s-next', 26, 27, 'scheduled', [part(ID.e1, 'Aarav Mehta', 'unmarked')]), ses('s-done', -50, -49, 'completed', [part(ID.e1, 'Aarav Mehta', 'present')])]
// sessions embedded in participants (select session_participants ... sessions!inner)
const session_participants = sessions.flatMap((s) => s.session_participants.map((p) => ({ ...p, sessions: { id: s.id, start_at: s.start_at, end_at: s.end_at, status: s.status, teacher_id: s.teacher_id, meeting_link: null } })))

const lead = (id, st, learner, l = ID.L1, name = 'Hindi') => ({ id, enquirer_name: `${learner} Family`, phone: '919111122223', email: null, learner_name: learner, language_id: l, age_group: 'Adult (18+)', level: 'Beginner', preferred_timing: 'Weekends', group_preference: 'either', source: 'Call', stage: st, notes: 'Called back', converted_student_id: null, converted_enrollment_id: null, external_id: null, created_at: iso(-30), updated_at: iso(-2), languages: { name } })
const leads = [lead('l1', 'new', 'Nikhil Saxena'), lead('l2', 'contacted', 'Tarun Mishra', ID.L2, 'English'), lead('l3', 'demo_scheduled', 'Rahul Lodha'), lead('l4', 'demo_done', 'Amit Gupta'), lead('l5', 'converted', 'Lalit Mukti'), lead('l6', 'lost', 'Old Lead')]
const demo = (id, l, st, att) => ({ id, lead_id: l, attempt: att, teacher_id: ID.t1, language_id: ID.L1, learner_name: 'Rahul Lodha', level: 'Beginner', age_group: null, start_at: iso(20), end_at: iso(20.5), status: st, meeting_link: null, outcome: null, decline_reason: null, created_by: ID.coord, created_at: iso(-30), responded_at: null, leads: leads.find((x) => x.id === l) })
const demos = [demo('d1', 'l3', 'awaiting_tutor', 1), demo('d2', 'l4', 'accepted', 1)]

const plan = (id, e, total, paid) => ({ plan_id: id, enrollment_id: e, status: 'active', total_amount: total, total_due: total, paid, outstanding: total - paid, overdue_amount: e === ID.e3 ? total - paid : 0, next_due: day(5) })
const fee_plan_summary = [plan('p1', ID.e1, 6000, 2000), plan('p3', ID.e3, 4000, 0)]

const defs = [
  ['schedule.max_class_minutes', 'Classes & scheduling', 'Longest class allowed', 'integer', 480, 15, 720, null, 'minutes', 'super_admin'], ['schedule.max_series_weeks', 'Classes & scheduling', 'Longest repeat plan', 'integer', 26, 1, 52, null, 'weeks', 'super_admin'],
  ['leave.pending_blocks_scheduling', 'Leave', 'Leave blocks booking while awaiting approval', 'boolean', true, null, null, null, null, 'super_admin'], ['credits.low_balance_warning_at', 'Class credits', 'Warn when classes remaining reaches', 'integer', 2, 0, 20, null, 'classes', 'super_admin'],
  ['fees.default_installment_day', 'Fees', 'Usual installment due day of the month', 'integer', 1, 1, 28, null, 'day of month', 'finance'], ['org.business_name', 'Organization', 'Business name', 'text', 'Mitrin The Language School', null, null, null, null, 'super_admin'],
  ['schedule.slot_step_minutes', 'Classes & scheduling', 'Time picker step', 'enum', 15, null, null, [5, 10, 15, 30], 'minutes', 'super_admin'],
].map(([key, grp, label, type, dv, min, max, options, unit, perm]) => ({ key, grp, label, help: `Help for ${label}.`, type, default_value: dv, min_value: min, max_value: max, options, unit, requires_reason: true, edit_permission: perm }))

export const tables = {
  languages: [lang(ID.L1, 'Hindi'), lang(ID.L2, 'English')].map((l) => ({ ...l, active: true, created_at: iso(-999) })),
  profiles: [profiles.admin, profiles.coord, profiles.fin, profiles.t1, profiles.tp, { id: ID.t2, role: 'teacher', full_name: 'Sam Teacher', email: 'sam@example.test', status: 'active', admin_permissions: [], created_at: iso(-400) }].map((p) => ({ ...p, teacher_profiles: teacher_profiles.find((t) => t.user_id === p.id) ?? null })),
  teacher_profiles, enrollments, sessions, session_participants, leads, demos, fee_plan_summary,
  students: [S1, S2, S3], student_contacts: [S1, S2, S3].map((s) => s.student_contacts),
  enrollment_balances: [{ enrollment_id: ID.e1, allocated: 10, reserved: 2, fulfilled: 3, remaining: 5 }, { enrollment_id: ID.e2, allocated: 0, reserved: 0, fulfilled: 0, remaining: 0 }, { enrollment_id: ID.e3, allocated: 4, reserved: 0, fulfilled: 1, remaining: 3 }],
  enrollment_makeup: [{ enrollment_id: ID.e1, missed: 2, oldest_missed: iso(-24 * 30) }, { enrollment_id: ID.e3, missed: 0, oldest_missed: null }],
  enrollment_payment_status: [{ enrollment_id: ID.e1, state: 'due' }, { enrollment_id: ID.e2, state: 'no_plan' }, { enrollment_id: ID.e3, state: 'on_hold' }],
  credit_movements: [{ id: 'c1', enrollment_id: ID.e1, quantity: 10, reason: 'New enrollment', allocation_period: day(-40), created_at: iso(-900) }],
  fee_plans: [{ id: 'p1', enrollment_id: ID.e1, total_amount: 6000, status: 'active' }, { id: 'p3', enrollment_id: ID.e3, total_amount: 4000, status: 'active' }],
  fee_installments: [{ id: 'i1', plan_id: 'p1', due_date: day(5), amount: 3000, label: 'Installment 1' }, { id: 'i2', plan_id: 'p1', due_date: day(35), amount: 3000, label: 'Installment 2' }],
  payments: [{ id: 'pay1', plan_id: 'p1', paid_on: day(-3), amount: 2000, method: 'UPI', reference: 'UTR123', payer_name: 'Parent', note: null }],
  payment_allocations: [{ payment_id: 'pay1', installment_id: 'i1', amount: 2000, payments: { plan_id: 'p1' } }],
  fee_adjustments: [], holds: [{ id: 'h1', enrollment_id: ID.e3, reason: 'Unpaid', imposed_at: iso(-48), released_at: null }],
  earning_items: [
    { id: 'ei1', session_id: 's-done', enrollment_id: ID.e1, teacher_id: ID.t1, earned_on: day(-2), rate_snapshot: 100, payout_id: null, enrollments: { students: { full_name: 'Aarav Mehta' }, languages: { name: 'Hindi' } } },
    { id: 'ei2', session_id: 's-done', enrollment_id: ID.e3, teacher_id: ID.t1, earned_on: day(-2), rate_snapshot: null, payout_id: null, enrollments: { students: { full_name: 'Kabir Rao' }, languages: { name: 'Hindi' } } },
  ],
  teacher_rates: [{ id: 'r1', teacher_id: ID.t1, enrollment_id: null, amount: 100, currency: 'INR', effective_from: day(-60), note: null }],
  teacher_availability_rules: [1, 3].map((w) => ({ id: `r${w}`, teacher_id: ID.t1, weekday: w, start_time: '16:00:00', end_time: '20:00:00' })),
  availability_exceptions: [], availability_confirmations: [],
  teacher_leaves: [{ id: 'lv1', teacher_id: ID.t1, start_date: day(3), end_date: day(3), reason: 'Personal', note: null, status: 'pending' }],
  setting_definitions: defs, app_settings: [], settings_changes: [],
  audit_events: [{ id: 1, actor_id: ID.coord, action: 'update', entity_type: 'leads', entity_id: 'l1', before_value: { stage: 'new' }, after_value: { stage: 'contacted' }, reason: null, created_at: iso(-2) }],
  session_changes: [], student_notes: 'UNDEPLOYED', payouts: 'UNDEPLOYED', payout_adjustments: 'UNDEPLOYED',
}

export const rpcResult = (fn, body) => {
  if (fn === 'setting_value') return defs.find((d) => d.key === body.p_key)?.default_value ?? null
  if (fn === 'find_tutors') return [{ tutor_id: ID.t1, tutor_name: 'Priya Sharma', availability: 'confirmed' }, { tutor_id: ID.t2, tutor_name: 'Sam Teacher', availability: 'tentative' }]
  if (fn === 'mark_attendance') return { completed: true, present: 1, missing_rate: 0 }
  if (fn === 'sync_enrollment_completion') return 0
  if (fn === 'schedule_session') return 'new-session'
  if (fn === 'convert_lead') return { student_id: ID.s1, enrollment_id: ID.e1 }
  return null
}
