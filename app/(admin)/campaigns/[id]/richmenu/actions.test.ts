import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  /**
   * `"campaignId:assetId"` → { width, height } · ภาพต้องอยู่ใน "คลังของแคมเปญที่
   * ระบุ" จริงๆ ไม่ใช่แค่มี id ตรงในตารางไม่ว่าจะเป็นของแคมเปญไหน — ผูกคู่กันไว้
   * เพื่อให้เทสต์จับการหลุด `AND campaign_id = ...` ออกจากคิวรีได้ (ไม่ใช่แค่จับ
   * ว่า SQL text มีคำว่า campaign_id ซึ่งจับไม่ได้ว่าค่าที่ใช้จริงถูกหรือไม่)
   */
  assets: Record<string, { width: number; height: number }>
  /** areas ปัจจุบันของเมนูที่ setAreaTarget/setLayout จะอ่านก่อนเขียน */
  areas: Array<{ x: number; y: number; width: number; height: number; kind: string; target: string | null }>
  failWith: unknown
  writes: Array<{ text: string; values: unknown[] }>
} = {
  cookie: undefined,
  user: undefined,
  assets: {
    'c1:asset-good': { width: 2500, height: 1686 },
    'c1:asset-bad': { width: 100, height: 100 },
  },
  areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }],
  failWith: undefined,
  writes: [],
}

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM asset WHERE/.test(text)) {
        const assetId = String(values[0])
        const campaignId = String(values[1])
        const key = `${campaignId}:${assetId}`
        return Promise.resolve(state.assets[key] ? [state.assets[key]] : [])
      }
      if (/SELECT areas FROM rich_menu/.test(text)) {
        return Promise.resolve([{ areas: state.areas }])
      }
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    if (/INSERT INTO rich_menu/.test(text)) {
      return state.failWith ? Promise.reject(state.failWith) : Promise.resolve([{ id: 'menu-new' }])
    }
    return state.failWith ? Promise.reject(state.failWith) : Promise.resolve([])
  },
  {
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { changeLayout, createMenu, deleteMenu, saveMenu, setEntry } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const createForm = (patch: Record<string, string> = {}) =>
  form({ alias: 'main', image_asset_id: 'asset-good', layout: 'one', ...patch })

const writesMatching = (pattern: RegExp) => state.writes.filter((w) => pattern.test(w.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.assets = {
    'c1:asset-good': { width: 2500, height: 1686 },
    'c1:asset-bad': { width: 100, height: 100 },
  }
  state.areas = [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }]
  state.failWith = undefined
  state.writes = []
})

describe('createMenu · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ สร้างเมนูไม่ได้', async () => {
    await expect(createMenu('c1', createForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('ผู้ดูรายงานสร้างเมนูไม่ได้', async () => {
    signedInAs('reporter')
    await expect(createMenu('c1', createForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('ผู้แก้เนื้อหาสร้างเมนูได้ เหมือนผู้ตั้งค่าแคมเปญ', async () => {
    signedInAs('content_editor')
    await createMenu('c1', createForm())
    expect(writesMatching(/INSERT INTO rich_menu/)).toHaveLength(1)
  })
})

describe('createMenu · กรอกครบ', () => {
  it('ไม่มีชื่อเรียก (alias) ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ alias: '  ' }))).rejects.toThrow('ชื่อเรียกเมนู')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('ไม่ได้เลือกภาพ ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ image_asset_id: '' }))).rejects.toThrow('เลือกภาพเมนู')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('ภาพที่เลือกไม่มีอยู่ในคลังของแคมเปญนี้ ปฏิเสธ', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ image_asset_id: 'ghost' })))
      .rejects.toThrow('ไม่พบภาพนี้')
  })

  /**
   * ภาพมีอยู่จริงแต่เป็นของ "อีกแคมเปญหนึ่ง" — ต้องปฏิเสธเหมือนไม่มีภาพเลย
   * `assertValidImage` ต้องผูก `campaign_id` เข้ากับคิวรีด้วยเสมอ ไม่ใช่แค่หา
   * asset จาก id เพียงอย่างเดียว ไม่งั้นแคมเปญหนึ่งจะเลือกภาพของอีกแคมเปญมาตั้ง
   * เป็นเมนูของตัวเองได้ (คลังภาพผูกกับแคมเปญเดียวตาม lib/db/assets.ts)
   */
  it('ภาพมีอยู่จริงแต่เป็นของแคมเปญอื่น ปฏิเสธเหมือนไม่มีภาพเลย', async () => {
    signedInAs('configurator')
    await expect(createMenu('other-campaign', createForm({ image_asset_id: 'asset-good' })))
      .rejects.toThrow('ไม่พบภาพนี้')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  /**
   * L2 §5.2 (v0.16) — "ต้องตรวจตั้งแต่ตอนอัปโหลดในหน้า M4-S01 ไม่ใช่ปล่อยให้ LINE
   * ปฏิเสธตอน publish" — ภาพผิดขนาดจึงบล็อกตั้งแต่ตอนบันทึก ต่างจากช่องที่ไม่ชี้
   * ไปไหน (BR-01) ซึ่งบันทึกได้ก่อนแล้วไปบล็อกตอน publish (ตัดสินใจข้อ 2 ของงานนี้)
   */
  it('ภาพขนาดไม่ใช่ 2500×1686 พอดี ถูกบล็อกตอนบันทึก (ERR-037) — ไม่ใช่ปล่อยผ่านไปบล็อกตอน publish', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ image_asset_id: 'asset-bad' })))
      .rejects.toThrow('ERR-037')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('ผังไม่ถูกต้อง ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ layout: 'nine' })))
      .rejects.toThrow('ผังช่องไม่ถูกต้อง')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('กรอกครบทุกช่อง สร้างเมนูสำเร็จ', async () => {
    signedInAs('configurator')
    await createMenu('c1', createForm())
    const insert = writesMatching(/INSERT INTO rich_menu/)[0]
    expect(insert.values).toContain('c1')
    expect(insert.values).toContain('main')
    expect(insert.values).toContain('asset-good')
  })
})

describe('saveMenu · บันทึกช่องของเมนู', () => {
  const withOneArea = () => {
    state.areas = [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }]
  }

  it('ภาพขนาดผิด บล็อกก่อนแตะฐานข้อมูล เหมือนตอนสร้าง', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({ alias: 'main', image_asset_id: 'asset-bad', area_count: '1', area_target_0: '' })
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('ERR-037')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
  })

  it('เลือก "ไปลิงก์" (url) โดยไม่กรอก URL ปฏิเสธ', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1',
      area_target_0: 'url', area_url_0: '   ',
    })
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('URL')
  })

  it('ค่า target ที่แต่งเองแบบผิดรูป (ไม่มี id ต่อท้าย) ถูกปฏิเสธ ไม่เขียนลงฐานข้อมูล', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1', area_target_0: 'activity:',
    })
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('ค่าปลายทางของช่องไม่ถูกต้อง')
    expect(writesMatching(/UPDATE rich_menu SET areas/)).toEqual([])
  })

  it('เลือก "ไปกิจกรรม" — บันทึก kind=activity พร้อม id ที่เลือก', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1',
      area_target_0: 'activity:act-1',
    })
    await saveMenu('c1', 'menu-1', data)

    const areaUpdate = writesMatching(/UPDATE rich_menu SET areas/)[0]
    const written = areaUpdate.values.find((v) => Array.isArray(v)) as Array<{ kind: string; target: string }>
    expect(written[0]).toMatchObject({ kind: 'activity', target: 'act-1' })
  })

  it('เลือก "ไปลิงก์" พร้อม URL ที่กรอก — บันทึก kind=url พร้อม URL นั้น', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1',
      area_target_0: 'url', area_url_0: 'https://example.com/promo',
    })
    await saveMenu('c1', 'menu-1', data)

    const areaUpdate = writesMatching(/UPDATE rich_menu SET areas/)[0]
    const written = areaUpdate.values.find((v) => Array.isArray(v)) as Array<{ kind: string; target: string }>
    expect(written[0]).toMatchObject({ kind: 'url', target: 'https://example.com/promo' })
  })

  it('เลือก "ไม่ชี้ไปไหน" — บันทึกได้ปกติ ไม่ถูกบล็อกตอนบันทึก (BR-01 บล็อกเฉพาะตอน publish)', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1', area_target_0: '',
    })
    await expect(saveMenu('c1', 'menu-1', data)).resolves.toBeUndefined()
    expect(writesMatching(/UPDATE rich_menu SET areas/)).toHaveLength(1)
  })
})

describe('changeLayout', () => {
  it('ผังที่ไม่รู้จัก ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(changeLayout('c1', 'menu-1', 'nine')).rejects.toThrow('ผังช่องไม่ถูกต้อง')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
  })

  it('ผังที่รู้จัก เขียน areas ใหม่', async () => {
    signedInAs('content_editor')
    await changeLayout('c1', 'menu-1', 'six')
    expect(writesMatching(/UPDATE rich_menu SET areas/)).toHaveLength(1)
  })
})

describe('setEntry · BR-78', () => {
  it('เรียกในธุรกรรมเดียว (sql.begin) — ล้างเมนูตัวเข้าเดิมก่อนตั้งใหม่', async () => {
    signedInAs('configurator')
    await setEntry('c1', 'menu-2')
    expect(writesMatching(/UPDATE rich_menu SET is_entry = false/)).toHaveLength(1)
    expect(writesMatching(/UPDATE rich_menu SET is_entry = true/)).toHaveLength(1)
  })
})

describe('deleteMenu · ผู้ตั้งค่าแคมเปญเท่านั้น', () => {
  it('ผู้แก้เนื้อหาลบไม่ได้ — สิทธิ์แคบกว่าสร้าง/แก้', async () => {
    signedInAs('content_editor')
    await expect(deleteMenu('c1', 'menu-1')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(writesMatching(/DELETE FROM rich_menu/)).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญลบได้', async () => {
    signedInAs('configurator')
    await deleteMenu('c1', 'menu-1')
    expect(writesMatching(/DELETE FROM rich_menu/)).toHaveLength(1)
  })
})
