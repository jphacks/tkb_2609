const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 10/25(土) */
export function formatDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`
}

/** 8:30 */
export function formatTime(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 今日・明日なら相対表記、それ以外は null */
export function relativeDay(date: Date, now = new Date()): string | null {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((start(date) - start(now)) / 86_400_000)
  if (diff === 0) return '今日'
  if (diff === 1) return '明日'
  return null
}

/** メモの投稿時刻。10/25 8:30 */
export function formatDateTime(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()} ${formatTime(date)}`
}

/** <input type="date"> 用の YYYY-MM-DD */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** <input type="time"> 用の HH:MM */
export function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDateTimeInput(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}
