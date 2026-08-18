import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

type SelectorRow = {
  id: string
  name: string
  returns: string
  source_type: string
  source_key: string | null
  fallback_value: string
  option_count: number
  used_by: string[]
}

const selector = (patch: Partial<SelectorRow> = {}): SelectorRow => ({
  id: 'sel-1',
  name: 'คำทำนายประจำวัน',
  returns: 'text',
  source_type: 'campaign_day',
  source_key: '7',
  fallback_value: 'ขอให้โชคดี',
  option_count: 0,
  used_by: [],
  ...patch,
})

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaigns: string[]
  selectors: SelectorRow[]
  optionCount: number
  updatedOptions: string[]
  writes: Array<{ text: string; values: unknown[] }>
  redirectedTo: string | undefined
} = {
  cookie: undefined, user: undefined, campaigns: ['camp-1'],
  selectors: [selector()], optionCount: 0, updatedOptions: ['opt-1'],
  writes: [], redirectedTo: undefined,
}

/** ท่อน WHERE ที่ถูกส่งเข้าไปในคำสั่งอื่นอีกที · ไม่ใช่คำสั่งของตัวเอง */
type Fragment = { where: unknown[] }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    // postgres.js ให้ประกอบ WHERE แยกแล้วเสียบเข้าไปได้ · selectSelectors ใช้ท่านั้น
    // ตัวปลอมจึงต้องแยกท่อนออกจากคำสั่ง ไม่งั้นท่อนจะถูกนับเป็นการเขียนหนึ่งครั้ง
    if (/^WHERE/.test(text)) return { where: values } as Fragment

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/SELECT id FROM campaign/.test(text)) {
        return Promise.resolve(state.campaigns.includes(String(values[0])) ? [{ id: values[0] }] : [])
      }
      // requireSelector · แคบกว่า selectSelectors และมาก่อนเสมอ
      if (/^SELECT s\.id, s\.returns/.test(text)) {
        const found = state.selectors.find((row) => row.id === values[0])
        return Promise.resolve(found && String(values[1]) === 'camp-1' ? [found] : [])
      }
      if (/FROM card_selector s/.test(text)) {
        const { where } = values[0] as Fragment
        const [campaignId, selectorId] = where.map(String)
        const found = state.selectors.filter((row) =>
          campaignId === 'camp-1' && (selectorId === undefined || row.id === selectorId))
        return Promise.resolve(found)
      }
      if (/SELECT count\(\*\) FROM card_selector_option/.test(text)) {
        return Promise.resolve([{ count: String(state.optionCount) }])
      }
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    if (/^INSERT INTO card_selector \(/.test(text)) return Promise.resolve([{ id: 'sel-new' }])
    if (/^UPDATE card_selector_option/.test(text)) {
      return Promise.resolve(
        state.updatedOptions.includes(String(values[values.length - 2])) ? [{ id: 'opt-1' }] : [],
      )
    }
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
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { state.redirectedTo = to },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { deleteSelector, deleteSelectorOption, saveSelector, saveSelectorOption } =
  await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const selectorForm = (patch: Record<string, string> = {}) =>
  form({
    name: 'คำทำนายประจำวัน',
    returns: 'text',
    source_type: 'campaign_day',
    cycle_days: '7',
    fallback_value: 'ขอให้โชคดี',
    ...patch,
  })

const optionForm = (patch: Record<string, string> = {}) =>
  form({ condition: '3', result_value: 'วันพุธของคุณสดใส', ...patch })

const writesTo = (pattern: RegExp) => state.writes.filter((write) => pattern.test(write.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.campaigns = ['camp-1']
  state.selectors = [selector()]
  state.optionCount = 0
  state.updatedOptions = ['opt-1']
  state.writes = []
  state.redirectedTo = undefined
})

describe('สิทธิ์ของทั้งสี่ action', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['saveSelector', () => saveSelector('camp-1', '', selectorForm())],
    ['deleteSelector', () => deleteSelector('camp-1', 'sel-1')],
    ['saveSelectorOption', () => saveSelectorOption('camp-1', 'sel-1', '', optionForm())],
    ['deleteSelectorOption', () => deleteSelectorOption('camp-1', 'sel-1', 'opt-1')],
  ]

  it.each(calls)('%s · ยังไม่เข้าระบบ ทำไม่ได้', async (_name, call) => {
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · อีเมลที่ไม่อยู่ในรายชื่อ ทำไม่ได้', async (_name, call) => {
    state.cookie = 'stranger@example.com'
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · บัญชีที่ถูกถอนสิทธิ์ ทำไม่ได้แม้ยังมีแถวอยู่', async (_name, call) => {
    signedInAs('configurator', false)
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ดูรายงานทำไม่ได้', async (_name, call) => {
    signedInAs('reporter')
    await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ตั้งค่าแคมเปญทำได้', async (_name, call) => {
    signedInAs('configurator')
    await call()
    expect(state.writes.length).toBeGreaterThan(0)
  })

  /**
   * ผู้ดูแลเนื้อหาแก้ได้เฉพาะข้อความในตารางทางเลือก
   *
   * Permission Matrix · L1 §2. Which player sees which row is the campaign's
   * path, not its copy, and how many rows there are is how many paths there
   * are. Rewriting what a row says changes neither.
   */
  it.each([
    ['saveSelector', () => saveSelector('camp-1', 'sel-1', selectorForm())],
    ['deleteSelector', () => deleteSelector('camp-1', 'sel-1')],
    ['deleteSelectorOption', () => deleteSelectorOption('camp-1', 'sel-1', 'opt-1')],
  ] as Array<[string, () => Promise<void>]>)(
    '%s · ผู้ดูแลเนื้อหาทำไม่ได้ เพราะเป็นโครง ไม่ใช่เนื้อหา', async (_name, call) => {
      signedInAs('content_editor')
      await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
      expect(state.writes).toEqual([])
    },
  )

  it('ผู้ดูแลเนื้อหาเพิ่มแถวใหม่ไม่ได้ และไม่มีอะไรถูกเขียน', async () => {
    signedInAs('content_editor')
    await expect(saveSelectorOption('camp-1', 'sel-1', '', optionForm()))
      .rejects.toThrow('เพิ่มทางเลือกไม่ได้')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาแก้ข้อความของแถวที่มีอยู่ได้', async () => {
    signedInAs('content_editor')
    await saveSelectorOption('camp-1', 'sel-1', 'opt-1', optionForm())
    expect(writesTo(/UPDATE card_selector_option/).length).toBe(1)
  })

  /** สิ่งที่กันไม่ให้เงื่อนไขถูกแก้ คือคำสั่งที่ไม่มีคอลัมน์นั้นอยู่ ไม่ใช่ช่องที่ซ่อนไว้ */
  it('ผู้ดูแลเนื้อหาส่งเงื่อนไขใหม่มาด้วย เงื่อนไขไม่ถูกเขียน', async () => {
    signedInAs('content_editor')
    await saveSelectorOption('camp-1', 'sel-1', 'opt-1', optionForm({ condition: '9-9' }))

    const [write] = writesTo(/UPDATE card_selector_option/)
    expect(write.text).not.toMatch(/match_value/)
    expect(write.text).not.toMatch(/range_min/)
    expect(write.values).not.toContain(9)
  })
})

describe('saveSelector · ค่าที่รับและไม่รับ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('แคมเปญที่ไม่มีอยู่ ไม่มีอะไรถูกเขียน', async () => {
    await expect(saveSelector('camp-ไม่มี', '', selectorForm())).rejects.toThrow('ไม่พบแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('ชุดของแคมเปญอื่น แก้ผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    await expect(saveSelector('camp-1', 'sel-ของคนอื่น', selectorForm()))
      .rejects.toThrow('ไม่พบชุดเนื้อหานี้')
    expect(state.writes).toEqual([])
  })

  /**
   * ของสำรองบังคับกรอก (BR-27)
   *
   * fallback_value is NOT NULL, so an empty one never reaches the column — it
   * reaches a constraint name instead. The set is consulted while a player is
   * waiting for a reply, and one with nothing to return is a card with nothing
   * to say, so the refusal says that rather than saying "null value".
   */
  it('ไม่กรอกของสำรอง ถูกปฏิเสธพร้อมเหตุผล และไม่มีอะไรถูกเขียน', async () => {
    for (const fallback of ['', '   ']) {
      await expect(saveSelector('camp-1', '', selectorForm({ fallback_value: fallback })))
        .rejects.toThrow('BR-27')
    }
    expect(state.writes).toEqual([])
  })

  it('ของสำรองที่กรอกแล้ว ถูกตัดช่องว่างหัวท้ายก่อนเก็บ', async () => {
    await saveSelector('camp-1', '', selectorForm({ fallback_value: '  ขอให้โชคดี  ' }))
    expect(state.writes[0].values).toContain('ขอให้โชคดี')
  })

  it('ชื่อว่างถูกปฏิเสธ และยาวเกิน 100 ก็ถูกปฏิเสธ', async () => {
    await expect(saveSelector('camp-1', '', selectorForm({ name: '  ' })))
      .rejects.toThrow('ต้องตั้งชื่อ')
    await expect(saveSelector('camp-1', '', selectorForm({ name: 'x'.repeat(101) })))
      .rejects.toThrow('100')
    expect(state.writes).toEqual([])
  })

  it('ค่าที่ไม่ได้อยู่ใน CHECK ของตาราง ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    for (const returns of ['', 'CARD', 'image', 'video']) {
      await expect(saveSelector('camp-1', '', selectorForm({ returns })), returns)
        .rejects.toThrow('คืนอะไร')
    }
    for (const source of ['', 'day', 'RESULT', 'counter']) {
      await expect(saveSelector('camp-1', '', selectorForm({ source_type: source })), source)
        .rejects.toThrow('เลือกจากค่าไหน')
    }
    expect(state.writes).toEqual([])
  })

  /** source_key มีคอลัมน์เดียว · อ่านผิดช่องคือเก็บ "pet_type" ไว้เป็นความยาวรอบ */
  it('ชนิดที่เป็นรอบ เก็บความยาวรอบลง source_key ไม่ใช่ช่องชื่อค่า', async () => {
    await saveSelector('camp-1', '', selectorForm({
      source_type: 'campaign_round', cycle_days: '4', source_key: 'pet_type',
    }))
    expect(state.writes[0].values).toContain('4')
    expect(state.writes[0].values).not.toContain('pet_type')
  })

  it('ชนิดที่ไม่ใช่รอบ เก็บชื่อค่าลง source_key ไม่ใช่ความยาวรอบ', async () => {
    await saveSelector('camp-1', '', selectorForm({
      source_type: 'attribute', source_key: 'pet_type', cycle_days: '7',
    }))
    expect(state.writes[0].values).toContain('pet_type')
  })

  it('ชนิดที่เป็นรอบแต่ความยาวรอบไม่ใช่ตัวเลข ถูกปฏิเสธ', async () => {
    for (const days of ['', 'เจ็ด', '7 วัน', '-1', '1.5']) {
      await expect(saveSelector('camp-1', '', selectorForm({ cycle_days: days })), days)
        .rejects.toThrow('ความยาวรอบ')
    }
    expect(state.writes).toEqual([])
  })

  it('ความยาวรอบนอกช่วง 1–366 ถูกปฏิเสธ', async () => {
    for (const days of ['0', '367']) {
      await expect(saveSelector('camp-1', '', selectorForm({ cycle_days: days })), days)
        .rejects.toThrow('366')
    }
    await expect(saveSelector('camp-1', '', selectorForm({ cycle_days: '366' })))
      .resolves.toBeUndefined()
  })

  it('ชนิดที่ต้องรู้ว่าอ่านค่าตัวไหน แต่ไม่บอก ถูกปฏิเสธ', async () => {
    for (const source of ['attribute', 'counter_level']) {
      await expect(
        saveSelector('camp-1', '', selectorForm({ source_type: source, source_key: '' })), source,
      ).rejects.toThrow('ต้องบอกว่าจะอ่าน')
    }
    expect(state.writes).toEqual([])
  })

  it('ชนิดผลลัพธ์ของกิจกรรม เว้นช่องชื่อค่าได้ และเก็บเป็น null', async () => {
    await saveSelector('camp-1', '', selectorForm({ source_type: 'result', source_key: '' }))
    expect(state.writes[0].values).toContain(null)
  })

  it('สร้างเสร็จแล้วพาไปหน้าตารางทางเลือกของชุดที่เพิ่งสร้าง', async () => {
    await saveSelector('camp-1', '', selectorForm())
    expect(writesTo(/^INSERT INTO card_selector \(/).length).toBe(1)
    expect(state.redirectedTo).toBe('/campaigns/camp-1/selectors/sel-new')
  })

  it('แก้ของเดิมไม่ได้พาไปไหน และเป็น UPDATE ไม่ใช่ INSERT', async () => {
    await saveSelector('camp-1', 'sel-1', selectorForm({ name: 'ชื่อใหม่' }))
    expect(writesTo(/^UPDATE card_selector /).length).toBe(1)
    expect(writesTo(/^INSERT/).length).toBe(0)
    expect(state.redirectedTo).toBeUndefined()
  })

  /**
   * เปลี่ยนสิ่งที่ชุดคืน ตอนมีทางเลือกอยู่แล้ว = ทิ้งความหมายของทุกแถวไว้ข้างหลัง
   *
   * result_value holds a sentence for a text set and a card id for a card set,
   * and the column does not record which of the two a row was written as.
   */
  it('เปลี่ยนสิ่งที่คืน ตอนที่มีทางเลือกอยู่แล้ว ถูกปฏิเสธพร้อมจำนวนแถวจริง', async () => {
    state.selectors = [selector({ returns: 'text', option_count: 4 })]
    await expect(saveSelector('camp-1', 'sel-1', selectorForm({ returns: 'card' })))
      .rejects.toThrow('4 แถว')
    expect(state.writes).toEqual([])
  })

  it('เปลี่ยนสิ่งที่คืน ตอนที่ยังไม่มีทางเลือกเลย ทำได้', async () => {
    state.selectors = [selector({ returns: 'text', option_count: 0 })]
    await saveSelector('camp-1', 'sel-1', selectorForm({ returns: 'card' }))
    expect(writesTo(/^UPDATE card_selector /).length).toBe(1)
  })

  it('แก้อย่างอื่นตอนมีทางเลือกอยู่แล้ว ทำได้ตราบใดที่ยังคืนของชนิดเดิม', async () => {
    state.selectors = [selector({ returns: 'text', option_count: 9 })]
    await saveSelector('camp-1', 'sel-1', selectorForm({ name: 'ชื่อใหม่' }))
    expect(writesTo(/^UPDATE card_selector /).length).toBe(1)
  })
})

describe('saveSelectorOption · เพดาน 10 แถว และเงื่อนไขที่รับได้', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ครบสิบแถวแล้ว เพิ่มไม่ได้ และบอกว่าให้แยกเป็นชุดที่สอง', async () => {
    state.optionCount = 10
    await expect(saveSelectorOption('camp-1', 'sel-1', '', optionForm()))
      .rejects.toThrow('BR-27')
    expect(state.writes).toEqual([])
  })

  it('เก้าแถวยังเพิ่มได้อีกหนึ่ง', async () => {
    state.optionCount = 9
    await saveSelectorOption('camp-1', 'sel-1', '', optionForm())
    expect(writesTo(/^INSERT INTO card_selector_option/).length).toBe(1)
  })

  /** เพดานคุมเฉพาะแถวใหม่ · ชุดที่ล้นมาก่อนหน้ายังต้องแก้ข้อความได้ */
  it('ชุดที่เกินเพดานไปแล้ว ยังแก้แถวเดิมได้', async () => {
    state.optionCount = 12
    await saveSelectorOption('camp-1', 'sel-1', 'opt-1', optionForm())
    expect(writesTo(/^UPDATE card_selector_option/).length).toBe(1)
  })

  it('เงื่อนไขว่างถูกปฏิเสธ และไม่มีอะไรถูกเขียน', async () => {
    await expect(saveSelectorOption('camp-1', 'sel-1', '', optionForm({ condition: '  ' })))
      .rejects.toThrow('ต้องกรอกเงื่อนไข')
    expect(state.writes).toEqual([])
  })

  it('ค่าที่จะคืนเป็นค่าว่างถูกปฏิเสธ · แถวที่ไม่คืนอะไรเลยเท่ากับไม่มีแถว', async () => {
    await expect(saveSelectorOption('camp-1', 'sel-1', '', optionForm({ result_value: ' ' })))
      .rejects.toThrow('ต้องกรอกสิ่งที่แถวนี้จะคืน')
    expect(state.writes).toEqual([])
  })

  it('ค่าที่จะคืนยาวเกิน 2000 ตัวถูกปฏิเสธ', async () => {
    await expect(
      saveSelectorOption('camp-1', 'sel-1', '', optionForm({ result_value: 'x'.repeat(2001) })),
    ).rejects.toThrow('2000')
    expect(state.writes).toEqual([])
  })

  it('ช่วงถูกแยกเป็นสองปลาย ไม่ได้เก็บเป็นข้อความ', async () => {
    await saveSelectorOption('camp-1', 'sel-1', '', optionForm({ condition: '3-5' }))
    const [write] = writesTo(/^INSERT INTO card_selector_option/)
    expect(write.values).toContain(3)
    expect(write.values).toContain(5)
    expect(write.values).not.toContain('3-5')
  })

  it('ค่าตรงตัวลงคอลัมน์จับคู่ตรงตัว ปลายช่วงเป็น null ทั้งคู่', async () => {
    await saveSelectorOption('camp-1', 'sel-1', '', optionForm({ condition: 'cat' }))
    const [write] = writesTo(/^INSERT INTO card_selector_option/)
    expect(write.values).toContain('cat')
    expect(write.values.filter((value) => value === null).length).toBe(2)
  })

  it('แถวใหม่ต่อท้ายลำดับเดิม ไม่ได้แทรกที่ศูนย์ทุกครั้ง', async () => {
    await saveSelectorOption('camp-1', 'sel-1', '', optionForm())
    const [write] = writesTo(/^INSERT INTO card_selector_option/)
    expect(write.text).toContain('coalesce(max(sort_order), -1) + 1')
  })

  it('แถวที่ไม่ได้อยู่ในชุดนี้ แก้ไม่ได้', async () => {
    state.updatedOptions = []
    await expect(saveSelectorOption('camp-1', 'sel-1', 'opt-ของชุดอื่น', optionForm()))
      .rejects.toThrow('ไม่พบทางเลือกแถวนี้')
  })

  it('ชุดของแคมเปญอื่น เพิ่มแถวผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    await expect(saveSelectorOption('camp-1', 'sel-ของคนอื่น', '', optionForm()))
      .rejects.toThrow('ไม่พบชุดเนื้อหานี้')
    expect(state.writes).toEqual([])
  })
})

describe('deleteSelector · ชุดที่มีคนดึงไปใช้', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ยังไม่มีใครใช้ ลบได้จริง', async () => {
    await deleteSelector('camp-1', 'sel-1')
    expect(writesTo(/^DELETE FROM card_selector /).length).toBe(1)
  })

  it('มีบล็อกดึงไปใช้ ลบไม่ได้ และบอกชื่อการ์ดที่ต้องไปแก้ก่อน', async () => {
    state.selectors = [selector({ used_by: ['การ์ด "win" · บล็อก title'] })]
    await expect(deleteSelector('camp-1', 'sel-1')).rejects.toThrow('win')
    expect(state.writes).toEqual([])
  })

  it('ชุดที่ไม่มีอยู่ในแคมเปญนี้ ลบไม่ได้', async () => {
    state.selectors = []
    await expect(deleteSelector('camp-1', 'sel-1')).rejects.toThrow('ไม่พบชุดเนื้อหานี้')
    expect(state.writes).toEqual([])
  })
})

describe('deleteSelectorOption', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ลบแถวที่ระบุในชุดที่ระบุ ไม่ใช่ลบด้วย id ของแถวอย่างเดียว', async () => {
    await deleteSelectorOption('camp-1', 'sel-1', 'opt-1')
    const [write] = writesTo(/^DELETE FROM card_selector_option/)
    expect(write.text).toContain('selector_id')
    expect(write.values).toEqual(['opt-1', 'sel-1'])
  })

  it('ชุดของแคมเปญอื่น ลบแถวผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    await expect(deleteSelectorOption('camp-1', 'sel-ของคนอื่น', 'opt-1'))
      .rejects.toThrow('ไม่พบชุดเนื้อหานี้')
    expect(state.writes).toEqual([])
  })
})
