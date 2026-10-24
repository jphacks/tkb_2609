import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    env: { VITE_DATA_BACKEND: 'mock', VITE_USE_EMULATOR: 'true' },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
