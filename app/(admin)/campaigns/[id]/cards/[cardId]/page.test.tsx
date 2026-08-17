// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardEditorScreen } from '@/lib/db/cardEditor'

afterEach(cleanup)

type Role = 'configurator' | 'content_editor' | 'reporter'

const state: {
  role: Role | null
  screen: CardEditorScreen | null
  redirectedTo: string | null
  notFoundCalled: boolean
} = {
  role: 'configurator',
  screen: null,
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
vi.mock('@/lib/db/cardEditor', () => ({ loadCardEditor: async () => state.screen }))
vi.mock('./actions', () => ({ addBlock: async () => {} }))

// จอนี้ทดสอบการประกอบข้อมูล ไม่ใช่รายละเอียดข้างในของ BlockList/BlockForm ซึ่งมี
// เทสต์ของตัวเองอยู่แล้ว — mock ให้เป็นแค่กล่องที่โชว์ข้อมูลที่ page.tsx ส่งมาให้เห็น
vi.mock('@/components/cards/BlockList', () => ({
  BlockList: (props: {
    canEdit: boolean
    counts: { blocks: number; buttons: number }
    blocks: Array<{ id: string; blockType: string }>
    children: unknown
  }) => (
    <div data-mock-block-list data-can-edit={String(props.canEdit)}>
      <span>{props.counts.blocks}/10 บล็อก · ปุ่ม {props.counts.buttons}/3</span>
      {props.blocks.map((b) => <span key={b.id}>{b.blockType}</span>)}
      {props.children as never}
    </div>
  ),
}))
vi.mock('@/components/cards/BlockForm', () => ({
  BlockForm: (props: { block: { id: string }; canEdit: boolean }) => (
    <div data-mock-block-form={props.block.id} data-can-edit={String(props.canEdit)} />
  ),
}))

const CardEditPage = (await import('./page')).default

const emptyCard = (over: Partial<CardEditorScreen['card']> = {}): CardEditorScreen['card'] => ({
  id: 'card-1', code: 'welcome', renderAs: 'flex_bubble', renderName: 'การ์ดเดี่ยว',
  hasImage: false, previewText: 'สวัสดี', usedBy: [], isOrphan: true,
  ...over,
})

const screenFor = (over: Partial<CardEditorScreen> = {}): CardEditorScreen => ({
  card: emptyCard(),
  templateCode: 'line_buttons',
  hasSampleText: false,
  campaignName: 'แคมเปญคุกกี้',
  campaignStatus: 'draft',
  blocks: [
    { id: 'b1', blockType: 'title', sortOrder: 0, content: 'หัวข้อ', showWhen: null, options: null },
    { id: 'b2', blockType: 'button', sortOrder: 1, content: 'กด', showWhen: null, options: null },
  ],
  selectors: [],
  activities: [],
  rewardCodes: [],
  counterCodes: [],
  ...over,
})

const show = async (id = 'c1', cardId = 'card-1') => {
  const ui = await CardEditPage({ params: Promise.resolve({ id, cardId }) })
  return render(ui)
}

beforeEach(() => {
  state.role = 'configurator'
  state.screen = screenFor()
  state.redirectedTo = null
  state.notFoundCalled = false
})

describe('M3-S02-edit · เข้าถึงจอ', () => {
  it('ยังไม่เข้าระบบ ถูกส่งไปหน้าเข้าระบบ', async () => {
    state.role = null
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  it('ไม่พบการ์ดนี้ในแคมเปญนี้ 404', async () => {
    state.screen = null
    await expect(show()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('ป้ายรหัสจอ M3-S02 · Card อยู่เหนือหัวข้อ', async () => {
    const { container } = await show()
    expect(container.textContent).toContain('M3-S02 · Card')
  })
})

describe('M3-S02-edit · กล่องเตือนตามสถานะ', () => {
  it('แคมเปญที่ส่งขึ้นแล้วเห็นกล่องบอกว่าแก้แล้วมีผลกับใบถัดไป', async () => {
    state.screen = screenFor({ campaignStatus: 'published' })
    const { container } = await show()
    expect(container.textContent).toContain('แคมเปญนี้ส่งขึ้น LINE แล้ว')
  })

  it('แคมเปญร่างอยู่ ไม่เห็นกล่องนั้น', async () => {
    const { container } = await show()
    expect(container.textContent).not.toContain('แคมเปญนี้ส่งขึ้น LINE แล้ว')
  })

  it('บทบาทผู้ดูแลเนื้อหาเห็นกล่องอธิบายสิทธิ์ (Permission Matrix)', async () => {
    state.role = 'content_editor'
    const { container } = await show()
    expect(container.textContent).toContain('โหมดผู้ดูแลเนื้อหา')
    expect(container.textContent).toContain('Permission Matrix')
  })

  it('การ์ดที่ยังเป็นข้อความตัวอย่างจากเทมเพลต ขึ้นคำเตือน BR-37', async () => {
    state.screen = screenFor({ hasSampleText: true })
    const { container } = await show()
    expect(container.textContent).toContain('ข้อความตัวอย่าง')
    expect(container.textContent).toContain('BR-37')
  })

  it('การ์ดที่ไม่มีบล็อกเลย เตือนว่าส่งไปจะเป็นข้อความว่าง', async () => {
    state.screen = screenFor({ blocks: [] })
    const { container } = await show()
    expect(container.textContent).toContain('ยังไม่มีบล็อกสักอัน')
  })
})

describe('M3-S02-edit · ตัวนับกับการเพิ่มบล็อก', () => {
  it('ส่งตัวนับที่คำนวณจากบล็อกจริงลง BlockList', async () => {
    const { container } = await show()
    const bar = container.querySelector('[data-mock-block-list]')
    expect(bar?.textContent).toContain('2/10 บล็อก')
    expect(bar?.textContent).toContain('ปุ่ม 1/3')
  })

  it('ผู้ตั้งค่าเห็นฟอร์มเพิ่มบล็อก และตัวเลือกมีแปดชนิดเท่านั้น (ไม่มีหกชนิดที่วาดไม่ได้)', async () => {
    const { container } = await show()
    const select = container.querySelector('select[name="block_type"]') as HTMLSelectElement
    const values = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
    expect(values).toHaveLength(8)
    for (const undrawable of ['status_row', 'stamp_grid', 'video', 'stamp_card', 'progress', 'reward_button']) {
      expect(values).not.toContain(undrawable)
    }
  })

  it('ผู้ดูแลเนื้อหาไม่เห็นฟอร์มเพิ่มบล็อก (โครงสร้างเป็นของผู้ตั้งค่าเท่านั้น)', async () => {
    state.role = 'content_editor'
    const { container } = await show()
    expect(container.querySelector('select[name="block_type"]')).toBeNull()
  })

  it('BlockList ได้รับ canEdit=true เฉพาะผู้ตั้งค่า', async () => {
    state.role = 'content_editor'
    const { container } = await show()
    const mock = container.querySelector('[data-mock-block-list]')
    expect(mock?.getAttribute('data-can-edit')).toBe('false')
  })

  it('BlockForm แต่ละอันได้รับ canEdit ตาม Permission Matrix ต่อชนิดบล็อก — content_editor แก้ title ได้ แก้ button ไม่ได้', async () => {
    state.role = 'content_editor'
    const { container } = await show()
    const titleForm = container.querySelector('[data-mock-block-form="b1"]')
    const buttonForm = container.querySelector('[data-mock-block-form="b2"]')
    expect(titleForm?.getAttribute('data-can-edit')).toBe('true')
    expect(buttonForm?.getAttribute('data-can-edit')).toBe('false')
  })
})

describe('M3-S02-edit · ช่องขวา', () => {
  it('มีที่ว่างสำหรับตัวอย่างของ Task 14 พร้อมคำอธิบายที่ซื่อสัตย์', async () => {
    const { container } = await show()
    const box = container.querySelector('[data-preview-placeholder]')
    expect(box?.textContent).toContain('Task 14')
    expect(box?.textContent).toContain('groupBlocks')
  })

  it('การ์ดกำพร้าเห็นคำเตือนไม่มีใครใช้', async () => {
    state.screen = screenFor({ card: emptyCard({ isOrphan: true, usedBy: [] }) })
    const { container } = await show()
    expect(container.textContent).toContain('การ์ดกำพร้า')
  })

  it('การ์ดที่มีคนใช้ แสดงรายการที่ใช้ ไม่ใช่คำเตือนกำพร้า', async () => {
    state.screen = screenFor({
      card: emptyCard({ isOrphan: false, usedBy: [{ kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' }] }),
    })
    const { container } = await show()
    expect(container.textContent).toContain('คีย์เวิร์ด "เล่น"')
    expect(container.textContent).not.toContain('การ์ดกำพร้า')
  })
})
