/** ローカルの架空データだけで実際のAppを操作する。製品ビルドには含まない。 */
import '../../src/index.css'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { App } from '../../src/app/App'
import { RepositoryContext } from '../../src/app/contexts'
import { RefreshProvider } from '../../src/app/RefreshProvider'
import { FeedbackProvider } from '../../src/components/feedback/FeedbackProvider'
import { createFirestoreRepository } from '../../src/data/firebase/firestoreRepository'
import type { ScaleFixture } from '../../scripts/seed-scale'

async function main() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('localhost only')
  const preset = new URLSearchParams(location.search).get('preset') === 'demo' ? 'demo' : 'large'
  const response = await fetch(preset === 'demo' ? '/.scale-artifacts/browser-demo.json' : '/.scale-artifacts/browser.json')
  if (!response.ok) throw new Error('Run npm run scale:check first')
  const fixture = await response.json() as ScaleFixture
  if (fixture.projectId !== 'demo-bukatsu-scale' || !/^127\.0\.0\.1:\d+$/.test(fixture.authHost) || !/^127\.0\.0\.1:\d+$/.test(fixture.firestoreHost)) throw new Error('Only isolated demo emulators are allowed')
  const app = initializeApp({ projectId: fixture.projectId, apiKey: 'fake-api-key', appId: 'fake-scale-browser' }, `scale-browser-${preset}`)
  const auth = getAuth(app), db = getFirestore(app)
  const [host, port] = fixture.firestoreHost.split(':')
  connectAuthEmulator(auth, `http://${fixture.authHost}`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, Number(port))
  await signInWithEmailAndPassword(auth, fixture.admin.email, 'ScaleOnly123!')
  const repository = createFirestoreRepository(auth, db)
  const root = document.getElementById('root')!, metrics = document.getElementById('scale-metrics')!
  const phases: Record<string, { commits: number; maxCommitMs: number; totalReactMs: number; readyMs?: number; domNodes?: number }> = {}
  let phase = '初期表示', actionAt = performance.now(), lastFrame = performance.now(), maxFrameGap = 0
  function frame(now: number) {
    if (!document.hidden) maxFrameGap = Math.max(maxFrameGap, now - lastFrame)
    lastFrame = now; requestAnimationFrame(frame)
  }
  document.addEventListener('visibilitychange', () => { lastFrame = performance.now() })
  requestAnimationFrame(frame)
  root.addEventListener('click', (event) => {
    const target = event.target as Element
    const menu = target.closest('nav[aria-label="メインメニュー"] button')
    if (menu) { phase = menu.textContent?.trim() ?? 'タブ'; actionAt = performance.now(); phases[phase] = { commits: 0, maxCommitMs: 0, totalReactMs: 0 } }
  }, true)
  const onRender: ProfilerOnRenderCallback = (_id, _phase, duration) => {
    const item = phases[phase] ??= { commits: 0, maxCommitMs: 0, totalReactMs: 0 }
    item.commits++; item.maxCommitMs = Math.max(item.maxCommitMs, duration); item.totalReactMs += duration
    requestAnimationFrame(() => {
      if (root.querySelector('nav') && !root.querySelector('main [aria-busy="true"]')) { item.readyMs ??= performance.now() - actionAt; item.domNodes = root.querySelectorAll('*').length }
    })
  }
  setInterval(() => {
    const rows = Object.entries(phases).map(([name, p]) => `${name}: ready=${Math.round(p.readyMs ?? -1)}ms maxCommit=${Math.round(p.maxCommitMs)}ms DOM=${p.domNodes ?? 0}`)
    metrics.textContent = `大量データ検証（開発ビルド）\n予定${fixture.options.events} / 用具${fixture.options.equipment} / メンバー${fixture.options.members}\nメモ/予定${fixture.options.notesPerEvent}（${fixture.options.noteEvents ?? fixture.options.events}予定のみ）\n最大frame間隔 ${Math.round(maxFrameGap)}ms\n${rows.join('\n')}`
  }, 1000)

  createRoot(root).render(<Profiler id="scale-app" onRender={onRender}><RepositoryContext.Provider value={repository}><RefreshProvider><FeedbackProvider><App /></FeedbackProvider></RefreshProvider></RepositoryContext.Provider></Profiler>)
}
void main().catch((error: unknown) => { document.getElementById('scale-metrics')!.textContent = error instanceof Error ? error.message : '初期化に失敗しました' })
