import { useRef, useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { statusOf } from '../../lib/attendance'
import type { AttendanceStatus, TeamEvent } from '../../types'

/** 最新のタップを保持し、古い書き込みの完了で表示を巻き戻さない。 */
export function useMyAttendance(event: TeamEvent) {
  const repo = useRepository()
  const { team, user } = useSession()
  const { run } = useFeedback()
  const actual = statusOf(event.attendance, user.uid)
  const [optimistic, setOptimistic] = useState<AttendanceStatus | null>(null)
  const version = useRef(0)
  const shown = optimistic ?? actual

  const change = async (status: AttendanceStatus) => {
    if (status === shown) return
    const request = ++version.current
    setOptimistic(status)
    await run(() => repo.events.setAttendance(team.id, event.id, status))
    if (request === version.current) setOptimistic(null)
  }
  return [shown, change] as const
}
