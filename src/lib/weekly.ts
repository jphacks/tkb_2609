import { fromDateTimeInput } from './format'

/** 毎週の予定を一度に追加できる上限（1年分）。Firestore の一括書き込みの上限（500件）にも収まる */
export const MAX_WEEKLY_EVENTS = 52

/**
 * 開始日〜終了日（両端を含む、YYYY-MM-DD）のうち、指定した曜日（0=日〜6=土）の日付を早い順に返す。
 * 上限を超えたことがわかるよう、上限 + 1 件で打ち切る。入力が不正・期間が逆なら空
 */
export function weeklyDates(start: string, end: string, weekdays: number[], time: string): Date[] {
  if (!start || !end || !time || weekdays.length === 0) return []
  const first = fromDateTimeInput(start, time)
  const last = fromDateTimeInput(end, time)
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return []
  const dates: Date[] = []
  for (
    let day = first;
    day <= last && dates.length <= MAX_WEEKLY_EVENTS;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, day.getHours(), day.getMinutes())
  ) {
    if (weekdays.includes(day.getDay())) dates.push(day)
  }
  return dates
}
