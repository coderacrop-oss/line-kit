import { createCanvas } from '@napi-rs/canvas'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { resolveImagemapVariantAsset } from '../lib/db/card-imagemap'
import { IMAGEMAP_WIDTHS } from '../lib/imagemap/sizes'

/**
 * uploadBaseImage/saveDraft/applyImagemap ตัวจริง ยิงใส่ฐานข้อมูลจริงและปั้นภาพจริง
 * ผ่าน @napi-rs/canvas — actions.test.ts (ถ้ามี) ใช้ mock ล้วนจึงตรวจได้แค่ด่าน
 * สิทธิ์/รูปร่าง ไม่มีทางจับได้ว่า SQL ที่ยิงจริงพัง หรือภาพที่ปั้นจริงเปิดไม่ออก —
 * เหมือนเหตุผลเดียวกับ tests/richmenu-compose-actions.integration.test.ts ที่จับ
 * บั๊ก ANY(uuid[]) จริงได้เพราะทดสอบผ่าน Postgres จริง
 */
let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { applyImagemap, saveDraft, uploadBaseImage, uploadVideo, uploadVideoPreview } =
  await import('../app/(admin)/campaigns/[id]/cards/[cardId]/imagemap/actions')
const { assetStore } = await import('../lib/assets/store')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql
let storageRoot: string
const savedEnv = { ...process.env }

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
  storageRoot = await mkdtemp(join(tmpdir(), 'linekit-imagemap-it-'))
  process.env.ASSET_STORAGE_ROOT = storageRoot
})
afterAll(async () => {
  process.env = { ...savedEnv }
  await rm(storageRoot, { recursive: true, force: true })
  await sql?.end({ timeout: 5 })
})
beforeEach(() => { cookie = undefined })

const realJpeg = async (width: number, height: number, color = '#3366cc'): Promise<Uint8Array> => {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 90))
}

let unique = 0
const tag = () =>
  `ima${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { campaignId: string; cardId: string }

async function scene(renderAs: 'imagemap' | 'imagemap_video' = 'imagemap'): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`${t}@example.com`}, 'configurator')
    RETURNING id, email`
  cookie = user.email

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('ริชเมสเสจ actions', ${`c_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, render_as) VALUES (${campaign.id}, ${`card_${t}`}, ${renderAs})
    RETURNING id`

  return { campaignId: campaign.id, cardId: card.id }
}

const uploadForm = (bytes: Uint8Array, name = 'base.jpg', mime = 'image/jpeg') => {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], name, { type: mime }))
  return form
}

/**
 * ไบต์ MP4/ISO-BMFF จริงตัวเล็กสุดที่ probeMp4 (lib/imagemap/video.ts) อ่านได้ครบ —
 * กล่องประกอบเองแบบเดียวกับ lib/imagemap/video.test.ts (ออฟเซตตรวจกับไฟล์จริงจาก
 * ffmpeg แล้ว) ไฟล์นี้ไม่ผูกกับ ffmpeg เพื่อให้รันได้ในทุกเครื่อง CI
 */
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const fourcc = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const zeros = (n: number): number[] => new Array(n).fill(0)
const box = (type: string, body: number[]): number[] => [...be32(8 + body.length), ...fourcc(type), ...body]

function realMp4(durationSec = 10, width = 640, height = 360): Uint8Array {
  const ftyp = box('ftyp', [...fourcc('isom'), ...zeros(4), ...fourcc('isom')])
  const mvhd = box('mvhd', [0, 0, 0, 0, ...zeros(4), ...zeros(4), ...be32(1000), ...be32(durationSec * 1000)])
  const hdlr = box('hdlr', [0, 0, 0, 0, ...zeros(4), ...fourcc('vide')])
  const tkhd = box('tkhd', [
    0, 0, 0, 0, ...zeros(4), ...zeros(4), ...zeros(4), ...zeros(4), ...zeros(4),
    ...zeros(8), ...zeros(2), ...zeros(2), ...zeros(2), ...zeros(2), ...zeros(36),
    ...be32(width << 16), ...be32(height << 16),
  ])
  const mdia = box('mdia', hdlr)
  const trak = box('trak', [...tkhd, ...mdia])
  const moov = box('moov', [...mvhd, ...trak])
  return Uint8Array.from([...ftyp, ...moov])
}

describe('uploadBaseImage · ยิง SQL จริง', () => {
  it('อัปโหลดภาพฐาน — เก็บไฟล์จริงและคำนวณ baseHeight ตามสัดส่วนภาพ (1040 กว้างเสมอ)', async () => {
    const s = await scene()
    const bytes = await realJpeg(2080, 1040) // 2:1
    const result = await uploadBaseImage(s.campaignId, s.cardId, uploadForm(bytes))

    if (!result.ok) throw new Error(`คาดว่าจะสำเร็จ แต่ได้: ${result.message}`)
    expect(result.baseWidth).toBe(1040)
    expect(result.baseHeight).toBe(520)

    const [row] = await sql<{ base_width: number; base_height: number }[]>`
      SELECT base_width, base_height FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(row).toEqual({ base_width: 1040, base_height: 520 })
  })

  it('ภาพแคบกว่า 1040px ถูกปฏิเสธก่อนแม้แต่จะเขียนแถวใดๆ', async () => {
    const s = await scene()
    const bytes = await realJpeg(500, 500)
    const result = await uploadBaseImage(s.campaignId, s.cardId, uploadForm(bytes))

    expect(result).toEqual({ ok: false, message: expect.stringContaining('เล็กเกินไป') })

    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toEqual([])
  })
})

describe('saveDraft · ยิง SQL จริง', () => {
  it('ต้องมีภาพฐานก่อน ถึงจะบันทึกพื้นที่กดได้', async () => {
    const s = await scene()
    const result = await saveDraft(s.campaignId, s.cardId, { actions: [], altText: 'x' })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('อัปโหลดภาพฐานก่อน') })
  })

  it('มีภาพฐานแล้ว — บันทึกพื้นที่กดจริงลง card.tap_areas', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 200, action: { type: 'uri', linkUri: 'https://x.com' } }],
      altText: 'โปรโมชัน',
    })
    expect(result).toEqual({ ok: true })

    const [row] = await sql<{ tap_areas: unknown }[]>`SELECT tap_areas FROM card WHERE id = ${s.cardId}`
    expect(row.tap_areas).toHaveLength(1)
  })

  /**
   * เจอบั๊กนี้จริงจากการทดสอบผ่านเบราว์เซอร์จริง (Playwright): ลากย้ายพื้นที่ตอนที่
   * ยังไม่ได้พิมพ์ข้อความสำรอง (alt text ว่างอยู่ตามค่าเริ่มต้น) ทำให้ autosave ทุก
   * ครั้งพัง 500 เพราะตอนนั้นใช้ด่านตรวจแบบเข้มงวดเดียวกับตอนกด "ใช้" — ด่านของ
   * "ร่าง" ต้องปล่อยว่างได้ ไม่งั้นลากอะไรก็บันทึกไม่ได้เลยจนกว่าจะพิมพ์ข้อความก่อน
   */
  it('ข้อความสำรองยังว่างอยู่ (ค่าเริ่มต้นก่อนพิมพ์) — บันทึกร่างสำเร็จ ไม่ล้ม', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 200, action: { type: 'uri', linkUri: 'https://x.com' } }],
      altText: '',
    })
    expect(result).toEqual({ ok: true })
  })

  it('เพิ่งสลับชนิดแอ็กชันเป็นข้อความ (message) ยังไม่ทันพิมพ์อะไร — บันทึกร่างสำเร็จ ไม่ล้ม', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 200, action: { type: 'message', text: '' } }],
      altText: 'x',
    })
    expect(result).toEqual({ ok: true })
  })

  /**
   * บั๊กที่ 4 ของวันนี้ (M3-S02 · imagemap): เวทีตัดภาพด้วย overflow:hidden แต่พิกัด
   * ที่ลากไปไม่ถูก clamp เอง (computeMove/computeResize ของ lib/richmenu/gesture.ts
   * เป็นคณิตศาสตร์บริสุทธิ์ ไม่รู้จักขอบภาพ) ผู้ใช้จริงลากพื้นที่กดออกนอกขอบด้านล่าง
   * ได้ง่ายๆ แล้ว autosave ปฏิเสธด้วย validateRect ก่อนแก้ไข error นั้นถูกเซ็นเซอร์
   * เป็น 500 ดิบๆ ในโปรดักชัน — ด่านตรวจนี้ยังต้องอยู่ (ความรับผิดชอบสุดท้าย) แต่ตัว
   * แก้จริงคือ clamp ที่ AreaNode.tsx (ดู comment ที่นั่น) ไม่ให้กล่องหลุดขอบได้ตั้งแต่
   * ต้นทาง — ทดสอบตรงนี้ยันว่าด่านตรวจฝั่งเซิร์ฟเวอร์ยังทำงานถูกต้องถ้ามีอะไรหลุดมาถึง
   */
  it('พื้นที่กดหลุดขอบภาพ — ปฏิเสธพร้อมข้อความจริง ไม่ throw ดิบ', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 900, y: 900, width: 300, height: 300, action: { type: 'uri', linkUri: 'https://x.com' } }],
      altText: 'x',
    })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('นอกขอบภาพ') })
  })
})

describe('applyImagemap · ปั้นภาพจริงห้าขนาด ยิง SQL จริง', () => {
  it('กด "ใช้" — ได้ asset ใหม่ครบห้าขนาด และ resolveImagemapVariantAsset หาไฟล์จริงเจอทุกขนาด', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(2080, 1040)))

    const applied = await applyImagemap(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 100, action: { type: 'message', text: 'สนใจ' } }],
      altText: 'โปรโมชันพิเศษ',
    })
    expect(applied).toEqual({ ok: true })

    const [row] = await sql<{ variant_assets: Record<string, string> }[]>`
      SELECT variant_assets FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(Object.keys(row.variant_assets)).toHaveLength(5)

    for (const width of IMAGEMAP_WIDTHS) {
      const resolved = await resolveImagemapVariantAsset(sql, s.cardId, width)
      expect(resolved).not.toBeNull()
      const bytes = await assetStore().get(resolved!.storagePath)
      expect(bytes.byteLength).toBeGreaterThan(0)
    }
  })

  it('ต้องมีภาพฐานก่อน ถึงจะกด "ใช้" ได้', async () => {
    const s = await scene()
    const result = await applyImagemap(s.campaignId, s.cardId, { actions: [], altText: 'x' })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('อัปโหลดภาพฐานก่อน') })
  })

  it('ไม่มีข้อความสำรอง (alt text ว่าง) ถูกปฏิเสธ — LINE บังคับให้มีเสมอ', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))
    const result = await applyImagemap(s.campaignId, s.cardId, { actions: [], altText: '' })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('ข้อความสำรอง') })
  })

  it('กด "ใช้" ซ้ำสองครั้ง — ภาพชุดที่สองแทนที่ชุดแรกในบันทึก ไม่ใช่พอกเพิ่ม', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))
    await applyImagemap(s.campaignId, s.cardId, { actions: [], altText: 'รอบแรก' })

    const [firstRow] = await sql<{ variant_assets: Record<string, string> }[]>`
      SELECT variant_assets FROM card_imagemap WHERE card_id = ${s.cardId}`

    await applyImagemap(s.campaignId, s.cardId, { actions: [], altText: 'รอบสอง' })
    const [secondRow] = await sql<{ variant_assets: Record<string, string> }[]>`
      SELECT variant_assets FROM card_imagemap WHERE card_id = ${s.cardId}`

    expect(Object.keys(secondRow.variant_assets)).toHaveLength(5)
    expect(secondRow.variant_assets['1040']).not.toBe(firstRow.variant_assets['1040'])

    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toHaveLength(1) // แถวเดียวเสมอ ไม่พอกซ้อน
  })
})

/**
 * บั๊กที่ห้าของวันนี้ (M3-S02 · imagemap) — ยืนยันจริงในโปรดักชัน: การ์ด render_as=
 * 'imagemap'/'imagemap_video' ถูกสร้างจากเทมเพลตข้อความเดียวกับการ์ดบล็อกทั่วไป
 * (lib/cards/create.ts) จึงได้ has_sample_text=true ติดมาตั้งแต่สร้างเสมอ (ดู
 * comment ของ hasSampleText() ที่นั่น) ทั้งที่บล็อกเหล่านั้นไม่เคยถูกใช้จริงกับการ์ด
 * ชนิดนี้เลย — ก่อนแก้ ไม่มีโค้ดจุดไหนในไฟล์นี้เคลียร์ธงนี้ จอส่งขึ้น LINE จึงบล็อกการ์ด
 * เหล่านี้ด้วย BR-37 ถาวรไม่ว่าจะกด "ใช้" สำเร็จไปกี่ครั้งก็ตาม — เหมือนกับที่
 * saveBlockContent ของการ์ดเอดิเตอร์บล็อกทั่วไป (../app/(admin)/campaigns/[id]/
 * cards/[cardId]/actions.ts) เคลียร์ให้ทุกครั้งที่บันทึกสำเร็จอยู่แล้ว
 */
describe('BR-37 · saveDraft/applyImagemap ต้องเคลียร์ has_sample_text ทุกครั้งที่บันทึกสำเร็จ', () => {
  it('saveDraft สำเร็จ — has_sample_text พลิกจาก true เป็น false', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))
    await sql`UPDATE card SET has_sample_text = true WHERE id = ${s.cardId}`

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 200, action: { type: 'message', text: 'กะตัง' } }],
      altText: 'ไอกะตัง',
    })
    expect(result).toEqual({ ok: true })

    const [row] = await sql<{ has_sample_text: boolean }[]>`SELECT has_sample_text FROM card WHERE id = ${s.cardId}`
    expect(row.has_sample_text).toBe(false)
  })

  it('saveDraft ล้มเหลว (validation พัง) — ไม่แตะ has_sample_text เลย', async () => {
    const s = await scene()
    await sql`UPDATE card SET has_sample_text = true WHERE id = ${s.cardId}`

    const result = await saveDraft(s.campaignId, s.cardId, { actions: [], altText: 'x' })
    expect(result.ok).toBe(false)

    const [row] = await sql<{ has_sample_text: boolean }[]>`SELECT has_sample_text FROM card WHERE id = ${s.cardId}`
    expect(row.has_sample_text).toBe(true)
  })

  it('กด "ใช้" สำเร็จ — has_sample_text พลิกจาก true เป็น false', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))
    await sql`UPDATE card SET has_sample_text = true WHERE id = ${s.cardId}`

    const result = await applyImagemap(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 100, action: { type: 'message', text: 'กะตัง' } }],
      altText: 'ไอกะตัง',
    })
    expect(result).toEqual({ ok: true })

    const [row] = await sql<{ has_sample_text: boolean }[]>`SELECT has_sample_text FROM card WHERE id = ${s.cardId}`
    expect(row.has_sample_text).toBe(false)
  })
})

describe('uploadVideo · ยิง SQL จริง (ริชวิดีโอ)', () => {
  it('อัปโหลดวิดีโอ — เก็บไฟล์จริง เขียนแถว asset ชนิด video และชี้ card.video_asset_id ไปที่แถวนั้น', async () => {
    const s = await scene('imagemap_video')
    const result = await uploadVideo(s.campaignId, s.cardId, uploadForm(realMp4(10, 640, 360), 'clip.mp4', 'video/mp4'))
    if (!result.ok) throw new Error(`คาดว่าจะสำเร็จ แต่ได้: ${result.message}`)
    expect(result.url).toBeDefined()

    const [row] = await sql<{
      video_asset_id: string | null
    }[]>`SELECT video_asset_id FROM card WHERE id = ${s.cardId}`
    expect(row.video_asset_id).not.toBeNull()

    const [asset] = await sql<{ media_type: string; mime_type: string; duration_sec: number; width: number; height: number }[]>`
      SELECT media_type, mime_type, duration_sec, width, height FROM asset WHERE id = ${row.video_asset_id}`
    expect(asset).toEqual({ media_type: 'video', mime_type: 'video/mp4', duration_sec: 10, width: 640, height: 360 })
  })

  it('การ์ดที่เป็น imagemap ธรรมดา — ปฏิเสธ ไม่เขียน asset ใดๆ', async () => {
    const s = await scene('imagemap')
    const result = await uploadVideo(s.campaignId, s.cardId, uploadForm(realMp4(), 'clip.mp4', 'video/mp4'))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('ไม่พบการ์ดริชวิดีโอนี้') })
  })

  it('วิดีโอยาวเกินเพดาน — ปฏิเสธก่อนเขียนอะไรเลย', async () => {
    const s = await scene('imagemap_video')
    const result = await uploadVideo(s.campaignId, s.cardId, uploadForm(realMp4(61), 'clip.mp4', 'video/mp4'))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('เกินเพดาน') })

    const [row] = await sql<{ video_asset_id: string | null }[]>`SELECT video_asset_id FROM card WHERE id = ${s.cardId}`
    expect(row.video_asset_id).toBeNull()
  })

  it('ไฟล์ไม่ใช่ MP4 จริง (ไม่มีก้อน ftyp) — ปฏิเสธ', async () => {
    const s = await scene('imagemap_video')
    const result = await uploadVideo(s.campaignId, s.cardId, uploadForm(Uint8Array.from([1, 2, 3, 4]), 'clip.mp4', 'video/mp4'))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('ftyp') })
  })
})

describe('uploadVideoPreview · ยิง SQL จริง (ริชวิดีโอ)', () => {
  it('อัปโหลดภาพตัวอย่าง — เขียน card_imagemap.video_preview_asset_id ชี้ไปแถว asset ชนิดภาพ', async () => {
    const s = await scene('imagemap_video')
    const result = await uploadVideoPreview(s.campaignId, s.cardId, uploadForm(await realJpeg(400, 225), 'preview.jpg'))
    if (!result.ok) throw new Error(`คาดว่าจะสำเร็จ แต่ได้: ${result.message}`)
    expect(result.url).toBeDefined()

    const [row] = await sql<{ video_preview_asset_id: string | null }[]>`
      SELECT video_preview_asset_id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(row.video_preview_asset_id).not.toBeNull()
  })

  it('ภาพเล็กกว่า 800px กว้าง — ยังผ่าน (ภาพตัวอย่างไม่ใช้เพดานความกว้างของคลังภาพทั่วไป/ภาพฐาน)', async () => {
    const s = await scene('imagemap_video')
    const result = await uploadVideoPreview(s.campaignId, s.cardId, uploadForm(await realJpeg(200, 150), 'preview.jpg'))
    expect(result.ok).toBe(true)
  })
})

describe('saveDraft · พื้นที่เล่นวิดีโอ/ลิงก์หลังเล่นจบ ยิง SQL จริง (ริชวิดีโอ)', () => {
  it('บันทึกพื้นที่เล่นวิดีโอกับลิงก์ผ่าน Server Action จริง แล้วอ่านกลับจากฐานข้อมูลตรงกัน', async () => {
    const s = await scene('imagemap_video')
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    await saveDraft(s.campaignId, s.cardId, {
      actions: [], altText: 'x',
      videoArea: { x: 10, y: 10, width: 300, height: 150 },
      videoLinkUri: 'https://example.com/more', videoLinkLabel: 'ดูเพิ่ม',
    })

    const [card] = await sql<{ video_end_uri: string; video_end_label: string }[]>`
      SELECT video_end_uri, video_end_label FROM card WHERE id = ${s.cardId}`
    expect(card).toEqual({ video_end_uri: 'https://example.com/more', video_end_label: 'ดูเพิ่ม' })

    const [ci] = await sql<{ video_area: unknown }[]>`SELECT video_area FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(ci.video_area).toEqual({ x: 10, y: 10, width: 300, height: 150 })
  })

  it('พื้นที่เล่นวิดีโอหลุดขอบภาพ — ปฏิเสธเหมือนพื้นที่กด', async () => {
    const s = await scene('imagemap_video')
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [], altText: 'x', videoArea: { x: 900, y: 900, width: 300, height: 300 },
    })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('นอกขอบภาพ') })
  })

  it('ลิงก์หลังเล่นจบไม่ใช่ http/https — ปฏิเสธ', async () => {
    const s = await scene('imagemap_video')
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    const result = await saveDraft(s.campaignId, s.cardId, {
      actions: [], altText: 'x', videoLinkUri: 'javascript:alert(1)',
    })
    expect(result).toEqual({ ok: false, message: expect.stringContaining('http') })
  })
})
