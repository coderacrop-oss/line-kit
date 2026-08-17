// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_OPTIONS, NEAR_FULL_OPTIONS, RETURN_NAME, SELECTOR_RETURNS, SELECTOR_SOURCES,
  type SelectorRow, SOURCE_NAME,
} from '@/lib/db/selectors'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Role = 'configurator' | 'content_editor' | 'reporter'

const state: {
  role: Role | null
  campaign: { id: string; name: string } | null
  selectors: SelectorRow[]
  redirectedTo: string | null
  notFoundCalled: boolean
} = {
  role: 'configurator', campaign: { id: 'c1', name: 'แคมเปญคุกกี้' },
  selectors: [], redirectedTo: null, notFoundCalled: false,
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
vi.mock('@/lib/db/selectors', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/db/selectors')
  return { ...actual, listSelectors: async () => state.selectors.map(actual.summarizeSelector as never) }
})
// ตัว action จริงเป็น 'use server' และต่อฐานข้อมูล · จอต้องผูกกับมันได้โดยไม่ต้องมีของจริง
vi.mock('./actions', () => ({ saveSelector: vi.fn() }))

const SelectorsPage = (await import('./page')).default

const row = (patch: Partial<SelectorRow> = {}): SelectorRow => ({
  id: 'sel-1',
  name: 'คำทำนายประจำวัน',
  returns: 'text',
  source_type: 'campaign_day',
  source_key: '7',
  fallback_value: 'ขอให้โชคดี',
  option_count: 3,
  used_by: [],
  ...patch,
})

const show = async () => render(await SelectorsPage({ params: Promise.resolve({ id: 'c1' }) }))

const cards = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[data-selector-row]'))

beforeEach(() => {
  state.role = 'configurator'
  state.campaign = { id: 'c1', name: 'แคมเปญคุกกี้' }
  state.selectors = [row()]
  state.redirectedTo = null
  state.notFoundCalled = false
})

describe('M3-S03 · หัวจอและทางเข้าออก', () => {
  it('ป้ายรหัสจออยู่เหนือหัวข้อ ไม่ได้ถูกอ่านรวมเป็นหัวข้อเดียวกัน', async () => {
    await show()
    expect(screen.getByText('M3-S03 · Content selectors')).toBeDefined()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('ชุดเนื้อหา')
    expect(heading.textContent).not.toContain('M3-S03')
  })

  it('ยังไม่เข้าระบบ ถูกส่งไปหน้าเข้าระบบ', async () => {
    state.role = null
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  it('แคมเปญที่ไม่มีอยู่ ได้หน้าไม่พบ', async () => {
    state.campaign = null
    await expect(show()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFoundCalled).toBe(true)
  })

  it('บอกตั้งแต่ต้นว่าชุดเนื้อหาไม่ใช่สิ่งที่ผู้เล่นเห็น', async () => {
    await show()
    expect(screen.getByText(/ชุดเนื้อหาไม่ใช่สิ่งที่ผู้เล่นเห็น/)).toBeDefined()
  })
})

describe('M3-S03 · แถวหนึ่งของรายการ', () => {
  it('ชื่อชุดเป็นลิงก์เข้าไปหน้าตารางทางเลือกของชุดนั้น', async () => {
    await show()
    const link = screen.getByRole('link', { name: 'คำทำนายประจำวัน' })
    expect(link.getAttribute('href')).toBe('/campaigns/c1/selectors/sel-1')
  })

  it('บอกว่าคืนอะไรและเลือกจากค่าไหน ด้วยชื่อภาษาไทย ไม่ใช่ค่าดิบในคอลัมน์', async () => {
    state.selectors = [row({ returns: 'asset', source_type: 'attribute', source_key: 'pet_type' })]
    const { container } = await show()
    const card = cards(container)[0]!
    expect(within(card).getByText(`คืน${RETURN_NAME.asset}`)).toBeDefined()
    expect(within(card).getByText(`ตาม${SOURCE_NAME.attribute}`)).toBeDefined()
    expect(card.textContent).not.toContain('asset')
    expect(card.textContent).not.toContain('attribute')
  })

  it('ทุกค่าที่ตารางรับ มีชื่อบนจอ ไม่มีค่าไหนออกมาเป็นช่องว่าง', async () => {
    state.selectors = SELECTOR_RETURNS.flatMap((returns, index) =>
      SELECTOR_SOURCES.map((source, jndex) => row({
        id: `s${index}-${jndex}`,
        name: `ชุดที่ ${index}-${jndex}`,
        returns,
        source_type: source,
        source_key: '7',
      })))
    const { container } = await show()
    const list = cards(container)
    expect(list.length).toBe(state.selectors.length)
    for (const [index, card] of list.entries()) {
      const { returns, source_type } = state.selectors[index]!
      expect(within(card).getByText(`คืน${RETURN_NAME[returns]}`), returns).toBeDefined()
      expect(within(card).getByText(`ตาม${SOURCE_NAME[source_type]}`), source_type).toBeDefined()
    }
  })

  it('บอกจำนวนที่ใช้ไปพร้อมเพดาน ไม่ใช่บอกแค่จำนวน', async () => {
    state.selectors = [row({ option_count: 4 })]
    const { container } = await show()
    expect(within(cards(container)[0]!).getByText(`4/${MAX_OPTIONS} ทางเลือก`)).toBeDefined()
  })

  it('ชนิดที่เป็นรอบ บอกความยาวรอบ · ชนิดที่ไม่ใช่รอบ ไม่แต่งตัวเลขขึ้นมา', async () => {
    state.selectors = [row({ source_type: 'campaign_round', source_key: '4' })]
    const cyclic = await show()
    expect(within(cards(cyclic.container)[0]!).getByText('รอบละ 4 วัน')).toBeDefined()
    cleanup()

    state.selectors = [row({ source_type: 'attribute', source_key: '4' })]
    const plain = await show()
    expect(cards(plain.container)[0]!.textContent).not.toContain('รอบละ')
  })

  it('ใกล้เต็มแล้วเตือนตั้งแต่ยังไม่ชน · ยังไม่ใกล้ก็ไม่เตือน', async () => {
    state.selectors = [row({ option_count: NEAR_FULL_OPTIONS })]
    const near = await show()
    expect(within(cards(near.container)[0]!).getByText(/ใกล้เต็ม 10 ทางเลือกแล้ว/)).toBeDefined()
    cleanup()

    state.selectors = [row({ option_count: NEAR_FULL_OPTIONS - 1 })]
    const roomy = await show()
    expect(cards(roomy.container)[0]!.textContent).not.toContain('ใกล้เต็ม')
  })

  it('ยังไม่มีใครใช้ บอกไว้บนแถว · มีคนใช้ แสดงว่าใครใช้', async () => {
    state.selectors = [row({ used_by: [] })]
    const alone = await show()
    expect(within(cards(alone.container)[0]!)
      .getByText('ยังไม่มีการ์ดหรือกิจกรรมไหนใช้ชุดนี้')).toBeDefined()
    cleanup()

    state.selectors = [row({ used_by: ['การ์ด "win" · บล็อก title', 'การ์ด "lose" · บล็อก body'] })]
    const used = await show()
    const card = cards(used.container)[0]!
    expect(card.textContent).not.toContain('ยังไม่มีการ์ดหรือกิจกรรมไหนใช้ชุดนี้')
    expect(within(card).getByText('การ์ด "win" · บล็อก title')).toBeDefined()
    expect(within(card).getByText('การ์ด "lose" · บล็อก body')).toBeDefined()
  })

  it('วาดครบทุกชุดที่ได้มา เรียงตามลำดับที่ได้มา', async () => {
    state.selectors = [row({ id: 'a', name: 'ก' }), row({ id: 'b', name: 'ข' })]
    const { container } = await show()
    expect(cards(container).length).toBe(2)
    expect(screen.getByRole('link', { name: 'ก' }).getAttribute('href'))
      .toBe('/campaigns/c1/selectors/a')
  })

  it('ยังไม่มีชุดไหนเลย บอกว่าชุดเนื้อหามีไว้ทำอะไร ไม่ใช่แผงขาวเปล่า', async () => {
    state.selectors = []
    const { container } = await show()
    expect(cards(container).length).toBe(0)
    expect(screen.getByText(
      'ชุดเนื้อหาใช้ตอนที่อยากให้การ์ดใบเดียวแสดงต่างกันตามสถานะของผู้เล่น',
    )).toBeDefined()
  })
})

/**
 * ฟอร์มสร้างอยู่ในจอรายการ เหมือนค่าสะสมกับรางวัล
 *
 * The action refuses anybody but a configurator on its own; hiding the form is
 * for the two roles who would otherwise be offered a door that answers no.
 */
describe('M3-S03 · สร้างชุดใหม่', () => {
  it('ผู้ตั้งค่าเห็นฟอร์มสร้าง พร้อมช่องที่ตารางบังคับครบ', async () => {
    await show()
    expect(screen.getByText('＋ สร้างชุดเนื้อหา')).toBeDefined()
    expect(screen.getByLabelText('ชื่อชุด (บังคับ)')).toBeDefined()
    expect(screen.getByLabelText('คืนอะไร (บังคับ)')).toBeDefined()
    expect(screen.getByLabelText('เลือกจากค่าไหน (บังคับ)')).toBeDefined()
  })

  /**
   * ของสำรองบังคับกรอกตั้งแต่ในฟอร์ม (BR-27)
   *
   * fallback_value is NOT NULL and the action refuses an empty one. Marking the
   * box required as well is not a duplicate rule — it is the difference between
   * being told before typing the rest of the form and being told after.
   */
  it('ช่องของสำรองบังคับกรอกตั้งแต่ในฟอร์ม ไม่ใช่รอไปโดนปฏิเสธทีหลัง', async () => {
    await show()
    const fallback = screen.getByLabelText('ของสำรอง (บังคับ · BR-27)') as HTMLTextAreaElement
    expect(fallback.required).toBe(true)
  })

  it('ชื่อชุดก็บังคับ และยาวได้เท่าที่คอลัมน์รับ', async () => {
    await show()
    const name = screen.getByLabelText('ชื่อชุด (บังคับ)') as HTMLInputElement
    expect(name.required).toBe(true)
    expect(name.maxLength).toBe(100)
  })

  it('ตัวเลือกในช่องคืนอะไรและเลือกจากค่าไหน ครบทุกค่าที่ตารางรับ', async () => {
    await show()
    const returns = screen.getByLabelText('คืนอะไร (บังคับ)') as HTMLSelectElement
    expect(Array.from(returns.options).map((option) => option.value)).toEqual([...SELECTOR_RETURNS])
    const source = screen.getByLabelText('เลือกจากค่าไหน (บังคับ)') as HTMLSelectElement
    expect(Array.from(source.options).map((option) => option.value)).toEqual([...SELECTOR_SOURCES])
  })

  /**
   * source_key มีคอลัมน์เดียวที่หมายถึงสองอย่าง จอสร้างจึงมีสองช่อง
   *
   * There is no client state here to swap one box for the other when the type
   * changes, so both are drawn and the action reads whichever one the chosen
   * type means. Drawing one box for two meanings is how "pet_type" ends up
   * stored as a cycle length.
   */
  it('มีทั้งช่องชื่อค่าที่จะอ่านและช่องความยาวรอบ เพราะคอลัมน์เดียวหมายถึงสองอย่าง', async () => {
    await show()
    expect(screen.getByLabelText('ชื่อค่าที่จะอ่าน')).toBeDefined()
    const cycle = screen.getByLabelText('ความยาวรอบ (วัน)') as HTMLInputElement
    expect(cycle.name).toBe('cycle_days')
    expect((screen.getByLabelText('ชื่อค่าที่จะอ่าน') as HTMLInputElement).name).toBe('source_key')
  })

  it('ผู้ดูแลเนื้อหาและผู้ดูรายงานไม่เห็นฟอร์มสร้าง และเห็นป้ายดูอย่างเดียว', async () => {
    for (const role of ['content_editor', 'reporter'] as const) {
      state.role = role
      await show()
      expect(screen.queryByText('＋ สร้างชุดเนื้อหา'), role).toBeNull()
      expect(screen.queryByLabelText('ชื่อชุด (บังคับ)'), role).toBeNull()
      expect(screen.getByText('ดูอย่างเดียว'), role).toBeDefined()
      cleanup()
    }
  })
})
