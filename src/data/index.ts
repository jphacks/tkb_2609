// アプリ全体で使うリポジトリ。実装段階でここを Firestore 版に差し替える。
import { createMockRepository } from './mock/mockRepository'

const mock = createMockRepository()

export const repository = mock
export const isMock = true
export const resetMockData = () => mock.reset()
