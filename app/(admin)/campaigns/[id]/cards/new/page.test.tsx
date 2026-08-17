// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardTemplate } from '@/lib/cards/create'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Role = 'configurator' | 'content_editor' | 'reporter'

const state: {
  role: Role | null
  campaign: { id: string; name: string; status: string } | null
  templates: CardTemplate[]
  redirectedTo: string | null
  notFoundCalled: boolean
} = {
  role: 'configurator',
  campaign: { id: 'c1', name: 'แคมเปญคุกกี้', status: 'draft' },
  templates: [],
  redirectedTo: null,
  notFoundCalled: false,
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { state.redirectedTo = to; throw new Error('NEXT_REDIRECT') },
  notFound: () => { state.notFoundCalled = true; throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('@/lib/auth/session', () => ({
  getSession: async () =>
    state.role === null ? null : { userId: 'u1', email: 'a@b.c', role: state.role },
}))
vi.mock('@/lib/db/client', () => ({ db: () => null }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/cards/create', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/cards/create')
  return { ...actual, listCardTemplates: async () => state.templates }
})
vi.mock('./actions', () => ({ createCard: async () => {} }))

const NewCardPage = (await import('./page')).default

const template = (patch: Partial<CardTemplate> = {}): CardTemplate => ({
  code: 'line_buttons',
  name: 'ภาพ ข้อความ แล้วปุ่ม',
  description: 'รูปแบบที่พบบ่อยที่สุดใน LINE',
  blocks: [
    { blockType: 'image', content: '', options: { placement: 'full_top' } },
    { blockType: 'title', content: 'หัวข้อตัวอย่าง' },
    { blockType: 'button', content: 'กดเลย' },
  ],
  group: 'from_line',
  isBuiltin: true,
  sortOrder: 10,
  ...patch,
})

const blankTemplate = () => template({
  code: 'blank', name: 'เริ่มจากศูนย์', group: 'blank', sortOrder: 0,
  blocks: [{ blockType: 'title', content: 'หัวข้อการ์ด' }],
})

const stampTemplate = () => template({
  code: 'beyond_stamp', name: 'บัตรแสตมป์', group: 'beyond_line', sortOrder: 20,
  blocks: [
    { blockType: 'title', content: 'บัตรสะสมแสตมป์' },
    { blockType: 'progress_bar', options: { counter: 'stamp', target: 10 } },
  ],
})

const show = async (query: Record<string, string> = {}) => {
  const ui = await NewCardPage({
    params: Promise.resolve({ id: 'c1' }),
    searchParams: Promise.resolve(query),
  })
  return render(ui)
}

const lockedTypes = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[data-send-type-locked]'))
    .map((node) => node.getAttribute('data-send-type-locked') ?? '')

const templateLinks = (container: HTMLElement): HTMLAnchorElement[] =>
  Array.from(container.querySelectorAll('a[data-template]'))

beforeEach(() => {
  state.role = 'configurator'
  state.campaign = { id: 'c1', name: 'แคมเปญคุกกี้', status: 'draft' }
  state.templates = [blankTemplate(), template(), stampTemplate()]
  state.redirectedTo = null
  state.notFoundCalled = false
})

describe('M3-S02 · หัวจอ', () => {
  it('ป้ายรหัสจออยู่เหนือหัวข้อ ไม่ได้ถูกอ่านรวมเป็นหัวข้อเดียวกัน', async () => {
    await show()
    expect(screen.getByText('M3-S02 · Card')).toBeDefined()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('สร้างการ์ด')
    expect(heading.textContent).not.toContain('M3-S02')
  })

  /**
   * เครื่องหมายคูณคือทั้งหมดของเรื่องนี้
   *
   * ชนิดการส่งกับเทมเพลตเป็นแกนอิสระสองแกน · ถ้ายุบเป็นรายการเดียวจะกลายเป็น
   * ห้าสิบแถวที่ต้องดูแลให้ตรงกัน แทนที่จะเป็นสิบห้าชิ้นที่คูณกันตอนคนเลือก
   */
  it('หัวจอมีเครื่องหมายคูณตั้งแต่ยังไม่ได้เลือกอะไรเลย', async () => {
    const { container } = await show()
    expect(container.textContent).toContain('×')
    expect(container.textContent).toContain('ยังไม่เลือกชนิด')
    expect(container.textContent).toContain('ยังไม่เลือกเทมเพลต')
  })

  it('เลือกชนิดแล้วหัวจอบอกชนิด แต่ยังบอกว่าเทมเพลตยังไม่ได้เลือก', async () => {
    const { container } = await show({ send: 'flex_bubble' })
    expect(container.textContent).toContain('การ์ดเดี่ยว')
    expect(container.textContent).toContain('ยังไม่เลือกเทมเพลต')
  })

  it('เลือกครบสองแกนแล้วหัวจอเขียนคูณให้เห็นทั้งคู่', async () => {
    const { container } = await show({ send: 'text', tpl: 'beyond_stamp' })
    expect(container.textContent).toContain('ข้อความล้วน')
    expect(container.textContent).toContain('บัตรแสตมป์')
    expect(container.textContent).not.toContain('ยังไม่เลือกชนิด')
    expect(container.textContent).not.toContain('ยังไม่เลือกเทมเพลต')
  })

  it('แคมเปญที่ส่งขึ้นแล้วเห็นกล่องบอกว่าแก้แล้วมีผลกับใบถัดไป', async () => {
    state.campaign = { id: 'c1', name: 'แคมเปญคุกกี้', status: 'published' }
    const { container } = await show()
    expect(container.textContent).toContain('แคมเปญนี้ส่งขึ้น LINE แล้ว')
  })

  it('แคมเปญที่ยังร่างอยู่ไม่มีกล่องนั้น', async () => {
    const { container } = await show()
    expect(container.textContent).not.toContain('แคมเปญนี้ส่งขึ้น LINE แล้ว')
  })
})

describe('สิทธิ์และทางเข้า', () => {
  it('ยังไม่เข้าระบบ ถูกส่งไปหน้าเข้าระบบ', async () => {
    state.role = null
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  it('ผู้ดูแลเนื้อหาถูกส่งกลับไปจอรายการการ์ด ไม่ใช่เห็นฟอร์มที่กดแล้วโดนปฏิเสธ', async () => {
    state.role = 'content_editor'
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/campaigns/c1/cards')
  })

  it('ผู้ดูรายงานก็ถูกส่งกลับเหมือนกัน', async () => {
    state.role = 'reporter'
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/campaigns/c1/cards')
  })

  it('แคมเปญที่ไม่มีอยู่ได้ 404 ไม่ใช่จอเปล่า', async () => {
    state.campaign = null
    await expect(show()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFoundCalled).toBe(true)
  })
})

/**
 * ขั้นที่ 1 · ห้าชนิด แต่สไลซ์นี้เปิดสาม (BR-89)
 */
describe('ขั้นที่ 1 · ชนิดการส่ง', () => {
  it('แสดงครบทั้งห้าชนิด ไม่ได้ซ่อนตัวที่ยังทำไม่ได้', async () => {
    const { container } = await show()
    for (const name of ['การ์ดเดี่ยว', 'การ์ดปัดได้', 'ข้อความล้วน', 'ริชเมสเสจ', 'ริชวิดีโอ']) {
      expect(container.textContent, name).toContain(name)
    }
  })

  it('สามตัวที่เปิดเป็นลิงก์ที่พาไปขั้นถัดไป', async () => {
    const { container } = await show()
    const hrefs = Array.from(container.querySelectorAll('a'))
      .map((a) => a.getAttribute('href') ?? '')
    expect(hrefs).toContain('?send=flex_bubble')
    expect(hrefs).toContain('?send=flex_carousel')
    expect(hrefs).toContain('?send=text')
  })

  it('ริชเมสเสจกับริชวิดีโอกดไม่ได้ และไม่ใช่ลิงก์', async () => {
    const { container } = await show()
    expect(lockedTypes(container).sort()).toEqual(['imagemap', 'imagemap_video'])
    const hrefs = Array.from(container.querySelectorAll('a'))
      .map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('imagemap'))).toBe(false)
  })

  it('ตัวที่กดไม่ได้บอกเหตุผลไว้ข้างตัวมันเอง ไม่ใช่ปล่อยให้เดา', async () => {
    const { container } = await show()
    for (const node of container.querySelectorAll('[data-send-type-locked]')) {
      expect(node.textContent).toContain('รอตัววาดภาพ · OI-27')
    }
  })

  it('บอกเครื่องช่วยอ่านด้วยว่ากดไม่ได้ ไม่ใช่แค่จางลง', async () => {
    const { container } = await show()
    for (const node of container.querySelectorAll('[data-send-type-locked]')) {
      expect(node.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('ชนิดที่ยิงมาจาก URL แต่ยังไม่เปิด ถือว่ายังไม่ได้เลือก', async () => {
    const { container } = await show({ send: 'imagemap', tpl: 'line_buttons' })
    expect(container.textContent).toContain('ยังไม่เลือกชนิด')
    expect(container.querySelector('form')).toBeNull()
  })
})

/**
 * ขั้นที่ 2 · เทมเพลตสองกลุ่ม และ "เริ่มจากศูนย์" อยู่ในชุดเดียวกัน (BR-63)
 */
describe('ขั้นที่ 2 · เทมเพลต', () => {
  it('ยังไม่เลือกชนิด ยังไม่แสดงเทมเพลต และบอกว่าทำไม', async () => {
    const { container } = await show()
    expect(templateLinks(container)).toHaveLength(0)
    expect(container.textContent).toContain('เลือกชนิดการส่งก่อน')
  })

  it('เลือกชนิดแล้วเทมเพลตทุกตัวโผล่ พร้อมหัวข้อของกลุ่ม', async () => {
    const { container } = await show({ send: 'flex_bubble' })
    expect(templateLinks(container).map((a) => a.getAttribute('data-template')))
      .toEqual(['blank', 'line_buttons', 'beyond_stamp'])
    expect(container.textContent).toContain('ลอกจาก LINE')
    expect(container.textContent).toContain('LINE ไม่มี')
  })

  it('"เริ่มจากศูนย์" อยู่ในชุดเดียวกัน ไม่ได้ซ่อนหลังลิงก์ดูเพิ่มเติม (BR-63)', async () => {
    const { container } = await show({ send: 'flex_bubble' })
    const blank = templateLinks(container).find((a) => a.getAttribute('data-template') === 'blank')
    expect(blank).toBeDefined()
    expect(container.textContent).not.toContain('ดูตัวเลือกเพิ่มเติม')
  })

  it('ลิงก์ของเทมเพลตพาชนิดที่เลือกไว้ไปด้วย ไม่ได้ทิ้งแกนแรก', async () => {
    const { container } = await show({ send: 'text' })
    for (const link of templateLinks(container)) {
      expect(link.getAttribute('href')).toContain('send=text')
    }
  })

  it('ทุกแผ่นเทมเพลตเขียนคู่ของมันเองไว้ด้วยเครื่องหมายคูณ', async () => {
    const { container } = await show({ send: 'flex_carousel' })
    for (const link of templateLinks(container)) {
      expect(link.textContent).toContain('การ์ดปัดได้ ×')
    }
  })

  it('กลุ่มที่ไม่มีเทมเพลตสักตัวไม่วาดหัวข้อลอยไว้', async () => {
    state.templates = [template()]
    const { container } = await show({ send: 'flex_bubble' })
    expect(container.textContent).toContain('ลอกจาก LINE')
    expect(container.textContent).not.toContain('LINE ไม่มี')
  })

  it('ตารางเทมเพลตว่าง จอบอกตรงๆ แทนที่จะวาดกล่องเปล่า', async () => {
    state.templates = []
    const { container } = await show({ send: 'flex_bubble' })
    expect(container.textContent).toContain('ยังไม่มีเทมเพลตในระบบ')
  })

  it('เทมเพลตที่ไม่เข้ากลุ่มไหนยังโผล่บนจอ ไม่ได้หายไปเงียบๆ', async () => {
    state.templates = [template({ code: 'seasonal', name: 'ของฤดูกาล', group: 'other' })]
    const { container } = await show({ send: 'flex_bubble' })
    expect(container.textContent).toContain('ของฤดูกาล')
    expect(container.textContent).toContain('ยังไม่ได้จัดกลุ่ม')
  })
})

describe('ฟอร์มสร้าง', () => {
  it('ยังไม่ครบสองแกน ยังไม่มีฟอร์ม', async () => {
    const { container } = await show({ send: 'flex_bubble' })
    expect(container.querySelector('form')).toBeNull()
  })

  it('ครบสองแกนแล้วฟอร์มโผล่ พร้อมพาสองแกนไปกับมัน', async () => {
    const { container } = await show({ send: 'text', tpl: 'line_buttons' })
    const hidden = (name: string) =>
      container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value
    expect(hidden('campaign_id')).toBe('c1')
    expect(hidden('send_type')).toBe('text')
    expect(hidden('template_code')).toBe('line_buttons')
  })

  it('ช่องรหัสการ์ดบังคับกรอกและจำกัดรูป', async () => {
    const { container } = await show({ send: 'flex_bubble', tpl: 'line_buttons' })
    const code = container.querySelector<HTMLInputElement>('input[name="code"]')
    expect(code?.required).toBe(true)
    expect(code?.getAttribute('pattern')).toBe('[a-z0-9_]{1,40}')
  })

  it('บอกล่วงหน้าว่าจะได้กี่บล็อกและบล็อกอะไรบ้าง', async () => {
    const { container } = await show({ send: 'flex_bubble', tpl: 'line_buttons' })
    expect(container.textContent).toContain('จะได้ 3 บล็อก')
    expect(container.textContent).toContain('image · title · button')
  })

  it('ข้อความล้วนบอกว่าตัดอะไรออกไปกี่อัน ไม่ใช่ตัดเงียบๆ', async () => {
    const { container } = await show({ send: 'text', tpl: 'line_buttons' })
    expect(container.textContent).toContain('จะได้ 2 บล็อก')
    expect(container.textContent).toContain('ตัดออก 1 บล็อก')
  })

  /**
   * BR-37 · จอบอกไว้ก่อนกดสร้าง ว่าการ์ดใบนี้จะบล็อกการส่งขึ้น
   */
  it('เทมเพลตที่มีข้อความ ขึ้นคำเตือนข้อความตัวอย่างไว้เหนือปุ่ม', async () => {
    const { container } = await show({ send: 'flex_bubble', tpl: 'line_buttons' })
    expect(container.textContent).toContain('ยังเป็นข้อความตัวอย่างจากเทมเพลต')
    expect(container.textContent).toContain('BR-37')
  })

  it('เทมเพลตที่ไม่มีข้อความเลย ไม่ขึ้นคำเตือนที่ไม่เป็นความจริง', async () => {
    state.templates = [template({
      code: 'line_silent', name: 'ภาพล้วน', blocks: [{ blockType: 'image', content: '' }],
    })]
    const { container } = await show({ send: 'flex_bubble', tpl: 'line_silent' })
    expect(container.textContent).not.toContain('BR-37')
  })

  it('บอกไว้บนจอว่ากดแล้วไปไหน เพราะบล็อกเอดิเตอร์ยังไม่มี', async () => {
    const { container } = await show({ send: 'flex_bubble', tpl: 'line_buttons' })
    expect(container.textContent).toContain('กลับไปที่จอรายการการ์ด')
  })

  it('เทมเพลตที่ยิงมาจาก URL แต่ไม่มีอยู่ ไม่ทำให้ฟอร์มโผล่', async () => {
    const { container } = await show({ send: 'flex_bubble', tpl: 'ghost' })
    expect(container.querySelector('form')).toBeNull()
    expect(container.textContent).toContain('ยังไม่เลือกเทมเพลต')
  })
})
