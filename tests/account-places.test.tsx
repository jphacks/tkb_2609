// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepositoryContext, SessionContext, type Session } from '../src/app/contexts'
import { FeedbackContext, type Feedback } from '../src/components/feedback/context'
import { createMockRepository } from '../src/data/mock/mockRepository'
import { AccountSettings } from '../src/features/settings/AccountSettings'
import { PlacesSection } from '../src/features/settings/PlacesSection'
import { EventForm } from '../src/features/schedule/EventForm'
import type { UserProfile } from '../src/types'
const account = { uid: 'u-member', email: 'member@example.com', emailVerified: true, providers: ['password'] }
const profile: UserProfile = { uid: account.uid, displayName: 'アカウント名', teamIds: ['team-sample'], teamId: 'team-sample' }
function setup() {
  const repo = createMockRepository()
  const feedback: Feedback = { confirm: vi.fn(async () => true), toast: vi.fn(), run: vi.fn(async (action) => { try { await action(); return true } catch { return false } }) }
  const session: Session = {
    user: account, profile,
    team: { id: 'team-sample', name: 'チーム', createdBy: 'u-admin', createdAt: new Date(), settings: { eventEditPolicy: 'all', eventTypes: [{ id: 'practice', label: '活動', color: '#2563eb' }], places: ['会議室', 'ホール'] } },
    members: [], me: { uid: account.uid, displayName: 'チーム名', role: 'admin', joinedAt: new Date() }, isAdmin: true, canEditEvents: true,
  }
  function Wrapper({ children }: { children: ReactNode }) { return <RepositoryContext.Provider value={repo}><FeedbackContext.Provider value={feedback}><SessionContext.Provider value={session}>{children}</SessionContext.Provider></FeedbackContext.Provider></RepositoryContext.Provider> }
  return { repo, feedback, session, Wrapper }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
describe('account settings', () => {
  it('sends password reset to the signed-in address and changes the account name separately', async () => {
    const h = setup(), user = userEvent.setup()
    const reset = vi.spyOn(h.repo.auth, 'sendPasswordReset').mockResolvedValue()
    const name = vi.spyOn(h.repo.users, 'updateAccountName').mockResolvedValue()
    render(<AccountSettings user={account} profile={profile} onBack={() => {}} />, { wrapper: h.Wrapper })
    await user.click(screen.getByRole('button', { name: '再設定メールを送る' }))
    expect(reset).toHaveBeenCalledWith(account.email)
    await user.clear(screen.getByLabelText('アカウント名'))
    await user.type(screen.getByLabelText('アカウント名'), '新しい名前')
    await user.click(screen.getByRole('button', { name: 'アカウント名を保存' }))
    expect(name).toHaveBeenCalledWith('新しい名前')
    expect(screen.getByText(/各チームでの名前/)).toBeTruthy()
  })
  it('requires two steps, typed confirmation and reauthentication before deleting', async () => {
    const h = setup(), user = userEvent.setup()
    const remove = vi.spyOn(h.repo.auth, 'deleteAccount').mockResolvedValue()
    render(<AccountSettings user={account} profile={profile} />, { wrapper: h.Wrapper })
    await user.click(screen.getByRole('button', { name: 'アカウントを削除' }))
    expect(h.feedback.confirm).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    const final = screen.getByRole('button', { name: '本人確認してアカウントを削除' }) as HTMLButtonElement
    expect(final.disabled).toBe(true)
    await user.type(screen.getByLabelText('確認のため「削除」と入力'), '削除')
    expect(final.disabled).toBe(true)
    await user.type(screen.getByLabelText('現在のパスワード'), 'Example123!')
    await user.click(final)
    expect(remove).toHaveBeenCalledWith({ confirmation: '削除', password: 'Example123!' })
  })
  it('lets an interrupted deletion resume without a profile', async () => {
    const h = setup(), user = userEvent.setup()
    const remove = vi.spyOn(h.repo.auth, 'deleteAccount').mockResolvedValue()
    render(<AccountSettings user={account} profile={null} />, { wrapper: h.Wrapper })
    expect(screen.getByRole('status').textContent).toContain('削除の途中')
    await user.click(screen.getByRole('button', { name: 'アカウントを削除' }))
    await user.type(screen.getByLabelText('確認のため「削除」と入力'), '削除')
    await user.type(screen.getByLabelText('現在のパスワード'), 'Example123!')
    await user.click(screen.getByRole('button', { name: '本人確認してアカウントを削除' }))
    expect(remove).toHaveBeenCalledOnce()
  })
  it('mock deletion releases equipment, deletes the account, and blocks last admin deletion', async () => {
    const h = setup()
    await h.repo.auth.signIn(account.email, 'Bukatsu#2026')
    const own = await h.repo.teams.create('新しいチーム', '名前')
    await expect(h.repo.auth.deleteAccount({ confirmation: '削除', password: 'Bukatsu#2026' })).rejects.toThrow('最後の管理者')
    await h.repo.teams.remove(own)
    await h.repo.auth.deleteAccount({ confirmation: '削除', password: 'Bukatsu#2026' })
    await expect(h.repo.auth.signIn(account.email, 'Bukatsu#2026')).rejects.toThrow()
  })
})
describe('saved places', () => {
  it('reorders and saves places without changing event text', async () => {
    const h = setup(), user = userEvent.setup()
    const update = vi.spyOn(h.repo.teams, 'updateSettings').mockResolvedValue()
    render(<PlacesSection />, { wrapper: h.Wrapper })
    await user.click(screen.getByRole('button', { name: '場所 2を上へ' }))
    await user.click(screen.getByRole('button', { name: '場所を保存' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('team-sample', { places: ['ホール', '会議室'] }))
  })
  it('selects a saved place and still accepts a custom place', async () => {
    const h = setup(), user = userEvent.setup()
    render(<EventForm onDone={() => {}} />, { wrapper: h.Wrapper })
    await user.selectOptions(screen.getByLabelText('よく使う場所から選ぶ'), 'ホール')
    const input = screen.getByLabelText('場所（任意）') as HTMLInputElement
    expect(input.value).toBe('ホール')
    await user.clear(input); await user.type(input, '別の場所')
    expect(input.value).toBe('別の場所')
  })
})
