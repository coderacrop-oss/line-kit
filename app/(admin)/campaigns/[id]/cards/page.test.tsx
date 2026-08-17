// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_FILTERS, CARD_RENDER_NAME, type CardRow, summarizeCard } from '@/lib/db/cards'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Role = 'configurator' | 'content_editor' | 'reporter'

const state: {
  role: Role | null
  campaign: { id: string; name: string } | null
  cards: CardRow[]
  redirectedTo: string | null
  notFoundCalled: boolean
} = {
  role: 'configurator', campaign: { id: 'c1', name: 'แคมเปญคุกกี้' },
  cards: [], redirectedTo: null, notFoundCalled: false,
}

// redirect() กับ notFound() ของจริงโยนเสมอ · ตัวปลอมก็ต้องโยน ไม่งั้นโค้ดหลังบรรทัดนั้น
// จะเดินต่อในเทสต์ทั้งที่ของจริงไม่เดิน แล้วเทสต์จะรับรองพฤติกรรมที่ไม่มีอยู่จริง
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
vi.mock('@/lib/db/cards', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/db/cards')
  return { ...actual, listCards: async () => state.cards.map(actual.summarizeCard as never) }
})

const CardsPage = (await import('./page')).default

const row = (patch: Partial<CardRow> = {}): CardRow => ({
  id: 'card-1',
  code: 'win',
  render_as: 'flex_bubble',
  has_image: false,
  title_text: 'ยินดีด้วย {{attr.name}}',
  title_selector: null,
  used_by: [{ kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' }],
  ...patch,
})

const show = async (query: Record<string, string> = {}) => {
  const ui = await CardsPage({
    params: Promise.resolve({ id: 'c1' }),
    searchParams: Promise.resolve(query),
  })
  return render(ui)
}

const tiles = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[data-card-tile]'))

const codesOnScreen = (container: HTMLElement): string[] =>
  tiles(container).map((tile) => tile.getAttribute('data-card-tile') ?? '')

beforeEach(() => {
  state.role = 'configurator'
  state.campaign = { id: 'c1', name: 'แคมเปญคุกกี้' }
  state.cards = [row()]
  state.redirectedTo = null
  state.notFoundCalled = false
})

describe('M3-S01 · หัวจอและทางเข้าออก', () => {
  it('ป้ายรหัสจออยู่เหนือหัวข้อ ไม่ได้ถูกอ่านรวมเป็นหัวข้อเดียวกัน', async () => {
    await show()
    expect(screen.getByText('M3-S01 · Cards')).toBeDefined()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('การ์ด')
    expect(heading.textContent).not.toContain('M3-S01')
  })

  it('ยังไม่เข้าระบบ ถูกส่งไปหน้าเข้าระบบ ไม่ใช่เห็นจอเปล่า', async () => {
    state.role = null
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  it('แคมเปญที่ไม่มีอยู่ ได้หน้าไม่พบ ไม่ใช่จอที่ว่างเปล่า', async () => {
    state.campaign = null
    await expect(show()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFoundCalled).toBe(true)
  })

  it('มีทางกลับไปหน้าแคมเปญ พร้อมชื่อแคมเปญที่กำลังเปิดอยู่', async () => {
    await show()
    const back = screen.getByRole('link', { name: '← แคมเปญคุกกี้' })
    expect(back.getAttribute('href')).toBe('/campaigns/c1')
  })

  it('บทบาทที่แก้ไม่ได้ เห็นป้ายบอกว่าดูอย่างเดียว', async () => {
    state.role = 'reporter'
    await show()
    expect(screen.getByText('ดูอย่างเดียว')).toBeDefined()
  })

  it('ผู้ตั้งค่าไม่เห็นป้ายดูอย่างเดียว', async () => {
    await show()
    expect(screen.queryByText('ดูอย่างเดียว')).toBeNull()
  })
})

describe('M3-S01 · แผ่นการ์ดหนึ่งใบ', () => {
  it('วาดครบทุกใบที่ได้มา เรียงตามลำดับที่ได้มา', async () => {
    state.cards = [row({ id: 'a', code: 'aaa' }), row({ id: 'b', code: 'bbb' })]
    const { container } = await show()
    expect(codesOnScreen(container)).toEqual(['aaa', 'bbb'])
  })

  /**
   * ป้ายชนิดการส่งอ่านชื่อจากตารางชื่อ ไม่ใช่โยนค่าดิบในคอลัมน์ออกจอ
   *
   * `flex_carousel` on a screen is a column name leaking into a room full of
   * people who never see the table.
   */
  it('ป้ายชนิดการส่งเป็นชื่อภาษาไทย ไม่ใช่ค่าดิบในคอลัมน์', async () => {
    state.cards = [row({ render_as: 'flex_carousel' })]
    const { container } = await show()
    const tile = tiles(container)[0]!
    expect(within(tile).getByText(CARD_RENDER_NAME.flex_carousel)).toBeDefined()
    expect(tile.textContent).not.toContain('flex_carousel')
  })

  it('ทุกชนิดการส่งมีป้ายของตัวเอง ไม่มีชนิดไหนออกจอมาเป็นค่าว่าง', async () => {
    state.cards = (['flex_bubble', 'flex_carousel', 'imagemap', 'imagemap_video', 'text'] as const)
      .map((type, index) => row({ id: `c${index}`, code: `c${index}`, render_as: type }))
    const { container } = await show()
    for (const [index, tile] of tiles(container).entries()) {
      const type = (['flex_bubble', 'flex_carousel', 'imagemap', 'imagemap_video', 'text'] as const)[index]!
      expect(within(tile).getByText(CARD_RENDER_NAME[type]), type).toBeDefined()
    }
  })

  it('ข้อความบนการ์ดแสดงอย่างที่เขียนไว้ ตัวแปรยังไม่ถูกแทนค่า', async () => {
    const { container } = await show()
    expect(tiles(container)[0]!.textContent).toContain('ยินดีด้วย {{attr.name}}')
  })

  it('บล็อกที่ดึงจากชุดเนื้อหา บอกชื่อชุด ไม่ใช่ปล่อยว่าง', async () => {
    state.cards = [row({ title_text: null, title_selector: 'คำทำนายประจำวัน' })]
    const { container } = await show()
    expect(tiles(container)[0]!.textContent).toContain('เลือกจากชุดเนื้อหา "คำทำนายประจำวัน"')
  })

  it('การ์ดที่ยังไม่มีบล็อกข้อความเลย บอกว่ายังว่าง ไม่ใช่เว้นที่ว่างไว้เฉยๆ', async () => {
    state.cards = [row({ title_text: null, title_selector: null })]
    const { container } = await show()
    expect(within(tiles(container)[0]!).getByText('ยังไม่มีข้อความบนการ์ดใบนี้')).toBeDefined()
  })

  it('แถบภาพหัวการ์ดขึ้นตามบล็อกภาพ ไม่ใช่ตามชนิดการส่ง', async () => {
    state.cards = [row({ id: 'a', code: 'a', has_image: true, render_as: 'text' })]
    const withImage = await show()
    expect(within(tiles(withImage.container)[0]!).getByText('header image')).toBeDefined()
    cleanup()

    state.cards = [row({ id: 'b', code: 'b', has_image: false, render_as: 'flex_bubble' })]
    const without = await show()
    expect(within(tiles(without.container)[0]!).queryByText('header image')).toBeNull()
  })

  it('รายชื่อทุกที่ที่ชี้มาหาการ์ดใบนี้อยู่บนแผ่น ไม่ได้ถูกยุบเหลือจำนวน', async () => {
    state.cards = [row({
      used_by: [
        { kind: 'activity', label: 'สุ่มรางวัล · การ์ดสำรอง' },
        { kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' },
      ],
    })]
    const { container } = await show()
    const tile = tiles(container)[0]!
    expect(within(tile).getByText('สุ่มรางวัล · การ์ดสำรอง')).toBeDefined()
    expect(within(tile).getByText('คีย์เวิร์ด "เล่น"')).toBeDefined()
  })
})

/**
 * ป้าย "ไม่มีใครใช้" กับตัวกรองอ่านการอ้างอิงชุดเดียวกัน
 *
 * Two readings of one array, so a card cannot be unused to the filter and used
 * to the badge. A boolean column beside them is exactly the arrangement that
 * lets the two disagree, and the one that disagrees quietly is the one somebody
 * deletes a live card over.
 */
describe('M3-S01 · การ์ดที่ไม่มีใครชี้มา', () => {
  it('ไม่มีใครชี้มา ติดป้ายและใช้ขอบเส้นประ แยกออกจากใบที่มีคนใช้', async () => {
    state.cards = [row({ used_by: [] })]
    const { container } = await show()
    const tile = tiles(container)[0]!
    expect(within(tile).getByText('ไม่มีใครใช้')).toBeDefined()
    expect(tile.style.borderStyle).toBe('dashed')
  })

  it('มีคนชี้มา ไม่ติดป้าย และใช้ขอบเส้นทึบ', async () => {
    const { container } = await show()
    const tile = tiles(container)[0]!
    expect(within(tile).queryByText('ไม่มีใครใช้')).toBeNull()
    expect(tile.style.borderStyle).toBe('solid')
  })

  it('ป้ายบนแผ่นตรงกับตัวกรองเสมอ · ทุกใบที่ตัวกรองคืนมาคือใบที่ติดป้าย', async () => {
    state.cards = [
      row({ id: 'a', code: 'a', used_by: [] }),
      row({ id: 'b', code: 'b', used_by: [{ kind: 'keyword', label: 'คีย์เวิร์ด "x"' }] }),
      row({ id: 'c', code: 'c', used_by: [] }),
    ]
    const { container } = await show({ f: 'ยังไม่ถูกใช้' })
    expect(codesOnScreen(container)).toEqual(['a', 'c'])
    for (const tile of tiles(container)) {
      expect(within(tile).getByText('ไม่มีใครใช้'), tile.textContent ?? '').toBeDefined()
    }
  })
})

describe('M3-S01 · ตัวกรอง', () => {
  const many = () => [
    row({ id: 'a', code: 'a', used_by: [{ kind: 'activity', label: 'สุ่ม · การ์ดสำรอง' }] }),
    row({ id: 'b', code: 'b', used_by: [{ kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' }] }),
    row({ id: 'c', code: 'c', used_by: [{ kind: 'channel', label: 'บัญชี OA · การ์ดตั้งต้น' }] }),
    row({ id: 'd', code: 'd', used_by: [{ kind: 'carousel', label: 'การ์ด p · ใบในชุดปัด' }] }),
    row({ id: 'e', code: 'e', used_by: [{ kind: 'stamp', label: 'บัตรแสตมป์ของค่าสะสม "x"' }] }),
    row({ id: 'f', code: 'f', used_by: [] }),
  ]

  it('มีปุ่มกรองครบทุกชื่อ และแต่ละปุ่มพาไปที่ตัวกรองของตัวเอง', async () => {
    const { container } = await show()
    const bar = container.querySelector('[data-card-filters]') as HTMLElement
    const links = Array.from(bar.querySelectorAll('a'))
    expect(links.map((link) => link.textContent)).toEqual([...CARD_FILTERS])
    expect(links.map((link) => link.getAttribute('href')))
      .toEqual(CARD_FILTERS.map((name) => `?f=${encodeURIComponent(name)}`))
  })

  it('ตัวกรองที่เปิดอยู่ต่างจากตัวที่ยังไม่ได้เลือก ไม่ใช่หน้าตาเหมือนกันหมด', async () => {
    const { container } = await show({ f: 'คีย์เวิร์ด' })
    const bar = container.querySelector('[data-card-filters]') as HTMLElement
    const on = Array.from(bar.querySelectorAll('a'))
      .filter((link) => link.style.background === 'var(--ink)')
    expect(on.map((link) => link.textContent)).toEqual(['คีย์เวิร์ด'])
  })

  it('กรองตามชนิดของสิ่งที่ชี้มา ได้เฉพาะใบที่ชนิดนั้นชี้', async () => {
    state.cards = many()
    for (const [filter, code] of [
      ['กิจกรรม', 'a'], ['คีย์เวิร์ด', 'b'], ['บัญชี LINE', 'c'],
      ['ชุดปัด', 'd'], ['บัตรแสตมป์', 'e'], ['ยังไม่ถูกใช้', 'f'],
    ] as const) {
      const { container } = await show({ f: filter })
      expect(codesOnScreen(container), filter).toEqual([code])
      cleanup()
    }
  })

  it('ไม่ได้เลือกอะไร เห็นทุกใบ', async () => {
    state.cards = many()
    const { container } = await show()
    expect(codesOnScreen(container)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('ค่าที่ปลอมมาจาก URL ตกกลับไปเป็นทั้งหมด ไม่ใช่จอว่าง', async () => {
    state.cards = many()
    const { container } = await show({ f: 'ยังไม่ถูกใช้แต่พิมพ์เกิน' })
    expect(codesOnScreen(container).length).toBe(6)
    const bar = container.querySelector('[data-card-filters]') as HTMLElement
    const on = Array.from(bar.querySelectorAll('a'))
      .filter((link) => link.style.background === 'var(--ink)')
    expect(on.map((link) => link.textContent)).toEqual(['ทั้งหมด'])
  })

  it('กรองแล้วไม่เหลืออะไร บอกว่าตัวกรองไม่เจอ ไม่ใช่บอกว่าแคมเปญยังไม่มีการ์ด', async () => {
    state.cards = [row({ used_by: [{ kind: 'keyword', label: 'คีย์เวิร์ด "เล่น"' }] })]
    const { container } = await show({ f: 'ยังไม่ถูกใช้' })
    expect(tiles(container).length).toBe(0)
    expect(screen.getByText('ไม่มีการ์ดที่ตรงกับตัวกรองนี้')).toBeDefined()
    expect(screen.queryByText('ยังไม่มีการ์ดในแคมเปญนี้')).toBeNull()
  })

  it('แคมเปญที่ยังไม่มีการ์ดเลย ไม่มีแถบตัวกรองให้กดเล่น', async () => {
    state.cards = []
    const { container } = await show()
    expect(screen.getByText('ยังไม่มีการ์ดในแคมเปญนี้')).toBeDefined()
    expect(container.querySelector('[data-card-filters]')).toBeNull()
  })
})

describe('M3-S01 · สิ่งที่จอสัญญาไว้กับสิ่งที่ lib ทำจริง', () => {
  /**
   * จอไม่ได้เก็บ "ใครใช้อยู่" ไว้เอง · มันอ่านจากสิ่งเดียวกับที่ lib อ่าน
   *
   * summarizeCard is the only thing that decides orphanhood, and this asserts
   * the screen shows what it decided rather than deciding again with a rule of
   * its own that could drift.
   */
  it('ทุกใบบนจอ ป้ายตรงกับสิ่งที่ summarizeCard ตัดสิน', async () => {
    state.cards = [
      row({ id: 'a', code: 'a', used_by: [] }),
      row({ id: 'b', code: 'b', used_by: [{ kind: 'stamp', label: 'บัตรแสตมป์ของค่าสะสม "x"' }] }),
    ]
    const { container } = await show()
    for (const [index, tile] of tiles(container).entries()) {
      const expected = summarizeCard(state.cards[index]!)
      const pill = within(tile).queryByText('ไม่มีใครใช้')
      expect(pill !== null, expected.code).toBe(expected.isOrphan)
    }
  })
})

/**
 * ทางเข้าจอสร้างการ์ด · ปลายทางมีไฟล์จริงแล้ว จึงเป็นลิงก์ได้
 *
 * แผ่นการ์ดยังไม่เป็นลิงก์ เพราะปลายทางของมันคือจอแก้บล็อกทีละใบ ซึ่งเป็น Task 13
 * และยังไม่มีไฟล์ · ลิงก์สองอันนี้จึงอยู่คนละสถานะกันโดยตั้งใจ
 */
describe('M3-S01 · ทางเข้าจอสร้างการ์ด', () => {
  const createLink = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('a'))
      .find((a) => a.textContent?.includes('สร้างการ์ด')) ?? null

  it('ผู้ตั้งค่าแคมเปญเห็นปุ่มสร้างการ์ด และมันพาไป cards/new', async () => {
    const { container } = await show()
    expect(createLink(container)?.getAttribute('href')).toBe('/campaigns/c1/cards/new')
  })

  it('ผู้ดูแลเนื้อหาไม่เห็นปุ่มนั้น เพราะ action ปฏิเสธเขาอยู่แล้ว', async () => {
    state.role = 'content_editor'
    const { container } = await show()
    expect(createLink(container)).toBeNull()
  })

  it('แผ่นการ์ดยังไม่ใช่ลิงก์ · จอแก้บล็อกยังไม่มีใครเขียน', async () => {
    const { container } = await show()
    for (const tile of tiles(container)) {
      expect(tile.tagName).not.toBe('A')
      expect(tile.querySelector('a')).toBeNull()
    }
  })

  it('กลับมาจากการสร้างสำเร็จ จอบอกว่าใบไหนเพิ่งเกิด', async () => {
    const { container } = await show({ created: 'welcome' })
    expect(container.textContent).toContain('สร้างการ์ด welcome แล้ว')
  })

  it('เข้ามาเฉยๆ ไม่มีกล่องนั้นค้างอยู่', async () => {
    const { container } = await show()
    expect(container.textContent).not.toContain('แล้ว — บล็อกของเทมเพลตติดมาให้ครบ')
  })
})
