// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProfile, isFriend, isInClient } from './client'

describe('isInClient', () => {
  const originalUA = window.navigator.userAgent

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUA, configurable: true })
  })

  it('returns true when the user agent identifies the LINE in-app browser', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 Line/11.0.0', configurable: true })
    expect(isInClient()).toBe(true)
  })

  it('returns false for a regular browser user agent', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh) Chrome/120.0', configurable: true })
    expect(isInClient()).toBe(false)
  })
})

describe('getProfile (dev stub)', () => {
  it('resolves a placeholder profile — replace with a real liff.getProfile() call before deploying', async () => {
    const profile = await getProfile()
    expect(profile).not.toBeNull()
    expect(typeof profile?.displayName).toBe('string')
  })
})

describe('isFriend (dev stub)', () => {
  it('resolves true — replace with a real friendship check before deploying duo/group flows', async () => {
    expect(await isFriend()).toBe(true)
  })
})
