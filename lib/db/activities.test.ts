import { describe, expect, it } from 'vitest'
import {
  ENTRY_RULE_CONTROLS, ENTRY_RULE_FIELDS, ENTRY_RULE_NAME, ENTRY_RULE_TYPES, type ActivityRow,
  activityProblems, activitySummary, asEntryRuleType, comboName, conditionText, summarizeActivity,
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

/**
 * ช่องของเงื่อนไขแต่ละชนิด ถอดจากสิ่งที่ evaluate() กับ passes() อ่านจริง
 *
 * lib/state.ts reads `rewardCode` for has_entitlement and `activityCode` for the
 * three activity conditions; lib/engine/entry.ts reads `count` for limit. None
 * of them reads a generic key/value pair. A screen that wrote one would produce
 * a rule that evaluates to false for every player forever — the campaign refuses
 * everybody at the door and nothing anywhere reports an error, because from the
 * engine's side the condition simply did not hold.
 */
describe('ช่องที่เงื่อนไขแต่ละชนิดต้องกรอก', () => {
  it('ทุกชนิดที่จอเสนอ มีนิยามช่องของตัวเอง', () => {
    for (const type of ENTRY_RULE_TYPES) {
      expect(ENTRY_RULE_FIELDS[type], type).toBeDefined()
    }
  })

  it('ทุกช่องใช้ control ที่จอวาดได้', () => {
    for (const type of ENTRY_RULE_TYPES) {
      for (const field of ENTRY_RULE_FIELDS[type]) {
        expect(ENTRY_RULE_CONTROLS, `${type} · ${field.key}`).toContain(field.control)
      }
    }
  })

  it('ทุกช่องมีป้ายที่คนอ่านออก ไม่ใช่ชื่อคีย์ของ JSON', () => {
    for (const type of ENTRY_RULE_TYPES) {
      for (const field of ENTRY_RULE_FIELDS[type]) {
        expect(field.label.length, `${type} · ${field.key}`).toBeGreaterThan(0)
        expect(field.label).not.toBe(field.key)
      }
    }
  })

  it('คีย์ของทุกชนิด ตรงกับที่ evaluate() และ passes() อ่าน', () => {
    const keysOf = (type: (typeof ENTRY_RULE_TYPES)[number]) =>
      ENTRY_RULE_FIELDS[type].map((f) => f.key)
    expect(keysOf('limit')).toEqual(['count'])
    expect(keysOf('time_window')).toEqual(['hoursOfDay', 'timezone'])
    expect(keysOf('has_attribute')).toEqual(['key', 'value'])
    expect(keysOf('not_has_attribute')).toEqual(['key'])
    expect(keysOf('has_entitlement')).toEqual(['rewardCode'])
    expect(keysOf('activity_completed')).toEqual(['activityCode'])
    expect(keysOf('activity_not_completed')).toEqual(['activityCode'])
    expect(keysOf('activity_play_count')).toEqual(['activityCode', 'op', 'count'])
  })

  /** ค่าที่ขาดแล้วเงื่อนไขเป็นเท็จตลอดกาล ต้องเป็นช่องบังคับ */
  it('รางวัลของ has_entitlement และกิจกรรมของ activity_completed เป็นช่องบังคับ', () => {
    expect(ENTRY_RULE_FIELDS.has_entitlement[0].required).toBe(true)
    expect(ENTRY_RULE_FIELDS.activity_completed[0].required).toBe(true)
    expect(ENTRY_RULE_FIELDS.has_attribute[0].required).toBe(true)
  })

  /** ค่าประจำตัวที่ไม่ระบุค่า = มีคีย์นี้ก็พอ · evaluate() รองรับกรณีนั้นตรงๆ */
  it('ค่าของ has_attribute ไม่บังคับ เพราะ "มีคีย์นี้ก็พอ" เป็นเงื่อนไขที่ใช้ได้จริง', () => {
    const value = ENTRY_RULE_FIELDS.has_attribute.find((f) => f.key === 'value')
    expect(value?.required).toBe(false)
  })
})

describe('เงื่อนไขที่กรอกไม่ครบจนเป็นเท็จตลอดกาล', () => {
  it('เงื่อนไขที่ขาดค่าที่ engine ต้องอ่าน ถูกฟ้องพร้อมบอกว่ากันทุกคนออก', () => {
    const problems = activityProblems(row({
      entry_rules: [{ type: 'has_entitlement', cardId: 'card-2' }],
    }))
    expect(problems.join()).toContain('เงื่อนไขที่ 1')
    expect(problems.join()).toContain('รางวัล')
  })

  it('เงื่อนไขที่กรอกครบ ไม่ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      entry_rules: [{ type: 'has_entitlement', cardId: 'card-2', rewardCode: 'mug' }],
    }))
    expect(problems).toEqual([])
  })

  it('ช่องที่ไม่บังคับ ขาดได้โดยไม่ถูกฟ้อง', () => {
    const problems = activityProblems(row({
      entry_rules: [{ type: 'has_attribute', cardId: 'card-2', key: 'tier' }],
    }))
    expect(problems).toEqual([])
  })

  it('ทุกชนิดที่มีช่องบังคับ ถูกฟ้องเมื่อยังไม่ได้กรอก', () => {
    for (const type of ENTRY_RULE_TYPES) {
      const required = ENTRY_RULE_FIELDS[type].filter((f) => f.required)
      if (required.length === 0) continue
      const problems = activityProblems(row({ entry_rules: [{ type, cardId: 'card-2' }] }))
      expect(problems.join(), type).toContain('เงื่อนไขที่ 1')
    }
  })
})

describe('ประโยคสรุปการตั้งค่าปัจจุบัน', () => {
  it('บอกคู่แกน จำนวนผลลัพธ์ และจำนวนเงื่อนไข', () => {
    const said = activitySummary(summarizeActivity(row({
      entry_rules: [{ type: 'limit', cardId: 'c2', count: 1 }],
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1' }, { id: 'o2', cardId: 'c3' }] },
    })))
    expect(said).toContain('ไม่รับอินพุต × สุ่มตามน้ำหนัก')
    expect(said).toContain('ผลลัพธ์ 2')
    expect(said).toContain('เงื่อนไข 1')
  })

  it('ยังไม่มีผลลัพธ์ ก็ยังนับให้เห็นว่าศูนย์ ไม่ใช่ข้ามไปเงียบๆ', () => {
    const said = activitySummary(summarizeActivity(row({ resolve_config: { outcomes: [] } })))
    expect(said).toContain('ผลลัพธ์ 0')
  })

  /**
   * "เปิดอยู่" มีคำว่า "ปิดอยู่" อยู่ข้างในตั้งแต่ตัวที่สอง
   *
   * toContain('ปิดอยู่') จึงเป็นจริงกับทั้งสองสถานะ และเทสต์ที่เขียนแบบนั้นผ่านได้
   * แม้ประโยคสรุปจะบอกว่าเปิดอยู่ตลอดเวลา · ต้องบังคับฝั่งที่ต้องไม่มีด้วย
   */
  it('กิจกรรมที่ปิดอยู่ บอกว่าปิด และไม่บอกว่าเปิด — ตั้งครบแค่ไหนก็ยังไม่มีใครเล่นได้', () => {
    const off = activitySummary(summarizeActivity(row({ is_enabled: false })))
    expect(off).toContain('ปิดอยู่')
    expect(off).not.toContain('เปิดอยู่')
    expect(activitySummary(summarizeActivity(row()))).toContain('เปิดอยู่')
  })

  it('กิจกรรมทักทายบอกทางเข้าของมัน ไม่ใช่เงียบเพราะไม่มีคีย์เวิร์ดชี้มา', () => {
    const said = activitySummary(summarizeActivity(row({ trigger: 'follow', reached_by: [] })))
    expect(said).toContain('แอดเป็นเพื่อน')
  })

  it('กิจกรรมที่ไม่มีทางเข้าถึง พูดออกมาในประโยคสรุปด้วย', () => {
    expect(activitySummary(summarizeActivity(row({ reached_by: [] }))))
      .toContain('ไม่มีทางเข้าถึง')
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

  /** ช่องของบล็อก 2 ต้องเติมค่าเดิมกลับเข้าไปได้ · ค่านั้นอยู่ใน input_config */
  it('พา input_config ออกมาให้จอเติมค่าเดิมกลับเข้าช่องได้', () => {
    const view = summarizeActivity(row({
      input_type: 'pick_one',
      input_config: { slots: ['ก', 'ข'], grid: '1x3' },
    }))
    expect(view.inputConfig.slots).toEqual(['ก', 'ข'])
    expect(view.inputConfig.grid).toBe('1x3')
  })

  it('input_config ที่ว่างเป็นอ็อบเจกต์เปล่า ไม่ใช่ undefined ที่จอต้องระวังเอง', () => {
    expect(summarizeActivity(row({ input_config: undefined as never })).inputConfig).toEqual({})
  })

  /**
   * ค่าสะสมที่กิจกรรมนี้บวกให้ · ถอดจาก effects ของกิจกรรม ไม่ใช่ของผลลัพธ์
   *
   * planEffects() อ่าน effects ของกิจกรรม และ toSqlEffect() อ่านคีย์ counterCode
   * จอจึงต้องเติมค่าเดิมกลับเข้าช่องจากที่เดียวกันนั้น
   */
  it('พาจำนวนที่บวกให้ค่าสะสมแต่ละตัวออกมาให้จอเติมกลับเข้าช่อง', () => {
    const view = summarizeActivity(row({
      effects: [
        { type: 'grant_reward' },
        { type: 'add_units', counterCode: 'checkin', amount: 2 },
      ],
    }))
    expect(view.counterUnits).toEqual({ checkin: 2 })
  })

  /**
   * ชนิดของผลเป็นตัวตัดสิน ไม่ใช่การมีคีย์ counterCode ติดมา
   *
   * toSqlEffect() แปลงเฉพาะ add_units เป็น counter_code · แถวที่ชนิดเป็นอย่างอื่น
   * แต่มี counterCode ติดมาด้วย (ของเก่าที่เขียนผิด หรือของที่แก้มือ) จะไม่มีวันบวก
   * ค่าสะสมจริง จอจึงต้องไม่แสดงว่ามันบวกอยู่
   */
  it('ผลชนิดอื่นไม่ถูกนับเป็นค่าสะสม แม้จะมี counterCode ติดมาด้วย', () => {
    expect(summarizeActivity(row({ effects: [{ type: 'grant_reward' }] })).counterUnits).toEqual({})
    expect(summarizeActivity(row({
      effects: [{ type: 'set_attribute', counterCode: 'checkin', amount: 5 }],
    })).counterUnits).toEqual({})
  })

  it('add_units ที่ไม่มีชื่อค่าสะสม ถูกข้าม ไม่ใช่กลายเป็นคีย์ว่าง', () => {
    expect(summarizeActivity(row({
      effects: [{ type: 'add_units', amount: 3 }],
    })).counterUnits).toEqual({})
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
