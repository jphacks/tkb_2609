import { useRef, useState, type CSSProperties } from 'react'
import { eventTypesError } from '../../lib/eventTypes'
import { useRefresh, useRepository, useSession } from '../../app/contexts'
import { useSubscription } from '../../app/useSubscription'
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
    </>
  )
}

function JoinCodeSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run, confirm, toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  // 設定タブを開いたら最初から表示する（#43）。読み取りは管理者が設定タブを開いている間の1件だけ
  const code = useSubscription<string | null>((cb) => repo.teams.subscribeJoinCode(team.id, cb), [team.id])
  const codeInput = useRef<HTMLInputElement>(null)
  const [manualCopy, setManualCopy] = useState(false)

  // LINE の共有リンクは1回に1つのメッセージしか送れないため、URL と参加コードを2回に分けて送る（#42）。
  // コードだけのメッセージにすると、受け取った人が長押しでコピーしやすい
  const appUrl = `${location.origin}/?openExternalBrowser=1`
  const urlMessage = `「${team.name}」の BUKATSU に参加してください。アプリを開き、次に送る参加コードを入力してください。\n${appUrl}`
  const lineShareUrl = (text: string) => `https://line.me/R/share?text=${encodeURIComponent(text)}`

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
    if (!ok || busy) return
    setBusy(true)
    await run(() => repo.teams.regenerateJoinCode(team.id), '参加コードを再発行しました')
    setBusy(false)
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">参加コード（管理者）</h2>
      <div className={`card ${styles.codeCard}`}>
        {!code ? (
          <p role="status">参加コードを取得中です。取得できない場合は再取得してください。</p>
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
            <div className={styles.lineShare}>
              <p className={styles.lineShareTitle}>LINE で共有（2回に分けて送ります）</p>
              <a className={`btn btn-block ${styles.lineButton}`} href={lineShareUrl(urlMessage)} target="_blank" rel="noreferrer">
                ① アプリの URL を送る
              </a>
              <a className={`btn btn-block ${styles.lineButton}`} href={lineShareUrl(code)} target="_blank" rel="noreferrer">
                ② 参加コードを送る
              </a>
              <p className="hint">① のあと同じトークに ② を送ると、コードだけのメッセージになり、長押しでコピーしやすくなります。</p>
            </div>
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

/** 予定の種類を比べるためのキー。項目の並び順（id・名前・色）の違いは無視する。名前の空白は入力中の値を保つためそのまま比べる */
const typesKey = (types: EventType[]) => JSON.stringify(types.map((t) => [t.id, t.label, t.color]))

function EventTypesSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { run } = useFeedback()
  const source = team.settings.eventTypes
  const remoteKey = typesKey(source)
  const [draft, setDraft] = useState({ base: remoteKey, types: source })
  const draftKey = typesKey(draft.types)
  const dirty = draftKey !== draft.base && draftKey !== remoteKey
  const types = dirty ? draft.types : source
  const conflict = dirty && draft.base !== remoteKey
  const setTypes = (change: (previous: EventType[]) => EventType[]) =>
    setDraft({ base: dirty ? draft.base : remoteKey, types: change(types) })
  const [busy, setBusy] = useState(false)
  const changed = typesKey(types) !== remoteKey
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
    const sentKey = typesKey(types)
    const eventTypes = types.map((t) => ({ ...t, label: t.label.trim() }))
    const ok = await run(() => repo.teams.updateSettings(team.id, { eventTypes }), '予定の種類を保存しました')
    // 保存した値を下書きの基準にする。保存時に名前の前後の空白を取り除くため、
    // そのままだと自分の保存を「別の管理者の変更」と判定してしまう（#41）。保存中に続けて編集した分は残す
    if (ok) {
      const savedKey = typesKey(eventTypes)
      setDraft((d) => ({ base: savedKey, types: typesKey(d.types) === sentKey ? eventTypes : d.types }))
    }
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

export function DeleteTeamSection() {
  const repo = useRepository()
  const { team } = useSession()
  const { confirm, run } = useFeedback()
  const { refresh } = useRefresh()
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
    // 削除後は購読を張り直す（削除前から開いていたプロフィールの購読が、所属の更新を受け取らないことがあるため）
    if (ok && (await run(() => repo.teams.remove(team.id), 'チームを削除しました'))) refresh()
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
