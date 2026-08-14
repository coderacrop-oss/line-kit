import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  writes: Array<{ text: string; values: unknown[] }>
} = { cookie: undefined, user: undefined, writes: [] }

/** postgres.js เป็น tagged template — ตัวแทนของมันจึงต้องเป็นฟังก์ชันแบบเดียวกัน */
const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
  if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
  state.writes.push({ text, values })
  return Promise.resolve([])
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { createCampaign } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = () => form({ name: 'ครบเจ็ดวัน', code: 'krob7', end_at: '2026-12-31' })

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.writes = []
})

/**
 * The role gate, exercised through the action rather than around it.
 *
 * requireRole is unit tested on its own, but that proves the gate works — not
 * that this action stands behind it. These call createCampaign the way a forged
 * request would and assert that nothing reached the database, because an action
 * is reachable by anyone who can guess its name whether or not a screen drew a
 * button for it.
 */
describe('createCampaign · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ เขียนไม่ได้', async () => {
    await expect(createCampaign(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต เขียนไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(createCampaign(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาเห็นหน้านี้ได้ แต่สร้างแคมเปญไม่ได้', async () => {
    signedInAs('content_editor')
    await expect(createCampaign(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานสร้างแคมเปญไม่ได้', async () => {
    signedInAs('reporter')
    await expect(createCampaign(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(createCampaign(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญเขียนได้', async () => {
    signedInAs('configurator')
    await createCampaign(validForm())

    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].text).toContain('INSERT INTO campaign')
  })

  // ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้ทั้งใบ · เจ้าของแถวจึงต้องมาจาก session เท่านั้น
  it('ปลอม created_by มาในฟอร์มก็ไม่มีผล เจ้าของมาจาก session', async () => {
    signedInAs('configurator')
    const forged = validForm()
    forged.append('created_by', 'someone-else')
    await createCampaign(forged)

    expect(state.writes[0].values).toContain('u1')
    expect(state.writes[0].values).not.toContain('someone-else')
  })
})

describe('createCampaign · ตรวจค่าที่กรอก', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่มีชื่อ สร้างไม่ได้', async () => {
    await expect(createCampaign(form({ name: '   ', code: 'ok', end_at: '2026-12-31' })))
      .rejects.toThrow('ชื่อ')
    expect(state.writes).toEqual([])
  })

  it('รหัสผิดรูป สร้างไม่ได้ — กันไว้ก่อนถึง CHECK ของตาราง', async () => {
    for (const code of ['', 'UPPER', 'has-dash', 'has space', 'ก', 'x'.repeat(21)]) {
      state.writes = []
      await expect(createCampaign(form({ name: 'ชื่อ', code, end_at: '2026-12-31' })), code)
        .rejects.toThrow('รหัส')
      expect(state.writes, code).toEqual([])
    }
  })

  it('รหัสที่ถูกรูปผ่าน', async () => {
    for (const code of ['a', 'krob_7', '0', 'x'.repeat(20)]) {
      state.writes = []
      await createCampaign(form({ name: 'ชื่อ', code, end_at: '2026-12-31' }))
      expect(state.writes, code).toHaveLength(1)
    }
  })

  // BR-29 · วันจบเป็นจุดเริ่มนับของสถิติและของการลบข้อมูล ไม่มีค่าเริ่มต้นให้เดา
  it('ไม่มีวันจบ สร้างไม่ได้', async () => {
    await expect(createCampaign(form({ name: 'ชื่อ', code: 'ok', end_at: '' })))
      .rejects.toThrow('วันจบ')
    expect(state.writes).toEqual([])
  })
})
