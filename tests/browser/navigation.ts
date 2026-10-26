/** VITE_DATA_BACKEND=mockで起動し、各サイズで予定詳細を手動操作する。 */
if (!['127.0.0.1', 'localhost'].includes(location.hostname) || import.meta.env.VITE_DATA_BACKEND !== 'mock') {
  throw new Error('Local mock server only')
}
const frame = document.getElementById('app') as HTMLIFrameElement
const metrics = document.getElementById('metrics')!
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-width]')) {
  button.addEventListener('click', () => {
    frame.style.width = `${button.dataset.width}px`
    frame.style.height = `${button.dataset.height}px`
  })
}
frame.addEventListener('load', () => frame.contentDocument?.documentElement.style.setProperty('--safe-bottom', '34px'))
frame.src = '/'
setInterval(() => {
  const document = frame.contentDocument
  const nav = document?.querySelector('nav[aria-label="メインメニュー"]')
  const heading = [...document?.querySelectorAll('h1') ?? []].find((h) => /予定の詳細|予定を追加|予定を編集/.test(h.textContent ?? ''))
  const panel = heading?.closest('header')?.parentElement
  const backdrop = panel?.parentElement
  if (!nav || !panel || !backdrop) {
    metrics.textContent = '予定の詳細・作成・編集を開いてください。モック専用、下端34pxを模擬。実機未確認。'
    return
  }
  const n = nav.getBoundingClientRect(), b = backdrop.getBoundingClientRect()
  const overlap = Math.max(0, Math.min(n.right, b.right) - Math.max(n.left, b.left)) * Math.max(0, Math.min(n.bottom, b.bottom) - Math.max(n.top, b.top))
  metrics.textContent = JSON.stringify({
    viewport: [frame.contentWindow?.innerWidth, frame.contentWindow?.innerHeight],
    nav: [n.x, n.y, n.width, n.height], overlay: [b.x, b.y, b.width, b.height], overlap,
    selected: nav.querySelector('[aria-current="page"]')?.textContent?.trim(),
    scroll: [panel.scrollTop, panel.scrollHeight, panel.clientHeight],
  }) + '\nsafe-bottom=34px模擬、実機未確認'
}, 500)
export {}
