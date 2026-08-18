import { describe, expect, it } from 'vitest'
import { toFlexBubble, toFlexCarousel, type Theme } from './flex'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const theme: Theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }
const state: PlayerState = {
  attributes: { pet_name: 'โมจิ' }, counters: { food: 50 },
  entitlements: [], playCounts: {}, completed: [],
}

let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('toFlexBubble', () => {
  it('กลุ่มบนสุดเป็น hero · เนื้อหาเป็น body · ปุ่มท้ายเป็น footer', () => {
    const groups = groupBlocks([
      block({ blockType: 'image', content: 'https://x/a.png', options: { placement: 'full_top' } }),
      block({ blockType: 'title', content: 'หัวข้อ' }),
      block({ blockType: 'button', content: 'กด', options: { action: { type: 'postback', data: 'c=a&a=b&d=2026-08-14' } } }),
    ], state)
    const bubble = toFlexBubble(groups, state, theme) as any
    expect(bubble.type).toBe('bubble')
    expect(bubble.hero.type).toBe('image')
    expect(bubble.body.contents[0].text).toBe('หัวข้อ')
    expect(bubble.footer.contents[0].type).toBe('button')
    expect(bubble.footer.contents[0].action.data).toBe('c=a&a=b&d=2026-08-14')
    expect(bubble.footer.contents[0].action.label).toBe('กด')
  })

  it('แทนค่าตัวแปรในข้อความ', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: '{{attr.pet_name}} กิน {{counter.food}}' })], state)
    expect((toFlexBubble(groups, state, theme) as any).body.contents[0].text).toBe('โมจิ กิน 50')
  })

  it('แถบความคืบหน้าออกมาเป็นแท่งซ้อนกัน กว้างตามสัดส่วน', () => {
    const groups = groupBlocks([block({ blockType: 'progress_bar', options: { counter: 'food', target: 100 } })], state)
    const bar = (toFlexBubble(groups, state, theme) as any).body.contents[0]
    expect(bar.type).toBe('box')
    expect(bar.contents[0].width).toBe('50%')
  })

  it('แถบความคืบหน้าเกินเป้า ไม่ล้นเกิน 100%', () => {
    const over: PlayerState = { ...state, counters: { food: 250 } }
    const groups = groupBlocks([block({ blockType: 'progress_bar', options: { counter: 'food', target: 100 } })], over)
    expect((toFlexBubble(groups, over, theme) as any).body.contents[0].contents[0].width).toBe('100%')
  })

  it('เป้าเป็นศูนย์ไม่ทำให้หารด้วยศูนย์', () => {
    const groups = groupBlocks([block({ blockType: 'progress_bar', options: { counter: 'food', target: 0 } })], state)
    expect((toFlexBubble(groups, state, theme) as any).body.contents[0].contents[0].width).toBe('0%')
  })

  it('ไม่มีกลุ่มบนสุด ก็ไม่มีช่อง hero เลย', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: 'x' })], state)
    expect(toFlexBubble(groups, state, theme)).not.toHaveProperty('hero')
  })

  it('ไม่มีปุ่มท้าย ก็ไม่มีช่อง footer เลย', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: 'x' })], state)
    expect(toFlexBubble(groups, state, theme)).not.toHaveProperty('footer')
  })

  it('body ต้องมีอย่างน้อยหนึ่งชิ้นเสมอ เพราะ LINE ไม่รับ box ว่าง', () => {
    const bubble = toFlexBubble(groupBlocks([], state), state, theme) as any
    expect(bubble.body.contents.length).toBeGreaterThan(0)
  })

  it('เส้นคั่นกับช่องว่างออกมาเป็น component ที่ LINE รู้จัก', () => {
    const groups = groupBlocks([
      block({ blockType: 'divider' }),
      block({ blockType: 'spacer' }),
    ], state)
    const kinds = (toFlexBubble(groups, state, theme) as any).body.contents.map((c: any) => c.type)
    expect(kinds).toEqual(['separator', 'box'])
  })
})

describe('toFlexCarousel', () => {
  const one = () => toFlexBubble(groupBlocks([{ id: 'x', blockType: 'body', sortOrder: 1, content: 'a', showWhen: null, options: null }], state), state, theme)

  it('ห่อ bubble หลายใบ', () => {
    const carousel = toFlexCarousel([one(), one()]) as any
    expect(carousel.type).toBe('carousel')
    expect(carousel.contents).toHaveLength(2)
  })
  it('เกิน 12 ใบ โยน error เพราะ LINE ไม่รับ', () => {
    expect(() => toFlexCarousel(Array.from({ length: 13 }, one))).toThrow(/12/)
  })
  it('ไม่มีใบเลย โยน error เพราะ carousel ว่างส่งไม่ได้', () => {
    expect(() => toFlexCarousel([])).toThrow()
  })
})
