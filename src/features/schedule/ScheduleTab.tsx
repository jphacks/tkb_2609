import { useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useSubscription } from '../../app/useSubscription'
import { PlusIcon } from '../../components/icons'
import type { TeamEvent } from '../../types'
import { EventCard } from './EventCard'
import { EventDetail } from './EventDetail'
import { EventForm } from './EventForm'
import styles from './schedule.module.css'

type View = { kind: 'list' } | { kind: 'detail'; eventId: string } | { kind: 'form'; eventId?: string }

export function ScheduleTab() {
  const repo = useRepository()
  const { team, canEditEvents } = useSession()
  const [pageSize, setPageSize] = useState(20)
  const page = useSubscription<{ events: TeamEvent[]; hasMore: boolean }>((cb) => repo.events.subscribeUpcoming(team.id, (events, hasMore) => cb({ events, hasMore }), pageSize), [team.id, pageSize])
  // 追加取得中も既存カードを残し、スクロール位置が先頭へ戻らないようにする。
  const [loaded, setLoaded] = useState<{ teamId: string; value: NonNullable<typeof page> }>()
  if (page && loaded?.value !== page) setLoaded({ teamId: team.id, value: page })
  const shownPage = page ?? (loaded?.teamId === team.id ? loaded.value : undefined)
  const events = shownPage?.events
  const [view, setView] = useState<View>({ kind: 'list' })

  const selectedId = view.kind === 'list' ? undefined : view.eventId
  const selected = useSubscription<TeamEvent | null>(selectedId ? (cb) => repo.events.subscribeOne(team.id, selectedId, cb) : null, [team.id, selectedId])

  const typeOf = (typeId: string) => team.settings.eventTypes.find((t) => t.id === typeId)
  const backToList = () => setView({ kind: 'list' })

  return (
    <>
      {events === undefined ? (
        <div className={styles.list} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className={styles.empty}>
          <p>今後の予定はありません</p>
          {canEditEvents && <p className="muted">右下の ＋ から予定を追加できます</p>}
        </div>
      ) : (
        <div className={styles.list}>
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              type={typeOf(event.typeId)}
              onOpen={() => setView({ kind: 'detail', eventId: event.id })}
            />
          ))}
        </div>
      )}

      {shownPage?.hasMore && <button className="btn btn-secondary btn-block" disabled={!page} onClick={() => setPageSize((size) => size + 20)}>{page ? '次の20件を表示' : '読み込み中…'}</button>}

      {canEditEvents && (
        <button className={styles.fab} onClick={() => setView({ kind: 'form' })} aria-label="予定を追加">
          <PlusIcon size={26} />
        </button>
      )}

      {view.kind === 'detail' && (
        <EventDetail
          event={selected ?? undefined}
          onBack={backToList}
          onEdit={() => setView({ kind: 'form', eventId: view.eventId })}
        />
      )}
      {view.kind === 'form' && (!view.eventId || selected) && (
        <EventForm
          event={view.eventId ? selected ?? undefined : undefined}
          onDone={(eventId) => setView(eventId ? { kind: 'detail', eventId } : { kind: 'list' })}
        />
      )}
    </>
  )
}
