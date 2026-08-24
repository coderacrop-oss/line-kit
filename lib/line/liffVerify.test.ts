import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyLiffIdToken } from './liffVerify'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('verifyLiffIdToken', () => {
  it('posts to LINE\'s verify endpoint with the token and the LINE Login channel id as client_id', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '2011037337' }),
    })

    await verifyLiffIdToken('id-token-abc', '2011037337')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/oauth2/v2.1/verify')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(init.body)
    expect(body.get('id_token')).toBe('id-token-abc')
    expect(body.get('client_id')).toBe('2011037337')
  })

  it('returns ok:true with the LINE userId when LINE accepts the token', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '2011037337' }),
    })
    const result = await verifyLiffIdToken('id-token-abc', '2011037337')
    expect(result).toEqual({ ok: true, lineUserId: 'U1234567890abcdef1234567890abcdef' })
  })

  it('returns ok:false when LINE rejects the token (expired/invalid)', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_request', error_description: 'IdToken expired' }),
    })
    const result = await verifyLiffIdToken('stale-token', '2011037337')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('expired')
  })

  it('rejects when the token\'s audience does not match the given LINE Login channel id', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '9999999999' }),
    })
    const result = await verifyLiffIdToken('id-token-abc', '2011037337')
    expect(result).toEqual({ ok: false, reason: 'audience ของ id_token ไม่ตรงกับ LINE Login channel ที่ลงทะเบียนไว้' })
  })

  it('passes an abort signal so a stalled LINE API call cannot hang forever', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sub: 'U1', aud: '2011037337' }) })
    await verifyLiffIdToken('id-token-abc', '2011037337')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns ok:false when fetch rejects (timeout/network failure)', async () => {
    fetchMock.mockRejectedValue(new Error('The operation timed out'))
    const result = await verifyLiffIdToken('id-token-abc', '2011037337')
    expect(result).toEqual({ ok: false, reason: 'เชื่อมต่อ LINE ไม่ได้: The operation timed out' })
  })
})
