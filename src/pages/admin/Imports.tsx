import { useMemo, useState } from 'react'
import { Download, FileUp } from 'lucide-react'
import { select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAction } from '../../lib/hooks'
import { digits } from '../../lib/format'
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Tabs } from '../../components/ui'

type Kind = 'leads' | 'students'
const FIELDS: Record<Kind, { key: string; label: string; required?: boolean; hint?: string }[]> = {
  leads: [{ key: 'learner_name', label: 'Learner name', required: true }, { key: 'enquirer_name', label: 'Contact / parent name', required: true }, { key: 'phone', label: 'Phone', required: true }, { key: 'email', label: 'Email' }, { key: 'language', label: 'Language', required: true }, { key: 'level', label: 'Level' }, { key: 'source', label: 'Source' }, { key: 'notes', label: 'Notes' }],
  students: [{ key: 'full_name', label: 'Learner name', required: true }, { key: 'parent_name', label: 'Parent / contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'language', label: 'Language', required: true }, { key: 'level', label: 'Level' }, { key: 'opening_credits', label: 'Opening class credits', hint: 'Classes still owed at cut-over, including pending makeups' }, { key: 'agreed_classes', label: 'Agreed classes' }],
}

/** Small RFC-4180 style CSV reader (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = [] }
    else cur += c
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

interface Checked { n: number; data: Record<string, string>; errors: string[]; warnings: string[] }

export default function Imports() {
  const [kind, setKind] = useState<Kind>('leads')
  const [head, setHead] = useState<string[]>([])
  const [body, setBody] = useState<string[][]>([])
  const [map, setMap] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Checked[] | null>(null)
  const [expected, setExpected] = useState('')
  const [signed, setSigned] = useState(false)
  const [done, setDone] = useState<null | { ok: number; failed: string[] }>(null)
  const { busy, run } = useAction()

  const reset = () => { setHead([]); setBody([]); setMap({}); setChecked(null); setDone(null); setSigned(false) }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    reset()
    const rows = parseCsv(await f.text())
    if (rows.length < 2) return setChecked([])
    const h = rows[0].map((x) => x.trim())
    setHead(h); setBody(rows.slice(1))
    const auto: Record<string, string> = {}
    for (const fld of FIELDS[kind]) { const hit = h.find((x) => x.toLowerCase().replace(/[^a-z]/g, '') === fld.label.toLowerCase().replace(/[^a-z]/g, '') || x.toLowerCase() === fld.key); if (hit) auto[fld.key] = hit }
    setMap(auto)
  }

  const template = () => {
    const blob = new Blob([FIELDS[kind].map((f) => f.label).join(',') + '\r\n'], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mitrin-${kind}-template.csv`; a.click()
  }

  const dryRun = () => run(async () => {
    const [langs, leads, studs] = await Promise.all([select('languages'), select('leads', 'learner_name, phone'), select('students', 'full_name, student_contacts(phone)')])
    const lang = new Map(langs.map((l) => [l.name.toLowerCase(), l.id as string]))
    const seen = new Set<string>()
    const res: Checked[] = body.map((r, i) => {
      const data: Record<string, string> = {}
      for (const f of FIELDS[kind]) data[f.key] = map[f.key] ? (r[head.indexOf(map[f.key])] ?? '').trim() : ''
      const errors: string[] = [], warnings: string[] = []
      for (const f of FIELDS[kind]) if (f.required && !data[f.key]) errors.push(`${f.label} is missing`)
      if (data.phone && !/^[0-9]{7,15}$/.test(digits(data.phone))) errors.push('Phone must be 7–15 digits')
      if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) errors.push('Email is not valid')
      if (data.language && !lang.has(data.language.toLowerCase())) errors.push(`Language “${data.language}” is not in the catalog`)
      for (const k of ['opening_credits', 'agreed_classes']) if (data[k] && !(Number.isInteger(Number(data[k])) && Number(data[k]) >= 0)) errors.push(`${k.replace('_', ' ')} must be a whole number`)
      const name = (data.learner_name || data.full_name || '').toLowerCase(), ph = digits(data.phone)
      const key = `${name}|${ph}`
      if (ph && seen.has(key)) errors.push('Duplicate of an earlier row in this file'); seen.add(key)
      // names/phones alone never auto-merge: matches are only flagged for a human
      if (kind === 'leads' && leads.some((l) => l.learner_name.toLowerCase() === name && l.phone === ph)) warnings.push('Same learner and phone already exists as an enquiry')
      if (kind === 'students' && studs.some((s) => s.full_name.toLowerCase() === name && (Array.isArray(s.student_contacts) ? s.student_contacts[0] : s.student_contacts)?.phone === ph)) warnings.push('A student with this name and phone exists. A new record will be added; review first')
      return { n: i + 2, data, errors, warnings }
    })
    setChecked(res); setDone(null); setSigned(false)
  })

  const good = useMemo(() => checked?.filter((c) => !c.errors.length) ?? [], [checked])
  const bad = checked?.filter((c) => c.errors.length) ?? []
  const totalCredits = good.reduce((a, c) => a + Number(c.data.opening_credits || 0), 0)
  const reconciles = kind !== 'students' || expected === '' || Number(expected) === totalCredits

  const commit = () => run(async () => {
    const langs = await select('languages')
    const lang = new Map(langs.map((l) => [l.name.toLowerCase(), l.id as string]))
    const fails: string[] = []; let ok = 0
    if (kind === 'leads') {
      const rows = good.map((c) => ({ learner_name: c.data.learner_name, enquirer_name: c.data.enquirer_name, phone: digits(c.data.phone), email: c.data.email || null, language_id: lang.get(c.data.language.toLowerCase()), level: c.data.level || null, source: c.data.source || 'Other', notes: c.data.notes ? `Imported: ${c.data.notes}` : 'Imported' }))
      for (let i = 0; i < rows.length; i += 50) { const { error } = await supabase.from('leads').insert(rows.slice(i, i + 50)); if (error) fails.push(`Rows ${good[i].n}–${good[Math.min(i + 49, good.length - 1)].n}: ${error.message}`); else ok += Math.min(50, rows.length - i) }
    } else {
      for (const c of good) {
        try {
          const s = await unwrap(supabase.from('students').insert({ full_name: c.data.full_name, level: c.data.level || null }).select('id').single()) as Row
          await unwrap(supabase.from('student_contacts').insert({ student_id: s.id, parent_name: c.data.parent_name || null, phone: c.data.phone ? digits(c.data.phone) : null, email: c.data.email || null }))
          const e = await unwrap(supabase.from('enrollments').insert({ student_id: s.id, language_id: lang.get(c.data.language.toLowerCase()), agreed_classes: Number(c.data.agreed_classes) > 0 ? Number(c.data.agreed_classes) : null }).select('id').single()) as Row
          if (Number(c.data.opening_credits) > 0) await unwrap(supabase.from('credit_movements').insert({ enrollment_id: e.id, quantity: Number(c.data.opening_credits), reason: 'Migration', allocation_period: new Date().toISOString().slice(0, 8) + '01' }))
          ok++
        } catch (x) { fails.push(`Row ${c.n}: ${(x as Error).message}`) }
      }
    }
    setDone({ ok, failed: fails })
  })

  const missingRequired = FIELDS[kind].filter((f) => f.required && !map[f.key])
  return (
    <>
      <PageHeader title="Imports & opening balances" subtitle="Bring active records in from your spreadsheets. Every import is checked first (dry run) and nothing is saved until you confirm." />
      <Tabs<Kind> value={kind} onChange={(k) => { setKind(k); reset() }} tabs={[{ id: 'leads', label: 'Enquiries' }, { id: 'students', label: 'Students & opening classes' }]} />
      <div className="grid lg:grid-cols-[1fr_1fr] gap-5 mt-5">
        <Card className="p-5 space-y-4">
          <h2 className="font-extrabold">1. Choose a CSV file</h2>
          <div className="flex flex-wrap gap-2"><Button onClick={template}><Download size={15} /> Download template</Button>
            <label className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-brand-500 text-white font-semibold text-sm cursor-pointer hover:bg-brand-600"><FileUp size={16} /> Choose file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} /></label></div>
          {kind === 'students' && <Notice tone="gray">Opening credits are written as labelled “Migration” allocations. History is never invented: past attendance and payments are not created.</Notice>}
          {head.length > 0 && (
            <>
              <h2 className="font-extrabold pt-2">2. Match columns</h2>
              <div className="grid sm:grid-cols-2 gap-3">{FIELDS[kind].map((f) => (
                <Field key={f.key} label={f.label} required={f.required} hint={f.hint}><Select value={map[f.key] ?? ''} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value }); setChecked(null) }}><option value="">— not in file —</option>{head.map((h) => <option key={h}>{h}</option>)}</Select></Field>))}</div>
              <Button variant="primary" disabled={missingRequired.length > 0} loading={busy} onClick={() => void dryRun()}>3. Check file (dry run)</Button>
              {missingRequired.length > 0 && <p className="text-xs text-red-600">Match: {missingRequired.map((f) => f.label).join(', ')}</p>}
            </>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-extrabold">Result</h2>
          {!checked ? <p className="text-sm text-ink-soft">Nothing checked yet. Choose a file and run the dry run.</p> : (
            <>
              <div className="flex flex-wrap gap-2"><Badge tone="gray">{checked.length} rows</Badge><Badge tone="green">{good.length} ready</Badge>{bad.length > 0 && <Badge tone="red">{bad.length} with errors</Badge>}{checked.some((c) => c.warnings.length) && <Badge tone="yellow">{checked.filter((c) => c.warnings.length).length} to review</Badge>}</div>
              {kind === 'students' && (
                <Field label="Expected total opening classes (from your source sheet)" hint={`File total for ready rows: ${totalCredits}`} error={!reconciles ? `Does not reconcile: file has ${totalCredits}, source says ${expected}.` : null}><Input inputMode="numeric" value={expected} onChange={(e) => { setExpected(e.target.value); setSigned(false) }} /></Field>
              )}
              <ul className="max-h-72 overflow-y-auto scroll-thin divide-y divide-line text-sm border border-line rounded-xl">
                {checked.filter((c) => c.errors.length || c.warnings.length).slice(0, 80).map((c) => <li key={c.n} className="p-2.5"><b>Row {c.n}</b> <span className="text-ink-soft">{c.data.learner_name || c.data.full_name}</span>{c.errors.map((e) => <p key={e} className="text-red-700 text-xs">✕ {e}</p>)}{c.warnings.map((e) => <p key={e} className="text-amber-700 text-xs">! {e}</p>)}</li>)}
                {!checked.some((c) => c.errors.length || c.warnings.length) && <li className="p-3 text-emerald-700">Every row passed.</li>}
              </ul>
              {!done && good.length > 0 && (
                <>
                  <label className="flex gap-2 text-sm"><input type="checkbox" className="accent-brand-500 h-4 w-4 mt-0.5" checked={signed} disabled={!reconciles} onChange={(e) => setSigned(e.target.checked)} /> I have reviewed this check{bad.length > 0 ? `. The ${bad.length} rows with errors will be skipped` : ''} and approve importing {good.length} rows.</label>
                  <Button variant="primary" disabled={!signed || !reconciles} loading={busy} onClick={() => void commit()}>Import {good.length} rows</Button>
                </>
              )}
              {done && <Notice tone={done.failed.length ? 'yellow' : 'green'}><b>{done.ok} imported.</b>{done.failed.map((f) => <span key={f} className="block text-xs">{f}</span>)}</Notice>}
            </>
          )}
        </Card>
      </div>
    </>
  )
}
