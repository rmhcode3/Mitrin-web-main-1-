import { useState } from 'react'
import { rpc, type Row } from '../../lib/api'
import { useAction, useAsync } from '../../lib/hooks'
import { loadApprovedTeachers, loadLanguages } from '../../lib/domain'
import { TIMEZONES, WD3, addDays, dow, fmtDate, fmtTime, label, shortTz, todayIn, zonedToUtc } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, Select, Tabs, type Tone } from '../../components/ui'

const tone: Record<string, Tone> = { confirmed: 'green', tentative: 'yellow', occupied: 'red', on_leave: 'red', unavailable: 'red', outside_hours: 'gray' }
const rank = ['confirmed', 'tentative', 'outside_hours', 'unavailable', 'occupied', 'on_leave']
type Hit = { tutor_id: string; tutor_name: string; availability: string }

export default function SlotFinder() {
  const [mode, setMode] = useState<'once' | 'weekly'>('once')
  const [lang, setLang] = useState('')
  const [tz, setTz] = useState('Asia/Kolkata')
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
  const tzOf = (id: string) => meta.data?.teachers.find((t: Row) => t.id === id)?.timezone as string | undefined

  return (
    <>
      <PageHeader title="Tutor slot finder" subtitle="Find approved tutors for a demo or a repeating weekly slot. Occupied time, leave and exceptions are excluded; unconfirmed hours are shown as tentative, never as a booking." />
      <Card className="p-4 sm:p-5 mb-5">
        <Tabs<'once' | 'weekly'> value={mode} onChange={(m) => { setMode(m); setOut(null) }} tabs={[{ id: 'once', label: 'One-off (demo)' }, { id: 'weekly', label: 'Weekly (recurring plan)' }]} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Field label="Language" required><Select value={lang} onChange={(e) => setLang(e.target.value)}><option value="">Choose…</option>{meta.data?.langs.filter((l: Row) => l.active).map((l: Row) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label={mode === 'once' ? 'Date' : 'Starting from'}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Start time"><Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Length (min)"><Input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></Field>
          <Field label="Times are in" className="lg:col-span-2" hint="Use the learner’s time zone to see the tutor’s local time beside each result."><Select value={tz} onChange={(e) => setTz(e.target.value)}>{TIMEZONES.map((z) => <option key={z} value={z}>{z} ({shortTz(z)})</option>)}</Select></Field>
          {mode === 'weekly' && <>
            <Field label="Weeks to check"><Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{[1, 2, 4, 8, 12].map((w) => <option key={w}>{w}</option>)}</Select></Field>
            <div><p className="text-[13px] font-semibold mb-1.5">Days of the week</p><div className="flex flex-wrap gap-1.5">{WD3.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={`min-h-10 min-w-11 rounded-lg border px-2 text-sm font-semibold ${days.includes(i) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-line'}`}>{d}</button>)}</div></div>
          </>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy} onClick={() => void find()}>Find tutors</Button>{mode === 'once' && <span className="text-xs text-ink-soft">{fmtDate(first, tz)} · {fmtTime(first, tz)} {shortTz(tz, first)}</span>}</div>
      </Card>

      {out && (!out.length ? <Empty title="No approved tutor teaches this language" /> : (
        <div className="space-y-3">
          {out.map((t) => {
            const free = t.slots.filter((s) => ['confirmed', 'tentative'].includes(s.a)).length
            const tTz = tzOf(t.tutor_id)
            return (
              <Card key={t.tutor_id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-bold">{t.tutor_name}</p>{tTz && tTz !== tz && <p className="text-xs text-ink-soft">Tutor’s local time: {fmtTime(first, tTz)} ({shortTz(tTz, first)})</p>}</div>
                  {mode === 'weekly' ? <Badge tone={free === t.slots.length ? 'green' : free ? 'yellow' : 'red'}>{free}/{t.slots.length} slots free</Badge> : <Badge tone={tone[t.slots[0].a]}>{label[t.slots[0].a]}</Badge>}
                </div>
                {mode === 'weekly' && <div className="mt-3 flex flex-wrap gap-1.5">{t.slots.map((s) => <span key={s.d} title={label[s.a]} className={`text-xs rounded-lg border px-2 py-1 ${s.a === 'confirmed' ? 'bg-emerald-50 border-emerald-200' : s.a === 'tentative' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200 line-through decoration-red-300'}`}>{WD3[dow(s.d)]} {s.d.slice(8)}/{s.d.slice(5, 7)}</span>)}</div>}
              </Card>
            )
          })}
          <Notice tone="gray">Confirmed = inside usual hours and the tutor confirmed that week. Tentative = inside usual hours but not yet confirmed. Create a demo from the Leads pipeline to send the request. Tutors must accept it.</Notice>
        </div>
      ))}
    </>
  )
}
