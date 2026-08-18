import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import type { AssetStore } from '../lib/assets/store'
import { testDb } from '../lib/db/client'
import { writePublish } from '../lib/db/publish'
import {
  createRichMenu, deleteRichMenu, DuplicateAliasError, loadRichMenuScreen, publishRichMenus,
  RichMenuInUseError, setAreaTarget, setEntryMenu, setLayout, setMenuImage, updateRichMenu,
} from '../lib/db/richmenu'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `rm${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { userId: string; campaignId: string; assetId: string; assetId2: string }

/** แคมเปญ + ผู้ใช้ + ภาพขนาด 2500×1686 สองรูป — พร้อมสร้างเมนูได้ทันที */
async function scene(): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`rm-${t}@example.com`}, 'configurator')
    RETURNING id`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('เมนู', ${`rm_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                        width, height, uploaded_by)
    VALUES (${campaign.id}, ${`uploads/${t}/a.png`}, ${`/uploads/${t}/a.png`}, 'image',
            'image/png', 100, 2500, 1686, ${user.id})
    RETURNING id`
  const [asset2] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                        width, height, uploaded_by)
    VALUES (${campaign.id}, ${`uploads/${t}/b.png`}, ${`/uploads/${t}/b.png`}, 'image',
            'image/png', 100, 2500, 1686, ${user.id})
    RETURNING id`
  return { userId: user.id, campaignId: campaign.id, assetId: asset.id, assetId2: asset2.id }
}

describe('createRichMenu / updateRichMenu · ฐานข้อมูลจริง', () => {
  it('สร้างเมนูใหม่ด้วยผัง one ได้หนึ่งช่อง ไม่ชี้ไปไหนตั้งต้น', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'main', imageAssetId: s.assetId, layout: 'large_1',
    })

    const data = await loadRichMenuScreen(sql, s.campaignId)
    const menu = data.menus.find((m) => m.id === id)
    expect(menu?.areas).toHaveLength(1)
    expect(menu?.areas[0].kind).toBe('none')
    expect(menu?.isEntry).toBe(false)
    expect(menu?.imageBad).toBe(false)
  })

  it('UNIQUE (campaign_id, alias) ของตารางถูกแปลเป็น DuplicateAliasError', async () => {
    const s = await scene()
    await createRichMenu(sql, { campaignId: s.campaignId, alias: 'dup', imageAssetId: s.assetId, layout: 'large_1' })
    await expect(createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'dup', imageAssetId: s.assetId2, layout: 'large_1',
    })).rejects.toThrow(DuplicateAliasError)
  })

  it('ภาพขนาดผิด (ไม่ใช่ 2500×1686) ทำให้ imageBad เป็นจริง', async () => {
    const s = await scene()
    const [badAsset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${tag()}/bad.png`}, '/x', 'image', 'image/png', 100,
              1200, 405, ${s.userId})
      RETURNING id`
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'bad-img', imageAssetId: badAsset.id, layout: 'large_1',
    })
    const data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === id)?.imageBad).toBe(true)
  })

  it('updateRichMenu แก้ alias และภาพ', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'old', imageAssetId: s.assetId, layout: 'large_1',
    })
    await updateRichMenu(sql, { id, campaignId: s.campaignId, alias: 'new', imageAssetId: s.assetId2 })
    const data = await loadRichMenuScreen(sql, s.campaignId)
    const menu = data.menus.find((m) => m.id === id)
    expect(menu?.alias).toBe('new')
    expect(menu?.imageAssetId).toBe(s.assetId2)
  })
})

describe('setMenuImage · ฐานข้อมูลจริง', () => {
  it('แก้ภาพโดยไม่แตะชื่อเรียกเลย', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'keep-me', imageAssetId: s.assetId, layout: 'large_1',
    })
    await setMenuImage(sql, { id, campaignId: s.campaignId, imageAssetId: s.assetId2 })
    const data = await loadRichMenuScreen(sql, s.campaignId)
    const menu = data.menus.find((m) => m.id === id)
    expect(menu?.alias).toBe('keep-me')
    expect(menu?.imageAssetId).toBe(s.assetId2)
  })

  it('เมนูที่ไม่มีอยู่จริง หรือของแคมเปญอื่น ถูกปฏิเสธ ไม่เขียนอะไรเลย', async () => {
    const s = await scene()
    const other = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'x', imageAssetId: s.assetId, layout: 'large_1',
    })
    await expect(setMenuImage(sql, { id, campaignId: other.campaignId, imageAssetId: s.assetId2 }))
      .rejects.toThrow('ไม่พบเมนูนี้')
    const data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === id)?.imageAssetId).toBe(s.assetId)
  })
})

describe('setLayout / setAreaTarget · ฐานข้อมูลจริง', () => {
  it('เปลี่ยนผังแล้วจำนวนช่องเปลี่ยนตาม และค่าที่ตั้งไว้ตำแหน่งเดิมยังอยู่', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'layout', imageAssetId: s.assetId, layout: 'large_2h',
    })
    await setAreaTarget(sql, { id, campaignId: s.campaignId, index: 0, kind: 'url', target: 'https://x.example' })
    await setLayout(sql, { id, campaignId: s.campaignId, layout: 'large_6' })

    const data = await loadRichMenuScreen(sql, s.campaignId)
    const menu = data.menus.find((m) => m.id === id)
    expect(menu?.areas).toHaveLength(6)
    expect(menu?.areas[0]).toMatchObject({ kind: 'url', target: 'https://x.example' })
    expect(menu?.layout).toBe('large_6')
  })

  it('setAreaTarget เปลี่ยนกลับเป็น none ล้าง target เป็น null', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'clear', imageAssetId: s.assetId, layout: 'large_1',
    })
    await setAreaTarget(sql, { id, campaignId: s.campaignId, index: 0, kind: 'url', target: 'https://x.example' })
    await setAreaTarget(sql, { id, campaignId: s.campaignId, index: 0, kind: 'none', target: null })

    const data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === id)?.areas[0]).toMatchObject({ kind: 'none', target: null })
  })

  it('setAreaTarget กับ index ที่ไม่มีอยู่ในผังปัจจุบัน ถูกปฏิเสธ ไม่เขียนอะไรเงียบๆ', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, {
      campaignId: s.campaignId, alias: 'oob', imageAssetId: s.assetId, layout: 'large_1',
    })
    await expect(setAreaTarget(sql, {
      id, campaignId: s.campaignId, index: 5, kind: 'url', target: 'https://x.example',
    })).rejects.toThrow('ไม่มีอยู่ในผังปัจจุบัน')
  })
})

describe('BR-78 · เมนูตัวเข้าพอดีหนึ่งอัน — ฐานข้อมูลจริง', () => {
  it('unique index บางส่วนปฏิเสธสองแถวที่ is_entry = true พร้อมกันในแคมเปญเดียว', async () => {
    const s = await scene()
    await sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id, is_entry)
      VALUES (${s.campaignId}, 'e1', ${s.assetId}, true)`
    await expect(sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id, is_entry)
      VALUES (${s.campaignId}, 'e2', ${s.assetId2}, true)`)
      .rejects.toThrow(/rich_menu_one_entry_per_campaign/)
  })

  it('setEntryMenu สลับแล้วตัวเก่าหลุดอัตโนมัติ ตัวใหม่ถูกตั้ง (ทีละครั้ง ไม่ชนกันเอง)', async () => {
    const s = await scene()
    const a = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'a', imageAssetId: s.assetId, layout: 'large_1' })
    const b = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'b', imageAssetId: s.assetId2, layout: 'large_1' })

    await setEntryMenu(sql, { campaignId: s.campaignId, id: a.id })
    let data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === a.id)?.isEntry).toBe(true)
    expect(data.menus.find((m) => m.id === b.id)?.isEntry).toBe(false)

    await setEntryMenu(sql, { campaignId: s.campaignId, id: b.id })
    data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === a.id)?.isEntry).toBe(false)
    expect(data.menus.find((m) => m.id === b.id)?.isEntry).toBe(true)
  })
})

describe('deleteRichMenu · ฐานข้อมูลจริง', () => {
  it('ลบเมนูที่ไม่มีใครอ้างถึงได้ปกติ', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'del', imageAssetId: s.assetId, layout: 'large_1' })
    await deleteRichMenu(sql, { id, campaignId: s.campaignId })
    const data = await loadRichMenuScreen(sql, s.campaignId)
    expect(data.menus.find((m) => m.id === id)).toBeUndefined()
  })

  it('ลบเมนูที่บัญชี LINE ตั้งเป็นเมนูเริ่มต้นอยู่ (channel.base_richmenu_id) ถูกปฏิเสธเป็น RichMenuInUseError', async () => {
    const s = await scene()
    const { id } = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'inuse', imageAssetId: s.assetId, layout: 'large_1' })
    await sql`
      INSERT INTO channel (name, channel_type, base_richmenu_id, encrypted_token,
                            encrypted_secret, token_last4, key_version, created_by)
      VALUES (${`OA ${tag()}`}, 'test', ${id}, 'cipher', 'cipher', '9f2a', 1, ${s.userId})`

    await expect(deleteRichMenu(sql, { id, campaignId: s.campaignId })).rejects.toThrow(RichMenuInUseError)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// publishRichMenus · §4.4 ขั้น 4b · 5 · 5b · 5c — LINE ถูก mock ผ่าน fetch เสมอ
// ห้ามยิงเน็ตจริงในเทสต์
// ────────────────────────────────────────────────────────────────────────────

const fetchMock = vi.fn()
const fakeStore: AssetStore = {
  describe: 'fake',
  put: async () => { throw new Error('ไม่ใช้ในเทสต์นี้') },
  get: async () => new Uint8Array([1, 2, 3]),
}

let richMenuIdCounter = 0

/**
 * ตั้งช่องแรกของเมนูให้ชี้ไปที่ไหนสักที่ — `publishRichMenus` สมมติเสมอว่า
 * `validateForPublish` (BR-01) ผ่านมาแล้วก่อนถูกเรียก เมนูที่เพิ่งสร้างใหม่ยังมี
 * ช่องว่าง ('none') อยู่ ต้องเติมให้ก่อนจะจำลองการ publish จริง
 */
const fillArea = (id: string, campaignId: string) =>
  setAreaTarget(sql, { id, campaignId, index: 0, kind: 'url', target: 'https://example.com' })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  richMenuIdCounter = 0
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/richmenu/validate')) return { ok: true, status: 200, text: async () => '{}' }
    if (url.endsWith('/v2/bot/richmenu')) {
      richMenuIdCounter += 1
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ richMenuId: `line-rm-${richMenuIdCounter}` }) }
    }
    if (url.includes('/content')) return { ok: true, status: 200, text: async () => '{}' }
    if (url.includes('/richmenu/alias')) return { ok: true, status: 200, text: async () => '{}' }
    if (url.endsWith('/richmenu/batch')) return { ok: true, status: 200, text: async () => '{}' }
    return { ok: true, status: 200, text: async () => '{}' }
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('publishRichMenus · ฐานข้อมูลจริง + LINE mock', () => {
  it('ไม่มีเมนูเลย — ไม่เรียก fetch แม้แต่ครั้งเดียว', async () => {
    const s = await scene()
    await publishRichMenus(sql, { campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ตัดสินใจข้อ 4 — การส่งขึ้นครั้งแรก (line_rich_menu_id เดิมเป็น null ทุกแถว) ไม่เรียก batch', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'main', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)

    await publishRichMenus(sql, { campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore })

    const batchCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/richmenu/batch'))
    expect(batchCalls).toHaveLength(0)

    const [row] = await sql<{ line_rich_menu_id: string | null }[]>`
      SELECT line_rich_menu_id FROM rich_menu WHERE campaign_id = ${s.campaignId}`
    expect(row.line_rich_menu_id).toBe('line-rm-1')
  })

  it('ตัดสินใจข้อ 4 — ส่งขึ้นซ้ำ (มี line_rich_menu_id เดิมอยู่แล้ว) เรียก batch หนึ่งครั้งพร้อม operation ย้ายรุ่นเก่าไปรุ่นใหม่', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'main', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)
    await sql`UPDATE rich_menu SET line_rich_menu_id = 'old-line-id' WHERE id = ${menu.id}`

    await publishRichMenus(sql, { campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore })

    const batchCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/richmenu/batch'))
    expect(batchCalls).toHaveLength(1)
    const body = JSON.parse(batchCalls[0][1].body)
    expect(body.operations).toEqual([{ type: 'link', from: 'old-line-id', to: 'line-rm-1' }])
  })

  it('เมนูที่ไม่มีปุ่มสลับแท็บชี้ถึง ไม่ถูกลงทะเบียน alias เลย (5b เฉพาะที่จำเป็น)', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'solo', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)

    await publishRichMenus(sql, { campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore })

    const aliasCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/richmenu/alias'))
    expect(aliasCalls).toHaveLength(0)
  })

  it('เมนูที่มีปุ่มสลับแท็บชี้ถึงจริง ถูกลงทะเบียน alias (5b)', async () => {
    const s = await scene()
    const target = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'promo', imageAssetId: s.assetId, layout: 'large_1' })
    const source = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'main', imageAssetId: s.assetId2, layout: 'large_1' })
    await fillArea(target.id, s.campaignId)
    await setAreaTarget(sql, { id: source.id, campaignId: s.campaignId, index: 0, kind: 'menu', target: target.id })

    await publishRichMenus(sql, { campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore })

    const aliasCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/richmenu/alias'))
    expect(aliasCalls).toHaveLength(1)
    const body = JSON.parse(aliasCalls[0][1].body)
    expect(body.richMenuAliasId).toBe('promo')
  })

  it('LINE ปฏิเสธตอน validate (4b) — โยน error พร้อมรหัส ERR-044 และไม่เขียน line_rich_menu_id', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'bad', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/richmenu/validate')) return { ok: false, status: 422, text: async () => 'areas invalid' }
      return { ok: true, status: 200, text: async () => '{}' }
    })

    await expect(publishRichMenus(sql, {
      campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore,
    })).rejects.toThrow(/ERR-044/)

    const [row] = await sql<{ line_rich_menu_id: string | null }[]>`
      SELECT line_rich_menu_id FROM rich_menu WHERE id = ${menu.id}`
    expect(row.line_rich_menu_id).toBeNull()
  })

  it('ล้มที่ 5c (batch) — โยน error พร้อมรหัส ERR-045', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'batch-fail', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)
    await sql`UPDATE rich_menu SET line_rich_menu_id = 'old-id' WHERE id = ${menu.id}`
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/richmenu/batch')) return { ok: false, status: 500, text: async () => 'batch boom' }
      if (url.endsWith('/v2/bot/richmenu')) {
        return { ok: true, status: 200, text: async () => '{}', json: async () => ({ richMenuId: 'new-id' }) }
      }
      return { ok: true, status: 200, text: async () => '{}' }
    })

    await expect(publishRichMenus(sql, {
      campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore,
    })).rejects.toThrow(/ERR-045/)
  })

  /**
   * ธุรกรรม publish เดิม (Task 17) ต้องยังอะตอมมิกเหมือนเดิมเมื่อมีเมนูเข้ามาด้วย
   *
   * เรียกผ่าน `writePublish` ตัวจริง (ไม่ใช่เรียก `publishRichMenus` ลอยๆ) เพื่อ
   * พิสูจน์ว่าขั้นเมนูล้มแล้วย้อนทั้ง config_version และ campaign_channel ทิ้งด้วย
   * ไม่ใช่แค่ไม่เขียน line_rich_menu_id — เหมือนกับที่ tests/publish.integration.test.ts
   * พิสูจน์ไว้กับขั้นตั้ง webhook (ขั้น 6)
   */
  it('ขั้นเมนูล้ม (4b) ทำให้ทั้งธุรกรรม publish ย้อนกลับหมด — ไม่เหลือ version หรือการผูกบัญชีค้าง', async () => {
    const s = await scene()
    const menu = await createRichMenu(sql, { campaignId: s.campaignId, alias: 'atomic', imageAssetId: s.assetId, layout: 'large_1' })
    await fillArea(menu.id, s.campaignId)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/richmenu/validate')) return { ok: false, status: 422, text: async () => 'nope' }
      return { ok: true, status: 200, text: async () => '{}' }
    })

    await expect(writePublish(sql, {
      campaignId: s.campaignId,
      channelId: (await sql<{ id: string }[]>`
        INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret, token_last4,
                              key_version, created_by)
        VALUES (${`OA ${tag()}`}, 'test', 'c', 'c', '0001', 1, ${s.userId}) RETURNING id`)[0].id,
      publishedBy: s.userId,
      snapshot: {},
      runAtLine: (tx) => publishRichMenus(tx, {
        campaignId: s.campaignId, campaignCode: 'x', accessToken: 't', store: fakeStore,
      }),
    })).rejects.toThrow(/ERR-044/)

    const versions = await sql<{ id: string }[]>`
      SELECT id FROM config_version WHERE campaign_id = ${s.campaignId}`
    expect(versions).toEqual([])

    const bindings = await sql<{ campaign_id: string }[]>`
      SELECT campaign_id FROM campaign_channel WHERE campaign_id = ${s.campaignId}`
    expect(bindings).toEqual([])
  })
})
