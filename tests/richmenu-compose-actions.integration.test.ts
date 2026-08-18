import { createCanvas } from '@napi-rs/canvas'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { createRichMenu } from '../lib/db/richmenu'
import { testDb } from '../lib/db/client'
import { MENU_CANVAS } from '../lib/richmenu/layouts'

/**
 * saveComposition ตัวจริง ยิงใส่ฐานข้อมูลจริง — actions.test.ts ใช้ sql ปลอมที่ทำ
 * ตัว array()/ANY() เป็นแค่ฟังก์ชัน identity (`(value) => value`) จึงตรวจได้แค่ว่า
 * ด่านสิทธิ์/รูปร่างทำงานถูก แต่ไม่มีทางจับได้ว่า SQL ที่ยิงจริงพัง — และมันพังจริง:
 * `id = ANY(${sql.array(assetIds)})` โดยไม่มี cast ทำให้ postgres.js ส่ง assetIds
 * (array ของสตริงล้วน) เป็น text[] เสมอ ไม่ว่าคอลัมน์ปลายทางจะเป็น uuid — Postgres
 * ปฏิเสธด้วย "operator does not exist: uuid = text" ทุกครั้งที่มีอย่างน้อยหนึ่งชั้น
 * ภาพ (ชั้นข้อความล้วนไม่โดน เพราะ assertLayerImagesOwned คืนก่อนเมื่อไม่มี assetId)
 *
 * นี่คือบั๊กจริงที่ทำให้ "คลิกภาพจากคลังเพื่อเพิ่มเป็นชั้นใหม่" ใช้งานไม่ได้เลยสัก
 * ครั้ง — เกิดกับ Postgres จริงทุกที่ ไม่ใช่แค่บน Supabase ตอน production เท่านั้น
 * เพียงแต่ actions.test.ts (mock ล้วน) และ richmenu-composition.integration.test.ts
 * (เรียก upsertComposition ตรงๆ ไม่ผ่านด่าน assertLayerImagesOwned ของ actions.ts)
 * ไม่มีไฟล์ไหนเคยยิง query จริงเส้นนี้เลยสักที
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

const { applyComposition, saveComposition } = await import('../app/(admin)/campaigns/[id]/richmenu/[menuId]/compose/actions')
const { assetStore, storagePathFor } = await import('../lib/assets/store')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql
let storageRoot: string
const savedEnv = { ...process.env }

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
  storageRoot = await mkdtemp(join(tmpdir(), 'linekit-compose-it-'))
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
  `rca${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { campaignId: string; menuId: string; assetIds: string[] }

/** แคมเปญพร้อมเมนูหนึ่งใบและภาพในคลังสองรูป — เพียงพอให้ทดสอบ ANY() กับหลายรายการ */
async function scene(): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`${t}@example.com`}, 'configurator')
    RETURNING id, email`
  cookie = user.email

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('งานแต่งภาพ', ${`c_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`

  const store = assetStore()
  const assetIds: string[] = []
  for (const n of ['a', 'b']) {
    const data = await realJpeg(200, 200)
    const path = storagePathFor(campaign.id, `${n}.jpg`)
    const stored = await store.put(path, data, 'image/jpeg')
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${campaign.id}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
              'image/jpeg', ${data.byteLength}, 200, 200, ${user.id})
      RETURNING id`
    assetIds.push(asset.id)
  }

  const [firstAsset] = assetIds
  const { id: menuId } = await createRichMenu(sql, {
    campaignId: campaign.id, alias: `main-${t}`, imageAssetId: firstAsset, layout: 'large_1',
  })

  return { campaignId: campaign.id, menuId, assetIds }
}

const compositionWithImageLayers = (assetIds: string[]) => ({
  canvasWidth: MENU_CANVAS.large.width,
  canvasHeight: MENU_CANVAS.large.height,
  background: { type: 'color' as const, color: '#FFFFFF' },
  layers: assetIds.map((assetId, i) => ({
    id: `l${i}`, type: 'image' as const, assetId, fit: 'cover' as const,
    x: 10, y: 10, width: 100, height: 100,
  })),
})

describe('saveComposition · เพิ่มชั้นภาพจากคลัง ยิง SQL จริง', () => {
  it('คลิกภาพหนึ่งรูปจากคลังเพื่อเพิ่มเป็นชั้นใหม่ — บันทึกสำเร็จ ไม่ใช่ "operator does not exist"', async () => {
    const s = await scene()
    await expect(
      saveComposition(s.campaignId, s.menuId, compositionWithImageLayers([s.assetIds[0]])),
    ).resolves.toBeUndefined()

    const [row] = await sql<{ layers: unknown }[]>`
      SELECT layers FROM rich_menu_composition WHERE rich_menu_id = ${s.menuId}`
    expect(row.layers).toHaveLength(1)
  })

  it('หลายชั้นภาพพร้อมกัน — ANY() จับได้ครบทุก assetId ไม่ใช่แค่ตัวแรก', async () => {
    const s = await scene()
    await expect(
      saveComposition(s.campaignId, s.menuId, compositionWithImageLayers(s.assetIds)),
    ).resolves.toBeUndefined()

    const [row] = await sql<{ layers: unknown }[]>`
      SELECT layers FROM rich_menu_composition WHERE rich_menu_id = ${s.menuId}`
    expect(row.layers).toHaveLength(2)
  })
})

describe('applyComposition · กด "ใช้" พร้อมชั้นภาพ ยิง SQL จริง', () => {
  it('รวมภาพทุกชั้นเป็นภาพเดียวได้ — ผ่านด่านอ่าน storage_path ของ asset ที่เป็น ANY(uuid[])', async () => {
    const s = await scene()
    const result = await applyComposition(s.campaignId, s.menuId, compositionWithImageLayers(s.assetIds))
    expect(result.id).toBeTruthy()

    const [menu] = await sql<{ image_asset_id: string }[]>`
      SELECT image_asset_id FROM rich_menu WHERE id = ${s.menuId}`
    expect(menu.image_asset_id).toBe(result.id)
  })
})
