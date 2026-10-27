import { useState } from 'react'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { select, unwrap } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { LEAVE_REASONS } from '../../lib/domain'
import { WEEKDAYS, WD3, addDays, dow, fmtClock, fmtDate, hhmm, inTz, mondayOf, todayIn } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Section, Select, Spinner, StatusBadge, Tabs, TimeInput, useConfirm } from '../../components/ui'
import { useTutorTz } from '../../lib/tutor'

type Tab = 'week' | 'hours' | 'leave'

export default function TutorAvailability() {
  const { profile } = useAuth()
  const tz = useTutorTz()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('week')
  const today = todayIn(tz)
  const [weekOffset, setWeekOffset] = useState(1)
  const week = addDays(mondayOf(today), 7 * weekOffset)
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const [win, setWin] = useState<null | { weekday: number; start: string; end: string }>(null)
  const [off, setOff] = useState<null | { date: string; all: boolean; start: string; end: string; note: string }>(null)
  const [leave, setLeave] = useState<null | { start: string; end: string; reason: string; note: string }>(null)
  const { busy, run } = useAction()

  const { data, loading, error, reload } = useAsync(async () => {
    const [rules, exc, conf, leaves, sess] = await Promise.all([
      select('teacher_availability_rules', '*', (q) => q.order('weekday').order('start_time')),
      select('availability_exceptions', '*', (q) => q.gte('on_date', today).order('on_date')),
      select('availability_confirmations'),
      select('teacher_leaves', '*', (q) => q.order('start_date', { ascending: false })),
      select('sessions', 'id, start_at, status', (q) => q.eq('status', 'scheduled').gte('start_at', new Date().toISOString())),
    ])
    return { rules, exc, conf, leaves, sess }
  })

  const confirmed = (w: string) => data?.conf.some((c) => c.week_start === w)
  const classesOn = (d: string) => (data?.sess ?? []).filter((s) => inTz(s.start_at, tz).date === d).length
  const leaveOn = (d: string) => data?.leaves.find((l) => l.status !== 'rejected' && l.start_date <= d && l.end_date >= d)

  const confirmWeek = () => run(async () => { await unwrap(supabase.from('availability_confirmations').upsert({ teacher_id: profile!.id, week_start: week })); await reload() }, 'Week confirmed. Thank you!')
  const saveWin = () => run(async () => {
    if (!win) return
    if (win.end <= win.start) throw new Error('The end time must be after the start time.')
    if ((data?.rules ?? []).some((r) => r.weekday === win.weekday && r.start_time.slice(0, 5) < win.end && r.end_time.slice(0, 5) > win.start)) throw new Error('That overlaps another window on the same day.')
    await unwrap(supabase.from('teacher_availability_rules').insert({ teacher_id: profile!.id, weekday: win.weekday, start_time: win.start, end_time: win.end })); setWin(null); await reload()
  }, 'Hours added')
  const saveOff = () => run(async () => {
    if (!off) return
    if (!off.all && off.end <= off.start) throw new Error('The end time must be after the start time.')
    await unwrap(supabase.from('availability_exceptions').insert({ teacher_id: profile!.id, on_date: off.date, start_time: off.all ? null : off.start, end_time: off.all ? null : off.end, note: off.note || null })); setOff(null); await reload()
  }, 'Exception saved for that day only')
  const saveLeave = () => run(async () => {
    if (!leave) return
    if (leave.end < leave.start) throw new Error('The last day cannot be before the first day.')
    await unwrap(supabase.from('teacher_leaves').insert({ teacher_id: profile!.id, start_date: leave.start, end_date: leave.end, reason: leave.reason, note: leave.note || null, status: 'pending' })); setLeave(null); await reload()
  }, 'Leave request sent to Mitrin')
  const del = async (table: string, id: string, what: string) => {
    const c = await confirm({ title: `Remove ${what}?`, danger: true, confirmText: 'Remove' })
    if (c.ok) await run(async () => { await unwrap(supabase.from(table).delete().eq('id', id)); await reload() }, `${what[0].toUpperCase()}${what.slice(1)} removed`)
  }
  const affected = leave && leave.end >= leave.start ? (data?.sess ?? []).filter((s) => { const d = inTz(s.start_at, tz).date; return d >= leave.start && d <= leave.end }).length : 0

  return (
    <>
      <PageHeader title="Availability & leave" subtitle="Set your usual weekly hours once. Each week you only add exceptions and confirm. You can still teach outside these hours whenever you choose." />
      <div className="mb-5"><Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'week', label: 'Confirm a week' }, { id: 'hours', label: 'Usual weekly hours' }, { id: 'leave', label: 'Leave' }]} /></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : data && (
        <>
          {tab === 'week' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={weekOffset === 0 ? 'dark' : 'secondary'} onClick={() => setWeekOffset(0)}>This week</Button><Button size="sm" variant={weekOffset === 1 ? 'dark' : 'secondary'} onClick={() => setWeekOffset(1)}>Next week</Button><Button size="sm" variant={weekOffset === 2 ? 'dark' : 'secondary'} onClick={() => setWeekOffset(2)}>In 2 weeks</Button><b className="ml-2">{fmtDate(week, 'UTC')} – {fmtDate(addDays(week, 6), 'UTC')}</b></div>
              {confirmed(week) ? <Notice tone="green"><CheckCircle2 size={16} className="inline mr-1.5" />This week is confirmed. Mitrin sees these hours as available.</Notice> : <Notice>Not confirmed yet. Your usual hours below are shown to Mitrin as <b>tentative</b> until you confirm.</Notice>}
              <div className="grid gap-3 md:grid-cols-7">
                {days.map((d) => {
                  const wins = data.rules.filter((r) => r.weekday === dow(d)); const ex = data.exc.filter((e) => e.on_date === d); const lv = leaveOn(d); const allOff = ex.some((e) => !e.start_time)
                  return (
                    <Card key={d} className={`p-3 ${d === today ? 'border-brand-500' : ''}`}>
                      <p className="text-xs font-extrabold">{WD3[dow(d)]} <span className="text-ink-soft font-semibold">{d.slice(8)}/{d.slice(5, 7)}</span></p>
                      <div className="mt-2 space-y-1 min-h-14">
                        {lv ? <Badge tone="red">{lv.status === 'pending' ? 'Leave (pending)' : 'On leave'}</Badge> : allOff ? <Badge tone="red">Unavailable</Badge> : wins.length ? wins.map((w) => <p key={w.id} className="text-[11px] rounded bg-emerald-50 border border-emerald-200 px-1.5 py-1 font-medium">{fmtClock(w.start_time)}–{fmtClock(w.end_time)}</p>) : <p className="text-xs text-ink-soft/60">No usual hours</p>}
                        {ex.filter((e) => e.start_time).map((e) => <p key={e.id} className="text-[11px] rounded bg-red-50 border border-red-200 px-1.5 py-1">Off {fmtClock(e.start_time)}–{fmtClock(e.end_time)}</p>)}
                        {classesOn(d) > 0 && <p className="text-[11px] text-ink-soft">{classesOn(d)} class{classesOn(d) > 1 ? 'es' : ''} booked</p>}
                      </div>
                      {d >= today && <Button size="sm" className="w-full mt-2" onClick={() => setOff({ date: d, all: true, start: '16:00', end: '18:00', note: '' })}>Not available…</Button>}
                    </Card>
                  )
                })}
              </div>
              {!!data.exc.length && <Section title="Your upcoming exceptions"><ul className="divide-y divide-line text-sm">{data.exc.map((e) => <li key={e.id} className="py-2 flex justify-between gap-2 items-center"><span><b>{fmtDate(e.on_date)}</b> · {e.start_time ? `${fmtClock(e.start_time)} – ${fmtClock(e.end_time)}` : 'All day'} {e.note && <span className="text-ink-soft">({e.note})</span>}</span><Button size="sm" variant="ghost" aria-label="Remove exception" onClick={() => void del('availability_exceptions', e.id, 'exception')}><Trash2 size={14} /></Button></li>)}</ul></Section>}
              <Button variant="primary" className="w-full sm:w-auto" disabled={!!confirmed(week)} loading={busy} onClick={() => void confirmWeek()}>{confirmed(week) ? 'Week confirmed' : `Confirm ${weekOffset === 0 ? 'this' : weekOffset === 1 ? 'next' : 'this'} week`}</Button>
              <p className="text-xs text-ink-soft">Existing classes are never cancelled when you change availability. Change a class from My Classes.</p>
            </div>
          )}

          {tab === 'hours' && (
            <div className="space-y-3 max-w-2xl">
              {WEEKDAYS.map((name, wd) => ({ name, wd })).sort((a, b) => ((a.wd + 6) % 7) - ((b.wd + 6) % 7)).map(({ name, wd }) => {
                const w = data.rules.filter((r) => r.weekday === wd)
                return (
                  <Card key={wd} className="p-4 flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-24"><b>{name}</b></div>
                    <div className="flex-1 flex flex-wrap gap-2">{w.length ? w.map((r) => <span key={r.id} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 pl-2.5 text-sm font-medium">{fmtClock(r.start_time)} – {fmtClock(r.end_time)}<button aria-label={`Remove ${name} ${hhmm(r.start_time)}`} className="p-2 text-ink-soft hover:text-red-600" onClick={() => void del('teacher_availability_rules', r.id, 'time window')}><Trash2 size={14} /></button></span>) : <span className="text-sm text-ink-soft">Not available</span>}</div>
                    <Button size="sm" onClick={() => setWin({ weekday: wd, start: '16:00', end: '20:00' })}><Plus size={14} /> Add hours</Button>
                  </Card>
                )
              })}
              <p className="text-xs text-ink-soft">Add as many windows per day as you like (for example a morning and an evening one). Times are in {tz}.</p>
            </div>
          )}

          {tab === 'leave' && (
            <div className="space-y-4 max-w-3xl">
              <Button variant="primary" onClick={() => setLeave({ start: today, end: today, reason: LEAVE_REASONS[0], note: '' })}><Plus size={16} /> Request leave</Button>
              {!data.leaves.length ? <Card><Empty title="No leave requests" /></Card> : data.leaves.map((l) => (
                <Card key={l.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-bold">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}</p><p className="text-sm text-ink-soft">{l.reason}{l.note ? ` · ${l.note}` : ''}</p></div>
                  <div className="flex items-center gap-2"><StatusBadge status={l.status} text={l.status === 'pending' ? 'Waiting for Mitrin' : l.status === 'approved' ? 'Approved' : 'Declined'} />{l.status === 'pending' && <Button size="sm" onClick={() => void del('teacher_leaves', l.id, 'leave request')}>Cancel</Button>}</div>
                </Card>))}
              <p className="text-xs text-ink-soft">Classes already booked on a leave day are not removed automatically. Mitrin is alerted and can reassign them, or you can change them in My Classes.</p>
            </div>
          )}
        </>
      )}

      <Modal open={!!win} onClose={() => setWin(null)} title={`Add hours · ${win ? WEEKDAYS[win.weekday] : ''}`} footer={<><Button onClick={() => setWin(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveWin()}>Add hours</Button></>}>
        {win && <div className="grid grid-cols-2 gap-4"><Field label="From"><TimeInput step={900} value={win.start} onChange={(e) => setWin({ ...win, start: e.target.value })} /></Field><Field label="Until"><TimeInput step={900} value={win.end} onChange={(e) => setWin({ ...win, end: e.target.value })} /></Field></div>}
      </Modal>
      <Modal open={!!off} onClose={() => setOff(null)} title={`Not available · ${off ? fmtDate(off.date, 'UTC') : ''}`} footer={<><Button onClick={() => setOff(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveOff()}>Save for this day</Button></>}>
        {off && <div className="space-y-4">
          <Field label="Which part of the day?"><Select value={off.all ? 'all' : 'part'} onChange={(e) => setOff({ ...off, all: e.target.value === 'all' })}><option value="all">The whole day</option><option value="part">Only some hours</option></Select></Field>
          {!off.all && <div className="grid grid-cols-2 gap-4"><Field label="From"><TimeInput step={900} value={off.start} onChange={(e) => setOff({ ...off, start: e.target.value })} /></Field><Field label="Until"><TimeInput step={900} value={off.end} onChange={(e) => setOff({ ...off, end: e.target.value })} /></Field></div>}
          <Field label="Note (optional)"><Input value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} /></Field>
          <p className="text-xs text-ink-soft">This changes only this day. Your other weeks stay the same.</p>
        </div>}
      </Modal>
      <Modal open={!!leave} onClose={() => setLeave(null)} title="Request leave" footer={<><Button onClick={() => setLeave(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveLeave()}>Send request</Button></>}>
        {leave && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4"><Field label="First day"><Input type="date" value={leave.start} min={today} onChange={(e) => setLeave({ ...leave, start: e.target.value, end: leave.end < e.target.value ? e.target.value : leave.end })} /></Field><Field label="Last day"><Input type="date" value={leave.end} min={leave.start} onChange={(e) => setLeave({ ...leave, end: e.target.value })} /></Field></div>
          <Field label="Reason"><Select value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })}>{LEAVE_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Note (optional)"><Input value={leave.note} onChange={(e) => setLeave({ ...leave, note: e.target.value })} /></Field>
          {affected > 0 && <Notice>You have {affected} booked class{affected > 1 ? 'es' : ''} in these dates. They will need to be rescheduled or reassigned. Mitrin will be able to see this.</Notice>}
        </div>}
      </Modal>
    </>
  )
}
