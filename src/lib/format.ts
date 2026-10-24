import { format as dfFormat } from 'date-fns'

export const inr = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n ?? 0))

// Some browsers still report legacy IANA names; the database and tutor profiles use the canonical ones.
const TZ_ALIAS: Record<string, string> = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh' }
export const browserTz = () => { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; return TZ_ALIAS[z] ?? z }

export const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Dhaka', 'Asia/Kathmandu', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
]

function parts(ts: number | Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(ts)) o[p.type] = p.value
  return o
}

/** Offset (ms) of `tz` from UTC at the instant `ts`. */
function tzOffset(ts: number, tz: string) {
  const o = parts(ts, tz)
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second)
  return asUtc - Math.floor(ts / 1000) * 1000
}

/** Wall-clock date + time in `tz` -> the real UTC instant (DST-safe). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const first = guess - tzOffset(guess, tz)
  return new Date(guess - tzOffset(first, tz))
}

export function inTz(iso: string | Date, tz: string) {
  const o = parts(new Date(iso), tz)
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) }
}

export const dow = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay()

export function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Monday of the week containing `date` (matches date_trunc('week') in Postgres). */
export function mondayOf(date: string) {
  const w = dow(date)
  return addDays(date, w === 0 ? -6 : 1 - w)
}
export const todayIn = (tz: string) => inTz(new Date(), tz).date

const isDateOnly = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function fmtDate(v: string | Date | null | undefined, tz?: string) {
  if (!v) return '—'
  const d = isDateOnly(v) ? new Date(v + 'T00:00:00Z') : new Date(v)
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: isDateOnly(v) ? 'UTC' : (tz ?? browserTz()) }).format(d).replace(',', '')
}
export function fmtTime(v: string | Date, tz?: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz ?? browserTz() }).format(new Date(v))
}
export const fmtDateTime = (v: string | Date, tz?: string) => `${fmtDate(v, tz ?? browserTz())}, ${fmtTime(v, tz)}`
export const hhmm = (t: string) => t.slice(0, 5)
export function fmtClock(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
export const shortTz = (tz: string, at: Date = new Date()) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? tz

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WD3 = WEEKDAYS.map((d) => d.slice(0, 3))
export const monthKey = (d: string) => d.slice(0, 7)
export const fmtMonth = (k: string) => dfFormat(new Date(k + '-01T00:00:00'), 'MMMM yyyy')
export const digits = (s: string) => s.replace(/[^0-9]/g, '')

export const LEAD_STAGES = [
  { v: 'new', l: 'New Lead' }, { v: 'contacted', l: 'Contacted' }, { v: 'demo_scheduled', l: 'Demo Scheduled' },
  { v: 'demo_done', l: 'Demo Completed' }, { v: 'converted', l: 'Converted' }, { v: 'lost', l: 'Lost Lead' },
] as const
export const stageLabel = (v: string) => LEAD_STAGES.find((s) => s.v === v)?.l ?? v

export const label: Record<string, string> = {
  draft: 'Draft', awaiting_tutor: 'Awaiting tutor', active: 'Active', on_hold: 'On hold', pending_completion: 'Pending completion', completed: 'Completed', withdrawn: 'Withdrawn',
  accepted: 'Accepted', declined: 'Declined', none: 'Not assigned', scheduled: 'Scheduled', cancelled: 'Cancelled', tutor_no_show: 'Tutor no-show', student_no_show: 'Student no-show', rescheduled: 'Rescheduled',
  present: 'Present', absent: 'Absent', unmarked: 'Not marked', pending_review: 'Pending approval', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended',
  confirmed: 'Confirmed available', tentative: 'Tentative', occupied: 'Occupied', on_leave: 'On leave', unavailable: 'Unavailable', outside_hours: 'Outside usual hours',
  pending: 'Pending', overdue: 'Overdue', due: 'Due', cleared: 'Paid', no_plan: 'No fee plan', paid: 'Paid', finalized: 'Finalized', completed_session: 'Completed',
}
