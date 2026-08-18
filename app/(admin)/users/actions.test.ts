import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  users: Row[]
  writes: Array<{ text: string; values: unknown[] }>
} = { cookie: undefined, users: [], writes: [] }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user WHERE lower\(email\)/.test(text)) {
        const email = String(values[0] ?? '').toLowerCase()
        const found = state.users.find((row) => row.email.toLowerCase() === email)
        return Promise.resolve(found ? [found] : [])
      }
      if (/FROM app_user$/.test(text)) return Promise.resolve(state.users)
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    return Promise.resolve([])
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
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const actions = await import('./actions')
const { addUser, saveTestLineUid, setUserActive, setUserRole } = actions

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const ME: Row = { id: 'me', email: 'me@example.com', role: 'configurator', is_active: true }

/** คนที่กำลังกด · ต้องอยู่ในรายการด้วย เพราะ getSession อ่านจากตารางเดียวกัน */
const signedInAs = (role: string, isActive = true) => {
  const me = { ...ME, role, is_active: isActive }
  state.users = [me, ...state.users.filter((row) => row.id !== 'me')]
  state.cookie = me.email
}

const alsoOnTheTeam = (...rows: Array<Partial<Row>>) => {
  state.users.push(...rows.map((row, index) => ({
    id: `u${index}`, email: `u${index}@example.com`,
    role: 'content_editor', is_active: true, ...row,
  })))
}

const lastWrite = () => {
  const write = state.writes.at(-1)
  if (!write) throw new Error('ไม่มีการเขียนเกิดขึ้น')
  return write
}

beforeEach(() => {
  state.cookie = undefined
  state.users = []
  state.writes = []
})

const VALID_UID = `U${'0123456789abcdef'.repeat(2)}`

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * This screen decides who may open every other screen in the system. The form
 * is hidden from anyone who is not a configurator, but the form is not the door
 * — the action is, and it answers to anybody who can name it.
 */
describe('จัดการผู้ใช้ · ด่านสิทธิ์', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['addUser', () => addUser(form({ email: 'new@example.com', role: 'reporter' }))],
    ['setUserRole', () => setUserRole(form({ id: 'u0', role: 'reporter' }))],
    ['setUserActive', () => setUserActive(form({ id: 'u0', active: 'false' }))],
  ]

  for (const [name, call] of calls) {
    it(`${name} · ยังไม่ได้เข้าระบบ ทำไม่ได้`, async () => {
      alsoOnTheTeam({ id: 'u0' })
      await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
      expect(state.writes).toEqual([])
    })

    it(`${name} · มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ทำไม่ได้`, async () => {
      alsoOnTheTeam({ id: 'u0' })
      state.cookie = 'ghost@example.com'
      await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
      expect(state.writes).toEqual([])
    })

    it(`${name} · สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย`, async () => {
      alsoOnTheTeam({ id: 'u0' })
      signedInAs('configurator', false)
      await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
      expect(state.writes).toEqual([])
    })

    it(`${name} · ผู้ดูรายงานทำไม่ได้`, async () => {
      alsoOnTheTeam({ id: 'u0' })
      signedInAs('reporter')
      await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
      expect(state.writes).toEqual([])
    })

    it(`${name} · ผู้ดูแลเนื้อหาทำไม่ได้`, async () => {
      alsoOnTheTeam({ id: 'u0' })
      signedInAs('content_editor')
      await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
      expect(state.writes).toEqual([])
    })

    it(`${name} · ผู้ตั้งค่าแคมเปญทำได้`, async () => {
      alsoOnTheTeam({ id: 'u0' }, { id: 'spare', role: 'configurator' })
      signedInAs('configurator')
      await expect(call()).resolves.toBeUndefined()
      expect(state.writes.length).toBeGreaterThan(0)
    })
  }
})

describe('addUser', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('เพิ่มแล้วได้แถวใหม่พร้อมคนที่เพิ่ม', async () => {
    await addUser(form({ email: 'new@example.com', role: 'content_editor' }))
    expect(lastWrite().text).toContain('INSERT INTO app_user')
    expect(lastWrite().values).toContain('new@example.com')
    expect(lastWrite().values).toContain('content_editor')
    expect(lastWrite().values).toContain('me')
  })

  // resolveUser จับคู่ด้วย lower(email) · แถวที่เก็บตัวใหญ่ไว้จะแสดงคนละแบบกับที่คนพิมพ์
  it('เก็บอีเมลเป็นตัวพิมพ์เล็กเสมอ', async () => {
    await addUser(form({ email: '  New.Person@Example.COM ', role: 'reporter' }))
    expect(lastWrite().values).toContain('new.person@example.com')
  })

  it('รูปแบบอีเมลไม่ถูกต้อง ไม่เขียนอะไรเลย', async () => {
    for (const email of ['', 'someone', 'someone@', '@example.com', 'a b@example.com']) {
      state.writes = []
      await expect(addUser(form({ email, role: 'reporter' })), email).rejects.toThrow('อีเมล')
      expect(state.writes).toEqual([])
    }
  })

  it('บทบาทที่ไม่มีอยู่จริง ไม่เขียนอะไรเลย', async () => {
    for (const role of ['', 'admin', 'CONFIGURATOR', 'owner']) {
      state.writes = []
      await expect(addUser(form({ email: 'new@example.com', role })), role).rejects.toThrow('บทบาท')
      expect(state.writes).toEqual([])
    }
  })

  it('อีเมลที่มีอยู่แล้ว บอกบทบาทปัจจุบันแทนที่จะเพิ่มซ้ำ', async () => {
    alsoOnTheTeam({ id: 'u0', email: 'taken@example.com', role: 'configurator' })
    await expect(addUser(form({ email: 'taken@example.com', role: 'reporter' })))
      .rejects.toThrow('ผู้ตั้งค่าแคมเปญ')
    expect(state.writes).toEqual([])
  })

  /** ทางกลับเข้ามาของคนที่ถูกถอนสิทธิ์คือปุ่มคืนสิทธิ์ · ไม่ใช่การเพิ่มแถวที่สอง */
  it('อีเมลที่ถูกถอนสิทธิ์ไว้ ชี้ไปที่ปุ่มคืนสิทธิ์ ไม่เพิ่มแถวใหม่', async () => {
    alsoOnTheTeam({ id: 'u0', email: 'gone@example.com', is_active: false })
    await expect(addUser(form({ email: 'gone@example.com', role: 'reporter' })))
      .rejects.toThrow('คืนสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('เทียบอีเมลซ้ำโดยไม่สนตัวพิมพ์', async () => {
    alsoOnTheTeam({ id: 'u0', email: 'taken@example.com' })
    await expect(addUser(form({ email: 'TAKEN@example.com', role: 'reporter' })))
      .rejects.toThrow('มีอยู่แล้ว')
    expect(state.writes).toEqual([])
  })
})

/**
 * ประตูที่ปิดจากข้างในไม่ได้
 *
 * Both of these end with nobody able to administer the system, which no screen
 * here can climb back out of — recovering means opening psql against production.
 */
describe('ล็อกที่กันไม่ให้ระบบเหลือคนดูแลศูนย์คน', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ถอนสิทธิ์ตัวเองไม่ได้', async () => {
    alsoOnTheTeam({ id: 'spare', role: 'configurator' })
    await expect(setUserActive(form({ id: 'me', active: 'false' })))
      .rejects.toThrow('ตัวเอง')
    expect(state.writes).toEqual([])
  })

  it('เปลี่ยนบทบาทตัวเองไม่ได้ แม้จะมีผู้ตั้งค่าคนอื่นเหลืออยู่', async () => {
    alsoOnTheTeam({ id: 'spare', role: 'configurator' })
    await expect(setUserRole(form({ id: 'me', role: 'reporter' })))
      .rejects.toThrow('ตัวเอง')
    expect(state.writes).toEqual([])
  })

  /**
   * แถวของตัวเองถูกปฏิเสธทุกบทบาทที่เลือก ไม่ใช่เฉพาะขาลง
   *
   * The rule that catches a demotion lives in lockReason, and lockReason is only
   * consulted when the new role is not 'configurator'. Choosing 'configurator'
   * for your own row therefore slips past it — a write that changes nothing
   * today, and the only thing standing between "this branch is fine" and a
   * self-demotion the day somebody edits which roles the branch covers. The
   * screen disables the picker on your own row; the action has to say the same
   * thing for every value the picker could have held.
   */
  it('เปลี่ยนบทบาทตัวเองเป็นผู้ตั้งค่าก็ไม่ได้ · แถวของตัวเองถูกปฏิเสธทุกทาง', async () => {
    alsoOnTheTeam({ id: 'spare', role: 'configurator' })
    for (const role of ['configurator', 'content_editor', 'reporter']) {
      state.writes = []
      await expect(setUserRole(form({ id: 'me', role })), role).rejects.toThrow('ตัวเอง')
      expect(state.writes, role).toEqual([])
    }
  })

  /**
   * ผู้ตั้งค่าคนสุดท้ายไม่มีทางเป็นคนอื่นในสายตาของคนที่กดได้ · และนั่นคือเหตุผล
   * ที่ทั้งสองด่านนี้ยังอยู่แม้จะไม่มีทางเข้าถึงจากตัว action วันนี้
   *
   * `requireRole('configurator')` แปลว่าคนที่กดเป็นผู้ตั้งค่าที่ยังใช้งานได้ และ
   * `loadTarget` นับผู้ตั้งค่าจากทั้งตารางซึ่งรวมคนที่กดอยู่ด้วย · ถ้าเป้าหมายเป็น
   * ผู้ตั้งค่าที่ยังใช้งานได้อีกคน จำนวนย่อมเป็นสองขึ้นไปเสมอ ล็อกจึงไม่ทำงาน และ
   * ถ้าเป้าหมายคือคนที่กดเอง ล็อกที่ทำงานคือล็อกตัวเองซึ่งอยู่คนละบรรทัด
   *
   * สามเทสต์ที่เคยอยู่ตรงนี้ตั้งชื่อว่าทดสอบกฎข้อนี้ทั้งสามตัว แต่ตัวหนึ่งวัดด่าน
   * เข้าระบบ ตัวหนึ่งวัดล็อกตัวเอง และตัวสุดท้าย assert ว่า "ลดบทบาทได้" ทั้งที่
   * ชื่อบอกว่าไม่ได้ · เทสต์ที่ชื่อไม่ตรงกับที่มันวัด แย่กว่าไม่มีเทสต์ เพราะมัน
   * ทำให้ไม่มีใครไปเขียนตัวจริง — กฎตัวจริงถูกวัดที่ lockReason ใน
   * lib/db/users.test.ts ซึ่งเรียกมันตรงๆ ได้โดยไม่ติดข้อจำกัดข้างบน
   */
  it('คนที่กดถูกนับรวมด้วย · ผู้ตั้งค่าอีกคนจึงไม่เคยเป็นคนสุดท้าย', async () => {
    state.users = [
      { id: 'me', email: 'me@example.com', role: 'configurator', is_active: true },
      { id: 'last', email: 'last@example.com', role: 'configurator', is_active: true },
    ]
    state.cookie = 'me@example.com'

    await setUserActive(form({ id: 'last', active: 'false' }))
    expect(lastWrite().text).toContain('UPDATE app_user')
    expect(lastWrite().values).toContain('last')
  })

  it('คนที่กดถูกถอนสิทธิ์ไปแล้ว ไม่ได้ผ่านด่านเข้าระบบตั้งแต่ต้น', async () => {
    state.users = [
      { id: 'me', email: 'me@example.com', role: 'configurator', is_active: false },
      { id: 'last', email: 'last@example.com', role: 'configurator', is_active: true },
    ]
    state.cookie = 'me@example.com'

    await expect(setUserActive(form({ id: 'last', active: 'false' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าคนเดียวที่เหลือ ถอนสิทธิ์ตัวเองไม่ได้', async () => {
    state.users = [
      { id: 'last', email: 'last@example.com', role: 'configurator', is_active: true },
    ]
    state.cookie = 'last@example.com'

    await expect(setUserActive(form({ id: 'last', active: 'false' })))
      .rejects.toThrow('ตัวเอง')
    expect(state.writes).toEqual([])
  })

  it('ลดบทบาทผู้ตั้งค่าอีกคนได้ · คนที่กดยังอยู่ ระบบจึงไม่เหลือศูนย์คน', async () => {
    alsoOnTheTeam({ id: 'last', role: 'configurator' })
    await setUserRole(form({ id: 'last', role: 'reporter' }))
    expect(lastWrite().values).toContain('reporter')
    expect(lastWrite().values).toContain('last')
  })

  it('มีผู้ตั้งค่าสองคน ถอนคนหนึ่งได้จริง', async () => {
    alsoOnTheTeam({ id: 'other', role: 'configurator' })
    await setUserActive(form({ id: 'other', active: 'false' }))
    expect(lastWrite().text).toContain('UPDATE app_user')
    expect(lastWrite().values).toContain(false)
  })

  it('คืนสิทธิ์ไม่ติดล็อกผู้ตั้งค่าคนสุดท้าย', async () => {
    alsoOnTheTeam({ id: 'other', role: 'configurator', is_active: false })
    await setUserActive(form({ id: 'other', active: 'true' }))
    expect(lastWrite().values).toContain(true)
  })

  it('เลื่อนคนขึ้นเป็นผู้ตั้งค่าได้เสมอ ไม่มีใครถูกล็อกออกจากการเลื่อนขึ้น', async () => {
    alsoOnTheTeam({ id: 'other' })
    await setUserRole(form({ id: 'other', role: 'configurator' }))
    expect(lastWrite().values).toContain('configurator')
  })

  it('ผู้ใช้ที่ไม่มีอยู่จริง ไม่เขียนอะไรเลย', async () => {
    for (const call of [
      () => setUserRole(form({ id: 'ไม่มีจริง', role: 'reporter' })),
      () => setUserActive(form({ id: 'ไม่มีจริง', active: 'false' })),
    ]) {
      state.writes = []
      await expect(call()).rejects.toThrow('ไม่พบผู้ใช้')
      expect(state.writes).toEqual([])
    }
  })

  it('บทบาทที่ไม่มีอยู่จริง ไม่เขียนอะไรเลย', async () => {
    alsoOnTheTeam({ id: 'other' })
    for (const role of ['', 'admin', 'owner']) {
      state.writes = []
      await expect(setUserRole(form({ id: 'other', role })), role).rejects.toThrow('บทบาท')
      expect(state.writes).toEqual([])
    }
  })
})

/**
 * ถอนสิทธิ์ไม่ลบแถว
 *
 * config_version.published_by is a NOT NULL reference to this table. Deleting a
 * row would either be refused by the database or, with a cascade added to make
 * the refusal go away, would erase who published a version that is still live.
 */
describe('setUserActive · ไม่เคยลบแถว', () => {
  beforeEach(() => {
    signedInAs('configurator')
    alsoOnTheTeam({ id: 'other', role: 'configurator' })
  })

  /**
   * ไม่มีทางลบผู้ใช้จากที่ไหนในโมดูลนี้เลย
   *
   * The rule is not "the revoke button does an UPDATE"; it is that deleting a
   * user is not a thing this application can do. A second action added later —
   * to tidy up somebody added by mistake, say — would be reasonable-looking and
   * would erase the name attached to a published version, so the absence has to
   * be measured rather than assumed from the one action that exists today.
   */
  it('โมดูลนี้ไม่มี action ที่ลบผู้ใช้เลย', () => {
    expect(Object.keys(actions).filter((name) => /delete|remove|destroy|purge/i.test(name)))
      .toEqual([])
  })

  it('ถอนสิทธิ์เขียน UPDATE ไม่ใช่ DELETE', async () => {
    await setUserActive(form({ id: 'other', active: 'false' }))
    expect(lastWrite().text).toContain('UPDATE app_user')
    expect(lastWrite().text).toContain('is_active')
    expect(lastWrite().text).not.toContain('DELETE')
  })

  it('ไม่มีคำสั่ง DELETE โผล่มาในทุกคำสั่งที่เขียน', async () => {
    await setUserActive(form({ id: 'other', active: 'false' }))
    await setUserActive(form({ id: 'other', active: 'true' }))
    for (const write of state.writes) expect(write.text).not.toMatch(/DELETE/i)
  })

  it('แก้เฉพาะแถวที่ระบุมา', async () => {
    await setUserActive(form({ id: 'other', active: 'false' }))
    expect(lastWrite().text).toContain('WHERE id')
    expect(lastWrite().values).toContain('other')
    expect(lastWrite().values).not.toContain('me')
  })
})

/**
 * LINE ของตัวเองเท่านั้น
 *
 * Writing somebody else's would be a way to have their test card delivered to
 * your phone — a card that is still a secret, read silently, from a screen that
 * reports nothing unusual.
 */
describe('saveTestLineUid', () => {
  it('ยังไม่ได้เข้าระบบ ตั้งไม่ได้', async () => {
    await expect(saveTestLineUid(form({ test_line_uid: VALID_UID })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว ตั้งไม่ได้', async () => {
    signedInAs('configurator', false)
    await expect(saveTestLineUid(form({ test_line_uid: VALID_UID })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ทุกบทบาทตั้งของตัวเองได้ · การ์ดทดสอบไปเครื่องตัวเอง ไม่ได้พ่วงสิทธิ์อะไรมา', async () => {
    for (const role of ['configurator', 'content_editor', 'reporter']) {
      state.writes = []
      signedInAs(role)
      await saveTestLineUid(form({ test_line_uid: VALID_UID }))
      expect(lastWrite().values, role).toContain(VALID_UID)
    }
  })

  it('เขียนที่แถวของคนที่ล็อกอินอยู่ ไม่ใช่ id ที่ส่งมากับฟอร์ม', async () => {
    signedInAs('configurator')
    alsoOnTheTeam({ id: 'victim' })
    await saveTestLineUid(form({ test_line_uid: VALID_UID, id: 'victim', user_id: 'victim' }))

    expect(lastWrite().values).toContain('me')
    expect(lastWrite().values).not.toContain('victim')
  })

  it('ล้างค่าได้ด้วยการเว้นว่าง · เก็บเป็น NULL ไม่ใช่สตริงว่าง', async () => {
    signedInAs('configurator')
    await saveTestLineUid(form({ test_line_uid: '   ' }))
    expect(lastWrite().values).toContain(null)
    expect(lastWrite().values).not.toContain('')
  })

  it('รูปแบบผิด ไม่เขียนอะไรเลย', async () => {
    signedInAs('configurator')
    for (const value of ['U123', 'someone@example.com', `${VALID_UID}0`]) {
      state.writes = []
      await expect(saveTestLineUid(form({ test_line_uid: value })), value)
        .rejects.toThrow('LINE user id')
      expect(state.writes).toEqual([])
    }
  })

  it('ตัดช่องว่างหัวท้ายก่อนเก็บ', async () => {
    signedInAs('configurator')
    await saveTestLineUid(form({ test_line_uid: `  ${VALID_UID}  ` }))
    expect(lastWrite().values).toContain(VALID_UID)
  })
})
