import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  asSelectorReturn, asSelectorSource, CYCLE_SOURCES, describeCondition, isCycleSource,
  MAX_OPTIONS, NEAR_FULL_OPTIONS, parseCondition, RETURN_NAME, SELECTOR_RETURNS,
  SELECTOR_SOURCES, SOURCE_COND_HINT, SOURCE_KEY_HINT, SOURCE_NAME, type SelectorRow,
  summarizeSelector,
} from './selectors'

const migration = readFileSync('supabase/migrations/0001_init.sql', 'utf8')

/** ค่าใน CHECK ของคอลัมน์หนึ่ง อ่านจากไฟล์ migration ตรงๆ ไม่ใช่พิมพ์ซ้ำ */
const checkValues = (column: string): string[] => {
  const found = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(migration)
  return (found?.[1] ?? '').split(',').map((value) => value.trim().replace(/'/g, ''))
}

const row = (patch: Partial<SelectorRow> = {}): SelectorRow => ({
  id: 's1',
  name: 'คำทำนายประจำวัน',
  returns: 'text',
  source_type: 'campaign_day',
  source_key: '7',
  fallback_value: 'วันนี้เป็นวันธรรมดาที่ดี',
  option_count: 3,
  used_by: [],
  ...patch,
})

const view = (patch: Partial<SelectorRow> = {}) => summarizeSelector(row(patch))

describe('ค่าที่ตารางรับ', () => {
  it('คืนอะไร ครบทุกค่าใน CHECK ของ card_selector.returns', () => {
    expect([...SELECTOR_RETURNS].sort()).toEqual(checkValues('returns').sort())
  })

  it('เลือกจากค่าไหน ครบทุกค่าใน CHECK ของ card_selector.source_type', () => {
    expect([...SELECTOR_SOURCES].sort()).toEqual(checkValues('source_type').sort())
  })

  it('ทุกค่ามีชื่อภาษาไทยของตัวเอง ไม่ซ้ำกัน', () => {
    const returns = SELECTOR_RETURNS.map((value) => RETURN_NAME[value])
    const sources = SELECTOR_SOURCES.map((value) => SOURCE_NAME[value])
    expect(new Set(returns).size).toBe(SELECTOR_RETURNS.length)
    expect(new Set(sources).size).toBe(SELECTOR_SOURCES.length)
    for (const name of [...returns, ...sources]) expect(name.length).toBeGreaterThan(0)
  })

  it('ทุกชนิดของค่าที่อ่าน มีคำอธิบายช่องเงื่อนไขและช่องค่าของตัวเอง', () => {
    for (const source of SELECTOR_SOURCES) {
      expect(SOURCE_COND_HINT[source].length, source).toBeGreaterThan(10)
      expect(SOURCE_KEY_HINT[source].length, source).toBeGreaterThan(10)
    }
    expect(new Set(SELECTOR_SOURCES.map((s) => SOURCE_COND_HINT[s])).size)
      .toBe(SELECTOR_SOURCES.length)
  })

  it('ค่าที่ฟอร์มส่งมาต้องอยู่ในรายการ ไม่งั้นเป็น null', () => {
    expect(asSelectorReturn('asset')).toBe('asset')
    expect(asSelectorSource('counter_level')).toBe('counter_level')
    for (const junk of ['', 'CARD', 'image', 'day', undefined, null]) {
      expect(asSelectorReturn(junk), String(junk)).toBeNull()
      expect(asSelectorSource(junk), String(junk)).toBeNull()
    }
  })

  /**
   * source_key มีคอลัมน์เดียวแต่มีความหมายห้าแบบ
   *
   * Two of the five put a cycle length in it and the other three put the name of
   * the value being read. Naming the two here is what lets the edit screen show
   * two boxes over one column without either of them guessing.
   */
  it('มีสองชนิดเท่านั้นที่ source_key เก็บความยาวรอบ', () => {
    expect([...CYCLE_SOURCES]).toEqual(['campaign_day', 'campaign_round'])
    for (const source of SELECTOR_SOURCES) {
      expect(isCycleSource(source), source).toBe(CYCLE_SOURCES.includes(source))
    }
  })
})

/**
 * ช่องเงื่อนไขช่องเดียว กับสามคอลัมน์ที่อยู่ข้างหลัง
 *
 * CHECK (match_value IS NOT NULL OR range_min IS NOT NULL OR range_max IS NOT
 * NULL) refuses a row that fills none of them, so every accepted parse has to
 * fill at least one — and that is asserted on every case below rather than
 * spot-checked.
 */
describe('parseCondition', () => {
  const accepted = (raw: string) => {
    const parsed = parseCondition(raw)
    if (!parsed.ok) throw new Error(`ควรรับ "${raw}" แต่ปฏิเสธ: ${parsed.problem}`)
    return parsed.condition
  }

  it('เลขเดี่ยวเป็นการจับคู่ตรงตัว ไม่ใช่ช่วงกว้างหนึ่ง', () => {
    expect(accepted('3')).toEqual({ match_value: '3', range_min: null, range_max: null })
  })

  it('ข้อความจับคู่ตรงตัว', () => {
    expect(accepted('cat')).toEqual({ match_value: 'cat', range_min: null, range_max: null })
    expect(accepted('big_win').match_value).toBe('big_win')
  })

  it('ตัดช่องว่างหัวท้ายก่อนเก็บ · " cat " กับ "cat" คือค่าเดียวกัน', () => {
    expect(accepted('  cat  ').match_value).toBe('cat')
  })

  it('ช่วงเป็นสองปลาย ไม่ใช่ข้อความ', () => {
    expect(accepted('3-5')).toEqual({ match_value: null, range_min: 3, range_max: 5 })
    expect(accepted('1 - 7')).toEqual({ match_value: null, range_min: 1, range_max: 7 })
  })

  it('ปลายเปิดข้างเดียว เก็บแค่ปลายที่ระบุ', () => {
    expect(accepted('≥3')).toEqual({ match_value: null, range_min: 3, range_max: null })
    expect(accepted('>=3').range_min).toBe(3)
    expect(accepted('≤5')).toEqual({ match_value: null, range_min: null, range_max: 5 })
    expect(accepted('<=5').range_max).toBe(5)
  })

  it('ทุกค่าที่รับ เติมอย่างน้อยหนึ่งในสามคอลัมน์เสมอ — ไม่งั้น CHECK ปฏิเสธ', () => {
    for (const raw of ['3', 'cat', '3-5', '≥3', '≤5', '>=1', '<=9', 'big_win']) {
      const condition = accepted(raw)
      const filled = [condition.match_value, condition.range_min, condition.range_max]
        .filter((value) => value !== null)
      expect(filled.length, raw).toBeGreaterThan(0)
    }
  })

  it('ช่องว่างเปล่าถูกปฏิเสธพร้อมเหตุผล — แถวที่ไม่มีเงื่อนไขไม่มีทางถูกเลือก', () => {
    for (const raw of ['', '   ', '\n']) {
      const parsed = parseCondition(raw)
      expect(parsed.ok, JSON.stringify(raw)).toBe(false)
      if (parsed.ok) throw new Error('unreachable')
      expect(parsed.problem).toContain('ต้องกรอกเงื่อนไข')
    }
  })

  it('ช่วงกลับหัวถูกปฏิเสธ พร้อมบอกว่าอันไหนกลับหัว', () => {
    const parsed = parseCondition('9-2')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.problem).toContain('9-2')
  })

  it('ช่วงที่ปลายเท่ากันรับได้ · 3-3 คือค่าเดียว', () => {
    expect(accepted('3-3')).toEqual({ match_value: null, range_min: 3, range_max: 3 })
  })

  it('ยาวเกิน 100 ตัวถูกปฏิเสธก่อนถึงคอลัมน์', () => {
    const parsed = parseCondition('x'.repeat(101))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.problem).toContain('100')
  })
})

/**
 * อ่านออกมาแล้วแก้แล้วบันทึกกลับ ต้องได้ของเดิม
 *
 * The edit screen renders the stored columns back into the one box a person
 * typed into. If the round trip did not hold, pressing save without touching a
 * row would rewrite it — which is the quietest way to lose a condition.
 */
describe('describeCondition · อ่านกลับเป็นข้อความในช่องเดียว', () => {
  it.each(['3', 'cat', 'big_win', '3-5', '≥3', '≤5', '3-3'])('ไปกลับแล้วได้ "%s" เท่าเดิม', (raw) => {
    const parsed = parseCondition(raw)
    if (!parsed.ok) throw new Error(parsed.problem)
    expect(describeCondition(parsed.condition)).toBe(raw)
  })

  it('รูปที่พิมพ์ต่างกันแต่หมายถึงอย่างเดียวกัน อ่านกลับมาเป็นรูปเดียว', () => {
    const long = parseCondition('>=3')
    if (!long.ok) throw new Error(long.problem)
    expect(describeCondition(long.condition)).toBe('≥3')
  })

  it('แถวที่ไม่มีคอลัมน์ไหนถูกเติมเลย อ่านกลับเป็นค่าว่าง ไม่ใช่ "null"', () => {
    expect(describeCondition({ match_value: null, range_min: null, range_max: null })).toBe('')
  })
})

describe('summarizeSelector · เพดาน 10 ทางเลือก (BR-27)', () => {
  it('เพดานคือสิบ และเตือนตั้งแต่แปด', () => {
    expect(MAX_OPTIONS).toBe(10)
    expect(NEAR_FULL_OPTIONS).toBe(8)
  })

  it('ยังไม่ถึงแปด ไม่เตือนและยังไม่เต็ม', () => {
    const card = view({ option_count: 7 })
    expect(card.isNearFull).toBe(false)
    expect(card.isFull).toBe(false)
  })

  it('ถึงแปดเริ่มเตือน แต่ยังเพิ่มได้', () => {
    const card = view({ option_count: 8 })
    expect(card.isNearFull).toBe(true)
    expect(card.isFull).toBe(false)
  })

  it('ครบสิบเต็ม และไม่เตือนซ้ำอีกเพราะเตือนไปแล้วกลายเป็นคำสั่งคนละอัน', () => {
    const card = view({ option_count: 10 })
    expect(card.isFull).toBe(true)
    expect(card.isNearFull).toBe(false)
  })

  it('บอกจำนวนที่ใช้ไปพร้อมเพดาน ไม่ใช่บอกแค่จำนวน', () => {
    expect(view({ option_count: 4 }).countText).toBe('4/10 ทางเลือก')
  })
})

describe('summarizeSelector · ความยาวรอบที่อยู่ในคอลัมน์เดียวกับชื่อค่า', () => {
  it('ชนิดที่เป็นรอบ อ่าน source_key เป็นจำนวนวัน', () => {
    const card = view({ source_type: 'campaign_day', source_key: '7' })
    expect(card.isCycle).toBe(true)
    expect(card.cycleDays).toBe(7)
    expect(card.cycleText).toBe('รอบละ 7 วัน')
  })

  it('ชนิดที่ไม่ใช่รอบ ไม่ตีความ source_key เป็นตัวเลข แม้ค่าจะเป็นตัวเลข', () => {
    const card = view({ source_type: 'attribute', source_key: '7' })
    expect(card.isCycle).toBe(false)
    expect(card.cycleDays).toBeNull()
    expect(card.cycleText).toBeNull()
    expect(card.sourceKey).toBe('7')
  })

  it('ชนิดที่เป็นรอบแต่ยังไม่ได้ตั้งความยาว ไม่แต่งตัวเลขขึ้นมาเอง', () => {
    for (const key of [null, '', 'สัปดาห์', '7 วัน']) {
      const card = view({ source_type: 'campaign_round', source_key: key })
      expect(card.cycleDays, String(key)).toBeNull()
      expect(card.cycleText, String(key)).toBeNull()
    }
  })
})

describe('summarizeSelector · ใครใช้ชุดนี้ และลบได้ไหม', () => {
  it('ไม่มีบล็อกไหนดึงไปใช้ คือชุดที่ยังไม่มีใครใช้ และลบได้', () => {
    const card = view({ used_by: [] })
    expect(card.isOrphan).toBe(true)
    expect(card.canDelete).toBe(true)
    expect(card.deleteBlockedWhy).toBeNull()
  })

  it('มีบล็อกดึงไปใช้ ลบไม่ได้ และบอกชื่อการ์ดที่ต้องไปแก้ก่อน', () => {
    const card = view({ used_by: ['การ์ด "win" · บล็อก title', 'การ์ด "lose" · บล็อก body'] })
    expect(card.isOrphan).toBe(false)
    expect(card.canDelete).toBe(false)
    expect(card.deleteBlockedWhy).toContain('win')
    expect(card.deleteBlockedWhy).toContain('lose')
  })

  it('ไม่มี used_by ส่งมาเลย ไม่พังและนับเป็นยังไม่มีใครใช้', () => {
    const bare = { ...row(), used_by: undefined as unknown as string[] }
    expect(summarizeSelector(bare).usedBy).toEqual([])
    expect(summarizeSelector(bare).isOrphan).toBe(true)
  })

  it('ของสำรองถูกส่งต่อไปที่จอตรงๆ · คอลัมน์เป็น NOT NULL จึงไม่มีสถานะว่าง', () => {
    expect(view({ fallback_value: 'ขอให้โชคดี' }).fallbackValue).toBe('ขอให้โชคดี')
  })

  it('คำอธิบายช่องเงื่อนไขมาจากชนิดของค่าที่อ่าน ไม่ใช่ค่าคงที่ประโยคเดียว', () => {
    expect(view({ source_type: 'attribute' }).condHint).toBe(SOURCE_COND_HINT.attribute)
    expect(view({ source_type: 'counter_level' }).condHint).toBe(SOURCE_COND_HINT.counter_level)
  })
})
