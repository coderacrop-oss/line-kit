import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  asCardFilter, CARD_FILTERS, CARD_REF_KINDS, CARD_RENDER_NAME, CARD_RENDER_TYPES,
  type CardRef, type CardRow, filterCards, summarizeCard,
} from './cards'

const row = (patch: Partial<CardRow> = {}): CardRow => ({
  id: 'c1',
  code: 'win',
  render_as: 'flex_bubble',
  has_image: false,
  title_text: 'ยินดีด้วย {{attr.name}}',
  title_selector: null,
  used_by: [],
  ...patch,
})

const ref = (kind: CardRef['kind'], label: string): CardRef => ({ kind, label })

const view = (patch: Partial<CardRow> = {}) => summarizeCard(row(patch))

describe('ชนิดการส่งของการ์ด', () => {
  /**
   * ห้าค่านี้ไม่ได้เดา · เป็นค่าใน CHECK ของ card.render_as ตรงตัว
   *
   * Reading the migration rather than restating it is the point: a sixth value
   * added to the table without a name here would show a blank badge, and a
   * value removed from the table would leave a name for something nothing can
   * be.
   */
  it('ครบทุกค่าที่ CHECK ของ card.render_as รับ ไม่ขาดไม่เกิน', () => {
    const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8')
    const check = /render_as[\s\S]*?CHECK \(render_as IN \(([^)]*)\)\)/.exec(sql)
    const inTable = (check?.[1] ?? '').split(',').map((value) => value.trim().replace(/'/g, ''))

    expect(inTable.length).toBeGreaterThan(0)
    expect([...CARD_RENDER_TYPES].sort()).toEqual([...inTable].sort())
  })

  it('ทุกชนิดมีชื่อภาษาไทยของตัวเอง ไม่ซ้ำกัน', () => {
    const names = CARD_RENDER_TYPES.map((type) => CARD_RENDER_NAME[type])
    expect(new Set(names).size).toBe(CARD_RENDER_TYPES.length)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })

  it('ชื่อที่แสดงมาจากตารางชื่อ ไม่ใช่จากค่าดิบในคอลัมน์', () => {
    expect(view({ render_as: 'flex_carousel' }).renderName).toBe('การ์ดปัดได้')
    expect(view({ render_as: 'text' }).renderName).toBe('ข้อความล้วน')
    expect(view({ render_as: 'imagemap_video' }).renderName).toBe('ริชวิดีโอ')
  })
})

/**
 * "ไม่มีใครใช้" อ่านจากการอ้างอิงจริง ไม่ใช่จากธงที่เก็บไว้ข้างๆ
 *
 * The same principle that gives remaining stock one owner. There is no column
 * to read even if somebody wanted to, and these tests are what keep it that
 * way: every one of them decides orphanhood from the references themselves.
 */
describe('summarizeCard · การ์ดที่ไม่มีใครชี้มา', () => {
  it('ไม่มีใครชี้มาเลย คือการ์ดที่ไม่มีทางถูกส่ง', () => {
    expect(view({ used_by: [] }).isOrphan).toBe(true)
  })

  it('มีคนชี้มาแม้แค่รายการเดียว ก็ไม่ใช่การ์ดที่ไม่มีใครใช้', () => {
    expect(view({ used_by: [ref('keyword', 'คีย์เวิร์ด "เล่น"')] }).isOrphan).toBe(false)
  })

  it('รายชื่อคนที่ชี้มาถูกส่งต่อครบทุกแถว ไม่ถูกยุบเหลือจำนวน', () => {
    const refs = [ref('activity', 'สุ่มรางวัล · การ์ดสำรอง'), ref('stamp', 'บัตรแสตมป์ของค่าสะสม "เช็คอิน"')]
    expect(view({ used_by: refs }).usedBy).toEqual(refs)
  })

  /** postgres คืน jsonb ว่างมาเป็น [] · แต่คอลัมน์ที่หายไปจะเป็น undefined */
  it('ไม่มี used_by ส่งมาเลย ไม่พังและนับเป็นไม่มีใครใช้', () => {
    const bare = { ...row(), used_by: undefined as unknown as CardRef[] }
    expect(summarizeCard(bare).usedBy).toEqual([])
    expect(summarizeCard(bare).isOrphan).toBe(true)
  })
})

describe('summarizeCard · ข้อความตัวอย่างบนแผ่นการ์ด', () => {
  it('แสดงข้อความอย่างที่เขียนไว้ ตัวแปรยังไม่ถูกแทนค่า', () => {
    expect(view().previewText).toBe('ยินดีด้วย {{attr.name}}')
  })

  /** บล็อกที่ดึงจากชุดเนื้อหามี content เป็น NULL ตาม CHECK ของ card_block */
  it('บล็อกที่ดึงจากชุดเนื้อหา บอกชื่อชุด ไม่ใช่ปล่อยว่าง', () => {
    const card = view({ title_text: null, title_selector: 'คำทำนายประจำวัน' })
    expect(card.previewText).toBe('เลือกจากชุดเนื้อหา "คำทำนายประจำวัน"')
  })

  it('การ์ดที่ยังไม่มีบล็อกข้อความเลย ไม่มีข้อความตัวอย่าง', () => {
    expect(view({ title_text: null, title_selector: null }).previewText).toBeNull()
  })

  it('มีภาพหัวการ์ดหรือไม่ มาจากบล็อกภาพ ไม่ใช่จากชนิดการส่ง', () => {
    expect(view({ has_image: true, render_as: 'text' }).hasImage).toBe(true)
    expect(view({ has_image: false, render_as: 'flex_bubble' }).hasImage).toBe(false)
  })
})

describe('ตัวกรองของ M3-S01', () => {
  const cards = [
    view({ id: 'a', code: 'a', used_by: [ref('activity', 'สุ่ม · การ์ดสำรอง')] }),
    view({ id: 'b', code: 'b', used_by: [ref('keyword', 'คีย์เวิร์ด "เล่น"')] }),
    view({ id: 'c', code: 'c', used_by: [ref('channel', 'บัญชี OA · การ์ดตั้งต้น')] }),
    view({ id: 'd', code: 'd', used_by: [ref('carousel', 'การ์ด parent · ใบในชุดปัด')] }),
    view({ id: 'e', code: 'e', used_by: [ref('stamp', 'บัตรแสตมป์ของค่าสะสม "เช็คอิน"')] }),
    view({ id: 'g', code: 'g', used_by: [ref('richmenu', 'ริชเมนู "หลัก" · ปุ่มบนเมนู')] }),
    view({ id: 'f', code: 'f', used_by: [] }),
  ]
  const codesOf = (filter: Parameters<typeof filterCards>[1]) =>
    filterCards(cards, filter).map((card) => card.code)

  it('ทุกชนิดของผู้อ้างอิงมีตัวกรองของตัวเอง ไม่มีชนิดไหนที่กรองไม่ได้', () => {
    // ตัวกรองมีเท่ากับชนิดทั้งหมด บวก "ทั้งหมด" กับ "ยังไม่ถูกใช้"
    expect(CARD_FILTERS.length).toBe(CARD_REF_KINDS.length + 2)
    for (const kind of CARD_REF_KINDS) {
      const matched = CARD_FILTERS.filter((filter) =>
        filterCards(cards, filter).some((card) => card.usedBy.some((r) => r.kind === kind))
        && filterCards(cards, filter).length === 1)
      expect(matched.length, kind).toBe(1)
    }
  })

  it('ทั้งหมด คืนทุกใบตามลำดับเดิม', () => {
    expect(codesOf('ทั้งหมด')).toEqual(['a', 'b', 'c', 'd', 'e', 'g', 'f'])
  })

  it('กรองตามชนิดของสิ่งที่ชี้มา ได้เฉพาะใบที่ชนิดนั้นชี้', () => {
    expect(codesOf('กิจกรรม')).toEqual(['a'])
    expect(codesOf('คีย์เวิร์ด')).toEqual(['b'])
    expect(codesOf('บัญชี LINE')).toEqual(['c'])
    expect(codesOf('ชุดปัด')).toEqual(['d'])
    expect(codesOf('บัตรแสตมป์')).toEqual(['e'])
    expect(codesOf('ริชเมนู')).toEqual(['g'])
  })

  /**
   * ตัวกรอง "ยังไม่ถูกใช้" ถามการอ้างอิงชุดเดียวกับที่ป้ายบนแผ่นการ์ดถาม
   *
   * Two readings of the same array, so a card cannot be unused to the filter and
   * used to the badge. A boolean column beside them is exactly the arrangement
   * that lets those two disagree.
   */
  it('ยังไม่ถูกใช้ คืนเฉพาะใบที่ไม่มีใครชี้มา และตรงกับป้ายบนแผ่นเสมอ', () => {
    expect(codesOf('ยังไม่ถูกใช้')).toEqual(['f'])
    for (const card of filterCards(cards, 'ยังไม่ถูกใช้')) expect(card.isOrphan).toBe(true)
    for (const card of filterCards(cards, 'ทั้งหมด')) {
      expect(card.isOrphan, card.code).toBe(card.usedBy.length === 0)
    }
  })

  it('การ์ดที่มีคนชี้มาหลายทาง โผล่ในตัวกรองของทุกทางที่ชี้มา', () => {
    const both = [view({
      code: 'both',
      used_by: [ref('activity', 'สุ่ม · การ์ดสำรอง'), ref('keyword', 'คีย์เวิร์ด "เล่น"')],
    })]
    expect(filterCards(both, 'กิจกรรม').map((c) => c.code)).toEqual(['both'])
    expect(filterCards(both, 'คีย์เวิร์ด').map((c) => c.code)).toEqual(['both'])
    expect(filterCards(both, 'ยังไม่ถูกใช้')).toEqual([])
  })

  it('ไม่แก้รายการเดิม · กรองแล้วรายการต้นทางยังครบ', () => {
    const before = cards.length
    filterCards(cards, 'ยังไม่ถูกใช้')
    expect(cards.length).toBe(before)
  })

  it('ค่าที่ปลอมมาจาก URL ตกกลับไปเป็นทั้งหมด ไม่ใช่รายการว่าง', () => {
    for (const junk of ['', 'all', 'ยังไม่ถูกใช้ ', undefined, null]) {
      expect(asCardFilter(junk), String(junk)).toBe('ทั้งหมด')
    }
    expect(asCardFilter('ยังไม่ถูกใช้')).toBe('ยังไม่ถูกใช้')
  })
})
