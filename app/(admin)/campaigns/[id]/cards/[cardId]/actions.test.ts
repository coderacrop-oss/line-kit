import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }
type BlockRow = {
  id: string
  block_type: string
  sort_order: number
  content: string | null
  options: unknown
  show_when: unknown[] | null
}

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  cardExists: boolean
  blocks: BlockRow[]
  statements: Array<{ text: string; values: unknown[] }>
  revalidated: string[]
} = {
  cookie: undefined,
  user: undefined,
  cardExists: true,
  blocks: [],
  statements: [],
  revalidated: [],
}

const writes = () => state.statements.filter((s) => /INSERT|UPDATE|DELETE/i.test(s.text))

type FakeSql =
  ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>)
  & { json: (value: unknown) => unknown; begin: (run: (tx: FakeSql) => unknown) => Promise<unknown> }

function makeSql(): FakeSql {
  const runner = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    state.statements.push({ text, values })

    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])

    if (/SELECT id FROM card WHERE/.test(text)) {
      return Promise.resolve(state.cardExists ? [{ id: 'card-1' }] : [])
    }

    if (/SELECT id, block_type, sort_order FROM card_block/.test(text)) {
      return Promise.resolve([...state.blocks].sort((a, b) => a.sort_order - b.sort_order))
    }

    if (/SELECT block_type FROM card_block WHERE id/.test(text)) {
      const id = values[0] as string
      const found = state.blocks.find((b) => b.id === id)
      return Promise.resolve(found ? [{ block_type: found.block_type }] : [])
    }

    if (/SELECT show_when FROM card_block WHERE id/.test(text)) {
      const id = values[0] as string
      const found = state.blocks.find((b) => b.id === id)
      return Promise.resolve(found ? [{ show_when: found.show_when }] : [])
    }

    if (/UPDATE card_block\s+SET content/.test(text)) {
      const [content, options, blockId] = values as [string | null, unknown, string]
      const found = state.blocks.find((b) => b.id === blockId)
      if (found) { found.content = content; found.options = options }
      return Promise.resolve([])
    }

    if (/UPDATE card SET has_sample_text/.test(text)) return Promise.resolve([])

    if (/INSERT INTO card_block/.test(text)) {
      const [, blockType, sortOrder] = values as [string, string, number]
      state.blocks.push({
        id: `new-${state.blocks.length}`, block_type: blockType, sort_order: sortOrder,
        content: null, options: null, show_when: null,
      })
      return Promise.resolve([])
    }

    if (/DELETE FROM card_block WHERE id/.test(text)) {
      const id = values[0] as string
      state.blocks = state.blocks.filter((b) => b.id !== id)
      return Promise.resolve([])
    }

    if (/SELECT id FROM card_block WHERE card_id = .* ORDER BY sort_order`$/.test(text)
      || /SELECT id FROM card_block WHERE card_id/.test(text)) {
      return Promise.resolve(
        [...state.blocks].sort((a, b) => a.sort_order - b.sort_order).map((b) => ({ id: b.id })),
      )
    }

    if (/UPDATE card_block SET sort_order/.test(text)) {
      const [newOrder, blockId] = values as [number, string]
      const found = state.blocks.find((b) => b.id === blockId)
      if (found) found.sort_order = newOrder
      return Promise.resolve([])
    }

    if (/UPDATE card_block SET show_when/.test(text)) {
      const [showWhen, blockId] = values as [unknown[] | null, string]
      const found = state.blocks.find((b) => b.id === blockId)
      if (found) found.show_when = showWhen
      return Promise.resolve([])
    }

    return Promise.resolve([])
  }

  const instance: FakeSql = Object.assign(runner, {
    json: (value: unknown) => value,
    begin: async (run: (tx: FakeSql) => unknown) => run(instance),
  })
  return instance
}

let sql: FakeSql = makeSql()

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => { state.revalidated.push(path) } }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined),
  }),
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const {
  saveBlockContent, addBlock, deleteBlock, reorderBlocks, moveBlock,
  addShowWhenCondition, removeShowWhenCondition,
} = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const titleBlock = (over: Partial<BlockRow> = {}): BlockRow => ({
  id: 'b1', block_type: 'title', sort_order: 0, content: 'เดิม', options: null, show_when: null,
  ...over,
})

beforeEach(() => {
  sql = makeSql()
  state.cookie = undefined
  state.user = undefined
  state.cardExists = true
  state.blocks = [titleBlock()]
  state.statements = []
  state.revalidated = []
})

describe('saveBlockContent · สิทธิ์', () => {
  it('ยังไม่เข้าระบบ เขียนอะไรไม่ได้เลย', async () => {
    await expect(saveBlockContent('c1', 'card-1', 'b1', form({ content: 'ใหม่' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('ผู้ดูรายงานแก้ไม่ได้', async () => {
    signedInAs('reporter')
    await expect(saveBlockContent('c1', 'card-1', 'b1', form({ content: 'ใหม่' })))
      .rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('ผู้ตั้งค่าแก้ได้ทุกชนิดรวมถึงปุ่ม', async () => {
    signedInAs('configurator')
    state.blocks = [{ id: 'b1', block_type: 'button', sort_order: 0, content: '', options: null, show_when: null }]
    await saveBlockContent('c1', 'card-1', 'b1', form({
      content: 'กด', action_kind: 'uri', action_target: 'https://x.test',
    }))
    expect(writes().some((w) => /UPDATE card_block/.test(w.text))).toBe(true)
  })

  it('ผู้ดูแลเนื้อหาแก้ title ได้', async () => {
    signedInAs('content_editor')
    await saveBlockContent('c1', 'card-1', 'b1', form({ content: 'ใหม่' }))
    expect(writes().some((w) => /UPDATE card_block/.test(w.text))).toBe(true)
  })

  it('ผู้ดูแลเนื้อหาแก้ปุ่มไม่ได้ (Permission Matrix)', async () => {
    signedInAs('content_editor')
    state.blocks = [{ id: 'b1', block_type: 'button', sort_order: 0, content: '', options: null, show_when: null }]
    await expect(
      saveBlockContent('c1', 'card-1', 'b1', form({ content: 'กด', action_kind: 'uri', action_target: 'x' })),
    ).rejects.toThrow('ผู้ดูแลเนื้อหา')
    expect(writes()).toEqual([])
  })
})

describe('saveBlockContent · BR-37 ล้างธง has_sample_text ทุกครั้งที่บันทึกสำเร็จ', () => {
  it('บันทึกสำเร็จ → เขียน has_sample_text = false เสมอ', async () => {
    signedInAs('configurator')
    await saveBlockContent('c1', 'card-1', 'b1', form({ content: 'ข้อความจริง' }))
    const flagWrite = writes().find((w) => /UPDATE card SET has_sample_text/.test(w.text))
    expect(flagWrite).toBeDefined()
    expect(flagWrite?.text).toContain('has_sample_text = false')
    expect(flagWrite?.values).toEqual(['card-1'])
  })

  it('บันทึกไม่สำเร็จ (validation พัง) → ไม่แตะ has_sample_text เลย', async () => {
    signedInAs('configurator')
    state.blocks = [{ id: 'b1', block_type: 'image', sort_order: 0, content: '', options: null, show_when: null }]
    await expect(saveBlockContent('c1', 'card-1', 'b1', form({ content: '  ' })))
      .rejects.toThrow('URL ของภาพ')
    expect(writes()).toEqual([])
  })

  it('ไม่พบบล็อกนี้ในการ์ดนี้ → ปฏิเสธก่อนแตะอะไร', async () => {
    signedInAs('configurator')
    await expect(saveBlockContent('c1', 'card-1', 'ghost', form({ content: 'x' })))
      .rejects.toThrow('ไม่พบบล็อกนี้')
    expect(writes()).toEqual([])
  })
})

describe('addBlock', () => {
  it('ผู้ดูแลเนื้อหาเพิ่มบล็อกไม่ได้ (โครงสร้างของการ์ด)', async () => {
    signedInAs('content_editor')
    await expect(addBlock('c1', 'card-1', form({ block_type: 'body' }))).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writes()).toEqual([])
  })

  it('ปฏิเสธชนิดที่วาดไม่ได้ แม้ยิงตรงเข้ามา (กันบล็อกที่ผู้เล่นไม่เห็นอะไร)', async () => {
    signedInAs('configurator')
    await expect(addBlock('c1', 'card-1', form({ block_type: 'stamp_grid' })))
      .rejects.toThrow('ยังเพิ่มบล็อกชนิด')
    expect(writes()).toEqual([])
  })

  it('ครบ 10 บล็อกแล้วเพิ่มไม่ได้ (BR-66)', async () => {
    signedInAs('configurator')
    state.blocks = Array.from({ length: 10 }, (_, i) => titleBlock({ id: `b${i}`, sort_order: i }))
    await expect(addBlock('c1', 'card-1', form({ block_type: 'body' }))).rejects.toThrow('10')
    expect(writes()).toEqual([])
  })

  it('ครบ 3 ปุ่มแล้วเพิ่มปุ่มไม่ได้ แต่เพิ่มบล็อกอื่นได้ (BR-66)', async () => {
    signedInAs('configurator')
    state.blocks = Array.from({ length: 3 }, (_, i) =>
      ({ id: `btn${i}`, block_type: 'button', sort_order: i, content: null, options: null, show_when: null }))
    await expect(addBlock('c1', 'card-1', form({ block_type: 'button' }))).rejects.toThrow('ปุ่ม')
    await addBlock('c1', 'card-1', form({ block_type: 'body' }))
    expect(writes().some((w) => /INSERT INTO card_block/.test(w.text))).toBe(true)
  })

  it('เพิ่มต่อท้ายด้วย sort_order เท่ากับจำนวนบล็อกปัจจุบัน', async () => {
    signedInAs('configurator')
    state.blocks = [titleBlock({ id: 'b1', sort_order: 0 }), titleBlock({ id: 'b2', sort_order: 1 })]
    await addBlock('c1', 'card-1', form({ block_type: 'divider' }))
    const insert = writes().find((w) => /INSERT INTO card_block/.test(w.text))
    expect(insert?.values).toContain(2)
  })
})

describe('reorderBlocks', () => {
  beforeEach(() => {
    state.blocks = [
      titleBlock({ id: 'b1', sort_order: 0 }),
      titleBlock({ id: 'b2', sort_order: 1 }),
      titleBlock({ id: 'b3', sort_order: 2 }),
    ]
  })

  it('ผู้ดูแลเนื้อหาลากเรียงไม่ได้', async () => {
    signedInAs('content_editor')
    await expect(reorderBlocks('c1', 'card-1', ['b3', 'b1', 'b2'])).rejects.toThrow('ไม่มีสิทธิ์')
  })

  it('สลับที่ของบล็อกที่มีอยู่จริงทั้งหมด → เขียน sort_order ใหม่', async () => {
    signedInAs('configurator')
    await reorderBlocks('c1', 'card-1', ['b3', 'b1', 'b2'])
    expect(state.blocks.find((b) => b.id === 'b3')?.sort_order).toBe(0)
    expect(state.blocks.find((b) => b.id === 'b1')?.sort_order).toBe(1)
    expect(state.blocks.find((b) => b.id === 'b2')?.sort_order).toBe(2)
  })

  it('ปฏิเสธ id ที่ไม่มีอยู่จริงในการ์ดนี้ — ไม่เชื่อ client เฉยๆ', async () => {
    signedInAs('configurator')
    await expect(reorderBlocks('c1', 'card-1', ['b1', 'b2', 'ghost'])).rejects.toThrow('ไม่ตรงกับบล็อก')
    expect(writes()).toEqual([])
  })

  it('ปฏิเสธลำดับที่จำนวนไม่ตรง', async () => {
    signedInAs('configurator')
    await expect(reorderBlocks('c1', 'card-1', ['b1', 'b2'])).rejects.toThrow('ไม่ตรงกับบล็อก')
    expect(writes()).toEqual([])
  })

  it('ปฏิเสธ id ซ้ำ', async () => {
    signedInAs('configurator')
    await expect(reorderBlocks('c1', 'card-1', ['b1', 'b1', 'b3'])).rejects.toThrow('ไม่ตรงกับบล็อก')
    expect(writes()).toEqual([])
  })
})

describe('moveBlock', () => {
  beforeEach(() => {
    state.blocks = [
      titleBlock({ id: 'b1', sort_order: 0 }),
      titleBlock({ id: 'b2', sort_order: 1 }),
      titleBlock({ id: 'b3', sort_order: 2 }),
    ]
  })

  it('ย้ายขึ้นสลับกับตัวก่อนหน้า', async () => {
    signedInAs('configurator')
    await moveBlock('c1', 'card-1', 'b2', 'up')
    expect(state.blocks.find((b) => b.id === 'b2')?.sort_order).toBe(0)
    expect(state.blocks.find((b) => b.id === 'b1')?.sort_order).toBe(1)
  })

  it('แถวแรกย้ายขึ้นไม่ได้ — ไม่ทำอะไรเลย ไม่ error', async () => {
    signedInAs('configurator')
    await moveBlock('c1', 'card-1', 'b1', 'up')
    expect(writes().some((w) => /UPDATE card_block SET sort_order/.test(w.text))).toBe(false)
    expect(state.blocks.map((b) => b.sort_order)).toEqual([0, 1, 2])
  })

  it('แถวสุดท้ายย้ายลงไม่ได้ — ไม่ทำอะไรเลย', async () => {
    signedInAs('configurator')
    await moveBlock('c1', 'card-1', 'b3', 'down')
    expect(writes().some((w) => /UPDATE card_block SET sort_order/.test(w.text))).toBe(false)
  })
})

describe('addShowWhenCondition / removeShowWhenCondition', () => {
  it('ผู้ดูแลเนื้อหาเพิ่มเงื่อนไขไม่ได้ (กระทบทางเดินของแคมเปญ)', async () => {
    signedInAs('content_editor')
    await expect(
      addShowWhenCondition('c1', 'card-1', 'b1', form({ type: 'not_has_attribute', key: 'x' })),
    ).rejects.toThrow('ไม่มีสิทธิ์')
  })

  it('เพิ่มเงื่อนไขที่ถูกต้อง → ต่อท้าย show_when', async () => {
    signedInAs('configurator')
    await addShowWhenCondition('c1', 'card-1', 'b1', form({ type: 'not_has_attribute', key: 'seen' }))
    expect(state.blocks[0].show_when).toEqual([{ type: 'not_has_attribute', key: 'seen' }])
  })

  it('ช่องบังคับว่าง → ปฏิเสธก่อนเขียน', async () => {
    signedInAs('configurator')
    await expect(
      addShowWhenCondition('c1', 'card-1', 'b1', form({ type: 'not_has_attribute', key: '' })),
    ).rejects.toThrow('ต้องกรอก')
    expect(writes()).toEqual([])
  })

  it('เอาเงื่อนไขออกตาม index', async () => {
    signedInAs('configurator')
    state.blocks[0].show_when = [
      { type: 'not_has_attribute', key: 'a' },
      { type: 'not_has_attribute', key: 'b' },
    ]
    await removeShowWhenCondition('c1', 'card-1', 'b1', 0)
    expect(state.blocks[0].show_when).toEqual([{ type: 'not_has_attribute', key: 'b' }])
  })
})

describe('ตรวจการ์ดอยู่ในแคมเปญที่อ้าง — กัน IDOR', () => {
  it('การ์ดไม่ได้อยู่ในแคมเปญนี้ ทุก action ปฏิเสธ', async () => {
    signedInAs('configurator')
    state.cardExists = false
    await expect(saveBlockContent('c1', 'card-1', 'b1', form({ content: 'x' })))
      .rejects.toThrow('ไม่พบการ์ดนี้')
    await expect(addBlock('c1', 'card-1', form({ block_type: 'body' })))
      .rejects.toThrow('ไม่พบการ์ดนี้')
    await expect(reorderBlocks('c1', 'card-1', [])).rejects.toThrow('ไม่พบการ์ดนี้')
  })
})
