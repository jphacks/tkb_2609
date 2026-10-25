// ログインしていないときに最初に表示する画面の判定（#87）。
// 一度ログインしたことがある人・チームのリンクから来た人はログイン画面、完全に新規の人は紹介ページから始める

/** この端末で一度ログインしたことがあるかの印。ブラウザごとに別（LINE 内ブラウザと Safari などは共有しない） */
const SIGNED_IN_BEFORE_KEY = 'bukatsu:signedInBefore'

/**
 * チームのリンクに付けるパラメーター。`openExternalBrowser` は LINE から外部ブラウザで開くための LINE の仕様（#56）。
 * 以前に送ったリンクは `openExternalBrowser` だけなので、そちらもチームのリンクとして扱う（#79）
 */
const SHARED_LINK_PARAMS = ['invite', 'openExternalBrowser']

/** 設定タブで共有するアプリのリンク */
export function sharedLinkUrl(origin: string): string {
  return `${origin}/?invite=1&openExternalBrowser=1`
}

export function initialAuthMode(href: string): 'landing' | 'login' {
  const params = new URL(href).searchParams
  if (SHARED_LINK_PARAMS.some((p) => params.has(p))) return 'login'
  return hasSignedInBefore() ? 'login' : 'landing'
}

/** 読み取ったパラメーターをアドレスバーから消す。URL をコピーして共有しても、ほかの人がログイン画面にならないように */
export function removeSharedLinkParams() {
  const url = new URL(location.href)
  if (!SHARED_LINK_PARAMS.some((p) => url.searchParams.has(p))) return
  SHARED_LINK_PARAMS.forEach((p) => url.searchParams.delete(p))
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

// localStorage はプライベートブラウズなどで使えないことがある。そのときは印なし（紹介ページ）として扱う
export function rememberSignedIn() {
  try {
    localStorage.setItem(SIGNED_IN_BEFORE_KEY, '1')
  } catch {
    // 保存できなくても、次回に紹介ページが出るだけ
  }
}

function hasSignedInBefore(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_BEFORE_KEY) === '1'
  } catch {
    return false
  }
}
