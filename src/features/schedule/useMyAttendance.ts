import { useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { statusOf } from '../../lib/attendance'
import type { AttendanceStatus, TeamEvent } from '../../types'

/** 自分の出欠。押した瞬間に表示を切り替え、サーバーの反映を待たない */
export function useMyAttendance(event: TeamEvent) {
  const repo = useRepository()
  const { team, user } = useSession()
  const { run } = useFeedback()
  const actual = statusOf(event.attendance, user.uid)
  // 押したときのサーバー側の値（from）と一緒に覚えておき、サーバーの値が変わったら破棄する
  const [optimistic, setOptimistic] = useState<{ status: AttendanceStatus; from: AttendanceStatus } | null>(null)
  const shown = optimistic && optimistic.from === actual ? optimistic.status : actual

  const change = async (status: AttendanceStatus) => {
    if (status === shown) return
    setOptimistic({ status, from: actual })
    const ok = await run(() => repo.events.setAttendance(team.id, event.id, status))
    if (!ok) setOptimistic(null)
  }

  return [shown, change] as const
}
