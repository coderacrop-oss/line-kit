import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionRole: 'configurator' | 'content_editor' | null = 'configurator'

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => (sessionRole ? { userId: 'u1', role: sessionRole } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/liffApps', () => ({ updateLiffApp: vi.fn(), deleteLiffApp: vi.fn() }))

const { updateLiffApp, deleteLiffApp } = await import('@/lib/db/liffApps')
const { updateLiffAppAction, deleteLiffAppAction } = await import('./actions')

beforeEach(() => { sessionRole = 'configurator' })
afterEach(() => { vi.clearAllMocks() })

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('updateLiffAppAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await updateLiffAppAction('app-1', formData({
      name: 'x', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1',
    }))
    expect(result.ok).toBe(false)
    expect(updateLiffApp).not.toHaveBeenCalled()
  })

  it('rejects a missing required field with a specific message', async () => {
    const result = await updateLiffAppAction('app-1', formData({
      name: '', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1',
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('ชื่อ')
  })

  it('updates with apiKey: null when the api_key field is left blank (keep existing key)', async () => {
    vi.mocked(updateLiffApp).mockResolvedValue({
      id: 'app-1', name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKeyLast4: 'abcd', createdAt: new Date(),
    })
    const result = await updateLiffAppAction('app-1', formData({
      name: 'ทดสอบ', liff_id: 'liff-1', line_login_channel_id: '2011037337', channel_id: 'c1',
    }))
    expect(result).toEqual({ ok: true })
    expect(updateLiffApp).toHaveBeenCalledWith({}, 'app-1', {
      name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337', channelId: 'c1', apiKey: null,
    })
  })

  it('updates with the new apiKey when the field is filled in', async () => {
    vi.mocked(updateLiffApp).mockResolvedValue({
      id: 'app-1', name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKeyLast4: 'wxyz', createdAt: new Date(),
    })
    await updateLiffAppAction('app-1', formData({
      name: 'ทดสอบ', liff_id: 'liff-1', line_login_channel_id: '2011037337', channel_id: 'c1',
      api_key: 'new-key',
    }))
    expect(updateLiffApp).toHaveBeenCalledWith({}, 'app-1', {
      name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337', channelId: 'c1', apiKey: 'new-key',
    })
  })
})

describe('deleteLiffAppAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await deleteLiffAppAction('app-1')
    expect(result.ok).toBe(false)
    expect(deleteLiffApp).not.toHaveBeenCalled()
  })

  it('deletes and returns ok:true', async () => {
    vi.mocked(deleteLiffApp).mockResolvedValue(undefined)
    const result = await deleteLiffAppAction('app-1')
    expect(result).toEqual({ ok: true })
    expect(deleteLiffApp).toHaveBeenCalledWith({}, 'app-1')
  })
})
