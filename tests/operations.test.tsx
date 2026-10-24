// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { RepositoryContext, SessionContext, type Session } from '../src/app/contexts'
import { RefreshProvider } from '../src/app/RefreshProvider'
import { FeedbackContext, type Feedback } from '../src/components/feedback/context'
import { createMockRepository } from '../src/data/mock/mockRepository'
import { LoginScreen } from '../src/features/auth/LoginScreen'
import { SignUpScreen } from '../src/features/auth/SignUpScreen'
import { EquipmentTab } from '../src/features/equipment/EquipmentTab'
import { MyItemsWidget } from '../src/features/equipment/MyItemsWidget'
import { SettingsTab } from '../src/features/settings/SettingsTab'
import type { EquipmentItem } from '../src/types'
vi.mock('../src/data', () => ({ isMock: false, resetMockData: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})
const baseSession = (): Session => {
  const me = { uid: 'admin', displayName: '管理者', role: 'admin' as const, joinedAt: new Date() }
  return {
    user: { uid: 'admin', email: 'admin@example.invalid', emailVerified: true },
    profile: { uid: 'admin', displayName: '管理者', teamIds: ['team'], teamId: 'team' },
    team: {
      id: 'team',
      name: 'テストチーム',
      createdBy: 'admin',
      createdAt: new Date(),
      settings: { eventEditPolicy: 'admins', eventTypes: [{ id: 'practice', label: '練習', color: '#2563eb' }] },
    },
    members: [me, { uid: 'member', displayName: 'メンバー', role: 'member', joinedAt: new Date() }],
    me,
    isAdmin: true,
    canEditEvents: true,
  }
}
const equipment = (id: string, name: string, holderUid: string | null = null): EquipmentItem => ({
  id,
  name,
  holderUid,
  holderName: holderUid,
  updatedAt: new Date(),
})
function stream<T>(value: T) {
  const listeners = new Set<(v: T) => void>()
  return {
    subscribe: vi.fn((cb: (v: T) => void) => {
      listeners.add(cb)
      cb(value)
      return () => {
        listeners.delete(cb)
      }
    }),
    emit(next: T) {
      value = next
      act(() => listeners.forEach((cb) => cb(next)))
    },
    count: () => listeners.size,
  }
}
function harness() {
  let session = baseSession()
  const repo = createMockRepository()
  const feedback: Feedback = {
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    run: vi.fn(async (action) => {
      try {
        await action()
        return true
      } catch {
        return false
      }
    }),
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryContext.Provider value={repo}>
        <SessionContext.Provider value={session}>
          <RefreshProvider>
            <FeedbackContext.Provider value={feedback}>{children}</FeedbackContext.Provider>
          </RefreshProvider>
        </SessionContext.Provider>
      </RepositoryContext.Provider>
    )
  }
  return {
    repo,
    feedback,
    wrapper: Wrapper,
    session: () => session,
    update: (next: Session) => {
      session = next
    },
  }
}
describe('equipment UI', () => {
  it('sorts free items first, calls hold, shows own items and follows current holder in an open menu', async () => {
    const h = harness(),
      items = stream([equipment('held', 'アラーム', 'member'), equipment('b', 'タイマー'), equipment('a', 'ケース')])
    h.repo.equipment.subscribe = (_teamId, cb) => items.subscribe(cb)
    h.repo.equipment.hold = vi.fn(async () => {})
    h.repo.equipment.forceRelease = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<EquipmentTab />, { wrapper: h.wrapper })
    expect(screen.getAllByRole('group').map((e) => e.getAttribute('aria-label'))).toEqual([
      'ケース',
      'タイマー',
      'アラーム',
    ])
    await user.click(screen.getByRole('button', { name: 'ケースを持つ' }))
    expect(h.repo.equipment.hold).toHaveBeenCalledWith('team', 'a')
    await user.click(screen.getByRole('button', { name: 'アラームのメニュー' }))
    items.emit([equipment('held', 'アラーム', 'other'), equipment('b', 'タイマー'), equipment('a', 'ケース', 'admin')])
    expect(screen.getByRole('region', { name: 'あなたが持っている用具' }).textContent).toContain('ケース')
    await user.click(screen.getByRole('button', { name: 'otherさんから手放させる（管理者）' }))
    expect(h.repo.equipment.forceRelease).toHaveBeenCalledWith('team', 'held', 'other')
  })
  it('requires confirmation for forced release and deletion; members never see force release', async () => {
    const h = harness(),
      items = stream([equipment('held', 'ケース', 'member')])
    h.repo.equipment.subscribe = (_teamId, cb) => items.subscribe(cb)
    h.repo.equipment.forceRelease = vi.fn(async () => {})
    h.repo.equipment.remove = vi.fn(async () => {})
    vi.mocked(h.feedback.confirm).mockResolvedValue(false)
    const user = userEvent.setup(),
      view = render(<EquipmentTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    await user.click(screen.getByRole('button', { name: /さんから手放させる/ }))
    expect(h.repo.equipment.forceRelease).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(h.repo.equipment.remove).not.toHaveBeenCalled()
    h.update({ ...h.session(), isAdmin: false, me: { ...h.session().me, role: 'member' } })
    view.rerender(<EquipmentTab />)
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    expect(screen.queryByRole('button', { name: /さんから手放させる/ })).toBeNull()
  })
  it('rejects duplicate names and detects remote edits without overwriting unsaved input', async () => {
    const h = harness(),
      items = stream([equipment('a', 'ケース'), equipment('b', 'コーン')])
    h.repo.equipment.subscribe = (_teamId, cb) => items.subscribe(cb)
    h.repo.equipment.update = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<EquipmentTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    await user.click(screen.getByRole('button', { name: '名前を編集' }))
    const input = screen.getByLabelText('用具名')
    await user.clear(input)
    await user.type(input, 'ｺｰﾝ')
    expect(screen.getByRole('button', { name: '保存する' }).hasAttribute('disabled')).toBe(true)
    await user.clear(input)
    await user.type(input, '新しいケース')
    items.emit([equipment('a', '他の人の変更'), equipment('b', 'コーン')])
    expect((input as HTMLInputElement).value).toBe('新しいケース')
    expect(screen.getByRole('button', { name: '保存する' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: '最新の名前に戻す' }))
    expect((input as HTMLInputElement).value).toBe('他の人の変更')
  })
  it('keeps all in-flight release buttons disabled independently', async () => {
    const h = harness(),
      releases: (() => void)[] = []
    h.repo.equipment.release = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)))
    const user = userEvent.setup()
    render(<MyItemsWidget items={[equipment('a', 'ケース', 'admin'), equipment('b', 'タイマー', 'admin')]} />, {
      wrapper: h.wrapper,
    })
    await user.click(screen.getByRole('button', { name: 'ケースを手放す' }))
    await user.click(screen.getByRole('button', { name: 'タイマーを手放す' }))
    expect(screen.getByRole('button', { name: 'ケースを手放す' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'タイマーを手放す' }).hasAttribute('disabled')).toBe(true)
    await act(async () => {
      releases[0]()
    })
    expect(screen.getByRole('button', { name: 'タイマーを手放す' }).hasAttribute('disabled')).toBe(true)
    await act(async () => {
      releases[1]()
    })
  })
})
describe('settings UI', () => {
  it('shows the app link and the private code from the start, each with a copy button (#43 #56)', async () => {
    const h = harness(),
      codes = stream<string | null>('ABCD2345')
    h.repo.teams.subscribeJoinCode = (_teamId, cb) => codes.subscribe(cb)
    h.repo.teams.regenerateJoinCode = vi.fn(async () => 'K7MPX2QA')
    const user = userEvent.setup(),
      view = render(<SettingsTab />, { wrapper: h.wrapper })
    // 「参加コードを表示」ボタンはなく、設定タブを開いたら購読して表示する（#43）
    expect(screen.queryByRole('button', { name: '参加コードを表示' })).toBeNull()
    expect(codes.count()).toBe(1)
    // 長押しで手動コピーできるよう、コードは読み取り専用の入力欄に表示する（PR #21）
    expect((screen.getByLabelText('参加コード') as HTMLInputElement).value).toBe('ABCD2345')
    codes.emit('K7MPX2QA')
    expect((screen.getByLabelText('参加コード') as HTMLInputElement).value).toBe('K7MPX2QA')
    // 「LINE で共有」はなく、参加コードの上にアプリのリンクの欄がある（#56）
    expect(screen.queryByRole('link', { name: /送る|LINE/ })).toBeNull()
    const link = screen.getByLabelText('アプリのリンク') as HTMLInputElement
    expect(link.value).toBe(`${location.origin}/?openExternalBrowser=1`)
    expect(link.compareDocumentPosition(screen.getByLabelText('参加コード')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 読み取れない・コードがない場合は、取得中のままにせず再発行できるようにする。リンクはそのまま表示する
    codes.emit(null)
    expect(screen.getByText(/参加コードを取得できませんでした/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'コードを再発行' })).toBeTruthy()
    expect(screen.getByLabelText('アプリのリンク')).toBeTruthy()
    codes.emit('K7MPX2QA')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
    await user.click(screen.getByRole('button', { name: 'アプリのリンクをコピー' }))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${location.origin}/?openExternalBrowser=1`)
    expect(h.feedback.toast).toHaveBeenLastCalledWith('アプリのリンクをコピーしました')
    await user.click(screen.getByRole('button', { name: '参加コードをコピー' }))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('K7MPX2QA')
    expect(h.feedback.toast).toHaveBeenLastCalledWith('参加コードをコピーしました')
    vi.mocked(h.feedback.confirm).mockResolvedValue(false)
    await user.click(screen.getByRole('button', { name: 'コードを再発行' }))
    expect(h.repo.teams.regenerateJoinCode).not.toHaveBeenCalled()
    h.update({ ...h.session(), isAdmin: false, me: { ...h.session().me, role: 'member' } })
    view.rerender(<SettingsTab />)
    expect(codes.count()).toBe(0)
    expect(screen.queryByLabelText('参加コード')).toBeNull()
  })
  it('applies remote event types when clean but preserves dirty drafts until explicitly reloaded', async () => {
    const h = harness(),
      user = userEvent.setup(),
      view = render(<SettingsTab />, { wrapper: h.wrapper })
    const source = () => h.session().team.settings.eventTypes[0]
    h.update({
      ...h.session(),
      team: {
        ...h.session().team,
        settings: { ...h.session().team.settings, eventTypes: [{ ...source(), label: '更新済み' }] },
      },
    })
    view.rerender(<SettingsTab />)
    const input = screen.getByRole('textbox', { name: '種類の名前' })
    expect((input as HTMLInputElement).value).toBe('更新済み')
    await user.clear(input)
    await user.type(input, '編集中')
    h.update({
      ...h.session(),
      team: {
        ...h.session().team,
        settings: { ...h.session().team.settings, eventTypes: [{ ...source(), label: '別の変更' }] },
      },
    })
    view.rerender(<SettingsTab />)
    expect((input as HTMLInputElement).value).toBe('編集中')
    expect(screen.getByText('別の管理者が予定の種類を変更しました。')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '最新の種類を読み直す' }))
    expect((input as HTMLInputElement).value).toBe('別の変更')
  })
  it('uses latest member roles in open menus and prevents removing the last admin', async () => {
    const h = harness(),
      user = userEvent.setup(),
      view = render(<SettingsTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('button', { name: '管理者さんのメニュー' }))
    expect(screen.getByRole('button', { name: '管理者権限を外す' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    await user.click(screen.getByRole('button', { name: 'メンバーさんのメニュー' }))
    h.update({
      ...h.session(),
      members: h.session().members.map((m) => (m.uid === 'member' ? { ...m, role: 'admin' } : m)),
    })
    view.rerender(<SettingsTab />)
    expect(screen.getByRole('button', { name: '管理者権限を外す' }).hasAttribute('disabled')).toBe(false)
    h.update({ ...h.session(), isAdmin: false })
    view.rerender(<SettingsTab />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('saves own display name, follows remote names and confirms logout', async () => {
    const h = harness(),
      user = userEvent.setup()
    h.repo.users.updateDisplayName = vi.fn(async () => {})
    h.repo.auth.signOut = vi.fn(async () => {})
    const view = render(<SettingsTab />, { wrapper: h.wrapper })
    const input = screen.getByLabelText('このチームでの名前')
    await user.clear(input)
    await user.type(input, '新しい名前')
    await user.click(within(input.closest('form')!).getByRole('button', { name: '保存' }))
    expect(h.repo.users.updateDisplayName).toHaveBeenCalledWith('team', '新しい名前')
    h.update({ ...h.session(), me: { ...h.session().me, displayName: '新しい名前' } })
    view.rerender(<SettingsTab />)
    expect(within(input.closest('form')!).queryByRole('button', { name: '保存' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    await waitFor(() => expect(h.repo.auth.signOut).toHaveBeenCalledTimes(1))
  })
  // #41：保存時に前後の空白を取り除くため、自分の保存を「別の管理者の変更」と誤判定していた
  it('does not report own saves as remote changes (trailing spaces, key order)', async () => {
    const h = harness(),
      user = userEvent.setup()
    h.repo.teams.updateSettings = vi.fn(async () => {})
    h.repo.users.updateDisplayName = vi.fn(async () => {})
    const view = render(<SettingsTab />, { wrapper: h.wrapper })
    const source = h.session().team.settings.eventTypes[0]
    const typeInput = screen.getByRole('textbox', { name: '種類の名前' })
    await user.clear(typeInput)
    await user.type(typeInput, '朝練 ')
    await user.click(within(typeInput.closest('section')!).getByRole('button', { name: '保存' }))
    expect(h.repo.teams.updateSettings).toHaveBeenCalledWith('team', {
      eventTypes: [{ ...source, label: '朝練' }],
    })
    // サーバーからは空白を除いた値が、項目の並び順も変わって届く
    h.update({
      ...h.session(),
      team: {
        ...h.session().team,
        settings: { ...h.session().team.settings, eventTypes: [{ color: source.color, label: '朝練', id: source.id }] },
      },
    })
    view.rerender(<SettingsTab />)
    expect(screen.queryByText('別の管理者が予定の種類を変更しました。')).toBeNull()
    expect((typeInput as HTMLInputElement).value).toBe('朝練')

    const nameInput = screen.getByLabelText('このチームでの名前')
    await user.clear(nameInput)
    await user.type(nameInput, '新しい名前 ')
    await user.click(within(nameInput.closest('form')!).getByRole('button', { name: '保存' }))
    h.update({ ...h.session(), me: { ...h.session().me, displayName: '新しい名前' } })
    view.rerender(<SettingsTab />)
    expect(screen.queryByText('名前が別の操作で変更されました。')).toBeNull()
    expect((nameInput as HTMLInputElement).value).toBe('新しい名前')
  })
})

describe('settings and equipment writes', () => {
  it('saves edit policy and event type name/color through the repository', async () => {
    const h = harness(),
      user = userEvent.setup()
    h.repo.teams.updateSettings = vi.fn(async () => {})
    render(<SettingsTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('radio', { name: '全員' }))
    expect(h.repo.teams.updateSettings).toHaveBeenCalledWith('team', { eventEditPolicy: 'all' })
    const input = screen.getByRole('textbox', { name: '種類の名前' })
    await user.clear(input)
    await user.type(input, '集合')
    await user.click(screen.getByRole('radio', { name: '#e8590c' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(h.repo.teams.updateSettings).toHaveBeenCalledWith('team', {
      eventTypes: [{ id: 'practice', label: '集合', color: '#e8590c' }],
    })
  })
  it('creates, edits and confirms deletion of equipment', async () => {
    const h = harness(),
      user = userEvent.setup(),
      items = stream<EquipmentItem[]>([])
    h.repo.equipment.subscribe = (_t, cb) => items.subscribe(cb)
    h.repo.equipment.add = vi.fn(async () => 'a')
    h.repo.equipment.update = vi.fn(async () => {})
    h.repo.equipment.remove = vi.fn(async () => {})
    render(<EquipmentTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('button', { name: '追加' }))
    await user.type(screen.getByLabelText('用具名'), 'ｹｰｽ')
    await user.click(screen.getByRole('button', { name: '追加する' }))
    expect(h.repo.equipment.add).toHaveBeenCalledWith('team', { name: 'ケース' })
    items.emit([equipment('a', 'ケース')])
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    await user.click(screen.getByRole('button', { name: '名前を編集' }))
    await user.clear(screen.getByLabelText('用具名'))
    await user.type(screen.getByLabelText('用具名'), '収納ケース')
    await user.click(screen.getByRole('button', { name: '保存する' }))
    expect(h.repo.equipment.update).toHaveBeenCalledWith('team', 'a', { name: '収納ケース' })
    await user.click(screen.getByRole('button', { name: 'ケースのメニュー' }))
    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(h.feedback.confirm).toHaveBeenCalled()
    expect(h.repo.equipment.remove).toHaveBeenCalledWith('team', 'a')
  })
  it('grants an admin role only after confirmation', async () => {
    const h = harness(),
      user = userEvent.setup()
    h.repo.teams.setRole = vi.fn(async () => {})
    render(<SettingsTab />, { wrapper: h.wrapper })
    await user.click(screen.getByRole('button', { name: 'メンバーさんのメニュー' }))
    await user.click(screen.getByRole('button', { name: '管理者にする' }))
    expect(h.feedback.confirm).toHaveBeenCalled()
    expect(h.repo.teams.setRole).toHaveBeenCalledWith('team', 'member', 'admin')
  })
})

describe('team deletion recovery (#24)', () => {
  // 削除中の画面は開始した管理者だけ。ほかのメンバーは削除が完了するまで通常の画面を使える
  it.each([true, false])('shows the deletion screen only to the initiator (initiator=%s)', async (initiator) => {
    const h = harness(), session = h.session()
    vi.spyOn(h.repo.auth, 'onAuthStateChanged').mockImplementation((cb) => { cb(session.user); return () => {} })
    vi.spyOn(h.repo.users, 'subscribeProfile').mockImplementation((_uid, cb) => { cb(session.profile); return () => {} })
    const deleting = {...session.team, deleting:true, deletionUid:initiator ? session.user.uid : 'another-admin'}
    vi.spyOn(h.repo.teams, 'subscribeMine').mockImplementation((cb) => { cb([deleting]); return () => {} })
    vi.spyOn(h.repo.teams, 'subscribe').mockImplementation((_id, cb) => { cb(deleting); return () => {} })
    vi.spyOn(h.repo.teams, 'subscribeMembers').mockImplementation((_id, cb) => { cb(session.members); return () => {} })
    const remove = vi.spyOn(h.repo.teams, 'remove').mockResolvedValue()
    render(<App />, {wrapper:h.wrapper})
    if (initiator) {
      expect(await screen.findByRole('heading', {name:'チームを削除中です'})).toBeTruthy()
      expect(screen.queryByRole('button', {name:'予定を追加'})).toBeNull()
      await userEvent.click(screen.getByRole('button', {name:'削除を再開'}))
      expect(remove).toHaveBeenCalledWith(session.team.id)
    } else {
      expect(await screen.findByRole('heading', {name:session.team.name})).toBeTruthy()
      expect(screen.queryByRole('heading', {name:'チームを削除中です'})).toBeNull()
      expect(screen.queryByRole('button', {name:'削除を再開'})).toBeNull()
    }
  })
})

// #39：メールアドレスを確認するまでは、確認待ちの画面だけを表示する
describe('email verification gate (#39)', () => {
  it('shows the verification screen to unverified users and lets them resend or re-check', async () => {
    const h = harness()
    const unverified = { uid: 'admin', email: 'admin@example.invalid', emailVerified: false }
    vi.spyOn(h.repo.auth, 'onAuthStateChanged').mockImplementation((cb) => {
      cb(unverified)
      return () => {}
    })
    const resend = vi.spyOn(h.repo.auth, 'sendEmailVerification').mockResolvedValue()
    const reload = vi.spyOn(h.repo.auth, 'reloadUser').mockResolvedValue()
    render(<App />, { wrapper: h.wrapper })
    expect(await screen.findByRole('heading', { name: 'メールアドレスを確認してください' })).toBeTruthy()
    expect(screen.getByText('admin@example.invalid')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'チームを作る' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '確認メールを再送' }))
    expect(resend).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }))
    expect(reload).toHaveBeenCalled()
  })
})

// #31：Google でログイン。LINE などのアプリ内ブラウザでは Google がブロックするため、外部ブラウザで開くよう案内する
describe('Google sign-in button (#31)', () => {
  const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0'
  it('signs in with Google from the login screen', async () => {
    const h = harness()
    const signIn = vi.spyOn(h.repo.auth, 'signInWithGoogle').mockResolvedValue()
    render(<LoginScreen onSignUp={() => {}} />, { wrapper: h.wrapper })
    await userEvent.click(screen.getByRole('button', { name: 'Google でログイン' }))
    expect(signIn).toHaveBeenCalledTimes(1)
  })
  it('shows the error and lets the user try again', async () => {
    const h = harness()
    const { RepositoryError } = await import('../src/data/repository')
    vi.spyOn(h.repo.auth, 'signInWithGoogle').mockRejectedValue(new RepositoryError('ログイン画面がブロックされました。'))
    render(<LoginScreen onSignUp={() => {}} />, { wrapper: h.wrapper })
    await userEvent.click(screen.getByRole('button', { name: 'Google でログイン' }))
    expect(await screen.findByText('ログイン画面がブロックされました。')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Google でログイン' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('replaces the button with a link to open an external browser inside LINE', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINE_UA)
    const h = harness()
    render(<LoginScreen onSignUp={() => {}} />, { wrapper: h.wrapper })
    expect(screen.queryByRole('button', { name: 'Google でログイン' })).toBeNull()
    expect(screen.getByText(/LINE内のブラウザでは、Google でログインできません/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'ブラウザで開く' }) as HTMLAnchorElement
    expect(new URL(link.href).searchParams.get('openExternalBrowser')).toBe('1')
    // メールアドレスとパスワードでのログインは、このまま使える
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeTruthy()
  })
  it('signs a mock user in with the mock Google account', async () => {
    const h = harness()
    const users: (string | undefined)[] = []
    h.repo.auth.onAuthStateChanged((u) => users.push(u?.email))
    await h.repo.auth.signInWithGoogle()
    expect(users.at(-1)).toBe('google-user@example.com')
  })
})

// #33：パスワードの表示・非表示の切り替え
describe('password visibility toggle (#33)', () => {
  it('switches the field type without submitting the form or moving the focus and cursor', async () => {
    const h = harness()
    const signIn = vi.spyOn(h.repo.auth, 'signIn')
    const user = userEvent.setup()
    render(<LoginScreen onSignUp={() => {}} />, { wrapper: h.wrapper })
    const field = screen.getByLabelText('パスワード') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.autocomplete).toBe('current-password')
    await user.type(field, 'Abcd#123')
    field.setSelectionRange(1, 3, 'backward')
    // 名前は固定し、表示中かどうかは aria-pressed で伝える
    const toggle = screen.getByRole('button', { name: 'パスワードを表示' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await user.click(toggle)
    expect(field.type).toBe('text')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(field.value).toBe('Abcd#123')
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([1, 3, 'backward'])
    expect(field.getAttribute('autocapitalize')).toBe('none')
    expect(field.autocomplete).toBe('current-password')
    expect(signIn).not.toHaveBeenCalled()
    await user.click(toggle)
    expect(field.type).toBe('password')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })
  it('hides the password again when the form is submitted', async () => {
    const h = harness()
    vi.spyOn(h.repo.auth, 'signIn').mockRejectedValue(new Error('failed'))
    const user = userEvent.setup()
    render(<LoginScreen onSignUp={() => {}} />, { wrapper: h.wrapper })
    await user.type(screen.getByLabelText('メールアドレス'), 'admin@example.com')
    const field = screen.getByLabelText('パスワード') as HTMLInputElement
    await user.type(field, 'Abcd#123')
    await user.click(screen.getByRole('button', { name: 'パスワードを表示' }))
    expect(field.type).toBe('text')
    // 表示のまま送るとパスワード管理機能が保存を提案しないことがあり、失敗時も見えたままになるため
    await user.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(field.type).toBe('password')
    expect(screen.getByRole('button', { name: 'パスワードを表示' }).getAttribute('aria-pressed')).toBe('false')
  })
  it('is available on the sign-up screen with the new-password autocomplete', () => {
    const h = harness()
    render(<SignUpScreen onLogin={() => {}} />, { wrapper: h.wrapper })
    const field = screen.getByLabelText('パスワード') as HTMLInputElement
    expect(field.autocomplete).toBe('new-password')
    expect(screen.getByRole('button', { name: 'パスワードを表示' })).toBeTruthy()
  })
})

// #59：チームの切り替えはヘッダーのチーム名の位置で行い、追加は設定タブから行う
describe('team switching in the header (#59)', () => {
  it('shows only the name with one team, a selector with two, and opens team entry from the settings tab', async () => {
    const h = harness()
    const user = userEvent.setup()
    await h.repo.auth.signIn('admin@example.com', 'Bukatsu#2026')
    render(<App />, { wrapper: h.wrapper })
    const header = await screen.findByRole('banner')
    expect(await within(header).findByRole('heading', { name: 'サンプルチーム' })).toBeTruthy()
    // 上の段（「表示するチーム」の見出しと「チームを追加」）はない
    expect(screen.queryByText('表示するチーム')).toBeNull()
    expect(screen.queryByRole('button', { name: 'チームを追加' })).toBeNull()
    expect(within(header).queryByRole('combobox')).toBeNull()
    expect(within(header).getByRole('button', { name: '最新の情報に更新' })).toBeTruthy()

    // 2チーム目に参加すると、チーム名の位置が選択欄になる（チームが変わるとヘッダーは作り直される）
    await act(() => h.repo.teams.create('第二チーム', '山田'))
    const currentSelect = () => within(screen.getByRole('banner')).getByRole('combobox', { name: '表示するチーム' }) as HTMLSelectElement
    await waitFor(() => expect(currentSelect().selectedOptions[0].text).toBe('第二チーム'))
    expect([...currentSelect().options].map((o) => o.text)).toEqual(expect.arrayContaining(['サンプルチーム', '第二チーム']))
    expect(screen.queryByText('表示するチーム')).toBeNull()
    await user.selectOptions(currentSelect(), 'サンプルチーム')
    await waitFor(() =>
      expect((within(screen.getByRole('banner')).getByRole('combobox') as HTMLSelectElement).selectedOptions[0].text).toBe('サンプルチーム'),
    )
    // 再取得ボタンは選択欄と同じ段の右端に残る
    expect(within(screen.getByRole('banner')).getByRole('button', { name: '最新の情報に更新' })).toBeTruthy()

    // チームの追加は設定タブから。2チーム以上なら、切り替えの案内も出す
    await user.click(screen.getByRole('button', { name: '設定' }))
    await user.click(await screen.findByRole('button', { name: 'チームを追加' }))
    expect(await screen.findByRole('heading', { name: /さん、ようこそ/ })).toBeTruthy()
    // 「戻る」で、開いていた設定タブに戻る
    await user.click(screen.getByRole('button', { name: '戻る' }))
    expect((await screen.findByRole('button', { name: '設定' })).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText(/画面上部のチーム名から切り替えられます/)).toBeTruthy()
  })
  it('does not offer switching in settings or the header when the list lacks the current team', async () => {
    const h = harness()
    await h.repo.auth.signIn('admin@example.com', 'Bukatsu#2026')
    // 参加・作成の直後で、所属の一覧の読み込みが表示中のチームに追いついていない状態
    vi.spyOn(h.repo.teams, 'subscribeMine').mockImplementation((cb) => {
      cb([
        { id: 'other-1', name: '別チーム1' },
        { id: 'other-2', name: '別チーム2' },
      ] as never)
      return () => {}
    })
    render(<App />, { wrapper: h.wrapper })
    const header = await screen.findByRole('banner')
    expect(await within(header).findByRole('heading', { name: 'サンプルチーム' })).toBeTruthy()
    expect(within(header).queryByRole('combobox')).toBeNull()
  })
  it('lets users switch or add teams from the screen shown when the team cannot be loaded', async () => {
    const h = harness()
    const user = userEvent.setup()
    await h.repo.auth.signIn('admin@example.com', 'Bukatsu#2026')
    await h.repo.teams.create('第二チーム', '山田')
    const realMembers = h.repo.teams.subscribeMembers.bind(h.repo.teams)
    // 表示中のチームのメンバーを読み込めない（自分が含まれない）と、読み込めない画面になる
    vi.spyOn(h.repo.teams, 'subscribeMembers').mockImplementation((teamId, cb) =>
      teamId === 'team-sample' ? realMembers(teamId, cb) : (cb([]), () => {}),
    )
    render(<App />, { wrapper: h.wrapper })
    expect(await screen.findByRole('heading', { name: 'データを読み込めませんでした' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'チームを追加' })).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: '表示するチーム' }), 'サンプルチーム')
    expect(await within(await screen.findByRole('banner')).findByRole('combobox', { name: '表示するチーム' })).toBeTruthy()
  })
})
