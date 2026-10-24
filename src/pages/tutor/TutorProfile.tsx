import { useState } from 'react'
import { z } from 'zod'
import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAction } from '../../lib/hooks'
import { TIMEZONES, digits } from '../../lib/format'
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from '../../components/ui'

const schema = z.object({
  full_name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: z.string().refine((v) => v === '' || /^[0-9]{7,15}$/.test(digits(v)), 'Phone must be 7–15 digits'),
  experience_years: z.string().refine((v) => v === '' || (Number(v) >= 0 && Number(v) <= 60), 'Enter years between 0 and 60'),
  qualifications: z.string().max(1000),
})

export default function TutorProfile() {
  const { profile, tp, refresh } = useAuth()
  const [f, setF] = useState({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '', experience_years: tp?.experience_years == null ? '' : String(tp.experience_years), qualifications: tp?.qualifications ?? '', timezone: (tp?.timezone as string) ?? 'Asia/Kolkata' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [pw, setPw] = useState({ a: '', b: '' })
  const { busy, run } = useAction()
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = () => run(async () => {
    const p = schema.safeParse(f)
    if (!p.success) { const m: Record<string, string> = {}; for (const i of p.error.issues) m[String(i.path[0])] = i.message; setErrs(m); return }
    setErrs({})
    await unwrap(supabase.from('profiles').update({ full_name: f.full_name.trim(), phone: f.phone ? digits(f.phone) : null }).eq('id', profile!.id))
    await unwrap(supabase.from('teacher_profiles').update({ experience_years: f.experience_years === '' ? null : Number(f.experience_years), qualifications: f.qualifications.trim() || null, timezone: f.timezone }).eq('user_id', profile!.id))
    await refresh()
  }, 'Profile saved')

  const changePw = () => run(async () => {
    if (pw.a.length < 8) throw new Error('Use at least 8 characters.')
    if (pw.a !== pw.b) throw new Error('The two passwords do not match.')
    const { error } = await supabase.auth.updateUser({ password: pw.a })
    if (error) throw new Error(error.message)
    setPw({ a: '', b: '' })
  }, 'Password changed')

  return (
    <>
      <PageHeader title="My profile" subtitle="Your details are visible to Mitrin staff only." />
      <div className="grid lg:grid-cols-2 gap-5 max-w-5xl">
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">{(tp?.languages as string[] | undefined)?.map((l) => <Badge key={l} tone="orange">{l}</Badge>)}<Badge tone="green">Approved</Badge></div>
          <Field label="Full name" required error={errs.full_name}><Input value={f.full_name} onChange={s('full_name')} /></Field>
          <Field label="Email" hint="Contact Mitrin to change your sign-in email."><Input value={profile?.email ?? ''} disabled /></Field>
          <Field label="Phone / WhatsApp" error={errs.phone}><Input inputMode="tel" value={f.phone} onChange={s('phone')} /></Field>
          <div className="grid grid-cols-2 gap-4"><Field label="Years of experience" error={errs.experience_years}><Input inputMode="decimal" value={f.experience_years} onChange={s('experience_years')} /></Field><Field label="Time zone"><Select value={f.timezone} onChange={s('timezone')}>{[...new Set([f.timezone, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}</Select></Field></div>
          <Field label="Qualifications"><Textarea value={f.qualifications} onChange={s('qualifications')} /></Field>
          <Notice tone="gray">Languages you teach are managed by Mitrin. Ask a coordinator to add one.</Notice>
          <Button variant="primary" loading={busy} onClick={() => void save()}>Save profile</Button>
        </Card>
        <Card className="p-5 space-y-4 self-start">
          <h2 className="font-extrabold">Change password</h2>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
          <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
          <Button loading={busy} disabled={!pw.a} onClick={() => void changePw()}>Change password</Button>
        </Card>
      </div>
    </>
  )
}
