import { describe, expect, it } from 'vitest'
import { MAX_WEEKLY_EVENTS, weeklyDates } from '../src/lib/weekly'

// 毎週の予定の一括追加（#44）で作る日付
describe('weeklyDates', () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`

  it('returns the chosen weekdays within the period, both ends included, in order', () => {
    // 2026-10-27 は火曜日
    const dates = weeklyDates('2026-10-27', '2026-11-10', [4, 2], '17:30')
    expect(dates.map(ymd)).toEqual([
      '2026-10-27 17:30',
      '2026-10-29 17:30',
      '2026-11-3 17:30',
      '2026-11-5 17:30',
      '2026-11-10 17:30',
    ])
  })

  it('crosses month and year boundaries', () => {
    expect(weeklyDates('2026-12-25', '2027-01-08', [5], '09:00').map(ymd)).toEqual([
      '2026-12-25 9:0',
      '2027-1-1 9:0',
      '2027-1-8 9:0',
    ])
  })

  it('is empty without weekdays, with a reversed period or with missing input', () => {
    expect(weeklyDates('2026-10-27', '2026-11-10', [], '17:00')).toEqual([])
    expect(weeklyDates('2026-11-10', '2026-10-27', [2], '17:00')).toEqual([])
    expect(weeklyDates('', '2026-11-10', [2], '17:00')).toEqual([])
    expect(weeklyDates('2026-10-27', '2026-11-10', [2], '')).toEqual([])
  })

  it('stops one past the limit so that long periods are detected without counting them all', () => {
    expect(weeklyDates('2026-01-01', '2099-12-31', [0, 1, 2, 3, 4, 5, 6], '17:00')).toHaveLength(
      MAX_WEEKLY_EVENTS + 1,
    )
  })
})
