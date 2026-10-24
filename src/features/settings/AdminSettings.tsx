import { useRef, useState, type CSSProperties } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { CopyIcon, PlusIcon, TrashIcon } from '../../components/icons'
import type { EventEditPolicy, EventType } from '../../types'
import styles from './settings.module.css'
import { copyText } from '../../lib/clipboard'

const TYPE_COLORS = ['#2563eb', '#e8590c', '#12a150', '#7c5cdb', '#d6336c', '#0e9aa7', '#6b7280']

/** 管理者だけに表示する設定 */
export function AdminSettings() {
  return (
    <>
      <JoinCodeSection />
      <EditPolicySection />
      <EventTypesSection />
      <DeleteTeamSection />
    </>
  )
}

function JoinCodeSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run, confirm, toast } = useFeedback()
  const codeInput = useRef<HTMLInputElement>(null)
  const [manualCopy, setManualCopy] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  const appUrl = `${location.origin}/?openExternalBrowser=1`
  const shareText = `「${team.name}」の Bukatsu に参加してください。\n参加コード：${code}\n${appUrl}`

  const reveal = () => run(async () => setCode(await repo.teams.getJoinCode(team.id)))

  const copy = async () => {
    if (!code) return
    if (await copyText(code)) {
      setManualCopy(false)
      toast('参加コードをコピーしました')
    } else {
      setManualCopy(true)
      codeInput.current?.focus()
      codeInput.current?.select()
      toast('コードを選択しました。長押し、または Ctrl/Cmd+C でコピーしてください')
    }
  }

  const regenerate = async () => {
    const ok = await confirm({
      title: '参加コードを再発行しますか？',
      message: '今のコードは使えなくなります。参加済みのメンバーには影響しません。',
      confirmLabel: '再発行',
      danger: true,
    })
    if (ok) await run(async () => setCode(await repo.teams.regenerateJoinCode(team.id)), '参加コードを再発行しました')
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">参加コード（管理者）</h2>
      <div className={`card ${styles.codeCard}`}>
        {code === null ? (
          <button className="btn btn-secondary btn-block" onClick={reveal}>
            参加コードを表示
          </button>
        ) : (
          <>
            <div className={styles.codeRow}>
              <input ref={codeInput} className={styles.code} value={code} readOnly
                aria-label="参加コード" onFocus={(e) => e.currentTarget.select()} />
              <button className="icon-btn" onClick={copy} aria-label="参加コードをコピー">
                <CopyIcon size={20} />
              </button>
            </div>
            {manualCopy && <p className="hint">自動コピーが許可されていません。コードを長押しして「コピー」、または Ctrl/Cmd+C でコピーしてください。</p>}
            <a
              className={`btn btn-block ${styles.lineButton}`}
              href={`https://line.me/R/share?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
            >
              LINE で共有
            </a>
            <button className={`btn btn-ghost btn-sm ${styles.danger}`} onClick={regenerate}>
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

  const change = (next: EventEditPolicy) => {
    if (next !== policy) {
      run(() => repo.teams.updateSettings(team.id, { eventEditPolicy: next }), '予定の編集権限を変更しました')
    }
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">予定を編集できる人（管理者）</h2>
      <div className={styles.segment} role="radiogroup">
        <button role="radio" aria-checked={policy === 'admins'} onClick={() => change('admins')}>
          管理者のみ
        </button>
        <button role="radio" aria-checked={policy === 'all'} onClick={() => change('all')}>
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
  const [types, setTypes] = useState<EventType[]>(team.settings.eventTypes)
  const [busy, setBusy] = useState(false)
  const changed = JSON.stringify(types) !== JSON.stringify(team.settings.eventTypes)
  const valid = types.length > 0 && types.every((t) => t.label.trim())

  const patch = (index: number, value: Partial<EventType>) =>
    setTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...value } : t)))

  const add = () =>
    setTypes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: '', color: TYPE_COLORS[prev.length % TYPE_COLORS.length] },
    ])

  const save = async () => {
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
        <div className={styles.typeActions}>
          <button className="btn btn-ghost btn-sm" onClick={add}>
            <PlusIcon size={18} />
            種類を追加
          </button>
          <button className="btn btn-primary btn-sm" disabled={!changed || !valid || busy} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </section>
  )
}

function DeleteTeamSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { confirm, run } = useFeedback()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (busy) return
    setBusy(true)
    const ok = await confirm({
      title: `「${team.name}」を削除しますか？`,
      message: 'チームの予定・出欠・メモ・用具・メンバー情報をすべて削除します。全メンバーがこのチームから外れ、参加コードも無効になります。元に戻せません。他のチームやアカウントは残ります。',
      confirmLabel: 'チームを削除する',
      danger: true,
    })
    if (ok) await run(() => repo.teams.remove(team.id), 'チームを削除しました')
    setBusy(false)
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">チームの削除（管理者）</h2>
      <p className="hint">全メンバーのチームデータを削除します。この操作は元に戻せません。</p>
      <button className="btn btn-danger btn-block" disabled={busy} onClick={remove}>チームを削除</button>
    </section>
  )
}
