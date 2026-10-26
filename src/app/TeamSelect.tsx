import { ChevronDownIcon } from '../components/icons'
import styles from './app.module.css'
import { canOpenTeamMenu, canSwitchTeam, useTeamNavigation } from './contexts'

/**
 * 所属チームの切り替え（#59）。ヘッダーではチーム名の見出しと同じ見た目にし、
 * 見えている名前の上に透明の選択欄を重ねる（欄の幅が一番長いチーム名に引きずられず、開閉の印が名前のすぐ右に来る）。
 * ヘッダーは1所属から、復旧画面の切り替え欄は2所属から表示する。
 */
export function TeamSelect({ teamId, teamName, variant }: { teamId: string; teamName: string; variant: 'header' | 'field' }) {
  const navigation = useTeamNavigation()
  if (!navigation || (variant === 'header' ? !canOpenTeamMenu(navigation, teamId) : !canSwitchTeam(navigation, teamId))) return null
  const select = (
    <select
      aria-label="表示するチーム"
      className={variant === 'field' ? 'input' : undefined}
      value={`team:${teamId}`}
      onChange={(e) => {
        const value = e.currentTarget.value
        // 操作行を現在のチーム名として残さない。戻った後も同じ操作を選択できる。
        e.currentTarget.value = `team:${teamId}`
        if (value === 'action:join') navigation.add('join')
        else if (value === 'action:create') navigation.add('create')
        else if (value.startsWith('team:') && navigation.teams.some((t) => `team:${t.id}` === value)) navigation.select(value.slice(5))
      }}
    >
      {navigation.teams.map((t) => (
        <option key={t.id} value={`team:${t.id}`}>
          {t.name}
        </option>
      ))}
      {variant === 'header' && <option value="action:join">別のチームに参加</option>}
      {variant === 'header' && <option value="action:create">新しくチームを作成</option>}
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
