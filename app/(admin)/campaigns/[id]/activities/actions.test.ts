import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

type ActivityRow = {
  id: string
  code: string
  name: string
  input_type: string
  resolve_method: string
  input_config: Record<string, unknown>
  resolve_config: { outcomes?: Array<Record<string, unknown>> }
  entry_rules: Array<Record<string, unknown>>
  effects: Array<Record<string, unknown>>
  fallback_card_id: string | null
  trigger: 'manual' | 'follow'
}

const activity = (patch: Partial<ActivityRow> = {}): ActivityRow => ({
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
  ...patch,
})

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaigns: Record<string, string>
  activities: ActivityRow[]
  cards: string[]
  rewardCodes: string[]
  counterCodes: string[]
  keywordsPointingHere: string[]
  playedCount: number
  writes: Array<{ text: string; values: unknown[] }>
  failNextWriteWith: string | undefined
  /** จำนวนครั้งที่ยังต้องล้มเหลวติดกันด้วยรหัสเดียวกัน ก่อนจะให้ผ่าน · ค่าเริ่มต้นคือ 1 ครั้ง */
  failWriteTimes: number | undefined
  redirectedTo: string | undefined
} = {
  cookie: undefined,
  user: undefined,
  campaigns: { 'camp-1': 'draft' },
  activities: [activity()],
  cards: ['card-1', 'card-9'],
  rewardCodes: ['mug'],
  counterCodes: ['checkin'],
  keywordsPointingHere: [],
  playedCount: 0,
  writes: [],
  failNextWriteWith: undefined,
  failWriteTimes: undefined,
  redirectedTo: undefined,
}

/** ชิ้นส่วนที่ถูกวางไว้ในคำสั่งอื่น เช่น `${where}` · ไม่ใช่คำสั่งที่รันเอง */
type Fragment = { fragment: string; values: unknown[] }
const isFragment = (value: unknown): value is Fragment =>
  typeof value === 'object' && value !== null && 'fragment' in value

const sql = Object.assign(
  (strings: TemplateStringsArray, ...parts: unknown[]) => {
    const own = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    if (/^WHERE/.test(own)) return { fragment: own, values: parts } as Fragment

    const text = [own, ...parts.filter(isFragment).map((f) => f.fragment)].join(' ')
    const values = parts.flatMap((part) => (isFragment(part) ? part.values : [part]))

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM campaign WHERE/.test(text)) {
        const status = state.campaigns[String(values[0])]
        return Promise.resolve(status ? [{ id: values[0], status }] : [])
      }
      if (/FROM activity WHERE .*trigger = 'follow'/.test(text)) {
        const except = values[1] ?? values[2]
        const held = state.activities.find(
          (row) => row.trigger === 'follow' && row.id !== except,
        )
        return Promise.resolve(held ? [held] : [])
      }
      if (/FROM activity WHERE id =/.test(text)) {
        const found = state.activities.find((row) => row.id === values[0])
        return Promise.resolve(found && String(values[1]) === 'camp-1' ? [found] : [])
      }
      if (/FROM card WHERE id =/.test(text)) {
        return Promise.resolve(
          state.cards.includes(String(values[0])) && String(values[1]) === 'camp-1'
            ? [{ id: values[0] }]
            : [],
        )
      }
      if (/FROM reward WHERE/.test(text)) {
        return Promise.resolve(state.rewardCodes.includes(String(values[1])) ? [{ code: values[1] }] : [])
      }
      if (/FROM counter WHERE/.test(text)) {
        return Promise.resolve(
          String(values[0]) === 'camp-1' ? state.counterCodes.map((code) => ({ code })) : [],
        )
      }
      if (/FROM participant_activity/.test(text)) {
        return Promise.resolve([{ count: state.playedCount }])
      }
      if (/FROM keyword_rule/.test(text)) {
        return Promise.resolve(state.keywordsPointingHere.map((keyword) => ({ keyword })))
      }
      return Promise.resolve([])
    }

    if (state.failNextWriteWith) {
      const code = state.failNextWriteWith
      if (state.failWriteTimes && state.failWriteTimes > 1) {
        state.failWriteTimes -= 1
      } else {
        state.failNextWriteWith = undefined
        state.failWriteTimes = undefined
      }
      return Promise.reject(Object.assign(new Error('duplicate key value'), { code }))
    }

    state.writes.push({ text, values })
    return Promise.resolve(/INSERT INTO activity/.test(text) ? [{ id: 'act-new' }] : [])
  },
  { array: (value: unknown) => value, json: (value: unknown) => value },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { state.redirectedTo = to },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const {
  createActivity, deleteActivity, removeEntryRule, removeOutcome, saveActivity,
  saveEffects, saveEntryRule, saveInputConfig, saveOutcome, setActivityEnabled,
  slugifyActivityName,
} = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one)
  }
  return data
}

const createForm = (patch: Record<string, string> = {}) =>
  form({ name: 'สุ่มอีกรอบ', input_type: 'none', resolve_method: 'weighted', ...patch })

const saveForm = (patch: Record<string, string> = {}) =>
  form({ name: 'สุ่มรางวัล', input_type: 'none', resolve_method: 'weighted', ...patch })

const writesTo = (pattern: RegExp) => state.writes.filter((w) => pattern.test(w.text))

/** ค่าที่ถูกเขียนลง JSONB คอลัมน์หนึ่ง · sql.json ในเทสต์นี้ส่งของเดิมกลับมาตรงๆ */
const written = <T>(pattern: RegExp, at = 0): T => writesTo(pattern)[at].values[0] as T

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.campaigns = { 'camp-1': 'draft' }
  state.activities = [activity()]
  state.cards = ['card-1', 'card-9']
  state.rewardCodes = ['mug']
  state.counterCodes = ['checkin']
  state.keywordsPointingHere = []
  state.playedCount = 0
  state.writes = []
  state.failNextWriteWith = undefined
  state.failWriteTimes = undefined
  state.redirectedTo = undefined
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * The screen hides every form from a reporter, which is a hint and not a lock.
 * These nine functions are the door, and a door is open to anyone who knows its
 * name — a fetch with the action id is all it takes.
 */
describe('สิทธิ์ของทุก action', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['createActivity', () => createActivity('camp-1', createForm())],
    ['saveActivity', () => saveActivity('camp-1', 'act-1', saveForm())],
    ['saveInputConfig', () => saveInputConfig('camp-1', 'act-1', form({}))],
    ['saveEffects', () => saveEffects('camp-1', 'act-1', form({ units_checkin: '1' }))],
    ['setActivityEnabled', () => setActivityEnabled('camp-1', 'act-1', false)],
    ['deleteActivity', () => deleteActivity('camp-1', 'act-1')],
    ['saveOutcome', () => saveOutcome('camp-1', 'act-1', -1, form({}))],
    ['removeOutcome', () => removeOutcome('camp-1', 'act-1', 0)],
    ['saveEntryRule', () => saveEntryRule('camp-1', 'act-1', -1, form({ type: 'limit' }))],
    ['removeEntryRule', () => {
      state.activities = [activity({ entry_rules: [{ type: 'limit', cardId: 'card-1' }] })]
      return removeEntryRule('camp-1', 'act-1', 0)
    }],
  ]

  it.each(calls)('%s · ยังไม่เข้าระบบ ทำไม่ได้', async (_name, call) => {
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · อีเมลที่ไม่อยู่ในรายชื่อ ทำไม่ได้', async (_name, call) => {
    state.cookie = 'stranger@example.com'
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · บัญชีที่ถูกถอนสิทธิ์ ทำไม่ได้แม้ยังมีแถวอยู่', async (_name, call) => {
    signedInAs('configurator', false)
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ดูรายงานทำไม่ได้', async (_name, call) => {
    signedInAs('reporter')
    await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  /** กิจกรรมคือกติกาที่ตัดสินว่าใครได้อะไร ไม่ใช่เนื้อหาในการ์ด */
  it.each(calls)('%s · ผู้ดูแลเนื้อหาทำไม่ได้ เพราะนี่เป็นกติกา', async (_name, call) => {
    signedInAs('content_editor')
    await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ตั้งค่าแคมเปญทำได้', async (_name, call) => {
    signedInAs('configurator')
    await call()
    expect(state.writes.length).toBeGreaterThan(0)
  })
})

/**
 * BR-05 · แคมเปญที่ส่งขึ้นแล้ว แก้กิจกรรมไม่ได้
 *
 * The rules a published campaign runs on are what the people playing it agreed
 * to, and campaign_stat has already been counted against them.
 */
describe('แคมเปญที่ส่งขึ้นแล้ว', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['createActivity', () => createActivity('camp-1', createForm())],
    ['saveActivity', () => saveActivity('camp-1', 'act-1', saveForm())],
    ['saveInputConfig', () => saveInputConfig('camp-1', 'act-1', form({}))],
    ['saveEffects', () => saveEffects('camp-1', 'act-1', form({ units_checkin: '1' }))],
    ['setActivityEnabled', () => setActivityEnabled('camp-1', 'act-1', false)],
    ['deleteActivity', () => deleteActivity('camp-1', 'act-1')],
    ['saveOutcome', () => saveOutcome('camp-1', 'act-1', 0, form({}))],
    ['saveEntryRule', () => saveEntryRule('camp-1', 'act-1', -1, form({ type: 'limit' }))],
  ]

  it.each(calls)('%s · แคมเปญที่ published แก้ไม่ได้ และเหตุผลอ้าง BR-05', async (_name, call) => {
    signedInAs('configurator')
    state.campaigns = { 'camp-1': 'published' }
    await expect(call()).rejects.toThrow('BR-05')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · แคมเปญที่ปิดแล้วก็แก้ไม่ได้', async (_name, call) => {
    signedInAs('configurator')
    state.campaigns = { 'camp-1': 'closed' }
    await expect(call()).rejects.toThrow('BR-05')
    expect(state.writes).toEqual([])
  })
})

/**
 * ตัวช่วยแปลงชื่อเป็นรหัส — เอาไว้ในไฟล์เดียวกับ createActivity() ที่ใช้มัน
 *
 * The form used to ask for a code directly, spelling out CODE_PATTERN as a
 * hint. Task 9 removed that field: the code now comes from the name the
 * person already typed, so it never has to be invented twice.
 */
describe('slugifyActivityName', () => {
  // async เพราะไฟล์นี้เป็น 'use server' — export ทุกตัวต้องเป็น Server Action
  // ซึ่ง Next.js รับเฉพาะฟังก์ชัน async เท่านั้น แม้ตัวการคำนวณจะไม่ได้ await อะไรเลย
  it('ตัวพิมพ์เล็กและแทนช่องว่าง/เครื่องหมายด้วยขีดล่าง', async () => {
    await expect(slugifyActivityName('สุ่มรางวัลประจำวัน')).resolves.toMatch(/^[a-z0-9_]{1,20}$/)
    await expect(slugifyActivityName('Daily Draw!')).resolves.toBe('daily_draw')
  })

  it('ชื่อยาว ได้รหัสที่ยังตรงรูปแบบ CODE_PATTERN (1–20 ตัว)', async () => {
    const slug = await slugifyActivityName('a'.repeat(50))
    expect(slug.length).toBeLessThanOrEqual(20)
    expect(slug).toMatch(/^[a-z0-9_]{1,20}$/)
  })

  it('ชื่อที่ไม่เหลือตัวอักษร a-z0-9 เลย ได้ค่าสำรอง ไม่ใช่สตริงว่าง', async () => {
    await expect(slugifyActivityName('！！！')).resolves.toBe('activity')
    await expect(slugifyActivityName('')).resolves.toBe('activity')
  })

  it('เว้นที่ให้ต่อขีดล่างกับเลขสุ่มสี่หลักได้โดยไม่เกิน 20 ตัว', async () => {
    const slug = await slugifyActivityName('x'.repeat(50))
    expect(`${slug}_9999`.length).toBeLessThanOrEqual(20)
  })
})

describe('createActivity', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ไม่มีชื่อ ถูกปฏิเสธ', async () => {
    await expect(createActivity('camp-1', createForm({ name: '  ' })))
      .rejects.toThrow('ชื่อกิจกรรม')
    expect(state.writes).toEqual([])
  })

  it('ชนิดอินพุตหรือวิธีตัดสินผลที่ตารางไม่รับ ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    await expect(createActivity('camp-1', createForm({ input_type: 'lookup' })))
      .rejects.toThrow('วิธีรับอินพุต')
    await expect(createActivity('camp-1', createForm({ resolve_method: 'lookup' })))
      .rejects.toThrow('วิธีตัดสินผล')
    expect(state.writes).toEqual([])
  })

  /** BR-36 · คู่ที่ engine ตัดสินไม่ได้ ต้องไม่ถูกสร้างขึ้นมาตั้งแต่แรก */
  it('คู่แกนที่ผสมกันไม่ได้ ถูกปฏิเสธตั้งแต่ตอนสร้าง', async () => {
    await expect(createActivity('camp-1', createForm({ resolve_method: 'fixed' })))
      .rejects.toThrow('ให้เลือกจากตาราง')
    expect(state.writes).toEqual([])
  })

  it('คู่ที่ผสมกันได้ ถูกสร้าง และพาไปหน้าตั้งค่าต่อ', async () => {
    await createActivity('camp-1', createForm({ input_type: 'pick_one', resolve_method: 'fixed' }))
    expect(writesTo(/INSERT INTO activity/)).toHaveLength(1)
    expect(state.redirectedTo).toBe('/campaigns/camp-1/activities/act-new')
  })

  it('รหัสถูกสร้างจากชื่อเอง ไม่มีช่องกรอกรหัสในฟอร์มอีกต่อไป', async () => {
    await createActivity('camp-1', createForm({ name: 'Daily Draw!' }))
    const [insert] = writesTo(/INSERT INTO activity/)
    expect(insert.values[1]).toBe('daily_draw')
  })

  /**
   * รหัสที่สร้างจากชื่อชนกับกิจกรรมอื่นในแคมเปญเดียวกัน
   *
   * A person naming two activities the same thing should not have to learn
   * what a slug collision is — the action retries once with a random suffix
   * instead of surfacing the clash as an error.
   */
  it('รหัสที่สร้างจากชื่อชนกัน ลองอีกครั้งด้วยเลขต่อท้าย โดยไม่ถามผู้ใช้', async () => {
    state.failNextWriteWith = '23505'
    await createActivity('camp-1', createForm({ name: 'Daily Draw!' }))
    const inserts = writesTo(/INSERT INTO activity/)
    expect(inserts).toHaveLength(1)
    expect(String(inserts[0].values[1])).toMatch(/^daily_draw_\d{4}$/)
    expect(state.redirectedTo).toBe('/campaigns/camp-1/activities/act-new')
  })

  it('ชนกันสองรอบติด (รอบต่อท้ายก็ชน) ได้ประโยคทางออก ไม่ใช่ error ดิบจากฐานข้อมูล', async () => {
    state.failNextWriteWith = '23505'
    state.failWriteTimes = 2
    await expect(createActivity('camp-1', createForm({ name: 'Daily Draw!' })))
      .rejects.toThrow('มีกิจกรรมรหัส "daily_draw" อยู่แล้ว')
    expect(state.writes).toEqual([])
  })

  it('ข้อผิดพลาดอื่นของฐานข้อมูล ไม่ถูกแปลงเป็นเรื่องรหัสซ้ำ และไม่ลองซ้ำ', async () => {
    state.failNextWriteWith = '23503'
    await expect(createActivity('camp-1', createForm())).rejects.toThrow('duplicate key value')
    expect(state.writes).toEqual([])
  })
})

/**
 * personality_quiz ไม่มี resolve_method เลย (Task 10) — 0014_quiz_engine.sql บังคับด้วย
 * CHECK ว่าคอลัมน์นี้เป็น NULL ได้ก็ต่อเมื่อ input_type เป็นชนิดนี้เท่านั้น ฟอร์มสร้างจึง
 * ถามโหมด (เดี่ยว/คู่) แทนทั้งช่องแกน 2 ไม่ใช่แค่ปิดตัวเลือกบางอันแบบ BR-36 ทำกับสี่ชนิดเดิม
 */
describe('createActivity · personality_quiz ไม่มี resolve_method (Task 10)', () => {
  beforeEach(() => signedInAs('configurator'))

  const quizForm = (patch: Record<string, string> = {}) =>
    createForm({ input_type: 'personality_quiz', quiz_mode: 'solo', ...patch })

  /**
   * Task 11 · จอ M7-S02 เดิม (../[activityId]/page.tsx) throw TypeError ทันทีที่
   * เจอ resolve_method เป็น NULL (BY_RESOLVE[null] เป็น undefined แล้ว spread ก็
   * throw — พิสูจน์จริงตอนรีวิว Task 10) การ redirect ไปที่นั่นแบบเดิมจึงพากิจกรรม
   * ควิซบุคลิกภาพทุกตัวไปหน้าที่พังทันทีที่โหลด ต้องพาไปจอควิซของ Task 11 แทน
   */
  it('สร้างได้โดยไม่ต้องมี resolve_method ที่ใช้งานได้ในฟอร์ม เขียนเป็น NULL และพาไปจอควิซของ Task 11', async () => {
    await createActivity('camp-1', quizForm({ resolve_method: '' }))
    const [insert] = writesTo(/INSERT INTO activity/)
    expect(insert.values[4]).toBeNull()
    expect(state.redirectedTo).toBe('/campaigns/camp-1/activities/act-new/quiz')
  })

  it('เก็บโหมดที่เลือกไว้ใน input_config — ยังไม่แตะ axes/questions/results (Task 11 กรอกทีหลัง)', async () => {
    await createActivity('camp-1', quizForm({ quiz_mode: 'duo' }))
    const [insert] = writesTo(/INSERT INTO activity/)
    expect(insert.values[5]).toEqual({ mode: 'duo' })
  })

  it('โหมดที่ไม่ใช่ solo/duo ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    await expect(createActivity('camp-1', quizForm({ quiz_mode: 'ทั้งคู่' })))
      .rejects.toThrow('โหมด')
    expect(state.writes).toEqual([])
  })

  it('ไม่เลือกโหมดเลย ถูกปฏิเสธ', async () => {
    await expect(createActivity('camp-1', quizForm({ quiz_mode: '' })))
      .rejects.toThrow('โหมด')
    expect(state.writes).toEqual([])
  })

  /** BR-36 ตรวจเฉพาะคู่ที่มี resolve_method จริง — ควิซบุคลิกภาพไม่มีให้ตรวจ */
  it('ไม่มีการเรียก comboProblem/BR-36 กับควิซบุคลิกภาพ — สร้างผ่านแม้ resolve_method หายไปทั้งช่อง', async () => {
    const form = new FormData()
    form.append('name', 'ควิซนิสัยการช้อป')
    form.append('input_type', 'personality_quiz')
    form.append('quiz_mode', 'solo')
    // ไม่มี resolve_method อยู่ใน FormData เลย ต่างจาก quizForm() ที่ยังส่งมาเฉยๆ
    await createActivity('camp-1', form)
    expect(writesTo(/INSERT INTO activity/)).toHaveLength(1)
  })
})

describe('saveActivity · ตัวตนและสองแกน', () => {
  beforeEach(() => signedInAs('configurator'))

  it('กิจกรรมของแคมเปญอื่น แก้ผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    state.campaigns = { 'camp-1': 'draft', 'camp-2': 'draft' }
    await expect(saveActivity('camp-2', 'act-1', saveForm()))
      .rejects.toThrow('ไม่พบกิจกรรมนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  /**
   * รหัสกิจกรรมเดินทางอยู่ในปุ่มที่ส่งออกไปแล้ว
   *
   * lib/match/postback.ts writes it into every button as `a=<code>`, and those
   * cards are already sitting in people's chats. Renaming turns each of them
   * into a tap that resolves to nothing.
   */
  it('รหัสที่ส่งแอบมาตอนแก้ ไม่ถูกเขียนทับของเดิม', async () => {
    await saveActivity('camp-1', 'act-1', saveForm({ code: 'รหัสใหม่ที่ส่งแอบมา' }))
    const [update] = writesTo(/UPDATE activity/)
    expect(update.text).not.toContain('code =')
    expect(update.values).not.toContain('รหัสใหม่ที่ส่งแอบมา')
  })

  it('คู่แกนที่ผสมกันไม่ได้ ห้ามบันทึก (BR-36)', async () => {
    await expect(saveActivity('camp-1', 'act-1', saveForm({ resolve_method: 'score' })))
      .rejects.toThrow('ตอบคำถาม')
    expect(state.writes).toEqual([])
  })

  /** BR-31 · โควตาต้องมีการ์ดสำรอง */
  it('เปลี่ยนเป็นโควตาโดยไม่เลือกการ์ดสำรอง ถูกปฏิเสธพร้อมอ้าง BR-31', async () => {
    await expect(saveActivity('camp-1', 'act-1', saveForm({ resolve_method: 'quota' })))
      .rejects.toThrow('BR-31')
    expect(state.writes).toEqual([])
  })

  it('โควตาที่มีการ์ดสำรองแล้ว บันทึกได้', async () => {
    await saveActivity('camp-1', 'act-1',
      saveForm({ resolve_method: 'quota', fallback_card_id: 'card-9' }))
    expect(writesTo(/UPDATE activity/)).toHaveLength(1)
  })

  it('การ์ดสำรองของแคมเปญอื่น ใช้ไม่ได้', async () => {
    await expect(saveActivity('camp-1', 'act-1',
      saveForm({ resolve_method: 'quota', fallback_card_id: 'card-ของคนอื่น' })))
      .rejects.toThrow('การ์ดของแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  /**
   * Finding 2 ของรีวิวรอบสุดท้าย · จอนี้ไม่มีทางเขียน personality_quiz ให้ถูกกติกา
   * ได้เลย (resolve_method ต้องเป็น NULL เท่านั้นตาม 0014_quiz_engine.sql แต่ฟอร์ม
   * นี้ส่ง resolve_method ที่เป็นค่าจริงมาเสมอ) — ก่อนแก้ ค่านี้จะหลุดผ่าน
   * comboProblem() ไปเขียนทับจนชน CHECK ของฐานข้อมูลแทน ซึ่งกลายเป็น error ดิบที่
   * ถูกเซ็นเซอร์แบบทั่วไปให้ผู้ใช้เห็น ไม่ใช่ข้อความที่บอกทางแก้
   */
  it('เลือกชนิดอินพุตเป็นควิซบุคลิกภาพจากจอนี้ ถูกปฏิเสธด้วยข้อความที่บอกทางแก้', async () => {
    await expect(saveActivity('camp-1', 'act-1', saveForm({ input_type: 'personality_quiz' })))
      .rejects.toThrow('ควิซบุคลิกภาพ')
    expect(state.writes).toEqual([])
  })

  /**
   * รีวิวรอบสอง (ต่อจาก Finding 2) · ด่านข้างบนเช็คแค่ input_type ที่ "ส่งมา" —
   * ไม่ได้กันกรณีกลับกัน คือกิจกรรมที่เป็นควิซอยู่แล้วถูกแก้จากจอนี้ (URL ตรงมาเอง
   * ไม่ผ่าน ActivityRow.tsx) ช่อง input_type ในฟอร์มไม่มี personality_quiz เป็น
   * ตัวเลือกอีกต่อไป defaultValue ที่ไม่ตรงกับ option ไหนเลยจะให้เบราว์เซอร์เลือก
   * ตัวแรกในลิสต์ ('none') แทนอย่างเงียบๆ กดบันทึกแล้วจะเขียนทับ input_type เป็น
   * 'none' พร้อม resolve_method จริง ตัดขาด input_config (แกน/คำถาม/ผลลัพธ์) ของ
   * ควิซออกจากกิจกรรมอย่างเงียบๆ ไม่มีจอไหนแสดง/แก้มันได้อีกเลย — แย่กว่า CHECK
   * constraint เดิมที่อย่างน้อยยัง error ดังๆ ให้เห็น เช็คจากชนิดเดิมของแถวกัน
   */
  it('กิจกรรมที่เป็นควิซบุคลิกภาพอยู่แล้ว แก้จากจอนี้ไม่ได้ไม่ว่าฟอร์มจะส่งชนิดอะไรมา', async () => {
    state.activities = [activity({
      id: 'act-1', input_type: 'personality_quiz', resolve_method: null as unknown as string,
    })]
    await expect(saveActivity('camp-1', 'act-1', saveForm({ input_type: 'none' })))
      .rejects.toThrow('ควิซบุคลิกภาพ')
    expect(state.writes).toEqual([])
  })
})

/**
 * BR-90 · ทริกเกอร์ "ตอนแอดเป็นเพื่อน" มีได้ตัวเดียวต่อแคมเปญ
 *
 * The partial unique index refuses the second one on its own, so this is not
 * what makes the rule true. What it adds is the name of the activity already
 * holding it and the address to go and take it away — a unique-violation code
 * tells the person nothing they can act on, and the activity they need is not
 * something they can guess from a list of twenty.
 */
describe('BR-90 · กิจกรรมทักทายมีได้ตัวเดียว', () => {
  beforeEach(() => {
    signedInAs('configurator')
    state.activities = [
      activity(),
      activity({ id: 'act-hello', code: 'hello', name: 'ทักทาย', trigger: 'follow' }),
    ]
  })

  it('ตั้งตัวที่สองเป็นกิจกรรมทักทาย ถูกปฏิเสธ', async () => {
    await expect(saveActivity('camp-1', 'act-1', saveForm({ trigger: 'follow' })))
      .rejects.toThrow('BR-90')
    expect(state.writes).toEqual([])
  })

  it('คำปฏิเสธบอกชื่อและรหัสของกิจกรรมที่ถืออยู่ ไม่ใช่ชื่อ constraint', async () => {
    const said = await saveActivity('camp-1', 'act-1', saveForm({ trigger: 'follow' }))
      .then(() => '', (error: Error) => error.message)

    // ตัดที่อยู่ออกก่อนแล้วค่อยตรวจ · รหัส act-hello อยู่ใน URL ด้วย เทสต์ที่ค้นทั้งประโยค
    // จึงผ่านได้แม้ประโยคจะไม่ได้เอ่ยชื่อกิจกรรมที่ถืออยู่เลยสักคำ
    const withoutAddress = said.replace(/\/campaigns\/\S+/g, '')
    expect(withoutAddress).toContain('ทักทาย')
    expect(withoutAddress).toContain('hello')
  })

  it('คำปฏิเสธมีที่อยู่ของกิจกรรมนั้นให้กดไปแก้ ไม่ใช่แค่บอกว่าทำไม่ได้', async () => {
    await expect(saveActivity('camp-1', 'act-1', saveForm({ trigger: 'follow' })))
      .rejects.toThrow('/campaigns/camp-1/activities/act-hello')
  })

  it('ตัวที่ถืออยู่แล้ว บันทึกทับตัวเองได้ ไม่ถูกกันด้วยกฎที่มันเป็นเจ้าของ', async () => {
    await saveActivity('camp-1', 'act-hello', saveForm({ trigger: 'follow' }))
    expect(writesTo(/UPDATE activity/)).toHaveLength(1)
  })

  it('ปลดตัวที่ถืออยู่กลับเป็นธรรมดา ทำได้', async () => {
    await saveActivity('camp-1', 'act-hello', saveForm({ trigger: 'manual' }))
    expect(writesTo(/UPDATE activity/)[0].values).toContain('manual')
  })

  it('ไม่มีใครถืออยู่ ตั้งได้เลย', async () => {
    state.activities = [activity()]
    await saveActivity('camp-1', 'act-1', saveForm({ trigger: 'follow' }))
    expect(writesTo(/UPDATE activity/)[0].values).toContain('follow')
  })

  /** ดัชนีบางส่วนของตารางเป็นด่านสุดท้าย · สองคนกดพร้อมกันยังมาถึงตรงนี้ได้ */
  it('ชนกันที่ระดับตาราง ยังได้ประโยคที่บอกว่าใครถืออยู่', async () => {
    state.activities = [activity()]
    state.failNextWriteWith = '23505'
    state.activities.push(activity({ id: 'act-hello', code: 'hello', name: 'ทักทาย', trigger: 'follow' }))
    await expect(saveActivity('camp-1', 'act-1', saveForm({ trigger: 'follow' })))
      .rejects.toThrow('BR-90')
  })
})

/**
 * BR-87 · ช่องที่บันทึกได้ มาจาก fieldsFor() ไม่ใช่จากรายการที่พิมพ์ไว้ใน action
 */
describe('saveInputConfig · ฟอร์มที่สร้างจากนิยามชนิด', () => {
  beforeEach(() => signedInAs('configurator'))

  it('กิจกรรมที่กดปุ่มเดียวจบ ไม่เขียนอะไรลง input_config แม้จะมีคนยัดค่ามา', async () => {
    await saveInputConfig('camp-1', 'act-1', form({ slots: 'ก\nข', prompt: 'พิมพ์มาสิ' }))
    expect(written<Record<string, unknown>>(/UPDATE activity SET input_config/)).toEqual({})
  })

  it('ให้เลือกจากตาราง เก็บผังช่องและป้ายของแต่ละช่อง', async () => {
    state.activities = [activity({ input_type: 'pick_one' })]
    await saveInputConfig('camp-1', 'act-1', form({ grid: '3x3', slots: 'ก\nข\nค' }))
    expect(written<{ grid: string; slots: string[] }>(/UPDATE activity SET input_config/))
      .toMatchObject({ grid: '3x3', slots: ['ก', 'ข', 'ค'] })
  })

  it('บรรทัดว่างกับช่องว่างหน้าหลัง ไม่กลายเป็นช่องเปล่าในผัง', async () => {
    state.activities = [activity({ input_type: 'pick_one' })]
    await saveInputConfig('camp-1', 'act-1', form({ grid: '1x3', slots: ' ก \n\n ข \n' }))
    expect(written<{ slots: string[] }>(/UPDATE activity SET input_config/).slots)
      .toEqual(['ก', 'ข'])
  })

  it('สวิตช์ที่ไม่ได้ติ๊ก เก็บเป็น false ไม่ใช่หายไปจาก config', async () => {
    state.activities = [activity({ input_type: 'pick_one' })]
    await saveInputConfig('camp-1', 'act-1', form({ grid: '1x3', slots: 'ก' }))
    expect(written<{ meaningful: boolean }>(/UPDATE activity SET input_config/).meaningful)
      .toBe(false)
  })

  it('สวิตช์ที่ติ๊ก เก็บเป็น true', async () => {
    state.activities = [activity({ input_type: 'pick_one' })]
    await saveInputConfig('camp-1', 'act-1', form({ grid: '1x3', slots: 'ก', meaningful: 'on' }))
    expect(written<{ meaningful: boolean }>(/UPDATE activity SET input_config/).meaningful)
      .toBe(true)
  })

  it('ควิซเก็บชุดคำถาม · ชนิดที่ไม่ใช่ควิซเก็บไม่ได้', async () => {
    state.activities = [activity({ input_type: 'quiz' })]
    await saveInputConfig('camp-1', 'act-1', form({ questions: 'ถามหนึ่ง\nถามสอง' }))
    expect(written<{ questions: string[] }>(/UPDATE activity SET input_config/).questions)
      .toEqual(['ถามหนึ่ง', 'ถามสอง'])
  })

  it('พิมพ์ข้อความเก็บข้อความชวนให้พิมพ์', async () => {
    state.activities = [activity({ input_type: 'text' })]
    await saveInputConfig('camp-1', 'act-1', form({ prompt: 'พิมพ์ชื่อเมนูที่ชอบ' }))
    expect(written<{ prompt: string }>(/UPDATE activity SET input_config/).prompt)
      .toBe('พิมพ์ชื่อเมนูที่ชอบ')
  })

  /**
   * ค่าที่ชนิดปัจจุบันไม่ได้ถาม ยังอยู่ครบ
   *
   * Somebody switching an activity from ตอบคำถาม to ให้เลือกจากตาราง to look at
   * the difference should not come back to find their questions deleted.
   */
  it('ค่าของชนิดอื่นที่เคยตั้งไว้ ไม่ถูกลบทิ้งตอนบันทึกชนิดปัจจุบัน', async () => {
    state.activities = [activity({
      input_type: 'pick_one',
      input_config: { questions: ['ถามเก่า'] },
    })]
    await saveInputConfig('camp-1', 'act-1', form({ grid: '1x3', slots: 'ก' }))
    expect(written<{ questions: string[] }>(/UPDATE activity SET input_config/).questions)
      .toEqual(['ถามเก่า'])
  })

  it('บันทึกผูก campaign_id ไว้ใน WHERE ไม่ใช่แก้ด้วย id เปล่าๆ', async () => {
    await saveInputConfig('camp-1', 'act-1', form({}))
    expect(writesTo(/UPDATE activity SET input_config/)[0].values).toContain('camp-1')
  })
})

describe('saveOutcome', () => {
  beforeEach(() => signedInAs('configurator'))

  it('แถวใหม่ต่อท้าย และได้ id ที่ไม่ซ้ำกับของเดิม', async () => {
    await saveOutcome('camp-1', 'act-1', -1, form({ card_id: 'card-9', label: 'รางวัลที่สอง' }))
    const outcomes = written<{ outcomes: Array<{ id: string }> }>(/UPDATE activity/).outcomes
    expect(outcomes).toHaveLength(2)
    expect(outcomes[1].id).not.toBe(outcomes[0].id)
  })

  it('แถวที่ไม่มีอยู่ ไม่ถูกสร้างขึ้นมาเงียบๆ', async () => {
    await expect(saveOutcome('camp-1', 'act-1', 7, form({ card_id: 'card-9' })))
      .rejects.toThrow('ไม่พบผลลัพธ์แถวนี้')
    expect(state.writes).toEqual([])
  })

  it('การ์ดของแคมเปญอื่น ผูกเป็นการ์ดที่ตอบไม่ได้', async () => {
    await expect(saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-ของคนอื่น' })))
      .rejects.toThrow('การ์ดของแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('รางวัลที่ไม่ได้อยู่ในแคมเปญนี้ ผูกไม่ได้', async () => {
    await expect(saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1', reward_code: 'ไม่มีจริง' })))
      .rejects.toThrow('ไม่ได้อยู่ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  /**
   * คีย์ที่เขียนลง JSONB คือคีย์ที่ lib/engine/resolve.ts อ่าน
   *
   * The engine reads cardId, weight, rewardCode, scoreMin and scoreMax off the
   * JSONB untouched. snake_case here would produce outcomes the engine parses as
   * having no card and no reward — a campaign that answers nobody.
   */
  it('เขียนคีย์ตามที่ engine อ่าน ไม่ใช่ตามชื่อคอลัมน์', async () => {
    await saveOutcome('camp-1', 'act-1', 0,
      form({ card_id: 'card-9', reward_code: 'mug', weight: '3', label: 'แก้ว' }))
    const [first] = written<{ outcomes: Array<Record<string, unknown>> }>(/UPDATE activity/).outcomes
    expect(first).toEqual({ id: 'o1', label: 'แก้ว', cardId: 'card-9', rewardCode: 'mug', weight: 3 })
  })

  it('ช่องที่เว้นว่าง ถูกถอดออกจาก JSON ไม่ใช่เก็บเป็น null', async () => {
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-9', weight: '', score_min: '' }))
    const [first] = written<{ outcomes: Array<Record<string, unknown>> }>(/UPDATE activity/).outcomes
    expect(Object.keys(first)).toEqual(['id', 'cardId'])
  })

  it('น้ำหนักที่ไม่ใช่จำนวนเต็มไม่ติดลบ ถูกปฏิเสธ', async () => {
    for (const weight of ['-1', '2.5', 'สาม']) {
      await expect(saveOutcome('camp-1', 'act-1', 0, form({ weight })), weight)
        .rejects.toThrow('น้ำหนัก')
    }
    expect(state.writes).toEqual([])
  })

  it('ช่วงคะแนนที่กลับหัวกลับหาง ถูกปฏิเสธ เพราะไม่มีคะแนนไหนเข้าได้', async () => {
    await expect(saveOutcome('camp-1', 'act-1', 0, form({ score_min: '5', score_max: '2' })))
      .rejects.toThrow('ไม่มากกว่า')
    expect(state.writes).toEqual([])
  })

  it('ช่วงคะแนนที่ต่ำสุดเท่ากับสูงสุด ยังบันทึกได้ · ช่วงนับรวมปลายทั้งสองข้าง', async () => {
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1', score_min: '3', score_max: '3' }))
    expect(writesTo(/UPDATE activity/)).toHaveLength(1)
  })

  /**
   * ผลลัพธ์ที่แจกรางวัล ต้องมี grant_reward อยู่ใน effects ของกิจกรรมด้วย
   *
   * planEffects() walks the activity's effect list and lets a grant that names
   * no reward inherit the outcome's. Without the grant, a rewardCode sitting on
   * an outcome grants nothing at all and never reaches a single player.
   */
  it('ผูกรางวัลกับผลลัพธ์ แล้ว effects ของกิจกรรมได้ grant_reward ตามมา', async () => {
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1', reward_code: 'mug' }))
    const [update] = writesTo(/UPDATE activity/)
    expect(update.values[1]).toEqual([{ type: 'grant_reward' }])
  })

  it('ถอดรางวัลออกจากผลลัพธ์สุดท้าย แล้ว grant_reward ถูกถอดตามไปด้วย', async () => {
    state.activities = [activity({
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'card-1', rewardCode: 'mug' }] },
      effects: [{ type: 'grant_reward' }],
    })]
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1' }))
    expect(writesTo(/UPDATE activity/)[0].values[1]).toEqual([])
  })

  it('ผลอื่นที่กิจกรรมมีอยู่ ไม่ถูกลบตอนแก้เรื่องรางวัล', async () => {
    state.activities = [activity({
      effects: [{ type: 'add_units', counterCode: 'checkin', amount: 1 }],
    })]
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1', reward_code: 'mug' }))
    expect(writesTo(/UPDATE activity/)[0].values[1]).toEqual([
      { type: 'add_units', counterCode: 'checkin', amount: 1 },
      { type: 'grant_reward' },
    ])
  })

  it('grant_reward ไม่ระบุรางวัลของตัวเอง — คำตอบเดียวว่าแจกอะไรอยู่ที่ผลลัพธ์', async () => {
    await saveOutcome('camp-1', 'act-1', 0, form({ card_id: 'card-1', reward_code: 'mug' }))
    const [grant] = writesTo(/UPDATE activity/)[0].values[1] as Array<Record<string, unknown>>
    expect(grant.rewardCode).toBeUndefined()
    expect(grant.reward_code).toBeUndefined()
  })
})

describe('removeOutcome', () => {
  beforeEach(() => signedInAs('configurator'))

  it('เอาแถวที่ระบุออก และแถวอื่นยังอยู่ครบ', async () => {
    state.activities = [activity({
      resolve_config: { outcomes: [{ id: 'o1', cardId: 'card-1' }, { id: 'o2', cardId: 'card-9' }] },
    })]
    await removeOutcome('camp-1', 'act-1', 0)
    expect(written<{ outcomes: Array<{ id: string }> }>(/UPDATE activity/).outcomes)
      .toEqual([{ id: 'o2', cardId: 'card-9' }])
  })

  it('แถวที่ไม่มีอยู่ ลบไม่ได้ และไม่มีอะไรถูกเขียน', async () => {
    await expect(removeOutcome('camp-1', 'act-1', 9)).rejects.toThrow('ไม่พบผลลัพธ์แถวนี้')
    expect(state.writes).toEqual([])
  })
})

/**
 * เงื่อนไขเก็บคีย์ที่ evaluate() อ่านจริง
 *
 * lib/state.ts asks a has_entitlement condition for `rewardCode` and the
 * activity conditions for `activityCode`. A generic key/value pair would make
 * every one of those rules false for every player, forever, with nothing
 * anywhere reporting it — the campaign would simply refuse everybody.
 */
describe('saveEntryRule', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ชนิดเงื่อนไขที่ engine ไม่รู้จัก ถูกปฏิเสธ', async () => {
    for (const type of ['', 'ของแปลก', 'has_counter']) {
      await expect(saveEntryRule('camp-1', 'act-1', -1, form({ type })), type)
        .rejects.toThrow('ชนิดเงื่อนไข')
    }
    expect(state.writes).toEqual([])
  })

  it('เงื่อนไขใหม่ต่อท้าย · ลำดับคือลำดับที่ engine ตรวจ', async () => {
    state.activities = [activity({ entry_rules: [{ type: 'limit', cardId: 'card-1', count: 1 }] })]
    await saveEntryRule('camp-1', 'act-1', -1, form({ type: 'has_attribute', key: 'tier', card_id: 'card-9' }))
    const rules = written<Array<{ type: string }>>(/UPDATE activity SET entry_rules/)
    expect(rules.map((r) => r.type)).toEqual(['limit', 'has_attribute'])
  })

  it('รางวัลของ has_entitlement ลง rewardCode ไม่ใช่ key', async () => {
    await saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'has_entitlement', rewardCode: 'mug', card_id: 'card-1' }))
    const [rule] = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rule).toEqual({ type: 'has_entitlement', cardId: 'card-1', rewardCode: 'mug' })
  })

  it('กิจกรรมของ activity_completed ลง activityCode', async () => {
    await saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'activity_completed', activityCode: 'daily', card_id: 'card-1' }))
    const [rule] = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rule.activityCode).toBe('daily')
  })

  it('activity_play_count เก็บครบทั้งกิจกรรม วิธีเทียบ และจำนวน', async () => {
    await saveEntryRule('camp-1', 'act-1', -1, form({
      type: 'activity_play_count', activityCode: 'daily', op: 'gte', count: '3', card_id: 'card-1',
    }))
    const [rule] = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rule).toEqual({
      type: 'activity_play_count', cardId: 'card-1', activityCode: 'daily', op: 'gte', count: 3,
    })
  })

  it('วิธีเทียบที่ engine ไม่รู้จัก ถูกปฏิเสธ ไม่ใช่เขียนลงไปแล้วเงียบ', async () => {
    await expect(saveEntryRule('camp-1', 'act-1', -1, form({
      type: 'activity_play_count', activityCode: 'daily', op: 'มากกว่า', count: '3', card_id: 'card-1',
    }))).rejects.toThrow('วิธีเทียบ')
    expect(state.writes).toEqual([])
  })

  it('ชั่วโมงของ time_window เก็บเป็นรายการตัวเลข ไม่ใช่ข้อความ', async () => {
    await saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'time_window', hoursOfDay: '9, 10, 11', card_id: 'card-1' }))
    const [rule] = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rule.hoursOfDay).toEqual([9, 10, 11])
  })

  it('ชั่วโมงที่อยู่นอก 0–23 ถูกปฏิเสธ', async () => {
    await expect(saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'time_window', hoursOfDay: '9,24', card_id: 'card-1' })))
      .rejects.toThrow('ชั่วโมง')
    expect(state.writes).toEqual([])
  })

  it('ช่องของชนิดอื่นที่ยัดมาด้วย ไม่ถูกเขียนลงไป', async () => {
    await saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'not_has_attribute', key: 'tier', rewardCode: 'mug', card_id: 'card-1' }))
    const [rule] = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rule.rewardCode).toBeUndefined()
    expect(rule.key).toBe('tier')
  })

  it('การ์ดที่ตอบเมื่อไม่ผ่านต้องเป็นการ์ดของแคมเปญนี้ (BR-26)', async () => {
    await expect(saveEntryRule('camp-1', 'act-1', -1,
      form({ type: 'limit', card_id: 'card-ของคนอื่น' })))
      .rejects.toThrow('การ์ดของแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('เงื่อนไขข้อที่ไม่มีอยู่ แก้ไม่ได้', async () => {
    await expect(saveEntryRule('camp-1', 'act-1', 4, form({ type: 'limit' })))
      .rejects.toThrow('ไม่พบเงื่อนไขข้อนี้')
    expect(state.writes).toEqual([])
  })

  it('แก้ข้อเดิม เขียนทับเฉพาะข้อนั้น', async () => {
    state.activities = [activity({
      entry_rules: [
        { type: 'limit', cardId: 'card-1', count: 1 },
        { type: 'not_has_attribute', cardId: 'card-9', key: 'tier' },
      ],
    })]
    await saveEntryRule('camp-1', 'act-1', 0, form({ type: 'limit', count: '5', card_id: 'card-1' }))
    const rules = written<Array<Record<string, unknown>>>(/UPDATE activity SET entry_rules/)
    expect(rules[0].count).toBe(5)
    expect(rules[1]).toEqual({ type: 'not_has_attribute', cardId: 'card-9', key: 'tier' })
  })
})

describe('removeEntryRule', () => {
  beforeEach(() => signedInAs('configurator'))

  it('เอาข้อที่ระบุออก ข้ออื่นเรียงเหมือนเดิม', async () => {
    state.activities = [activity({
      entry_rules: [
        { type: 'limit', cardId: 'card-1' },
        { type: 'not_has_attribute', cardId: 'card-9', key: 'tier' },
      ],
    })]
    await removeEntryRule('camp-1', 'act-1', 0)
    expect(written<Array<{ type: string }>>(/UPDATE activity SET entry_rules/).map((r) => r.type))
      .toEqual(['not_has_attribute'])
  })

  it('ข้อที่ไม่มีอยู่ ลบไม่ได้', async () => {
    await expect(removeEntryRule('camp-1', 'act-1', 3)).rejects.toThrow('ไม่พบเงื่อนไขข้อนี้')
    expect(state.writes).toEqual([])
  })
})

describe('setActivityEnabled', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ปิดแล้วเขียน false · เปิดแล้วเขียน true', async () => {
    await setActivityEnabled('camp-1', 'act-1', false)
    expect(writesTo(/is_enabled/)[0].values).toContain(false)
    state.writes = []
    await setActivityEnabled('camp-1', 'act-1', true)
    expect(writesTo(/is_enabled/)[0].values).toContain(true)
  })

  it('กิจกรรมของแคมเปญอื่น เปิดปิดข้ามแคมเปญไม่ได้', async () => {
    state.campaigns = { 'camp-1': 'draft', 'camp-2': 'draft' }
    await expect(setActivityEnabled('camp-2', 'act-1', false))
      .rejects.toThrow('ไม่พบกิจกรรมนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })
})

/**
 * ลบกิจกรรมได้เฉพาะตอนที่ยังไม่มีใครเล่น
 *
 * participant_activity cascades from activity, so the database's answer to
 * deleting an activity four hundred people have played is to delete the record
 * that they played it and report success.
 */
describe('deleteActivity', () => {
  beforeEach(() => signedInAs('configurator'))

  it('มีคนเล่นไปแล้ว ลบไม่ได้ และเหตุผลพูดถึง CASCADE พร้อมจำนวนคน', async () => {
    state.playedCount = 412
    await expect(deleteActivity('camp-1', 'act-1')).rejects.toThrow('412')
    await expect(deleteActivity('camp-1', 'act-1')).rejects.toThrow('CASCADE')
    expect(state.writes).toEqual([])
  })

  it('มีคีย์เวิร์ดพามา ลบไม่ได้ และบอกว่าคีย์เวิร์ดไหน', async () => {
    state.keywordsPointingHere = ['เล่น']
    await expect(deleteActivity('camp-1', 'act-1')).rejects.toThrow('เล่น')
    expect(state.writes).toEqual([])
  })

  it('ไม่มีใครเกี่ยวข้อง ลบได้ และผูก campaign_id ไว้ใน WHERE', async () => {
    await deleteActivity('camp-1', 'act-1')
    expect(writesTo(/DELETE FROM activity/)[0].values).toEqual(['act-1', 'camp-1'])
  })
})

/**
 * ผลที่ตามมาของกิจกรรม · ทางเดียวที่ค่าสะสมจะเพิ่มขึ้นได้
 *
 * planEffects() reads the activity's effect list, not the outcome's, and
 * play_and_apply walks what comes out of it. Until an add_units effect sits
 * here, a counter has nothing writing into it — which is exactly what the
 * counter screen tells people to come and fix, and until now there was nowhere
 * on this screen to do it.
 */
describe('saveEffects · ค่าสะสมที่กิจกรรมนี้บวกให้', () => {
  beforeEach(() => signedInAs('configurator'))

  it('เขียน add_units ด้วยคีย์ที่ toSqlEffect อ่าน ไม่ใช่ชื่อคอลัมน์', async () => {
    await saveEffects('camp-1', 'act-1', form({ units_checkin: '2' }))
    expect(written<Array<Record<string, unknown>>>(/UPDATE activity SET effects/))
      .toEqual([{ type: 'add_units', counterCode: 'checkin', amount: 2 }])
  })

  it('ช่องที่เว้นว่าง คือไม่บวกค่าสะสมนั้น', async () => {
    state.activities = [activity({
      effects: [{ type: 'add_units', counterCode: 'checkin', amount: 1 }],
    })]
    await saveEffects('camp-1', 'act-1', form({ units_checkin: '' }))
    expect(written<unknown[]>(/UPDATE activity SET effects/)).toEqual([])
  })

  it('ค่าสะสมที่ไม่ได้อยู่ในแคมเปญนี้ ยัดเข้ามาไม่ได้', async () => {
    await saveEffects('camp-1', 'act-1', form({ units_ของคนอื่น: '5', units_checkin: '1' }))
    expect(written<Array<{ counterCode: string }>>(/UPDATE activity SET effects/)
      .map((effect) => effect.counterCode)).toEqual(['checkin'])
  })

  it('จำนวนที่ไม่ใช่จำนวนเต็มตั้งแต่ 1 ถูกปฏิเสธพร้อมบอกว่าค่าสะสมไหน', async () => {
    for (const amount of ['0', '-2', '1.5', 'สอง']) {
      await expect(saveEffects('camp-1', 'act-1', form({ units_checkin: amount })), amount)
        .rejects.toThrow('checkin')
    }
    expect(state.writes).toEqual([])
  })

  /** grant_reward เป็นของ saveOutcome · การบันทึกบล็อกนี้ต้องไม่ไปถอดมันทิ้ง */
  it('ผลชนิดอื่นที่กิจกรรมมีอยู่ ไม่ถูกลบตอนบันทึกค่าสะสม', async () => {
    state.activities = [activity({
      effects: [{ type: 'grant_reward' }, { type: 'add_units', counterCode: 'checkin', amount: 9 }],
    })]
    await saveEffects('camp-1', 'act-1', form({ units_checkin: '1' }))
    expect(written<unknown[]>(/UPDATE activity SET effects/)).toEqual([
      { type: 'grant_reward' },
      { type: 'add_units', counterCode: 'checkin', amount: 1 },
    ])
  })

  it('บันทึกผูก campaign_id ไว้ใน WHERE', async () => {
    await saveEffects('camp-1', 'act-1', form({ units_checkin: '1' }))
    expect(writesTo(/UPDATE activity SET effects/)[0].values).toContain('camp-1')
  })
})
