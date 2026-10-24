import type { Repository } from './repository'

const backend = import.meta.env.VITE_DATA_BACKEND || 'mock'
export const isMock = backend === 'mock'
let selected: Repository | null = null
let reset: () => void = () => {}
let error: string | null = null
try {
  if (backend === 'mock') {
    const { createMockRepository } = await import('./mock/mockRepository')
    const mock = createMockRepository()
    selected = mock
    reset = () => mock.reset()
  } else if (backend === 'firebase') {
    const [{ auth, db }, { createFirestoreRepository }] = await Promise.all([
      import('./firebase/app'),
      import('./firebase/firestoreRepository'),
    ])
    selected = createFirestoreRepository(auth, db)
  } else {
    throw new Error('VITE_DATA_BACKEND は mock または firebase を指定してください。')
  }
} catch (cause) {
  error = cause instanceof Error ? cause.message : 'データ接続を初期化できませんでした。'
}
export const repository = selected
export const initializationError = error
export const resetMockData = () => reset()
