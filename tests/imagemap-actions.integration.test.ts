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

const { applyImagemap, saveDraft, uploadBaseImage } =
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

async function scene(): Promise<Scene> {
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
    INSERT INTO card (campaign_id, code, render_as) VALUES (${campaign.id}, ${`card_${t}`}, 'imagemap')
    RETURNING id`

  return { campaignId: campaign.id, cardId: card.id }
}

const uploadForm = (bytes: Uint8Array, name = 'base.jpg') => {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], name, { type: 'image/jpeg' }))
  return form
}

describe('uploadBaseImage · ยิง SQL จริง', () => {
  it('อัปโหลดภาพฐาน — เก็บไฟล์จริงและคำนวณ baseHeight ตามสัดส่วนภาพ (1040 กว้างเสมอ)', async () => {
    const s = await scene()
    const bytes = await realJpeg(2080, 1040) // 2:1
    const result = await uploadBaseImage(s.campaignId, s.cardId, uploadForm(bytes))

    expect(result.baseWidth).toBe(1040)
    expect(result.baseHeight).toBe(520)

    const [row] = await sql<{ base_width: number; base_height: number }[]>`
      SELECT base_width, base_height FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(row).toEqual({ base_width: 1040, base_height: 520 })
  })

  it('ภาพแคบกว่า 1040px ถูกปฏิเสธก่อนแม้แต่จะเขียนแถวใดๆ', async () => {
    const s = await scene()
    const bytes = await realJpeg(500, 500)
    await expect(uploadBaseImage(s.campaignId, s.cardId, uploadForm(bytes)))
      .rejects.toThrow('เล็กเกินไป')

    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toEqual([])
  })
})

describe('saveDraft · ยิง SQL จริง', () => {
  it('ต้องมีภาพฐานก่อน ถึงจะบันทึกพื้นที่กดได้', async () => {
    const s = await scene()
    await expect(saveDraft(s.campaignId, s.cardId, { actions: [], altText: 'x' }))
      .rejects.toThrow('อัปโหลดภาพฐานก่อน')
  })

  it('มีภาพฐานแล้ว — บันทึกพื้นที่กดจริงลง card.tap_areas', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))

    await saveDraft(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 200, action: { type: 'uri', linkUri: 'https://x.com' } }],
      altText: 'โปรโมชัน',
    })

    const [row] = await sql<{ tap_areas: unknown }[]>`SELECT tap_areas FROM card WHERE id = ${s.cardId}`
    expect(row.tap_areas).toHaveLength(1)
  })
})

describe('applyImagemap · ปั้นภาพจริงห้าขนาด ยิง SQL จริง', () => {
  it('กด "ใช้" — ได้ asset ใหม่ครบห้าขนาด และ resolveImagemapVariantAsset หาไฟล์จริงเจอทุกขนาด', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(2080, 1040)))

    await applyImagemap(s.campaignId, s.cardId, {
      actions: [{ id: 'a1', x: 10, y: 10, width: 200, height: 100, action: { type: 'message', text: 'สนใจ' } }],
      altText: 'โปรโมชันพิเศษ',
    })

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
    await expect(applyImagemap(s.campaignId, s.cardId, { actions: [], altText: 'x' }))
      .rejects.toThrow('อัปโหลดภาพฐานก่อน')
  })

  it('ไม่มีข้อความสำรอง (alt text ว่าง) ถูกปฏิเสธ — LINE บังคับให้มีเสมอ', async () => {
    const s = await scene()
    await uploadBaseImage(s.campaignId, s.cardId, uploadForm(await realJpeg(1040, 1040)))
    await expect(applyImagemap(s.campaignId, s.cardId, { actions: [], altText: '' }))
      .rejects.toThrow('ข้อความสำรอง')
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
