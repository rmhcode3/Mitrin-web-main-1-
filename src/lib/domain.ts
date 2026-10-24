import { select, type Row } from './api'

export const SOURCES = ['Call', 'WhatsApp', 'Email', 'Referral', 'Other'] as const
export const LEVELS = ['Beginner', 'Elementary', 'Intermediate', 'Upper Intermediate', 'Advanced'] as const
export const AGE_GROUPS = ['Child (up to 12)', 'Teen (13–17)', 'Adult (18+)'] as const
export const GROUP_PREFS = [{ v: 'individual', l: 'Individual' }, { v: 'group', l: 'Group' }, { v: 'either', l: 'Either' }] as const
export const PAY_METHODS = ['UPI', 'Bank Transfer', 'Cash', 'Other'] as const
export const ABSENCE_REASONS = ['Student did not attend', 'Student cancelled', 'Student unwell', 'Technical problem', 'Other'] as const
export const LEAVE_REASONS = ['Personal', 'Medical', 'Emergency', 'Travel', 'Other'] as const

export const loadLanguages = () => select('languages', '*', (q) => q.order('name'))

/** Teachers that can be assigned: active + approved. Admin-only read (RLS). */
export async function loadApprovedTeachers(): Promise<Row[]> {
  const tps = await select('teacher_profiles', '*, profiles!user_id(full_name,email,phone,status)', (q) => q.eq('approval_status', 'approved'))
  return tps.filter((t) => t.profiles?.status === 'active').map((t) => ({ id: t.user_id, name: t.profiles.full_name, languages: t.languages as string[], timezone: t.timezone as string, email: t.profiles.email, phone: t.profiles.phone }))
}

export const teacherName = (m: Map<string, Row> | Row[], id: string | null | undefined) => {
  if (!id) return '—'
  const row = Array.isArray(m) ? m.find((x) => x.id === id) : m.get(id)
  return row?.name ?? row?.full_name ?? '—'
}

/** Notes may carry "Timezone: X" / "Location: Y" lines written by the enquiry form. */
export function noteField(notes: string | null | undefined, key: string) {
  const m = (notes ?? '').match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))
  return m ? m[1].trim() : ''
}

export function waLink(phone: string | null | undefined) {
  const d = (phone ?? '').replace(/[^0-9]/g, '')
  return d ? `https://wa.me/${d.length === 10 ? '91' + d : d}` : undefined
}
