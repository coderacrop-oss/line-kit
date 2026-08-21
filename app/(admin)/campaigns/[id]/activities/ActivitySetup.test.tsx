// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INPUT_TYPES, RESOLVE_METHODS, fieldsFor, isComboAllowed,
} from '@/lib/activities/wizard'
import {
  type ActivityRow, type ActivityScreen, summarizeActivity,
} from '@/lib/db/activities'
import { ActivitySetup } from './ActivitySetup'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', () => ({
  db: () => { throw new Error('การวาดจอต้องไม่แตะฐานข้อมูล') },
}))
vi.mock('@/lib/auth/require', () => ({ requireRole: vi.fn() }))

const row = (patch: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'act-1',
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

const screenFor = (patch: Partial<ActivityRow> = {}): ActivityScreen => ({
  activity: summarizeActivity(row(patch)),
  cards: [
    { id: 'card-1', code: 'win' },
    { id: 'card-2', code: 'lose' },
  ],
  rewardCodes: ['mug'],
  counterCodes: ['checkin'],
  siblings: [{ id: 'act-9', code: 'daily', name: 'เช็คอินรายวัน' }],
})

type Holder = { id: string; code: string; name: string } | null

const draw = (patch: Partial<ActivityRow> = {}, holder: Holder = null, canEdit = true) =>
  render(
    <ActivitySetup
      campaignId="c1"
      screen={screenFor(patch)}
      followHolder={holder}
      canEdit={canEdit}
    />,
  )

const holder = { id: 'act-hello', code: 'hello', name: 'ทักทายตอนแอด' }

/** คู่แกนที่บันทึกได้จริง · เดินให้ครบทุกคู่ จะได้ไม่มีคู่ไหนหลุดจากการวัด */
const usablePairs = INPUT_TYPES.flatMap((input) =>
  RESOLVE_METHODS.filter((resolve) => isComboAllowed(input, resolve))
    .map((resolve) => [input, resolve] as const))

const configFor = (input: (typeof INPUT_TYPES)[number]): Partial<ActivityRow> => ({
  input_type: input,
  input_config: input === 'pick_one'
    ? { slots: ['ก', 'ข'], grid: '1x3' }
    : input === 'quiz' ? { questions: ['ถามหนึ่ง'] } : {},
})

/**
 * BR-87 · ฟอร์มมาจากนิยามชนิด ไม่ได้เขียนแยกไว้ทีละกิจกรรม
 *
 * The test that matters is not "pick_one shows a slots box" — a screen that
 * switches on the input type passes that too. It is that for every pair the
 * definition allows, everything fieldsFor() returns is on screen and nothing it
 * did not return is. A hand-written form cannot satisfy both halves for sixteen
 * pairs without becoming the loop it was avoiding.
 */
describe('ฟอร์มสร้างจากนิยามชนิด (BR-87)', () => {
  it.each(usablePairs)('%s × %s · ทุกช่องที่นิยามบอก มีอยู่บนจอ', (input, resolve) => {
    draw({ ...configFor(input), resolve_method: resolve, fallback_card_id: 'card-1' })
    for (const field of fieldsFor(input, resolve)) {
      expect(screen.getAllByText(field.label).length, `${input} × ${resolve} · ${field.key}`)
        .toBeGreaterThan(0)
    }
  })

  it.each(usablePairs)('%s × %s · ช่องที่นิยามไม่ได้บอก ไม่โผล่มา', (input, resolve) => {
    draw({ ...configFor(input), resolve_method: resolve, fallback_card_id: 'card-1' })
    const asked = new Set(fieldsFor(input, resolve).map((f) => f.label))
    const everyLabel = new Set(
      INPUT_TYPES.flatMap((i) => RESOLVE_METHODS.flatMap((r) => fieldsFor(i, r).map((f) => f.label))),
    )
    for (const label of everyLabel) {
      if (asked.has(label)) continue
      expect(screen.queryAllByText(label), `${input} × ${resolve} · ${label}`).toEqual([])
    }
  })

  it('กิจกรรมที่ไม่รับอินพุต บอกตรงๆ ว่าบล็อก 2 ไม่มีอะไรให้ตั้ง', () => {
    draw()
    expect(screen.getByText(/ไม่รับอินพุตจากผู้เล่น/)).toBeDefined()
  })

  it('กิจกรรมที่รับอินพุต ไม่ขึ้นประโยคนั้น', () => {
    draw(configFor('pick_one'))
    expect(screen.queryByText(/ไม่รับอินพุตจากผู้เล่น/)).toBeNull()
  })

  it('ค่าที่ตั้งไว้แล้วถูกเติมกลับเข้าช่อง ไม่ใช่ช่องเปล่าทุกครั้งที่เปิดจอ', () => {
    draw(configFor('pick_one'))
    expect((screen.getByLabelText('ป้ายบนแต่ละช่อง · Slots') as HTMLTextAreaElement).value)
      .toBe('ก\nข')
  })

  /** คอลัมน์ของตารางผลลัพธ์ก็มาจากนิยามชนิดเหมือนกัน */
  it('วิธีสุ่มตามโอกาสที่ตั้งไว้ มีช่องน้ำหนักในแถวผลลัพธ์ ไม่มีช่องช่วงคะแนน', () => {
    const { container } = draw()
    expect(container.querySelector('input[name="weight"]')).not.toBeNull()
    expect(container.querySelector('input[name="score_min"]')).toBeNull()
  })

  it('ตัดสินจากคะแนนที่ตอบถูก มีช่องช่วงคะแนน ไม่มีช่องน้ำหนัก', () => {
    const { container } = draw({ ...configFor('quiz'), resolve_method: 'score' })
    expect(container.querySelector('input[name="score_min"]')).not.toBeNull()
    expect(container.querySelector('input[name="score_max"]')).not.toBeNull()
    expect(container.querySelector('input[name="weight"]')).toBeNull()
  })

  it('ได้ตามที่กด ไม่มีทั้งน้ำหนักและช่วงคะแนน', () => {
    const { container } = draw({ ...configFor('pick_one'), resolve_method: 'fixed' })
    expect(container.querySelector('input[name="weight"]')).toBeNull()
    expect(container.querySelector('input[name="score_min"]')).toBeNull()
  })

  /** BR-36 · คู่ที่ engine ตัดสินไม่ได้ ต้องกดเลือกไม่ได้ ไม่ใช่ปล่อยให้กดแล้วค่อยปฏิเสธ */
  it('ตัวเลือกวิธีตัดสินผลที่ผสมกับชนิดอินพุตปัจจุบันไม่ได้ ถูกปิดไว้', () => {
    const { container } = draw()
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>('select[name="resolve_method"] option'),
    )
    const disabled = options.filter((option) => option.disabled).map((option) => option.value)
    expect(disabled.sort()).toEqual(['fixed', 'score'])
  })

  it('ชนิดอินพุตอื่นเปิดตัวเลือกคนละชุด', () => {
    const { container } = draw(configFor('quiz'))
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>('select[name="resolve_method"] option'),
    )
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(['fixed'])
  })
})

/**
 * BR-31 · โควตาต้องมีการ์ดสำรอง
 *
 * The moment the stock runs out is the moment somebody taps and gets nothing
 * back, so the card is asked for on the same save that turns the method into
 * quota — not left as a warning to come back to.
 */
describe('การ์ดสำรองของวิธีแบบโควตา (BR-31)', () => {
  it('โควตามีช่องการ์ดสำรอง และเป็นช่องบังคับ', () => {
    const { container } = draw({ resolve_method: 'quota', fallback_card_id: 'card-1' })
    const select = container.querySelector<HTMLSelectElement>('select[name="fallback_card_id"]')
    expect(select).not.toBeNull()
    expect(select!.required).toBe(true)
  })

  it('ช่องการ์ดสำรองอยู่ในฟอร์มเดียวกับช่องวิธีตัดสินผล', () => {
    const { container } = draw({ resolve_method: 'quota', fallback_card_id: 'card-1' })
    const form = container.querySelector<HTMLSelectElement>('select[name="resolve_method"]')!
      .closest('form')
    expect(form!.querySelector('select[name="fallback_card_id"]')).not.toBeNull()
  })

  it('วิธีอื่นไม่มีช่องนั้น — ไม่มีของให้หมด', () => {
    const { container } = draw()
    expect(container.querySelector('select[name="fallback_card_id"]')).toBeNull()
  })
})

/**
 * BR-90 · ทริกเกอร์ "ตอนแอดเป็นเพื่อน" มีได้ตัวเดียวต่อแคมเปญ
 *
 * Refusing is the easy half and the database already does it. The half that
 * matters on a screen is saying which activity is holding the trigger and
 * giving somewhere to click — the person cannot guess it from a list of twenty
 * and cannot act on a unique-violation code.
 */
describe('กิจกรรมทักทายมีได้ตัวเดียว (BR-90)', () => {
  it('มีตัวอื่นถืออยู่ · จอบอกชื่อของตัวนั้น', () => {
    draw({}, holder)
    expect(screen.getByText(/ทักทายตอนแอด/)).toBeDefined()
  })

  it('มีตัวอื่นถืออยู่ · จอมีลิงก์พาไปแก้ตัวที่ถืออยู่', () => {
    draw({}, holder)
    expect(screen.getByRole('link', { name: /ทักทายตอนแอด/ }).getAttribute('href'))
      .toBe('/campaigns/c1/activities/act-hello')
  })

  it('มีตัวอื่นถืออยู่ · สวิตช์ถูกปิดไว้ กดตั้งทับไม่ได้', () => {
    const { container } = draw({}, holder)
    const toggle = container.querySelector<HTMLInputElement>('input[name="trigger"]')!
    expect(toggle.disabled).toBe(true)
    expect(toggle.checked).toBe(false)
  })

  it('ตัวที่ถืออยู่คือตัวนี้เอง · สวิตช์เปิดอยู่และยังกดปลดได้', () => {
    const { container } = draw({ trigger: 'follow' }, { id: 'act-1', code: 'draw', name: 'สุ่มรางวัล' })
    const toggle = container.querySelector<HTMLInputElement>('input[name="trigger"]')!
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(true)
  })

  it('ตัวที่ถืออยู่คือตัวนี้เอง · ไม่มีคำเตือนว่ามีคนอื่นถือ และไม่มีลิงก์พาไปที่อื่น', () => {
    const { container } = draw({ trigger: 'follow' }, { id: 'act-1', code: 'draw', name: 'สุ่มรางวัล' })
    expect(screen.queryByText(/มีกิจกรรมทักทายอยู่แล้ว/)).toBeNull()
    expect(container.querySelectorAll('a[href*="/activities/"]').length).toBe(0)
  })

  it('ยังไม่มีใครถือ · สวิตช์เปิดให้กดได้', () => {
    const { container } = draw()
    const toggle = container.querySelector<HTMLInputElement>('input[name="trigger"]')!
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(false)
  })
})

describe('สิ่งที่ยังกรอกไม่ครบ', () => {
  it('กิจกรรมที่ยังไม่ครบ ขึ้นรายการของที่ต้องกลับมาทำ', () => {
    draw({ resolve_config: { outcomes: [] } })
    expect(screen.getByText(/ยังกรอกไม่ครบ/)).toBeDefined()
    expect(screen.getByText(/ยังไม่มีผลลัพธ์สักอัน/)).toBeDefined()
  })

  it('กิจกรรมที่ครบแล้ว บอกว่าครบ ไม่ใช่เงียบ', () => {
    draw()
    expect(screen.getByText(/กรอกครบแล้ว/)).toBeDefined()
    expect(screen.queryByText(/ยังกรอกไม่ครบ/)).toBeNull()
  })

  it('ทุกข้อที่ฟ้อง ถูกวาดออกมาครบ ไม่ใช่เอามาแต่ข้อแรก', () => {
    const { container } = draw({
      resolve_config: { outcomes: [{ id: 'o1' }] },
      entry_rules: [{ type: 'has_entitlement' }],
    })
    const listed = container.querySelectorAll('[data-problem]')
    expect(listed.length).toBe(summarizeActivity(row({
      resolve_config: { outcomes: [{ id: 'o1' }] },
      entry_rules: [{ type: 'has_entitlement' }],
    })).problems.length)
    expect(listed.length).toBeGreaterThan(2)
  })
})

describe('เงื่อนไขการเข้าเล่น · บล็อก 1', () => {
  it('ยังไม่มีเงื่อนไข ก็บอกว่าเล่นได้เสมอ', () => {
    draw()
    expect(screen.getByText('ไม่มีเงื่อนไข — ผู้เล่นกดเล่นได้เสมอ')).toBeDefined()
  })

  it('ช่องของเงื่อนไขขึ้นตามชนิดที่ข้อนั้นเป็น', () => {
    const { container } = draw({
      entry_rules: [{ type: 'has_entitlement', cardId: 'card-1', rewardCode: 'mug' }],
    })
    expect(container.querySelector('select[name="rewardCode"]')).not.toBeNull()
    expect(container.querySelector('input[name="key"]')).toBeNull()
  })

  it('เงื่อนไขที่อ้างค่าประจำตัว ขอชื่อค่าประจำตัว ไม่ใช่ขอรางวัล', () => {
    const { container } = draw({
      entry_rules: [{ type: 'has_attribute', cardId: 'card-1', key: 'tier' }],
    })
    expect(container.querySelector('input[name="key"]')).not.toBeNull()
    expect(container.querySelector('select[name="rewardCode"]')).toBeNull()
  })

  it('เงื่อนไขที่อ้างกิจกรรมอื่น เลือกจากกิจกรรมที่มีอยู่จริงในแคมเปญ', () => {
    const { container } = draw({
      entry_rules: [{ type: 'activity_completed', cardId: 'card-1', activityCode: 'daily' }],
    })
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>('select[name="activityCode"] option'),
    ).map((option) => option.value)
    expect(options).toContain('daily')
  })

  it('ทุกเงื่อนไขมีช่องเลือกการ์ดที่ตอบเมื่อไม่ผ่าน (BR-26)', () => {
    const { container } = draw({ entry_rules: [{ type: 'limit', cardId: 'card-1' }] })
    expect(container.querySelector('select[name="card_id"]')).not.toBeNull()
  })

  it('มีฟอร์มเปล่าไว้เพิ่มเงื่อนไขใหม่ต่อท้าย', () => {
    draw()
    expect(screen.getByText('＋ เพิ่มเงื่อนไข')).toBeDefined()
  })
})

describe('ตารางผลลัพธ์ · บล็อก 3', () => {
  it('ผลลัพธ์ที่มีอยู่ ถูกวาดครบทุกแถว', () => {
    const { container } = draw({
      resolve_config: {
        outcomes: [{ id: 'o1', cardId: 'card-1' }, { id: 'o2', cardId: 'card-2' }],
      },
    })
    expect(container.querySelectorAll('[data-outcome]').length).toBe(2)
  })

  it('การ์ดที่ตอบเลือกจากการ์ดของแคมเปญนี้ · เรียกด้วยรหัสเพราะการ์ดไม่มีคอลัมน์ชื่อ', () => {
    const { container } = draw()
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>('[data-outcome] select[name="card_id"] option'),
    ).map((option) => option.value)
    expect(options).toContain('card-1')
    expect(options).toContain('card-2')
  })

  it('รางวัลเลือกจากรางวัลของแคมเปญนี้ · ไม่มีช่องกรอกโควตาซ้ำ (BR-30)', () => {
    const { container } = draw()
    const rewards = container.querySelector('[data-outcome] select[name="reward_code"]')
    expect(rewards).not.toBeNull()
    expect(container.querySelector('[data-outcome] input[name="quota"]')).toBeNull()
  })

  it('มีฟอร์มเปล่าไว้เพิ่มผลลัพธ์ใหม่ต่อท้าย', () => {
    draw()
    expect(screen.getByText('＋ เพิ่มผลลัพธ์')).toBeDefined()
  })
})

/**
 * ค่าสะสมที่กิจกรรมนี้บวกให้ · จอค่าสะสมส่งคนมาที่นี่
 *
 * "ยังไม่มีกิจกรรมเขียนค่าเข้ามา — เพิ่มผลที่ตามมาในตารางผลลัพธ์ของกิจกรรมก่อน"
 * เป็นประโยคที่จอ M7-S03 เขียนไว้ · ถ้าที่นี่ไม่มีช่องนั้น ประโยคนั้นก็ชี้ไปที่ว่างเปล่า
 */
describe('ค่าสะสมที่กิจกรรมนี้บวกให้', () => {
  it('มีช่องกรอกจำนวนของค่าสะสมทุกตัวในแคมเปญ', () => {
    const { container } = draw()
    expect(container.querySelector('input[name="units_checkin"]')).not.toBeNull()
  })

  it('ค่าที่ตั้งไว้แล้วถูกเติมกลับเข้าช่อง', () => {
    const { container } = draw({
      effects: [{ type: 'add_units', counterCode: 'checkin', amount: 3 }],
    })
    expect(container.querySelector<HTMLInputElement>('input[name="units_checkin"]')!.value)
      .toBe('3')
  })

  it('ยังไม่ได้ตั้ง ช่องว่างไว้ ไม่ใช่เติมเลขศูนย์ให้เอง', () => {
    const { container } = draw()
    expect(container.querySelector<HTMLInputElement>('input[name="units_checkin"]')!.value)
      .toBe('')
  })

  it('แคมเปญที่ยังไม่มีค่าสะสม บอกตรงๆ ว่ายังไม่มีให้เลือก', () => {
    render(
      <ActivitySetup
        campaignId="c1"
        screen={{ ...screenFor(), counterCodes: [] }}
        followHolder={null}
        canEdit
      />,
    )
    expect(screen.getByText(/ยังไม่มีค่าสะสมในแคมเปญนี้/)).toBeDefined()
  })
})

describe('สิ่งที่คนแก้ไม่ได้จะไม่เห็น', () => {
  it('คนที่แก้ไม่ได้ ไม่เห็นฟอร์มสักอัน', () => {
    const { container } = draw({}, null, false)
    expect(container.querySelectorAll('form').length).toBe(0)
  })

  it('คนที่แก้ไม่ได้ ยังอ่านค่าที่ตั้งไว้ได้', () => {
    draw({}, null, false)
    expect(screen.getByText(/สรุปการตั้งค่าปัจจุบัน/)).toBeDefined()
  })

  it('รหัสกิจกรรมอ่านได้อย่างเดียวเสมอ แม้คนที่แก้ได้ก็พิมพ์ทับไม่ได้', () => {
    const { container } = draw()
    expect(container.querySelector('input[name="code"]')).toBeNull()
    expect(screen.getByText('draw')).toBeDefined()
  })
})
