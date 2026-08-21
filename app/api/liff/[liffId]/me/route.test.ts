import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/liff/auth', () => ({ resolveLiffParticipant: vi.fn() }))

const { resolveLiffParticipant } = await import('@/lib/liff/auth')
const { GET, OPTIONS } = await import('./route')

describe('GET /api/liff/[liffId]/me', () => {
  it('returns participantId and the LINE userId is not re-derivable from it (opaque id only)', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({
      ok: true, participantId: 'participant-1',
      liffApp: {
        id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
        channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
      },
    })
    const request = new Request('https://example.com/api/liff/liff-1/me', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ participantId: 'participant-1' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('passes through the auth failure status and reason', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({ ok: false, status: 401, reason: 'หมดอายุ' })
    const request = new Request('https://example.com/api/liff/liff-1/me', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'หมดอายุ' })
  })

  it('OPTIONS answers preflight', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
  })
})
