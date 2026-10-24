import { supabase } from './supabase'

/** Supabase errors become plain Errors whose message is safe to show to people. */
export class ApiError extends Error {}

export function explain(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (/relation .* does not exist|Could not find the (table|function)|schema cache/i.test(m)) {
    return 'This feature needs a database update that has not been deployed yet (see CHANGES.md, marked DEPLOY).'
  }
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(m)) return 'That record already exists.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Cannot reach the server. Check your connection and try again.'
  return m
}

/** Unwrap a PostgREST result, throwing a readable error. */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new ApiError(explain(error))
  return data as T
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new ApiError(explain(error))
  return data as T
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

/** Select rows from a table (RLS decides what the caller may see). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function select<T = Row>(table: string, columns = '*', f?: (q: any) => any): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from(table).select(columns)
  if (f) q = f(q)
  return unwrap<T[]>(q).then((r) => r ?? [])
}
