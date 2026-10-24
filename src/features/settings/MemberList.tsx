import { useMemo, useState } from 'react'
import { useRepository, useSession } from '../../app/contexts'
import { useFeedback } from '../../components/feedback/context'
import { MoreIcon } from '../../components/icons'
import { Sheet } from '../../components/Sheet'
import type { Member } from '../../types'
import styles from './settings.module.css'

const collator = new Intl.Collator('ja')

/** メンバー一覧。管理者は各メンバーのメニューから権限の変更と登録削除ができる */
export function MemberList() {
  const { members, user, isAdmin } = useSession()
  const [selected, setSelected] = useState<Member | null>(null)

  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) || collator.compare(a.displayName, b.displayName),
      ),
    [members],
  )

  return (
    <section className={styles.section}>
      <h2 className="section-title">メンバー（{members.length}人）</h2>
      <ul className={`card ${styles.members}`}>
        {sorted.map((member) => (
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
                className={`icon-btn ${styles.memberMore}`}
                onClick={() => setSelected(member)}
                aria-label={`${member.displayName}さんのメニュー`}
              >
                <MoreIcon size={20} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {selected && <MemberMenu member={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}

function MemberMenu({ member, onClose }: { member: Member; onClose(): void }) {
  const repo = useRepository()
  const { team, members, user } = useSession()
  const { run, confirm } = useFeedback()
  const isSelf = member.uid === user.uid
  // 管理者が最低1人は残るようにする
  const lastAdmin = member.role === 'admin' && members.filter((m) => m.role === 'admin').length <= 1

  const toggleRole = async () => {
    onClose()
    const toAdmin = member.role === 'member'
    const ok = await confirm({
      title: toAdmin ? `${member.displayName}さんを管理者にしますか？` : `${member.displayName}さんの管理者権限を外しますか？`,
      message: toAdmin ? '管理者は参加コードやチームの設定を変更できます。' : undefined,
      confirmLabel: toAdmin ? '管理者にする' : '外す',
      danger: !toAdmin,
    })
    if (ok) await run(() => repo.teams.setRole(team.id, member.uid, toAdmin ? 'admin' : 'member'), '権限を変更しました')
  }

  const remove = async () => {
    onClose()
    const ok = await confirm({
      title: `${member.displayName}さんの登録を削除しますか？`,
      message: '引退・退部などでチームから外します。持っている用具は手放した状態になります。もう一度参加するには参加コードが必要です。',
      confirmLabel: '登録削除',
      danger: true,
    })
    if (ok) await run(() => repo.teams.removeMember(team.id, member.uid), `${member.displayName}さんの登録を削除しました`)
  }

  return (
    <Sheet title={`${member.displayName}${isSelf ? '（あなた）' : ''}`} onClose={onClose}>
      <div className={styles.menu}>
        <button className="btn btn-secondary btn-block" disabled={lastAdmin} onClick={toggleRole}>
          {member.role === 'admin' ? '管理者権限を外す' : '管理者にする'}
        </button>
        {!isSelf && (
          <button className={`btn btn-secondary btn-block ${styles.danger}`} disabled={lastAdmin} onClick={remove}>
            登録削除（引退・退部など）
          </button>
        )}
        {lastAdmin && <p className="hint">管理者が0人になるため、この操作はできません。</p>}
        {isSelf && <p className="hint">自分がチームを離れるときは、設定の「チームを離れる」を使ってください。</p>}
      </div>
    </Sheet>
  )
}
