import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronRight, Download, History, Lock, RotateCcw, Upload, UserPlus } from 'lucide-react'
import { rpc, select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { clearSettingCache, useAction, useAsync } from '../../lib/hooks'
import { fmtDateTime, shortTz, zonedToUtc, fmtTime } from '../../lib/format'
import { AddTeacherModal } from './Teachers'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, SearchBox, Section, Select, Spinner, Stat, Textarea } from '../../components/ui'

const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : typeof v === 'string' ? v : String(v))
const PROTECTED = [
  'One class credit is exactly one class for one learner, whatever its length.',
  'Tutors can never create credits or move a learner to another tutor. Only staff can.',
  'No class can be booked beyond a learner’s available credits, including group classes.',
  'A tutor or learner can never be in two separate overlapping classes. A group is one shared class.',
  'A missed class or a tutor cancellation keeps the owed class. Owed classes never expire.',
  'A learner on payment hold cannot receive new classes; other group members are unaffected.',
  'Tutors earn only for learners marked Present, at the rate in force when attendance is saved.',
  'Finalizing a payout locks its attendance; past payouts are never edited, only adjusted.',
  'A prepaid period is never charged again, and one enrollment is never billed twice.',
  'Role boundaries and privacy are enforced in the database; audit logging cannot be turned off.',
  'Settings never rewrite completed classes, issued credits, recorded payments or finalized payouts.',
]

function Control({ def, value, onChange, disabled }: { def: Row; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  if (def.type === 'boolean') {
    return (
      <button role="switch" aria-checked={Boolean(value)} aria-label={def.label} disabled={disabled} onClick={() => onChange(!value)}
        className={`relative h-8 w-14 rounded-full transition disabled:opacity-50 ${value ? 'bg-brand-500' : 'bg-gray-300'}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? 'left-7' : 'left-1'}`} /></button>
    )
  }
  if (def.type === 'enum') {
    return <Select aria-label={def.label} disabled={disabled} value={JSON.stringify(value)} onChange={(e) => onChange(JSON.parse(e.target.value))} className="max-w-60">{(def.options as unknown[]).map((o) => <option key={JSON.stringify(o)} value={JSON.stringify(o)}>{String(o)}{def.unit ? ` ${def.unit}` : ''}</option>)}</Select>
  }
  if (def.type === 'integer') {
    return <div className="flex items-center gap-2"><Input aria-label={def.label} type="number" inputMode="numeric" step={1} min={def.min_value ?? undefined} max={def.max_value ?? undefined} disabled={disabled} className="w-28" value={value === '' || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />{def.unit && <span className="text-sm text-ink-soft">{def.unit}</span>}</div>
  }
  return <Input aria-label={def.label} disabled={disabled} maxLength={200} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="max-w-md" />
}

function validate(def: Row, v: unknown): string | null {
  if (def.type === 'integer') {
    if (v === '' || typeof v !== 'number' || !Number.isInteger(v)) return 'Enter a whole number.'
    if (def.min_value !== null && v < Number(def.min_value)) return `Must be at least ${def.min_value}.`
    if (def.max_value !== null && v > Number(def.max_value)) return `Must be at most ${def.max_value}.`
  }
  if (def.type === 'text' && (typeof v !== 'string' || !v.trim() || v.length > 200)) return 'Enter 1 to 200 characters.'
  return null
}

function Languages({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload } = useAsync(() => select('languages', '*', (q) => q.order('name')))
  const [name, setName] = useState('')
  const { busy, run } = useAction()
  const dup = (data ?? []).some((l) => l.name.toLowerCase() === name.trim().toLowerCase())
  return (
    <Section title="Languages offered">
      <p className="text-sm text-ink-soft mb-3">Languages appear in enquiries, enrollments, tutor applications and the slot finder. Archiving hides a language from new records; existing enrollments are never deleted.</p>
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <ul className="divide-y divide-line text-sm mb-3">{(data ?? []).map((l) => (
          <li key={l.id} className="py-2 flex items-center justify-between gap-3"><span className={l.active ? 'font-semibold' : 'text-ink-soft line-through'}>{l.name}</span>
            {canEdit && <Button size="sm" disabled={busy} onClick={() => void run(async () => { await unwrap(supabase.from('languages').update({ active: !l.active }).eq('id', l.id)); await reload() }, l.active ? 'Language archived' : 'Language restored')}>{l.active ? 'Archive' : 'Restore'}</Button>}</li>))}</ul>
      )}
      {canEdit && (
        <div className="flex gap-2 max-w-md"><Input aria-label="New language" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Add a language, e.g. Japanese" />
          <Button variant="primary" disabled={name.trim().length < 2 || dup} loading={busy} onClick={() => void run(async () => { await unwrap(supabase.from('languages').insert({ name: name.trim() })); setName(''); await reload() }, 'Language added')}>Add</Button></div>
      )}
      {dup && <p className="text-xs text-red-600 mt-1">That language already exists.</p>}
    </Section>
  )
}

export default function Settings() {
  const { can, profile } = useAuth()
  const toast = useToast()
  const [addingTeacher, setAddingTeacher] = useState(false)
  const [q, setQ] = useState('')
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [confirming, setConfirming] = useState<null | { def: Row; next: unknown; kind: 'change' | 'default' | 'rollback'; from?: number }>(null)
  const [reason, setReason] = useState('')
  const [hist, setHist] = useState<string | null>(null)
  const [imp, setImp] = useState<null | { rows: { key: string; value: unknown; label: string; cur: unknown; ok: boolean; why?: string }[] }>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, run } = useAction()
  const [latency, setLatency] = useState<null | number | string>(null)

  const { data, loading, error, reload } = useAsync(async () => {
    const [defs, vals, changes, people] = await Promise.all([
      select('setting_definitions', '*', (x) => x.order('grp').order('label')), select('app_settings'),
      select('settings_changes', '*', (x) => x.order('created_at', { ascending: false }).limit(300)), select('profiles', 'id, full_name'),
    ])
    return { defs, vals: new Map(vals.map((v) => [v.key as string, v])), changes, people }
  })

  const who = (id: string | null) => data?.people.find((p) => p.id === id)?.full_name ?? 'System'
  const current = (d: Row) => data!.vals.get(d.key)?.value ?? d.default_value
  const version = (d: Row) => data!.vals.get(d.key)?.version ?? 0
  const editable = (d: Row) => can('super_admin') || (d.edit_permission !== 'super_admin' && can(d.edit_permission))

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const defs = (data?.defs ?? []).filter((d) => !s || [d.label, d.help, d.key, d.grp].some((x) => String(x).toLowerCase().includes(s)))
    const m = new Map<string, Row[]>()
    for (const d of defs) m.set(d.grp, [...(m.get(d.grp) ?? []), d])
    return [...m.entries()]
  }, [data, q])

  const apply = () => run(async () => {
    const { def, next, from } = confirming!
    await rpc('set_setting', { p_key: def.key, p_value: next, p_reason: reason.trim() || null, p_expected_version: from ?? version(def) })
    setConfirming(null); setReason(''); setDrafts((d) => { const n = { ...d }; delete n[def.key]; return n }); clearSettingCache(); await reload()
  }, 'Setting saved. New records use it from now on.')

  const ping = async () => {
    const t0 = performance.now(); setLatency('…')
    try { await rpc('setting_value', { p_key: 'credits.low_balance_warning_at' }); setLatency(Math.round(performance.now() - t0)) } catch (e) { setLatency((e as Error).message) }
  }

  const exportCfg = () => {
    const out = { exported_at: new Date().toISOString(), source: 'mitrin-tutor-management', note: 'Non-sensitive settings only. No secrets, learner data or financial records.', settings: (data?.defs ?? []).map((d) => ({ key: d.key, value: current(d), version: version(d) })) }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })); a.download = `mitrin-settings-${new Date().toISOString().slice(0, 10)}.json`; a.click()
  }
  const onImport = async (f?: File) => {
    if (!f || !data) return
    try {
      const j = JSON.parse(await f.text()) as { settings?: { key: string; value: unknown }[] }
      if (!Array.isArray(j.settings)) throw new Error('Not a Mitrin settings export.')
      const rows = j.settings.map((s) => { const d = data.defs.find((x) => x.key === s.key); if (!d) return { key: s.key, value: s.value, label: s.key, cur: null, ok: false, why: 'Unknown setting' }; const why = validate(d, s.value) ?? (d.type === 'enum' && !(d.options as unknown[]).some((o) => JSON.stringify(o) === JSON.stringify(s.value)) ? 'Not an allowed choice' : d.type === 'boolean' && typeof s.value !== 'boolean' ? 'Must be on or off' : !editable(d) ? 'You cannot change this setting' : undefined); return { key: s.key, value: s.value, label: d.label, cur: current(d), ok: !why, why } }).filter((r) => JSON.stringify(r.value) !== JSON.stringify(r.cur) || !r.ok)
      setImp({ rows }); setReason('')
    } catch (e) { setImp(null); toast.err((e as Error).message) }
  }
  const applyImport = () => run(async () => {
    for (const r of imp!.rows.filter((x) => x.ok)) { const d = data!.defs.find((x) => x.key === r.key)!; await rpc('set_setting', { p_key: r.key, p_value: r.value, p_reason: reason.trim() || 'Configuration import', p_expected_version: version(d) }); await reload() }
    setImp(null); clearSettingCache()
  }, 'Configuration imported')

  const sample = (d: string) => { const u = zonedToUtc(d, '09:00', 'America/New_York'); return `${d}: 9:00 AM ${shortTz('America/New_York', u)} = ${fmtTime(u, 'Asia/Kolkata')} IST` }
  const recent = (data?.changes ?? []).slice(0, 8)
  const custom = data ? data.defs.filter((d) => data.vals.has(d.key)).length : 0

  return (
    <>
      <PageHeader title="Settings" subtitle="Change how Mitrin runs without a developer. Every change is validated, needs a reason, and applies to new records from now on. Past classes, credits, payments and payouts are never recalculated." />
      {can('coordinator') && (
        <section className="mb-6" aria-labelledby="g-teachers">
          <h2 id="g-teachers" className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-2">Teacher management</h2>
          <Card className="divide-y divide-line overflow-hidden">
            <button type="button" onClick={() => setAddingTeacher(true)} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-sand/60">
              <span className="grid place-items-center size-11 rounded-xl bg-brand-50 text-brand-700"><UserPlus size={20} /></span>
              <span className="flex-1 min-w-0"><span className="block font-bold">Add Teachers</span><span className="block text-sm text-ink-soft">Create a new teacher account</span></span>
              <ChevronRight size={18} className="text-ink-soft" />
            </button>
          </Card>
        </section>
      )}
      {addingTeacher && <AddTeacherModal onClose={() => setAddingTeacher(false)} onDone={() => setAddingTeacher(false)} />}
      <SearchBox className="max-w-xl mb-5" value={q} onChange={setQ} placeholder="Search settings: e.g. class length, overdue, reminder…" />
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Settings available" value={data.defs.length} /><Stat label="Customised" value={custom} tone="orange" sub="Others use the default" />
            <Stat label="Changes recorded" value={data.changes.length} tone="blue" /><Stat label="Integrations" value="0 active" tone="gray" sub="Runo and WhatsApp not enabled" />
          </div>

          {groups.map(([grp, defs]) => (
            <section key={grp} aria-labelledby={`g-${grp}`}>
              <h2 id={`g-${grp}`} className="font-extrabold text-lg mb-3">{grp}</h2>
              <div className="space-y-3">
                {defs.map((d) => {
                  const cur = current(d); const draft = d.key in drafts ? drafts[d.key] : cur
                  const dirty = JSON.stringify(draft) !== JSON.stringify(cur); const err = dirty ? validate(d, draft) : null
                  const can1 = editable(d); const row = data.vals.get(d.key)
                  const myHist = data.changes.filter((c) => c.key === d.key)
                  return (
                    <Card key={d.key} className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 basis-72">
                          <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{d.label}</h3>{row ? <Badge tone="orange">Customised</Badge> : <Badge>Default</Badge>}{!can1 && <Badge tone="gray"><Lock size={10} className="mr-1" />{d.edit_permission === 'super_admin' ? 'Super Admin only' : 'Finance'}</Badge>}</div>
                          <p className="text-sm text-ink-soft mt-1">{d.help}</p>
                          <p className="text-meta text-ink-soft mt-2">Default: <b>{show(d.default_value)}{d.unit && typeof d.default_value !== 'boolean' ? ` ${d.unit}` : ''}</b>{row && <> · Changed by {who(row.updated_by)} on {fmtDateTime(row.updated_at)} · v{row.version}</>}</p>
                        </div>
                        <div className="flex flex-col items-start sm:items-end gap-2">
                          <Control def={d} value={draft} disabled={!can1} onChange={(v) => setDrafts({ ...drafts, [d.key]: v })} />
                          {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
                          {can1 && (
                            <div className="flex flex-wrap gap-1.5">
                              {dirty && <><Button size="sm" variant="primary" disabled={!!err} onClick={() => { setReason(''); setConfirming({ def: d, next: draft, kind: 'change' }) }}>Review & save</Button><Button size="sm" onClick={() => setDrafts((x) => { const n = { ...x }; delete n[d.key]; return n })}>Discard</Button></>}
                              {!dirty && row && JSON.stringify(cur) !== JSON.stringify(d.default_value) && <Button size="sm" onClick={() => { setReason(''); setConfirming({ def: d, next: d.default_value, kind: 'default' }) }}><RotateCcw size={13} /> Restore default</Button>}
                              {!!myHist.length && <Button size="sm" variant="ghost" onClick={() => setHist(hist === d.key ? null : d.key)}><History size={13} /> History ({myHist.length})</Button>}
                            </div>
                          )}
                        </div>
                      </div>
                      {hist === d.key && (
                        <ul className="mt-4 border-t border-line pt-3 space-y-2 text-sm">
                          {myHist.slice(0, 10).map((c, i) => (
                            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span>{show(c.old_value)} → <b>{show(c.new_value)}</b> <span className="text-ink-soft text-xs">· {who(c.actor_id)} · {fmtDateTime(c.created_at)}{c.reason ? ` · “${c.reason}”` : ''}</span></span>
                              {i === 0 && can1 && JSON.stringify(c.new_value) === JSON.stringify(cur) && <Button size="sm" onClick={() => { setReason(''); setConfirming({ def: d, next: c.old_value, kind: 'rollback' }) }}><RotateCcw size={13} /> Roll back this change</Button>}</li>))}
                        </ul>
                      )}
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
          {!groups.length && <Empty title="No setting matches your search" />}

          <Languages canEdit={can('coordinator')} />

          <Section title="Rules that cannot be changed here">
            <ul className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">{PROTECTED.map((p) => <li key={p} className="flex gap-2"><Lock size={14} className="mt-1 shrink-0 text-ink-soft" />{p}</li>)}</ul>
            <p className="text-xs text-ink-soft mt-3">Changing one of these is a product change with its own database migration, not a setting.</p>
          </Section>

          <Section title="Roles & permissions">
            <div className="overflow-x-auto scroll-thin"><table className="w-full text-sm min-w-[560px]"><thead><tr className="text-left text-meta uppercase text-ink-soft"><th className="py-2">Capability</th><th>Super Admin</th><th>Coordinator</th><th>Finance</th><th>Tutor</th></tr></thead>
              <tbody className="divide-y divide-line">{[['Enquiries, demos, enrollments, credits', 'Full', 'Full', 'Read', 'Assigned / own'], ['Tutor approval & assignment', 'Full', 'Full', 'Read', 'Accept / decline'], ['Fees, payments, holds, refunds', 'Full', 'Status only', 'Full', 'Hold status only'], ['Tutor rates & payouts', 'Full', '—', 'Full', 'Own earnings'], ['Own schedule & attendance', 'Override', 'Monitor', 'Read for payout', 'Manage own'], ['Staff, settings, imports, audit', 'Full', '—', 'Delegated finance settings', '—']].map((r) => <tr key={r[0]}><td className="py-2 font-medium">{r[0]}</td>{r.slice(1).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody></table></div>
            <p className="text-xs text-ink-soft mt-3">These boundaries are enforced by the database for every request, not just hidden in the screens. Assign roles under <Link className="underline font-semibold" to="/admin/team">Team accounts</Link>.</p>
          </Section>

          <Section title="Connections & features">
            <div className="grid md:grid-cols-2 gap-3">
              {[
                ['Runo CRM sync', 'Not enabled', 'Needs Runo API credentials, confirmed endpoints, field mapping and a test environment. Enquiries are entered manually and work fully without it.'],
                ['WhatsApp reminders & confirmations', 'Phase 2 · not enabled', 'Needs a verified provider, approved message templates and consent rules. Nothing is sent today.'],
                ['Zoom / Google Meet', 'Links only', 'Tutors store their own meeting links. Meetings are not created or checked automatically.'],
                ['Payments', 'Manual', 'UPI, bank transfer and cash are recorded by Finance. There is no payment gateway.'],
              ].map(([t, s, h]) => <div key={t} className="rounded-xl border border-line bg-white p-4"><div className="flex items-center justify-between gap-2"><b>{t}</b><Badge tone={s === 'Links only' || s === 'Manual' ? 'blue' : 'gray'}>{s}</Badge></div><p className="text-sm text-ink-soft mt-1.5">{h}</p><label className="mt-3 inline-flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" disabled className="h-4 w-4" /> Enable (unavailable)</label></div>)}
            </div>
          </Section>

          <Section title="System health & diagnostics" action={<Button size="sm" onClick={() => void ping()}><Activity size={14} /> Check connection</Button>}>
            <dl className="grid sm:grid-cols-3 gap-4 text-sm">
              <div><dt className="text-meta uppercase font-bold text-ink-soft">Database</dt><dd>{latency === null ? 'Not checked' : typeof latency === 'number' ? `Connected · ${latency} ms` : latency}</dd></div>
              <div><dt className="text-meta uppercase font-bold text-ink-soft">Signed in as</dt><dd>{profile?.email}</dd></div>
              <div><dt className="text-meta uppercase font-bold text-ink-soft">Backups</dt><dd>Managed by Supabase. Restore drills are an operations task.</dd></div>
            </dl>
            <div className="mt-4 rounded-xl bg-sand p-3 text-sm"><b>Time-zone check (DST):</b><ul className="mt-1 text-ink-soft"><li>{sample('2026-03-07')}</li><li>{sample('2026-03-09')}</li></ul><p className="text-xs text-ink-soft mt-1">The same 9 AM wall-clock time maps to a different Indian time after US clocks change. Classes are stored as exact instants, so the shift is handled.</p></div>
          </Section>

          {can('super_admin') && (
            <Section title="Configuration export & import">
              <p className="text-sm text-ink-soft mb-3">Copy business settings to another deployment. Exports contain setting values only: no secrets, learner data or financial records. Imports show a preview first.</p>
              <div className="flex flex-wrap gap-2"><Button onClick={exportCfg}><Download size={15} /> Export settings</Button><Button onClick={() => fileRef.current?.click()}><Upload size={15} /> Import settings…</Button><input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = '' }} /></div>
            </Section>
          )}

          <Section title="Recent changes">
            {!recent.length ? <p className="text-sm text-ink-soft">No setting has been changed yet.</p> : <ul className="divide-y divide-line text-sm">{recent.map((c) => <li key={c.id} className="py-2 flex flex-wrap justify-between gap-2"><span><b>{data.defs.find((d) => d.key === c.key)?.label ?? c.key}</b>: {show(c.old_value)} → {show(c.new_value)}{c.reason && <span className="text-ink-soft"> · “{c.reason}”</span>}</span><span className="text-xs text-ink-soft">{who(c.actor_id)} · {fmtDateTime(c.created_at)}</span></li>)}</ul>}
            <p className="text-xs text-ink-soft mt-3">Super Admins can see the full record under <Link to="/admin/audit" className="underline">Audit history</Link>.</p>
          </Section>
        </div>
      )}

      <Modal open={!!confirming} onClose={() => setConfirming(null)} title={confirming?.kind === 'rollback' ? 'Roll back this change?' : confirming?.kind === 'default' ? 'Restore default?' : 'Review change'}
        footer={<><Button onClick={() => setConfirming(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!confirming?.def.requires_reason && !reason.trim()} onClick={() => void apply()}>Confirm & save</Button></>}>
        {confirming && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line p-3 text-sm"><p className="font-bold">{confirming.def.label}</p><p className="mt-1"><span className="text-red-700 line-through">{show(current(confirming.def))}</span> → <b className="text-emerald-800">{show(confirming.next)}</b>{confirming.def.unit && typeof confirming.next !== 'boolean' ? ` ${confirming.def.unit}` : ''}</p></div>
            <Notice tone="gray"><b>When it applies:</b> immediately, to new bookings and records. Existing classes, issued credits, recorded payments and finalized payouts are not recalculated. The number of affected future records is not computed for this setting.</Notice>
            <Field label="Reason for the change" required={!!confirming.def.requires_reason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" autoFocus /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!imp} wide onClose={() => setImp(null)} title="Import preview" footer={<><Button onClick={() => setImp(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!imp?.rows.some((r) => r.ok) || !reason.trim()} onClick={() => void applyImport()}>Apply {imp?.rows.filter((r) => r.ok).length ?? 0} changes</Button></>}>
        {imp && (!imp.rows.length ? <p className="text-sm">Nothing to change. This file matches the current settings.</p> : (
          <div className="space-y-4">
            <ul className="divide-y divide-line text-sm border border-line rounded-xl">{imp.rows.map((r) => <li key={r.key} className="p-2.5 flex flex-wrap justify-between gap-2"><span><b>{r.label}</b>: {show(r.cur)} → {show(r.value)}</span>{r.ok ? <Badge tone="green">Will change</Badge> : <Badge tone="red">{r.why}</Badge>}</li>)}</ul>
            <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Provision new deployment from reviewed export" /></Field>
          </div>
        ))}
      </Modal>
    </>
  )
}
