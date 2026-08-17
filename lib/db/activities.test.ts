import { describe, expect, it } from 'vitest'
import {
  ENTRY_RULE_NAME, ENTRY_RULE_TYPES, type ActivityRow,
  activityProblems, asEntryRuleType, comboName, conditionText, summarizeActivity,
} from './activities'

const row = (patch: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a-1',
  code: 'draw',
  name: 'สุ่มรางวัล',
  input_type: 'none',
  resolve_method: 'weighted',
  input_config: {},
  resolve_config: { outcomes: [{ id: 'o1', cardId: 'card-1' }] },
  entry_rules: [],
  effects: [],
  fallback_card_id: null,
  trigger: 'manual',
  is_enabled: true,
  sort_order: 0,
  reached_by: ['คีย์เวิร์ด "เล่น"'],
  links: ['win'],
  ...patch,
})

describe('ปัญหาที่ทำให้ยังส่งขึ้นไม่ได้', () => {
  it('กิจกรรมที่ครบแล้วไม่มีปัญหาสักข้อ', () => {
    expect(activityProblems(row())).toEqual([])
  })

  it('ผลลัพธ์ที่ยังไม่ได้เลือกการ์ด ถูกฟ้องพร้อมเลขแถว', () => {
    const problems = activityProblems(row({
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'card-1' }, { id: 'o2' }] },
    }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('ผลลัพธ์ที่ 2')
  })

  it('กิจกรรมที่ไม่มีผลลัพธ์เลย ถูกฟ้อง', () => {
    expect(activityProblems(row({ resolve_config: { outcomes: [] } })).join()).toContain('ยังไม่มีผลลัพธ์')
  })

  it('resolve_config ที่ไม่ใช่รายการ ถือว่าไม่มีผลลัพธ์ ไม่ใช่ระเบิด', () => {
    const junk = { outcomes: 'ไม่ใช่รายการ' } as unknown as ActivityRow['resolve_config']
    expect(() => activityProblems(row({ resolve_config: junk }))).not.toThrow()
    expect(activityProblems(row({ resolve_config: junk })).join()).toContain('ยังไม่มีผลลัพธ์')
  })

  /** BR-31 · โควตาต้องมีการ์ดสำรอง */
  it('quota ที่ไม่มีการ์ดสำรอง ถูกฟ้องพร้อมอ้าง BR-31', () => {
    const problems = activityProblems(row({ resolve_method: 'quota', fallback_card_id: null }))
    expect(problems.join()).toContain('BR-31')
  })

  it('quota ที่มีการ์ดสำรองแล้ว ไม่ถูกฟ้องเรื่องนั้น', () => {
    const problems = activityProblems(row({ resolve_method: 'quota', fallback_card_id: 'card-9' }))
    expect(problems.join()).not.toContain('BR-31')
  })

  it('วิธีอื่นที่ไม่มีการ์ดสำรอง ไม่ถูกฟ้อง — ไม่มีของให้หมด', () => {
    for (const method of ['fixed', 'weighted', 'score'] as const) {
      const input = method === 'fixed' ? 'pick_one' : method === 'score' ? 'quiz' : 'none'
      const problems = activityProblems(row({
        resolve_method: method,
        input_type: input,
        fallback_card_id: null,
        input_config: input === 'pick_one' ? { slots: ['ก'] } : input === 'quiz' ? { questions: [{}] } : {},
        resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1', scoreMin: 0, scoreMax: 3 }] },
      }))
      expect(problems.join(), method).not.toContain('BR-31')
    }
  })

  /** BR-26 · ทุกเงื่อนไขต้องมีการ์ดตอบ */
  it('เงื่อนไขที่ไม่มีการ์ดตอบ ถูกฟ้องพร้อมอ้าง BR-26', () => {
    const problems = activityProblems(row({ entry_rules: [{ type: 'limit', count: 1 }] }))
    expect(problems.join()).toContain('BR-26')
    expect(problems.join()).toContain('เงื่อนไขที่ 1')
  })

  it('เงื่อนไขที่มีการ์ดตอบแล้ว ไม่ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      entry_rules: [{ type: 'limit', count: 1, cardId: 'card-2' }],
    }))
    expect(problems).toEqual([])
  })

  it('คู่แกนที่ผสมกันไม่ได้ ถูกฟ้อง (BR-36)', () => {
    const problems = activityProblems(row({ input_type: 'none', resolve_method: 'fixed' }))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toContain('เลือกหนึ่งช่อง')
  })

  it('score ที่ผลลัพธ์ยังไม่มีช่วงคะแนน ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      input_type: 'quiz',
      resolve_method: 'score',
      input_config: { questions: [{ q: 'ถาม' }] },
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1' }] },
    }))
    expect(problems.join()).toContain('ช่วงคะแนน')
  })

  it('score ที่ตั้งช่วงแล้ว ไม่ถูกฟ้องเรื่องช่วง', () => {
    const problems = activityProblems(row({
      input_type: 'quiz',
      resolve_method: 'score',
      input_config: { questions: [{ q: 'ถาม' }] },
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1', scoreMin: 0, scoreMax: 2 }] },
    }))
    expect(problems).toEqual([])
  })

  it('เลือกหนึ่งช่องที่ยังไม่มีช่อง ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      input_type: 'pick_one', resolve_method: 'weighted', input_config: {},
    }))
    expect(problems.join()).toContain('ช่องให้เลือก')
  })

  it('ควิซที่ยังไม่มีคำถาม ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      input_type: 'quiz', resolve_method: 'weighted', input_config: {},
    }))
    expect(problems.join()).toContain('คำถาม')
  })

  it('lookup ยังไม่รองรับ และบอกให้เปลี่ยนวิธี ไม่ใช่เงียบ', () => {
    const problems = activityProblems(row({ resolve_method: 'lookup' }))
    expect(problems.join()).toContain('ยังไม่รองรับ')
  })

  it('ทุกข้อที่ฟ้องอธิบายผลที่ตามมา ไม่ใช่แค่ชื่อกฎ', () => {
    const problems = activityProblems(row({
      resolve_method: 'quota',
      fallback_card_id: null,
      entry_rules: [{ type: 'limit' }],
      resolve_config: { outcomes: [{ id: 'o1' }] },
    }))
    expect(problems.length).toBeGreaterThan(2)
    for (const problem of problems) expect(problem.length).toBeGreaterThan(30)
  })
})

describe('ทางเข้าถึงกิจกรรม', () => {
  it('ไม่มีคีย์เวิร์ดและไม่มีปุ่มชี้มา คือไม่มีทางเข้าถึง', () => {
    expect(summarizeActivity(row({ reached_by: [] })).isUnreachable).toBe(true)
  })

  it('มีทางเข้าอย่างน้อยหนึ่งทาง ไม่นับว่าเข้าไม่ถึง', () => {
    expect(summarizeActivity(row({ reached_by: ['คีย์เวิร์ด "เล่น"'] })).isUnreachable).toBe(false)
  })

  /** กิจกรรมทักทายมีทางเข้าอยู่ในตัวมันเอง · การแอดเป็นเพื่อนคือทางเข้า */
  it('กิจกรรมทักทายไม่นับว่าเข้าไม่ถึง แม้ไม่มีคีย์เวิร์ดชี้มา', () => {
    const view = summarizeActivity(row({ trigger: 'follow', reached_by: [] }))
    expect(view.isUnreachable).toBe(false)
    expect(view.isFollowEntry).toBe(true)
  })

  it('กิจกรรมธรรมดาไม่ถูกทำเป็นกิจกรรมทักทาย', () => {
    expect(summarizeActivity(row()).isFollowEntry).toBe(false)
  })
})

describe('ประโยคสรุปเงื่อนไข', () => {
  it('ไม่มีเงื่อนไข บอกตรงๆ ว่าเล่นได้เสมอ', () => {
    expect(conditionText([])).toContain('เล่นได้เสมอ')
  })

  it('มีเงื่อนไข บอกชื่อของทุกข้อเรียงตามลำดับที่ตรวจ', () => {
    const said = conditionText([{ type: 'limit' }, { type: 'has_attribute' }])
    expect(said).toBe(`${ENTRY_RULE_NAME.limit} · ${ENTRY_RULE_NAME.has_attribute}`)
  })

  it('เงื่อนไขชนิดที่ระบบไม่รู้จัก บอกว่าไม่รู้จัก ไม่ใช่แสดงเป็นช่องว่าง', () => {
    const said = conditionText([{ type: 'ของแปลก' }])
    expect(said).toContain('ไม่รู้จัก')
    expect(said).toContain('ของแปลก')
  })

  it('ชื่อเงื่อนไขครบทุกชนิดที่ engine ตรวจได้ และไม่ซ้ำกัน', () => {
    const names = ENTRY_RULE_TYPES.map((type) => ENTRY_RULE_NAME[type])
    expect(new Set(names).size).toBe(ENTRY_RULE_TYPES.length)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })

  it('รับเฉพาะชนิดเงื่อนไขที่รู้จัก', () => {
    expect(asEntryRuleType('limit')).toBe('limit')
    expect(asEntryRuleType('ของแปลก')).toBeNull()
    expect(asEntryRuleType(undefined)).toBeNull()
  })
})

describe('ชื่อคู่แกนบนหัวจอ', () => {
  it('อ่านเป็น "อินพุต × วิธีตัดสิน"', () => {
    expect(comboName('pick_one', 'weighted')).toBe('เลือกหนึ่งช่อง × สุ่มตามน้ำหนัก')
  })

  it('lookup ยังมีชื่ออ่านได้ ไม่ใช่ค่าดิบจากคอลัมน์', () => {
    expect(comboName('none', 'lookup')).toContain('ค้นจากตาราง')
  })
})

describe('แถวที่จอเอาไปวาด', () => {
  it('พาค่าที่ engine ใช้จริงออกมาโดยไม่แปลงชื่อคีย์', () => {
    const view = summarizeActivity(row({
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1', weight: 3, rewardCode: 'mug' }] },
    }))
    expect(view.outcomes[0].cardId).toBe('c1')
    expect(view.outcomes[0].rewardCode).toBe('mug')
    expect(view.outcomes[0].weight).toBe(3)
  })

  it('กิจกรรมที่ยังกรอกไม่ครบติดธงไว้', () => {
    expect(summarizeActivity(row({ resolve_config: { outcomes: [] } })).isIncomplete).toBe(true)
    expect(summarizeActivity(row()).isIncomplete).toBe(false)
  })

  it('เก็บสถานะเปิดปิดไว้ตามคอลัมน์ ไม่ใช่เดาจากความครบ', () => {
    expect(summarizeActivity(row({ is_enabled: false })).isEnabled).toBe(false)
    expect(summarizeActivity(row({ is_enabled: false, resolve_config: { outcomes: [] } })).isEnabled)
      .toBe(false)
  })
})
