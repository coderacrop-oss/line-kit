import { describe, expect, it } from 'vitest'
import { toPlainText } from './text'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: {}, counters: { food: 30 }, entitlements: [], playCounts: {}, completed: [],
}
let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('toPlainText', () => {
  it('ต่อข้อความตามลำดับ บรรทัดละบล็อก', () => {
    const g = groupBlocks([
      block({ blockType: 'title', content: 'หัวข้อ' }),
      block({ blockType: 'body', content: 'เนื้อหา' }),
    ], state)
    expect(toPlainText(g, state)).toBe('หัวข้อ\nเนื้อหา')
  })
  it('แทนค่าตัวแปรเหมือนฝั่ง Flex', () => {
    const g = groupBlocks([block({ blockType: 'body', content: 'กินไป {{counter.food}}' })], state)
    expect(toPlainText(g, state)).toBe('กินไป 30')
  })
  it('ภาพกับเส้นคั่นไม่มีข้อความ จึงถูกข้าม', () => {
    const g = groupBlocks([
      block({ blockType: 'image', content: 'https://x/a.png', options: { placement: 'full_top' } }),
      block({ blockType: 'divider' }),
      block({ blockType: 'body', content: 'เหลือแค่นี้' }),
    ], state)
    expect(toPlainText(g, state)).toBe('เหลือแค่นี้')
  })
  it('ป้ายปุ่มยังอยู่ เพราะเป็นข้อความที่ผู้ใช้ต้องเห็น', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'ข้อความ' }),
      block({ blockType: 'button', content: 'กดเล่น' }),
    ], state)
    expect(toPlainText(g, state)).toContain('กดเล่น')
  })
  it('ไม่มีอะไรเหลือเลย คืนข้อความสำรอง ไม่ใช่สตริงว่าง', () => {
    const g = groupBlocks([block({ blockType: 'divider' })], state)
    expect(toPlainText(g, state).length).toBeGreaterThan(0)
  })
})
