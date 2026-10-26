import { afterEach, describe, expect, it, vi } from 'vitest'
import { localJson, SCALE_PROJECT, scaleEndpoints, seedScale, writeScaleDocuments } from '../scripts/seed-scale'
afterEach(() => vi.unstubAllEnvs())
describe('scale fixture emulator safeguards', () => {
  it('rejects non-loopback emulator hosts before any network call', () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443')
    expect(scaleEndpoints).toThrow('Loopback')
  })
  it('does not accept a production project even with a loopback host', async () => {
    await expect(writeScaleDocuments([], { projectId: 'production', firestoreHost: '127.0.0.1:18080', authHost: '127.0.0.1:19099' })).rejects.toThrow('demo project')
    await expect(localJson('https://firestore.googleapis.com/v1/projects/production')).rejects.toThrow('Loopback')
    expect(SCALE_PROJECT.startsWith('demo-')).toBe(true)
  })
  it('validates fixture bounds before creating accounts or writing documents', async () => {
    await expect(seedScale({ members: 101, events: 500, notesPerEvent: 200, equipment: 300 })).rejects.toThrow('Fixture limits')
    await expect(seedScale({ members: 2, events: 1, notesPerEvent: -1, equipment: 0 })).rejects.toThrow('Invalid')
  })
})
