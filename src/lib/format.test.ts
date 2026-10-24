import { describe, expect, it } from 'vitest'
import { addDays, dow, fmtDate, fmtClock, inTz, inr, mondayOf, zonedToUtc } from './format'

describe('zonedToUtc (time zones and DST)', () => {
  it('converts an India evening to UTC', () => {
    expect(zonedToUtc('2026-10-24', '17:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-24T11:30:00.000Z')
  })
  it('keeps the same New York wall-clock time across the US DST change (AT-28)', () => {
    const before = zonedToUtc('2026-03-07', '09:00', 'America/New_York') // EST, UTC-5
    const after = zonedToUtc('2026-03-09', '09:00', 'America/New_York') // EDT, UTC-4
    expect(before.toISOString()).toBe('2026-03-07T14:00:00.000Z')
    expect(after.toISOString()).toBe('2026-03-09T13:00:00.000Z')
    // an India-based tutor therefore sees 7:30 PM before and 6:30 PM after
    expect(inTz(before, 'Asia/Kolkata').time).toBe('19:30')
    expect(inTz(after, 'Asia/Kolkata').time).toBe('18:30')
  })
  it('handles the autumn change in London', () => {
    expect(zonedToUtc('2026-10-24', '10:00', 'Europe/London').toISOString()).toBe('2026-10-24T09:00:00.000Z') // BST
    expect(zonedToUtc('2026-10-26', '10:00', 'Europe/London').toISOString()).toBe('2026-10-26T10:00:00.000Z') // GMT
  })
  it('round-trips through inTz', () => {
    const d = zonedToUtc('2026-06-15', '23:45', 'Australia/Sydney')
    expect(inTz(d, 'Australia/Sydney')).toMatchObject({ date: '2026-06-15', time: '23:45' })
  })
})

describe('date helpers', () => {
  it('finds Monday like Postgres date_trunc(week)', () => {
    expect(mondayOf('2026-10-24')).toBe('2026-10-19') // Saturday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19') // Sunday belongs to the previous Monday
    expect(mondayOf('2026-10-19')).toBe('2026-10-19')
  })
  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(dow('2026-10-24')).toBe(6)
  })
  it('formats date-only values without shifting the day', () => {
    expect(fmtDate('2026-10-14')).toBe('14 Oct 2026')
    expect(fmtClock('16:00:00')).toBe('4:00 PM')
    expect(fmtClock('00:30')).toBe('12:30 AM')
  })
  it('formats rupees in Indian grouping', () => {
    expect(inr(1234567.5)).toContain('12,34,567.50')
  })
})
