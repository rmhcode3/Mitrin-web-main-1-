import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { select, type Row } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { WD3, addDays, dow, fmtClock, fmtDate, mondayOf, todayIn } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Select, Spinner } from '../../components/ui'

export default function AvailabilityMatrix() {
  const [week, setWeek] = useState(mondayOf(todayIn('Asia/Kolkata')))
  const [lang, setLang] = useState('')
  const end = addDays(week, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))

  const { data, loading, error, reload } = useAsync(async () => {
    const [tps, rules, exc, leaves, conf, sess] = await Promise.all([
      select('teacher_profiles', '*, profiles!user_id(full_name,status)', (q) => q.eq('approval_status', 'approved')),
      select('teacher_availability_rules'),
      select('availability_exceptions', '*', (q) => q.gte('on_date', week).lte('on_date', end)),
      select('teacher_leaves', '*', (q) => q.in('status', ['approved', 'pending']).lte('start_date', end).gte('end_date', week)),
      select('availability_confirmations', '*', (q) => q.eq('week_start', week)),
      select('sessions', 'teacher_id, start_at, status', (q) => q.in('status', ['scheduled', 'completed']).gte('start_at', addDays(week, -1)).lte('start_at', addDays(end, 2))),
    ])
    return { tps: tps.filter((t) => t.profiles?.status === 'active'), rules, exc, leaves, conf, sess }
  }, [week])

  const allLangs = useMemo(() => [...new Set((data?.tps ?? []).flatMap((t) => t.languages as string[]))].sort(), [data])
  const rows = (data?.tps ?? []).filter((t) => !lang || (t.languages as string[]).includes(lang))

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
      <PageHeader title="Tutor availability matrix" subtitle="Weekly view of every approved tutor. Green is a usual-hours window; red shows leave or exceptions. A week is confirmed only when the tutor confirms it." />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5"><Button size="sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={16} /></Button><Button size="sm" onClick={() => setWeek(mondayOf(todayIn('Asia/Kolkata')))}>This week</Button><Button size="sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={16} /></Button><b className="ml-2">{fmtDate(week, 'UTC')} – {fmtDate(end, 'UTC')}</b></div>
        <Select aria-label="Language" className="w-44 ml-auto" value={lang} onChange={(e) => setLang(e.target.value)}><option value="">All languages</option>{allLangs.map((l) => <option key={l}>{l}</option>)}</Select>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : !rows.length ? <Empty title="No approved tutors" /> : (
        <>
          <Card className="hidden md:block overflow-x-auto scroll-thin">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="bg-sand/60 text-meta uppercase tracking-wider text-ink-soft"><th className="text-left px-4 py-3 w-52">Tutor</th>{days.map((d) => <th key={d} className="text-left px-3 py-3">{WD3[dow(d)]} <span className="font-normal">{d.slice(8)}/{d.slice(5, 7)}</span></th>)}</tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.user_id} className="border-t border-line align-top">
                  <td className="px-4 py-3"><b>{t.profiles.full_name}</b><div className="text-xs text-ink-soft">{(t.languages as string[]).join(', ')}</div><div className="mt-1">{data!.conf.some((c) => c.teacher_id === t.user_id) ? <Badge tone="green">Week confirmed</Badge> : <Badge tone="yellow">Tentative</Badge>}</div></td>
                  {days.map((d) => <td key={d} className="px-3 py-3">{cell(t, d)}</td>)}
                </tr>))}</tbody>
            </table>
          </Card>
          <div className="md:hidden space-y-3">{rows.map((t) => (
            <Card key={t.user_id} className="p-4">
              <div className="flex justify-between items-start gap-2 mb-2"><div><b>{t.profiles.full_name}</b><div className="text-xs text-ink-soft">{(t.languages as string[]).join(', ')}</div></div>{data!.conf.some((c) => c.teacher_id === t.user_id) ? <Badge tone="green">Confirmed</Badge> : <Badge tone="yellow">Tentative</Badge>}</div>
              <dl className="space-y-2">{days.map((d) => <div key={d} className="flex gap-3"><dt className="w-12 text-xs font-bold text-ink-soft pt-1">{WD3[dow(d)]} {d.slice(8)}</dt><dd className="flex-1">{cell(t, d)}</dd></div>)}</dl>
            </Card>))}</div>
        </>
      )}
    </>
  )
}
