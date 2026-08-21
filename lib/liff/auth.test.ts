// lib/liff/auth.test.ts
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLiffParticipant } from './auth'

vi.mock('../db/liffApps', () => ({
  loadLiffAppByLiffId: vi.fn(),
  verifyLiffApiKey: vi.fn(),
}))
vi.mock('../line/liffVerify', () => ({ verifyLiffIdToken: vi.fn() }))
vi.mock('../db/participants', () => ({ ensureParticipantByChannelId: vi.fn() }))

const { loadLiffAppByLiffId, verifyLiffApiKey } = await import('../db/liffApps')
const { verifyLiffIdToken } = await import('../line/liffVerify')
const { ensureParticipantByChannelId } = await import('../db/participants')

const liffApp = {
  id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
  channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
}

const sql = {} as never

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('resolveLiffParticipant · id_token path', () => {
  it('verifies the token, ensures the participant, and returns it', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffIdToken).mockResolvedValue({ ok: true, lineUserId: 'U-player' })
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-1')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer id-token-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({ ok: true, participantId: 'participant-1', liffApp })
    expect(verifyLiffIdToken).toHaveBeenCalledWith('id-token-xyz', '2011037337')
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-player')
  })

  it('401s when LINE rejects the id_token', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffIdToken).mockResolvedValue({ ok: false, reason: 'หมดอายุ' })

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer stale' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({ ok: false, status: 401, reason: 'หมดอายุ' })
    expect(ensureParticipantByChannelId).not.toHaveBeenCalled()
  })
})

describe('resolveLiffParticipant · API key path', () => {
  it('verifies the key against this liff_app and uses the lineUserId from the body', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-2')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer api-key-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-from-server' })

    expect(result).toEqual({ ok: true, participantId: 'participant-2', liffApp })
    expect(verifyLiffApiKey).toHaveBeenCalledWith(sql, 'app-1', 'api-key-xyz')
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-from-server')
  })

  it('401s when the api key does not match', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(false)

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer wrong-key' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-from-server' })

    expect(result).toEqual({ ok: false, status: 401, reason: 'API key ไม่ถูกต้อง' })
  })

  it('401s when the api key path is used but no lineUserId was given in the body', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer api-key-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({
      ok: false, status: 401,
      reason: 'เรียกด้วย API key ต้องระบุ lineUserId มาใน header X-Line-User-Id (หรือ body) ด้วย — ไม่มีบริบทเบราว์เซอร์ให้เดาตัวตนได้',
    })
  })

  it('reads lineUserId from the X-Line-User-Id header with no body argument at all — the GET path', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-4')

    const request = new Request('https://example.com', {
      headers: { Authorization: 'Bearer api-key-xyz', 'X-Line-User-Id': 'U-from-header' },
    })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({ ok: true, participantId: 'participant-4', liffApp })
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-from-header')
  })

  it('prefers the header over the body when both are present', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-5')

    const request = new Request('https://example.com', {
      headers: { Authorization: 'Bearer api-key-xyz', 'X-Line-User-Id': 'U-from-header' },
    })
    const result = await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-from-body' })

    expect(result).toEqual({ ok: true, participantId: 'participant-5', liffApp })
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-from-header')
  })

  it('picks the API key path over id_token when the key matches — a token verify is never attempted', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-3')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer some-bearer-value' } })
    await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-x' })

    expect(verifyLiffIdToken).not.toHaveBeenCalled()
  })
})

describe('resolveLiffParticipant · shared failure modes', () => {
  it('404s when liffId has no registered liff_app', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(null)
    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer x' } })
    const result = await resolveLiffParticipant(sql, 'unknown-liff', request)
    expect(result).toEqual({ ok: false, status: 404, reason: 'ไม่พบ LIFF นี้ในระบบ' })
  })

  it('401s when there is no Authorization header at all', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    const request = new Request('https://example.com')
    const result = await resolveLiffParticipant(sql, 'liff-1', request)
    expect(result).toEqual({ ok: false, status: 401, reason: 'ไม่มี Authorization header' })
  })
})
