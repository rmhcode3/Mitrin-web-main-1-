import { useMemo, useState } from 'react'
import { select, type Row } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { WD3, WEEKDAYS, addDays, dow, fmtClock, fmtDate, mondayOf, todayIn } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Notice, PageHeader, Section, Select, Spinner, StatusBadge } from '../../components/ui'
import { DateRangeFilter, useDateRange } from '../../components/DateRange'

export default function AvailabilityMatrix() {
  const range = useDateRange()
  const [lang, setLang] = useState('')
  const [pick, setPick] = useState('')
  const monday = mondayOf(todayIn('Asia/Kolkata'))
  // "All" shows four weeks from this Monday; an empty custom range falls back to this week; custom ranges are capped at 62 days.
  const start = range.preset === 'all' || !range.from ? monday : range.from
  const wanted = range.preset === 'all' ? 28 : range.from ? Math.round((+new Date((range.to || addDays(start, 6)) + 'T00:00:00Z') - +new Date(start + 'T00:00:00Z')) / 86400000) + 1 : 7
  const count = Math.max(1, Math.min(62, wanted))
  const days = Array.from({ length: count }, (_, i) => addDays(start, i))
  const end = days[days.length - 1]
  const weeks = [...new Set(days.map(mondayOf))]

  const { data, loading, error, reload } = useAsync(async () => {
    const [tps, rules, exc, leaves, conf, sess] = await Promise.all([
      select('teacher_profiles', '*, profiles!user_id(full_name,status)', (q) => q.eq('approval_status', 'approved')),
      select('teacher_availability_rules'),
      select('availability_exceptions', '*', (q) => q.gte('on_date', start).lte('on_date', end)),
      select('teacher_leaves', '*', (q) => q.in('status', ['approved', 'pending']).lte('start_date', end).gte('end_date', start)),
      select('availability_confirmations', '*', (q) => q.in('week_start', weeks)),
      select('sessions', 'teacher_id, start_at, status', (q) => q.in('status', ['scheduled', 'completed']).gte('start_at', addDays(start, -1)).lte('start_at', addDays(end, 2))),
    ])
    return { tps: tps.filter((t) => t.profiles?.status === 'active'), rules, exc, leaves, conf, sess }
  }, [start, count])

  const allLangs = useMemo(() => [...new Set((data?.tps ?? []).flatMap((t) => t.languages as string[]))].sort(), [data])
  const rows = (data?.tps ?? []).filter((t) => (!lang || (t.languages as string[]).includes(lang)) && (!pick || t.user_id === pick))

  const confirmed = (t: Row) => weeks.every((w) => data!.conf.some((c) => c.teacher_id === t.user_id && c.week_start === w))

  const cell = (t: Row, d: string) => {
    const x = data!
    const leave = x.leaves.find((l) => l.teacher_id === t.user_id && l.start_date <= d && l.end_date >= d)
    const ex = x.exc.filter((e) => e.teacher_id === t.user_id && e.on_date === d)
    const wins = x.rules.filter((r) => r.teacher_id === t.user_id && r.weekday === dow(d))
    const booked = x.sess.filter((s) => s.teacher_id === t.user_id && new Intl.DateTimeFormat('en-CA', { timeZone: t.timezone }).format(new Date(s.start_at)) === d).length
    if (leave) return <div className="space-y-1"><Badge tone="red">{leave.status === 'pending' ? 'Leave (pending)' : 'On leave'}</Badge>{booked > 0 && <p className="text-[11px] text-red-700 font-semibold">{booked} booked: needs action</p>}</div>
    const allDay = ex.some((e) => !e.start_time)
    return (
      <div className="space-y-1">
        {allDay ? <Badge tone="red">Unavailable</Badge> : wins.length ? wins.map((w) => <p key={w.id} className="text-[11px] leading-tight font-medium rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5">{fmtClock(w.start_time)}–{fmtClock(w.end_time)}</p>) : <span className="text-ink-soft/50">—</span>}
        {!allDay && ex.map((e) => <p key={e.id} className="text-[11px] leading-tight rounded bg-red-50 border border-red-200 px-1.5 py-0.5">Off {fmtClock(e.start_time)}–{fmtClock(e.end_time)}</p>)}
        {booked > 0 && <p className="text-[11px] text-ink-soft">{booked} class{booked > 1 ? 'es' : ''}</p>}
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Tutor availability matrix" subtitle="Day-by-day view of every approved tutor for the chosen dates. Green is a usual-hours window; red shows leave or exceptions. A week is confirmed only when the tutor confirms it." />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <DateRangeFilter range={range} />
        <Select aria-label="Tutor" className="w-48 ml-auto" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">All tutors</option>{(data?.tps ?? []).map((t) => <option key={t.user_id} value={t.user_id}>{t.profiles.full_name}</option>)}</Select>
        <Select aria-label="Language" className="w-44" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">All languages</option>{allLangs.map((l) => <option key={l}>{l}</option>)}</Select>
      </div>
      {pick && data && data.tps.find((t) => t.user_id === pick) && <TutorAvailability t={data.tps.find((t) => t.user_id === pick)!} rules={data.rules} />}
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : !rows.length ? <Empty title="No approved tutors" /> : (
        <>
          <Card className="hidden md:block overflow-x-auto scroll-thin rounded-none">
            <table className="w-full text-sm border-collapse" style={{ minWidth: 220 + days.length * 150 }}>
              <thead><tr className="bg-sand/60 text-meta uppercase tracking-wider text-ink-soft"><th className="text-left px-4 py-3 w-52 border border-line">Tutor</th>{days.map((d) => <th key={d} className="text-left px-3 py-3 border border-line whitespace-nowrap">{WD3[dow(d)]} <span className="font-normal">{d.slice(8)}/{d.slice(5, 7)}</span></th>)}</tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.user_id} className="align-top">
                  <td className="px-4 py-3 border border-line"><b>{t.profiles.full_name}</b><div className="text-xs text-ink-soft">{(t.languages as string[]).join(', ')}</div><div className="mt-1">{confirmed(t) ? <Badge tone="green">Week confirmed</Badge> : <Badge tone="yellow">Tentative</Badge>}</div></td>
                  {days.map((d) => <td key={d} className="px-3 py-3 border border-line">{cell(t, d)}</td>)}
                </tr>))}</tbody>
            </table>
          </Card>
          <div className="md:hidden space-y-3">{rows.map((t) => (
            <Card key={t.user_id} className="p-4">
              <div className="flex justify-between items-start gap-2 mb-2"><div><b>{t.profiles.full_name}</b><div className="text-xs text-ink-soft">{(t.languages as string[]).join(', ')}</div></div>{confirmed(t) ? <Badge tone="green">Confirmed</Badge> : <Badge tone="yellow">Tentative</Badge>}</div>
              <dl className="space-y-2">{days.map((d) => <div key={d} className="flex gap-3"><dt className="w-12 text-xs font-bold text-ink-soft pt-1">{WD3[dow(d)]} {d.slice(8)}</dt><dd className="flex-1">{cell(t, d)}</dd></div>)}</dl>
            </Card>))}</div>
        </>
      )}
    </>
  )
}

const hm = (t: string) => t.slice(0, 5)

/** One tutor's usual weekly hours, blocked dates and leave, plus a conflict checker for a proposed date and time. */
function TutorAvailability({ t, rules }: { t: Row; rules: Row[] }) {
  const today = todayIn('Asia/Kolkata')
  const extra = useAsync(async () => {
    const [exc, leaves] = await Promise.all([
      select('availability_exceptions', '*', (q) => q.eq('teacher_id', t.user_id).gte('on_date', today).order('on_date')),
      select('teacher_leaves', '*', (q) => q.eq('teacher_id', t.user_id).order('start_date', { ascending: false })),
    ])
    return { exc, leaves }
  }, [t.user_id])
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('11:00')
  const [result, setResult] = useState<{ ok: boolean; msgs: string[] } | null>(null)
  const mine = rules.filter((r) => r.teacher_id === t.user_id)

  const check = () => {
    const msgs: string[] = []
    if (!date || !from || !to || to <= from) return setResult({ ok: false, msgs: ['Enter a date and a start time before the end time.'] })
    const leave = extra.data?.leaves.find((l) => ['approved', 'pending'].includes(l.status) && l.start_date <= date && l.end_date >= date)
    if (leave) msgs.push(`On leave from ${fmtDate(leave.start_date, 'UTC')} to ${fmtDate(leave.end_date, 'UTC')}${leave.status === 'pending' ? ' (leave request pending)' : ''}.`)
    for (const e of extra.data?.exc.filter((x) => x.on_date === date) ?? []) {
      if (!e.start_time) msgs.push('Marked unavailable for the whole day.')
      else if (hm(e.start_time) < to && hm(e.end_time) > from) msgs.push(`Off ${fmtClock(e.start_time)}–${fmtClock(e.end_time)} on that day.`)
    }
    const wins = mine.filter((r) => r.weekday === dow(date))
    if (!wins.length) msgs.push(`No usual hours on ${WEEKDAYS[dow(date)]}s.`)
    else if (!wins.some((w) => hm(w.start_time) <= from && hm(w.end_time) >= to)) msgs.push(`Outside usual ${WEEKDAYS[dow(date)]} hours: ${wins.map((w) => `${fmtClock(w.start_time)}–${fmtClock(w.end_time)}`).join(', ')}.`)
    setResult({ ok: !msgs.length, msgs: msgs.length ? msgs : [`${t.profiles.full_name} is free on ${fmtDate(date, 'UTC')}, ${fmtClock(from)}–${fmtClock(to)}.`] })
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4 mb-5">
      <div className="lg:col-span-2 space-y-4">
        <Section title="Usual weekly hours">
          <div className="grid sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const w = mine.filter((r) => r.weekday === d)
              return (
                <div key={d} className="rounded-xl border border-line bg-sand/60 p-3 space-y-1.5">
                  <p className="text-sm font-bold">{WEEKDAYS[d]}</p>
                  {!w.length ? <p className="text-xs text-ink-soft italic">No regular hours set</p> : w.map((r) => <p key={r.id} className="text-xs font-medium rounded bg-emerald-50 border border-emerald-200 px-2 py-1">{fmtClock(r.start_time)} – {fmtClock(r.end_time)}</p>)}
                </div>
              )
            })}
          </div>
        </Section>
        <Section title="Blocked dates & leaves">
          {extra.loading ? <Spinner /> : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-bold mb-2">Blocked dates</p>
                {!extra.data?.exc.length ? <p className="text-xs text-ink-soft italic">No upcoming blocked dates.</p> : <ul className="space-y-1.5">{extra.data.exc.map((x) => <li key={x.id} className="rounded-lg border border-line bg-white px-3 py-2 text-xs"><b>{fmtDate(x.on_date, 'UTC')}</b><span className="block text-ink-soft">{x.start_time ? `${fmtClock(x.start_time)}–${fmtClock(x.end_time)}` : 'Whole day'}{x.reason ? ` · ${x.reason}` : ''}</span></li>)}</ul>}
              </div>
              <div>
                <p className="text-sm font-bold mb-2">Leave periods</p>
                {!extra.data?.leaves.length ? <p className="text-xs text-ink-soft italic">No leave filed.</p> : <ul className="space-y-1.5">{extra.data.leaves.map((l) => <li key={l.id} className="rounded-lg border border-line bg-white px-3 py-2 text-xs flex justify-between gap-2"><span><b>{fmtDate(l.start_date, 'UTC')} – {fmtDate(l.end_date, 'UTC')}</b>{l.reason && <span className="block text-ink-soft">{l.reason}</span>}</span><StatusBadge status={l.status} text={l.status} /></li>)}</ul>}
              </div>
            </div>
          )}
        </Section>
      </div>
      <Section title="Availability conflict tester">
        <div className="space-y-3">
          <Field label="Proposed date"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setResult(null) }} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time"><Input type="time" value={from} onChange={(e) => { setFrom(e.target.value); setResult(null) }} /></Field>
            <Field label="End time"><Input type="time" value={to} onChange={(e) => { setTo(e.target.value); setResult(null) }} /></Field>
          </div>
          <Button variant="primary" onClick={check} disabled={extra.loading}>Inspect schedule conflicts</Button>
          {result && <Notice tone={result.ok ? 'green' : 'red'}><ul className="space-y-1">{result.msgs.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
        </div>
      </Section>
    </div>
  )
}
