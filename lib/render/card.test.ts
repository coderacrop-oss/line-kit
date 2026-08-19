import { describe, expect, it } from 'vitest'
import { renderCard, type RenderableCard } from './card'
import type { TapArea } from '../imagemap/regions'
import type { PlayerState } from '../state'

const THEME = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }
const STATE: PlayerState = { attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [] }

const area = (patch: Partial<TapArea> = {}): TapArea => ({
  id: 'a1', x: 10, y: 20, width: 300, height: 100, action: { type: 'uri', linkUri: 'https://example.com/promo' },
  ...patch,
})

const imagemapCard = (patch: Partial<RenderableCard> = {}): RenderableCard => ({
  code: 'promo', renderAs: 'imagemap', blocks: [],
  imagemap: {
    baseUrl: 'https://app.example.com/api/imagemap/card-1',
    altText: 'โปรโมชันพิเศษ',
    baseSize: { width: 1040, height: 585 },
    actions: [area()],
  },
  ...patch,
})

describe('renderCard · imagemap', () => {
  it('การ์ดที่กด "ใช้" แล้ว ส่งเป็น LINE imagemap message ที่ครบทุกฟิลด์บังคับ', () => {
    const message = renderCard(imagemapCard(), STATE, THEME)
    expect(message).toEqual({
      type: 'imagemap',
      baseUrl: 'https://app.example.com/api/imagemap/card-1',
      altText: 'โปรโมชันพิเศษ',
      baseSize: { width: 1040, height: 585 },
      actions: [
        { type: 'uri', area: { x: 10, y: 20, width: 300, height: 100 }, linkUri: 'https://example.com/promo' },
      ],
    })
  })

  it('แปลง action ชนิด message ให้มี text ไม่ใช่ linkUri', () => {
    const card = imagemapCard({
      imagemap: {
        baseUrl: 'https://x/api/imagemap/c1', altText: 'x', baseSize: { width: 1040, height: 500 },
        actions: [area({ action: { type: 'message', text: 'สนใจครับ' } })],
      },
    })
    const message = renderCard(card, STATE, THEME)
    expect(message.type).toBe('imagemap')
    if (message.type !== 'imagemap') return
    expect(message.actions[0]).toEqual({
      type: 'message', area: { x: 10, y: 20, width: 300, height: 100 }, text: 'สนใจครับ',
    })
  })

  it('ป้ายกำกับ (label) ติดไปด้วยเมื่อมี ไม่ติดไปเมื่อไม่มี', () => {
    const withLabel = renderCard(
      imagemapCard({ imagemap: { ...imagemapCard().imagemap!, actions: [area({ action: { type: 'uri', linkUri: 'https://x', label: 'ไปเลย' } })] } }),
      STATE, THEME,
    )
    if (withLabel.type === 'imagemap') expect(withLabel.actions[0]).toMatchObject({ label: 'ไปเลย' })

    const withoutLabel = renderCard(imagemapCard(), STATE, THEME)
    if (withoutLabel.type === 'imagemap') expect(withoutLabel.actions[0]).not.toHaveProperty('label')
  })

  it('ยังไม่เคยกด "ใช้" (imagemap เป็น undefined) — ตกไปเป็นข้อความ ไม่ใช่ imagemap message ที่พัง (BR-01)', () => {
    const message = renderCard({ code: 'promo', renderAs: 'imagemap', blocks: [] }, STATE, THEME)
    expect(message.type).toBe('text')
  })

  it('หลายพื้นที่กด แปลงครบทุกอันตามลำดับเดิม', () => {
    const card = imagemapCard({
      imagemap: {
        ...imagemapCard().imagemap!,
        actions: [area({ id: 'a1', x: 0 }), area({ id: 'a2', x: 400, action: { type: 'message', text: 'b' } })],
      },
    })
    const message = renderCard(card, STATE, THEME)
    if (message.type !== 'imagemap') throw new Error('expected imagemap')
    expect(message.actions).toHaveLength(2)
    expect(message.actions[0].area.x).toBe(0)
    expect(message.actions[1].area.x).toBe(400)
  })
})

describe('renderCard · imagemap_video ยังคงตกไปเป็นข้อความ (เฟส 2 นอกสโคป)', () => {
  it('ไม่ถูกส่งเป็น imagemap message แม้จะมีชื่อใกล้กัน', () => {
    const message = renderCard({ code: 'v1', renderAs: 'imagemap_video', blocks: [] }, STATE, THEME)
    expect(message.type).toBe('text')
  })
})
