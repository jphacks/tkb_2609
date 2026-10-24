import { useMemo } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import type { Member } from '../../types'
import styles from './settings.module.css'

const collator = new Intl.Collator('ja')

/** メンバー一覧。管理者は権限の付与・解除ができる */
export function MemberList() {
  const repo = useRepository()
  const { team, members, user, isAdmin } = useSession()
  const { run, confirm } = useFeedback()

  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) || collator.compare(a.displayName, b.displayName),
      ),
    [members],
  )
  const adminCount = members.filter((m) => m.role === 'admin').length

  const toggleRole = async (member: Member) => {
    const toAdmin = member.role === 'member'
    const ok = await confirm({
      title: toAdmin ? `${member.displayName}さんを管理者にしますか？` : `${member.displayName}さんの管理者権限を外しますか？`,
      message: toAdmin ? '管理者は参加コードやチームの設定を変更できます。' : undefined,
      confirmLabel: toAdmin ? '管理者にする' : '外す',
      danger: !toAdmin,
    })
    if (ok) await run(() => repo.teams.setRole(team.id, member.uid, toAdmin ? 'admin' : 'member'), '権限を変更しました')
  }

  return (
    <section className={styles.section}>
      <h2 className="section-title">メンバー（{members.length}人）</h2>
      <ul className={`card ${styles.members}`}>
        {sorted.map((member) => {
          const lastAdmin = member.role === 'admin' && adminCount <= 1
          return (
            <li key={member.uid} className={styles.member}>
              <span className={styles.avatar} aria-hidden="true">
                {member.displayName.slice(0, 1)}
              </span>
              <span className={styles.memberName}>
                {member.displayName}
                {member.uid === user.uid && <span className="muted">（あなた）</span>}
              </span>
              {member.role === 'admin' && <span className={styles.adminBadge}>管理者</span>}
              {isAdmin && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={lastAdmin}
                  title={lastAdmin ? '管理者が0人になるため外せません' : undefined}
                  onClick={() => toggleRole(member)}
                >
                  {member.role === 'admin' ? '外す' : '管理者に'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
