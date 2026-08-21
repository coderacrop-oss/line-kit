import { beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaigns: string[]
  assets: string[]
  newer: Array<{ storage_path: string }>
  users: Array<{ label: string }>
  writes: Array<{ text: string; values: unknown[] }>
  stored: Array<{ path: string; bytes: number }>
  storeFails: string | undefined
  /** ให้ที่เก็บล้มตอนไฟล์ลำดับที่เท่าไหร่ · 0 คือไม่ล้ม */
  storeFailsOnCall: number
  redirectedTo: string | undefined
} = {
  cookie: undefined, user: undefined,
  campaigns: ['camp-1'], assets: ['old-asset'],
  newer: [], users: [], writes: [], stored: [],
  storeFails: undefined, storeFailsOnCall: 0, redirectedTo: undefined,
}

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM campaign /.test(text)) {
        return Promise.resolve(state.campaigns.includes(String(values[0])) ? [{ id: values[0] }] : [])
      }
      if (/SELECT id FROM asset/.test(text)) {
        return Promise.resolve(state.assets.includes(String(values[0])) ? [{ id: values[0] }] : [])
      }
      if (/SELECT storage_path FROM asset WHERE id/.test(text)) {
        return Promise.resolve(state.assets.includes(String(values[0]))
          ? [{ storage_path: `uploads/camp-1/x/${values[0]}.png` }]
          : [])
      }
      if (/WHERE replaces_asset_id/.test(text)) return Promise.resolve(state.newer)
      if (/UNION/.test(text)) return Promise.resolve(state.users)
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    // storeOne (../actions.ts) เติม RETURNING id ให้ INSERT INTO asset — ผู้เรียกใช้
    // id นี้ต่อ (uploadBlockImage ของการ์ดเอดิเตอร์บล็อกภาพ) จึงต้องมีแถวให้อ่านกลับ
    if (/INSERT INTO asset/.test(text)) return Promise.resolve([{ id: `asset-${state.writes.length}` }])
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
vi.mock('@/lib/assets/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/assets/store')>()
  return {
    ...real,
    assetStore: () => ({
      describe: 'ที่เก็บของเทสต์',
      put: async (path: string, data: Uint8Array) => {
        if (state.storeFailsOnCall > 0 && state.stored.length + 1 === state.storeFailsOnCall) {
          throw new Error('ดิสก์เต็ม')
        }
        if (state.storeFails) throw new Error(state.storeFails)
        state.stored.push({ path, bytes: data.byteLength })
        return { storagePath: path, publicUrl: `/${path}` }
      },
    }),
  }
})

const { deleteAsset, uploadAssets, storeOne } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

/** PNG จริงขนาด 1024×678 · ส่วนหัวพอให้ตัววัดอ่านออก แล้วถ่วงให้ได้ขนาดตามต้องการ */
const pngFile = (name: string, width = 1024, height = 678, bytes = 40_000): File => {
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

const gifFile = (name: string): File =>
  new File([Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 1, 1, 1])], name,
    { type: 'image/png' })

const form = (files: File[], fields: Record<string, string> = {}) => {
  const data = new FormData()
  for (const file of files) data.append('files', file)
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const inserts = () => state.writes.filter((w) => /INSERT INTO asset/.test(w.text))
const deletes = () => state.writes.filter((w) => /DELETE FROM asset/.test(w.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.campaigns = ['camp-1']
  state.assets = ['old-asset']
  state.newer = []
  state.users = []
  state.writes = []
  state.stored = []
  state.storeFails = undefined
  state.storeFailsOnCall = 0
  state.redirectedTo = undefined
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * The screen hides the form from a reporter, which is a hint. The action is the
 * door, and it is reachable by anyone who can guess its name.
 */
describe('uploadAssets · สิทธิ์', () => {
  it('ยังไม่เข้าระบบ อัปโหลดไม่ได้ และไม่มีไฟล์ไหนถูกเขียน', async () => {
    await expect(uploadAssets('camp-1', form([pngFile('a.png')])))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.stored).toEqual([])
    expect(inserts()).toEqual([])
  })

  it('อีเมลที่ไม่อยู่ในรายชื่อ อัปโหลดไม่ได้', async () => {
    state.cookie = 'stranger@example.com'
    await expect(uploadAssets('camp-1', form([pngFile('a.png')])))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.stored).toEqual([])
  })

  it('บัญชีที่ถูกถอนสิทธิ์ อัปโหลดไม่ได้แม้ยังมีแถวอยู่', async () => {
    signedInAs('configurator', false)
    await expect(uploadAssets('camp-1', form([pngFile('a.png')])))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.stored).toEqual([])
  })

  it('ผู้ดูรายงานอัปโหลดไม่ได้', async () => {
    signedInAs('reporter')
    await expect(uploadAssets('camp-1', form([pngFile('a.png')])))
      .rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.stored).toEqual([])
    expect(inserts()).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาอัปโหลดได้ · ภาพเป็นเนื้อหา ไม่ใช่กติกา', async () => {
    signedInAs('content_editor')
    await uploadAssets('camp-1', form([pngFile('a.png')]))
    expect(inserts()).toHaveLength(1)
  })

  it('ผู้ตั้งค่าแคมเปญอัปโหลดได้', async () => {
    signedInAs('configurator')
    await uploadAssets('camp-1', form([pngFile('a.png')]))
    expect(inserts()).toHaveLength(1)
  })
})

describe('deleteAsset · สิทธิ์', () => {
  it('ยังไม่เข้าระบบ ลบไม่ได้', async () => {
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(deletes()).toEqual([])
  })

  it('ผู้ดูรายงานลบไม่ได้', async () => {
    signedInAs('reporter')
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(deletes()).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาลบไม่ได้ · เพิ่มภาพได้ แต่เอาของที่คนอื่นอาจใช้อยู่ออกไม่ได้', async () => {
    signedInAs('content_editor')
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(deletes()).toEqual([])
  })

  it('บัญชีที่ถูกถอนสิทธิ์ลบไม่ได้', async () => {
    signedInAs('configurator', false)
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(deletes()).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญลบภาพที่ไม่มีใครใช้ได้', async () => {
    signedInAs('configurator')
    await deleteAsset('camp-1', 'old-asset')
    expect(deletes()).toHaveLength(1)
  })
})

describe('uploadAssets · แคมเปญและไฟล์ที่รับ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('แคมเปญที่ไม่มีอยู่ ไม่มีอะไรถูกเขียน', async () => {
    await expect(uploadAssets('camp-ไม่มี', form([pngFile('a.png')])))
      .rejects.toThrow('ไม่พบแคมเปญนี้')
    expect(state.stored).toEqual([])
    expect(inserts()).toEqual([])
  })

  it('ไม่ได้เลือกไฟล์เลย บอกตรงๆ ไม่ใช่รายงานว่าอัปโหลดศูนย์ไฟล์สำเร็จ', async () => {
    await expect(uploadAssets('camp-1', form([]))).rejects.toThrow('ยังไม่ได้เลือกไฟล์')
  })

  it('ช่องไฟล์ที่ว่างเปล่าไม่นับเป็นไฟล์', async () => {
    const empty = new File([], '', { type: 'application/octet-stream' })
    await expect(uploadAssets('camp-1', form([empty]))).rejects.toThrow('ยังไม่ได้เลือกไฟล์')
  })

  it('ลากมาทั้งโฟลเดอร์ ถูกปฏิเสธก่อนเขียนไฟล์แรก', async () => {
    const many = Array.from({ length: 21 }, (_, i) => pngFile(`f${i}.png`))
    await expect(uploadAssets('camp-1', form(many))).rejects.toThrow('ไม่เกิน 20 ไฟล์')
    expect(state.stored).toEqual([])
  })

  it('ยี่สิบไฟล์พอดี ยังผ่าน', async () => {
    const many = Array.from({ length: 20 }, (_, i) => pngFile(`f${i}.png`))
    await uploadAssets('camp-1', form(many))
    expect(inserts()).toHaveLength(20)
  })
})

/**
 * ชุดหนึ่งไม่ล้มทั้งชุด · ต้นแบบเขียนไว้บนจอว่าจะทำแบบนี้
 */
describe('uploadAssets · ไฟล์ที่ผ่านกับไม่ผ่านปนกัน', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ไฟล์ที่ผ่านถูกเขียน ไฟล์ที่ไม่ผ่านถูกรายงาน', async () => {
    await uploadAssets('camp-1', form([
      pngFile('ok-1.png'), gifFile('really-a-gif.png'), pngFile('ok-2.png'),
    ]))

    expect(inserts()).toHaveLength(2)
    expect(state.stored.map((s) => s.path.split('/').pop())).toEqual(['ok-1.png', 'ok-2.png'])

    const url = new URL(state.redirectedTo as string, 'https://x')
    expect(url.searchParams.get('uploaded')).toBe('2')
    expect(url.searchParams.get('rejected')).toContain('really-a-gif.png')
  })

  it('ไฟล์ที่ใหญ่เกินเพดาน ไม่ถูกเขียนลงที่เก็บเลย', async () => {
    await uploadAssets('camp-1', form([pngFile('huge.png', 1024, 678, 2_000_000)]))
    expect(state.stored).toEqual([])
    expect(inserts()).toEqual([])
    expect(state.redirectedTo).toContain('rejected=')
  })

  it('เหตุผลที่รายงานกลับมาคือเหตุผลจริงพร้อมตัวเลข ไม่ใช่ "ไฟล์ไม่ถูกต้อง"', async () => {
    await uploadAssets('camp-1', form([pngFile('narrow.png', 400, 678)]))
    const rejected = new URL(state.redirectedTo as string, 'https://x').searchParams.get('rejected')
    expect(rejected).toContain('400')
    expect(rejected).toContain('800')
  })

  it('ทุกไฟล์ผ่าน พากลับไปที่คลัง ไม่ใช่ค้างอยู่จออัปโหลด', async () => {
    await uploadAssets('camp-1', form([pngFile('a.png')]))
    expect(state.redirectedTo).toBe('/campaigns/camp-1/assets?uploaded=1')
  })

  it('มีไฟล์ไม่ผ่าน อยู่ที่จออัปโหลดต่อ เพื่ออ่านว่าอันไหนและเพราะอะไร', async () => {
    await uploadAssets('camp-1', form([gifFile('x.png')]))
    expect(state.redirectedTo).toContain('/campaigns/camp-1/assets/upload?')
  })

  it('ขนาดที่บันทึกมาจากไบต์จริง ไม่ใช่จากที่ฟอร์มบอก', async () => {
    await uploadAssets('camp-1', form([pngFile('a.png', 1200, 900, 50_000)]))
    const [insert] = inserts()
    expect(insert.values).toContain(1200)
    expect(insert.values).toContain(900)
    expect(insert.values).toContain(50_000)
  })

  it('ไฟล์ที่อ้างว่าเป็น PNG แต่ข้างในเป็น GIF ไม่ผ่าน', async () => {
    await uploadAssets('camp-1', form([gifFile('lying.png')]))
    expect(inserts()).toEqual([])
  })

  it('PNG จริงที่เบราว์เซอร์ติดป้ายผิด ยังผ่าน และบันทึกชนิดตามไบต์จริง', async () => {
    // ป้ายชนิดของเบราว์เซอร์มาจากนามสกุล · ไฟล์ที่ถูกเปลี่ยนนามสกุลหรือมาจากระบบ
    // ที่ไม่รู้จัก .png จะติดป้ายผิด แต่ไบต์ข้างในยังเป็น PNG อยู่ดี
    const real = pngFile('a.png')
    const mislabelled = new File([await real.arrayBuffer()], 'a.png', { type: 'image/gif' })

    await uploadAssets('camp-1', form([mislabelled]))

    expect(inserts()).toHaveLength(1)
    expect(inserts()[0].values).toContain('image/png')
    expect(inserts()[0].values).not.toContain('image/gif')
  })

  it('ไฟล์ที่ไม่มีป้ายชนิดเลย ยังผ่านถ้าไบต์ข้างในถูกต้อง', async () => {
    const real = pngFile('a.png')
    const bare = new File([await real.arrayBuffer()], 'a.png')

    await uploadAssets('camp-1', form([bare]))
    expect(inserts()).toHaveLength(1)
  })
})

/**
 * BR-25 · อัปโหลดทับสร้างแถวใหม่ชี้กลับของเดิม และไม่ลบของเดิม
 */
describe('uploadAssets · โหมดแทนที่', () => {
  beforeEach(() => signedInAs('configurator'))

  it('โหมดปกติ ไม่ผูกกับภาพเดิมใคร', async () => {
    await uploadAssets('camp-1', form([pngFile('a.png')], { mode: 'new' }))
    expect(inserts()[0].values).toContain(null)
    expect(deletes()).toEqual([])
  })

  it('โหมดแทนที่ เขียน replaces_asset_id ชี้กลับไปที่ภาพเดิม', async () => {
    await uploadAssets('camp-1', form([pngFile('new.png')], {
      mode: 'replace', replace_id: 'old-asset',
    }))
    const [insert] = inserts()
    expect(insert.text).toContain('replaces_asset_id')
    expect(insert.values).toContain('old-asset')
  })

  it('โหมดแทนที่ไม่ลบแถวเดิมและไม่แตะไฟล์เดิม (BR-25)', async () => {
    await uploadAssets('camp-1', form([pngFile('new.png')], {
      mode: 'replace', replace_id: 'old-asset',
    }))
    expect(deletes()).toEqual([])
    expect(state.writes.filter((w) => /UPDATE asset/.test(w.text))).toEqual([])
    expect(state.stored.map((s) => s.path)).not.toContain('uploads/camp-1/x/old-asset.png')
  })

  it('โหมดแทนที่โดยไม่เลือกภาพเดิม ถูกปฏิเสธก่อนเขียนอะไร', async () => {
    await expect(uploadAssets('camp-1', form([pngFile('a.png')], { mode: 'replace' })))
      .rejects.toThrow('เลือกภาพเดิม')
    expect(state.stored).toEqual([])
  })

  it('ภาพเดิมที่อยู่แคมเปญอื่น ถูกปฏิเสธ · id ในฟอร์มเป็นของที่ผู้ส่งแก้เองได้', async () => {
    await expect(uploadAssets('camp-1', form([pngFile('a.png')], {
      mode: 'replace', replace_id: 'asset-ของแคมเปญอื่น',
    }))).rejects.toThrow('ไม่ได้อยู่ในแคมเปญนี้')
    expect(state.stored).toEqual([])
    expect(inserts()).toEqual([])
  })

  it('แทนที่ด้วยหลายไฟล์พร้อมกัน ถูกปฏิเสธ · ภาพเดิมหนึ่งภาพมีตัวแทนได้ภาพเดียว', async () => {
    await expect(uploadAssets('camp-1', form([pngFile('a.png'), pngFile('b.png')], {
      mode: 'replace', replace_id: 'old-asset',
    }))).rejects.toThrow('ทีละไฟล์')
    expect(state.stored).toEqual([])
  })
})

/**
 * ที่เก็บล้ม = ไม่มีแถว · ไม่ใช่แถวที่ชี้ไปยังไฟล์ที่ไม่เคยถูกเขียน
 */
describe('uploadAssets · ที่เก็บเขียนไม่ได้', () => {
  beforeEach(() => signedInAs('configurator'))

  it('เขียนไฟล์ไม่ได้ ไม่มีแถวไหนถูกบันทึก และไม่รายงานว่าสำเร็จ', async () => {
    state.storeFails = 'เขียนไฟล์ลงที่เก็บไม่ได้ (EROFS)'
    await expect(uploadAssets('camp-1', form([pngFile('a.png')]))).rejects.toThrow('EROFS')
    expect(inserts()).toEqual([])
    expect(state.redirectedTo).toBeUndefined()
  })

  it('ล้มกลางชุด ไฟล์ที่ผ่านไปแล้วยังมีแถว ส่วนที่เหลือไม่ถูกอ้างว่าสำเร็จ', async () => {
    state.storeFailsOnCall = 2

    await expect(uploadAssets('camp-1', form([pngFile('a.png'), pngFile('b.png')])))
      .rejects.toThrow('ดิสก์เต็ม')

    // ไฟล์แรกลงไปแล้วจริง จึงมีแถวของมัน · แต่ไม่มีการรายงานว่าทั้งชุดสำเร็จ
    expect(inserts()).toHaveLength(1)
    expect(state.redirectedTo).toBeUndefined()
  })
})

/**
 * storeOne เอง — export ออกมาให้ uploadBlockImage ของการ์ดเอดิเตอร์บล็อกภาพ
 * (../cards/[cardId]/actions.ts) เรียกใช้ท่อไปป์ไลน์เดียวกับคลังภาพตรงๆ · ผลลัพธ์
 * เปลี่ยนจาก `Rejection | null` เป็น `{ok:true,id,url} | {ok:false,file,why}` เพื่อให้
 * ผู้เรียกเอา url ของแถวที่เพิ่งสร้างไปเติมช่อง content ต่อได้ทันที — เทสต์นี้ล็อกชนิดผล
 * ทั้งสองแบบไว้ ไม่ให้ refactor ครั้งหน้าเปลี่ยนกลับไปเป็นรูปแบบเดิมโดยไม่รู้ตัว
 */
describe('storeOne · ผลลัพธ์รูปแบบใหม่ (uploadAssets ยังทำงานเดิมทุกอย่างผ่านมันอยู่)', () => {
  const store = { describe: 'ที่เก็บของเทสต์', put: async (path: string, data: Uint8Array) =>
    ({ storagePath: path, publicUrl: `/${path}` }), get: async () => new Uint8Array() }

  it('ไฟล์ผ่าน → {ok:true, id, url} พร้อม url ที่ใช้เติมช่อง content ต่อได้ทันที', async () => {
    const result = await storeOne(sql as unknown as postgres.Sql, store, pngFile('a.png'), {
      campaignId: 'camp-1', userId: 'u1', replacesId: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.id).toEqual(expect.any(String))
      expect(result.url).toMatch(/^\/uploads\/camp-1\/.+\/a\.png$/)
    }
  })

  it('ไฟล์ไม่ผ่าน → {ok:false, file, why} พร้อมเหตุผลจริง ไม่ใช่ทิ้งแถวเงียบๆ', async () => {
    const result = await storeOne(sql as unknown as postgres.Sql, store, gifFile('lying.png'), {
      campaignId: 'camp-1', userId: 'u1', replacesId: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.file).toBe('lying.png')
      expect(result.why).toBeTruthy()
    }
    expect(inserts()).toEqual([])
  })
})

describe('deleteAsset · สิ่งที่กันไม่ให้ลบ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ภาพที่ไม่ได้อยู่ในแคมเปญนี้ ลบไม่ได้', async () => {
    await expect(deleteAsset('camp-1', 'ไม่มีภาพนี้')).rejects.toThrow('ไม่พบภาพนี้ในแคมเปญนี้')
    expect(deletes()).toEqual([])
  })

  it('ภาพที่มีคนอัปโหลดมาแทนแล้ว ลบไม่ได้ (BR-25)', async () => {
    state.newer = [{ storage_path: 'uploads/camp-1/z/promo-new.png' }]
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('BR-25')
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('promo-new.png')
    expect(deletes()).toEqual([])
  })

  it('ภาพที่การ์ดใช้อยู่ ลบไม่ได้ และบอกว่าใครใช้', async () => {
    state.users = [{ label: 'การ์ด: win_a' }, { label: 'Rich Menu: main' }]
    await expect(deleteAsset('camp-1', 'old-asset')).rejects.toThrow('การ์ด: win_a')
    expect(deletes()).toEqual([])
  })

  it('ลบแล้วผูกกับแคมเปญใน WHERE ด้วย ไม่ใช่ลบด้วย id เปล่าๆ', async () => {
    await deleteAsset('camp-1', 'old-asset')
    expect(deletes()[0].values).toEqual(['old-asset', 'camp-1'])
  })

  it('ลบแถวเท่านั้น · ไม่มีอะไรไปแตะไฟล์บนที่เก็บ', async () => {
    await deleteAsset('camp-1', 'old-asset')
    expect(state.stored).toEqual([])
  })
})
