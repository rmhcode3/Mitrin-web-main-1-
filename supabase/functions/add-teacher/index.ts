// Edge function: an admin (Super Admin or Coordinator) adds an approved tutor with a website login.
// Deploy with:  supabase functions deploy add-teacher
// Uses the project's own SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (set automatically on Supabase).
// The service-role key never reaches the browser; the caller is verified as an active Super Admin or Coordinator first.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await caller.auth.getUser()
  if (!u.user) return json({ error: 'Please sign in again.' }, 401)
  const { data: me } = await caller.from('profiles').select('role,status,admin_permissions').eq('id', u.user.id).single()
  const perms = (me?.admin_permissions ?? []) as string[]
  if (!me || me.role !== 'admin' || me.status !== 'active' || !(perms.includes('super_admin') || perms.includes('coordinator'))) {
    return json({ error: 'Only a Super Admin or Coordinator can add teachers.' }, 403)
  }

  let b: { email?: string; password?: string; full_name?: string; phone?: string; languages?: string[]; experience_years?: number | null; qualifications?: string }
  try { b = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const email = String(b.email ?? '').trim().toLowerCase()
  const name = String(b.full_name ?? '').trim()
  const phone = String(b.phone ?? '').replace(/\D/g, '')
  const password = String(b.password ?? '')
  const languages = Array.isArray(b.languages) ? b.languages.map((x) => String(x)).filter(Boolean) : []
  const years = b.experience_years == null ? null : Number(b.experience_years)
  const qual = String(b.qualifications ?? '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400)
  if (name.length < 2 || name.length > 120) return json({ error: 'Enter the teacher’s name.' }, 400)
  if (!/^[0-9]{7,15}$/.test(phone)) return json({ error: 'Phone must be 7–15 digits.' }, 400)
  if (password.length < 8 || password.length > 72) return json({ error: 'The password must be 8–72 characters.' }, 400)
  if (!languages.length) return json({ error: 'Choose at least one language.' }, 400)
  if (years !== null && !(Number.isInteger(years) && years >= 0 && years <= 60)) return json({ error: 'Experience must be a whole number of years.' }, 400)
  if (qual.length < 2 || qual.length > 1000) return json({ error: 'Enter the qualifications.' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Same metadata the public tutor registration sends, so the existing handle_new_user() trigger builds the profile.
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { role: 'teacher', full_name: name, phone, languages, experience_years: years, qualifications: qual },
  })
  if (error || !created.user) return json({ error: error?.message ?? 'Could not create the account.' }, 400)

  // Added by an admin, so the tutor is approved straight away and teaches in India time like the roster does.
  const { data: tp, error: pe } = await admin.from('teacher_profiles').update({ approval_status: 'approved', timezone: 'Asia/Kolkata' }).eq('user_id', created.user.id).select('user_id')
  if (pe || !tp?.length) {
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: pe?.message ?? 'The tutor profile was not created.' }, 400)
  }
  return json({ ok: true, id: created.user.id })
})
