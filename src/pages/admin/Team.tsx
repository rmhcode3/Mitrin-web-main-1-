import { useState } from 'react'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { select, unwrap, type Row } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth, type Perm } from '../../lib/auth'
import { useAction, useAsync } from '../../lib/hooks'
import { fmtDate } from '../../lib/format'
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Spinner, StatusBadge, useConfirm } from '../../components/ui'

const PERM_INFO: { id: Perm; label: string; help: string }[] = [
  { id: 'super_admin', label: 'Super Admin', help: 'Everything, including staff, settings, imports and audit history.' },
  { id: 'coordinator', label: 'Coordinator', help: 'Enquiries, demos, enrollments, tutors, scheduling and class credits. No fees or payout rates.' },
  { id: 'finance', label: 'Finance', help: 'Fees, payments, holds, tutor rates and payouts. No teaching schedules.' },
]

function PermPicker({ value, onChange }: { value: Perm[]; onChange: (v: Perm[]) => void }) {
  return (
    <div className="space-y-2">
      {PERM_INFO.map((p) => (
        <label key={p.id} className="flex gap-3 rounded-xl border border-line p-3 cursor-pointer min-h-12 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
          <input type="checkbox" className="accent-brand-500 h-4 w-4 mt-1" checked={value.includes(p.id)} onChange={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])} />
          <span><b className="block">{p.label}</b><span className="text-xs text-ink-soft">{p.help}</span></span>
        </label>
      ))}
    </div>
  )
}

export default function Team() {
  const { profile } = useAuth()
  const confirm = useConfirm()
  const [edit, setEdit] = useState<Row | null>(null)
  const [perms, setPerms] = useState<Perm[]>([])
  const [invite, setInvite] = useState(false)
  const [f, setF] = useState({ email: '', full_name: '' })
  const [ip, setIp] = useState<Perm[]>(['coordinator'])
  const { busy, run } = useAction()

  const { data, loading, error, reload } = useAsync(() => select('profiles', '*', (q) => q.eq('role', 'admin').order('created_at')))

  const setStatus = async (p: Row, status: 'active' | 'suspended') => {
    if (status === 'suspended') { const c = await confirm({ title: `Suspend ${p.full_name}?`, body: <p>They lose access immediately. Their history and audit trail remain.</p>, danger: true, confirmText: 'Suspend' }); if (!c.ok) return }
    await run(async () => { await unwrap(supabase.from('profiles').update({ status }).eq('id', p.id)); await reload() }, status === 'active' ? 'Account reactivated' : 'Account suspended')
  }
  const save = () => run(async () => {
    const c = await confirm({ title: 'Change permissions?', body: <p>{edit!.full_name} will {perms.length ? `have: ${perms.map((x) => PERM_INFO.find((i) => i.id === x)!.label).join(' + ')}` : 'have no permissions'}. This takes effect on their next action.</p>, confirmText: 'Change permissions' })
    if (!c.ok) return
    await unwrap(supabase.from('profiles').update({ admin_permissions: perms }).eq('id', edit!.id)); setEdit(null); await reload()
  }, 'Permissions updated')
  const send = () => run(async () => {
    const { data: r, error: e } = await supabase.functions.invoke('invite-staff', { body: { ...f, permissions: ip } })
    if (e) {
      let msg = e.message
      try { const b = await (e as unknown as { context: Response }).context.json(); if (b?.error) msg = b.error } catch { /* keep default */ }
      throw new Error(/not found|Failed to send|404/i.test(msg) ? 'The invite function is not deployed yet (see CHANGES.md, marked DEPLOY).' : msg)
    }
    setInvite(false); setF({ email: '', full_name: '' }); await reload()
    return r
  }, 'Staff account created. A password email was sent.')

  return (
    <>
      <PageHeader title="Team accounts" subtitle="Staff are invited by a Super Admin. Tutors register themselves and are approved under Teacher roster."
        actions={<Button variant="dark" onClick={() => setInvite(true)}><UserPlus size={16} /> Invite staff</Button>} />
      <div className="mb-5"><Notice tone="gray">At least one active Super Admin must always remain. The database refuses to remove or suspend the last one.</Notice></div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <DataTable rows={data ?? []} rowKey={(p) => p.id}
          columns={[
            { h: 'Name', primary: true, cell: (p) => <div><b>{p.full_name}</b>{p.id === profile?.id && <Badge className="ml-2" tone="orange">You</Badge>}<div className="text-xs text-ink-soft">{p.email}</div></div> },
            { h: 'Roles', cell: (p) => <div className="flex flex-wrap gap-1">{(p.admin_permissions as Perm[]).map((x) => <Badge key={x} tone={x === 'super_admin' ? 'purple' : 'blue'}>{PERM_INFO.find((i) => i.id === x)?.label}</Badge>)}{!(p.admin_permissions as Perm[]).length && <Badge>None</Badge>}</div> },
            { h: 'Status', cell: (p) => <StatusBadge status={p.status} text={p.status === 'active' ? 'Active' : 'Suspended'} /> },
            { h: 'Since', cell: (p) => fmtDate(p.created_at) },
            { h: '', cell: (p) => (
              <div className="flex gap-1.5 justify-end"><Button size="sm" onClick={() => { setEdit(p); setPerms(p.admin_permissions) }}><ShieldCheck size={13} /> Roles</Button>
                {p.id !== profile?.id && (p.status === 'active' ? <Button size="sm" onClick={() => void setStatus(p, 'suspended')}>Suspend</Button> : <Button size="sm" onClick={() => void setStatus(p, 'active')}>Reactivate</Button>)}</div>) },
          ]} />
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Roles · ${edit?.full_name ?? ''}`} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save roles</Button></>}>
        <PermPicker value={perms} onChange={setPerms} />
        {edit?.id === profile?.id && !perms.includes('super_admin') && <div className="mt-3"><Notice>You are removing your own Super Admin access. You will lose this page immediately.</Notice></div>}
      </Modal>
      <Modal open={invite} onClose={() => setInvite(false)} title="Invite staff member" footer={<><Button onClick={() => setInvite(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(f.email) || f.full_name.trim().length < 2 || !ip.length} onClick={() => void send()}>Create account</Button></>}>
        <div className="space-y-4">
          <Field label="Full name" required><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Email" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div><p className="text-[13px] font-semibold mb-1.5">Role</p><PermPicker value={ip} onChange={setIp} /></div>
          <Card className="p-3 text-xs text-ink-soft">The account is created securely on the server. The person receives an email to choose their own password.</Card>
        </div>
      </Modal>
    </>
  )
}
