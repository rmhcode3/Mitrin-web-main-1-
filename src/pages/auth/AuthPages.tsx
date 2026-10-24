import { useEffect, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ArrowRight, Clock, Eye, EyeOff, Lock, Mail, MailCheck, XCircle } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { isConfigured, supabase } from '../../lib/supabase'
import { select } from '../../lib/api'
import { TIMEZONES, browserTz, digits } from '../../lib/format'
import { Button, Card, Field, Input, Notice, Select, Textarea, cx } from '../../components/ui'

export function homePath(p: { role: string } | null) {
  return !p ? '/login' : p.role === 'teacher' ? '/tutor' : '/admin'
}

// warm gold-brown top-left, navy through the middle, charcoal bottom-right
const BRAND_GRADIENT = { background: 'radial-gradient(ellipse 70% 55% at 0% 0%, #4d4331 0%, rgba(77,67,49,0) 100%), radial-gradient(ellipse 75% 60% at 100% 100%, #3b3b40 0%, rgba(59,59,64,0) 100%), #0a2351' }

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-full lg:grid lg:grid-cols-2 bg-paper">
      <aside className="hidden lg:flex flex-col justify-between sticky top-0 h-screen px-12 py-10 text-white" style={BRAND_GRADIENT}>
        <div />
        <div className="text-center">
          <div className="inline-flex items-center justify-center gap-4">
            <img src="/assets/mitrin-mark.png" alt="MITRIN logo" className="h-24 w-auto shrink-0" />
            <div className="text-left leading-none">
              <p className="font-extrabold tracking-wide text-5xl">MITRIN</p>
              <p className="mt-2 text-sm font-medium uppercase tracking-[0.1em] text-[#cfe0ff]">The Language School</p>
            </div>
          </div>
          <div className="mx-auto mt-10 h-1 w-20 rounded-full bg-brand-500" />
          <p className="mt-10 mx-auto max-w-md text-3xl font-bold leading-snug">Inspiring fluency, <span className="text-brand-500">empowering educators.</span></p>
        </div>
        <p className="text-xs text-center text-white/50 border-t border-white/10 pt-4">© Mitrin Tutor OS • All rights reserved</p>
      </aside>
      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-6"><img src="/assets/mitrin-mark.png" alt="MITRIN logo" className="h-12 w-auto" /><p className="text-xl font-extrabold tracking-wide">MITRIN</p></div>
          <div className="rounded-3xl bg-white border border-line shadow-lg p-6 sm:p-8">
            <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
            <p className="text-ink-soft mt-1 mb-6">{subtitle}</p>
            {!isConfigured && <Notice tone="red">Supabase is not configured. Copy <b>.env.example</b> to <b>.env</b> and fill in your project URL and anon key.</Notice>}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function AuthInput({ label, icon: Icon, right, ...p }: { label: string; icon: typeof Mail; right?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5"><label htmlFor={id} className="text-sm font-semibold">{label}</label><span className="text-xs text-ink-soft">Required</span></div>
      <div className="relative">
        <Icon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none" />
        <input id={id} {...p} className="w-full h-12 rounded-xl border border-line bg-sand/60 pl-11 pr-11 text-[15px] hover:border-brand-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
        {right}
      </div>
    </div>
  )
}

export function Login() {
  const { signIn, profile, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [show, setShow] = useState(false)
  const [sent, setSent] = useState(false)
  if (!loading && profile) return <Navigate to={homePath(profile)} replace />
  const sendReset = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    setSent(true) // same message whether or not the address has an account
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget as HTMLFormElement)
    const em = String(form.get('email') ?? email).trim(), pass = String(form.get('password') ?? pw)
    if (!em.includes('@')) return setErr('Sign in with your email address (for example name@domain.com), not a phone number.')
    if (!pass) return setErr('Enter your password.')
    setErr(''); setBusy(true)
    try { await signIn(em, pass); nav('/', { replace: true }) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <AuthFrame title={forgot ? 'Reset your password' : 'Welcome back'} subtitle={forgot ? 'We will email you a link to choose a new password.' : 'Sign in to continue to your workspace.'}>
      {forgot ? (
        <form onSubmit={sendReset} className="space-y-4" noValidate>
          <Field label="Email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          {sent && <Notice tone="green">If that address has an account, a reset link is on its way.</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email)}>Send reset link</Button>
          <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => { setForgot(false); setSent(false) }}>Back to sign in</button>
        </form>
      ) : (<>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AuthInput label="Email" icon={Mail} name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <AuthInput label="Password" icon={Lock} name="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required
          right={<button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-lg text-ink-soft hover:text-ink">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>} />
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <div className="text-right"><button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setForgot(true)}>Forgot password?</button></div>
        <Button type="submit" variant="primary" className="w-full !min-h-12 text-[15px] rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 shadow-md" loading={busy}>Sign in <ArrowRight size={17} /></Button>
      </form>
      <div className="mt-6 pt-5 border-t border-line"><Link to="/register" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">New tutor? Apply to teach with Mitrin <ArrowRight size={14} /></Link></div>
      </>)}
    </AuthFrame>
  )
}

export function ResetPassword() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a.length < 8) return setErr('Use at least 8 characters.')
    if (a !== b) return setErr('The two passwords do not match.')
    setErr('')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: a })
    setBusy(false)
    if (error) return setErr(error.message)
    nav('/', { replace: true })
  }
  return (
    <AuthFrame title="Choose a new password" subtitle="Use at least 8 characters.">
      {!loading && !session ? <Notice tone="red">This reset link has expired or was already used. <Link className="underline font-semibold" to="/login">Request a new one</Link>.</Notice> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" required><Input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label="Repeat new password" required><Input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Save password</Button>
        </form>
      )}
    </AuthFrame>
  )
}

const regSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().refine((v) => /^[0-9]{7,15}$/.test(digits(v)), 'Enter 7–15 digits'),
  password: z.string().min(8, 'Use at least 8 characters'),
  languages: z.array(z.string()).min(1, 'Choose at least one language'),
  experience_years: z.coerce.number().min(0).max(60),
  qualifications: z.string().trim().min(2, 'Tell us about your qualifications').max(1000),
})

export function Register() {
  const { profile, loading } = useAuth()
  const [langs, setLangs] = useState<string[]>([])
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', experience_years: '', qualifications: '', tz: browserTz() })
  const [chosen, setChosen] = useState<string[]>([])
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | 'confirm' | 'pending'>(null)
  const [serverErr, setServerErr] = useState('')

  useEffect(() => { select<{ name: string }>('languages', 'name', (q) => q.eq('active', true).order('name')).then((r) => setLangs(r.map((x) => x.name)), () => {}) }, [])
  if (!loading && profile) return <Navigate to={homePath(profile)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setServerErr('')
    const parsed = regSchema.safeParse({ ...f, languages: chosen })
    if (!parsed.success) {
      const m: Record<string, string> = {}
      for (const i of parsed.error.issues) m[String(i.path[0])] = i.message
      setErrs(m); return
    }
    setErrs({}); setBusy(true)
    const v = parsed.data
    const { data, error } = await supabase.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { role: 'teacher', full_name: v.full_name, phone: digits(v.phone), languages: v.languages, experience_years: v.experience_years, qualifications: v.qualifications } },
    })
    setBusy(false)
    if (error) { setServerErr(error.message); return }
    if (data.session) {
      // keep the chosen timezone on the new profile (tutors may update their own row)
      await supabase.from('teacher_profiles').update({ timezone: f.tz }).eq('user_id', data.user!.id)
      setDone('pending')
    } else setDone('confirm')
  }

  if (done) {
    return (
      <AuthFrame title={done === 'confirm' ? 'Check your email' : 'Application received'} subtitle="Thank you for applying to teach with Mitrin.">
        <Card className="p-5 flex gap-3">
          {done === 'confirm' ? <MailCheck className="text-brand-600 shrink-0" /> : <Clock className="text-brand-600 shrink-0" />}
          <p className="text-sm">{done === 'confirm' ? 'We sent a confirmation link to your email. Confirm it, then sign in.' : 'Your profile is pending approval. You can sign in at any time to check its status.'} Teaching records stay hidden until a coordinator approves you.</p>
        </Card>
        <Link to="/login" className="inline-block mt-5 font-semibold text-brand-700 underline">Go to sign in</Link>
      </AuthFrame>
    )
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <AuthFrame title="Apply to teach" subtitle="Tell us about yourself. A coordinator will review your application.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" required error={errs.full_name}><Input value={f.full_name} onChange={set('full_name')} autoComplete="name" /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Email" required error={errs.email}><Input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
          <Field label="WhatsApp / phone" required error={errs.phone}><Input inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="9198765xxxxx" /></Field>
        </div>
        <Field label="Password" required error={errs.password} hint="At least 8 characters."><Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <div>
          <p className="text-[13px] font-semibold mb-1.5">Languages you teach <span className="text-red-600">*</span></p>
          <div className="flex flex-wrap gap-2">
            {langs.map((l) => (
              <button key={l} type="button" aria-pressed={chosen.includes(l)} onClick={() => setChosen(chosen.includes(l) ? chosen.filter((x) => x !== l) : [...chosen, l])}
                className={cx('min-h-10 rounded-full border px-4 text-sm font-semibold', chosen.includes(l) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-line')}>{l}</button>
            ))}
            {!langs.length && <p className="text-sm text-ink-soft">Languages could not be loaded.</p>}
          </div>
          {errs.languages && <p role="alert" className="text-xs text-red-600 mt-1">{errs.languages}</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Years of teaching experience" required error={errs.experience_years}><Input inputMode="decimal" value={f.experience_years} onChange={set('experience_years')} placeholder="e.g. 3" /></Field>
          <Field label="Your time zone"><Select value={f.tz} onChange={set('tz')}>{[...new Set([f.tz, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        </div>
        <Field label="Qualifications" required error={errs.qualifications}><Textarea value={f.qualifications} onChange={set('qualifications')} placeholder="Degrees, certificates, teaching background" /></Field>
        <p className="text-meta text-ink-soft">You will set your weekly teaching hours once you are approved.</p>
        {serverErr && <p role="alert" className="text-sm text-red-600">{serverErr}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Submit application</Button>
      </form>
      <p className="text-sm text-ink-soft mt-6">Already approved? <Link to="/login" className="font-semibold text-brand-700 underline">Sign in</Link></p>
    </AuthFrame>
  )
}

/** Shown to tutors whose application has not been approved (or who are suspended). */
export function TutorGate() {
  const { tp, profile, signOut, refresh } = useAuth()
  const st = profile?.status === 'suspended' ? 'suspended' : (tp?.approval_status as string | undefined) ?? 'pending_review'
  const text = {
    pending_review: ['Your application is being reviewed', 'A coordinator will approve your profile soon. Teaching records unlock as soon as you are approved.', Clock],
    rejected: ['Your application was not approved', 'Please contact Mitrin if you believe this is a mistake.', XCircle],
    suspended: ['Your account is suspended', 'Please contact Mitrin to restore access.', XCircle],
  }[st] as [string, string, typeof Clock]
  const Icon = text[2]
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="max-w-md w-full p-8 text-center">
        <Icon className="mx-auto text-brand-600" size={40} />
        <h1 className="text-2xl font-extrabold mt-4">{text[0]}</h1>
        <p className="text-ink-soft mt-2">{text[1]}</p>
        <div className="mt-6 flex gap-2 justify-center">
          <Button onClick={() => void refresh()}>Check again</Button>
          <Button onClick={() => void signOut()}>Log out</Button>
        </div>
      </Card>
    </div>
  )
}
