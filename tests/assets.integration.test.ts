import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { listAssets, loadAsset } from '../lib/db/assets'
import { testDb } from '../lib/db/client'
import { seed } from './helpers/seed'

/**
 * Server Action ตัวจริง เขียนไฟล์จริงลงดิสก์ และแถวจริงลงตารางจริง
 *
 * actions.test.ts drives the same two actions against a fake sql and a fake
 * store, which proves the guards and proves nothing about the SQL, the foreign
 * keys, or whether a file ever reached a disk. BR-25 in particular is a claim
 * about two rows and a file that still exists, and only real ones can be asked.
 *
 * Only the session, the cache and the redirect are faked. The store is the real
 * local-disk one, pointed at a temporary directory through ASSET_STORAGE_ROOT.
 */
let cookie: string | undefined
let redirectedTo: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { redirectedTo = to } }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { deleteAsset, uploadAssets } = await import('../app/(admin)/campaigns/[id]/assets/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql
let root: string
const saved = { ...process.env }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'linekit-assets-it-'))
  process.env.ASSET_STORAGE_ROOT = root
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => {
  process.env = { ...saved }
  await rm(root, { recursive: true, force: true })
  await sql?.end({ timeout: 5 })
})

let unique = 0
const tag = () =>
  `a${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** PNG ที่ส่วนหัวถูกต้องจริง · ตัววัดอ่านขนาดจากไบต์พวกนี้ ไม่ใช่จากชื่อไฟล์ */
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
  // ลายเซ็นที่ทำให้แต่ละไฟล์ต่างกันจริงตอนอ่านกลับ
  data[data.length - 1] = name.length & 255
  return new File([data], name, { type: 'image/png' })
}

const form = (files: File[], fields: Record<string, string> = {}) => {
  const data = new FormData()
  for (const file of files) data.append('files', file)
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const emailOf = async (userId: string) => {
  const [row] = await sql<{ email: string }[]>`SELECT email FROM app_user WHERE id = ${userId}`
  return row.email
}

const asRole = async (role: string) => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`as-${tag()}@example.com`}, ${role})
    RETURNING id, email`
  return user
}

const rawAssets = (campaignId: string) => sql<{
  id: string
  storage_path: string
  public_url: string
  media_type: string
  mime_type: string
  bytes: number
  width: number
  height: number
  duration_sec: number | null
  used_in: unknown
  imagemap_base_url: string | null
  replaces_asset_id: string | null
  uploaded_by: string
}[]>`SELECT id, storage_path, public_url, media_type, mime_type, bytes, width, height,
            duration_sec, used_in, imagemap_base_url, replaces_asset_id, uploaded_by
       FROM asset WHERE campaign_id = ${campaignId} ORDER BY created_at, storage_path`

/**
 * รหัสแคมเปญยาวได้ไม่เกิน 20 ตัวตาม CHECK ของคอลัมน์ · ตัวนับที่โตขึ้นเรื่อยๆ
 * ทำให้รหัสยาวขึ้นทีละตัว และพังเงียบๆ ตอนแคมเปญที่ 36 ของไฟล์เทสต์เดียว
 */
const campaignCode = () => `as${(unique++).toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** แคมเปญเปล่าหนึ่งอันพร้อมคนที่มีสิทธิ์เต็ม */
const aCampaign = async () => {
  const user = await asRole('configurator')
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('คลังภาพ', ${campaignCode()}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  cookie = user.email
  return { user, campaignId: campaign.id }
}

beforeEach(() => { cookie = undefined; redirectedTo = undefined })

/**
 * ไฟล์ที่บอกว่าอัปโหลดแล้ว ต้องอยู่บนดิสก์จริง
 *
 * The one thing a fake store can never check. An asset row is a promise that a
 * URL will render something, and a row whose file was never written is a card
 * that breaks in a chat weeks later with nothing in this system to explain it.
 */
describe('uploadAssets · ไฟล์ลงดิสก์จริงและแถวลงตารางจริง', () => {
  it('ไฟล์ที่อัปโหลด อ่านกลับจากดิสก์ได้ครบทุกไบต์', async () => {
    const { campaignId } = await aCampaign()
    const file = pngFile('promo-day1.png')
    const sent = new Uint8Array(await file.arrayBuffer())

    await uploadAssets(campaignId, form([pngFile('promo-day1.png')]))

    const [row] = await rawAssets(campaignId)
    const onDisk = await readFile(join(root, row.storage_path))
    expect(Uint8Array.from(onDisk)).toEqual(sent)
  })

  it('URL ที่เก็บไว้ ตรงกับที่อยู่ของไฟล์บนดิสก์', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('promo.png')]))

    const [row] = await rawAssets(campaignId)
    expect(row.public_url).toBe(`/${row.storage_path}`)
    expect((await stat(join(root, row.public_url.slice(1)))).isFile()).toBe(true)
  })

  it('คอลัมน์ที่ NOT NULL ได้ค่าที่วัดจริง ไม่ใช่ศูนย์', async () => {
    const { campaignId, user } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png', 1200, 900, 60_000)]))

    const [row] = await rawAssets(campaignId)
    expect(row).toMatchObject({
      media_type: 'image', mime_type: 'image/png',
      width: 1200, height: 900, bytes: 60_000, uploaded_by: user.id,
    })
  })

  it('mime_type ที่ลงคอลัมน์มาจากไบต์จริง ไม่ใช่จากป้ายที่เบราว์เซอร์ติดมา', async () => {
    const { campaignId } = await aCampaign()
    const real = pngFile('a.png')
    const mislabelled = new File([await real.arrayBuffer()], 'a.png', { type: 'image/gif' })

    await uploadAssets(campaignId, form([mislabelled]))

    expect((await rawAssets(campaignId))[0].mime_type).toBe('image/png')
  })

  it('ภาพไม่มีความยาว · duration_sec เป็น null ไม่ใช่ศูนย์', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    expect((await rawAssets(campaignId))[0].duration_sec).toBeNull()
  })

  it('used_in และ imagemap_base_url ไม่ถูกกรอกด้วยค่าที่ไม่มีใครวัด', async () => {
    // used_in เป็นแคชที่ไม่มีใครในระบบนี้อัปเดต · การเขียนค่าลงไปครั้งเดียวตอนสร้าง
    // จะกลายเป็นค่าที่ผิดทันทีที่มีการ์ดใบแรกมาใช้ภาพ · จอจึงอ่านจาก foreign key แทน
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))

    const [row] = await rawAssets(campaignId)
    expect(row.used_in).toEqual([])
    expect(row.imagemap_base_url).toBeNull()
  })

  it('ไฟล์ที่ไม่ผ่าน ไม่มีทั้งแถวและไฟล์ · ไม่ใช่ไฟล์ที่ค้างอยู่โดยไม่มีแถว', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('huge.png', 1024, 678, 2_000_000)]))

    expect(await rawAssets(campaignId)).toEqual([])
    expect(redirectedTo).toContain('rejected=')
  })

  it('ชื่อไฟล์เดียวกันสองครั้ง ไม่ชน UNIQUE ของ storage_path', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('same.png')]))
    await uploadAssets(campaignId, form([pngFile('same.png')]))

    const rows = await rawAssets(campaignId)
    expect(rows).toHaveLength(2)
    expect(rows[0].storage_path).not.toBe(rows[1].storage_path)
    // ชื่อที่คนเห็นยังเป็นชื่อเดิมทั้งคู่
    expect((await listAssets(sql, campaignId)).map((a) => a.fileName))
      .toEqual(['same.png', 'same.png'])
  })

  it('ชื่อไฟล์ไทยรอดมาถึงคลัง · ไม่กลายเป็นขีดทั้งชื่อ', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('ภาพรางวัลใหญ่.png')]))
    expect((await listAssets(sql, campaignId))[0].fileName).toBe('ภาพรางวัลใหญ่.png')
  })

  it('ชื่อไฟล์ที่พาถอยขึ้นไปข้างบน ไม่ได้เขียนไฟล์ออกนอกที่เก็บ', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('../../../escaped.png')]))

    const [row] = await rawAssets(campaignId)
    expect(row.storage_path).not.toContain('..')
    // ที่อยู่ยังอยู่ใต้โฟลเดอร์ของแคมเปญนี้ · เทียบกับที่เก็บของเทสต์เอง ไม่ใช่กับ
    // โฟลเดอร์ชั่วคราวของเครื่อง ซึ่งมีของที่รันอื่นทิ้งไว้ได้
    expect(row.storage_path.startsWith(`uploads/${campaignId}/`)).toBe(true)
    expect((await stat(join(root, row.storage_path))).isFile()).toBe(true)
  })

  it('หลายไฟล์ในครั้งเดียว ได้หลายแถวและหลายไฟล์', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]))

    const rows = await rawAssets(campaignId)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect((await stat(join(root, row.storage_path))).isFile()).toBe(true)
  })
})

/**
 * BR-25 · อัปโหลดทับสร้างแถวใหม่ชี้กลับของเดิม และไม่ลบของเดิม
 *
 * The card already sitting in somebody's chat is still pointing at the first
 * file. Nothing can edit a delivered message, so the file it names has to stay
 * where it is for as long as that message exists — which is forever.
 */
describe('BR-25 · อัปโหลดทับ', () => {
  const withOriginal = async () => {
    const { campaignId, user } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('promo-v1.png')]))
    const [original] = await rawAssets(campaignId)
    return { campaignId, user, original }
  }

  it('แถวเดิมยังอยู่ และแถวใหม่ชี้กลับไปหามัน', async () => {
    const { campaignId, original } = await withOriginal()

    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))

    const rows = await rawAssets(campaignId)
    expect(rows).toHaveLength(2)

    const still = rows.find((row) => row.id === original.id)
    expect(still, 'แถวเดิมหายไป').toBeDefined()
    expect(still?.storage_path).toBe(original.storage_path)

    const replacement = rows.find((row) => row.id !== original.id)
    expect(replacement?.replaces_asset_id).toBe(original.id)
  })

  it('ไฟล์เดิมยังอยู่บนดิสก์ ไบต์ต่อไบต์', async () => {
    const { campaignId, original } = await withOriginal()
    const before = await readFile(join(root, original.storage_path))

    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))

    const after = await readFile(join(root, original.storage_path))
    expect(Uint8Array.from(after)).toEqual(Uint8Array.from(before))
  })

  it('ภาพใหม่ได้ URL ใหม่ ไม่ใช่ URL เดิมที่ชี้ไปยังไฟล์ใหม่', async () => {
    const { campaignId, original } = await withOriginal()

    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))

    const rows = await rawAssets(campaignId)
    const replacement = rows.find((row) => row.id !== original.id)
    expect(replacement?.public_url).not.toBe(original.public_url)
  })

  it('คลังเขียนความสัมพันธ์นี้ออกมาให้อ่านได้ทั้งสองด้าน', async () => {
    const { campaignId, original } = await withOriginal()
    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))

    const library = await listAssets(sql, campaignId)
    const older = library.find((asset) => asset.id === original.id)
    const newer = library.find((asset) => asset.id !== original.id)

    expect(newer?.replacesText).toContain('promo-v1.png')
    expect(newer?.replacesText).toContain('BR-25')
    expect(older?.replacedByText).toContain('promo-v2.png')
  })

  it('ภาพเก่าที่ถูกแทนแล้ว ลบไม่ได้ แม้จะไม่มีการ์ดใบไหนชี้มา', async () => {
    const { campaignId, original } = await withOriginal()
    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))

    await expect(deleteAsset(campaignId, original.id)).rejects.toThrow('BR-25')
    expect((await rawAssets(campaignId)).some((row) => row.id === original.id)).toBe(true)
  })

  it('ต่อกันหลายชั้นได้ · v3 แทน v2 โดย v1 ยังอยู่ครบ', async () => {
    const { campaignId, original } = await withOriginal()
    await uploadAssets(campaignId, form([pngFile('promo-v2.png')], {
      mode: 'replace', replace_id: original.id,
    }))
    const v2 = (await rawAssets(campaignId)).find((row) => row.id !== original.id)

    await uploadAssets(campaignId, form([pngFile('promo-v3.png')], {
      mode: 'replace', replace_id: v2?.id as string,
    }))

    const rows = await rawAssets(campaignId)
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.replaces_asset_id !== null)).toHaveLength(2)
  })

  it('ภาพเดิมของแคมเปญอื่น แทนที่ไม่ได้', async () => {
    const other = await aCampaign()
    await uploadAssets(other.campaignId, form([pngFile('theirs.png')]))
    const [theirs] = await rawAssets(other.campaignId)

    const mine = await aCampaign()
    await expect(uploadAssets(mine.campaignId, form([pngFile('mine.png')], {
      mode: 'replace', replace_id: theirs.id,
    }))).rejects.toThrow('ไม่ได้อยู่ในแคมเปญนี้')

    expect(await rawAssets(mine.campaignId)).toEqual([])
  })
})

/**
 * กติกาที่ตารางบังคับเอง ไม่ใช่ที่หน้าจอบังคับ
 */
describe('asset · CHECK และ UNIQUE ของตารางจริง', () => {
  const insert = async (patch: Record<string, unknown> = {}) => {
    const { campaignId, user } = await aCampaign()
    const row = {
      storage_path: `uploads/${campaignId}/${tag()}/x.png`,
      public_url: '/x.png',
      media_type: 'image',
      mime_type: 'image/png',
      duration_sec: null,
      bytes: 100,
      width: 10,
      height: 10,
      ...patch,
    }
    return sql`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                         duration_sec, bytes, width, height, uploaded_by)
      VALUES (${campaignId}, ${row.storage_path as string}, ${row.public_url as string},
              ${row.media_type as string}, ${row.mime_type as string},
              ${row.duration_sec as number | null}, ${row.bytes as number},
              ${row.width as number}, ${row.height as number}, ${user.id})`
  }

  it('วิดีโอยาวหกสิบวินาทีพอดี ตารางรับ', async () => {
    await expect(insert({ media_type: 'video', mime_type: 'video/mp4', duration_sec: 60 }))
      .resolves.toBeDefined()
  })

  it('วิดีโอยาวเกินหกสิบวินาที ตารางปฏิเสธเอง', async () => {
    await expect(insert({ media_type: 'video', mime_type: 'video/mp4', duration_sec: 61 }))
      .rejects.toThrow(/violates check constraint/i)
  })

  it('media_type ที่ไม่ใช่ image หรือ video ถูกปฏิเสธ', async () => {
    for (const type of ['audio', 'file', 'IMAGE', '']) {
      await expect(insert({ media_type: type }), type).rejects.toThrow(/violates check constraint/i)
    }
  })

  it('ที่อยู่ของไฟล์ซ้ำกันสองแถว ถูกปฏิเสธ · สองแถวชี้ไฟล์เดียวกันคือของที่ลบไม่ได้', async () => {
    const { campaignId, user } = await aCampaign()
    const path = `uploads/${campaignId}/${tag()}/x.png`
    const add = () => sql`
      INSERT INTO asset (campaign_id, storage_path, public_url, mime_type, bytes, width, height, uploaded_by)
      VALUES (${campaignId}, ${path}, '/x.png', 'image/png', 1, 1, 1, ${user.id})`

    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  it('ลบแคมเปญแล้วภาพของมันหายตามไปด้วย (ON DELETE CASCADE)', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))

    await sql`DELETE FROM campaign WHERE id = ${campaignId}`
    expect(await rawAssets(campaignId)).toEqual([])
  })
})

/**
 * "ไม่มีใครใช้" เป็นคำกล่าวอ้าง · จอเสนอให้ลบตามคำกล่าวอ้างนี้
 */
describe('listAssets · ใครใช้ภาพนี้อยู่บ้าง', () => {
  it('ภาพที่เพิ่งอัปโหลดคือภาพที่ไม่มีใครใช้', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))

    const [asset] = await listAssets(sql, campaignId)
    expect(asset.isOrphan).toBe(true)
    expect(asset.canDelete).toBe(true)
  })

  it('การ์ดที่วางภาพนี้ไว้ในบล็อก ทำให้ภาพนี้มีคนใช้', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    const [row] = await rawAssets(campaignId)

    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaignId}, 'promo') RETURNING id`
    await sql`
      INSERT INTO card_block (card_id, block_type, content)
      VALUES (${card.id}, 'image', ${row.public_url})`

    const [asset] = await listAssets(sql, campaignId)
    expect(asset.usedBy).toEqual(['การ์ด: promo'])
    expect(asset.isOrphan).toBe(false)
    expect(asset.canDelete).toBe(false)
  })

  it('การ์ดที่ใช้เป็นวิดีโอของการ์ด ก็นับว่าใช้อยู่', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    const [row] = await rawAssets(campaignId)

    await sql`
      INSERT INTO card (campaign_id, code, video_asset_id)
      VALUES (${campaignId}, 'clip', ${row.id})`

    expect((await listAssets(sql, campaignId))[0].usedBy).toEqual(['การ์ด: clip'])
  })

  it('Rich Menu ที่ใช้ภาพนี้ ทำให้ลบไม่ได้ และบอกชื่อเมนู', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    const [row] = await rawAssets(campaignId)

    await sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id)
      VALUES (${campaignId}, 'main', ${row.id})`

    const [asset] = await listAssets(sql, campaignId)
    expect(asset.usedBy).toEqual(['Rich Menu: main'])
    await expect(deleteAsset(campaignId, row.id)).rejects.toThrow('Rich Menu: main')
  })

  it('บัตรแสตมป์ที่ใช้ภาพนี้ ทำให้ลบไม่ได้', async () => {
    const s = await seed(sql)
    cookie = await emailOf(s.userId)
    await uploadAssets(s.campaignId, form([pngFile('empty.png'), pngFile('filled.png')]))
    const rows = await rawAssets(s.campaignId)

    await sql`
      INSERT INTO stamp_card (campaign_id, counter_id, slots, empty_asset_id, filled_asset_id, card_id)
      VALUES (${s.campaignId}, ${s.counterId}, 7, ${rows[0].id}, ${rows[1].id},
              ${s.cardIds.fallback})`

    for (const asset of await listAssets(sql, s.campaignId)) {
      expect(asset.usedBy, asset.fileName).toEqual(['บัตรแสตมป์'])
    }
    await expect(deleteAsset(s.campaignId, rows[0].id)).rejects.toThrow('บัตรแสตมป์')
  })

  it('ภาพของแคมเปญอื่นไม่โผล่มาในคลังนี้', async () => {
    const other = await aCampaign()
    await uploadAssets(other.campaignId, form([pngFile('theirs.png')]))

    const mine = await aCampaign()
    await uploadAssets(mine.campaignId, form([pngFile('mine.png')]))

    expect((await listAssets(sql, mine.campaignId)).map((a) => a.fileName)).toEqual(['mine.png'])
  })

  it('บอกได้ว่าใครอัปโหลด', async () => {
    const { campaignId, user } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    expect((await listAssets(sql, campaignId))[0].uploadedBy).toBe(user.email)
  })

  it('ภาพที่ไม่มีอยู่ คืน null ไม่ใช่โยน', async () => {
    const { campaignId } = await aCampaign()
    expect(await loadAsset(sql, campaignId, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('ภาพของแคมเปญอื่นอ่านผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    const other = await aCampaign()
    await uploadAssets(other.campaignId, form([pngFile('theirs.png')]))
    const [theirs] = await rawAssets(other.campaignId)

    const mine = await aCampaign()
    expect(await loadAsset(sql, mine.campaignId, theirs.id)).toBeNull()
  })
})

describe('deleteAsset · บนตารางจริง', () => {
  it('ลบแถวออกจากคลัง แต่ไฟล์ยังอยู่บนดิสก์', async () => {
    const { campaignId } = await aCampaign()
    await uploadAssets(campaignId, form([pngFile('a.png')]))
    const [row] = await rawAssets(campaignId)

    await deleteAsset(campaignId, row.id)

    expect(await rawAssets(campaignId)).toEqual([])
    expect((await stat(join(root, row.storage_path))).isFile()).toBe(true)
  })

  it('ภาพของแคมเปญอื่น ลบผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    const other = await aCampaign()
    await uploadAssets(other.campaignId, form([pngFile('theirs.png')]))
    const [theirs] = await rawAssets(other.campaignId)

    const mine = await aCampaign()
    await expect(deleteAsset(mine.campaignId, theirs.id)).rejects.toThrow('ไม่พบภาพนี้')
    expect(await rawAssets(other.campaignId)).toHaveLength(1)
  })
})

describe('สิทธิ์บนรายชื่อจริง', () => {
  it('ผู้ดูรายงานที่มีอยู่จริงในรายชื่อ ก็ยังอัปโหลดไม่ได้', async () => {
    const { campaignId } = await aCampaign()
    const reporter = await asRole('reporter')
    cookie = reporter.email

    await expect(uploadAssets(campaignId, form([pngFile('a.png')]))).rejects.toThrow('ไม่มีสิทธิ์')
    expect(await rawAssets(campaignId)).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาอัปโหลดได้ แต่ลบไม่ได้', async () => {
    const { campaignId } = await aCampaign()
    const editor = await asRole('content_editor')
    cookie = editor.email

    await uploadAssets(campaignId, form([pngFile('a.png')]))
    const [row] = await rawAssets(campaignId)
    expect(row.uploaded_by).toBe(editor.id)

    await expect(deleteAsset(campaignId, row.id)).rejects.toThrow('ไม่มีสิทธิ์')
    expect(await rawAssets(campaignId)).toHaveLength(1)
  })

  it('บัญชีที่ถูกถอนสิทธิ์ อัปโหลดไม่ได้แม้ยังมีแถวอยู่', async () => {
    const { campaignId, user } = await aCampaign()
    await sql`UPDATE app_user SET is_active = false WHERE id = ${user.id}`

    await expect(uploadAssets(campaignId, form([pngFile('a.png')])))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(await rawAssets(campaignId)).toEqual([])
  })

  it('ไม่มี cookie เลย อัปโหลดไม่ได้', async () => {
    const { campaignId } = await aCampaign()
    cookie = undefined

    await expect(uploadAssets(campaignId, form([pngFile('a.png')])))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(await rawAssets(campaignId)).toEqual([])
  })
})
