import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLES_NEVER_COPIED } from '@/lib/campaign/duplicate'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  codeTaken: string | null
  statements: Array<{ text: string; values: unknown[] }>
  redirectedTo: string | null
} = {
  cookie: undefined, user: undefined, codeTaken: null, statements: [], redirectedTo: null,
}

/** ทุกคำสั่งที่เขียนของ · อ่านอย่างเดียวไม่นับ เพราะที่ต้องพิสูจน์คือ "ไม่ได้แตะอะไรเลย" */
const writes = () => state.statements.filter((s) => /INSERT|UPDATE|DELETE/i.test(s.text))

/** postgres.js เป็น tagged template ที่มี .begin() ห้อยอยู่ · ตัวแทนต้องเป็นแบบเดียวกัน */
const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    state.statements.push({ text, values })

    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
    if (/SELECT id FROM campaign WHERE code/.test(text)) {
      return Promise.resolve(state.codeTaken === values[0] ? [{ id: 'taken' }] : [])
    }
    if (/FROM campaign WHERE id/.test(text)) {
      return Promise.resolve([{ timezone: 'Asia/Bangkok', day_length_sec: 86400, theme: {} }])
    }
    if (/INSERT INTO campaign/.test(text)) return Promise.resolve([{ id: 'new-id' }])
    return Promise.resolve([])
  },
  {
    array: (value: unknown) => value,
    json: (value: unknown) => value,
    // ธุรกรรมของจริงส่ง sql ตัวใหม่เข้ามา · ตัวแทนส่งตัวเดิม ซึ่งพอสำหรับการนับคำสั่ง
    begin: (run: (tx: unknown) => unknown) => Promise.resolve(run(sql)),
  },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { duplicate } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = () => form({
  source_id: 'c1', name: 'แคมเปญใหม่', code: 'melo_copy',
  start_at: '2026-09-01', end_at: '2026-09-30',
})

/** สำเร็จแล้วจบด้วย redirect ซึ่งโยน · เรียกผ่านตัวนี้เพื่อให้อ่านง่ายว่าอันไหนคือสำเร็จ */
const runExpectingRedirect = async (data: FormData) => {
  await expect(duplicate(data)).rejects.toThrow('NEXT_REDIRECT')
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.codeTaken = null
  state.statements = []
  state.redirectedTo = null
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * ก๊อปแคมเปญคืออ่านของทุกแถวของแคมเปญคนอื่นแล้วเขียนเป็นแคมเปญใหม่ที่คนกดเป็นเจ้าของ
 * — จอซ่อนฟอร์มไว้จากคนที่กดไม่ได้ แต่จอไม่ใช่ประตู
 */
describe('duplicate · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ก๊อปไม่ได้', async () => {
    await expect(duplicate(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ก๊อปไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(duplicate(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(duplicate(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาก๊อปไม่ได้', async () => {
    signedInAs('content_editor')
    await expect(duplicate(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('ผู้ดูรายงานก๊อปไม่ได้', async () => {
    signedInAs('reporter')
    await expect(duplicate(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญก๊อปได้', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(writes().length).toBeGreaterThan(0)
  })
})

describe('duplicate · ตรวจค่าที่กรอกก่อนแตะฐานข้อมูล', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่ได้เลือกต้นทาง ไม่เขียนอะไรเลย', async () => {
    await expect(duplicate(form({ ...Object.fromEntries(validForm()) as Record<string, string>, source_id: '' })))
      .rejects.toThrow('ต้นทาง')
    expect(writes()).toEqual([])
  })

  it('รหัสผิดรูป ไม่เขียนอะไรเลย', async () => {
    for (const code of ['', 'MELO', 'melo-copy', 'x'.repeat(21)]) {
      state.statements = []
      const data = validForm()
      data.set('code', code)
      await expect(duplicate(data), code).rejects.toThrow('รหัส')
      expect(writes(), code).toEqual([])
    }
  })

  // BR-29 · แคมเปญใหม่เป็นคนละช่วงเวลา วันจึงไม่ถูกก๊อปมาและต้องกรอกเอง
  it('ขาดวันใดวันหนึ่ง ไม่เขียนอะไรเลย', async () => {
    for (const key of ['start_at', 'end_at']) {
      state.statements = []
      const data = validForm()
      data.set(key, '')
      await expect(duplicate(data), key).rejects.toThrow('BR-29')
      expect(writes(), key).toEqual([])
    }
  })

  it('วันสิ้นสุดก่อนวันเริ่ม ไม่เขียนอะไรเลย', async () => {
    const data = validForm()
    data.set('end_at', '2026-08-01')
    await expect(duplicate(data)).rejects.toThrow('วันสิ้นสุด')
    expect(writes()).toEqual([])
  })

  /**
   * รหัสซ้ำต้องถูกบอกเป็นประโยค ไม่ใช่ปล่อยให้ UNIQUE ของตารางเป็นคนพูด
   *
   * `campaign.code` เป็น UNIQUE · ปล่อยไปถึงฐานข้อมูลแล้วคนกดจะเจอหน้า error ของ
   * Next ที่เขียนว่า duplicate key value violates unique constraint ซึ่งไม่ได้บอก
   * ว่าต้องแก้ช่องไหน และธุรกรรมที่ล้มกลางทางแปลว่าก๊อปมาแล้วทิ้งทั้งหมด
   */
  it('รหัสที่มีแคมเปญอื่นใช้อยู่แล้ว บอกเป็นประโยคและไม่เขียนอะไรเลย', async () => {
    state.codeTaken = 'melo_copy'
    await expect(duplicate(validForm())).rejects.toThrow('melo_copy')
    expect(writes()).toEqual([])
  })

  it('รหัสที่ยังว่าง ผ่านไปได้', async () => {
    state.codeTaken = 'somebody_else'
    await runExpectingRedirect(validForm())
    expect(writes().length).toBeGreaterThan(0)
  })
})

describe('duplicate · เจ้าของและปลายทาง', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('เจ้าของแถวใหม่มาจาก session ไม่ใช่จากฟอร์ม', async () => {
    const forged = validForm()
    forged.append('actor_id', 'someone-else')
    forged.append('created_by', 'someone-else')
    await runExpectingRedirect(forged)

    const insert = writes().find((write) => /INSERT INTO campaign/.test(write.text))!
    expect(insert.values).toContain('u1')
    expect(insert.values).not.toContain('someone-else')
  })

  // สถานะเป็นค่าคงที่ในคำสั่ง ไม่ใช่พารามิเตอร์ · ก๊อปสถานะของต้นทางมาแปลว่า
  // แคมเปญที่ยังไม่มีใครตรวจถูกนับเป็นแคมเปญที่ส่งขึ้นแล้ว
  it('แคมเปญใหม่เป็นร่างเสมอ ไม่ว่าต้นทางจะส่งขึ้นแล้วหรือยัง', async () => {
    await runExpectingRedirect(validForm())
    const insert = writes().find((write) => /INSERT INTO campaign/.test(write.text))!
    expect(insert.text).toContain("'draft'")
    expect(insert.values).not.toContain('published')
  })

  it('พาไปที่แคมเปญใหม่ ไม่ใช่กลับไปรายการ', async () => {
    await runExpectingRedirect(validForm())
    expect(state.redirectedTo).toBe('/campaigns/new-id')
  })
})

/**
 * BR-24 · ข้อห้ามไม่มีสวิตช์ แม้จะส่งมาเองกับฟอร์ม
 *
 * จอไม่มีช่องให้ติ๊ก แต่ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้ทั้งใบ · เทสต์นี้ส่งชื่อช่องที่
 * คนจะเดาว่าเปิดข้อห้ามได้ แล้วยืนยันว่าไม่มีคำสั่งไหนไปแตะตารางต้องห้ามเลย
 */
describe('duplicate · ตารางต้องห้ามไม่มีทางถูกเปิดจากฟอร์ม', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ส่งช่องที่ขอให้ก๊อปบัญชีและผู้เล่นมาด้วย ก็ไม่มีอะไรเปลี่ยน', async () => {
    const forged = validForm()
    for (const key of [
      'copy_channel', 'include_channel', 'copy_participants',
      'include_participants', 'copy_entitlements', 'copy_reward_code',
    ]) forged.append(key, 'true')
    for (const table of TABLES_NEVER_COPIED) forged.append(table, 'on')

    await runExpectingRedirect(forged)

    const touched = writes().filter((write) =>
      TABLES_NEVER_COPIED.some((table) => new RegExp(`\\b(INTO|UPDATE)\\s+${table}\\b`).test(write.text)))
    expect(touched.map((write) => write.text)).toEqual([])
  })

  it('ก๊อปตามปกติก็ไม่แตะตารางต้องห้ามอยู่แล้ว', async () => {
    await runExpectingRedirect(validForm())

    for (const table of TABLES_NEVER_COPIED) {
      const touched = writes().filter((write) =>
        new RegExp(`\\b(INTO|UPDATE)\\s+${table}\\b`).test(write.text))
      expect(touched.map((write) => write.text), table).toEqual([])
    }
  })
})
