import { useState } from 'react'
import { rpc, type Row } from '../lib/api'
import { useAction } from '../lib/hooks'
import { fmtDateTime, fmtTime, label, shortTz, todayIn, zonedToUtc } from '../lib/format'
import { MessageCircle } from 'lucide-react'
import { waLink } from '../lib/domain'
import { Badge, Button, Field, Input, Notice, TimeInput, type Tone } from './ui'

interface Tutor { tutor_id: string; tutor_name: string; availability: string }
const aTone: Record<string, Tone> = { confirmed: 'green', tentative: 'yellow', occupied: 'red', on_leave: 'red', unavailable: 'red', outside_hours: 'gray' }

/**
 * Pick a demo date/time, see which approved tutors for the lead's language are free, and send the request.
 * Sending a request does not confirm the demo: the tutor has to accept it.
 */
export function DemoScheduler({ lead, replaces, teachers, onDone }: { lead: Row; replaces?: string; teachers: Row[]; onDone: () => void }) {
  const tz = 'Asia/Kolkata'
  const mins = 30
  const [date, setDate] = useState(todayIn(tz))
  const [time, setTime] = useState('17:00')
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
        <Field label="Date" required><Input type="date" min={todayIn(tz)} value={date} onChange={(e) => { setDate(e.target.value); setTutors(null) }} /></Field>
        <Field label="Start time (India time, IST)" required><TimeInput min={date === todayIn(tz) ? new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : undefined} value={time} step={900} onChange={(e) => { setTime(e.target.value); setTutors(null) }} /></Field>
      </div>
      <Button variant="primary" onClick={() => void find()} loading={finder.busy} disabled={!date || !time}>Find available tutors</Button>

      {tutors && (
        <div className="space-y-2">
          {!tutors.length && <Notice>No approved tutor teaches this language yet.</Notice>}
          {tutors.length > 0 && <div className="grid grid-cols-2 gap-3 items-start">{([['Available Tutors', sorted.filter((t) => ['confirmed', 'tentative'].includes(t.availability))], ['Other Tutors', sorted.filter((t) => !['confirmed', 'tentative'].includes(t.availability))]] as const).map(([title, list]) => (
            <div key={title} className="space-y-2 min-w-0">
              <p className="text-sm font-bold pt-1">{title}</p>
              {title === 'Other Tutors' && <p className="text-xs text-ink-soft">Not free at this time. Contact them on WhatsApp to ask if they can cover.</p>}
              {!list.length && <p className="text-xs text-ink-soft">None</p>}
              {list.map((t) => {
                const blocked = ['occupied', 'on_leave'].includes(t.availability)
                const wa = title === 'Other Tutors' ? waLink(teachers.find((x) => x.id === t.tutor_id)?.phone) : undefined
                return (
                  <div key={t.tutor_id} className="space-y-1">
                  <label className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 cursor-pointer min-h-12 ${pick === t.tutor_id ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'} ${blocked ? 'opacity-60' : ''}`}>
                    <input type="radio" name="tutor" disabled={blocked} checked={pick === t.tutor_id} onChange={() => setPick(t.tutor_id)} className="accent-brand-500 h-4 w-4" />
                    <span className="flex-1 font-semibold">{t.tutor_name}</span>
                    <Badge tone={aTone[t.availability] ?? 'gray'}>{label[t.availability] ?? t.availability}</Badge>
                  </label>
                  {wa && <a href={`${wa}?text=${encodeURIComponent(`Hello ${t.tutor_name}, can you take a demo class on ${fmtDateTime(start(), tz)} (IST)? Please reply to confirm.`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline"><MessageCircle size={13} /> Contact on WhatsApp</a>}
                  </div>
                )
              })}
            </div>
          ))}</div>}
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
