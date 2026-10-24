import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Row } from './api'

export type Perm = 'super_admin' | 'coordinator' | 'finance'

export interface Profile {
  id: string; role: 'admin' | 'teacher'; full_name: string; email: string; phone: string | null
  status: 'active' | 'suspended'; admin_permissions: Perm[]
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  tp: Row | null // teacher_profiles row (tutors only)
  loading: boolean
  isAdmin: boolean
  isTutor: boolean
  /** Tutor that may see teaching records (approved + active). */
  tutorApproved: boolean
  can: (p: Perm) => boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tp, setTp] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setTp(null); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((p as Profile) ?? null)
    if (p?.role === 'teacher') {
      const { data: t } = await supabase.from('teacher_profiles').select('*').eq('user_id', s.user.id).maybeSingle()
      setTp(t ?? null)
    } else setTp(null)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await load(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      // defer: never call supabase inside the auth callback synchronously
      setTimeout(() => { void load(s) }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [load])

  const value = useMemo<AuthState>(() => {
    const isAdmin = profile?.role === 'admin' && profile.status === 'active'
    const perms = profile?.admin_permissions ?? []
    return {
      session, profile, tp, loading, isAdmin,
      isTutor: profile?.role === 'teacher',
      tutorApproved: profile?.role === 'teacher' && profile.status === 'active' && tp?.approval_status === 'approved',
      can: (p) => Boolean(isAdmin && (perms.includes('super_admin') || perms.includes(p))),
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is not correct.' : error.message)
      },
      signOut: async () => { await supabase.auth.signOut(); setProfile(null); setTp(null) },
      refresh: async () => { await load(session) },
    }
  }, [session, profile, tp, loading, load])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** Human label for the signed-in person's role. */
export function roleLabel(p: Profile | null) {
  if (!p) return ''
  if (p.role === 'teacher') return 'Tutor'
  if (p.admin_permissions.includes('super_admin')) return 'Super Admin'
  return p.admin_permissions.map((x) => (x === 'coordinator' ? 'Coordinator' : 'Finance')).join(' + ') || 'Staff'
}
