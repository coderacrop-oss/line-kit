import { createCanvas } from '@napi-rs/canvas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Composition } from '@/lib/richmenu/composition'
import { MENU_CANVAS } from '@/lib/richmenu/layouts'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  /** id → { campaignId, storagePath } · คลังภาพปลอมสำหรับด่านตรวจความเป็นเจ้าของและตอน flatten */
  assets: Record<string, { campaignId: string; storagePath: string }>
  /** id → campaignId · เมนูปลอมสำหรับด่านตรวจของ setMenuImage/upsertComposition */
  richMenus: Record<string, string>
  stored: Record<string, Uint8Array>
  writes: Array<{ text: string; values: unknown[] }>
} = { cookie: undefined, user: undefined, assets: {}, richMenus: {}, stored: {}, writes: [] }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM rich_menu WHERE/.test(text)) {
        const id = String(values[0])
        const campaignId = String(values[1])
        return Promise.resolve(state.richMenus[id] === campaignId ? [{ id }] : [])
      }
      if (/^SELECT id, storage_path FROM asset/.test(text)) {
        const ids = values[0] as string[]
        const campaignId = String(values[1])
        const rows = ids
          .filter((id) => state.assets[id]?.campaignId === campaignId)
          .map((id) => ({ id, storage_path: state.assets[id].storagePath }))
        return Promise.resolve(rows)
      }
      if (/^SELECT id FROM asset/.test(text)) {
        const ids = values[0] as string[]
        const campaignId = String(values[1])
        const rows = ids.filter((id) => state.assets[id]?.campaignId === campaignId).map((id) => ({ id }))
        return Promise.resolve(rows)
      }
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    if (/INSERT INTO asset/.test(text)) return Promise.resolve([{ id: 'new-asset' }])
    return Promise.resolve([])
  },
  { array: (value: unknown) => value, json: (value: unknown) => value },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined),
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
        state.stored[path] = data
        return { storagePath: path, publicUrl: `/${path}` }
      },
      get: async (path: string) => {
        const data = state.stored[path]
        if (!data) throw new Error(`ไม่พบไฟล์ที่ ${path}`)
        return data
      },
    }),
  }
})

const { applyComposition, saveComposition, uploadLayerImage } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const realJpeg = async (width: number, height: number, color = '#3366cc'): Promise<Uint8Array> => {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 90))
}

const fileFrom = (name: string, bytes: Uint8Array, type = 'image/jpeg'): File => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new File([copy], name, { type })
}

const composition = (patch: Partial<Composition> = {}): Composition => ({
  canvasWidth: MENU_CANVAS.large.width,
  canvasHeight: MENU_CANVAS.large.height,
  background: { type: 'color', color: '#FFFFFF' },
  layers: [],
  ...patch,
})

const writesMatching = (pattern: RegExp) => state.writes.filter((w) => pattern.test(w.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.assets = {}
  state.richMenus = { 'menu-1': 'c1' }
  state.stored = {}
  state.writes = []
})

describe('uploadLayerImage · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ อัปโหลดไม่ได้', async () => {
    const form = new FormData()
    form.append('file', fileFrom('a.jpg', await realJpeg(100, 100)))
    await expect(uploadLayerImage('c1', form)).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
  })

  it('ผู้ดูรายงานอัปโหลดไม่ได้', async () => {
    signedInAs('reporter')
    const form = new FormData()
    form.append('file', fileFrom('a.jpg', await realJpeg(100, 100)))
    await expect(uploadLayerImage('c1', form)).rejects.toThrow('ไม่มีสิทธิ์')
  })
})

describe('uploadLayerImage · อัปโหลด', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ไม่มีไฟล์ ปฏิเสธ', async () => {
    await expect(uploadLayerImage('c1', new FormData())).rejects.toThrow('ยังไม่ได้เลือกไฟล์')
  })

  it('เก็บภาพที่ขนาดต้นฉบับตรงๆ ไม่ตัด/ย่อให้เต็มผืนเมนู (ต่างจาก storeMenuImage ของ M4-S01)', async () => {
    const form = new FormData()
    form.append('file', fileFrom('a.jpg', await realJpeg(640, 480)))
    const result = await uploadLayerImage('c1', form)
    expect(result.width).toBe(640)
    expect(result.height).toBe(480)

    const insert = writesMatching(/INSERT INTO asset/)[0]
    expect(insert.values).toContain(640)
    expect(insert.values).toContain(480)
  })

  it('ไฟล์ที่ไม่ใช่ภาพจริง ถูกปฏิเสธโดย probeImage', async () => {
    const form = new FormData()
    form.append('file', fileFrom('a.jpg', new Uint8Array([1, 2, 3, 4])))
    await expect(uploadLayerImage('c1', form)).rejects.toThrow()
  })
})

describe('saveComposition', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รูปร่างไม่ถูกต้อง ปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    await expect(saveComposition('c1', 'menu-1', { not: 'valid' })).rejects.toThrow()
    expect(writesMatching(/INSERT INTO rich_menu_composition/)).toEqual([])
  })

  it('ชั้นภาพอ้างถึง asset ที่ไม่ใช่ของแคมเปญนี้ ปฏิเสธ', async () => {
    state.assets['asset-1'] = { campaignId: 'other-campaign', storagePath: 'x' }
    const c = composition({ layers: [{ id: 'l1', type: 'image', assetId: 'asset-1', fit: 'cover', x: 0, y: 0, width: 100, height: 100 }] })
    await expect(saveComposition('c1', 'menu-1', c)).rejects.toThrow('ไม่ได้อยู่ในคลังของแคมเปญนี้')
  })

  it('งานแต่งภาพที่ถูกต้อง — บันทึกสำเร็จ', async () => {
    state.assets['asset-1'] = { campaignId: 'c1', storagePath: 'uploads/c1/a.jpg' }
    const c = composition({ layers: [{ id: 'l1', type: 'image', assetId: 'asset-1', fit: 'cover', x: 0, y: 0, width: 100, height: 100 }] })
    await saveComposition('c1', 'menu-1', c)
    expect(writesMatching(/INSERT INTO rich_menu_composition/)).toHaveLength(1)
  })

  it('เมนูที่ไม่มีอยู่จริง หรือของแคมเปญอื่น ปฏิเสธ ไม่เขียนอะไรเลย', async () => {
    await expect(saveComposition('other-campaign', 'menu-1', composition())).rejects.toThrow('ไม่พบเมนูนี้')
    expect(writesMatching(/INSERT INTO rich_menu_composition/)).toEqual([])
  })
})

describe('applyComposition', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รวมภาพทุกชั้นเป็นไฟล์เดียว บันทึกเป็น asset ใหม่ แล้วตั้งเป็นภาพของเมนู', async () => {
    state.stored['uploads/c1/layer.jpg'] = await realJpeg(300, 300, '#CC3333')
    state.assets['asset-1'] = { campaignId: 'c1', storagePath: 'uploads/c1/layer.jpg' }
    const c = composition({ layers: [{ id: 'l1', type: 'image', assetId: 'asset-1', fit: 'cover', x: 0, y: 0, width: 300, height: 300 }] })

    const result = await applyComposition('c1', 'menu-1', c)
    expect(result.id).toBe('new-asset')

    expect(writesMatching(/INSERT INTO rich_menu_composition/)).toHaveLength(1)
    const assetInsert = writesMatching(/INSERT INTO asset/)[0]
    expect(assetInsert.values).toContain(2500)
    expect(assetInsert.values).toContain(1686)
    expect(writesMatching(/UPDATE rich_menu SET image_asset_id/)).toHaveLength(1)
  })

  it('ไม่มีชั้นเลย (พื้นหลังล้วน) ก็ยัง apply ได้ ไม่ต้องมีภาพอย่างน้อยหนึ่งชั้น', async () => {
    const result = await applyComposition('c1', 'menu-1', composition())
    expect(result.id).toBe('new-asset')
  })

  it('รูปร่างไม่ถูกต้อง ปฏิเสธก่อนแตะฐานข้อมูลเลย', async () => {
    await expect(applyComposition('c1', 'menu-1', { bad: true })).rejects.toThrow()
    expect(writesMatching(/INSERT INTO rich_menu_composition/)).toEqual([])
    expect(writesMatching(/UPDATE rich_menu SET image_asset_id/)).toEqual([])
  })

  it('ชั้นภาพอ้างถึง asset นอกแคมเปญ ปฏิเสธก่อนจะไป flatten', async () => {
    state.assets['asset-1'] = { campaignId: 'other-campaign', storagePath: 'x' }
    const c = composition({ layers: [{ id: 'l1', type: 'image', assetId: 'asset-1', fit: 'cover', x: 0, y: 0, width: 100, height: 100 }] })
    await expect(applyComposition('c1', 'menu-1', c)).rejects.toThrow('ไม่ได้อยู่ในคลังของแคมเปญนี้')
    expect(writesMatching(/UPDATE rich_menu SET image_asset_id/)).toEqual([])
  })
})
