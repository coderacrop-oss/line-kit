import { describe, expect, it } from 'vitest'
import {
  asCounterMode, COUNTER_MODES, describeEffect, effectKeyOf, effectOptions, MODE_COPY,
  mergeEffects, summarizeCounter, type CounterRow,
} from './counters'

const catalogue = {
  counterNames: { food: 'อาหาร', checkin_days: 'วันเช็คอิน' },
  rewardCodes: ['discount_100', 'sticker'],
}

const row = (patch: Partial<CounterRow> = {}): CounterRow => ({
  id: 'c1',
  code: 'checkin_days',
  name: 'วันเช็คอิน',
  mode: 'daily_unique',
  require_consecutive: true,
  target: 7,
  participant_count: 0,
  milestones: [],
  writers: [],
  overrides: [],
  has_stamp_card: false,
  ...patch,
})

describe('วิธีนับ', () => {
  it('มีครบสามแบบตามที่ CHECK ของตารางรับ', () => {
    expect([...COUNTER_MODES]).toEqual(['accumulate', 'daily_unique', 'distinct'])
  })

  it('ทุกแบบมีทั้งชื่อและคำอธิบาย', () => {
    for (const mode of COUNTER_MODES) {
      expect(MODE_COPY[mode].name.length, mode).toBeGreaterThan(0)
      expect(MODE_COPY[mode].note.length, mode).toBeGreaterThan(10)
    }
  })

  it('ชื่อของสามแบบไม่ซ้ำกัน — เลือกผิดแบบคือค่าที่สะสมมาแปลคนละความหมาย', () => {
    const names = COUNTER_MODES.map((m) => MODE_COPY[m].name)
    expect(new Set(names).size).toBe(3)
  })

  it('ค่าที่ฟอร์มส่งมาต้องเป็นหนึ่งในสามแบบ ไม่ใช่ข้อความอะไรก็ได้', () => {
    expect(asCounterMode('accumulate')).toBe('accumulate')
    for (const junk of ['', 'ACCUMULATE', 'daily', 'drop table', undefined]) {
      expect(asCounterMode(junk), String(junk)).toBeNull()
    }
  })
})

/**
 * ผลที่ตามมาเก็บเป็น JSONB · จอต้องอ่านของที่คนอื่นเขียนไว้ได้โดยไม่ล้ม
 */
describe('describeEffect', () => {
  it('ให้สิทธิ์รางวัลที่มีอยู่จริง อ่านออกและไม่ตาย', () => {
    const said = describeEffect({ type: 'grant_reward', reward_code: 'discount_100' }, catalogue)
    expect(said.label).toContain('discount_100')
    expect(said.isDead).toBe(false)
  })

  it('ให้สิทธิ์รางวัลที่ไม่มีในแคมเปญ ถือว่าตาย และบอกรหัสที่หาไม่เจอ', () => {
    const said = describeEffect({ type: 'grant_reward', reward_code: 'ไม่มีจริง' }, catalogue)
    expect(said.isDead).toBe(true)
    expect(said.label).toContain('ไม่มีจริง')
  })

  it('บวกค่าสะสมบอกชื่อค่าสะสมและจำนวนที่บวก', () => {
    const said = describeEffect({ type: 'add_units', counter_code: 'food', amount: 5 }, catalogue)
    expect(said.label).toContain('อาหาร')
    expect(said.label).toContain('5')
    expect(said.isDead).toBe(false)
  })

  it('บวกเข้าค่าสะสมที่ไม่มีอยู่ ถือว่าตาย', () => {
    expect(describeEffect({ type: 'add_units', counter_code: 'ghost', amount: 1 }, catalogue).isDead)
      .toBe(true)
  })

  it('ตั้งค่าคุณสมบัติ อ่านออกทั้งคีย์และค่า', () => {
    const said = describeEffect({ type: 'set_attribute', key: 'tier', value: 'gold' }, catalogue)
    expect(said.label).toContain('tier')
    expect(said.label).toContain('gold')
    expect(said.isDead).toBe(false)
  })

  it('ชนิดที่จอนี้ไม่รู้จัก ไม่ทำให้จอล้ม และไม่ถูกอ้างว่าใช้ได้', () => {
    const said = describeEffect({ type: 'launch_rocket' }, catalogue)
    expect(said.isDead).toBe(true)
    expect(said.label).toContain('launch_rocket')
  })

  it('ค่าที่ไม่ใช่ออบเจกต์เลย ก็ยังอ่านได้โดยไม่โยน', () => {
    for (const junk of [null, 'grant_reward', 42, [], undefined]) {
      expect(() => describeEffect(junk, catalogue), String(junk)).not.toThrow()
      expect(describeEffect(junk, catalogue).isDead, String(junk)).toBe(true)
    }
  })
})

describe('effectKeyOf', () => {
  it('รางวัลกับค่าสะสมมีกุญแจของตัวเอง', () => {
    expect(effectKeyOf({ type: 'grant_reward', reward_code: 'sticker' })).toBe('reward:sticker')
    expect(effectKeyOf({ type: 'add_units', counter_code: 'food', amount: 9 })).toBe('counter:food')
  })

  it('ผลที่จอนี้ไม่มีช่องให้ติ๊ก ไม่มีกุญแจ', () => {
    expect(effectKeyOf({ type: 'set_attribute', key: 'a', value: 'b' })).toBeNull()
    expect(effectKeyOf({ type: 'launch_rocket' })).toBeNull()
    expect(effectKeyOf(null)).toBeNull()
  })

  it('ผลที่ไม่มีรหัสปลายทาง ไม่มีกุญแจ — ไม่ใช่กุญแจที่ลงท้ายด้วยค่าว่าง', () => {
    expect(effectKeyOf({ type: 'grant_reward' })).toBeNull()
    expect(effectKeyOf({ type: 'add_units', amount: 1 })).toBeNull()
  })
})

/**
 * ติ๊กช่องแล้วบันทึก · สิ่งที่ห้ามหายไปคือของที่จอนี้ไม่มีช่องให้ติ๊ก
 */
describe('mergeEffects', () => {
  it('ติ๊กเพิ่ม ได้ผลที่ตามมาตัวใหม่ในรูปที่ SQL อ่านได้', () => {
    expect(mergeEffects([], ['reward:sticker'])).toEqual([
      { type: 'grant_reward', reward_code: 'sticker' },
    ])
    expect(mergeEffects([], ['counter:food'])).toEqual([
      { type: 'add_units', counter_code: 'food', amount: 1 },
    ])
  })

  it('เอาติ๊กออก ผลนั้นหายไป', () => {
    const before = [{ type: 'grant_reward', reward_code: 'sticker' }]
    expect(mergeEffects(before, [])).toEqual([])
  })

  it('ติ๊กค้างไว้ ไม่รีเซ็ตจำนวนที่เคยตั้งไว้เป็น 1', () => {
    const before = [{ type: 'add_units', counter_code: 'food', amount: 25 }]
    expect(mergeEffects(before, ['counter:food'])).toEqual(before)
  })

  it('ผลที่จอนี้แสดงเป็นช่องติ๊กไม่ได้ ยังอยู่ครบหลังบันทึก', () => {
    // ไม่มีช่องไหนบนจอแทนมันได้ · ถ้าบันทึกแล้วหาย แปลว่าการกดบันทึกจอนี้
    // ลบของที่คนอื่นตั้งไว้ทิ้งโดยไม่มีอะไรบอก
    const before = [
      { type: 'set_attribute', key: 'tier', value: 'gold' },
      { type: 'grant_reward', reward_code: 'sticker' },
    ]
    expect(mergeEffects(before, [])).toEqual([{ type: 'set_attribute', key: 'tier', value: 'gold' }])
  })

  it('ของเดิมอยู่ตามลำดับเดิม ของใหม่ต่อท้าย', () => {
    const before = [
      { type: 'set_attribute', key: 'tier', value: 'gold' },
      { type: 'grant_reward', reward_code: 'sticker' },
    ]
    expect(mergeEffects(before, ['reward:sticker', 'counter:food'])).toEqual([
      { type: 'set_attribute', key: 'tier', value: 'gold' },
      { type: 'grant_reward', reward_code: 'sticker' },
      { type: 'add_units', counter_code: 'food', amount: 1 },
    ])
  })

  it('กุญแจซ้ำที่ส่งมาสองครั้ง ไม่ได้ผลซ้ำสองตัว', () => {
    expect(mergeEffects([], ['reward:sticker', 'reward:sticker'])).toEqual([
      { type: 'grant_reward', reward_code: 'sticker' },
    ])
  })

  it('กุญแจที่ฟอร์มแต่งขึ้นเอง ถูกทิ้ง ไม่ใช่เขียนลงฐานข้อมูล', () => {
    expect(mergeEffects([], ['nonsense', 'reward:', 'counter:', ''])).toEqual([])
  })

  it('ของเดิมที่ไม่ใช่รายการเลย ไม่ทำให้ล้ม', () => {
    expect(mergeEffects(null, ['reward:sticker']))
      .toEqual([{ type: 'grant_reward', reward_code: 'sticker' }])
  })
})

describe('effectOptions', () => {
  it('เสนอรางวัลทุกตัวและค่าสะสมทุกตัวของแคมเปญ', () => {
    const options = effectOptions(catalogue)
    expect(options.map((o) => o.key)).toEqual([
      'reward:discount_100', 'reward:sticker', 'counter:food', 'counter:checkin_days',
    ])
    expect(options.every((o) => o.isDead)).toBe(false)
  })

  it('ป้ายของค่าสะสมใช้ชื่อที่คนตั้ง ไม่ใช่รหัส', () => {
    expect(effectOptions(catalogue).find((o) => o.key === 'counter:food')?.label)
      .toContain('อาหาร')
  })

  /**
   * ของที่จุดนี้ชี้อยู่แล้วต้องมีช่องของมันเสมอ แม้ปลายทางจะหายไปแล้ว
   *
   * A checkbox that is never drawn cannot be ticked, and the merge treats an
   * unticked box as "remove this". So a milestone pointing at a deleted reward
   * would lose that effect on the next save without anybody choosing to.
   */
  it('ของที่จุดนี้ชี้อยู่แต่ไม่มีในแคมเปญแล้ว ยังมีช่องของตัวเอง และถูกทำเครื่องหมายว่าตาย', () => {
    const options = effectOptions(catalogue, ['reward:ที่ถูกลบไปแล้ว'])
    const dead = options.find((o) => o.key === 'reward:ที่ถูกลบไปแล้ว')
    expect(dead?.isDead).toBe(true)
    expect(dead?.label).toContain('ที่ถูกลบไปแล้ว')
  })

  it('ของที่จุดนี้ชี้อยู่และยังมีอยู่จริง ไม่ถูกเพิ่มซ้ำเป็นช่องที่สอง', () => {
    const keys = effectOptions(catalogue, ['reward:sticker']).map((o) => o.key)
    expect(keys.filter((key) => key === 'reward:sticker')).toHaveLength(1)
  })

  it('กุญแจที่แปลกลับเป็นผลไม่ได้ ยังได้ช่องของตัวเองไว้ไม่ให้ของหาย', () => {
    const options = effectOptions(catalogue, ['อะไรไม่รู้'])
    expect(options.at(-1)).toEqual({ key: 'อะไรไม่รู้', label: 'อะไรไม่รู้', isDead: true })
  })

  it('แคมเปญที่ยังไม่มีรางวัลและไม่มีค่าสะสม ได้รายการว่าง ไม่ใช่ตัวเลือกปลอม', () => {
    expect(effectOptions({ counterNames: {}, rewardCodes: [] })).toEqual([])
  })
})

describe('summarizeCounter', () => {
  it('เรียงจุดปลดล็อกจากน้อยไปมาก ไม่ใช่ตามลำดับที่สร้าง', () => {
    const view = summarizeCounter(row({
      milestones: [
        { id: 'm2', at_value: 7, effects: [] },
        { id: 'm1', at_value: 3, effects: [] },
      ],
    }), catalogue)
    expect(view.milestones.map((m) => m.atValue)).toEqual([3, 7])
  })

  it('หมุดวางตามสัดส่วนของเป้า', () => {
    const view = summarizeCounter(row({
      target: 10,
      milestones: [{ id: 'm1', at_value: 3, effects: [] }],
    }), catalogue)
    expect(view.milestones[0].leftPercent).toBe(30)
  })

  it('จุดที่เกินเป้าไม่ทำให้หมุดหลุดออกนอกแถบ', () => {
    const view = summarizeCounter(row({
      target: 7,
      milestones: [{ id: 'm1', at_value: 60, effects: [] }],
    }), catalogue)
    expect(view.milestones[0].leftPercent).toBe(100)
    expect(view.milestones[0].isBeyondTarget).toBe(true)
  })

  it('จุดที่เท่ากับเป้าพอดี ไม่นับว่าเกิน', () => {
    const view = summarizeCounter(row({
      target: 7,
      milestones: [{ id: 'm1', at_value: 7, effects: [] }],
    }), catalogue)
    expect(view.milestones[0].isBeyondTarget).toBe(false)
  })

  it('เป้าเป็นศูนย์ที่ไม่ควรมีอยู่ ยังได้ตำแหน่งที่วาดได้ ไม่ใช่ค่าที่คำนวณไม่ได้', () => {
    const view = summarizeCounter(row({
      target: 0,
      milestones: [{ id: 'm1', at_value: 3, effects: [] }],
    }), catalogue)
    expect(view.milestones[0].leftPercent).toBe(100)
  })

  it('จุดที่ยังไม่ได้ตั้งผล บอกว่ายังไม่ได้ตั้ง ไม่ใช่ปล่อยว่าง', () => {
    const view = summarizeCounter(row({ milestones: [{ id: 'm1', at_value: 3, effects: [] }] }),
      catalogue)
    expect(view.milestones[0].effectSummary).toContain('ยังไม่ได้ตั้ง')
  })

  it('จุดที่ตั้งผลไว้ เขียนผลทุกตัวออกมาเป็นบรรทัดเดียว', () => {
    const view = summarizeCounter(row({
      milestones: [{
        id: 'm1',
        at_value: 3,
        effects: [
          { type: 'grant_reward', reward_code: 'sticker' },
          { type: 'add_units', counter_code: 'food', amount: 5 },
        ],
      }],
    }), catalogue)
    expect(view.milestones[0].effectSummary).toContain('sticker')
    expect(view.milestones[0].effectSummary).toContain('อาหาร')
    expect(view.milestones[0].effectKeys).toEqual(['reward:sticker', 'counter:food'])
  })

  it('ผลที่ไม่มีช่องให้ติ๊ก ไม่กลายเป็นช่องติ๊กที่ไม่มีอยู่จริง', () => {
    // effectKeys เป็นค่าตั้งต้นของฟอร์ม · กุญแจว่างที่หลุดเข้าไปคือช่องที่ติ๊กค้าง
    // ไว้โดยไม่มีช่องนั้นอยู่บนจอ แล้วผลของมันจะหายตอนกดบันทึก
    const view = summarizeCounter(row({
      milestones: [{
        id: 'm1',
        at_value: 3,
        effects: [{ type: 'set_attribute', key: 'tier', value: 'gold' }],
      }],
    }), catalogue)
    expect(view.milestones[0].effectKeys).toEqual([])
    expect(view.milestones[0].effectSummary).toContain('tier')
  })

  it('ไม่มีกิจกรรมไหนเขียนค่าเข้ามา คือค่าสะสมที่ไม่มีวันเพิ่ม', () => {
    expect(summarizeCounter(row({ writers: [] }), catalogue).hasWriter).toBe(false)
    expect(summarizeCounter(row({ writers: ['เช็คอิน'] }), catalogue).hasWriter).toBe(true)
  })

  it('มีคนสะสมอยู่แล้ว ลบไม่ได้ และเหตุผลบอกทั้งจำนวนคนและว่าค่าจะหายตามไป', () => {
    const view = summarizeCounter(row({ participant_count: 12 }), catalogue)
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('12')
    expect(view.deleteBlockedWhy).toContain('CASCADE')
  })

  it('มีกิจกรรมเขียนค่าเข้ามา ลบไม่ได้ และบอกว่ากิจกรรมไหน', () => {
    const view = summarizeCounter(row({ writers: ['เช็คอินรายวัน'] }), catalogue)
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('เช็คอินรายวัน')
  })

  it('มีบัตรแสตมป์ผูกอยู่ ลบไม่ได้', () => {
    const view = summarizeCounter(row({ has_stamp_card: true }), catalogue)
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('บัตรแสตมป์')
  })

  it('ไม่มีใครเกี่ยวข้องเลย ลบได้ และไม่มีเหตุผลค้างไว้', () => {
    const view = summarizeCounter(row(), catalogue)
    expect(view.canDelete).toBe(true)
    expect(view.deleteBlockedWhy).toBeNull()
  })

  it('บัญชีที่ปรับเป้าทับ ติดมาเป็นรายการของแถวนั้น (DD-06)', () => {
    const view = summarizeCounter(row({ overrides: ['OA Melo Milk → เป้า 14'] }), catalogue)
    expect(view.overrides).toEqual(['OA Melo Milk → เป้า 14'])
  })

  it('วิธีนับถูกแปลเป็นชื่อและคำอธิบายให้จอใช้ต่อ', () => {
    const view = summarizeCounter(row({ mode: 'accumulate' }), catalogue)
    expect(view.modeName).toBe(MODE_COPY.accumulate.name)
    expect(view.modeNote).toBe(MODE_COPY.accumulate.note)
  })
})
