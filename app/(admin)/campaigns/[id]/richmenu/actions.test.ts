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
   *
   * ใช้เฉพาะเส้นทาง "ไม่ได้อัปโหลดไฟล์ใหม่ ยังใช้ภาพเดิม" ของ saveMenu — เส้นทาง
   * อัปโหลดใหม่ (createMenu เสมอ, saveMenu เมื่อมีไฟล์) ไม่แตะตารางนี้เลย เพราะ
   * ขนาดถูกวัดจากไบต์ไฟล์ตรงๆ ก่อนจะมีแถว asset ด้วยซ้ำ
   */
  assets: Record<string, { width: number; height: number }>
  /** areas ปัจจุบันของเมนูที่ setAreaTarget/setLayout จะอ่านก่อนเขียน */
  areas: Array<{ x: number; y: number; width: number; height: number; kind: string; target: string | null }>
  failWith: unknown
  writes: Array<{ text: string; values: unknown[] }>
  stored: Array<{ path: string; bytes: number }>
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
  stored: [],
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
    if (/INSERT INTO asset/.test(text)) {
      return state.failWith ? Promise.reject(state.failWith) : Promise.resolve([{ id: 'new-asset' }])
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
vi.mock('@/lib/assets/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/assets/store')>()
  return {
    ...real,
    assetStore: () => ({
      describe: 'ที่เก็บของเทสต์',
      put: async (path: string, data: Uint8Array) => {
        state.stored.push({ path, bytes: data.byteLength })
        return { storagePath: path, publicUrl: `/${path}` }
      },
    }),
  }
})

const { changeLayout, createMenu, deleteMenu, saveMenu, setEntry } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

/** PNG จริงขนาดที่กำหนด · ส่วนหัวพอให้ probeImage อ่านมิติออก แล้วถ่วงให้ยาวพอผ่านเพดานไฟล์ */
const pngFile = (name: string, width: number, height: number, bytes = 40_000): File => {
  const head = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
    (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255,
    8, 6, 0, 0, 0,
  ]
  const data = new Uint8Array(Math.max(bytes, head.length))
  data.set(head)
  return new File([data], name, { type: 'image/png' })
}

/** ภาพเมนูขนาดถูกต้องพอดี — ค่าเริ่มต้นของทุกฟอร์มที่ไม่ได้ตั้งใจทดสอบเรื่องขนาด */
const goodImage = () => pngFile('menu.png', 2500, 1686)

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

/** ฟอร์มของ "+ สร้างเมนูแรก" — ไม่มี select ให้เลือกจากคลังอีกต่อไป มีแต่ไฟล์ */
const createForm = (
  patch: Record<string, string> = {},
  imageFile: File | null | undefined = goodImage(),
) => {
  const data = form({ alias: 'main', layout: 'one', ...patch })
  if (imageFile) data.append('image_file', imageFile)
  return data
}

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
  state.stored = []
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

  it('ไม่ได้อัปโหลดภาพ ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({}, null))).rejects.toThrow('อัปโหลดภาพเมนู')
    expect(writesMatching(/INSERT INTO rich_menu|INSERT INTO asset/)).toEqual([])
  })

  /**
   * L2 §5.2 (v0.16) — "ต้องตรวจตั้งแต่ตอนอัปโหลดในหน้า M4-S01 ไม่ใช่ปล่อยให้ LINE
   * ปฏิเสธตอน publish" — ภาพผิดขนาดจึงบล็อกตั้งแต่ตอนอัปโหลด (ก่อนจะมีแถว asset
   * ด้วยซ้ำ) ต่างจากช่องที่ไม่ชี้ไปไหน (BR-01) ซึ่งบันทึกได้ก่อนแล้วไปบล็อกตอน
   * publish (ตัดสินใจข้อ 2 ของงานนี้)
   */
  it('ภาพขนาดไม่ใช่ 2500×1686 พอดี ถูกบล็อกตอนอัปโหลด (ERR-037) — ไม่ใช่ปล่อยผ่านไปบล็อกตอน publish', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({}, pngFile('x.png', 1200, 400))))
      .rejects.toThrow('ERR-037')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
    // ภาพผิดขนาดไม่ควรถูกเก็บลงคลังเลยด้วยซ้ำ — ตรวจก่อนอัปโหลดจริง ไม่ใช่หลัง
    expect(writesMatching(/INSERT INTO asset/)).toEqual([])
    expect(state.stored).toEqual([])
  })

  it('ผังไม่ถูกต้อง ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    await expect(createMenu('c1', createForm({ layout: 'nine' })))
      .rejects.toThrow('ผังช่องไม่ถูกต้อง')
    expect(writesMatching(/INSERT INTO rich_menu/)).toEqual([])
  })

  it('กรอกครบทุกช่อง สร้างเมนูสำเร็จ — ภาพที่อัปโหลดกลายเป็นแถว asset ใหม่ ผูกกับเมนูทันที', async () => {
    signedInAs('configurator')
    await createMenu('c1', createForm())

    expect(writesMatching(/INSERT INTO asset/)).toHaveLength(1)
    expect(state.stored).toHaveLength(1)

    const insert = writesMatching(/INSERT INTO rich_menu/)[0]
    expect(insert.values).toContain('c1')
    expect(insert.values).toContain('main')
    expect(insert.values).toContain('new-asset')
  })
})

describe('saveMenu · ภาพ', () => {
  const withOneArea = () => {
    state.areas = [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }]
  }

  it('ไม่ได้เลือกไฟล์ใหม่ — ใช้ภาพเดิมต่อ (จากช่องซ่อนที่จอฝังค่าปัจจุบันไว้) ไม่อัปโหลดอะไรเพิ่ม', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1', area_target_0: '',
    })
    await saveMenu('c1', 'menu-1', data)

    expect(writesMatching(/INSERT INTO asset/)).toEqual([])
    expect(writesMatching(/UPDATE rich_menu SET/)[0].values).toContain('asset-good')
  })

  /**
   * `<input type="file">` ที่ไม่ได้ถูกแตะเลยยังส่ง File มาด้วย — name ว่าง ขนาด
   * ศูนย์ไบต์ ไม่ใช่ null · ต้องอ่านเป็น "ไม่ได้เลือกไฟล์ใหม่" เหมือนกัน ไม่งั้น
   * ทุกครั้งที่กด "บันทึกเมนู" โดยไม่ได้ตั้งใจแตะไฟล์จะพยายามอัปโหลดไฟล์เปล่า
   */
  it('input ไฟล์ที่ไม่ได้แตะ (File ว่างขนาดศูนย์) ก็ยังนับว่าไม่ได้เลือกไฟล์ใหม่', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1', area_target_0: '',
    })
    data.append('image_file', new File([], '', { type: 'application/octet-stream' }))
    await saveMenu('c1', 'menu-1', data)

    expect(writesMatching(/INSERT INTO asset/)).toEqual([])
    expect(writesMatching(/UPDATE rich_menu SET/)[0].values).toContain('asset-good')
  })

  it('เลือกไฟล์ใหม่ — อัปโหลดแล้วแทนที่ภาพเดิมทันที ไม่ต้องพึ่งช่องซ่อน', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({ alias: 'main', area_count: '1', area_target_0: '' })
    data.append('image_file', goodImage())
    await saveMenu('c1', 'menu-1', data)

    expect(writesMatching(/INSERT INTO asset/)).toHaveLength(1)
    expect(writesMatching(/UPDATE rich_menu SET/)[0].values).toContain('new-asset')
  })

  it('ไฟล์ใหม่ขนาดผิด บล็อกตอนอัปโหลด (ERR-037) เหมือนตอนสร้าง', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({ alias: 'main', area_count: '1', area_target_0: '' })
    data.append('image_file', pngFile('x.png', 1200, 400))
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('ERR-037')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
    expect(writesMatching(/INSERT INTO asset/)).toEqual([])
  })

  it('ไม่มีไฟล์ใหม่และภาพเดิม (จากช่องซ่อน) ขนาดผิด บล็อกก่อนแตะฐานข้อมูล', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-bad', area_count: '1', area_target_0: '',
    })
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('ERR-037')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
  })

  /**
   * ภาพเดิม (จากช่องซ่อน) อ้างถึง id ที่ไม่มีอยู่จริง — ปฏิเสธ ไม่ใช่ปล่อยให้เขียน
   * NULL หรือค่าลอยๆ ลงคอลัมน์ NOT NULL
   */
  it('ภาพเดิมที่อ้างถึงไม่มีอยู่ในคลังของแคมเปญนี้ ปฏิเสธ', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'ghost', area_count: '1', area_target_0: '',
    })
    await expect(saveMenu('c1', 'menu-1', data)).rejects.toThrow('ไม่พบภาพนี้')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
  })

  /**
   * ภาพเดิมมีอยู่จริงแต่เป็นของ "อีกแคมเปญหนึ่ง" — ต้องปฏิเสธเหมือนไม่มีภาพเลย
   * `assertExistingImageValid` ต้องผูก `campaign_id` เข้ากับคิวรีด้วยเสมอ ไม่ใช่แค่
   * หา asset จาก id เพียงอย่างเดียว ไม่งั้นแคมเปญหนึ่งจะเอาภาพของอีกแคมเปญมาผูกกับ
   * เมนูของตัวเองได้ (คลังภาพผูกกับแคมเปญเดียวตาม lib/db/assets.ts)
   */
  it('ภาพเดิมมีอยู่จริงแต่เป็นของแคมเปญอื่น ปฏิเสธเหมือนไม่มีภาพเลย', async () => {
    signedInAs('configurator')
    withOneArea()
    const data = form({
      alias: 'main', image_asset_id: 'asset-good', area_count: '1', area_target_0: '',
    })
    await expect(saveMenu('other-campaign', 'menu-1', data)).rejects.toThrow('ไม่พบภาพนี้')
    expect(writesMatching(/UPDATE rich_menu/)).toEqual([])
  })
})

describe('saveMenu · บันทึกช่องของเมนู', () => {
  const withOneArea = () => {
    state.areas = [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }]
  }

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
