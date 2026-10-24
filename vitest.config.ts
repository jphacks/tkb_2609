import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    env: { VITE_DATA_BACKEND: 'mock', VITE_USE_FIREBASE_EMULATORS: 'true' },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
