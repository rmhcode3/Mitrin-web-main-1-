// Browser smoke test: serves the production build, drives it in real Chrome at desktop and phone size,
// and walks every screen for each role with intercepted network data (see fixtures.mjs).
// Usage:  npm run build && node tests/e2e/smoke.mjs     (set SHOTS=dir to keep screenshots)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { ID, profiles, rpcResult, tables } from './fixtures.mjs'

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))
const PORT = 4173, BASE = `http://localhost:${PORT}`
const SHOTS = process.env.SHOTS
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const REF = new URL(process.env.VITE_SUPABASE_URL ?? 'https://zseplqmsbrptmogpotlj.supabase.co').hostname.split('.')[0]

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const browser = await chromium.launch({ executablePath: CHROME, headless: true })

let pass = 0, fail = 0
const log = []
const ok = (m) => { pass++; log.push(`  ok   ${m}`) }
const bad = (m) => { fail++; log.push(`  FAIL ${m}`) }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`

async function open(role, vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: vp === 'mobile', hasTouch: vp === 'mobile' })
  const calls = []
  const prof = role ? profiles[role] : null
  if (prof) {
    const session = { access_token: fakeJwt(prof.id), token_type: 'bearer', expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: 'r', user: { id: prof.id, aud: 'authenticated', email: prof.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)])
  }
  await ctx.route('**/auth/v1/**', (route) => {
    const u = route.request().url()
    if (u.includes('grant_type=password')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) })
    if (u.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    if (u.includes('/signup')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'new', email: 'x@y.z', user_metadata: {} }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prof ? { id: prof.id, email: prof.email, aud: 'authenticated' } : {}) })
  })
  await ctx.route('**/functions/v1/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Function not found' }) }))
  await ctx.route('**/rest/v1/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const name = url.pathname.split('/rest/v1/')[1]
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' })
    if (name.startsWith('rpc/')) { const body = req.postDataJSON() ?? {}; calls.push({ method: 'RPC', name: name.slice(4), body }); return json(200, rpcResult(name.slice(4), body)) }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      const body = req.postDataJSON?.() ?? null; calls.push({ method: req.method(), name, body, url: req.url() })
      const echo = Array.isArray(body) ? body.map((b, i) => ({ id: `new-${i}`, ...b })) : { id: 'new-id', ...(body ?? {}) }
      return json(req.method() === 'POST' ? 201 : 200, (req.headers().accept ?? '').includes('pgrst.object') ? (Array.isArray(echo) ? echo[0] : echo) : (Array.isArray(echo) ? echo : [echo]))
    }
    let rows = tables[name]
    if (rows === undefined) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` })
    if (rows === 'UNDEPLOYED') return json(404, { code: '42P01', message: `relation "public.${name}" does not exist` })
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k] ?? '') === v.slice(3))
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); rows = rows.filter((r) => set.includes(String(r[k]))) }
    }
    if ((req.headers().accept ?? '').includes('pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })
    return json(200, rows)
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`) })
  return { ctx, page, calls, errors }
}

async function visit(env, route, label, { text, noText } = {}) {
  const { page, errors } = env
  errors.length = 0
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  const body = await page.locator('body').innerText()
  const lower = body.toLowerCase() // labels are uppercased by CSS, so compare case-insensitively
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const crashed = /Something went wrong on this screen/.test(body)
  const problems = []
  if (errors.length) problems.push(...errors)
  if (crashed) problems.push('error boundary shown')
  if (overflow > 1) problems.push(`page scrolls sideways by ${overflow}px`)
  if (text && !text.every((t) => lower.includes(t.toLowerCase()))) problems.push(`missing text: ${text.filter((t) => !lower.includes(t.toLowerCase())).join(' | ')}`)
  if (noText && noText.some((t) => lower.includes(t.toLowerCase()))) problems.push(`unexpected text: ${noText.filter((t) => lower.includes(t.toLowerCase())).join(' | ')}`)
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, '_')}.png`) })
  problems.length ? bad(`${label}: ${problems.join('; ')}`) : ok(label)
}

try {
  const SWEEPS = {
    admin: [['/admin', ['Needs attention']], ['/admin/leads', ['Nikhil Saxena', 'Total prospects']], ['/admin/demos', ['Rahul Lodha']], ['/admin/students', ['Aarav Mehta', 'Diya Sen']], [`/admin/students?open=${ID.e1}`, ['Classes remaining', 'Makeup to arrange']],
      ['/admin/teachers', ['Priya Sharma']], ['/admin/availability', ['Priya Sharma']], ['/admin/slot-finder', ['Find tutors']], ['/admin/scheduler', ['Lesson scheduler']], ['/admin/attendance', ['Conducted classes']],
      ['/admin/fees', ['Overdue accounts', 'Aarav Mehta']], ['/admin/payouts', ['Open (not finalized)', 'not available until migration']], ['/admin/reports', ['Student ledger']], ['/admin/team', ['Alex Rivers']], ['/admin/imports', ['Download template']], ['/admin/audit', ['Audit history']], ['/admin/settings', ['Longest class allowed', 'Rules that cannot be changed here']]],
    coord: [['/admin', ['Needs attention']], ['/admin/leads', ['Nikhil Saxena']], ['/admin/students', ['Aarav Mehta']], ['/admin/fees', ['do not have access']], ['/admin/payouts', ['do not have access']], ['/admin/team', ['do not have access']], ['/admin/reports', ['Student ledger', 'Admissions'], ['Finance']]],
    fin: [['/admin', ['Overdue']], ['/admin/fees', ['Overdue accounts']], ['/admin/payouts', ['Open (not finalized)']], ['/admin/reports', ['Finance', 'Tutor settlement']], ['/admin/leads', ['do not have access']], ['/admin/scheduler', ['do not have access']], ['/admin/settings', ['Usual installment due day']]],
    t1: [['/tutor', ['Hello, Priya', 'Requests for you']], ['/tutor/classes', ['My classes']], ['/tutor/attendance', ['Mark attendance']], ['/tutor/students', ['Aarav Mehta']], ['/tutor/earnings', ['My earnings']], ['/tutor/availability', ['Availability & leave']], ['/tutor/profile', ['My profile']], ['/admin', null]],
  }
  for (const vp of ['desktop', 'mobile']) {
    for (const [role, routes] of Object.entries(SWEEPS)) {
      const env = await open(role, vp)
      for (const [r, text, noText] of routes) {
        if (r === '/admin' && role === 't1') { await env.page.goto(BASE + '/admin', { waitUntil: 'networkidle' }); env.page.url().endsWith('/tutor') ? ok(`[${vp}] ${role}: /admin redirects a tutor to /tutor`) : bad(`[${vp}] ${role}: tutor reached ${env.page.url()}`); continue }
        await visit(env, r, `[${vp}] ${role} ${r}`, { text: text ?? undefined, noText })
      }
      await env.ctx.close()
    }
    // signed out
    const anon = await open(null, vp)
    await visit(anon, '/login', `[${vp}] login`, { text: ['Welcome back'] })
    await visit(anon, '/register', `[${vp}] register`, { text: ['Apply to teach', 'Hindi'] })
    await anon.page.goto(BASE + '/admin/leads', { waitUntil: 'networkidle' }); anon.page.url().endsWith('/login') ? ok(`[${vp}] signed-out visit to /admin/leads goes to /login`) : bad(`[${vp}] signed-out reached ${anon.page.url()}`)
    await anon.ctx.close()
    const pend = await open('tp', vp)
    await visit(pend, '/tutor', `[${vp}] pending tutor sees only the approval gate`, { text: ['Your application is being reviewed'], noText: ['Aarav Mehta', 'My Classes'] })
    await pend.ctx.close()
  }

  // ---------------- interactions
  { // bad password
    const env = await open(null, 'desktop'); const p = env.page
    await p.goto(BASE + '/login'); await p.getByLabel('Email').fill('x@y.z'); await p.getByLabel('Password', { exact: true }).fill('wrongwrong'); await p.getByRole('button', { name: 'Sign in' }).click()
    await p.getByText('Email or password is not correct.').waitFor({ timeout: 4000 }).then(() => ok('login: wrong password shows a plain message'), () => bad('login: no error message'))
    await env.ctx.close()
  }
  { // add lead persists through the API with cleaned phone, Save closes modal
    const env = await open('coord', 'desktop'); const p = env.page
    await p.goto(BASE + '/admin/leads', { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: /add lead/i }).first().click()
    const dlg = p.getByRole('dialog')
    await dlg.getByRole('button', { name: 'Log lead' }).click()
    ;(await dlg.getByText('Enter the name of the person enquiring').count()) ? ok('add lead: required-field errors shown') : bad('add lead: no validation')
    await dlg.getByLabel('Contact / enquirer name').fill('Meera Nair'); await dlg.getByLabel('Learner name').fill('Zoya Nair'); await dlg.getByLabel('WhatsApp / phone').fill('+91 98765-43210')
    await dlg.getByLabel('Language interested').selectOption({ label: 'Hindi' })
    await dlg.getByRole('button', { name: 'Log lead' }).click()
    await p.waitForTimeout(500)
    const post = env.calls.find((c) => c.method === 'POST' && c.name === 'leads')
    post && post.body.phone === '919876543210' && post.body.learner_name === 'Zoya Nair' && post.body.language_id === ID.L1 ? ok('add lead: saved through the API with a cleaned phone number') : bad(`add lead: unexpected request ${JSON.stringify(post?.body)}`)
    ;(await p.getByRole('dialog').count()) === 0 ? ok('add lead: modal closes after saving') : bad('add lead: modal still open')
    // duplicate warning (same learner + phone as an open enquiry)
    await p.getByRole('button', { name: /add lead/i }).first().click()
    const d2 = p.getByRole('dialog')
    await d2.getByLabel('Contact / enquirer name').fill('Someone'); await d2.getByLabel('Learner name').fill('Nikhil Saxena'); await d2.getByLabel('WhatsApp / phone').fill('919111122223'); await d2.getByLabel('Language interested').selectOption({ label: 'Hindi' })
    await d2.getByRole('button', { name: 'Log lead' }).click()
    ;(await p.getByText(/already exists/).count()) ? ok('add lead: same learner + phone triggers a duplicate warning (siblings with same phone are allowed)') : bad('add lead: no duplicate warning')
    await p.keyboard.press('Escape')
    // stage move to "contacted" persists with a PATCH
    await p.getByLabel('Move Nikhil Saxena to stage').click(); await p.getByRole('menuitem', { name: 'Contacted' }).click()
    await p.waitForTimeout(400)
    env.calls.some((c) => c.method === 'PATCH' && c.name.startsWith('leads') && c.body.stage === 'contacted') ? ok('lead stage change is saved to the database') : bad('lead stage change did not call the API')
    // drawer opens
    await p.getByText('Tarun Mishra').first().click()
    ;(await p.getByRole('dialog').getByText('Demo class').count()) ? ok('lead card opens the detail drawer') : bad('lead drawer missing')
    await env.ctx.close()
  }
  { // tutor marks attendance
    const env = await open('t1', 'desktop'); const p = env.page
    await p.goto(BASE + '/tutor/attendance', { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'Present' }).first().click()
    await p.getByRole('button', { name: 'Absent' }).nth(1).click()
    const save = p.getByRole('button', { name: /save/i }).first()
    ;(await save.isDisabled()) ? ok('attendance: absent learner without a reason cannot be saved') : bad('attendance: saved without reason')
    await p.getByLabel('Absence reason').selectOption('Student unwell')
    await save.click(); await p.waitForTimeout(400)
    const rpcCall = env.calls.find((c) => c.name === 'mark_attendance')
    rpcCall && rpcCall.body.p_marks.length === 2 && rpcCall.body.p_marks[1].reason === 'Student unwell' ? ok('attendance: each learner is sent separately to mark_attendance') : bad(`attendance rpc: ${JSON.stringify(rpcCall)}`)
    await env.ctx.close()
  }
  { // mobile navigation
    const t = await open('t1', 'mobile')
    await t.page.goto(BASE + '/tutor', { waitUntil: 'networkidle' })
    ;(await t.page.getByRole('navigation', { name: 'Tutor' }).getByText('My Earnings').isVisible()) ? ok('mobile: tutor bottom navigation (Home, My Classes, My Students, My Earnings)') : bad('mobile: no tutor bottom nav')
    await t.ctx.close()
    const a = await open('admin', 'mobile')
    await a.page.goto(BASE + '/admin', { waitUntil: 'networkidle' })
    await a.page.getByLabel('Open menu').click(); await a.page.getByRole('link', { name: 'Leads pipeline' }).click(); await a.page.waitForURL('**/admin/leads')
    ok('mobile: admin hamburger drawer opens and navigates')
    await a.ctx.close()
  }
  { // settings: diff + reason before saving
    const env = await open('admin', 'desktop'); const p = env.page
    await p.goto(BASE + '/admin/settings', { waitUntil: 'networkidle' })
    await p.getByLabel('Longest class allowed').fill('9999')
    ;(await p.getByText('Must be at most 720.').count()) ? ok('settings: out-of-range value is blocked with a clear message') : bad('settings: no range validation')
    await p.getByLabel('Longest class allowed').fill('300'); await p.getByRole('button', { name: 'Review & save' }).first().click()
    const m = p.getByRole('dialog')
    ;(await m.getByRole('button', { name: 'Confirm & save' }).isDisabled()) ? ok('settings: a reason is required before saving') : bad('settings: reason not required')
    await m.getByLabel('Reason for the change').fill('Shorter classes'); await m.getByRole('button', { name: 'Confirm & save' }).click(); await p.waitForTimeout(400)
    const c = env.calls.find((x) => x.name === 'set_setting')
    c && c.body.p_key === 'schedule.max_class_minutes' && c.body.p_value === 300 && c.body.p_expected_version === 0 ? ok('settings: saved via set_setting with the expected version (optimistic locking)') : bad(`settings rpc: ${JSON.stringify(c)}`)
    await env.ctx.close()
  }
  { // coordinator cannot see money; finance sees it
    const env = await open('coord', 'desktop'); const p = env.page
    await p.goto(BASE + `/admin/students?open=${ID.e1}`, { waitUntil: 'networkidle' })
    const t = await p.locator('body').innerText()
    !/₹|Payments\b.*Outstanding/.test(t) && !(await p.getByRole('tab', { name: 'Payments' }).count()) ? ok('coordinator: student profile shows payment status only, no Payments tab or amounts') : bad('coordinator can see fee amounts')
    await env.ctx.close()
  }
} catch (e) {
  bad(`test run crashed: ${e.stack}`)
} finally {
  await browser.close()
  server.kill()
}
console.log(log.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
