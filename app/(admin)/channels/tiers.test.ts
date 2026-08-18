import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * สามชั้นต้องแยกออกจากกันได้ด้วยตาเปล่า
 *
 * The tier copy lives inside the screen, with the rest of the wording, because
 * Next refuses any export from a page.tsx other than the page itself. That puts
 * it out of reach of an import, so this reads the source the way the hex-colour
 * guard and the rail's layout check already do.
 *
 * The words themselves are pinned by tests/design/landmarks.json. What is left
 * for here is the part the words cannot show: that the three tiers do not wear
 * the same badge. A production OA dressed as a simulator is a screen that helped
 * someone paste a live key into the wrong row.
 */
const source = readFileSync('app/(admin)/channels/page.tsx', 'utf8')

const tierBlock = source.slice(
  source.indexOf('const CHANNEL_TIERS'),
  source.indexOf('primaryLinkStyle'),
)

describe('ชั้นของบัญชีบนจอ M6-S01', () => {
  it('มีบล็อกของชั้นอยู่จริง — กันเคสที่ผ่านเพราะตัดข้อความมาผิดที่', () => {
    expect(tierBlock.length).toBeGreaterThan(200)
    for (const type of ['preview:', 'test:', 'production:']) {
      expect(tierBlock, type).toContain(type)
    }
  })

  it('สามชั้นสามโทน ไม่ซ้ำกัน', () => {
    const tones = [...tierBlock.matchAll(/tone: '([a-z]+)'/g)].map((m) => m[1])
    expect(tones).toHaveLength(3)
    expect(new Set(tones).size).toBe(3)
  })

  // โทนที่ใช้ต้องเป็นโทนที่ STATUS_TONES รู้จัก ไม่ใช่ชื่อที่คิดขึ้นเอง
  it('ชั้นที่เสี่ยงกว่าใช้โทนที่เตือนแรงกว่า', () => {
    const tones = [...tierBlock.matchAll(/tone: '([a-z]+)'/g)].map((m) => m[1])
    expect(tones).toEqual(['mute', 'info', 'warn'])
  })

  it('แต่ละชั้นมีครบทั้งหัวข้อ คำอธิบาย และข้อความตอนว่าง', () => {
    expect([...tierBlock.matchAll(/head:/g)]).toHaveLength(3)
    expect([...tierBlock.matchAll(/sub:/g)]).toHaveLength(3)
    expect([...tierBlock.matchAll(/emptyText:/g)]).toHaveLength(3)
  })
})
