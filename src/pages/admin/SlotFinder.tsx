import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Mail, MessageCircle, Phone } from 'lucide-react'
import { rpc, type Row } from '../../lib/api'
import { useAction, useAsync } from '../../lib/hooks'
import { loadApprovedTeachers, loadLanguages, waLink } from '../../lib/domain'
import { WD3, WEEKDAYS, addDays, dow, fmtDate, fmtTime, label, shortTz, todayIn, zonedToUtc } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, Select, Tabs, TimeInput, type Tone } from '../../components/ui'

const tone: Record<string, Tone> = { confirmed: 'green', tentative: 'yellow', occupied: 'red', on_leave: 'red', unavailable: 'red', outside_hours: 'gray' }
const rank = ['confirmed', 'tentative', 'outside_hours', 'unavailable', 'occupied', 'on_leave']
type Hit = { tutor_id: string; tutor_name: string; availability: string }

const GROUPS = [
  { id: 'avail', title: 'Available matches', dot: 'bg-emerald-500', empty: 'No perfectly matching tutors. Try another time or date.' },
  { id: 'partial', title: 'Partial availability', dot: 'bg-amber-500', empty: 'No tutors available only outside their usual hours.' },
  { id: 'blocked', title: 'Conflicts / busy', dot: 'bg-red-500', empty: 'No conflicts at this time.' },
] as const

export default function SlotFinder() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'once' | 'weekly'>('once')
  const [category, setCategory] = useState<'regular' | 'demo'>('regular')
  const [lang, setLang] = useState('')
  const tz = 'Asia/Kolkata'
  const [date, setDate] = useState(todayIn('Asia/Kolkata'))
  const [time, setTime] = useState('17:00')
  const [mins, setMins] = useState('60')
  const [days, setDays] = useState<number[]>([1, 3])
  const [weeks, setWeeks] = useState('4')
  const [out, setOut] = useState<{ tutor_id: string; tutor_name: string; slots: { d: string; a: string }[] }[] | null>(null)
  const { busy, run } = useAction()
  const meta = useAsync(async () => ({ langs: await loadLanguages(), teachers: await loadApprovedTeachers() }))

  const find = () => run(async () => {
    if (!lang) throw new Error('Choose a language first.')
    const len = Number(mins)
    if (!(len > 0)) throw new Error('Enter the class length in minutes.')
    const dates: string[] = []
    if (mode === 'once') dates.push(date)
    else for (let i = 0; i < Number(weeks) * 7; i++) { const d = addDays(date, i); if (days.includes(dow(d))) dates.push(d) }
    if (!dates.length) throw new Error('Choose at least one day.')
    const by = new Map<string, { tutor_id: string; tutor_name: string; slots: { d: string; a: string }[] }>()
    for (const d of dates) {
      const s = zonedToUtc(d, time, tz)
      const hits = await rpc<Hit[]>('find_tutors', { p_language: lang, p_start: s.toISOString(), p_end: new Date(+s + len * 60000).toISOString() })
      for (const h of hits) { const e = by.get(h.tutor_id) ?? { tutor_id: h.tutor_id, tutor_name: h.tutor_name, slots: [] }; e.slots.push({ d, a: h.availability }); by.set(h.tutor_id, e) }
    }
    const score = (t: { slots: { a: string }[] }) => t.slots.filter((s) => s.a === 'confirmed').length * 2 + t.slots.filter((s) => s.a === 'tentative').length * 1.5 - t.slots.filter((s) => rank.indexOf(s.a) >= 3).length
    setOut([...by.values()].sort((x, y) => score(y) - score(x)))
  })

  const first = zonedToUtc(date, time, tz)
  const langName = meta.data?.langs.find((l: Row) => l.id === lang)?.name ?? ''
  const groupOf = (t: { slots: { a: string }[] }) => {
    const free = t.slots.filter((s) => ['confirmed', 'tentative'].includes(s.a)).length
    return free === t.slots.length ? 'avail' : free > 0 || t.slots.some((s) => ['outside_hours', 'unavailable'].includes(s.a)) ? 'partial' : 'blocked'
  }
  const tzOf = (id: string) => meta.data?.teachers.find((t: Row) => t.id === id)?.timezone as string | undefined

  return (
    <>
      <PageHeader title="Tutor slot finder" subtitle="Find approved tutors for a demo or a repeating weekly slot. Occupied time, leave and exceptions are excluded; unconfirmed hours are shown as tentative, never as a booking." />
      <Card className="p-4 sm:p-5 mb-5">
        <Tabs<'once' | 'weekly'> value={mode} onChange={(m) => { setMode(m); setOut(null) }} tabs={[{ id: 'once', label: 'One-off (demo)' }, { id: 'weekly', label: 'Weekly (recurring plan)' }]} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Field label="Language" required><Select value={lang} onChange={(e) => setLang(e.target.value)}><option value="">Choose…</option>{meta.data?.langs.filter((l: Row) => l.active).map((l: Row) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label={mode === 'once' ? 'Date' : 'Starting from'}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Start time"><TimeInput step={900} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Length (min)"><Input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></Field>
          <div><p className="text-[13px] font-semibold mb-1.5">Class category</p><div className="flex gap-2">{([['regular', 'Regular lesson', '60'], ['demo', 'Trial demo', '30']] as const).map(([v, l, m]) => <button key={v} type="button" aria-pressed={category === v} onClick={() => { setCategory(v); setMins(m); setOut(null) }} className={`flex-1 min-h-11 rounded-lg border text-sm font-semibold ${category === v ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-soft border-line'}`}>{l}</button>)}</div></div>
          {mode === 'weekly' && <>
            <Field label="Weeks to check"><Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{[1, 2, 4, 8, 12].map((w) => <option key={w}>{w}</option>)}</Select></Field>
            <div><p className="text-[13px] font-semibold mb-1.5">Days of the week</p><div className="flex flex-wrap gap-1.5">{WD3.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={`min-h-10 min-w-11 rounded-lg border px-2 text-sm font-semibold ${days.includes(i) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-line'}`}>{d}</button>)}</div></div>
          </>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy} onClick={() => void find()}>Find tutors</Button>{mode === 'once' && <span className="text-xs text-ink-soft">{fmtDate(first, tz)} · {fmtTime(first, tz)} {shortTz(tz, first)}</span>}</div>
      </Card>

      {out && (!out.length ? <Empty title="No approved tutor teaches this language" /> : (
        <>
          <div className="mb-5 rounded-xl border border-line bg-brand-50 px-4 py-3 text-sm text-ink-soft flex items-center gap-2">
            <Info size={16} className="text-brand-700 shrink-0" />
            <span>Matches for <b className="text-ink">{mode === 'once' ? WEEKDAYS[dow(date)] : `${days.map((d) => WD3[d]).join(', ')} for ${weeks} week${weeks === '1' ? '' : 's'}`}</b> at <b className="text-ink">{fmtTime(first, tz)} {shortTz(tz, first)}</b> ({mins}-minute {category === 'demo' ? 'trial demo' : 'lesson'}) teaching <b className="text-ink">{langName}</b>. Leave, exceptions and existing classes were checked.</span>
          </div>
          <div className="grid lg:grid-cols-3 gap-5 items-start">
            {GROUPS.map((g) => {
              const list = out.filter((t) => groupOf(t) === g.id)
              return (
                <div key={g.id} className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-line pb-2"><span className={`h-2.5 w-2.5 rounded-full ${g.dot}`} /><span className="text-sm font-bold uppercase tracking-wider">{g.title} ({list.length})</span></div>
                  {!list.length && <div className="rounded-xl border border-dashed border-line bg-white p-5 text-center text-sm text-ink-soft italic">{g.empty}</div>}
                  {list.map((t) => {
                    const free = t.slots.filter((s) => ['confirmed', 'tentative'].includes(s.a)).length
                    const tTz = tzOf(t.tutor_id)
                    const tutor = meta.data?.teachers.find((x: Row) => x.id === t.tutor_id)
                    const wa = waLink(tutor?.phone)
                    const worst = t.slots[0]?.a
                    return (
                      <Card key={t.tutor_id} className={`p-4 space-y-3 ${g.id === 'blocked' ? 'border-red-200 bg-red-50/30' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0"><p className="font-bold truncate">{t.tutor_name}</p><p className="text-xs text-ink-soft truncate">{(tutor?.languages as string[] | undefined)?.join(', ')}</p></div>
                          {mode === 'weekly' ? <Badge tone={free === t.slots.length ? 'green' : free ? 'yellow' : 'red'}>{free}/{t.slots.length} slots free</Badge> : <Badge tone={tone[worst]}>{g.id === 'avail' && worst === 'confirmed' ? 'Cleared match' : label[worst]}</Badge>}
                        </div>
                        <div className="border-t border-line pt-2 space-y-1 text-xs text-ink-soft">
                          {tutor?.phone && <p className="flex justify-between"><span>Contact</span><span className="text-ink font-medium">{tutor.phone}</span></p>}
                          {tTz && tTz !== tz && <p className="flex justify-between"><span>Tutor’s local time</span><span className="text-ink font-medium">{fmtTime(first, tTz)} ({shortTz(tTz, first)})</span></p>}
                          {g.id === 'partial' && mode === 'once' && <p className="rounded-lg bg-sand/60 px-2.5 py-1.5 italic">{worst === 'unavailable' ? 'Marked unavailable at this time.' : 'Outside the tutor’s usual hours at this time.'}</p>}
                          {g.id === 'blocked' && mode === 'once' && <p className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-800">{worst === 'on_leave' ? 'On leave on this date.' : 'Already has a class that overlaps this time.'}</p>}
                        </div>
                        {mode === 'weekly' && <div className="flex flex-wrap gap-1.5">{t.slots.map((s) => <span key={s.d} title={label[s.a]} className={`text-xs rounded-lg border px-2 py-1 ${s.a === 'confirmed' ? 'bg-emerald-50 border-emerald-200' : s.a === 'tentative' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200 line-through decoration-red-300'}`}>{WD3[dow(s.d)]} {s.d.slice(8)}/{s.d.slice(5, 7)}</span>)}</div>}
                        {g.id === 'avail' && <div className="border-t border-line pt-2 flex items-center justify-between gap-2"><span className="text-xs font-bold text-emerald-700">✔ Free at {fmtTime(first, tz)}</span><Button size="sm" variant="primary" onClick={() => nav('/admin/leads')}>Create demo</Button></div>}
                        {g.id === 'partial' && (() => {
                          const msg = `Hello ${t.tutor_name}, can you cover a ${langName} class on ${fmtDate(first, tz)} at ${fmtTime(first, tz)} ${shortTz(tz, first)}? Please reply to confirm.`
                          return (
                            <div className="border-t border-line pt-2 flex flex-wrap justify-end gap-2">
                              {wa && <a href={`${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="primary"><MessageCircle size={13} /> Contact on WhatsApp</Button></a>}
                              {tutor?.phone && <a href={`tel:${tutor.phone}`}><Button size="sm"><Phone size={13} /> Call</Button></a>}
                              {!wa && tutor?.email && <a href={`mailto:${tutor.email}?subject=${encodeURIComponent('Class cover request')}&body=${encodeURIComponent(msg)}`}><Button size="sm" variant="primary"><Mail size={13} /> Email</Button></a>}
                              {!wa && !tutor?.email && <Button size="sm" disabled title="No phone or email on this tutor's profile">No contact details</Button>}
                            </div>
                          )
                        })()}
                      </Card>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="mt-5"><Notice tone="gray">Confirmed = inside usual hours and the tutor confirmed that week. Tentative = inside usual hours but not yet confirmed. Create a demo from the Leads page to send the request. Tutors must accept it.</Notice></div>
        </>
      ))}
    </>
  )
}
