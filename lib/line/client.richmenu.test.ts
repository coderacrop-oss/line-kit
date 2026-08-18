import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRichMenu, linkRichMenuBatch, setRichMenuAlias, uploadRichMenuImage,
  validateRichMenuObject, type LineRichMenuPayload,
} from './client'

/**
 * ฟังก์ชันที่ต่อเข้า §4.4 ขั้น 4b · 5 · 5b · 5c — เทสต์เดียวกับที่ client.test.ts
 * ใช้อยู่แล้วสำหรับ replyMessage/pushMessage/setWebhookEndpoint แต่แยกไฟล์เพื่อให้
 * ตามรอย diff ของงาน M4-S01 ได้ง่าย
 */

const fetchMock = vi.fn()

function samplePayload(): LineRichMenuPayload {
  return {
    size: { width: 2500, height: 1686 },
    selected: false,
    name: 'main',
    chatBarText: 'เมนู',
    areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 1686 }, action: { type: 'uri', uri: 'https://x.example' } }],
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true, status: 200, text: async () => '{}', json: async () => ({ richMenuId: 'rm-1' }),
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('validateRichMenuObject · ขั้น 4b (BR-96)', () => {
  it('ยิงไป /v2/bot/richmenu/validate ด้วย POST พร้อมโครงเมนู', async () => {
    await validateRichMenuObject('token', samplePayload())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu/validate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(samplePayload())
    expect(init.headers.Authorization).toBe('Bearer token')
  })

  it('LINE ปฏิเสธ → โยน error พร้อมข้อความของ LINE ตรงๆ (ERR-044 ประกอบขึ้นที่ชั้นบน)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'areas out of bounds' })
    await expect(validateRichMenuObject('token', samplePayload()))
      .rejects.toThrow(/areas out of bounds/)
  })
})

describe('createRichMenu · ขั้น 5', () => {
  it('ยิงไป /v2/bot/richmenu ด้วย POST แล้วคืน richMenuId', async () => {
    const result = await createRichMenu('token', samplePayload())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu')
    expect(init.method).toBe('POST')
    expect(result).toEqual({ richMenuId: 'rm-1' })
  })

  it('LINE ปฏิเสธ → โยน error พร้อมรหัสสถานะ', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
    await expect(createRichMenu('token', samplePayload())).rejects.toThrow(/429/)
  })
})

describe('uploadRichMenuImage · ยิงไป api-data.line.me คนละโดเมนกับคำสั่งอื่น (L2 §5.2 v0.17)', () => {
  it('ยิงไปโดเมน api-data.line.me ไม่ใช่ api.line.me', async () => {
    await uploadRichMenuImage('token', 'rm-1', { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api-data.line.me/v2/bot/richmenu/rm-1/content')
    expect(init.headers['Content-Type']).toBe('image/png')
  })

  it('วาดไม่ครบ (LINE ปฏิเสธ) → โยน error ห้ามปล่อยผ่านเงียบๆ', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad image' })
    await expect(
      uploadRichMenuImage('token', 'rm-1', { bytes: new Uint8Array(), contentType: 'image/png' }),
    ).rejects.toThrow(/400/)
  })
})

describe('setRichMenuAlias · ขั้น 5b (BR-77)', () => {
  it('alias ใหม่ — สร้างด้วย POST /v2/bot/richmenu/alias เพียงครั้งเดียว', async () => {
    await setRichMenuAlias('token', { richMenuAliasId: 'tab-main', richMenuId: 'rm-2' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu/alias')
    expect(JSON.parse(init.body)).toEqual({ richMenuAliasId: 'tab-main', richMenuId: 'rm-2' })
  })

  it('alias มีอยู่แล้วจากแคมเปญก่อน (409) → เรียกอัปเดตให้ชี้ใหม่แทนการสร้าง', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'exists' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' })

    await setRichMenuAlias('token', { richMenuAliasId: 'tab-main', richMenuId: 'rm-3' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu/alias/tab-main')
    expect(JSON.parse(init.body)).toEqual({ richMenuId: 'rm-3' })
  })

  it('สร้างไม่สำเร็จด้วยเหตุอื่นที่ไม่ใช่ 409 → โยน error ไม่ลองอัปเดต', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' })
    await expect(setRichMenuAlias('token', { richMenuAliasId: 'tab-main', richMenuId: 'rm-4' }))
      .rejects.toThrow(/500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('อัปเดต alias เดิมแล้วยังล้มอีก → โยน error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'exists' })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })

    await expect(setRichMenuAlias('token', { richMenuAliasId: 'tab-main', richMenuId: 'rm-5' }))
      .rejects.toThrow(/500/)
  })
})

describe('linkRichMenuBatch · ขั้น 5c (BR-97)', () => {
  it('ยิงไป /v2/bot/richmenu/batch พร้อม operations', async () => {
    const ops = [{ type: 'link' as const, from: 'old-1', to: 'new-1' }]
    await linkRichMenuBatch('token', ops)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu/batch')
    expect(JSON.parse(init.body)).toEqual({ operations: ops })
  })

  it('ล้มเหลว → โยน error ถือว่า publish ล้ม (ERR-045 ประกอบขึ้นที่ชั้นบน)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'batch failed' })
    await expect(linkRichMenuBatch('token', [{ type: 'link', from: 'a', to: 'b' }]))
      .rejects.toThrow(/batch failed/)
  })
})
