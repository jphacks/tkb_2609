import { useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { MAX_PLACES, MAX_PLACE_LENGTH, placesError } from '../../lib/places'
import styles from './settings.module.css'

export function PlacesSection() {
  const { team } = useSession()
  const repo = useRepository()
  const { run } = useFeedback()
  const source = team.settings.places ?? []
  const remote = JSON.stringify(source)
  const [draft, setDraft] = useState({ base: remote, places: source })
  const dirty = JSON.stringify(draft.places) !== draft.base && JSON.stringify(draft.places) !== remote
  const places = dirty ? draft.places : source
  const conflict = dirty && draft.base !== remote
  const [busy, setBusy] = useState(false)
  const validation = placesError(places)
  const change = (next: string[]) => setDraft({ base: dirty ? draft.base : remote, places: next })
  const move = (index: number, delta: number) => {
    const next = [...places]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    change(next)
  }
  const save = async () => {
    if (busy || conflict || validation) return
    setBusy(true)
    const sent = places.map((p) => p.trim())
    if (await run(() => repo.teams.updateSettings(team.id, { places: sent }), '場所を保存しました')) {
      setDraft({ base: JSON.stringify(sent), places: sent })
    }
    setBusy(false)
  }
  return (
    <section className={styles.section}>
      <h2 className="section-title">よく使う場所（管理者）</h2>
      <div className={`card ${styles.types}`}>
        <p className="hint">予定の追加・編集で選べます。変更しても登録済みの予定の場所は変わりません。</p>
        {places.map((place, index) => (
          <div key={index} className="field">
            <label className="field">
              <span className="label">場所 {index + 1}</span>
              <input className="input" maxLength={MAX_PLACE_LENGTH} value={place} disabled={busy}
                onChange={(e) => change(places.map((p, i) => i === index ? e.target.value : p))} />
            </label>
            <div className={styles.placeActions}>
              <button className="btn btn-secondary" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`場所 ${index + 1}を上へ`}>上へ</button>
              <button className="btn btn-secondary" disabled={busy || index === places.length - 1} onClick={() => move(index, 1)} aria-label={`場所 ${index + 1}を下へ`}>下へ</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => change(places.filter((_, i) => i !== index))} aria-label={`場所 ${index + 1}を削除`}>削除</button>
            </div>
          </div>
        ))}
        {dirty && validation && <p className="error-text">{validation}</p>}
        {conflict && <div role="alert"><p>別の操作で場所が変更されました。</p><button className="btn btn-secondary" onClick={() => setDraft({ base: remote, places: source })}>最新の場所を読み直す</button></div>}
        <div className={styles.placeActions}>
          <button className="btn btn-secondary" disabled={busy || places.length >= MAX_PLACES} onClick={() => change([...places, ''])}>場所を追加</button>
          <button className="btn btn-primary" disabled={busy || conflict || !!validation || JSON.stringify(places) === remote} onClick={save}>場所を保存</button>
        </div>
      </div>
    </section>
  )
}
