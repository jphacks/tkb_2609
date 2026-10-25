// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { RepositoryContext } from '../src/app/contexts'
import { RefreshProvider } from '../src/app/RefreshProvider'
import { FeedbackContext, type Feedback } from '../src/components/feedback/context'
import { createMockRepository } from '../src/data/mock/mockRepository'
import { MOCK_ACCOUNTS, MOCK_PASSWORD } from '../src/data/mock/seed'

vi.mock('../src/data', () => ({ isMock: false, resetMockData: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function harness() {
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
        <RefreshProvider>
          <FeedbackContext.Provider value={feedback}>{children}</FeedbackContext.Provider>
        </RefreshProvider>
      </RepositoryContext.Provider>
    )
  }
  return { repo, feedback, wrapper: Wrapper }
}

// #73：未ログイン時は最初にアプリの紹介ページを表示し、新規登録・ログインと相互に行き来できる
describe('landing page before sign-in (#73)', () => {
  it('shows the landing page first when signed out without reading user or team data', async () => {
    const h = harness()
    const subscribeProfile = vi.spyOn(h.repo.users, 'subscribeProfile')
    const subscribeMine = vi.spyOn(h.repo.teams, 'subscribeMine')

    render(<App />, { wrapper: h.wrapper })

    expect(
      await screen.findByRole('heading', { name: '予定と出欠、用具の所在を、チームでひとつに。' }),
    ).toBeTruthy()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'BUKATSU トップへ戻る' })).toBeTruthy()
    const nav = within(banner).getByRole('navigation', { name: 'ページ内メニュー' })
    expect(within(nav).getByRole('link', { name: '機能' }).getAttribute('href')).toBe('#features')
    expect(within(nav).getByRole('link', { name: '使い方' }).getAttribute('href')).toBe('#how-to-use')
    expect(within(nav).getByRole('link', { name: 'よくある質問' }).getAttribute('href')).toBe('#faq')
    expect(screen.getByRole('link', { name: 'コンテンツへスキップ' }).getAttribute('href')).toBe('#main-content')

    expect(subscribeProfile).not.toHaveBeenCalled()
    expect(subscribeMine).not.toHaveBeenCalled()
  })

  it('navigates to sign-up via 無料ではじめる and returns to the landing page', async () => {
    const h = harness()
    const user = userEvent.setup()

    render(<App />, { wrapper: h.wrapper })

    const signUpButtons = await screen.findAllByRole('button', { name: '無料ではじめる' })
    await user.click(signUpButtons[0])

    expect(screen.getByRole('heading', { name: 'アカウントを作成' })).toBeTruthy()
    expect(screen.getByLabelText('名前')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'トップへ戻る' }))
    expect(
      screen.getByRole('heading', { name: '予定と出欠、用具の所在を、チームでひとつに。' }),
    ).toBeTruthy()
  })

  it('navigates to login from both header and hero buttons, switches to sign-up, and returns to the landing page', async () => {
    const h = harness()
    const user = userEvent.setup()

    render(<App />, { wrapper: h.wrapper })

    const banner = await screen.findByRole('banner')
    await user.click(within(banner).getByRole('button', { name: 'ログイン' }))

    expect(screen.getByLabelText('メールアドレス')).toBeTruthy()
    expect(screen.getByLabelText('パスワード')).toBeTruthy()

    // ログイン画面から「アカウントを作成」へ進み、そこからトップへ戻れる
    await user.click(screen.getByRole('button', { name: 'アカウントを作成' }))
    expect(screen.getByRole('heading', { name: 'アカウントを作成' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'トップへ戻る' }))
    expect(
      screen.getByRole('heading', { name: '予定と出欠、用具の所在を、チームでひとつに。' }),
    ).toBeTruthy()

    // ページ本文の「ログイン」ボタンからもログイン画面へ進み、「トップへ戻る」で戻れる
    const loginButtons = screen.getAllByRole('button', { name: 'ログイン' })
    await user.click(loginButtons[1])
    expect(screen.getByLabelText('メールアドレス')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'トップへ戻る' }))
    expect(
      screen.getByRole('heading', { name: '予定と出欠、用具の所在を、チームでひとつに。' }),
    ).toBeTruthy()
  })

  it('skips the landing page when the user is already signed in', async () => {
    const h = harness()
    await h.repo.auth.signIn(MOCK_ACCOUNTS[0].email, MOCK_PASSWORD)

    render(<App />, { wrapper: h.wrapper })

    expect(await screen.findByRole('heading', { name: 'サンプルチーム' })).toBeTruthy()
    expect(
      screen.queryByRole('heading', { name: '予定と出欠、用具の所在を、チームでひとつに。' }),
    ).toBeNull()
  })
})
