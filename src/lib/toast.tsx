import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

type T = { id: number; kind: 'ok' | 'err'; text: string }
const Ctx = createContext<{ ok: (t: string) => void; err: (t: string) => void }>({ ok: () => {}, err: () => {} })
let n = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<T[]>([])
  const push = useCallback((kind: T['kind'], text: string) => {
    const id = ++n
    set((s) => [...s, { id, kind, text }])
    setTimeout(() => set((s) => s.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500)
  }, [])
  return (
    <Ctx.Provider value={{ ok: (t) => push('ok', t), err: (t) => push('err', t) }}>
      {children}
      <div className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto z-[100] flex flex-col gap-2 md:w-96 pointer-events-none" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto anim-pop flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg bg-white ${t.kind === 'ok' ? 'border-emerald-200' : 'border-red-200'}`}>
            {t.kind === 'ok' ? <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} /> : <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={18} />}
            <p className="text-sm flex-1">{t.text}</p>
            <button aria-label="Dismiss" onClick={() => set((s) => s.filter((x) => x.id !== t.id))}><X size={16} className="text-ink-soft" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)
