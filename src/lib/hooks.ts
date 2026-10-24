import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc } from './api'
import { useToast } from './toast'

/** Load async data with loading + error state and a reload function. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)
  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await fnRef.current()
      if (my === seq.current) { setData(d); setError(null) }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, deps)
  return { data, error, loading, reload, setData }
}

/** Run an action with a busy flag; shows success/failure toasts. Prevents double submits. */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    if (lock.current) return undefined
    lock.current = true
    setBusy(true)
    try {
      const r = await fn()
      if (okMsg) toast.ok(okMsg)
      return r
    } catch (e) {
      toast.err((e as Error).message)
      return undefined
    } finally {
      lock.current = false
      setBusy(false)
    }
  }, [toast])
  return { busy, run }
}

const settingCache = new Map<string, Promise<unknown>>()
/** Read an effective setting value through the setting_value() function (works for every signed-in role). */
export function useSetting<T>(key: string, fallback: T): T {
  const [v, setV] = useState<T>(fallback)
  useEffect(() => {
    let alive = true
    if (!settingCache.has(key)) settingCache.set(key, rpc('setting_value', { p_key: key }).catch(() => fallback))
    settingCache.get(key)!.then((x) => { if (alive && x !== null && x !== undefined) setV(x as T) })
    return () => { alive = false }
  }, [key, fallback])
  return v
}
export const clearSettingCache = () => settingCache.clear()

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}
