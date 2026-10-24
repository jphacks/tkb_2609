// Google は、アプリ内ブラウザ（LINE・Instagram・Facebook など）からのログインをブロックする（403: disallowed_useragent）。
// その場合は Google ログインのボタンの代わりに、外部ブラウザで開くよう案内する（Issue #31）

export type InAppBrowser = 'line' | 'other'

/** Google ログインを使えないアプリ内ブラウザか。LINE は外部ブラウザで開き直すリンクを出せるため区別する */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (/\bLine\//i.test(userAgent)) return 'line'
  if (/FBAN|FBAV|Instagram|BytedanceWebview|musical_ly/i.test(userAgent)) return 'other'
  return null
}

/** LINE で開くと外部ブラウザ（Safari など）が起動する URL。`openExternalBrowser=1` は LINE の仕様 */
export function externalBrowserUrl(href: string): string {
  const url = new URL(href)
  url.searchParams.set('openExternalBrowser', '1')
  return url.toString()
}
