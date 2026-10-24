import { describe, expect, it } from 'vitest'
import { firebaseOptions } from '../src/data/firebase/config'
const real = {
  VITE_FIREBASE_PROJECT_ID: 'example-project',
  VITE_FIREBASE_API_KEY: 'example-public-key',
  VITE_FIREBASE_APP_ID: 'example-app',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.invalid',
}
describe('Firebase connection boundary', () => {
  it.each([
    { VITE_USE_EMULATOR: 'true', VITE_USE_FIREBASE_EMULATORS: 'false' },
    { VITE_USE_EMULATOR: 'false', VITE_USE_FIREBASE_EMULATORS: 'true' },
  ])('keeps mixed old/new environment settings on the emulator: %j', (flags) => {
    const { emulate, options } = firebaseOptions({ ...real, ...flags })
    expect(emulate).toBe(true)
    expect(options.projectId).toBe('demo-bukatsu')
    expect(options.apiKey).not.toBe(real.VITE_FIREBASE_API_KEY)
  })
  it('uses the configured project only when emulator flags are off and all required settings exist', () => {
    const { emulate, options } = firebaseOptions({
      ...real,
      VITE_USE_EMULATOR: 'false',
      VITE_USE_FIREBASE_EMULATORS: 'false',
    })
    expect(emulate).toBe(false)
    expect(options.projectId).toBe('example-project')
    expect(() => firebaseOptions({ VITE_USE_EMULATOR: 'false' })).toThrow('設定が不足')
  })
})
