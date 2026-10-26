import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { addDays, fmtDate, inTz, mondayOf, todayIn } from '../lib/format'
import { Input, Select } from './ui'

export type Preset = 'all' | 'yesterday' | 'today' | 'week' | 'month' | 'custom'
const PRESETS: { v: Preset; l: string }[] = [
  { v: 'all', l: 'All' }, { v: 'yesterday', l: 'Yesterday' }, { v: 'today', l: 'Today' }, { v: 'week', l: 'This Week' }, { v: 'month', l: 'This Month' }, { v: 'custom', l: 'Custom' },
]
const TZ = 'Asia/Kolkata'
const lastOfMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

/** Date-range filter state (India time). `from`/`to` are inclusive YYYY-MM-DD, or '' when the range is open. */
export function useDateRange() {
  const [preset, setPreset] = useState<Preset>('all')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const today = todayIn(TZ)
  let from = '', to = ''
  if (preset === 'yesterday') from = to = addDays(today, -1)
  else if (preset === 'today') from = to = today
  else if (preset === 'week') { from = mondayOf(today); to = addDays(from, 6) }
  else if (preset === 'month') { from = today.slice(0, 7) + '-01'; to = lastOfMonth(today) }
  else if (preset === 'custom') { from = cFrom; to = cTo }
  const inRange = (v: string | null | undefined) => {
    if (!from && !to) return true
    if (!v) return false
    const day = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : inTz(v, TZ).date
    return !(from && day < from) && !(to && day > to)
  }
  return { preset, setPreset, cFrom, setCFrom, cTo, setCTo, from, to, inRange }
}
export type DateRange = ReturnType<typeof useDateRange>

export function DateRangeFilter({ range }: { range: DateRange }) {
  const { preset, setPreset, cFrom, setCFrom, cTo, setCTo, from, to } = range
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select aria-label="Date range" className="w-44" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>{PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</Select>
      {preset === 'custom' && (
        <>
          <Input aria-label="From date" type="date" className="w-44" max={cTo || undefined} value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
          <span className="text-sm text-ink-soft">to</span>
          <Input aria-label="To date" type="date" className="w-44" min={cFrom || undefined} value={cTo} onChange={(e) => setCTo(e.target.value)} />
        </>
      )}
      {(from || to) && <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><CalendarRange size={15} />{from ? fmtDate(from, 'UTC') : 'Start'}{to !== from && <> – {to ? fmtDate(to, 'UTC') : 'onward'}</>}</span>}
    </div>
  )
}
