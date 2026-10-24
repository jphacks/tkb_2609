import type { ComponentType } from 'react'
import { BoxIcon, CalendarIcon, GearIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { EquipmentTab } from '../features/equipment/EquipmentTab'
import { ScheduleTab } from '../features/schedule/ScheduleTab'
import { SettingsTab } from '../features/settings/SettingsTab'
import styles from './app.module.css'
import { canSwitchTeam, useSession, useTeamNavigation } from './contexts'
import { TeamSelect } from './TeamSelect'

export type TabId = 'schedule' | 'equipment' | 'settings'

const TABS: { id: TabId; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'schedule', label: '予定', Icon: CalendarIcon },
  { id: 'equipment', label: '用具', Icon: BoxIcon },
  { id: 'settings', label: '設定', Icon: GearIcon },
]

/** 表示中のタブは呼び出し側で持つ。チームの切り替えや「チームを追加」から戻ったあとも同じタブを開くため（#59） */
export function MainShell({ tab, onTabChange: setTab }: { tab: TabId; onTabChange(tab: TabId): void }) {
  const { team } = useSession()
  const navigation = useTeamNavigation()

  return (
    <div className={styles.shell}>
      <div className={styles.headerArea}>
        {/* 2チーム以上に所属しているときは、チーム名の位置で切り替える（#59） */}
        <PageHeader
          title={team.name}
          titleControl={
            canSwitchTeam(navigation, team.id) ? (
              <TeamSelect teamId={team.id} teamName={team.name} variant="header" />
            ) : undefined
          }
        />
      </div>

      <main className={styles.content}>
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'equipment' && <EquipmentTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>

      <nav className={styles.tabbar} aria-label="メインメニュー">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={styles.tab}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setTab(id)
              window.scrollTo({ top: 0 })
            }}
          >
            <Icon size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
