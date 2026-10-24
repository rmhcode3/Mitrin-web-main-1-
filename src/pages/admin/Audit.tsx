import { useState } from 'react'
import { select, type Row } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { addDays, fmtDateTime, todayIn } from '../../lib/format'
import { Button, DataTable, Drawer, Empty, ErrorBox, ExportMenu, Field, Input, PageHeader, Select, Spinner } from '../../components/ui'

const PAGE = 100

function Diff({ a, b }: { a: Row | null; b: Row | null }) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  const changed = keys.filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]))
  const show = a && b ? changed : keys
  return (
    <dl className="text-sm space-y-2">
      {show.map((k) => (
        <div key={k} className="rounded-lg border border-line p-2.5"><dt className="text-meta uppercase font-bold tracking-wider text-ink-soft">{k}</dt>
          <dd className="break-words font-mono text-xs mt-1">{a && b && <span className="text-red-700 line-through mr-2">{JSON.stringify(a[k]) ?? '∅'}</span>}<span className="text-emerald-800">{JSON.stringify((b ?? a)?.[k]) ?? '∅'}</span></dd></div>
      ))}
      {!show.length && <p className="text-ink-soft">No field changed.</p>}
    </dl>
  )
}

export default function Audit() {
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState(addDays(todayIn('Asia/Kolkata'), -7))
  const [to, setTo] = useState(todayIn('Asia/Kolkata'))
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<Row | null>(null)

  const people = useAsync(() => select('profiles', 'id, full_name, role'))
  const { data, loading, error, reload } = useAsync(async () => {
    const ents = await select('audit_events', 'entity_type', (q) => q.limit(1000))
    const rows = await select('audit_events', '*', (q) => {
      let x = q.gte('created_at', `${from}T00:00:00+05:30`).lt('created_at', `${addDays(to, 1)}T00:00:00+05:30`).order('created_at', { ascending: false }).limit(limit)
      if (entity) x = x.eq('entity_type', entity)
      if (action) x = x.eq('action', action)
      if (actor) x = x.eq('actor_id', actor)
      return x
    })
    return { rows, entities: [...new Set(ents.map((e) => e.entity_type as string))].sort() }
  }, [entity, action, actor, from, to, limit])

  const who = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.full_name ?? id.slice(0, 8) : 'System')
  const cols = [{ header: 'When', value: (r: Row) => r.created_at }, { header: 'Who', value: (r: Row) => who(r.actor_id) }, { header: 'Action', value: (r: Row) => r.action }, { header: 'Record type', value: (r: Row) => r.entity_type }, { header: 'Record id', value: (r: Row) => r.entity_id }, { header: 'Reason', value: (r: Row) => r.reason }]

  return (
    <>
      <PageHeader title="Audit history" subtitle="An append-only record of who changed what and when. Entries cannot be edited or deleted by anyone." actions={<ExportMenu name="audit" rows={data?.rows ?? []} cols={cols} />} />
      <div className="rounded-2xl border border-line bg-white p-4 mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE) }} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setLimit(PAGE) }} /></Field>
        <Field label="Record type"><Select value={entity} onChange={(e) => { setEntity(e.target.value); setLimit(PAGE) }}><option value="">All</option>{data?.entities.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Action"><Select value={action} onChange={(e) => { setAction(e.target.value); setLimit(PAGE) }}><option value="">All</option>{['insert', 'update', 'delete', 'hold_removed_from_session'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Who"><Select value={actor} onChange={(e) => { setActor(e.target.value); setLimit(PAGE) }}><option value="">Anyone</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Spinner /> : (
        <>
          <DataTable rows={data?.rows ?? []} rowKey={(r) => String(r.id)} onRowClick={setOpen} empty={<Empty title="No events match" />}
            columns={[{ h: 'When', primary: true, cell: (r) => <span className="font-mono text-xs">{fmtDateTime(r.created_at)}</span> }, { h: 'Who', cell: (r) => who(r.actor_id) }, { h: 'Action', cell: (r) => r.action }, { h: 'Record', cell: (r) => <span>{r.entity_type} <span className="text-xs text-ink-soft font-mono">{String(r.entity_id).slice(0, 8)}</span></span> }, { h: 'Reason', cell: (r) => r.reason ?? '' }]} />
          {data && data.rows.length >= limit && <div className="text-center mt-4"><Button onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
        </>
      )}
      {open && (
        <Drawer open onClose={() => setOpen(null)} title={`${open.action} · ${open.entity_type}`} subtitle={`${fmtDateTime(open.created_at)} by ${who(open.actor_id)}`}>
          {open.reason && <p className="text-sm"><b>Reason:</b> {open.reason}</p>}
          <Diff a={open.before_value} b={open.after_value} />
        </Drawer>
      )}
    </>
  )
}
