import { ChevronDownIcon } from '../components/icons'
import styles from './app.module.css'
import { canSwitchTeam, useTeamNavigation } from './contexts'

/**
 * 所属チームの切り替え（#59）。ヘッダーではチーム名の見出しと同じ見た目にし、
 * 見えている名前の上に透明の選択欄を重ねる（欄の幅が一番長いチーム名に引きずられず、開閉の印が名前のすぐ右に来る）。
 * canSwitchTeam が true のときだけ使う
 */
export function TeamSelect({ teamId, teamName, variant }: { teamId: string; teamName: string; variant: 'header' | 'field' }) {
  const navigation = useTeamNavigation()
  if (!canSwitchTeam(navigation, teamId)) return null
  const select = (
    <select
      aria-label="表示するチーム"
      className={variant === 'field' ? 'input' : undefined}
      value={teamId}
      onChange={(e) => navigation.select(e.target.value)}
    >
      {navigation.teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
  if (variant === 'field') return select
  return (
    <label className={styles.teamSelect}>
      <span className={styles.teamSelectName} aria-hidden="true">
        {teamName}
      </span>
      <ChevronDownIcon size={18} />
      {select}
    </label>
  )
}
