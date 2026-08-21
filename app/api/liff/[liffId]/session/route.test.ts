import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/liff/auth', () => ({ resolveLiffParticipant: vi.fn() }))
vi.mock('@/lib/db/liffSessions', () => ({
  listLiffSessionsForParticipant: vi.fn(),
  findLiffSessionByKey: vi.fn(),
  upsertLiffSession: vi.fn(),
}))

const { resolveLiffParticipant } = await import('@/lib/liff/auth')
const { listLiffSessionsForParticipant, findLiffSessionByKey, upsertLiffSession } =
  await import('@/lib/db/liffSessions')
const { GET, PUT } = await import('./route')

beforeEach(() => { vi.clearAllMocks() })

const liffApp = {
  id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
  channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
}
const okAuth = { ok: true as const, participantId: 'participant-1', liffApp }

describe('GET /api/liff/[liffId]/session', () => {
  it('without ?key — returns every row for the resolved participant', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(listLiffSessionsForParticipant).mockResolvedValue([
      { id: 's1', liffAppId: 'app-1', participantId: 'participant-1', externalKey: null, data: { a: 1 }, createdAt: new Date(), updatedAt: new Date() },
    ])
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(1)
    expect(listLiffSessionsForParticipant).toHaveBeenCalledWith({}, 'app-1', 'participant-1')
  })

  it('with ?key — looks up by key, not by participant, and 404s when missing', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(findLiffSessionByKey).mockResolvedValue(null)
    const request = new Request('https://example.com/api/liff/liff-1/session?key=invite-xyz', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(404)
    expect(findLiffSessionByKey).toHaveBeenCalledWith({}, 'app-1', 'invite-xyz')
  })

  it('propagates a 401 from auth without touching the database', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({ ok: false, status: 401, reason: 'ไม่มี Authorization header' })
    const request = new Request('https://example.com/api/liff/liff-1/session')
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(401)
    expect(listLiffSessionsForParticipant).not.toHaveBeenCalled()
  })
})

describe('PUT /api/liff/[liffId]/session', () => {
  it('upserts using the resolved participant, ignoring any participantId the body might try to set', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(upsertLiffSession).mockResolvedValue({
      id: 's1', liffAppId: 'app-1', participantId: 'participant-1', externalKey: 'k1',
      data: { score: 5 }, createdAt: new Date(), updatedAt: new Date(),
    })
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      method: 'PUT',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalKey: 'k1', data: { score: 5 }, participantId: 'someone-elses-id' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    expect(upsertLiffSession).toHaveBeenCalledWith({}, {
      liffAppId: 'app-1', participantId: 'participant-1', externalKey: 'k1', data: { score: 5 },
    })
  })

  it('rejects a body with no data field', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      method: 'PUT',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalKey: 'k1' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(400)
    expect(upsertLiffSession).not.toHaveBeenCalled()
  })
})
