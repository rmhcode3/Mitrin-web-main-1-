import { select, type Row } from './api'
import { useAuth } from './auth'
import { useAsync } from './hooks'

export const one = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined)

/** Everything a tutor sees about their own students. RLS limits every query to the signed-in tutor. */
export function useMyStudents() {
  return useAsync(async () => {
    const [enr, bal, mk, up] = await Promise.all([
      select('enrollments', '*, students(id, full_name, level, age_group, timezone), languages(name)', (q) => q.order('created_at', { ascending: false })),
      select('enrollment_balances'), select('enrollment_makeup'),
      select('session_participants', 'enrollment_id, sessions!inner(start_at,status)', (q) => q.eq('sessions.status', 'scheduled').gte('sessions.start_at', new Date().toISOString())),
    ])
    const b = new Map(bal.map((x) => [x.enrollment_id as string, x]))
    const m = new Map(mk.map((x) => [x.enrollment_id as string, x]))
    const next = new Map<string, string>()
    for (const r of up) { const t = one<Row>(r.sessions)?.start_at as string; if (t && (!next.get(r.enrollment_id) || t < next.get(r.enrollment_id)!)) next.set(r.enrollment_id, t) }
    return enr.map((e): Row => {
      const remaining = (b.get(e.id)?.remaining ?? 0) as number
      return { ...e, remaining, reserved: (b.get(e.id)?.reserved ?? 0) as number, fulfilled: (b.get(e.id)?.fulfilled ?? 0) as number, makeup: Math.min((m.get(e.id)?.missed ?? 0) as number, remaining), next: next.get(e.id) }
    })
  })
}

export function useTutorTz() {
  const { tp } = useAuth()
  return (tp?.timezone as string | undefined) ?? 'Asia/Kolkata'
}
