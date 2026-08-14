import { describe, expect, it } from 'vitest'
import { renderCard, type RenderableCard } from '../lib/render/card'
import type { CardBlock } from '../lib/render/groups'
import type { PlayerState } from '../lib/state'

const theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [], ...over,
})

let seq = 0
const b = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

/**
 * The shape of what leaves for LINE, frozen.
 *
 * These are the tests that answer "what did I just break". Nothing here asserts
 * that a shape is correct — correctness is the other tests' job. What they catch
 * is a change nobody meant to make, and they name it as a line-level diff.
 * Changing a snapshot on purpose is a decision that shows up in review.
 */
describe('รูปร่างของข้อความที่ส่งเข้า LINE', () => {
  it('การ์ดสะสมแต้ม · ครึ่งทาง', () => {
    const card: RenderableCard = {
      code: 'stamp', renderAs: 'flex_bubble',
      blocks: [
        b({ blockType: 'image', content: 'https://cdn/hero.png', options: { placement: 'full_top' } }),
        b({ blockType: 'title', content: 'สะสมอาหารให้ {{attr.pet_name}}' }),
        b({ blockType: 'progress_bar', options: { counter: 'food', target: 100 } }),
        b({ blockType: 'caption', content: 'ให้อาหารแล้ว {{counter.food}} จาก 100' }),
        b({ blockType: 'divider' }),
        b({ blockType: 'button', content: 'ให้อาหาร', options: { action: { type: 'postback', data: 'c=krobpet&a=feed&d=2026-08-14' } } }),
      ],
    }
    expect(renderCard(card, state({ counters: { food: 50 }, attributes: { pet_name: 'โมจิ' } }), theme))
      .toMatchSnapshot()
  })

  it('การ์ดสะสมแต้ม · ยังไม่เริ่ม — บล็อกที่ซ่อนต้องหายไปจริง', () => {
    const card: RenderableCard = {
      code: 'stamp', renderAs: 'flex_bubble',
      blocks: [
        b({ blockType: 'title', content: 'เริ่มสะสมวันนี้' }),
        b({ blockType: 'caption', content: 'ครบแล้ว รับรางวัลได้เลย',
            showWhen: [{ type: 'has_entitlement', rewardCode: 'sticker' }] }),
        b({ blockType: 'button', content: 'เริ่มเลย', options: { action: { type: 'postback', data: 'c=krobpet&a=feed&d=2026-08-14' } } }),
      ],
    }
    expect(renderCard(card, state(), theme)).toMatchSnapshot()
  })

  it('การ์ดผลลัพธ์ · สามปุ่มท้าย', () => {
    const card: RenderableCard = {
      code: 'result', renderAs: 'flex_bubble',
      blocks: [
        b({ blockType: 'title', content: 'คุณได้รางวัล' }),
        b({ blockType: 'body', content: 'สติกเกอร์ไลน์ 1 ชุด' }),
        b({ blockType: 'button', content: 'รับรางวัล', options: { action: { type: 'uri', uri: 'https://example.com/r' } } }),
        b({ blockType: 'button', content: 'เล่นอีกครั้ง', options: { action: { type: 'postback', data: 'c=krobpet&a=draw&d=2026-08-14' } } }),
        b({ blockType: 'button', content: 'ดูของที่ได้', options: { action: { type: 'uri', uri: 'https://example.com/mine' } } }),
      ],
    }
    expect(renderCard(card, state(), theme)).toMatchSnapshot()
  })

  it('การ์ดปัดได้ · สามใบ', () => {
    const child = (n: number): RenderableCard => ({
      code: `c${n}`, renderAs: 'flex_bubble',
      blocks: [b({ blockType: 'title', content: `ตัวเลือกที่ ${n}` })],
    })
    const card: RenderableCard = {
      code: 'pick', renderAs: 'flex_carousel',
      blocks: [b({ blockType: 'title', content: 'เลือกหนึ่งอย่าง' })],
      children: [child(1), child(2), child(3)],
    }
    expect(renderCard(card, state(), theme)).toMatchSnapshot()
  })

  it('ข้อความล้วน · ทางสำรอง', () => {
    const card: RenderableCard = {
      code: 'plain', renderAs: 'text',
      blocks: [
        b({ blockType: 'title', content: 'กิจกรรมจบแล้ว' }),
        b({ blockType: 'body', content: 'ขอบคุณที่ร่วมสนุก' }),
      ],
    }
    expect(renderCard(card, state(), theme)).toMatchSnapshot()
  })

  it('ริชเมสเสจยังไม่มีตัววาด จึงตกมาเป็นข้อความ ไม่ใช่เงียบ', () => {
    const card: RenderableCard = {
      code: 'rich', renderAs: 'imagemap',
      blocks: [b({ blockType: 'body', content: 'เนื้อหาที่ยังวาดเป็นภาพไม่ได้' })],
    }
    expect(renderCard(card, state(), theme)).toMatchSnapshot()
  })
})
