import { describe, expect, it } from 'vitest'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const empty: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('groupBlocks', () => {
  it('ภาพเต็มบนที่เป็นบล็อกแรกไปกลุ่มบนสุด', () => {
    const g = groupBlocks([
      block({ blockType: 'image', options: { placement: 'full_top' } }),
      block({ blockType: 'body', content: 'hi' }),
    ], empty)
    expect(g.top).toHaveLength(1)
    expect(g.content).toHaveLength(1)
  })

  it('ภาพที่ไม่ได้เป็นบล็อกแรก อยู่ในเนื้อหา', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'hi' }),
      block({ blockType: 'image', options: { placement: 'full_top' } }),
    ], empty)
    expect(g.top).toHaveLength(0)
    expect(g.content).toHaveLength(2)
  })

  it('ภาพที่ไม่ได้ตั้งเต็มบน ไม่ขึ้นกลุ่มบนสุดแม้เป็นบล็อกแรก', () => {
    const g = groupBlocks([block({ blockType: 'image', options: { placement: 'inline' } })], empty)
    expect(g.top).toHaveLength(0)
    expect(g.content).toHaveLength(1)
  })

  it('ปุ่มท้ายรายการที่ต่อกันไปกลุ่มปุ่มท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'hi' }),
      block({ blockType: 'button', content: 'A' }),
      block({ blockType: 'button', content: 'B' }),
    ], empty)
    expect(g.footer.map((b) => b.content)).toEqual(['A', 'B'])
    expect(g.content).toHaveLength(1)
  })

  it('ปุ่มกลางรายการอยู่กลาง ไม่ถูกดันลงท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: 'กลาง' }),
      block({ blockType: 'body', content: 'ข้อความ' }),
      block({ blockType: 'button', content: 'ท้าย' }),
    ], empty)
    expect(g.footer.map((b) => b.content)).toEqual(['ท้าย'])
    expect(g.content.map((b) => b.content)).toEqual(['กลาง', 'ข้อความ'])
  })

  it('ปุ่มท้ายเกินสาม ตัวที่เกินตกลงมาอยู่ในเนื้อหา ไม่หาย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: '1' }),
      block({ blockType: 'button', content: '2' }),
      block({ blockType: 'button', content: '3' }),
      block({ blockType: 'button', content: '4' }),
    ], empty)
    expect(g.footer).toHaveLength(3)
    expect(g.content.map((b) => b.content)).toEqual(['1'])
  })

  it('บล็อกที่ show_when ไม่ผ่าน หายจากทั้งสามกลุ่ม', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'เห็น' }),
      block({ blockType: 'body', content: 'ไม่เห็น', showWhen: [{ type: 'has_entitlement', rewardCode: 'x' }] }),
    ], empty)
    expect(g.content.map((b) => b.content)).toEqual(['เห็น'])
  })

  it('เรียงตาม sortOrder ไม่ใช่ลำดับใน array', () => {
    const g = groupBlocks([
      { ...block({ blockType: 'body', content: 'สอง' }), sortOrder: 20 },
      { ...block({ blockType: 'body', content: 'หนึ่ง' }), sortOrder: 10 },
    ], empty)
    expect(g.content.map((b) => b.content)).toEqual(['หนึ่ง', 'สอง'])
  })

  it('ปุ่มที่ถูกซ่อนไม่ถูกนับเป็นปุ่มท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: 'A' }),
      block({ blockType: 'body', content: 'x' }),
      block({ blockType: 'button', content: 'B', showWhen: [{ type: 'has_entitlement', rewardCode: 'no' }] }),
    ], empty)
    expect(g.footer.map((b) => b.content)).toEqual([])
    expect(g.content.map((b) => b.content)).toEqual(['A', 'x'])
  })

  it('รายการว่างคืนสามกลุ่มว่าง ไม่โยน', () => {
    expect(groupBlocks([], empty)).toEqual({ top: [], content: [], footer: [] })
  })

  it('ไม่แก้ array ที่ส่งเข้ามา', () => {
    const input = [
      { ...block({ blockType: 'body', content: 'b' }), sortOrder: 20 },
      { ...block({ blockType: 'body', content: 'a' }), sortOrder: 10 },
    ]
    const before = input.map((b) => b.content)
    groupBlocks(input, empty)
    expect(input.map((b) => b.content)).toEqual(before)
  })
})
