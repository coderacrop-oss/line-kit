import { describe, expect, it } from 'vitest'
import { matchKeyword, normalizeText } from '../match/keyword'
import { describeTarget, findConflicts, inMatchOrder, type KeywordRuleView } from './keywords'

const channels = [
  { name: 'OA ธ.ก.ส.', existingKeywords: ['โปรโมชั่น', 'ที่ตั้งสาขา'] },
  { name: 'OA ทดสอบ', existingKeywords: [] },
]

describe('findConflicts', () => {
  it('ชนกับคีย์เวิร์ดเดิมของลูกค้า บอกทั้งคำและบัญชี', () => {
    expect(findConflicts(['โปรโมชั่น'], channels))
      .toEqual([{ keyword: 'โปรโมชั่น', channelName: 'OA ธ.ก.ส.' }])
  })

  it('ไม่ชน คืนรายการว่าง', () => {
    expect(findConflicts(['เล่นเกม'], channels)).toEqual([])
  })

  it('ยังไม่มีคีย์เวิร์ดเลย ก็ไม่มีอะไรให้เตือน', () => {
    expect(findConflicts([], channels)).toEqual([])
  })

  it('ยังไม่ผูกบัญชีสักบัญชี ก็ไม่มีอะไรให้เตือน', () => {
    expect(findConflicts(['โปรโมชั่น'], [])).toEqual([])
  })

  it('เทียบหลังทำข้อความเป็นมาตรฐาน — ช่องว่างและตัวพิมพ์ไม่ช่วยให้รอด', () => {
    expect(findConflicts(['  โปรโมชั่น '], channels)).toHaveLength(1)
  })

  /**
   * ฝั่งของลูกค้าก็ต้องทำเป็นมาตรฐานเหมือนกัน
   *
   * existing_keywords is typed in by a human reading someone else's OA Manager,
   * so it arrives with the stray spaces and mixed case of anything typed by
   * hand. Normalising only our side would let " PROMO " sit next to "promo" and
   * report no conflict at all — the exact case the warning exists for.
   */
  it('ทำข้อความเป็นมาตรฐานทั้งสองฝั่ง ไม่ใช่ฝั่งเราฝั่งเดียว', () => {
    const messy = [{ name: 'OA พิมพ์มือ', existingKeywords: ['  PROMO  '] }]
    expect(findConflicts(['promo'], messy))
      .toEqual([{ keyword: 'promo', channelName: 'OA พิมพ์มือ' }])
  })

  it('อักขระล่องหนที่ติดมากับการก๊อป ไม่ทำให้คำเดียวกันกลายเป็นคนละคำ', () => {
    const invisible = [{ name: 'OA ก๊อปมา', existingKeywords: ['โปรโม​ชั่น'] }]
    expect(findConflicts(['โปรโมชั่น'], invisible)).toHaveLength(1)
  })

  it('ชนหลายบัญชี รายงานทุกบัญชี เพราะแคมเปญอาจผูกหลายบัญชี', () => {
    const many = [...channels, { name: 'OA สาขาย่อย', existingKeywords: ['โปรโมชั่น'] }]
    expect(findConflicts(['โปรโมชั่น'], many))
      .toEqual([
        { keyword: 'โปรโมชั่น', channelName: 'OA ธ.ก.ส.' },
        { keyword: 'โปรโมชั่น', channelName: 'OA สาขาย่อย' },
      ])
  })

  it('บัญชีที่ยังไม่กรอกคีย์เวิร์ดเดิม ไม่ทำให้พลาดการเตือนของบัญชีอื่น', () => {
    expect(findConflicts(['ที่ตั้งสาขา'], channels)).toHaveLength(1)
  })

  // บัญชีที่ยังไม่กรอกมาก่อนบัญชีที่กรอกไว้ — ลูปที่หยุดที่บัญชีแรกจะเงียบทั้งใบ
  it('บัญชีว่างมาก่อน ก็ยังเตือนของบัญชีถัดไป', () => {
    const emptyFirst = [
      { name: 'OA ยังไม่กรอก', existingKeywords: [] },
      { name: 'OA ธ.ก.ส.', existingKeywords: ['โปรโมชั่น'] },
    ]
    expect(findConflicts(['โปรโมชั่น'], emptyFirst))
      .toEqual([{ keyword: 'โปรโมชั่น', channelName: 'OA ธ.ก.ส.' }])
  })

  it('หลายคำชนพร้อมกัน รายงานครบทุกคำ ไม่ใช่หยุดที่คำแรก', () => {
    expect(findConflicts(['โปรโมชั่น', 'เล่นเกม', 'ที่ตั้งสาขา'], channels))
      .toEqual([
        { keyword: 'โปรโมชั่น', channelName: 'OA ธ.ก.ส.' },
        { keyword: 'ที่ตั้งสาขา', channelName: 'OA ธ.ก.ส.' },
      ])
  })

  it('ช่องว่างล้วนไม่ใช่คำ จึงไม่ชนกับอะไรทั้งนั้น', () => {
    const blankBoth = [{ name: 'OA ว่าง', existingKeywords: ['   ', ''] }]
    expect(findConflicts(['   ', ''], blankBoth)).toEqual([])
    expect(findConflicts([''], channels)).toEqual([])
  })

  /**
   * เทียบด้วย normalizeText ตัวเดียวกับที่เครื่องใช้จับคู่ตอนรับ event
   *
   * The warning is only true if it compares the way the matcher compares. This
   * asserts against normalizeText itself rather than restating its rules, so a
   * change to normalisation cannot leave the screen quietly disagreeing with
   * the engine about what counts as the same word.
   */
  it('ตัดสินด้วยกติกาเดียวกับ normalizeText ที่เครื่องใช้จริง', () => {
    const cases = ['ทดสอบ', ' Hello  World ', 'ก‍ข']
    for (const word of cases) {
      const channel = [{ name: 'OA', existingKeywords: [normalizeText(word)] }]
      expect(findConflicts([word], channel), word).toHaveLength(1)
    }
  })
})

const rule = (patch: Partial<KeywordRuleView> & { id: string }): KeywordRuleView => ({
  keyword: patch.id, matchMode: 'exact', sortOrder: 0,
  targetActivityId: null, targetCardId: null, ...patch,
})

/**
 * ลำดับที่หน้าจอวาด ต้องเป็นลำดับที่เครื่องตรวจจริง
 *
 * The screen tells the reader "exact is checked first, then top to bottom", and
 * a list drawn in any other order turns that sentence into a lie the reader
 * cannot see through. These assert against matchKeyword itself rather than
 * restating its rules.
 */
describe('inMatchOrder', () => {
  it('exact มาก่อน contains เสมอ แม้ contains จะถูกสร้างไว้ก่อน', () => {
    const rules = [
      rule({ id: 'c', matchMode: 'contains', sortOrder: 0 }),
      rule({ id: 'e', matchMode: 'exact', sortOrder: 9 }),
    ]
    expect(inMatchOrder(rules).map((r) => r.id)).toEqual(['e', 'c'])
  })

  it('ในกลุ่มเดียวกันเรียงจาก sort_order น้อยไปมาก', () => {
    const rules = [
      rule({ id: 'b', sortOrder: 2 }),
      rule({ id: 'a', sortOrder: 1 }),
      rule({ id: 'd', matchMode: 'contains', sortOrder: 4 }),
      rule({ id: 'c', matchMode: 'contains', sortOrder: 3 }),
    ]
    expect(inMatchOrder(rules).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ไม่แก้รายการเดิม — หน้าจอกับตัวนับใช้ของก้อนเดียวกัน', () => {
    const rules = [rule({ id: 'c', matchMode: 'contains' }), rule({ id: 'e' })]
    inMatchOrder(rules)
    expect(rules.map((r) => r.id)).toEqual(['c', 'e'])
  })

  it('รายการว่างก็ยังคืนรายการว่าง', () => {
    expect(inMatchOrder([])).toEqual([])
  })

  // ตัวที่อยู่บนสุดของลิสต์ต้องเป็นตัวที่ matchKeyword เลือกจริงๆ
  it('ตัวแรกในลำดับที่ชนะการจับคู่ คือตัวที่ matchKeyword เลือก', () => {
    const rules = [
      rule({ id: 'c1', keyword: 'เล่น', matchMode: 'contains', sortOrder: 0 }),
      rule({ id: 'e1', keyword: 'เล่นเกม', matchMode: 'exact', sortOrder: 7 }),
      rule({ id: 'c2', keyword: 'เกม', matchMode: 'contains', sortOrder: 1 }),
    ]
    for (const said of ['เล่นเกม', 'อยากเล่นเกมจัง', 'เกม']) {
      const winner = matchKeyword(said, rules)
      const first = inMatchOrder(rules).find((r) => matchKeyword(said, [r]) !== null)
      expect(first?.id, said).toBe(winner?.id)
    }
  })
})

const catalogue = {
  activities: [
    { id: 'a1', name: 'สุ่มรางวัล', isEnabled: true },
    { id: 'a2', name: 'กิจกรรมที่ปิดอยู่', isEnabled: false },
  ],
  cards: [{ id: 'k1', code: 'welcome' }],
}

/**
 * ปลายทางที่หน้าจอบอก ต้องเป็นปลายทางที่เครื่องไปจริง
 *
 * handle.ts tries the activity first and only falls through to the card when the
 * activity is not among the enabled ones. A row that prints the activity's name
 * regardless would describe a rule that does something else entirely.
 */
describe('describeTarget', () => {
  it('ชี้ไปกิจกรรมที่เปิดอยู่ บอกชื่อกิจกรรม', () => {
    expect(describeTarget(rule({ id: 'r', targetActivityId: 'a1' }), catalogue))
      .toEqual({ kind: 'activity', label: 'สุ่มรางวัล', warning: null })
  })

  it('ชี้ไปการ์ด บอกรหัสการ์ด', () => {
    expect(describeTarget(rule({ id: 'r', targetCardId: 'k1' }), catalogue))
      .toEqual({ kind: 'card', label: 'welcome', warning: null })
  })

  it('กิจกรรมปลายทางถูกปิด แต่มีการ์ดสำรอง บอกว่าจะได้การ์ดแทน', () => {
    const view = describeTarget(
      rule({ id: 'r', targetActivityId: 'a2', targetCardId: 'k1' }), catalogue,
    )
    expect(view.kind).toBe('card')
    expect(view.label).toBe('welcome')
    expect(view.warning).toContain('ปิด')
  })

  it('กิจกรรมปลายทางถูกปิด และไม่มีการ์ดสำรอง บอกว่าคำนี้ไม่ทำอะไร', () => {
    const view = describeTarget(rule({ id: 'r', targetActivityId: 'a2' }), catalogue)
    expect(view.kind).toBe('dead')
    expect(view.warning).toContain('ปิด')
  })

  // ตั้งไว้ทั้งคู่แล้วกิจกรรมเปิดอยู่ · เครื่องเล่นกิจกรรม การ์ดไม่ได้ถูกใช้เลย
  it('ตั้งไว้ทั้งกิจกรรมและการ์ด กิจกรรมชนะ และบอกว่าการ์ดไม่ถูกใช้', () => {
    const view = describeTarget(
      rule({ id: 'r', targetActivityId: 'a1', targetCardId: 'k1' }), catalogue,
    )
    expect(view.kind).toBe('activity')
    expect(view.label).toBe('สุ่มรางวัล')
    expect(view.warning).toContain('การ์ด')
  })

  it('ปลายทางที่หาไม่เจอ ไม่ทำให้ทั้งหน้าพัง แต่บอกว่าคำนี้ไม่ทำอะไร', () => {
    const view = describeTarget(rule({ id: 'r', targetActivityId: 'ghost' }), catalogue)
    expect(view.kind).toBe('dead')
    expect(view.warning).not.toBeNull()
  })

  it('ไม่ได้ชี้ไปไหนเลย — ฐานข้อมูลห้ามไว้ แต่หน้าจอไม่ล้ม', () => {
    expect(describeTarget(rule({ id: 'r' }), catalogue).kind).toBe('dead')
  })
})
