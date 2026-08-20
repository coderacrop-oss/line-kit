import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  template: { code: string; blocks: unknown[] } | null
  statements: Array<{ text: string; values: unknown[] }>
  redirectedTo: string | null
  revalidated: string[]
} = {
  cookie: undefined,
  user: undefined,
  template: null,
  statements: [],
  redirectedTo: null,
  revalidated: [],
}

/** ทุกคำสั่งที่เขียนของ · ที่ต้องพิสูจน์บ่อยที่สุดคือ "ไม่ได้แตะอะไรเลย" */
const writes = () => state.statements.filter((s) => /INSERT|UPDATE|DELETE/i.test(s.text))

const cardInsert = () => writes().find((s) => /INSERT INTO card \(/.test(s.text))

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    state.statements.push({ text, values })

    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
    if (/FROM card_template WHERE code/.test(text)) {
      return Promise.resolve(state.template ? [state.template] : [])
    }
    if (/INSERT INTO card \(/.test(text)) return Promise.resolve([{ id: 'card-1' }])
    return Promise.resolve([])
  },
  {
    array: (value: unknown) => value,
    json: (value: unknown) => value,
    begin: (run: (tx: unknown) => unknown) => Promise.resolve(run(sql)),
  },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => { state.revalidated.push(path) },
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { createCard } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = (over: Record<string, string> = {}) => form({
  campaign_id: 'camp-1',
  code: 'welcome',
  send_type: 'flex_bubble',
  template_code: 'line_buttons',
  ...over,
})

const runExpectingRedirect = async (data: FormData) => {
  await expect(createCard(data)).rejects.toThrow('NEXT_REDIRECT')
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.template = {
    code: 'line_buttons',
    blocks: [
      { blockType: 'image', content: '', options: { placement: 'full_top' } },
      { blockType: 'title', content: 'หัวข้อตัวอย่าง' },
    ],
  }
  state.statements = []
  state.redirectedTo = null
  state.revalidated = []
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * จอซ่อนฟอร์มไว้จากคนที่ไม่มีสิทธิ์ แต่จอไม่ใช่ประตู · POST ที่แต่งเองยิงตรงมาที่นี่ได้
 */
describe('สิทธิ์', () => {
  it('ยังไม่เข้าระบบ เขียนอะไรไม่ได้เลย', async () => {
    await expect(createCard(validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาสร้างการ์ดใบใหม่ไม่ได้', async () => {
    // แก้ข้อความและภาพได้ แต่การ์ดใบใหม่คือโครงสร้างของแคมเปญ (Permission Matrix)
    signedInAs('content_editor')
    await expect(createCard(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('ผู้ดูรายงานสร้างไม่ได้', async () => {
    signedInAs('reporter')
    await expect(createCard(validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('บัญชีที่ถูกถอนสิทธิ์แล้วเขียนไม่ได้ แม้บทบาทยังเป็นผู้ตั้งค่า', async () => {
    signedInAs('configurator', false)
    await expect(createCard(validForm())).rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญสร้างได้', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(cardInsert()).toBeDefined()
  })
})

describe('สิ่งที่ถูกเขียนลงไป', () => {
  it('เขียน has_sample_text ลงไปด้วย · ด่าน BR-37 อ่านค่านี้', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())

    const insert = cardInsert()
    expect(insert?.text).toContain('has_sample_text')
    // ค่าที่ส่งไป ไม่ใช่แค่ชื่อคอลัมน์ในคำสั่ง
    expect(insert?.values).toContain(true)
  })

  it('ชนิดการส่งที่เลือกถูกเขียนลง render_as', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm({ send_type: 'text' }))
    expect(cardInsert()?.values).toContain('text')
  })

  it('เทมเพลตที่เลือกถูกจดไว้ที่ template_code', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(cardInsert()?.values).toContain('line_buttons')
  })

  it('บล็อกของเทมเพลตถูกเขียนตามมา', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(writes().filter((s) => /INSERT INTO card_block/.test(s.text))).toHaveLength(2)
  })
})

describe('ค่าที่ยิงเข้ามาแล้วต้องถูกปฏิเสธ', () => {
  it('imagemap_video (ริชวิดีโอ) สร้างได้แล้ว — เฟส 2 เปิดชนิดนี้แล้ว ไม่ถูกปฏิเสธอีกต่อไป', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm({ send_type: 'imagemap_video' }))
    expect(cardInsert()?.values).toContain('imagemap_video')
  })

  it('ชนิดที่ CHECK ของคอลัมน์ไม่รู้จักเลย (แต่งเอง) ถูกปฏิเสธ', async () => {
    signedInAs('configurator')
    await expect(createCard(validForm({ send_type: 'made_up_type' }))).rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('ไม่ได้เลือกชนิด ถูกปฏิเสธ', async () => {
    signedInAs('configurator')
    await expect(createCard(validForm({ send_type: '' }))).rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('รหัสการ์ดผิดรูป ถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createCard(validForm({ code: 'Welcome Card' }))).rejects.toThrow('รหัสการ์ด')
    expect(writes()).toEqual([])
  })

  it('รหัสการ์ดว่าง ถูกปฏิเสธ', async () => {
    signedInAs('configurator')
    await expect(createCard(validForm({ code: '' }))).rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('เทมเพลตที่ไม่มีอยู่ ถูกปฏิเสธและไม่มีการ์ดครึ่งใบเหลือไว้', async () => {
    signedInAs('configurator')
    state.template = null
    await expect(createCard(validForm({ template_code: 'ghost' }))).rejects.toThrow('ไม่พบเทมเพลต')
    expect(writes()).toEqual([])
  })
})

/**
 * ปลายทางหลังสร้าง
 *
 * บล็อกเอดิเตอร์ (Task 13) มีไฟล์จริงแล้วที่ `cards/[cardId]/page.tsx` — พาไปแก้
 * บล็อกทันที แทนที่จะกลับไปจอรายการแล้วให้คนกดเข้าไปเอง `createCardFromTemplate`
 * คืน `id` ของการ์ดที่เพิ่งสร้างมาให้อยู่แล้ว
 */
describe('พาไปไหนต่อ', () => {
  it('พาไปจอแก้บล็อกของการ์ดที่เพิ่งสร้างทันที', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(state.redirectedTo).toBe('/campaigns/camp-1/cards/card-1')
  })

  it('รหัสแคมเปญที่มีอักขระพิเศษถูก encode ก่อนต่อเข้า URL', async () => {
    // รหัสถูกกรองด้วย pattern มาแล้ว แต่ URL ที่ประกอบเองโดยไม่ encode คือรูที่
    // เปิดไว้รอวันที่กติกาของรหัสผ่อนลง
    signedInAs('configurator')
    await runExpectingRedirect(validForm({ campaign_id: 'a b' }))
    expect(state.redirectedTo).toBe('/campaigns/a%20b/cards/card-1')
  })

  it('บอก Next ให้โหลดจอรายการการ์ดใหม่ ไม่งั้นการ์ดใหม่จะไม่โผล่ในรายการ', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(validForm())
    expect(state.revalidated).toContain('/campaigns/camp-1/cards')
  })
})
