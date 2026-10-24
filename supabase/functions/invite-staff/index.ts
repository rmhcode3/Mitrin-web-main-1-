// Edge function: a Super Admin invites a staff account (Coordinator / Finance / Super Admin).
// Deploy with:  supabase functions deploy invite-staff
// Uses the project's own SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (set automatically on Supabase).
// The service-role key never reaches the browser; the caller is verified as an active Super Admin first.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const PERMS = ['super_admin', 'coordinator', 'finance']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: u } = await caller.auth.getUser()
  if (!u.user) return json({ error: 'Please sign in again.' }, 401)
  const { data: me } = await caller.from('profiles').select('role,status,admin_permissions').eq('id', u.user.id).single()
  if (!me || me.role !== 'admin' || me.status !== 'active' || !(me.admin_permissions as string[]).includes('super_admin')) {
    return json({ error: 'Only a Super Admin can invite staff.' }, 403)
  }

  let body: { email?: string; full_name?: string; permissions?: string[] }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const email = String(body.email ?? '').trim().toLowerCase()
  const name = String(body.full_name ?? '').trim()
  const perms = Array.isArray(body.permissions) ? body.permissions.filter((p) => PERMS.includes(p)) : []
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400)
  if (name.length < 2 || name.length > 120) return json({ error: 'Enter the person’s name.' }, 400)
  if (!perms.length) return json({ error: 'Choose at least one role.' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // handle_new_user() reads the role from app_metadata; the permissions are then narrowed to what was requested.
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: { role: 'admin' }, user_metadata: { full_name: name } })
  if (error || !created.user) return json({ error: error?.message ?? 'Could not create the account.' }, 400)
  const { error: pe } = await admin.from('profiles').update({ admin_permissions: perms }).eq('id', created.user.id)
  if (pe) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pe.message }, 400) }

  // Let the person choose their own password.
  const { error: re } = await admin.auth.resetPasswordForEmail(email)
  return json({ ok: true, id: created.user.id, emailSent: !re, note: re ? 'Account created, but the password email could not be sent. Use “Forgot password” from the sign-in page.' : undefined })
})
