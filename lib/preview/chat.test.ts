import { describe, expect, it } from 'vitest'
import { renderCard, type RenderableCard } from '../render/card'
import type { CardBlock } from '../render/groups'
import type { PlayerState } from '../state'
import type { Theme } from '../render/flex'
import { toChatBubble } from './chat'

const THEME: Theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }

const STATE: PlayerState = {
  attributes: {}, counters: { food: 3 }, entitlements: [], playCounts: {}, completed: [],
}

let seq = 0
const block = (
  blockType: CardBlock['blockType'], content: string | null, options?: Record<string, unknown>,
): CardBlock => ({
  id: `b${seq++}`, blockType, sortOrder: seq, content, showWhen: null, options: options ?? null,
})

const card = (
  renderAs: RenderableCard['renderAs'], blocks: CardBlock[], children?: RenderableCard[],
): RenderableCard => ({ code: 'c', renderAs, blocks, children })

/**
 * ตัวแกะนี้อ่านผลของ lib/render/ ตัวจริง ไม่ได้เขียนของปลอมมาเทียบ
 *
 * Feeding it renderCard's real output is the point: the simulator draws what
 * the renderer produced, so the day a bubble changes shape this test fails
 * instead of the chat quietly dropping half of every card.
 */
describe('แกะข้อความที่ renderer ส่งออกมาให้จอแชทวาดได้', () => {
  it('การ์ดชนิดข้อความมาเป็นฟองข้อความธรรมดา', () => {
    const message = renderCard(card('text', [block('body', 'สวัสดี')]), STATE, THEME)
    expect(toChatBubble(message)).toEqual({ kind: 'text', text: 'สวัสดี' })
  })

  it('บล็อกหัวข้อกลายเป็นส่วนหัวของการ์ด ไม่ใช่ข้อความบรรทัดหนึ่ง', () => {
    const message = renderCard(
      card('flex_bubble', [block('title', 'คุณได้รางวัล'), block('body', 'เก็บไว้ได้เลย')]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts).toEqual([
      { kind: 'title', text: 'คุณได้รางวัล' },
      { kind: 'text', text: 'เก็บไว้ได้เลย' },
    ])
  })

  it('ลำดับของบล็อกในการ์ดคือลำดับที่แชทวาด', () => {
    const message = renderCard(
      card('flex_bubble', [block('body', 'หนึ่ง'), block('divider', null), block('body', 'สอง')]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts.map((p) => p.kind)).toEqual(['text', 'divider', 'text'])
  })

  it('ภาพเต็มหัวการ์ดมาเป็นภาพหัวการ์ด ไม่ปนกับเนื้อ', () => {
    const message = renderCard(
      card('flex_bubble', [
        block('image', 'https://example.com/a.png', { placement: 'full_top' }),
        block('body', 'เนื้อ'),
      ]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.hero).toBe('https://example.com/a.png')
    expect(bubble.card.parts).toEqual([{ kind: 'text', text: 'เนื้อ' }])
  })

  // groupBlocks ยกภาพขึ้นเป็นหัวการ์ดเฉพาะเมื่อบล็อกสั่ง placement=full_top
  // ภาพที่ไม่ได้สั่งจึงอยู่ในเนื้อ และจอจำลองต้องวาดมันไว้ที่เดิม
  it('ภาพที่ไม่ได้สั่งให้เต็มหัวการ์ด อยู่ในเนื้อตามลำดับเดิม', () => {
    const message = renderCard(
      card('flex_bubble', [block('body', 'ก่อน'), block('image', 'https://example.com/b.png')]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.hero).toBe(null)
    expect(bubble.card.parts).toEqual([
      { kind: 'text', text: 'ก่อน' },
      { kind: 'image', url: 'https://example.com/b.png' },
    ])
  })

  it('ตัวแปรถูกแทนค่าแล้วตั้งแต่ชั้น renderer จอแชทไม่ได้แทนเอง', () => {
    const message = renderCard(
      card('flex_bubble', [block('body', 'สะสมแล้ว {{counter.food}} ชิ้น')]), STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts).toEqual([{ kind: 'text', text: 'สะสมแล้ว 3 ชิ้น' }])
  })

  it('แถบความคืบหน้ามาพร้อมเปอร์เซ็นต์ที่ renderer คำนวณไว้', () => {
    const message = renderCard(
      card('flex_bubble', [block('progress_bar', null, { counter: 'food', target: 12 })]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts).toEqual([{ kind: 'progress', percent: 25 }])
  })

  it('ปุ่มบนการ์ดพาข้อมูล postback ของตัวเองมาด้วย จะได้กดต่อได้จริง', () => {
    const message = renderCard(
      card('flex_bubble', [
        block('body', 'เลือกเลย'),
        block('button', 'เปิดกล่อง', { action: { type: 'postback', data: 'c=x&a=draw&d=2026-08-17' } }),
      ]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.buttons).toEqual([
      { label: 'เปิดกล่อง', postback: 'c=x&a=draw&d=2026-08-17', uri: null },
    ])
  })

  it('ปุ่มลิงก์ไม่มี postback — กดในจอจำลองแล้วต้องไม่ยิงเข้ากติกา', () => {
    const message = renderCard(
      card('flex_bubble', [
        block('button', 'เปิดเว็บ', { action: { type: 'uri', uri: 'https://example.com' } }),
      ]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.buttons).toEqual([
      { label: 'เปิดเว็บ', postback: null, uri: 'https://example.com' },
    ])
  })

  it('การ์ดหลายใบมาเป็นหลายใบ เรียงตามลำดับปัด', () => {
    const message = renderCard(
      card('flex_carousel', [], [
        card('flex_bubble', [block('title', 'ใบแรก')]),
        card('flex_bubble', [block('title', 'ใบสอง')]),
      ]),
      STATE, THEME,
    )
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'carousel') throw new Error('ควรได้การ์ดหลายใบ')
    expect(bubble.cards.map((c) => c.parts[0])).toEqual([
      { kind: 'title', text: 'ใบแรก' },
      { kind: 'title', text: 'ใบสอง' },
    ])
  })

  // renderer เติม filler ให้การ์ดที่บล็อกถูกซ่อนหมด เพราะ LINE ปฏิเสธกล่องว่าง
  // จอจำลองต้องบอกว่ามันว่าง ไม่ใช่วาดการ์ดเปล่าแล้วให้คนเดาว่าพังหรือถูกซ่อน
  it('การ์ดที่บล็อกถูกซ่อนหมด บอกออกมาว่าไม่มีอะไรให้แสดง', () => {
    const hidden = block('body', 'เห็นเฉพาะคนที่เล่นแล้ว')
    hidden.showWhen = [{ type: 'has_entitlement', rewardCode: 'never' }]
    const message = renderCard(card('flex_bubble', [hidden]), STATE, THEME)
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts).toEqual([{ kind: 'empty' }])
  })

  it('ชนิดที่ยังวาดไม่ได้ถูกบอกชื่อไว้ ไม่ใช่หายไปเงียบๆ', () => {
    const bubble = toChatBubble({
      type: 'flex',
      altText: 'x',
      contents: { type: 'bubble', body: { type: 'box', contents: [{ type: 'video' }] } },
    })
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.card.parts).toEqual([{ kind: 'unknown', name: 'video' }])
  })

  it('ข้อความแจ้งเตือนของ flex ติดมาด้วย เพราะเป็นสิ่งเดียวที่คนเห็นตอนยังไม่เปิดแอป', () => {
    const message = renderCard(card('flex_bubble', [block('title', 'ยินดีด้วย')]), STATE, THEME)
    const bubble = toChatBubble(message)
    if (bubble.kind !== 'card') throw new Error('ควรได้การ์ด')
    expect(bubble.altText).toBe('ยินดีด้วย')
  })
})
