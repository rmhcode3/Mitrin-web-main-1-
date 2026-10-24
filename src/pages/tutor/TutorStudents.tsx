import { useState } from 'react'
import { Plus, Repeat } from 'lucide-react'
import { rpc, select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { fmtDate, fmtDateTime, label } from '../../lib/format'
import { NewClassModal } from '../../components/scheduling'
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Input, KV, PageHeader, SearchBox, Section, Spinner, Stat, StatusBadge, Notice } from '../../components/ui'
import { one, useMyStudents, useTutorTz } from '../../lib/tutor'

export default function TutorStudents() {
  const { profile } = useAuth()
  const tz = useTutorTz()
  const { data, loading, error, reload } = useMyStudents()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [book, setBook] = useState<string | null>(null)
  const { busy, run } = useAction()
  const rows = (data ?? []).filter((e) => !q.trim() || [e.students?.full_name, one<Row>(e.languages)?.name].some((v) => String(v ?? '').toLowerCase().includes(q.trim().toLowerCase())))
  const cur = rows.find((e) => e.id === openId) ?? data?.find((e) => e.id === openId)

  const respond = (id: string, accept: boolean) => run(async () => { await rpc('respond_assignment', { p_enrollment: id, p_accept: accept }); await reload() }, accept ? 'Accepted. You can now arrange classes.' : 'Declined')

  return (
    <>
      <PageHeader title="My students" subtitle="Your learners, classes remaining and makeups. Fee details are handled by Mitrin and never shown here." />
      <SearchBox className="max-w-md mb-4" value={q} onChange={setQ} placeholder="Search students…" />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : !rows.length ? <Empty title="No students yet" hint="When Mitrin assigns a learner you will see a request on your Home screen." /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => (
            <Card key={e.id} className="p-4 cursor-pointer hover:border-brand-200 hover:shadow-md transition" onClick={() => setOpenId(e.id)}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-bold truncate">{e.students?.full_name}</p><p className="text-sm text-ink-soft">{one<Row>(e.languages)?.name}{e.students?.level ? ` · ${e.students.level}` : ''}</p></div>
                {e.status === 'on_hold' ? <Badge tone="red">On hold</Badge> : <StatusBadge status={e.status} text={label[e.status]} />}</div>
              {e.assignment_status === 'awaiting_tutor' ? (
                <div className="mt-3 flex gap-2" onClick={(ev) => ev.stopPropagation()}><Button size="sm" variant="primary" disabled={busy} onClick={() => void respond(e.id, true)}>Accept</Button><Button size="sm" disabled={busy} onClick={() => void respond(e.id, false)}>Decline</Button></div>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-sand py-1.5"><p className="font-extrabold">{e.remaining}</p><p className="text-[10px] uppercase text-ink-soft">Remaining</p></div>
                  <div className={`rounded-lg py-1.5 ${e.makeup ? 'bg-brand-50' : 'bg-sand'}`}><p className="font-extrabold">{e.makeup}</p><p className="text-[10px] uppercase text-ink-soft">Makeup</p></div>
                  <div className="rounded-lg bg-sand py-1.5"><p className="font-extrabold">{e.reserved}</p><p className="text-[10px] uppercase text-ink-soft">Booked</p></div>
                </div>
              )}
              {e.next && <p className="text-xs text-ink-soft mt-2">Next: {fmtDateTime(e.next, tz)}</p>}
              {e.status === 'on_hold' && <p className="text-xs text-red-700 font-semibold mt-2">On hold. Please contact Mitrin.</p>}
            </Card>
          ))}
        </div>
      )}

      {cur && <StudentView e={cur} onClose={() => setOpenId(null)} onBook={() => setBook(cur.id)} tz={tz} />}
      {book && <NewClassModal teacherId={profile!.id} teachers={[]} defaultTz={tz} preselect={[book]} onClose={() => setBook(null)} onDone={() => { setBook(null); void reload() }} />}
    </>
  )
}

function StudentView({ e, onClose, onBook, tz }: { e: Row; onClose: () => void; onBook: () => void; tz: string }) {
  const [note, setNote] = useState('')
  const { busy, run } = useAction()
  const sessions = useAsync(() => select('session_participants', 'attendance, absence_reason, sessions!inner(id,start_at,status)', (q) => q.eq('enrollment_id', e.id)), [e.id])
  const notes = useAsync(() => select('student_notes', '*, profiles!author_id(full_name)', (q) => q.eq('student_id', e.students.id).order('created_at', { ascending: false })), [e.id])
  const ps = (sessions.data ?? []).map((p): Row => ({ ...p, s: one<Row>(p.sessions)! })).sort((a, b) => +new Date(b.s.start_at) - +new Date(a.s.start_at))
  const canBook = e.status === 'active' && e.assignment_status === 'accepted'
  return (
    <Drawer open onClose={onClose} badge={<StatusBadge status={e.status} text={label[e.status]} />} title={e.students?.full_name} subtitle={`${one<Row>(e.languages)?.name}${e.students?.level ? ` · ${e.students.level}` : ''}`}>
      {e.status === 'on_hold' && <Notice tone="red">On hold. Contact Mitrin. New classes cannot be booked until the hold is released.</Notice>}
      <div className="grid grid-cols-3 gap-3"><Stat label="Remaining" value={e.remaining} tone="orange" /><Stat label="Makeup to arrange" value={e.makeup} /><Stat label="Delivered" value={e.fulfilled} tone="green" /></div>
      <Section title="Course"><dl className="grid grid-cols-2 gap-4"><KV k="Preferred timing" v={e.preferred_timing} /><KV k="Term" v={e.term_start || e.term_end ? `${fmtDate(e.term_start)} → ${fmtDate(e.term_end)}` : null} /><KV k="Age group" v={e.students?.age_group} /><KV k="Learner time zone" v={e.students?.timezone} /></dl></Section>
      {canBook && <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={e.remaining < 1} onClick={onBook}><Plus size={16} /> Schedule class</Button>{e.makeup > 0 && <Button onClick={onBook}><Repeat size={16} /> Arrange makeup ({e.makeup})</Button>}{e.remaining < 1 && <p className="text-sm text-ink-soft self-center">No classes left. Ask Mitrin to allocate more.</p>}</div>}
      <Section title="Class history">{sessions.loading ? <Spinner /> : !ps.length ? <p className="text-sm text-ink-soft">No classes yet.</p> : <ul className="divide-y divide-line text-sm">{ps.slice(0, 30).map((p) => <li key={p.s.id} className="py-2 flex justify-between gap-2"><span>{fmtDateTime(p.s.start_at, tz)}</span>{p.s.status === 'cancelled' ? <Badge tone="red">Cancelled</Badge> : <StatusBadge status={p.attendance} text={label[p.attendance]} />}</li>)}</ul>}</Section>
      <Section title="Lesson notes">
        <div className="flex gap-2 mb-3"><Input aria-label="New note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Progress, topics covered…" /><Button disabled={!note.trim()} loading={busy} onClick={() => void run(async () => { await unwrap(supabase.from('student_notes').insert({ student_id: e.students.id, body: note.trim() })); setNote(''); await notes.reload() }, 'Note added')}>Add</Button></div>
        {notes.error ? <p className="text-sm text-ink-soft">Notes are not available yet.</p> : !notes.data?.length ? <p className="text-sm text-ink-soft">No notes yet.</p> : <ul className="space-y-2">{notes.data.map((n: Row) => <li key={n.id} className="rounded-xl border border-line bg-white p-3 text-sm"><div className="flex justify-between text-xs text-ink-soft mb-1"><span>{n.profiles?.full_name ?? 'Staff'}</span><span>{fmtDate(n.created_at)}</span></div>{n.body}</li>)}</ul>}
      </Section>
    </Drawer>
  )
}
