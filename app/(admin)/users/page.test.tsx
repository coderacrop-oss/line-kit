// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_CONFIGURATOR_LOCK, ROLE_LABEL, ROLE_ORDER, SELF_LOCK, TEST_LINE_UID_HELP,
} from '@/lib/db/users'
import type { UserRow } from '@/lib/db/users'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: { session: Session; rows: UserRow[]; redirectedTo: string | null } = {
  session: null, rows: [], redirectedTo: null,
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
  usePathname: () => '/users',
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('./actions', () => ({
  addUser: vi.fn(), setUserRole: vi.fn(), setUserActive: vi.fn(), saveTestLineUid: vi.fn(),
}))
vi.mock('@/lib/db/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/users')>()),
  listUsers: async () => state.rows,
}))

const UsersPage = (await import('./page')).default

const aUser = (patch: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  email: 'someone@example.com',
  role: 'content_editor',
  is_active: true,
  test_line_uid: null,
  last_login_at: null,
  has_signed_in: true,
  invited_by_email: 'boss@example.com',
  ...patch,
})

const ME = aUser({ id: 'me', email: 'me@example.com', role: 'configurator' })

const open = async () => render(await UsersPage())

/** แถวของอีเมลนี้ · หาแถวจากอีเมลเพราะนั่นคือสิ่งเดียวที่คนอ่านจอใช้แยกแถว */
const rowOf = (email: string): HTMLElement => {
  const found = screen.getByText(email)
  return found.closest('[data-user-row]') as HTMLElement
}

beforeEach(() => {
  state.session = { userId: 'me', email: 'me@example.com', role: 'configurator' }
  state.rows = [ME, aUser({ id: 'spare', email: 'spare@example.com', role: 'configurator' })]
  state.redirectedTo = null
})

describe('M13-S02 · โครงของจอตามต้นแบบ', () => {
  it('ป้ายรหัสจอกับหัวข้ออยู่ครบ', async () => {
    await open()
    expect(screen.getByText('M13-S02 · Internal users')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ผู้ใช้ภายใน')
  })

  it('ฟอร์มเพิ่มผู้ใช้มีช่องอีเมลกับตัวเลือกบทบาทครบทั้งสาม', async () => {
    const { container } = await open()
    expect(screen.getByText('เพิ่มผู้ใช้')).toBeDefined()
    expect(container.querySelector('input[name="email"]')).not.toBeNull()

    const select = container.querySelector('form select[name="role"]') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual([...ROLE_ORDER])
    expect(Array.from(select.options).map((option) => option.textContent))
      .toEqual(ROLE_ORDER.map((role) => ROLE_LABEL[role]))
  })

  it('บอกว่าเพิ่มแล้วเข้าได้เลย ไม่ต้องรออีเมลเชิญ', async () => {
    await open()
    expect(screen.getByText(/ไม่มีอีเมลเชิญให้ต้องรอ/)).toBeDefined()
  })

  it('ทุกแถวบอกเข้าล่าสุดและคนที่เพิ่มมา', async () => {
    state.rows = [ME]
    await open()
    expect(within(rowOf('me@example.com')).getByText(/เข้าล่าสุด ยังไม่เคยเข้าระบบ · เพิ่มโดย boss@example.com/))
      .toBeDefined()
  })

  it('แถวของตัวเองมีป้ายว่าคุณ', async () => {
    await open()
    expect(within(rowOf('me@example.com')).getByText('คุณ')).toBeDefined()
    expect(within(rowOf('spare@example.com')).queryByText('คุณ')).toBeNull()
  })

  it('เพิ่มอีเมลไว้แต่ยังไม่เคยล็อกอิน ถูกเขียนไว้บนแถว', async () => {
    state.rows = [ME, aUser({ id: 'new', email: 'new@example.com', has_signed_in: false })]
    await open()
    expect(within(rowOf('new@example.com')).getByText('เพิ่มอีเมลแล้วแต่เจ้าตัวยังไม่เคยล็อกอิน'))
      .toBeDefined()
    expect(within(rowOf('me@example.com')).queryByText('เพิ่มอีเมลแล้วแต่เจ้าตัวยังไม่เคยล็อกอิน'))
      .toBeNull()
  })

  it('สถานะเขียนเป็นคำทั้งสองแบบ', async () => {
    state.rows = [ME, aUser({ id: 'gone', email: 'gone@example.com', is_active: false })]
    await open()
    expect(within(rowOf('me@example.com')).getByText('ใช้งานได้')).toBeDefined()
    expect(within(rowOf('gone@example.com')).getByText('ถูกถอนสิทธิ์')).toBeDefined()
  })

  it('ตารางสิทธิ์ท้ายจอบอกครบทั้งสามบทบาท', async () => {
    await open()
    expect(screen.getByText('สิทธิ์แต่ละบทบาททำอะไรได้')).toBeDefined()
    expect(screen.getByText('ตั้งค่าทุกอย่าง · ผูกบัญชี LINE · ส่งขึ้น · จัดการผู้ใช้')).toBeDefined()
    expect(screen.getByText('แก้ข้อความและภาพในการ์ด · คลังภาพ · ทดลองเล่น')).toBeDefined()
    expect(screen.getByText('ดูอย่างเดียว · กดเล่นและแก้อะไรไม่ได้')).toBeDefined()
  })
})

/**
 * ถอนสิทธิ์คือปิดใช้งานแถว ไม่ใช่ลบแถว
 *
 * `config_version.published_by` ชี้มาที่ตารางนี้แบบ NOT NULL · แถวที่หายไปคือ
 * ประวัติที่ตอบไม่ได้ว่าใครส่งรุ่นที่ยังอยู่บน OA ของลูกค้าขึ้นไป
 */
describe('M13-S02 · ถอนสิทธิ์ไม่ลบแถว', () => {
  it('ปุ่มบนแถวที่ยังใช้งานได้ส่งคำสั่งปิดใช้งาน ไม่ใช่คำสั่งลบ', async () => {
    await open()
    const form = within(rowOf('spare@example.com')).getByRole('button', { name: 'ถอนสิทธิ์' })
      .closest('form') as HTMLFormElement
    const active = form.querySelector('input[name="active"]') as HTMLInputElement
    expect(active.value).toBe('false')
    expect(form.querySelector('[name="delete"]')).toBeNull()
  })

  it('แถวที่ถูกถอนไปแล้วยังอยู่บนจอ พร้อมปุ่มคืนสิทธิ์', async () => {
    state.rows = [ME, aUser({ id: 'gone', email: 'gone@example.com', is_active: false })]
    await open()
    const row = rowOf('gone@example.com')
    const form = within(row).getByRole('button', { name: 'คืนสิทธิ์' }).closest('form') as HTMLFormElement
    expect((form.querySelector('input[name="active"]') as HTMLInputElement).value).toBe('true')
  })

  it('ไม่มีปุ่มที่เขียนว่าลบอยู่บนจอนี้เลย', async () => {
    state.rows = [ME, aUser({ id: 'gone', email: 'gone@example.com', is_active: false })]
    const { container } = await open()
    for (const button of Array.from(container.querySelectorAll('button'))) {
      expect(button.textContent, button.textContent ?? '').not.toMatch(/ลบ/)
    }
  })

  it('จอเขียนไว้ว่าถอนสิทธิ์แล้วแถวยังอยู่ และบอกเหตุผล', async () => {
    const { container } = await open()
    expect(screen.getByText(/ถอนสิทธิ์แล้วแถวยังอยู่/)).toBeDefined()
    expect(container.textContent).toContain('ประวัติการส่งขึ้น')
  })
})

/**
 * สองประตูที่ปิดจากข้างในไม่ได้ · จอต้องบอกเหตุผล ไม่ใช่แค่ทำให้กดไม่ได้
 */
describe('M13-S02 · แถวที่ล็อกไว้', () => {
  it('แถวของตัวเองกดถอนไม่ได้ และบอกว่าทำไม', async () => {
    await open()
    const row = rowOf('me@example.com')
    expect((within(row).getByRole('button', { name: 'ถอนสิทธิ์' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect((within(row).getByLabelText(/บทบาทของ me@example.com/) as HTMLSelectElement).disabled)
      .toBe(true)
    expect(within(row).getByText(SELF_LOCK)).toBeDefined()
  })

  it('ผู้ตั้งค่าคนสุดท้ายกดถอนไม่ได้ และบอกว่าทำไม', async () => {
    state.rows = [
      aUser({ id: 'me', email: 'me@example.com', role: 'content_editor' }),
      aUser({ id: 'last', email: 'last@example.com', role: 'configurator' }),
    ]
    await open()
    const row = rowOf('last@example.com')
    expect((within(row).getByRole('button', { name: 'ถอนสิทธิ์' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(within(row).getByText(LAST_CONFIGURATOR_LOCK)).toBeDefined()
  })

  it('มีผู้ตั้งค่าสองคน แถวของอีกคนกดได้ตามปกติ', async () => {
    await open()
    const row = rowOf('spare@example.com')
    expect((within(row).getByRole('button', { name: 'ถอนสิทธิ์' }) as HTMLButtonElement).disabled)
      .toBe(false)
    expect(within(row).queryByText(LAST_CONFIGURATOR_LOCK)).toBeNull()
  })

  it('ผู้ตั้งค่าคนสุดท้ายที่ถูกถอนไปแล้ว คืนสิทธิ์ได้ ไม่ติดล็อก', async () => {
    state.rows = [
      aUser({ id: 'me', email: 'me@example.com', role: 'content_editor' }),
      aUser({ id: 'last', email: 'last@example.com', role: 'configurator', is_active: false }),
    ]
    await open()
    expect((within(rowOf('last@example.com'))
      .getByRole('button', { name: 'คืนสิทธิ์' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

/**
 * บทบาทที่จัดการคนไม่ได้ ต้องไม่เห็นตัวควบคุมที่กดแล้วถูกปฏิเสธเสมอ
 *
 * ตัว action กันไว้อยู่แล้วและมีเทสต์ของมันเอง · ที่ตรงนี้วัดคือจอไม่ยื่นปุ่มที่
 * ล้มทุกครั้งให้คนกด — ปุ่มแบบนั้นสอนให้คนอ่านว่าระบบพัง ไม่ใช่ว่าตัวเองไม่มีสิทธิ์
 */
describe('M13-S02 · คนที่จัดการผู้ใช้ไม่ได้', () => {
  for (const role of ['content_editor', 'reporter']) {
    it(`${role} · ไม่เห็นฟอร์มเพิ่มผู้ใช้ และรู้ว่าตัวเองดูได้อย่างเดียว`, async () => {
      state.session = { userId: 'me', email: 'me@example.com', role }
      const { container } = await open()
      expect(container.querySelector('input[name="email"]')).toBeNull()
      expect(screen.getByText('ดูอย่างเดียว')).toBeDefined()
    })

    it(`${role} · ไม่มีปุ่มถอนสิทธิ์และไม่มีตัวเลือกบทบาทบนแถวไหนเลย`, async () => {
      state.session = { userId: 'me', email: 'me@example.com', role }
      await open()
      expect(screen.queryByRole('button', { name: 'ถอนสิทธิ์' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'เปลี่ยนบทบาท' })).toBeNull()
      expect(screen.queryByLabelText(/บทบาทของ/)).toBeNull()
    })

    it(`${role} · ยังเห็นบทบาทของทุกคนเป็นข้อความ`, async () => {
      state.session = { userId: 'me', email: 'me@example.com', role }
      await open()
      expect(within(rowOf('spare@example.com')).getByText(ROLE_LABEL.configurator)).toBeDefined()
    })
  }

  it('ยังไม่ได้เข้าระบบ ส่งไปหน้าเข้าระบบ', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })
})

/**
 * ช่อง test_line_uid · ต้นแบบไม่มี แต่ BR ของการส่งการ์ดทดสอบต้องการ
 */
describe('M13-S02 · LINE ของฉันสำหรับรับการ์ดทดสอบ', () => {
  it('ทุกบทบาทตั้งของตัวเองได้ · ช่องอยู่บนจอเสมอ', async () => {
    for (const role of ['configurator', 'content_editor', 'reporter']) {
      cleanup()
      state.session = { userId: 'me', email: 'me@example.com', role }
      const { container } = await open()
      expect(container.querySelector('input[name="test_line_uid"]'), role).not.toBeNull()
    }
  })

  it('ช่องเติมค่าที่ตั้งไว้แล้วของตัวเอง ไม่ใช่ของคนอื่น', async () => {
    const mine = `U${'0123456789abcdef'.repeat(2)}`
    state.rows = [
      aUser({ id: 'me', email: 'me@example.com', role: 'configurator', test_line_uid: mine }),
      aUser({ id: 'spare', email: 'spare@example.com', role: 'configurator', test_line_uid: 'Uffff' }),
    ]
    const { container } = await open()
    const input = container.querySelector('input[name="test_line_uid"]') as HTMLInputElement
    expect(input.value).toBe(mine)
    expect(container.querySelectorAll('input[name="test_line_uid"]')).toHaveLength(1)
  })

  it('มีคำอธิบายว่าไปหา LINE user id ของตัวเองได้จากไหน', async () => {
    const { container } = await open()
    expect(container.textContent).toContain(TEST_LINE_UID_HELP)
  })

  it('บอกว่าตั้งได้เฉพาะของตัวเอง', async () => {
    await open()
    expect(screen.getByText(/ตั้งได้เฉพาะของตัวเอง/)).toBeDefined()
  })
})
