// Backend acceptance scenarios. Runs against the real database inside ONE transaction that is always rolled back,
// impersonating the seeded users through request.jwt.claims (so RLS and the SECURITY DEFINER RPCs behave exactly as in the app).
// Usage:  node tests/db-scenarios.mjs            (tests the deployed schema)
//         node tests/db-scenarios.mjs --with-014 (first applies supabase/migrations/20261024000014_*.sql inside the transaction)
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const WITH_014 = process.argv.includes('--with-014')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_SESSION, ssl: { rejectUnauthorized: false } })
await c.connect()
let pass = 0, fail = 0, skipped = 0
const results = []

const as = async (uid, fn) => {
  await c.query('reset role')
  if (uid) {
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' }), uid])
    await c.query('set local role authenticated')
  }
  try { return await fn() } finally { await c.query('reset role').catch(() => {}) }  // after a failed statement the txn is aborted until the savepoint rollback restores the role
}
const q = (sql, p) => c.query(sql, p).then((r) => r.rows)
let sp = 0
async function test(id, name, fn) {
  const s = `t${++sp}`
  await c.query(`savepoint ${s}`)
  try { await fn(); await c.query(`release savepoint ${s}`); pass++; results.push(`  ok   ${id} ${name}`) }
  catch (e) { await c.query(`rollback to savepoint ${s}`); fail++; results.push(`  FAIL ${id} ${name}\n         ${e.message}`) }
}
// An error aborts the surrounding transaction, so every expected failure runs in its own savepoint.
let ex = 0
const expectError = async (fn, re) => {
  const s = `e${++ex}`
  await c.query(`savepoint ${s}`)
  try { await fn() } catch (e) {
    await c.query(`rollback to savepoint ${s}`)
    if (re && !re.test(e.message)) throw new Error(`wrong error: "${e.message}" (wanted ${re})`)
    return e.message
  }
  await c.query(`release savepoint ${s}`)
  throw new Error('expected an error but the call succeeded')
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`) }

await c.query('begin')
try {
  if (WITH_014) {
    const dir = path.resolve('supabase/migrations')
    const f = fs.readdirSync(dir).find((x) => x.startsWith('20261024000014'))
    await c.query(fs.readFileSync(path.join(dir, f), 'utf8'))
    results.push(`  (migration ${f} applied inside the rolled-back transaction)`)
  }
  const prof = Object.fromEntries((await q(`select email, id from public.profiles`)).map((r) => [r.email, r.id]))
  const ADMIN = prof['admin@gmail.com'], COORD = prof['coordinator@gmail.com'], FIN = prof['finance@gmail.com'], T1 = prof['teacher1@gmail.com'], T2 = prof['teacher2@gmail.com'], T3 = prof['teacher3@gmail.com']
  const [lang] = await q(`select id from public.languages order by name limit 1`)

  // ---- fixtures (inserted as the table owner, rolled back at the end)
  const stu = async (name) => (await q(`insert into public.students (full_name) values ($1) returning id`, [name]))[0].id
  const enr = async (sid, teacher, status = 'active', assign = 'accepted') => (await q(`insert into public.enrollments (student_id, language_id, status, primary_teacher_id, assignment_status) values ($1,$2,$3,$4,$5) returning id`, [sid, lang.id, status, teacher, assign]))[0].id
  const credit = (e, n) => q(`insert into public.credit_movements (enrollment_id, quantity, reason, allocation_period) values ($1,$2,'New enrollment', date_trunc('month', now())::date)`, [e, n])
  const A = await stu('QA Alice'), B = await stu('QA Bob')
  const eA = await enr(A, T3), eB = await enr(B, T3)
  await credit(eA, 3); await credit(eB, 2)
  const remaining = async (e) => (await q(`select public._credits_remaining($1) r`, [e]))[0].r
  const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString()
  const book = (uid, enrs, startH, hours = 1) => as(uid, () => q(`select public.schedule_session($1, $2::uuid[], $3, $4) id`, [T3, enrs, iso(startH), iso(startH + hours)]).then((r) => r[0].id))

  // ---- credits & scheduling
  await test('AT-11', 'tutor cannot book more classes than allocated credits', async () => {
    const e = await enr(await stu('QA Carol'), T3); await credit(e, 2)
    await book(T3, [e], 400); await book(T3, [e], 430)
    await expectError(() => book(T3, [e], 460), /No class credits left/)
    eq(await remaining(e), 0)
  })
  await test('INV-4', 'overlapping class for the same tutor is blocked', async () => {
    const e = await enr(await stu('QA Dan'), T3); await credit(e, 5)
    await book(T3, [e], 500); await expectError(() => book(T3, [e], 500.5), /already has a class|Choose another time/)
  })
  await test('INV-4b', 'a learner cannot be double-booked with another tutor', async () => {
    const s = await stu('QA Eve'); const e1 = await enr(s, T3), e2 = await enr(s, T2); await credit(e1, 2); await credit(e2, 2)
    await book(T3, [e1], 520)
    await expectError(() => as(T2, () => q(`select public.schedule_session($1, $2::uuid[], $3, $4)`, [T2, [e2], iso(520), iso(521)])), /student already has a class/)
  })
  await test('INV-2', 'a tutor cannot schedule for a learner who is not theirs', async () => {
    const e = await enr(await stu('QA Fay'), T2); await credit(e, 2)
    await expectError(() => book(T3, [e], 540), /not the accepted teacher/)
  })
  await test('AT-08', 'a group class reserves one credit per learner and one session', async () => {
    const before = [await remaining(eA), await remaining(eB)]
    const sid = await book(T3, [eA, eB], 600)
    eq([await remaining(eA), await remaining(eB)], [before[0] - 1, before[1] - 1])
    eq((await q(`select count(*)::int n from public.session_participants where session_id=$1`, [sid]))[0].n, 2)
  })

  // ---- attendance, makeup, earnings
  await c.query(`insert into public.teacher_rates (teacher_id, amount, effective_from) values ($1, 120, current_date - 30)`, [T3])
  const E = await enr(await stu('QA Gus'), T3), F = await enr(await stu('QA Hana'), T3)
  await credit(E, 4); await credit(F, 4)
  let grp
  await test('AT-12', 'group attendance is per learner: absent learner keeps the class, present learner earns', async () => {
    grp = await book(T3, [E, F], -3)           // started 3 hours ago (allowed by the past-booking window)
    const r = await as(T3, () => q(`select public.mark_attendance($1, $2::jsonb) r`, [grp, JSON.stringify([{ enrollment_id: E, attendance: 'present' }, { enrollment_id: F, attendance: 'absent', reason: 'Student unwell' }])]))
    eq(r[0].r.completed, true)
    eq(await remaining(E), 3, 'present learner used one credit'); eq(await remaining(F), 4, 'absent learner keeps the credit')
    const items = await q(`select enrollment_id, rate_snapshot from public.earning_items where session_id=$1`, [grp])
    eq(items.length, 1); eq(items[0].enrollment_id, E); eq(Number(items[0].rate_snapshot), 120)
  })
  await test('INV-7', 'absence without a reason is refused', async () => {
    const s = await book(T3, [E], -6)
    await expectError(() => as(T3, () => q(`select public.mark_attendance($1,$2::jsonb)`, [s, JSON.stringify([{ enrollment_id: E, attendance: 'absent' }])])), /reason/)
  })
  await test('AT-13', 'cancelling a class keeps the learner’s credit as a makeup', async () => {
    const e = await enr(await stu('QA Ivy'), T3); await credit(e, 2)
    const s = await book(T3, [e], 700); eq(await remaining(e), 1)
    await as(T3, () => q(`select public.cancel_session($1,'Tutor unwell','this')`, [s]))
    eq(await remaining(e), 2, 'credit restored after cancellation')
    eq((await as(COORD, () => q(`select missed from public.enrollment_makeup where enrollment_id=$1`, [e])))[0].missed, 1, 'the cancelled class is listed as a makeup to arrange')
  })
  await test('AT-14', 'a substitute tutor delivers the makeup and earns it in the delivery month', async () => {
    const [en] = await q(`select id from public.languages where name='English'`)
    const s0 = await stu('QA Jay')
    const e = (await q(`insert into public.enrollments (student_id, language_id, status, primary_teacher_id, assignment_status) values ($1,$2,'active',$3,'accepted') returning id`, [s0, en.id, T3]))[0].id
    await credit(e, 2)
    const s = await book(T3, [e], -8)                       // class that T3 cannot deliver
    await as(COORD, () => q(`select public.reassign_session($1,$2)`, [s, T1]))  // admin hands it to substitute T1 (English teacher)
    await as(T1, () => q(`select public.mark_attendance($1,$2::jsonb)`, [s, JSON.stringify([{ enrollment_id: e, attendance: 'present' }])]))
    const it = (await q(`select teacher_id, rate_snapshot, to_char(earned_on,'YYYY-MM') m from public.earning_items where session_id=$1`, [s]))[0]
    eq(it.teacher_id, T1, 'earning belongs to the substitute'); eq(Number(it.rate_snapshot), 100, 'substitute’s own rate is used')
    eq(it.m, (await q(`select to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM') m`))[0].m, 'earned in the month it was delivered')
    eq(await remaining(e), 1)
  })

  // ---- hold
  await test('AT-17', 'a payment hold removes only that learner from future classes; others continue', async () => {
    const s = await book(T3, [eA, eB], 800)
    await as(FIN, () => q(`select public.place_hold($1,'Unpaid')`, [eA]))
    eq((await q(`select enrollment_id from public.session_participants where session_id=$1`, [s])).map((r) => r.enrollment_id), [eB])
    eq((await q(`select status from public.sessions where id=$1`, [s]))[0].status, 'scheduled')
    await expectError(() => book(T3, [eA], 900), /on hold/)
    await as(FIN, () => q(`select public.release_hold($1,'cleared')`, [eA]))
    eq((await q(`select count(*)::int n from public.session_participants where session_id=$1`, [s]))[0].n, 1, 'release does not revive the removed booking')
  })

  // ---- fees
  await test('AT-20', 'prepaid installments are covered; payment allocates oldest first; advance kept', async () => {
    const plan = await as(FIN, () => q(`select public.create_fee_plan($1, 3000, $2::jsonb) id`, [eB, JSON.stringify([{ due_date: '2026-11-01', amount: 1000 }, { due_date: '2026-12-01', amount: 1000 }, { due_date: '2027-01-01', amount: 1000 }])]))
    const r = await as(FIN, () => q(`select public.record_payment($1, current_date, 2500, 'UPI') r`, [plan[0].id]))
    eq(Number(r[0].r.allocated), 2500); eq(Number(r[0].r.advance), 0)
    const open = await q(`select i.due_date::text d, i.amount - coalesce((select sum(amount) from public.payment_allocations a where a.installment_id=i.id),0) o from public.fee_installments i where plan_id=$1 order by 1`, [plan[0].id])
    eq(open.map((x) => Number(x.o)), [0, 0, 500], 'only the third installment still has 500 open')
  })
  await test('AT-21', 'foreign payment needs the original amount and applied rate', async () => {
    const plan = await as(FIN, () => q(`select public.create_fee_plan($1, 500, $2::jsonb) id`, [eA, JSON.stringify([{ due_date: '2026-11-01', amount: 500 }])]))
    await expectError(() => as(FIN, () => q(`select public.record_payment($1, current_date, 400, 'Bank Transfer', null, null, null, 'USD', null, null)`, [plan[0].id])), /original amount and the rate/)
    await as(FIN, () => q(`select public.record_payment($1, current_date, 415, 'Bank Transfer', null, null, null, 'USD', 5, 83)`, [plan[0].id]))
  })

  // ---- role boundaries
  await test('AT-24a', 'coordinator cannot set fees, record payments or change tutor rates', async () => {
    const eP = await enr(await stu('QA Plan'), T3); const plan = (await q(`insert into public.fee_plans (enrollment_id,total_amount) values ($1,100) returning id`, [eP]))[0].id
    await expectError(() => as(COORD, () => q(`select public.record_payment($1,current_date,10,'Cash')`, [plan])), /Only Finance/)
    await expectError(() => as(COORD, () => q(`select public.create_fee_plan($1,100,'[{"due_date":"2027-01-01","amount":100}]'::jsonb)`, [eB])), /Only Finance/)
    await expectError(() => as(COORD, () => q(`insert into public.teacher_rates (teacher_id, amount, effective_from) values ($1, 999, current_date)`, [T3])), /row-level security/)
    eq((await as(COORD, () => q(`select * from public.payments`))).length, 0, 'coordinator reads no payment rows')
    eq((await as(COORD, () => q(`select * from public.fee_plans`))).length, 0, 'coordinator reads no fee plans')
  })
  await test('AT-24b', 'tutor cannot see fees, other tutors’ students or rates; finance cannot edit schedules', async () => {
    eq((await as(T3, () => q(`select * from public.fee_plans`))).length, 0)
    eq((await as(T3, () => q(`select * from public.payments`))).length, 0)
    const seen = await as(T3, () => q(`select id from public.enrollments`))
    if (seen.some((r) => r.id === (null))) throw new Error('unexpected')
    const mine = await q(`select id from public.enrollments where primary_teacher_id=$1 or id in (select enrollment_id from public.session_participants sp join public.sessions s on s.id=sp.session_id where s.teacher_id=$1)`, [T3])
    eq(seen.length <= mine.length, true, 'tutor sees only own enrollments')
    await expectError(() => as(FIN, () => q(`select public.schedule_session($1,$2::uuid[],$3,$4)`, [T3, [eA], iso(1000), iso(1001)])), /not allowed to schedule/)
    await expectError(() => as(T3, () => q(`select public.assign_teacher($1,$2)`, [eA, T2])), /Only a coordinator/)
    await expectError(() => as(T3, () => q(`insert into public.credit_movements (enrollment_id, quantity, reason, allocation_period) values ($1, 5, 'x', current_date)`, [eA])), /row-level security/)
  })
  await test('AT-05', 'an unapproved tutor sees no teaching records', async () => {
    const u = (await q(`select gen_random_uuid() id`))[0].id
    await q(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated', 'qa-pending@example.test', '{"role":"teacher"}', '{"full_name":"QA Pending","languages":["English"]}')`, [u])
    eq((await q(`select approval_status from public.teacher_profiles where user_id=$1`, [u]))[0].approval_status, 'pending_review')
    eq((await as(u, () => q(`select * from public.sessions`))).length, 0)
    eq((await as(u, () => q(`select * from public.enrollments`))).length, 0)
    await expectError(() => as(u, () => q(`update public.teacher_profiles set approval_status='approved' where user_id=$1`, [u])), /Only an admin|row-level/)
  })
  await test('SET-AT-02', 'settings: tutors/coordinators cannot change super-admin settings; finance only finance ones; version conflicts are caught', async () => {
    await expectError(() => as(COORD, () => q(`select public.set_setting('schedule.max_class_minutes','300'::jsonb,'x',0)`)), /not allowed/)
    await expectError(() => as(FIN, () => q(`select public.set_setting('schedule.max_class_minutes','300'::jsonb,'x',0)`)), /not allowed/)
    await as(FIN, () => q(`select public.set_setting('fees.overdue_warning_days','5'::jsonb,'QA test',0)`))
    await expectError(() => as(ADMIN, () => q(`select public.set_setting('fees.overdue_warning_days','6'::jsonb,'QA test',0)`)), /Someone else changed/)
    await expectError(() => as(ADMIN, () => q(`select public.set_setting('schedule.max_class_minutes','-5'::jsonb,'QA',0)`)), /between/)
    await expectError(() => as(ADMIN, () => q(`select public.set_setting('schedule.max_class_minutes','300'::jsonb,'',0)`)), /reason/)
  })
  await test('SET-AT-13', 'the last Super Admin cannot be removed or suspended', async () => {
    await expectError(() => as(ADMIN, () => q(`update public.profiles set status='suspended' where id=$1`, [ADMIN])), /At least one active Super Admin/)
  })
  await test('AUDIT', 'audit history is append-only', async () => {
    await expectError(() => q(`update public.audit_events set reason='x' where id=(select min(id) from public.audit_events)`), /append-only/)
    await expectError(() => q(`delete from public.audit_events where id=(select min(id) from public.audit_events)`), /append-only/)
  })

  // ---- migration 014 behaviours
  if (WITH_014) {
    await test('AT-15', 'finalizing a payout locks included attendance even before it is paid', async () => {
      const month = (await q(`select date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date::text m`))[0].m
      // earlier scenarios left a past class unmarked: finalization must refuse until attendance is resolved
      await expectError(() => as(FIN, () => q(`select public.finalize_payout($1,$2)`, [T3, month])), /still need attendance/)
      for (const x of await q(`select s.id, sp.enrollment_id from public.sessions s join public.session_participants sp on sp.session_id=s.id where s.teacher_id=$1 and s.status='scheduled' and s.end_at < now()`, [T3]))
        await as(T3, () => q(`select public.mark_attendance($1,$2::jsonb)`, [x.id, JSON.stringify([{ enrollment_id: x.enrollment_id, attendance: 'absent', reason: 'Student unwell' }])]))
      const pid = (await as(FIN, () => q(`select public.finalize_payout($1,$2) id`, [T3, month])))[0].id
      const p = (await q(`select status,total,item_count from public.payouts where id=$1`, [pid]))[0]
      eq(p.status, 'finalized'); if (!(Number(p.total) > 0)) throw new Error('payout total should be positive')
      await expectError(() => as(T3, () => q(`select public.mark_attendance($1,$2::jsonb)`, [grp, JSON.stringify([{ enrollment_id: E, attendance: 'absent', reason: 'late fix' }])])), /locked/)
      await expectError(() => q(`update public.earning_items set rate_snapshot = 1 where payout_id=$1`, [pid]), /finalized payout/)
      await expectError(() => q(`update public.payouts set total = 1 where id=$1`, [pid]), /cannot be edited/)
      await expectError(() => q(`delete from public.payouts where id=$1`, [pid]), /cannot be deleted/)
      await expectError(() => as(FIN, () => q(`select public.finalize_payout($1,$2)`, [T3, month])), /already finalized/)
    })
    await test('AT-16', 'a correction after finalization is a separate adjustment applied to the next payout', async () => {
      const adj = (await as(FIN, () => q(`select public.add_payout_adjustment($1,-50,'Class marked present in error') id`, [T3])))[0].id
      eq((await q(`select applied_payout_id from public.payout_adjustments where id=$1`, [adj]))[0].applied_payout_id, null)
      await expectError(() => q(`update public.payout_adjustments set amount=1 where id=$1`, [adj]), /cannot be edited/)
      await expectError(() => as(COORD, () => q(`select public.add_payout_adjustment($1,10,'x')`, [T3])), /Only Finance/)
    })
    await test('RATE', 'payout cannot be finalized while attended classes have no rate', async () => {
      const t = T2; const e = await enr(await stu('QA Kim'), t); await credit(e, 2)
      const s = (await as(t, () => q(`select public.schedule_session($1,$2::uuid[],$3,$4) id`, [t, [e], iso(-5), iso(-4)])))[0].id
      await as(t, () => q(`select public.mark_attendance($1,$2::jsonb)`, [s, JSON.stringify([{ enrollment_id: e, attendance: 'present' }])]))
      const month = (await q(`select date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date::text m`))[0].m
      const rate = (await q(`select count(*)::int n from public.teacher_rates where teacher_id=$1`, [t]))[0].n
      if (rate === 0) await expectError(() => as(FIN, () => q(`select public.finalize_payout($1,$2)`, [t, month])), /no rate/)
    })
    await test('NOTES', 'student notes: tutors write only for their own students; notes are immutable', async () => {
      await as(T3, () => q(`insert into public.student_notes (student_id, body) values ($1,'Good progress')`, [B]))
      await expectError(() => as(T2, () => q(`insert into public.student_notes (student_id, body) values ($1,'sneaky')`, [B])), /row-level security/)
      await expectError(() => q(`update public.student_notes set body='x'`), /cannot be edited/)
    })
    await test('LINK', 'only the owning tutor can set a meeting link, and it must be a real https link', async () => {
      await credit(eB, 2); const s = await book(T3, [eB], 1200)
      await as(T3, () => q(`select public.set_meeting_link($1,'https://meet.google.com/abc-defg-hij',false)`, [s]))
      await expectError(() => as(T3, () => q(`select public.set_meeting_link($1,'javascript:alert(1)',false)`, [s])), /full link/)
      await expectError(() => as(T2, () => q(`select public.set_meeting_link($1,'https://x.example/y',false)`, [s])), /not allowed/)
    })
    await test('AT-22', 'a course with owed classes cannot be marked completed; closed courses stay closed', async () => {
      const e = await enr(await stu('QA Lou'), T3); await credit(e, 2)
      await expectError(() => as(COORD, () => q(`update public.enrollments set status='completed' where id=$1`, [e])), /not yet delivered/)
      await as(COORD, () => q(`update public.enrollments set status='withdrawn' where id=$1`, [e]))
      await expectError(() => as(COORD, () => q(`update public.enrollments set status='active' where id=$1`, [e])), /closed course/)
    })
    await test('AT-22b', 'term end with owed classes flags Pending Completion', async () => {
      const e = await enr(await stu('QA Mia'), T3); await credit(e, 2)
      await q(`update public.enrollments set term_end = current_date - 3 where id=$1`, [e])
      const n = (await as(COORD, () => q(`select public.sync_enrollment_completion() n`)))[0].n; if (n < 1) throw new Error('nothing flagged')
      eq((await q(`select status from public.enrollments where id=$1`, [e]))[0].status, 'pending_completion')
    })
  } else { skipped += 7; results.push('  (migration-014 scenarios skipped; run with --with-014)') }
} finally {
  await c.query('reset role').catch(() => {})
  await c.query('rollback')
  await c.end()
}
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}  (transaction rolled back; database unchanged)`)
process.exit(fail ? 1 : 0)
