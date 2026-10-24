export type Col<T> = { header: string; value: (r: T) => string | number | null | undefined }

const esc = (v: unknown) => {
  let s = v == null ? '' : String(v)
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: T[], cols: Col<T>[]): string {
  return [cols.map((c) => esc(c.header)).join(','), ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(','))].join('\r\n')
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function downloadCsv<T>(name: string, rows: T[], cols: Col<T>[]) {
  save(new Blob(['﻿' + toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' }), name.endsWith('.csv') ? name : name + '.csv')
}

export async function downloadXlsx<T>(name: string, rows: T[], cols: Col<T>[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const data = [
    cols.map((c) => ({ value: c.header, fontWeight: 'bold' as const })),
    ...rows.map((r) => cols.map((c) => { const v = c.value(r); return { value: v == null ? '' : typeof v === 'number' ? v : String(v) } })),
  ]
  await writeXlsxFile(data as never, { columns: cols.map(() => ({ width: 22 })) } as never).toFile(name.endsWith('.xlsx') ? name : name + '.xlsx')
}
