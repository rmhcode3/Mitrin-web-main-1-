import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CheckCircle2, ClipboardCheck, Clock, ExternalLink, Repeat, UserPlus } from 'lucide-react'
import { rpc, select, type Row } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync, useSetting } from '../../lib/hooks'
import { WEEKDAYS, addDays, fmtDateTime, fmtTime, inTz, label, mondayOf, todayIn } from '../../lib/format'
import { NewClassModal, SESSION_SELECT, SessionPanel, names } from '../../components/scheduling'
import { Badge, Button, Card, Empty, ErrorBox, Modal, PageHeader, Spinner, Stat, Textarea, Field } from '../../components/ui'
import { one, useMyStudents, useTutorTz } from '../../lib/tutor'

export default function TutorHome() {
  const { profile } = useAuth()
  const tz = useTutorTz()
  const confirmDay = useSetting<string>('tutor.availability_confirm_day', 'Thursday')
  const [open, setOpen] = useState<Row | null>(null)
  const [makeup, setMakeup] = useState<string | null>(null)
  const [decline, setDecline] = useState<null | { kind: 'demo' | 'assign'; id: string; name: string }>(null)
  const [why, setWhy] = useState('')
  const { busy, run } = useAction()
  const students = useMyStudents()

  const today = todayIn(tz)
  const nextWeek = addDays(mondayOf(today), 7)
  const { data, loading, error, reload } = useAsync(async () => {
    const lo = new Date(Date.now() - 45 * 86400000).toISOString()
    const hi = new Date(Date.now() + 2 * 86400000).toISOString()
    const [sessions, demos, conf] = await Promise.all([
      select('sessions', SESSION_SELECT, (q) => q.gte('start_at', lo).lt('start_at', hi).order('start_at')),
      select('demos', '*', (q) => q.in('status', ['awaiting_tutor', 'accepted']).order('start_at')),
      select('availability_confirmations', '*', (q) => q.eq('week_start', nextWeek)),
    ])
    return { sessions, demos, confirmed: conf.length > 0 }
  })

  const todays = (data?.sessions ?? []).filter((s) => inTz(s.start_at, tz).date === today && s.status !== 'cancelled')
  const pending = (data?.sessions ?? []).filter((s) => s.status === 'scheduled' && new Date(s.start_at) <= new Date())
  const reqAssign = (students.data ?? []).filter((e) => e.assignment_status === 'awaiting_tutor')
  const reqDemo = (data?.demos ?? []).filter((d) => d.status === 'awaiting_tutor')
  const makeups = (students.data ?? []).filter((e) => e.makeup > 0 && e.status === 'active')
  const dayNo = WEEKDAYS.indexOf(confirmDay); const todayNo = inTz(new Date(), tz).weekday
  const dueConfirm = !data?.confirmed && (((todayNo - dayNo + 7) % 7) < 4)
  const refresh = () => { void reload(); void students.reload() }

  const respond = (kind: 'demo' | 'assign', id: string, accept: boolean, reason?: string) => run(async () => {
    if (kind === 'demo') await rpc('respond_demo', { p_demo: id, p_accept: accept, p_reason: reason ?? null })
    else await rpc('respond_assignment', { p_enrollment: id, p_accept: accept })
    setDecline(null); setWhy(''); refresh()
  }, accept ? 'Accepted. Thank you!' : 'Declined. Mitrin will arrange another tutor.')

  return (
    <>
      <PageHeader title={`Hello, ${profile?.full_name?.split(' ')[0]}`} subtitle="Here is what needs you today." />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <div className="space-y-6">
          {!data.confirmed && (
            <Card className={`p-4 flex flex-wrap items-center justify-between gap-3 ${dueConfirm ? 'border-brand-500 bg-brand-50' : ''}`}>
              <div className="flex items-center gap-3"><CalendarCheck className="text-brand-600" /><div><b>Confirm next week</b><p className="text-sm text-ink-soft">{dueConfirm ? 'Please confirm your hours so Mitrin can plan demos.' : `Your usual hours are shown as tentative until you confirm. We remind you from ${confirmDay}.`}</p></div></div>
              <Link to="/tutor/availability"><Button variant="primary">Confirm next week</Button></Link>
            </Card>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Today’s classes" value={todays.length} tone="blue" icon={<Clock size={20} />} />
            <Link to="/tutor/attendance" className="block"><Stat label="Attendance to update" value={pending.length} tone={pending.length ? 'yellow' : 'gray'} icon={<ClipboardCheck size={20} />} /></Link>
            <Stat label="Makeups to arrange" value={makeups.reduce((a, e) => a + e.makeup, 0)} tone={makeups.length ? 'orange' : 'gray'} icon={<Repeat size={20} />} />
            <Stat label="New requests" value={reqAssign.length + reqDemo.length} tone={reqAssign.length + reqDemo.length ? 'orange' : 'gray'} icon={<UserPlus size={20} />} />
          </div>

          {(reqDemo.length > 0 || reqAssign.length > 0) && (
            <section>
              <h2 className="font-extrabold text-lg mb-3">Requests for you</h2>
              <div className="space-y-3">
                {reqDemo.map((d) => (
                  <Card key={d.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div><Badge tone="purple">Demo class</Badge><p className="font-bold mt-1">{d.learner_name}{d.level ? ` · ${d.level}` : ''}</p><p className="text-sm text-ink-soft">{fmtDateTime(d.start_at, tz)} – {fmtTime(d.end_at, tz)}</p></div>
                      <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void respond('demo', d.id, true)}>Accept</Button><Button disabled={busy} onClick={() => setDecline({ kind: 'demo', id: d.id, name: d.learner_name })}>Decline</Button></div></div>
                  </Card>))}
                {reqAssign.map((e) => (
                  <Card key={e.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div><Badge tone="orange">New student</Badge><p className="font-bold mt-1">{e.students?.full_name} · {one<Row>(e.languages)?.name}</p><p className="text-sm text-ink-soft">{e.preferred_timing ? `Preferred: ${e.preferred_timing}` : 'Accept to start arranging classes.'}</p></div>
                      <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void respond('assign', e.id, true)}>Accept</Button><Button disabled={busy} onClick={() => void respond('assign', e.id, false)}>Decline</Button></div></div>
                  </Card>))}
              </div>
            </section>
          )}

          <section>
            <h2 className="font-extrabold text-lg mb-3">Today’s classes</h2>
            {!todays.length ? <Card><Empty title="No classes today" hint="Enjoy the quiet, or schedule one from My Classes." /></Card> : (
              <div className="space-y-3">{todays.map((s) => {
                const started = new Date(s.start_at) <= new Date()
                return (
                  <Card key={s.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button className="text-left min-w-0" onClick={() => setOpen(s)}><p className="text-sm font-bold text-brand-700">{fmtTime(s.start_at, tz)} – {fmtTime(s.end_at, tz)}</p><p className="font-bold truncate">{names(s).join(', ')}</p><p className="text-xs text-ink-soft">{(s.session_participants as Row[]).length > 1 ? 'Group class' : one<Row>(s.session_participants[0]?.enrollments?.languages)?.name}</p></button>
                      <div className="flex flex-wrap items-center gap-2">
                        {s.status === 'completed' ? <Badge tone="green"><CheckCircle2 size={12} className="mr-1" />Marked</Badge> : <>
                          {s.meeting_link ? <a href={s.meeting_link} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={14} /> Join</Button></a> : <Button size="sm" onClick={() => setOpen(s)}>Add link</Button>}
                          <Button size="sm" variant={started ? 'primary' : 'secondary'} onClick={() => setOpen(s)}>{started ? 'Mark attendance' : 'Open'}</Button></>}
                      </div>
                    </div>
                  </Card>)
              })}</div>
            )}
          </section>

          {makeups.length > 0 && (
            <section>
              <h2 className="font-extrabold text-lg mb-3">Makeup classes to arrange</h2>
              <Card className="divide-y divide-line">{makeups.map((e) => <div key={e.id} className="p-4 flex flex-wrap items-center justify-between gap-3"><div><b>{e.students?.full_name}</b><p className="text-sm text-ink-soft">{e.makeup} missed class{e.makeup === 1 ? '' : 'es'} still owed · {e.remaining} classes remaining</p></div><Button onClick={() => setMakeup(e.id)}>Schedule makeup</Button></div>)}</Card>
            </section>
          )}
          {data.demos.filter((d) => d.status === 'accepted').length > 0 && (
            <section><h2 className="font-extrabold text-lg mb-3">Upcoming demos</h2><Card className="divide-y divide-line">{data.demos.filter((d) => d.status === 'accepted' && new Date(d.end_at) > new Date()).map((d) => <div key={d.id} className="p-4 flex flex-wrap justify-between gap-2 text-sm"><span><b>{d.learner_name}</b> <span className="text-ink-soft">· {label[d.status]}</span></span><span>{fmtDateTime(d.start_at, tz)}{d.meeting_link && <a className="ml-3 text-brand-700 underline" href={d.meeting_link} target="_blank" rel="noreferrer">Join</a>}</span></div>)}</Card></section>
          )}
        </div>
      )}

      {open && <SessionPanel session={open} teachers={[]} tz={tz} admin={false} canCoordinate={false} onClose={() => setOpen(null)} onChanged={refresh} />}
      {makeup && <NewClassModal teacherId={profile!.id} teachers={[]} defaultTz={tz} preselect={[makeup]} onClose={() => setMakeup(null)} onDone={() => { setMakeup(null); refresh() }} />}
      <Modal open={!!decline} onClose={() => setDecline(null)} title={`Decline ${decline?.name ?? ''}?`} footer={<><Button onClick={() => setDecline(null)}>Back</Button><Button variant="danger" loading={busy} disabled={decline?.kind === 'demo' && !why.trim()} onClick={() => void respond(decline!.kind, decline!.id, false, why)}>Decline</Button></>}>
        <Field label="Please say why" required hint="Mitrin will use this to find another tutor."><Textarea value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </Modal>
    </>
  )
}
