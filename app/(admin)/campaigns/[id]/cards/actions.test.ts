import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardView } from '@/lib/db/cards'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  card: CardView | null
  statements: Array<{ text: string; values: unknown[] }>
  revalidated: string[]
} = {
  cookie: undefined,
  user: undefined,
  card: null,
  statements: [],
  revalidated: [],
}

const writes = () => state.statements.filter((s) => /DELETE/i.test(s.text))

const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
  state.statements.push({ text, values })

  if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
  return Promise.resolve([])
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => { state.revalidated.push(path) } }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))
// loadCard คือแหล่งความจริงเดียวของ isOrphan/usedBy (M3-S01 ใช้ตัวเดียวกัน) — เทสต์
// นี้จึงปลอมแค่คำตอบของมัน ไม่ต้องปลอม selectCards ทั้งก้อนที่ซับซ้อนกว่ามาก
vi.mock('@/lib/db/cards', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/db/cards')
  return { ...actual, loadCard: async () => state.card }
})

const { deleteCard } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const orphanCard = (patch: Partial<CardView> = {}): CardView => ({
  id: 'card-1', code: 'welcome', renderAs: 'flex_bubble', renderName: 'การ์ดเดี่ยว',
  hasImage: false, previewText: 'ยินดีต้อนรับ', usedBy: [], isOrphan: true, ...patch,
})

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.card = null
  state.statements = []
  state.revalidated = []
})

describe('deleteCard · สิทธิ์', () => {
  it('ยังไม่เข้าระบบ ลบไม่ได้ และไม่มี DELETE ใดถูกยิง', async () => {
    state.card = orphanCard()
    const result = await deleteCard('camp-1', 'card-1')
    expect(result).toEqual({ ok: false, message: 'ต้องเข้าสู่ระบบก่อน' })
    expect(writes()).toEqual([])
  })

  it('บทบาทอื่นที่ไม่ใช่ผู้ตั้งค่าแคมเปญลบไม่ได้ แม้การ์ดจะไม่มีใครใช้อยู่จริง', async () => {
    signedInAs('content_editor')
    state.card = orphanCard()
    const result = await deleteCard('camp-1', 'card-1')
    expect(result.ok).toBe(false)
    expect(writes()).toEqual([])
  })
})

describe('deleteCard · ด่านความปลอดภัย: ห้ามลบการ์ดที่ยังมีคนใช้อยู่', () => {
  it('การ์ดที่มีคนชี้มาอยู่ ปฏิเสธและไม่ยิง DELETE เลย — แม้เรียกตรงจากนอกจอ ไม่ผ่านปุ่มที่ซ่อนไว้', async () => {
    signedInAs('configurator')
    state.card = orphanCard({
      isOrphan: false,
      usedBy: [
        { kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' },
        { kind: 'richmenu', label: 'ริชเมนู "main" · ปุ่มบนเมนู' },
      ],
    })

    const result = await deleteCard('camp-1', 'card-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('คีย์เวิร์ด "เล่น"')
      expect(result.message).toContain('ริชเมนู "main" · ปุ่มบนเมนู')
    }
    expect(writes()).toEqual([])
  })

  it('ไม่พบการ์ดนี้ในแคมเปญนี้ ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    state.card = null

    const result = await deleteCard('camp-1', 'ghost')

    expect(result).toEqual({ ok: false, message: 'ไม่พบการ์ดนี้ในแคมเปญนี้' })
    expect(writes()).toEqual([])
  })
})

describe('deleteCard · การ์ดที่ไม่มีใครใช้จริง', () => {
  it('ลบสำเร็จ ยิง DELETE ที่ผูกทั้งการ์ดและแคมเปญ แล้วสั่งโหลดจอรายการใหม่', async () => {
    signedInAs('configurator')
    state.card = orphanCard()

    const result = await deleteCard('camp-1', 'card-1')

    expect(result).toEqual({ ok: true })
    const [deleteStatement] = writes()
    expect(deleteStatement?.text).toContain('DELETE FROM card')
    expect(deleteStatement?.values).toEqual(['card-1', 'camp-1'])
    expect(state.revalidated).toContain('/campaigns/camp-1/cards')
  })
})
