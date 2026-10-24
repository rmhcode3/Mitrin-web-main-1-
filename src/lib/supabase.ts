import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// Only the public anon key is used in the browser; every read/write is governed by RLS and SECURITY DEFINER functions.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})
