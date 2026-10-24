import { describe, expect, it } from 'vitest'
import { toCsv } from './export'
import { parseCsv } from '../pages/admin/Imports'

describe('CSV export', () => {
  const cols = [{ header: 'Name', value: (r: { n: string }) => r.n }]
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([{ n: 'Smith, Jo' }, { n: 'say "hi"' }, { n: 'a\nb' }], cols)).toBe('Name\r\n"Smith, Jo"\r\n"say ""hi"""\r\n"a\nb"')
  })
  it('neutralises spreadsheet formulas', () => {
    expect(toCsv([{ n: '=HYPERLINK("http://x")' }, { n: '+1+1' }, { n: '@SUM(A1)' }], cols).split('\r\n').slice(1).every((l) => l.startsWith("\"'") || l.startsWith("'"))).toBe(true)
  })
  it('keeps real numbers and negatives intact', () => {
    expect(toCsv([{ n: '-50' }, { n: '12.5' }], cols)).toBe('Name\r\n-50\r\n12.5')
  })
})

describe('CSV import parser', () => {
  it('reads quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""ok"""\r\n\r\nlast,row')).toEqual([['a', 'b'], ['x, y', 'he said "ok"'], ['last', 'row']])
  })
  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿Name\nAna')[0][0]).toBe('Name')
  })
})
