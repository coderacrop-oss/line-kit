import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionRole: 'configurator' | 'content_editor' | null = 'configurator'

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => (sessionRole ? { userId: 'u1', role: sessionRole } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/liffApps', () => ({ createLiffApp: vi.fn() }))

const { createLiffApp } = await import('@/lib/db/liffApps')
const { createLiffAppAction } = await import('./actions')

beforeEach(() => { sessionRole = 'configurator' })
afterEach(() => { vi.clearAllMocks() })

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('createLiffAppAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await createLiffAppAction(formData({
      name: 'x', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1', api_key: 'k',
    }))
    expect(result.ok).toBe(false)
    expect(createLiffApp).not.toHaveBeenCalled()
  })

  it('rejects a missing required field with a specific message, not a generic one', async () => {
    const result = await createLiffAppAction(formData({
      name: '', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1', api_key: 'k',
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('ชื่อ')
  })

  it('creates the app and returns ok:true on valid input', async () => {
    vi.mocked(createLiffApp).mockResolvedValue({
      id: 'app-1', name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKeyLast4: 'abcd', createdAt: new Date(),
    })
    const result = await createLiffAppAction(formData({
      name: 'ทดสอบ', liff_id: 'liff-1', line_login_channel_id: '2011037337', channel_id: 'c1', api_key: 'sk_abc',
    }))
    expect(result).toEqual({ ok: true })
    expect(createLiffApp).toHaveBeenCalledWith({}, {
      name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKey: 'sk_abc', createdBy: 'u1',
    })
  })
})
