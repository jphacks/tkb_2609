import { useEffect, useRef, useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { statusOf } from '../../lib/attendance'
import type { AttendanceStatus, TeamEvent } from '../../types'

interface Pending {
  status: AttendanceStatus
  /** 連続して押した間に書き込んだ値。古い書き込みの通知が遅れて届いても、他の端末からの変更と区別する */
  written: AttendanceStatus[]
  /** 最新の書き込みが完了した時点のサーバー側の値。未完了なら undefined */
  settledAt?: AttendanceStatus
}

/**
 * 自分の出欠。押した瞬間に表示を切り替え、サーバーの反映を待たない。
 * 最新のタップを保持し、古い書き込みの完了で表示を巻き戻さない。
 */
export function useMyAttendance(event: TeamEvent) {
  const repo = useRepository()
  const { team, user } = useSession()
  const { run } = useFeedback()
  const actual = statusOf(event.attendance, user.uid)
  const [pending, setPending] = useState<Pending | null>(null)
  const version = useRef(0)
  const latestActual = useRef(actual)
  useEffect(() => {
    latestActual.current = actual
  }, [actual])

  // 書き込み完了後、サーバー側の値が最新のタップに追いついたら楽観表示をやめる。
  // 自分が書き込んでいない値に変わった（別の端末で変更された）ときもやめる。
  // 書き込み完了とサーバーの通知のどちらが先に届くかは実装（モック／Firestore）によって異なる
  const caughtUp =
    pending?.settledAt !== undefined &&
    (actual === pending.status || (actual !== pending.settledAt && !pending.written.includes(actual)))
  if (caughtUp) setPending(null)
  const shown = pending && !caughtUp ? pending.status : actual

  const change = async (status: AttendanceStatus) => {
    if (status === shown) return
    const request = ++version.current
    const written = [...(pending?.written ?? []), status]
    setPending({ status, written })
    const ok = await run(() => repo.events.setAttendance(team.id, event.id, status))
    if (request !== version.current) return
    if (ok) setPending({ status, written, settledAt: latestActual.current })
    else setPending(null)
  }

  return [shown, change] as const
}
