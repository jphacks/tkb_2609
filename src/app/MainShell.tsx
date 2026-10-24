import { useState, type ComponentType } from 'react'
import { BoxIcon, CalendarIcon, ChevronDownIcon, GearIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { EquipmentTab } from '../features/equipment/EquipmentTab'
import { ScheduleTab } from '../features/schedule/ScheduleTab'
import { SettingsTab } from '../features/settings/SettingsTab'
import styles from './app.module.css'
import { useSession, useTeamNavigation } from './contexts'

type TabId = 'schedule' | 'equipment' | 'settings'

const TABS: { id: TabId; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'schedule', label: '予定', Icon: CalendarIcon },
  { id: 'equipment', label: '用具', Icon: BoxIcon },
  { id: 'settings', label: '設定', Icon: GearIcon },
]

export function MainShell() {
  const { team } = useSession()
  const navigation = useTeamNavigation()
  const [tab, setTab] = useState<TabId>('schedule')

  return (
    <div className={styles.shell}>
      <div className={styles.headerArea}>
        {/* 2チーム以上に所属しているときは、チーム名の位置で切り替える（#59） */}
        <PageHeader
          title={team.name}
          titleControl={
            navigation && navigation.teams.length > 1 ? (
              <label className={styles.teamSelect}>
                <select aria-label="表示するチーム" value={team.id} onChange={(e) => navigation.select(e.target.value)}>
                  {navigation.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon size={18} />
              </label>
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
