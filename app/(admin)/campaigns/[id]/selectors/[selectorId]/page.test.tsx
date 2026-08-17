// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeCondition, MAX_OPTIONS, NEAR_FULL_OPTIONS, RETURN_NAME, SELECTOR_SOURCES,
  type SelectorOptionRow, type SelectorRow, SOURCE_COND_HINT, SOURCE_NAME,
} from '@/lib/db/selectors'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Role = 'configurator' | 'content_editor' | 'reporter'

const state: {
  role: Role | null
  campaign: { id: string; name: string } | null
  selector: SelectorRow | null
  options: SelectorOptionRow[]
  cards: Array<{ id: string; code: string }>
  assets: Array<{ id: string; label: string; url: string }>
  redirectedTo: string | null
  notFoundCalled: boolean
} = {
  role: 'configurator', campaign: { id: 'c1', name: 'แคมเปญคุกกี้' },
  selector: null, options: [], cards: [], assets: [],
  redirectedTo: null, notFoundCalled: false,
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
  const summarize = actual.summarizeSelector as (row: SelectorRow) => unknown
  return {
    ...actual,
    loadSelector: async () => state.selector === null ? null : {
      selector: summarize(state.selector),
      options: state.options,
      cards: state.cards,
      assets: state.assets,
    },
  }
})
vi.mock('../actions', () => ({
  saveSelector: vi.fn(), deleteSelector: vi.fn(),
  saveSelectorOption: vi.fn(), deleteSelectorOption: vi.fn(),
}))

const SelectorEditPage = (await import('./page')).default

const selectorRow = (patch: Partial<SelectorRow> = {}): SelectorRow => ({
  id: 'sel-1',
  name: 'คำทำนายประจำวัน',
  returns: 'text',
  source_type: 'campaign_day',
  source_key: '7',
  fallback_value: 'ขอให้โชคดี',
  option_count: 2,
  used_by: [],
  ...patch,
})

const option = (patch: Partial<SelectorOptionRow> = {}): SelectorOptionRow => ({
  id: 'opt-1',
  match_value: null,
  range_min: 1,
  range_max: 3,
  result_value: 'ต้นสัปดาห์ของคุณสดใส',
  sort_order: 0,
  ...patch,
})

const show = async () => render(await SelectorEditPage({
  params: Promise.resolve({ id: 'c1', selectorId: 'sel-1' }),
}))

const optionRows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[data-option-row]'))

beforeEach(() => {
  state.role = 'configurator'
  state.campaign = { id: 'c1', name: 'แคมเปญคุกกี้' }
  state.selector = selectorRow()
  state.options = [
    option({ id: 'opt-1', range_min: 1, range_max: 3, result_value: 'ต้นสัปดาห์ของคุณสดใส' }),
    option({ id: 'opt-2', range_min: 4, range_max: 7, result_value: 'ปลายสัปดาห์ระวังของหาย' }),
  ]
  state.cards = [{ id: 'card-1', code: 'win' }, { id: 'card-2', code: 'lose' }]
  state.assets = [{ id: 'as-1', label: 'cat.png', url: 'https://cdn/cat.png' }]
  state.redirectedTo = null
  state.notFoundCalled = false
})

describe('M3-S03 แก้ · หัวจอและทางเข้าออก', () => {
  it('ป้ายรหัสจออยู่เหนือหัวข้อ และหัวข้อคือชื่อชุด', async () => {
    await show()
    expect(screen.getByText('M3-S03 · Selector setup')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('คำทำนายประจำวัน')
  })

  it('มีทางกลับไปรายการชุดเนื้อหา', async () => {
    await show()
    expect(screen.getByRole('link', { name: '← ชุดเนื้อหาทั้งหมด' }).getAttribute('href'))
      .toBe('/campaigns/c1/selectors')
  })

  it('ยังไม่เข้าระบบ ถูกส่งไปหน้าเข้าระบบ', async () => {
    state.role = null
    await expect(show()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  it('ชุดที่ไม่มีอยู่ในแคมเปญนี้ ได้หน้าไม่พบ', async () => {
    state.selector = null
    await expect(show()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFoundCalled).toBe(true)
  })
})

describe('M3-S03 แก้ · ฟอร์มโครงของชุด', () => {
  it('ช่องทุกช่องขึ้นมาพร้อมค่าที่บันทึกไว้ ไม่ใช่ช่องเปล่า', async () => {
    await show()
    expect((screen.getByLabelText('ชื่อชุด (บังคับ)') as HTMLInputElement).value)
      .toBe('คำทำนายประจำวัน')
    expect((screen.getByLabelText('คืนอะไร (บังคับ)') as HTMLSelectElement).value).toBe('text')
    expect((screen.getByLabelText('เลือกจากค่าไหน (บังคับ)') as HTMLSelectElement).value)
      .toBe('campaign_day')
  })

  it('ตัวเลือกของช่องเลือกจากค่าไหน ครบทุกค่าที่ตารางรับ พร้อมชื่อภาษาไทย', async () => {
    await show()
    const source = screen.getByLabelText('เลือกจากค่าไหน (บังคับ)') as HTMLSelectElement
    expect(Array.from(source.options).map((o) => o.value)).toEqual([...SELECTOR_SOURCES])
    expect(Array.from(source.options).map((o) => o.textContent))
      .toEqual(SELECTOR_SOURCES.map((value) => SOURCE_NAME[value]))
  })

  /**
   * source_key คอลัมน์เดียวหมายถึงสองอย่าง จอจึงวาดสองช่องไว้เสมอ
   *
   * ต้นแบบซ่อนช่องความยาวรอบไว้จนกว่าจะเลือกชนิดที่เป็นรอบ ซึ่งต้องมี state ฝั่ง client
   * จอจริงไม่มี · ถ้าวาดช่องเดียวตามชนิดที่บันทึกไว้ คนที่เปลี่ยนจาก "วันที่ของแคมเปญ"
   * เป็น "ค่าที่ผู้เล่นตอบไว้" จะกดบันทึกแล้วโดนปฏิเสธ โดยไม่มีช่องบนจอให้ตอบคำถามนั้น
   */
  it('มีทั้งช่องชื่อค่าที่จะอ่านและช่องความยาวรอบเสมอ ไม่ว่าชนิดที่บันทึกไว้จะเป็นอะไร', async () => {
    await show()
    expect(screen.getByLabelText('ชื่อค่าที่จะอ่าน')).toBeDefined()
    expect(screen.getByLabelText('ความยาวรอบ (วัน)')).toBeDefined()
  })

  it('ชนิดที่เป็นรอบ เติมความยาวรอบไว้ให้ ไม่ได้เอาไปใส่ช่องชื่อค่า', async () => {
    state.selector = selectorRow({ source_type: 'campaign_round', source_key: '4' })
    await show()
    expect((screen.getByLabelText('ความยาวรอบ (วัน)') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('ชื่อค่าที่จะอ่าน') as HTMLInputElement).value).toBe('')
  })

  it('ชนิดที่ไม่ใช่รอบ เติมชื่อค่าไว้ให้ ไม่ได้เอาไปใส่ช่องความยาวรอบ', async () => {
    state.selector = selectorRow({ source_type: 'attribute', source_key: 'pet_type' })
    await show()
    expect((screen.getByLabelText('ชื่อค่าที่จะอ่าน') as HTMLInputElement).value).toBe('pet_type')
    expect((screen.getByLabelText('ความยาวรอบ (วัน)') as HTMLInputElement).value).not.toBe('pet_type')
  })

  it('คำอธิบายช่องชื่อค่ามาจากชนิดที่บันทึกไว้ ไม่ใช่ประโยคเดียวใช้ทุกชนิด', async () => {
    state.selector = selectorRow({ source_type: 'counter_level', source_key: 'checkin_days' })
    await show()
    expect(screen.getByText(/รหัสค่าสะสมที่จะอ่านระดับ/)).toBeDefined()
  })

  /**
   * ของสำรองบังคับกรอก (BR-27)
   *
   * ชุดถูกถามตอนที่ผู้เล่นกำลังรอคำตอบอยู่ · ชุดที่ไม่มีอะไรจะคืนคือการ์ดที่ไม่มีอะไรจะพูด
   */
  it('ช่องของสำรองบังคับกรอก และขึ้นมาพร้อมค่าเดิม', async () => {
    await show()
    const fallback = screen.getByLabelText('ของสำรอง (บังคับ · BR-27)') as HTMLTextAreaElement
    expect(fallback.required).toBe(true)
    expect(fallback.value).toBe('ขอให้โชคดี')
  })

  it('ชุดที่คืนการ์ด ของสำรองเลือกจากการ์ดของแคมเปญนี้ ไม่ใช่ช่องพิมพ์อิสระ', async () => {
    state.selector = selectorRow({ returns: 'card', fallback_value: 'card-2' })
    await show()
    const fallback = screen.getByLabelText('ของสำรอง (บังคับ · BR-27)') as HTMLSelectElement
    expect(fallback.tagName).toBe('SELECT')
    expect(Array.from(fallback.options).map((o) => o.value)).toEqual(['', 'card-1', 'card-2'])
    expect(fallback.value).toBe('card-2')
    expect(fallback.required).toBe(true)
  })

  it('ชุดที่คืนภาพ ของสำรองเลือกจากคลังภาพของแคมเปญนี้', async () => {
    state.selector = selectorRow({ returns: 'asset', fallback_value: 'https://cdn/cat.png' })
    await show()
    const fallback = screen.getByLabelText('ของสำรอง (บังคับ · BR-27)') as HTMLSelectElement
    expect(fallback.tagName).toBe('SELECT')
    expect(within(fallback).getByText('cat.png')).toBeDefined()
    expect(fallback.value).toBe('https://cdn/cat.png')
  })

  it('บอกว่าเปลี่ยนสิ่งที่คืนไม่ได้แล้ว เมื่อมีทางเลือกอยู่ พร้อมจำนวนแถวจริง', async () => {
    state.selector = selectorRow({ option_count: 4 })
    await show()
    expect(screen.getByText(/เปลี่ยนสิ่งที่ชุดนี้คืนไม่ได้ — มีทางเลือกอยู่แล้ว 4 แถว/)).toBeDefined()
  })

  it('ยังไม่มีทางเลือกเลย ไม่เตือนเรื่องเปลี่ยนสิ่งที่คืน', async () => {
    state.selector = selectorRow({ option_count: 0 })
    state.options = []
    const { container } = await show()
    expect(container.textContent).not.toContain('เปลี่ยนสิ่งที่ชุดนี้คืนไม่ได้')
  })
})

describe('M3-S03 แก้ · ตารางจับคู่', () => {
  it('หนึ่งแถวต่อหนึ่งทางเลือก เรียงตามลำดับที่ได้มา', async () => {
    const { container } = await show()
    expect(optionRows(container).map((r) => r.getAttribute('data-option-row')))
      .toEqual(['opt-1', 'opt-2'])
  })

  /**
   * เงื่อนไขที่อ่านกลับมาต้องเป็นรูปเดียวกับที่พิมพ์ไป
   *
   * สามคอลัมน์ถูกเขียนกลับเป็นข้อความในช่องเดียว · ถ้ารูปไม่ตรง การกดบันทึกโดยไม่แตะ
   * แถวนั้นเลยจะเขียนทับเงื่อนไขเดิม ซึ่งเป็นวิธีทำเงื่อนไขหายที่เงียบที่สุด
   */
  it('ช่องเงื่อนไขแสดงรูปเดียวกับที่ describeCondition เขียนกลับ', async () => {
    state.options = [
      option({ id: 'a', match_value: 'cat', range_min: null, range_max: null }),
      option({ id: 'b', match_value: null, range_min: 3, range_max: 5 }),
      option({ id: 'c', match_value: null, range_min: 3, range_max: null }),
      option({ id: 'd', match_value: null, range_min: null, range_max: 5 }),
    ]
    await show()
    const boxes = screen.getAllByLabelText('เงื่อนไข') as HTMLInputElement[]
    expect(boxes.map((box) => box.value))
      .toEqual(state.options.map((row) => describeCondition(row)))
    expect(boxes.map((box) => box.value)).toEqual(['cat', '3-5', '≥3', '≤5'])
  })

  /** Field คิด id จาก hash ของป้าย · ป้ายซ้ำทุกแถวจะได้ id ชนกันทั้งตาราง */
  it('ทุกแถวมี id ของตัวเอง ป้ายไม่ได้ชี้ไปที่ช่องเดียวกันหมด', async () => {
    await show()
    const ids = (screen.getAllByLabelText('เงื่อนไข') as HTMLInputElement[]).map((box) => box.id)
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
    const values = (screen.getAllByLabelText('สิ่งที่คืน') as HTMLTextAreaElement[]).map((b) => b.id)
    expect(new Set(values).size).toBe(2)
  })

  it('ช่องสิ่งที่คืนขึ้นมาพร้อมค่าเดิมของแถวนั้น', async () => {
    await show()
    const values = screen.getAllByLabelText('สิ่งที่คืน') as HTMLTextAreaElement[]
    expect(values.map((box) => box.value))
      .toEqual(['ต้นสัปดาห์ของคุณสดใส', 'ปลายสัปดาห์ระวังของหาย'])
  })

  it('ชุดที่คืนการ์ด แต่ละแถวเลือกการ์ดจากรายการ ไม่ใช่พิมพ์ id เอง', async () => {
    state.selector = selectorRow({ returns: 'card' })
    state.options = [option({ id: 'opt-1', result_value: 'card-2' })]
    await show()
    const value = screen.getByLabelText('สิ่งที่คืน') as HTMLSelectElement
    expect(value.tagName).toBe('SELECT')
    expect(Array.from(value.options).map((o) => o.value)).toEqual(['', 'card-1', 'card-2'])
    expect(value.value).toBe('card-2')
  })

  it('คำอธิบายช่องเงื่อนไขมาจากชนิดของค่าที่อ่าน ไม่ใช่ประโยคเดียวใช้ทุกชนิด', async () => {
    for (const source of SELECTOR_SOURCES) {
      state.selector = selectorRow({ source_type: source, source_key: '7' })
      await show()
      expect(screen.getByText(`ช่องเงื่อนไข: ${SOURCE_COND_HINT[source]}`), source).toBeDefined()
      cleanup()
    }
  })

  it('เลขลำดับของแถวเริ่มที่หนึ่ง ตรงกับที่ตัวอย่างด้านข้างนับ', async () => {
    const { container } = await show()
    const ordinals = optionRows(container).map((row) => row.firstElementChild?.textContent)
    expect(ordinals).toEqual(['1', '2'])
  })

  /**
   * ชุดที่ยังไม่มีทางเลือกไม่ใช่ชุดที่พัง มันคือชุดที่คืนของสำรองให้ทุกคน
   *
   * ตารางว่างที่ไม่มีคำอธิบายอ่านได้ว่าโหลดไม่ขึ้น · ประโยคนี้บอกว่ามันทำงานอยู่ และทำอะไรอยู่
   */
  it('ชุดที่ยังไม่มีทางเลือกสักแถว บอกว่าตอนนี้คืนของสำรองให้ทุกคน', async () => {
    state.selector = selectorRow({ option_count: 0 })
    state.options = []
    const { container } = await show()
    expect(optionRows(container).length).toBe(0)
    expect(screen.getByText('ยังไม่มีทางเลือกสักแถว — ตอนนี้ชุดนี้คืนของสำรองให้ทุกคนเสมอ'))
      .toBeDefined()
  })

  it('มีทางเลือกอยู่แล้ว ไม่ต้องบอกว่ายังไม่มีสักแถว', async () => {
    const { container } = await show()
    expect(container.textContent).not.toContain('ยังไม่มีทางเลือกสักแถว')
  })

  /**
   * ค่าที่ออกจากรายการไปแล้ว ต้องยังมีตัวเลือกของตัวเองอยู่
   *
   * ภาพที่ถูกลบออกจากคลัง หรือการ์ดที่ถูกลบไปแล้ว ยังเป็นค่าที่ถูกตอบอยู่จริงในแชท
   * ถ้าไม่มีตัวเลือกของมัน ช่องจะตกไปที่ "— เลือก —" เงียบๆ แล้วการกดบันทึกครั้งถัดไป
   * จะลบค่าที่ยังใช้อยู่ทิ้ง โดยไม่มีอะไรบอกว่าเพิ่งทำอะไรลงไป
   */
  it('ค่าที่ไม่อยู่ในคลังภาพแล้ว ยังถูกเลือกอยู่ ไม่ตกกลับไปเป็นช่องว่าง', async () => {
    state.selector = selectorRow({ returns: 'asset' })
    state.options = [option({ id: 'opt-1', result_value: 'https://cdn/หายไปแล้ว.png' })]
    await show()
    const value = screen.getByLabelText('สิ่งที่คืน') as HTMLSelectElement
    expect(value.value).toBe('https://cdn/หายไปแล้ว.png')
    expect(within(value).getByText(/ไม่อยู่ในคลังภาพแล้ว/)).toBeDefined()
  })

  it('การ์ดที่ไม่อยู่ในแคมเปญแล้ว ยังถูกเลือกอยู่เหมือนกัน', async () => {
    state.selector = selectorRow({ returns: 'card', fallback_value: 'card-ที่ถูกลบไป' })
    state.options = []
    await show()
    const fallback = screen.getByLabelText('ของสำรอง (บังคับ · BR-27)') as HTMLSelectElement
    expect(fallback.value).toBe('card-ที่ถูกลบไป')
    expect(within(fallback).getByText(/ไม่อยู่ในแคมเปญนี้แล้ว/)).toBeDefined()
  })

  it('บอกจำนวนที่ใช้ไปพร้อมเพดาน', async () => {
    state.selector = selectorRow({ option_count: 2 })
    await show()
    expect(screen.getByText(`ใช้ไป 2/${MAX_OPTIONS} ทางเลือก`)).toBeDefined()
  })
})

/**
 * เพดานสิบแถว (BR-27)
 *
 * The action refuses the eleventh insert on its own — this is the screen not
 * offering a box that leads to that refusal, which is a different job.
 */
describe('M3-S03 แก้ · เพดาน 10 แถว', () => {
  const fill = (count: number) => {
    state.selector = selectorRow({ option_count: count })
    state.options = Array.from({ length: count }, (_, index) => option({
      id: `opt-${index}`, match_value: String(index), range_min: null, range_max: null,
    }))
  }

  it('ยังไม่เต็ม มีฟอร์มเพิ่มแถวให้ และไม่บอกว่าเต็ม', async () => {
    fill(MAX_OPTIONS - 1)
    await show()
    expect(screen.getByText('＋ เพิ่มทางเลือก')).toBeDefined()
    expect(screen.queryByText(/เต็ม 10 ทางเลือกแล้ว/)).toBeNull()
  })

  it('เต็มสิบแถวแล้ว ไม่มีฟอร์มเพิ่ม และบอกว่าเต็มพร้อมอ้าง BR-27', async () => {
    fill(MAX_OPTIONS)
    await show()
    expect(screen.queryByText('＋ เพิ่มทางเลือก')).toBeNull()
    expect(screen.getByText(`เต็ม ${MAX_OPTIONS} ทางเลือกแล้ว — เพิ่มอีกไม่ได้ (BR-27)`)).toBeDefined()
  })

  it('ใกล้เต็มแล้วเตือนตั้งแต่แถวที่แปด แต่ยังเพิ่มได้', async () => {
    fill(NEAR_FULL_OPTIONS)
    await show()
    expect(screen.getByText(/ใกล้เต็มเพดาน 10 ทางเลือก \(BR-27\)/)).toBeDefined()
    expect(screen.getByText('＋ เพิ่มทางเลือก')).toBeDefined()
  })

  it('ยังไม่ใกล้เต็ม ไม่เตือน', async () => {
    fill(NEAR_FULL_OPTIONS - 1)
    const { container } = await show()
    expect(container.textContent).not.toContain('ใกล้เต็มเพดาน')
  })

  it('ชุดที่ล้นเพดานมาก่อนหน้า ยังแก้แถวเดิมได้ แต่เพิ่มไม่ได้', async () => {
    fill(MAX_OPTIONS + 2)
    const { container } = await show()
    expect(optionRows(container).length).toBe(MAX_OPTIONS + 2)
    expect(screen.queryByText('＋ เพิ่มทางเลือก')).toBeNull()
  })
})

/**
 * ผู้ดูแลเนื้อหาแก้ได้เฉพาะข้อความ (Permission Matrix · L1 §2)
 *
 * The action enforces this by writing a statement without the condition columns
 * in it. The screen matches, so nobody types into a box whose value is thrown
 * away — but the screen is not what enforces it.
 */
describe('M3-S03 แก้ · สิทธิ์ของแต่ละบทบาท', () => {
  it('ผู้ดูแลเนื้อหาเห็นคำเตือนว่าแก้ได้เฉพาะข้อความ', async () => {
    state.role = 'content_editor'
    await show()
    expect(screen.getByText(/แก้ได้เฉพาะข้อความในตารางทางเลือก/)).toBeDefined()
  })

  it('ผู้ดูแลเนื้อหาแก้ข้อความของแถวได้ แต่ไม่มีช่องเงื่อนไขให้แก้', async () => {
    state.role = 'content_editor'
    await show()
    expect((screen.getAllByLabelText('สิ่งที่คืน') as HTMLTextAreaElement[]).length).toBe(2)
    expect(screen.queryAllByLabelText('เงื่อนไข').length).toBe(0)
    // ยังเห็นเงื่อนไขอยู่ แค่แก้ไม่ได้ — ไม่งั้นจะไม่รู้ว่ากำลังแก้ข้อความของแถวไหน
    expect(screen.getByText('1-3')).toBeDefined()
  })

  it('ผู้ดูแลเนื้อหาเพิ่มหรือลบแถวไม่ได้ และลบชุดไม่ได้', async () => {
    state.role = 'content_editor'
    await show()
    expect(screen.queryByText('＋ เพิ่มทางเลือก')).toBeNull()
    expect(screen.queryByRole('button', { name: 'ลบแถวนี้' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ลบชุดเนื้อหา' })).toBeNull()
  })

  it('ผู้ดูรายงานไม่มีช่องกรอกอะไรเลย และเห็นป้ายดูอย่างเดียว', async () => {
    state.role = 'reporter'
    const { container } = await show()
    expect(screen.getByText('ดูอย่างเดียว')).toBeDefined()
    expect(container.querySelectorAll('input, textarea, select').length).toBe(0)
    expect(container.querySelectorAll('form').length).toBe(0)
  })

  it('ผู้ดูรายงานยังอ่านเงื่อนไขและสิ่งที่คืนของทุกแถวได้', async () => {
    state.role = 'reporter'
    const { container } = await show()
    const [first] = optionRows(container)
    expect(optionRows(container).length).toBe(2)
    expect(within(first!).getByText('1-3')).toBeDefined()
    expect(within(first!).getByText('ต้นสัปดาห์ของคุณสดใส')).toBeDefined()
  })

  it('ผู้ตั้งค่าแก้ได้ทุกอย่าง', async () => {
    await show()
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'ลบแถวนี้' }).length).toBe(2)
    expect(screen.getByRole('button', { name: 'ลบชุดเนื้อหา' })).toBeDefined()
  })
})

describe('M3-S03 แก้ · ลบชุด และใครใช้ชุดนี้อยู่', () => {
  it('ยังไม่มีใครใช้ ลบได้ และบอกไว้ในแผงด้านข้าง', async () => {
    await show()
    expect(screen.getByRole('button', { name: 'ลบชุดเนื้อหา' })).toBeDefined()
    expect(screen.getByText('ยังไม่มีการ์ดหรือกิจกรรมไหนใช้ชุดนี้')).toBeDefined()
  })

  it('มีบล็อกดึงไปใช้ ลบไม่ได้ และบอกชื่อการ์ดที่ต้องไปแก้ก่อน', async () => {
    state.selector = selectorRow({ used_by: ['การ์ด "win" · บล็อก title'] })
    await show()
    expect(screen.queryByRole('button', { name: 'ลบชุดเนื้อหา' })).toBeNull()
    expect(screen.getByText(/ลบไม่ได้ — การ์ด "win" · บล็อก title ดึงชุดนี้ไปใช้อยู่/)).toBeDefined()
  })

  it('แผงด้านข้างแสดงทุกที่ที่ดึงชุดนี้ไปใช้', async () => {
    state.selector = selectorRow({
      used_by: ['การ์ด "win" · บล็อก title', 'การ์ด "lose" · บล็อก body'],
    })
    await show()
    expect(screen.getByText('การ์ด "win" · บล็อก title')).toBeDefined()
    expect(screen.getByText('การ์ด "lose" · บล็อก body')).toBeDefined()
  })
})

describe('M3-S03 แก้ · ดูตัวอย่างทุกแบบ', () => {
  it('แสดงทุกทางเลือกพร้อมเงื่อนไขและลำดับ', async () => {
    const { container } = await show()
    const preview = container.querySelector('[data-preview-all]') as HTMLElement
    expect(within(preview).getByText('1 · 1-3')).toBeDefined()
    expect(within(preview).getByText('2 · 4-7')).toBeDefined()
    expect(within(preview).getByText('ต้นสัปดาห์ของคุณสดใส')).toBeDefined()
  })

  it('ปิดท้ายด้วยของสำรอง เพราะนั่นคือสิ่งที่ผู้เล่นได้เมื่อไม่ตรงแถวไหนเลย', async () => {
    const { container } = await show()
    const preview = container.querySelector('[data-preview-all]') as HTMLElement
    expect(within(preview).getByText('ของสำรอง')).toBeDefined()
    expect(within(preview).getByText('ขอให้โชคดี')).toBeDefined()
  })

  it('ชุดที่ยังไม่มีทางเลือกเลย ยังบอกว่าของสำรองคืออะไร', async () => {
    state.selector = selectorRow({ option_count: 0 })
    state.options = []
    const { container } = await show()
    const preview = container.querySelector('[data-preview-all]') as HTMLElement
    expect(within(preview).getByText('ขอให้โชคดี')).toBeDefined()
  })
})

describe('M3-S03 แก้ · ชื่อของสิ่งที่ชุดคืน', () => {
  it('ตัวเลือกในช่องคืนอะไร เป็นชื่อภาษาไทย ไม่ใช่ค่าดิบ', async () => {
    await show()
    const returns = screen.getByLabelText('คืนอะไร (บังคับ)') as HTMLSelectElement
    expect(Array.from(returns.options).map((o) => o.textContent))
      .toEqual([RETURN_NAME.card, RETURN_NAME.asset, RETURN_NAME.text])
  })
})
