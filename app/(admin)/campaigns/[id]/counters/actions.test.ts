import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

type CounterRow = {
  id: string
  code: string
  name: string
  mode: string
  require_consecutive: boolean
  target: number
  participant_count: number
  milestones: Array<{ id: string; at_value: number; effects: unknown }>
  writers: string[]
  overrides: string[]
  has_stamp_card: boolean
}

const counter = (patch: Partial<CounterRow> = {}): CounterRow => ({
  id: 'ct-1',
  code: 'checkin_days',
  name: 'วันเช็คอิน',
  mode: 'daily_unique',
  require_consecutive: false,
  target: 7,
  participant_count: 0,
  milestones: [],
  writers: [],
  overrides: [],
  has_stamp_card: false,
  ...patch,
})

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaigns: string[]
  counters: CounterRow[]
  rewardCodes: string[]
  milestones: Array<{ id: string; effects: unknown }>
  writes: Array<{ text: string; values: unknown[] }>
  failNextWriteWith: string | undefined
  redirectedTo: string | undefined
} = {
  cookie: undefined, user: undefined, campaigns: ['camp-1'],
  counters: [counter()], rewardCodes: ['sticker'], milestones: [{ id: 'ms-1', effects: [] }],
  writes: [], failNextWriteWith: undefined, redirectedTo: undefined,
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
      if (/SELECT id FROM campaign/.test(text)) {
        return Promise.resolve(state.campaigns.includes(String(values[0])) ? [{ id: values[0] }] : [])
      }
      if (/SELECT c\.mode/.test(text)) {
        const found = state.counters.find((row) => row.id === values[0])
        return Promise.resolve(found && String(values[1]) === 'camp-1' ? [found] : [])
      }
      if (/FROM counter c/.test(text)) {
        return Promise.resolve(String(values[0]) === 'camp-1' ? state.counters : [])
      }
      if (/FROM reward WHERE campaign_id/.test(text)) {
        return Promise.resolve(state.rewardCodes.map((code) => ({ code })))
      }
      if (/SELECT effects FROM counter_milestone/.test(text)) {
        return Promise.resolve(state.milestones.filter((m) => m.id === values[0]))
      }
      return Promise.resolve([])
    }

    if (state.failNextWriteWith) {
      const code = state.failNextWriteWith
      state.failNextWriteWith = undefined
      return Promise.reject(Object.assign(new Error('duplicate key value'), { code }))
    }

    state.writes.push({ text, values })
    return Promise.resolve(/INSERT INTO counter /.test(text) ? [{ id: 'ct-new' }] : [])
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

const { deleteCounter, deleteMilestone, saveCounter, saveMilestone } = await import('./actions')

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

const counterForm = (patch: Record<string, string> = {}) =>
  form({ code: 'streak', name: 'วันติดกัน', mode: 'daily_unique', target: '7', ...patch })

const writesTo = (pattern: RegExp) => state.writes.filter((w) => pattern.test(w.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.campaigns = ['camp-1']
  state.counters = [counter()]
  state.rewardCodes = ['sticker']
  state.milestones = [{ id: 'ms-1', effects: [] }]
  state.writes = []
  state.failNextWriteWith = undefined
  state.redirectedTo = undefined
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * The screen shows a reporter no form at all, which is a hint. These four
 * functions are the door, and a door is open to anyone who knows its name.
 */
describe('สิทธิ์ของทั้งสี่ action', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['saveCounter', () => saveCounter('camp-1', '', counterForm())],
    ['deleteCounter', () => deleteCounter('camp-1', 'ct-1')],
    ['saveMilestone', () => saveMilestone('camp-1', 'ct-1', '', form({ at_value: '3' }))],
    ['deleteMilestone', () => deleteMilestone('camp-1', 'ct-1', 'ms-1')],
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

  /**
   * ผู้ดูแลเนื้อหาแก้ค่าสะสมไม่ได้ · ต่างจากคลังภาพที่แก้ได้
   *
   * A counter is the rule that decides what a player has to do to win. Moving a
   * target from seven to fourteen after people have started is changing the
   * deal, not editing content, so it sits with the configurator alongside the
   * campaign's own settings.
   */
  it.each(calls)('%s · ผู้ดูแลเนื้อหาทำไม่ได้ เพราะนี่เป็นกติกา ไม่ใช่เนื้อหา', async (_name, call) => {
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

describe('saveCounter · ค่าที่รับและไม่รับ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('แคมเปญที่ไม่มีอยู่ ไม่มีอะไรถูกเขียน', async () => {
    await expect(saveCounter('camp-ไม่มี', '', counterForm())).rejects.toThrow('ไม่พบแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('ไม่มีชื่อ ถูกปฏิเสธ', async () => {
    await expect(saveCounter('camp-1', '', counterForm({ name: '   ' })))
      .rejects.toThrow('ต้องกรอกชื่อ')
    expect(state.writes).toEqual([])
  })

  it('ชื่อที่ยาวเกินกว่าจะแสดงบนจอไหนได้ ถูกปฏิเสธที่นี่ ไม่ใช่ไปโผล่ในการ์ด', async () => {
    await expect(saveCounter('camp-1', '', counterForm({ name: 'ก'.repeat(101) })))
      .rejects.toThrow('100')
    expect(state.writes).toEqual([])
  })

  it('ชื่อยาว 100 ตัวพอดี ยังผ่าน', async () => {
    await saveCounter('camp-1', '', counterForm({ name: 'ก'.repeat(100) }))
    expect(writesTo(/INSERT INTO counter /)).toHaveLength(1)
  })

  it('รหัสที่ไม่ใช่ a-z 0-9 ขีดล่าง ถูกปฏิเสธ', async () => {
    for (const code of ['', 'Streak', 'streak-7', 'ค่าสะสม', 'x'.repeat(21), 'a b']) {
      await expect(saveCounter('camp-1', '', counterForm({ code })), code)
        .rejects.toThrow('รหัสค่าสะสม')
    }
    expect(state.writes).toEqual([])
  })

  it('รหัสยาว 20 ตัวพอดี ยังผ่าน', async () => {
    await saveCounter('camp-1', '', counterForm({ code: 'a'.repeat(20) }))
    expect(writesTo(/INSERT INTO counter /)).toHaveLength(1)
  })

  it('วิธีนับที่ไม่ได้อยู่ใน CHECK ของตาราง ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    for (const mode of ['', 'weekly', 'ACCUMULATE']) {
      await expect(saveCounter('camp-1', '', counterForm({ mode })), mode)
        .rejects.toThrow('ต้องเลือกวิธีนับ')
    }
    expect(state.writes).toEqual([])
  })

  it('เป้าหมายที่ไม่ใช่จำนวนเต็มบวก ถูกปฏิเสธพร้อมบอกว่าต้องเป็นอะไร', async () => {
    for (const target of ['', '0', '-3', '2.5', 'เจ็ด', '7 วัน', ' ']) {
      await expect(saveCounter('camp-1', '', counterForm({ target })), target)
        .rejects.toThrow('เป้าหมาย')
    }
    expect(state.writes).toEqual([])
  })

  /** ตั้งเป้ากี่วันก็ได้ · เพดาน 30 เป็นของช่องบนบัตร ไม่ใช่ของการนับ */
  it('เป้า 60 วันตั้งได้ ไม่ติดเพดาน 30 ช่องของบัตรแสตมป์', async () => {
    await saveCounter('camp-1', '', counterForm({ target: '60' }))
    expect(writesTo(/INSERT INTO counter /)[0].values).toContain(60)
  })

  it('สวิตช์ที่ไม่ได้ติ๊ก บันทึกเป็น false ไม่ใช่ข้ามไปไม่เขียน', async () => {
    await saveCounter('camp-1', '', counterForm())
    expect(writesTo(/INSERT INTO counter /)[0].values).toContain(false)
  })

  it('ติ๊กสวิตช์ต้องกดติดกัน บันทึกลง counter ไม่ใช่ที่อื่น', async () => {
    await saveCounter('camp-1', '', counterForm({ require_consecutive: 'on' }))
    const [insert] = writesTo(/INSERT INTO counter /)
    expect(insert.text).toContain('require_consecutive')
    expect(insert.values).toContain(true)
    // ไม่มีอะไรไปแตะบัตรแสตมป์ · กติกาย้ายมาอยู่ที่ค่าสะสมแล้วตั้งแต่ v0.22
    expect(writesTo(/stamp_card/)).toEqual([])
  })

  it('รหัสซ้ำในแคมเปญเดียวกัน ได้ประโยคที่บอกทางออก ไม่ใช่ชื่อ constraint', async () => {
    state.failNextWriteWith = '23505'
    await expect(saveCounter('camp-1', '', counterForm({ code: 'streak' })))
      .rejects.toThrow('มีค่าสะสมรหัส "streak" อยู่แล้ว')
  })

  it('ข้อผิดพลาดอื่นของฐานข้อมูล ไม่ถูกแปลงเป็นเรื่องรหัสซ้ำ', async () => {
    state.failNextWriteWith = '23503'
    await expect(saveCounter('camp-1', '', counterForm())).rejects.toThrow('duplicate key value')
  })

  it('สร้างเสร็จพาไปตั้งจุดปลดล็อกต่อ ไม่ใช่ทิ้งไว้ที่รายการ', async () => {
    await saveCounter('camp-1', '', counterForm())
    expect(state.redirectedTo).toBe('/campaigns/camp-1/counters/ct-new')
  })
})

describe('saveCounter · ตอนแก้ของเดิม', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ค่าสะสมของแคมเปญอื่น แก้ผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(saveCounter('camp-2', 'ct-1', counterForm()))
      .rejects.toThrow('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('แก้แล้วผูก campaign_id ไว้ใน WHERE ด้วย ไม่ใช่แก้ด้วย id เปล่าๆ', async () => {
    await saveCounter('camp-1', 'ct-1', counterForm({ name: 'ชื่อใหม่' }))
    const [update] = writesTo(/UPDATE counter/)
    expect(update.values).toContain('camp-1')
    expect(update.values).toContain('ct-1')
  })

  /**
   * รหัสแก้ไม่ได้หลังสร้าง · กิจกรรมอ้างค่าสะสมด้วยรหัสเป็นข้อความ
   *
   * There is no foreign key behind that reference, so a rename leaves every
   * activity effect naming a counter that no longer exists, and the SQL that
   * applies effects skips what it cannot find without saying anything.
   */
  it('รหัสที่ส่งมาตอนแก้ ไม่ถูกเขียนทับของเดิม', async () => {
    await saveCounter('camp-1', 'ct-1', counterForm({ code: 'รหัสใหม่ที่ส่งแอบมา' }))
    const [update] = writesTo(/UPDATE counter/)
    expect(update.text).not.toContain('code =')
    expect(update.values).not.toContain('รหัสใหม่ที่ส่งแอบมา')
  })

  it('เปลี่ยนวิธีนับตอนมีคนสะสมอยู่แล้ว ถูกปฏิเสธพร้อมบอกจำนวนคน', async () => {
    state.counters = [counter({ mode: 'daily_unique', participant_count: 240 })]
    await expect(saveCounter('camp-1', 'ct-1', counterForm({ mode: 'accumulate' })))
      .rejects.toThrow('240')
    expect(state.writes).toEqual([])
  })

  it('มีคนสะสมอยู่แล้วแต่ไม่ได้เปลี่ยนวิธีนับ ยังแก้ชื่อกับเป้าได้', async () => {
    state.counters = [counter({ mode: 'daily_unique', participant_count: 240 })]
    await saveCounter('camp-1', 'ct-1', counterForm({ mode: 'daily_unique', target: '14' }))
    expect(writesTo(/UPDATE counter/)).toHaveLength(1)
  })

  it('ยังไม่มีใครสะสม เปลี่ยนวิธีนับได้', async () => {
    await saveCounter('camp-1', 'ct-1', counterForm({ mode: 'accumulate' }))
    expect(writesTo(/UPDATE counter/)).toHaveLength(1)
  })

  it('แก้เสร็จอยู่ที่เดิม ไม่พาไปไหน', async () => {
    await saveCounter('camp-1', 'ct-1', counterForm())
    expect(state.redirectedTo).toBeUndefined()
  })
})

describe('deleteCounter · สิ่งที่กันไม่ให้ลบ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ค่าสะสมที่ไม่ได้อยู่ในแคมเปญนี้ ลบไม่ได้', async () => {
    await expect(deleteCounter('camp-1', 'ไม่มีตัวนี้')).rejects.toThrow('ไม่พบค่าสะสมนี้')
    expect(state.writes).toEqual([])
  })

  /**
   * counter_value ห้อยอยู่กับ ON DELETE CASCADE
   *
   * The database's answer to deleting a counter people have been accumulating
   * into is to delete their progress with it and report success. Nothing else
   * in this system holds a copy, so the guard has to be here.
   */
  it('มีผู้เล่นสะสมอยู่แล้ว ลบไม่ได้ และเหตุผลพูดถึง CASCADE', async () => {
    state.counters = [counter({ participant_count: 3 })]
    await expect(deleteCounter('camp-1', 'ct-1')).rejects.toThrow('CASCADE')
    expect(state.writes).toEqual([])
  })

  it('มีกิจกรรมเขียนค่าเข้ามา ลบไม่ได้ และบอกว่ากิจกรรมไหน', async () => {
    state.counters = [counter({ writers: ['เช็คอินรายวัน'] })]
    await expect(deleteCounter('camp-1', 'ct-1')).rejects.toThrow('เช็คอินรายวัน')
    expect(state.writes).toEqual([])
  })

  it('มีบัตรแสตมป์ผูกอยู่ ลบไม่ได้', async () => {
    state.counters = [counter({ has_stamp_card: true })]
    await expect(deleteCounter('camp-1', 'ct-1')).rejects.toThrow('บัตรแสตมป์')
    expect(state.writes).toEqual([])
  })

  it('ไม่มีใครเกี่ยวข้อง ลบได้ และผูก campaign_id ไว้ใน WHERE', async () => {
    await deleteCounter('camp-1', 'ct-1')
    const [remove] = writesTo(/DELETE FROM counter /)
    expect(remove.values).toEqual(['ct-1', 'camp-1'])
  })
})

describe('saveMilestone', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ค่าสะสมของแคมเปญอื่น เพิ่มจุดปลดล็อกใส่ไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(saveMilestone('camp-2', 'ct-1', '', form({ at_value: '3' })))
      .rejects.toThrow('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('ค่าที่ปลดล็อกต้องเป็นจำนวนเต็มบวก', async () => {
    for (const at of ['', '0', '-1', '3.5', 'สาม']) {
      await expect(saveMilestone('camp-1', 'ct-1', '', form({ at_value: at })), at)
        .rejects.toThrow('ค่าที่ปลดล็อก')
    }
    expect(state.writes).toEqual([])
  })

  /** เป้าเป็นตัวเลขไว้แสดงความคืบหน้า ไม่ใช่เพดานของการนับ */
  it('จุดที่เกินเป้า บันทึกได้ · counter_value ไม่มีเพดานที่เป้า', async () => {
    await saveMilestone('camp-1', 'ct-1', '', form({ at_value: '60' }))
    expect(writesTo(/INSERT INTO counter_milestone/)[0].values).toContain(60)
  })

  it('ผลที่ติ๊กไว้ถูกแปลงเป็นรูปที่ SQL ของ play_and_apply อ่านได้', async () => {
    await saveMilestone('camp-1', 'ct-1', '', form({ at_value: '3', effect: 'reward:sticker' }))
    const [insert] = writesTo(/INSERT INTO counter_milestone/)
    expect(insert.values).toContainEqual([{ type: 'grant_reward', reward_code: 'sticker' }])
  })

  it('ติ๊กหลายผลในจุดเดียว บันทึกครบทุกอัน ไม่ใช่เก็บอันแรก', async () => {
    await saveMilestone('camp-1', 'ct-1', '',
      form({ at_value: '3', effect: ['reward:sticker', 'counter:food'] }))
    expect(writesTo(/INSERT INTO counter_milestone/)[0].values).toContainEqual([
      { type: 'grant_reward', reward_code: 'sticker' },
      { type: 'add_units', counter_code: 'food', amount: 1 },
    ])
  })

  it('ค่าที่ติ๊กมาเองแบบมั่วๆ ไม่ได้ถูกเขียนลงคอลัมน์', async () => {
    await saveMilestone('camp-1', 'ct-1', '', form({ at_value: '3', effect: ['drop:table', ''] }))
    expect(writesTo(/INSERT INTO counter_milestone/)[0].values).toContainEqual([])
  })

  it('แก้จุดเดิม เก็บผลที่จอนี้ไม่มีช่องให้ติ๊กไว้ครบ', async () => {
    state.milestones = [{
      id: 'ms-1',
      effects: [{ type: 'set_attribute', key: 'tier', value: 'gold' }],
    }]
    await saveMilestone('camp-1', 'ct-1', 'ms-1', form({ at_value: '5' }))
    const [update] = writesTo(/UPDATE counter_milestone/)
    expect(update.values).toContainEqual([{ type: 'set_attribute', key: 'tier', value: 'gold' }])
  })

  it('จุดปลดล็อกที่ไม่ได้อยู่ใต้ค่าสะสมนี้ แก้ไม่ได้', async () => {
    await expect(saveMilestone('camp-1', 'ct-1', 'ms-ของคนอื่น', form({ at_value: '5' })))
      .rejects.toThrow('ไม่พบจุดปลดล็อกนี้')
    expect(state.writes).toEqual([])
  })

  it('ค่าที่ซ้ำกับจุดเดิม ได้ประโยคที่บอกว่าซ้ำกับอะไร', async () => {
    state.failNextWriteWith = '23505'
    await expect(saveMilestone('camp-1', 'ct-1', '', form({ at_value: '3' })))
      .rejects.toThrow('จุดปลดล็อกที่ค่า 3 อยู่แล้ว')
  })

  it('แก้แล้วผูก counter_id ไว้ใน WHERE ด้วย', async () => {
    await saveMilestone('camp-1', 'ct-1', 'ms-1', form({ at_value: '5' }))
    expect(writesTo(/UPDATE counter_milestone/)[0].values).toContain('ct-1')
  })
})

describe('deleteMilestone', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ค่าสะสมของแคมเปญอื่น ลบจุดปลดล็อกของมันไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(deleteMilestone('camp-2', 'ct-1', 'ms-1'))
      .rejects.toThrow('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('ลบแล้วผูก counter_id ไว้ใน WHERE ไม่ใช่ลบด้วย id เปล่าๆ', async () => {
    await deleteMilestone('camp-1', 'ct-1', 'ms-1')
    expect(writesTo(/DELETE FROM counter_milestone/)[0].values).toEqual(['ms-1', 'ct-1'])
  })
})
