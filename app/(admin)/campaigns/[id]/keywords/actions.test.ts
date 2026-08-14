import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  activities: string[]
  cards: string[]
  failWith: unknown
  writes: Array<{ text: string; values: unknown[] }>
} = {
  cookie: undefined, user: undefined,
  activities: ['act-1'], cards: ['card-1'],
  failWith: undefined, writes: [],
}

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM activity/.test(text)) {
        return Promise.resolve(state.activities.includes(String(values[0])) ? [{ one: 1 }] : [])
      }
      if (/FROM card/.test(text)) {
        return Promise.resolve(state.cards.includes(String(values[0])) ? [{ one: 1 }] : [])
      }
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    return state.failWith ? Promise.reject(state.failWith) : Promise.resolve([])
  },
  { json: (value: unknown) => value },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { deleteKeyword, saveKeyword } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = (patch: Record<string, string> = {}) =>
  form({ keyword: 'เล่นเกม', match_mode: 'exact', target: 'activity:act-1', ...patch })

const lastWrite = () => {
  const write = state.writes.at(-1)
  if (!write) throw new Error('ไม่มีการเขียนเกิดขึ้น')
  return write
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.activities = ['act-1']
  state.cards = ['card-1']
  state.failWith = undefined
  state.writes = []
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * The screen hides the form from a reporter, but the form is not the door — the
 * action is, and it answers to anyone who can name it.
 */
describe('saveKeyword · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ตั้งคีย์เวิร์ดไม่ได้', async () => {
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ตั้งไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานตั้งคีย์เวิร์ดไม่ได้', async () => {
    signedInAs('reporter')
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญตั้งได้', async () => {
    signedInAs('configurator')
    await saveKeyword('c1', validForm())
    expect(lastWrite().text).toContain('INSERT INTO keyword_rule')
  })

  // คีย์เวิร์ดคือทางเข้าของเนื้อหา ผู้ดูแลเนื้อหาจึงแก้ได้ · แต่ลบไม่ได้
  it('ผู้ดูแลเนื้อหาตั้งได้', async () => {
    signedInAs('content_editor')
    await saveKeyword('c1', validForm())
    expect(lastWrite().text).toContain('INSERT INTO keyword_rule')
  })
})

describe('deleteKeyword · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ลบไม่ได้', async () => {
    await expect(deleteKeyword('c1', 'k1')).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ลบไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(deleteKeyword('c1', 'k1')).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว ลบไม่ได้', async () => {
    signedInAs('configurator', false)
    await expect(deleteKeyword('c1', 'k1')).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานลบไม่ได้', async () => {
    signedInAs('reporter')
    await expect(deleteKeyword('c1', 'k1')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  // แก้ได้ไม่ได้แปลว่าลบได้ — ลบแล้วไม่มีร่องรอยว่าเคยมีคำนี้อยู่
  it('ผู้ดูแลเนื้อหาลบไม่ได้ แม้จะแก้ได้', async () => {
    signedInAs('content_editor')
    await expect(deleteKeyword('c1', 'k1')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญลบได้ และลบเฉพาะในแคมเปญของตัวเอง', async () => {
    signedInAs('configurator')
    await deleteKeyword('c1', 'k1')
    expect(lastWrite().text).toContain('DELETE FROM keyword_rule')
    expect(lastWrite().text).toContain('campaign_id')
    expect(lastWrite().values).toEqual(['k1', 'c1'])
  })
})

/**
 * เก็บในรูปที่ทำเป็นมาตรฐานแล้ว (BR-48)
 *
 * matchKeyword normalises the incoming message before comparing, so a rule
 * stored with the spacing and case someone happened to type could never match
 * anything. The screen is the only place that can fix this, because the engine
 * only ever sees what the screen wrote.
 */
describe('saveKeyword · รูปแบบของคำที่เก็บ', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('เก็บคำในรูปที่ทำเป็นมาตรฐานแล้ว ไม่ใช่ตามที่พิมพ์มา', async () => {
    await saveKeyword('c1', validForm({ keyword: '  เล่น   เกม  ' }))
    expect(lastWrite().values).toContain('เล่น เกม')
  })

  it('ตัวพิมพ์ใหญ่ถูกลดรูปก่อนเก็บ', async () => {
    await saveKeyword('c1', validForm({ keyword: 'PLAY' }))
    expect(lastWrite().values).toContain('play')
  })

  it('คำว่างหรือช่องว่างล้วน ตั้งไม่ได้', async () => {
    for (const keyword of ['', '   ', '​']) {
      state.writes = []
      await expect(saveKeyword('c1', validForm({ keyword })), JSON.stringify(keyword))
        .rejects.toThrow('คำ')
      expect(state.writes, JSON.stringify(keyword)).toEqual([])
    }
  })

  it('โหมดจับคู่ที่ไม่มีจริง ตั้งไม่ได้ — บอกก่อนถึง CHECK ของตาราง', async () => {
    await expect(saveKeyword('c1', validForm({ match_mode: 'regex' }))).rejects.toThrow('โหมด')
    expect(state.writes).toEqual([])
  })

  it('exact และ contains ผ่านทั้งคู่', async () => {
    for (const mode of ['exact', 'contains']) {
      state.writes = []
      await saveKeyword('c1', validForm({ match_mode: mode }))
      expect(lastWrite().values, mode).toContain(mode)
    }
  })
})

describe('saveKeyword · ปลายทาง', () => {
  beforeEach(() => { signedInAs('configurator') })

  // CHECK ของตารางบังคับอยู่แล้ว แต่ข้อความจากที่นี่บอกวิธีแก้ได้ดีกว่ารหัส 23514
  it('ไม่ได้เลือกปลายทาง ตั้งไม่ได้ และบอกว่าเลือกอะไรได้บ้าง', async () => {
    await expect(saveKeyword('c1', validForm({ target: '' }))).rejects.toThrow(/กิจกรรม.*การ์ด/)
    expect(state.writes).toEqual([])
  })

  it('ปลายทางรูปแบบแปลกๆ ตั้งไม่ได้', async () => {
    for (const target of ['activity:', 'card:', 'ไม่รู้:x', 'act-1']) {
      state.writes = []
      await expect(saveKeyword('c1', validForm({ target })), target).rejects.toThrow()
      expect(state.writes, target).toEqual([])
    }
  })

  it('ชี้ไปกิจกรรม เขียนลงช่องกิจกรรม และช่องการ์ดเป็น null', async () => {
    await saveKeyword('c1', validForm({ target: 'activity:act-1' }))
    expect(lastWrite().values).toContain('act-1')
    expect(lastWrite().values).toContain(null)
  })

  it('ชี้ไปการ์ด เขียนลงช่องการ์ด', async () => {
    await saveKeyword('c1', validForm({ target: 'card:card-1' }))
    expect(lastWrite().values).toContain('card-1')
  })

  // ทุกช่องของ FormData เขียนโดยคนส่ง · id ของแคมเปญมาจากที่อื่น ปลายทางจึงต้องถูกตรวจ
  it('ปลายทางที่อยู่คนละแคมเปญ ตั้งไม่ได้', async () => {
    state.activities = []
    await expect(saveKeyword('c1', validForm({ target: 'activity:act-of-another' })))
      .rejects.toThrow('แคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('การ์ดที่อยู่คนละแคมเปญ ตั้งไม่ได้', async () => {
    state.cards = []
    await expect(saveKeyword('c1', validForm({ target: 'card:card-of-another' })))
      .rejects.toThrow('แคมเปญนี้')
    expect(state.writes).toEqual([])
  })
})

describe('saveKeyword · สร้างกับแก้', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่มี id คือสร้างใหม่ และต่อท้ายลำดับที่มีอยู่', async () => {
    await saveKeyword('c1', validForm())
    expect(lastWrite().text).toContain('INSERT INTO keyword_rule')
    expect(lastWrite().text).toContain('max(sort_order)')
  })

  it('มี id คือแก้ของเดิม และแก้ได้เฉพาะแถวในแคมเปญนี้', async () => {
    await saveKeyword('c1', validForm({ id: 'k1' }))
    expect(lastWrite().text).toContain('UPDATE keyword_rule')
    expect(lastWrite().text).toContain('campaign_id')
    expect(lastWrite().values).toContain('k1')
    expect(lastWrite().values).toContain('c1')
  })

  // UNIQUE (campaign_id, keyword) เป็นคนบังคับ · ที่นี่แค่แปลให้อ่านออก
  it('คำซ้ำในแคมเปญเดียวกัน ได้ข้อความที่อ่านออก ไม่ใช่รหัสของ postgres', async () => {
    state.failWith = Object.assign(new Error('duplicate key value'), { code: '23505' })
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('มีคำนี้อยู่แล้ว')
  })

  it('ข้อผิดพลาดอื่นของฐานข้อมูลไม่ถูกกลบเป็นคำซ้ำ', async () => {
    state.failWith = Object.assign(new Error('connection lost'), { code: '08006' })
    await expect(saveKeyword('c1', validForm())).rejects.toThrow('connection lost')
  })
})
