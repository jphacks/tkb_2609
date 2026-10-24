import { eventTypesError } from '../../lib/eventTypes'
import { useState, type CSSProperties } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useSubscription } from '../../app/useSubscription'
import { useFeedback } from '../../components/feedback/context'
import { CopyIcon, PlusIcon, TrashIcon } from '../../components/icons'
import type { EventEditPolicy, EventType } from '../../types'
import styles from './settings.module.css'

const TYPE_COLORS = ['#2563eb', '#e8590c', '#12a150', '#7c5cdb', '#d6336c', '#0e9aa7', '#6b7280']

/** 管理者だけに表示する設定 */
export function AdminSettings() {
  return (
    <>
      <JoinCodeSection />
      <EditPolicySection />
      <EventTypesSection />
    </>
  )
}

function JoinCodeSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run, confirm, toast } = useFeedback()
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const code = useSubscription<string | null>(revealed ? (cb) => repo.teams.subscribeJoinCode(team.id, cb) : null, [
    team.id,
    revealed,
  ])

  const appUrl = `${location.origin}/?openExternalBrowser=1`
  const shareText = `「${team.name}」の Bukatsu に参加してください。\n参加コード：${code}\n${appUrl}`

  const reveal = () => setRevealed(true)

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code ?? '')
      toast('参加コードをコピーしました')
    } catch {
      toast('コピーできませんでした')
    }
  }

  const regenerate = async () => {
    const ok = await confirm({
      title: '参加コードを再発行しますか？',
      message: '今のコードは使えなくなります。参加済みのメンバーには影響しません。',
      confirmLabel: '再発行',
      danger: true,
    })
    if (!ok || busy) return
    setBusy(true)
    await run(() => repo.teams.regenerateJoinCode(team.id), '参加コードを再発行しました')
    setBusy(false)
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">参加コード（管理者）</h2>
      <div className={`card ${styles.codeCard}`}>
        {!revealed ? (
          <button className="btn btn-secondary btn-block" onClick={reveal}>
            参加コードを表示
          </button>
        ) : !code ? (
          <p role="status">参加コードを取得中です。取得できない場合は再取得してください。</p>
        ) : (
          <>
            <div className={styles.codeRow}>
              <span className={styles.code}>{code}</span>
              <button className="icon-btn" onClick={copy} aria-label="参加コードをコピー">
                <CopyIcon size={20} />
              </button>
            </div>
            <a
              className={`btn btn-block ${styles.lineButton}`}
              href={`https://line.me/R/share?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
            >
              LINE で共有
            </a>
            <button className={`btn btn-ghost btn-sm ${styles.danger}`} onClick={regenerate} disabled={busy}>
              コードを再発行
            </button>
          </>
        )}
        <p className="hint">コードを知っている人は誰でも参加できます。意図しない人に知られたら再発行してください。</p>
      </div>
    </section>
  )
}

function EditPolicySection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const policy = team.settings.eventEditPolicy
  const [busy, setBusy] = useState(false)

  const change = async (next: EventEditPolicy) => {
    if (next !== policy && !busy) {
      setBusy(true)
      await run(() => repo.teams.updateSettings(team.id, { eventEditPolicy: next }), '予定の編集権限を変更しました')
      setBusy(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">予定を編集できる人（管理者）</h2>
      <div className={styles.segment} role="radiogroup">
        <button role="radio" disabled={busy} aria-checked={policy === 'admins'} onClick={() => change('admins')}>
          管理者のみ
        </button>
        <button role="radio" disabled={busy} aria-checked={policy === 'all'} onClick={() => change('all')}>
          全員
        </button>
      </div>
    </section>
  )
}

function EventTypesSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const source = team.settings.eventTypes
  const remoteKey = JSON.stringify(source)
  const [draft, setDraft] = useState({ base: remoteKey, types: source })
  const draftKey = JSON.stringify(draft.types)
  const dirty = draftKey !== draft.base && draftKey !== remoteKey
  const types = dirty ? draft.types : source
  const conflict = dirty && draft.base !== remoteKey
  const setTypes = (change: (previous: EventType[]) => EventType[]) =>
    setDraft({ base: dirty ? draft.base : remoteKey, types: change(types) })
  const [busy, setBusy] = useState(false)
  const changed = JSON.stringify(types) !== JSON.stringify(team.settings.eventTypes)
  const validation = eventTypesError(types)
  const valid = validation === null

  const patch = (index: number, value: Partial<EventType>) =>
    setTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...value } : t)))

  const add = () =>
    setTypes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: '', color: TYPE_COLORS[prev.length % TYPE_COLORS.length] },
    ])

  const save = async () => {
    if (busy || conflict || !valid) return
    setBusy(true)
    const eventTypes = types.map((t) => ({ ...t, label: t.label.trim() }))
    await run(() => repo.teams.updateSettings(team.id, { eventTypes }), '予定の種類を保存しました')
    setBusy(false)
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">予定の種類（管理者）</h2>
      <div className={`card ${styles.types}`}>
        {types.map((type, index) => (
          <div key={type.id} className={styles.typeRow}>
            <input
              className="input"
              maxLength={40}
              value={type.label}
              onChange={(e) => patch(index, { label: e.target.value })}
              placeholder="種類の名前"
              aria-label="種類の名前"
            />
            <div className={styles.colors} role="radiogroup" aria-label="色">
              {TYPE_COLORS.map((color) => (
                <button
                  key={color}
                  role="radio"
                  aria-checked={type.color === color}
                  aria-label={color}
                  className={styles.color}
                  style={{ '--swatch': color } as CSSProperties}
                  onClick={() => patch(index, { color })}
                />
              ))}
              {types.length > 1 && (
                <button
                  className={`icon-btn ${styles.typeDelete}`}
                  onClick={() => setTypes((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`${type.label || '種類'}を削除`}
                >
                  <TrashIcon size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
        {changed && validation && <p className="error-text">{validation}</p>}
        {conflict && (
          <div role="alert">
            <p>別の管理者が予定の種類を変更しました。</p>
            <button className="btn btn-secondary" onClick={() => setDraft({ base: remoteKey, types: source })}>
              最新の種類を読み直す
            </button>
          </div>
        )}
        <div className={styles.typeActions}>
          <button className="btn btn-ghost btn-sm" onClick={add} disabled={types.length >= 10 || busy}>
            <PlusIcon size={18} />
            種類を追加
          </button>
          <button className="btn btn-primary btn-sm" disabled={!changed || !valid || busy || conflict} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </section>
  )
}
