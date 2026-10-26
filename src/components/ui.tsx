import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AlertTriangle, Download, Loader2, Search, X, Inbox } from 'lucide-react'
import { downloadCsv, downloadXlsx, type Col } from '../lib/export'
import { useToast } from '../lib/toast'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

/* ---------- buttons & inputs ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'; size?: 'sm' | 'md'; loading?: boolean }
export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
    dark: 'bg-navy text-white hover:bg-navy-700',
    secondary: 'bg-white text-ink border border-line hover:bg-sand',
    ghost: 'text-ink-soft hover:bg-sand',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant]
  return (
    <button
      type="button"
      {...p}
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap', size === 'md' ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-[13px]', v, className)}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

const field = 'min-h-11 rounded-xl border border-line bg-white px-3 text-[15px] placeholder:text-ink-soft/60 hover:border-brand-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-sand disabled:text-ink-soft'
// full width unless the caller sets its own width
const fw = (c?: string) => (c && /(^|s)w-/.test(c) ? '' : 'w-full')
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, fw(p.className), p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, fw(p.className), 'pr-8', p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, fw(p.className), 'py-2 min-h-24', p.className)} />

export function Field({ label, hint, error, required, children, className }: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink mb-1.5">
        {label}{required && <span className="text-red-600"> *</span>}
      </label>
      <FieldChild id={id}>{children}</FieldChild>
      {hint && !error && <p className="text-meta text-ink-soft mt-1">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
// Give the single child control the label's id.
function FieldChild({ id, children }: { id: string; children: ReactNode }) {
  const only = Children.toArray(children)
  if (only.length === 1 && isValidElement(only[0])) return cloneElement(only[0] as React.ReactElement<{ id?: string }>, { id })
  return <>{children}</>
}

/* ---------- display ---------- */
const tones = {
  gray: 'bg-sand text-ink-soft border-line', orange: 'bg-brand-50 text-brand-700 border-brand-200', green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200', blue: 'bg-sky-50 text-sky-700 border-sky-200', purple: 'bg-violet-50 text-violet-700 border-violet-200', yellow: 'bg-amber-50 text-amber-800 border-amber-200', teal: 'bg-teal-50 text-teal-700 border-teal-200',
}
export type Tone = keyof typeof tones
export const Badge = ({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-meta font-bold uppercase tracking-wide whitespace-nowrap', tones[tone], className)}>{children}</span>
)

const statusTone: Record<string, Tone> = {
  active: 'green', accepted: 'green', approved: 'green', completed: 'green', present: 'green', cleared: 'green', paid: 'green', confirmed: 'green', converted: 'green',
  awaiting_tutor: 'yellow', pending_review: 'yellow', pending: 'yellow', due: 'blue', tentative: 'yellow', pending_completion: 'yellow', unmarked: 'gray', draft: 'gray', scheduled: 'blue', contacted: 'yellow', new: 'blue', demo_scheduled: 'purple', demo_accepted: 'teal', demo_done: 'orange',
  on_hold: 'red', declined: 'red', rejected: 'red', suspended: 'red', cancelled: 'red', absent: 'red', overdue: 'red', tutor_no_show: 'red', student_no_show: 'red', withdrawn: 'gray', lost: 'gray', occupied: 'red', on_leave: 'red', unavailable: 'red', rescheduled: 'orange', finalized: 'blue', no_plan: 'gray', outside_hours: 'gray',
}
export const toneClass = (status: string) => tones[statusTone[status] ?? 'gray']
export const StatusBadge =({ status, text }: { status: string; text?: string }) => <Badge tone={statusTone[status] ?? 'gray'}>{text ?? status.replace(/_/g, ' ')}</Badge>

export const Card = ({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) => (
  <div onClick={onClick} className={cx('rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(60,40,10,.04)]', onClick && 'cursor-pointer hover:border-brand-200 hover:shadow-md transition', className)}>{children}</div>
)

export function Stat({ label, value, sub, tone = 'gray', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  const bg = { gray: 'bg-white', orange: 'bg-brand-50', green: 'bg-emerald-50', red: 'bg-red-50', blue: 'bg-sky-50', purple: 'bg-violet-50', yellow: 'bg-amber-50', teal: 'bg-teal-50' }[tone]
  return (
    <div className={cx('rounded-2xl border border-line p-4 flex items-start gap-3', bg)}>
      {icon && <div className="rounded-xl bg-white/80 border border-line p-2 text-ink-soft">{icon}</div>}
      <div className="min-w-0">
        <p className="text-meta font-bold uppercase tracking-wider text-ink-soft">{label}</p>
        <p className="text-2xl font-extrabold leading-tight">{value}</p>
        {sub && <p className="text-xs text-ink-soft mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export const Spinner = ({ text = 'Loading…' }: { text?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-ink-soft" role="status"><Loader2 className="animate-spin" size={18} /> {text}</div>
)
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center text-center py-14 px-4 text-ink-soft">
    <Inbox size={34} className="mb-3 text-line" />
    <p className="font-semibold text-ink">{title}</p>
    {hint && <p className="text-sm mt-1 max-w-sm">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)
export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
    <div className="flex-1">{message}</div>
    {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
  </div>
)
export const Notice = ({ tone = 'yellow', children }: { tone?: Tone; children: ReactNode }) => (
  <div className={cx('rounded-xl border px-4 py-3 text-sm', tones[tone])}>{children}</div>
)

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-[28px] font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-soft mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(field, 'w-full pl-9')} />
    </div>
  )
}

/* ---------- overlays ---------- */
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [open, onClose])
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-[2px] p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cx('anim-pop bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh]', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-line">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-2 hover:bg-sand min-h-11 min-w-11 flex items-center justify-center"><X size={20} /></button>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto scroll-thin flex-1">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 border-t border-line flex flex-wrap justify-end gap-2 bg-paper rounded-b-3xl">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, subtitle, badge, children, width = 'md:max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode; width?: string }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/45 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" className={cx('anim-slide bg-white w-full h-full flex flex-col shadow-2xl', width)}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-7 pt-5 pb-4 border-b border-line">
          <div className="min-w-0">
            {badge && <div className="mb-1.5">{badge}</div>}
            <h2 className="text-2xl font-extrabold leading-tight break-words">{title}</h2>
            {subtitle && <p className="text-sm text-ink-soft mt-0.5">{subtitle}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-2 hover:bg-sand min-h-11 min-w-11 flex items-center justify-center shrink-0"><X size={22} /></button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-5 sm:px-7 py-5 space-y-5">{children}</div>
      </aside>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto scroll-thin border-b border-line -mx-1 px-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('px-3 sm:px-4 min-h-11 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition', value === t.id ? 'border-brand-500 text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-meta rounded-full bg-sand px-1.5 py-0.5">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------- confirm dialog (promise based) ---------- */
interface ConfirmOpts { title: string; body?: ReactNode; confirmText?: string; danger?: boolean; reason?: boolean | string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>>(async () => ({ ok: true, reason: '' }))
// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<{ o: ConfirmOpts; done: (r: { ok: boolean; reason: string }) => void } | null>(null)
  const [reason, setReason] = useState('')
  const confirm = useCallback((o: ConfirmOpts) => new Promise<{ ok: boolean; reason: string }>((res) => { setReason(''); setSt({ o, done: res }) }), [])
  const close = (ok: boolean) => { st?.done({ ok, reason: reason.trim() }); setSt(null) }
  const needReason = Boolean(st?.o.reason)
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!st} onClose={() => close(false)} title={st?.o.title ?? ''}
        footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={st?.o.danger ? 'danger' : 'primary'} disabled={needReason && !reason.trim()} onClick={() => close(true)}>{st?.o.confirmText ?? 'Confirm'}</Button></>}>
        <div className="space-y-4 text-sm">
          {st?.o.body}
          {needReason && <Field label={typeof st?.o.reason === 'string' ? st.o.reason : 'Reason'} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}

/* ---------- responsive table ---------- */
export interface Column<T> { h: string; cell: (r: T) => ReactNode; primary?: boolean; className?: string; hideOnCard?: boolean }
export function DataTable<T>({ rows, columns, rowKey, onRowClick, empty, grid }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T, i: number) => string; onRowClick?: (r: T) => void; empty?: ReactNode; grid?: boolean }) {
  if (!rows.length) return <>{empty ?? <Empty title="Nothing to show" />}</>
  const primary = columns.find((c) => c.primary) ?? columns[0]
  return (
    <>
      <div className={cx('hidden md:block overflow-x-auto scroll-thin border border-line bg-white', !grid && 'rounded-2xl')}>
        <table className={cx('w-full text-sm', grid && 'border-collapse')}>
          <thead>
            <tr className="text-left text-meta uppercase tracking-wider text-ink-soft bg-sand/60">
              {columns.map((c) => <th key={c.h} className={cx('px-4 py-3 font-bold', grid && 'border border-line whitespace-nowrap', c.className)}>{c.h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx(!grid && 'border-t border-line', onRowClick && 'cursor-pointer hover:bg-brand-50/50')}>
                {columns.map((c) => <td key={c.h} className={cx('px-4 py-3 align-middle', grid && 'border border-line', c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-3">
        {rows.map((r, i) => (
          <Card key={rowKey(r, i)} className="p-4" onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <div className="font-bold mb-2">{primary.cell(r)}</div>
            <dl className="space-y-1.5">
              {columns.filter((c) => c !== primary && !c.hideOnCard).map((c) => (
                <div key={c.h} className="flex justify-between gap-3 text-sm">
                  <dt className="text-ink-soft text-xs pt-0.5 shrink-0">{c.h}</dt>
                  <dd className="text-right min-w-0">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </>
  )
}

/* ---------- export ---------- */
export function ExportMenu<T>({ rows, cols, name, disabled }: { rows: T[]; cols: Col<T>[]; name: string; disabled?: boolean }) {
  const toast = useToast()
  const stamp = new Date().toISOString().slice(0, 10)
  const noRows = disabled || rows.length === 0
  return (
    <div className="inline-flex gap-1.5">
      <Button size="sm" disabled={noRows} onClick={() => { downloadCsv(`${name}-${stamp}`, rows, cols); toast.ok(`Exported ${rows.length} rows to CSV`) }}><Download size={14} /> CSV</Button>
      <Button size="sm" disabled={noRows} onClick={() => { downloadXlsx(`${name}-${stamp}`, rows, cols).then(() => toast.ok(`Exported ${rows.length} rows to Excel`), (e) => toast.err(String(e))) }}><Download size={14} /> Excel</Button>
    </div>
  )
}

export const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-meta uppercase tracking-wider font-bold text-ink-soft">{k}</dt>
    <dd className="text-[15px] font-medium break-words">{v || '—'}</dd>
  </div>
)

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="font-extrabold text-[15px]">{title}</h3>{action}
    </div>
    {children}
  </section>
)
