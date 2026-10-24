import { useState } from 'react'
import { rpc, type Row } from '../lib/api'
import { useAction } from '../lib/hooks'
import { TIMEZONES, fmtDateTime, fmtTime, label, shortTz, todayIn, zonedToUtc } from '../lib/format'
import { Badge, Button, Field, Input, Notice, Select, type Tone } from './ui'

interface Tutor { tutor_id: string; tutor_name: string; availability: string }
const aTone: Record<string, Tone> = { confirmed: 'green', tentative: 'yellow', occupied: 'red', on_leave: 'red', unavailable: 'red', outside_hours: 'gray' }

/**
 * Pick a demo date/time, see which approved tutors for the lead's language are free, and send the request.
 * Sending a request does not confirm the demo: the tutor has to accept it.
 */
export function DemoScheduler({ lead, replaces, teachers, onDone }: { lead: Row; replaces?: string; teachers: Row[]; onDone: () => void }) {
  const [tz, setTz] = useState('Asia/Kolkata')
  const [date, setDate] = useState(todayIn('Asia/Kolkata'))
  const [time, setTime] = useState('17:00')
  const [mins, setMins] = useState(30)
  const [link, setLink] = useState('')
  const [tutors, setTutors] = useState<Tutor[] | null>(null)
  const [pick, setPick] = useState('')
  const finder = useAction()
  const send = useAction()

  const start = () => zonedToUtc(date, time, tz)
  const end = () => new Date(start().getTime() + mins * 60000)

  const find = () => finder.run(async () => {
    if (!lead.language_id) throw new Error('Choose the language on this enquiry first.')
    setPick('')
    setTutors(await rpc<Tutor[]>('find_tutors', { p_language: lead.language_id, p_start: start().toISOString(), p_end: end().toISOString() }))
  })

  const submit = () => send.run(async () => {
    await rpc('schedule_demo', { p_lead: lead.id, p_teacher: pick, p_start: start().toISOString(), p_end: end().toISOString(), p_link: link || null, p_replaces: replaces ?? null })
    onDone()
  }, 'Demo request sent. It is confirmed once the tutor accepts.')

  const chosen = tutors?.find((t) => t.tutor_id === pick)
  const tutorTz = teachers.find((t) => t.id === pick)?.timezone as string | undefined
  const sorted = [...(tutors ?? [])].sort((a, b) => ['confirmed', 'tentative', 'outside_hours', 'unavailable', 'occupied', 'on_leave'].indexOf(a.availability) - ['confirmed', 'tentative', 'outside_hours', 'unavailable', 'occupied', 'on_leave'].indexOf(b.availability))

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTutors(null) }} /></Field>
        <Field label="Start time" required><Input type="time" value={time} step={900} onChange={(e) => { setTime(e.target.value); setTutors(null) }} /></Field>
        <Field label="Length (minutes)"><Select value={mins} onChange={(e) => { setMins(+e.target.value); setTutors(null) }}>{[20, 30, 45, 60].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
        <Field label="Times are in" hint="The time zone of the time you typed."><Select value={tz} onChange={(e) => { setTz(e.target.value); setTutors(null) }}>{TIMEZONES.map((z) => <option key={z}>{z}</option>)}</Select></Field>
      </div>
      <Button onClick={() => void find()} loading={finder.busy} disabled={!date || !time}>Find available tutors</Button>

      {tutors && (
        <div className="space-y-2">
          {!tutors.length && <Notice>No approved tutor teaches this language yet.</Notice>}
          {sorted.map((t) => {
            const blocked = ['occupied', 'on_leave'].includes(t.availability)
            return (
              <label key={t.tutor_id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer min-h-12 ${pick === t.tutor_id ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'} ${blocked ? 'opacity-60' : ''}`}>
                <input type="radio" name="tutor" disabled={blocked} checked={pick === t.tutor_id} onChange={() => setPick(t.tutor_id)} className="accent-brand-500 h-4 w-4" />
                <span className="flex-1 font-semibold">{t.tutor_name}</span>
                <Badge tone={aTone[t.availability] ?? 'gray'}>{label[t.availability] ?? t.availability}</Badge>
              </label>
            )
          })}
          {tutors.some((t) => t.availability === 'tentative') && <p className="text-meta text-ink-soft">Tentative = inside the tutor’s usual hours, but they have not confirmed that week yet. It is not a guaranteed booking.</p>}
        </div>
      )}

      {pick && (
        <>
          <Field label="Meeting link (optional)"><Input type="url" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} /></Field>
          <div className="rounded-xl bg-sand p-3 text-sm">
            <p><b>{chosen?.tutor_name}</b> · {fmtDateTime(start(), tz)} ({shortTz(tz, start())})</p>
            {tutorTz && tutorTz !== tz && <p className="text-ink-soft">Tutor’s local time: {fmtTime(start(), tutorTz)} ({shortTz(tutorTz, start())})</p>}
            <p className="text-ink-soft">Demos reserve the tutor’s time but use no class credit and create no payout.</p>
          </div>
          <Button variant="primary" onClick={() => void submit()} loading={send.busy}>{replaces ? 'Reschedule and send request' : 'Send demo request'}</Button>
        </>
      )}
    </div>
  )
}
