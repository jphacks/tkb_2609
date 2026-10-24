// PR #18の公開API。Repositoryと同じクライアントを共有し、二重初期化しない。
import { createFirebaseClient, isUsingEmulators } from './client'
const client = createFirebaseClient()
export const app = client.auth.app
export const auth = client.auth
export const db = client.db
export const useEmulator = isUsingEmulators()
