import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import {
  CardCreateError, OPEN_SEND_TYPES,
  blocksFromTemplate, createCardFromTemplate, listCardTemplates,
} from '../lib/cards/create'
import { listCards, listCardsForActivity, listUnownedCards } from '../lib/db/cards'
import { DEFAULT_THEME } from '../lib/db/queries'
import { configFor, loadPublishScreen } from '../lib/db/publish'
import { validateForPublish } from '../lib/publish/validate'
import { renderCard } from '../lib/render/card'
import { groupBlocks } from '../lib/render/groups'
import { toPlainText } from '../lib/render/text'
import type { PlayerState } from '../lib/state'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
/** ไฟล์เทสต์คนละไฟล์อยู่คนละ worker · ทุกแถวที่สร้างต้องมีรหัสของตัวเอง */
const tag = () =>
  `c${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { userId: string; campaignId: string; channelId: string }

/**
 * แคมเปญที่พร้อมส่งขึ้นทุกอย่าง ยกเว้นการ์ดที่เทสต์แต่ละตัวจะสร้างเอง
 *
 * มีกิจกรรมกับคีย์เวิร์ดครบเพื่อให้ด่านอื่นไม่บล็อก — สิ่งที่แต่ละเทสต์ต้องพิสูจน์คือ
 * ด่าน BR-37 ไม่ใช่ด่านที่เหลือ · ผลลัพธ์ของกิจกรรมชี้ไปการ์ดที่สร้างทีหลัง จึงต้อง
 * อัปเดตหลังจากมีการ์ดแล้ว
 */
async function scene(): Promise<Scene> {
  const t = tag()

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`card-${t}@example.com`}, 'configurator')
    RETURNING id`

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('สร้างการ์ด', ${`crd_${t}`}, now() - interval '1 day', now() + interval '30 days',
            ${user.id})
    RETURNING id`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                         token_last4, key_version, line_channel_id, created_by)
    VALUES (${`OA ${t}`}, 'production', 'cipher', 'cipher', '1a2b', 1, ${`L-${t}`}, ${user.id})
    RETURNING id`

  return { userId: user.id, campaignId: campaign.id, channelId: channel.id }
}

/** กิจกรรมกับคีย์เวิร์ดที่ชี้มาหาการ์ดใบที่เพิ่งสร้าง · ทำให้ด่านอื่นเขียวหมด */
async function wireUp(s: Scene, cardId: string): Promise<void> {
  const t = tag()
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, resolve_config)
    VALUES (${s.campaignId}, ${`act_${t}`.slice(0, 20)}, 'กิจกรรม', 'none', 'fixed',
            ${sql.json({ outcomes: [{ id: 'o1', cardId }] } as never)})
    RETURNING id`
  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
    VALUES (${s.campaignId}, ${`เล่น${t}`}, 'exact', ${activity.id}, 0)`
}

const pickChannel = (
  data: Awaited<ReturnType<typeof loadPublishScreen>>, channelId: string,
) => {
  const channel = data.channels.find((row) => row.id === channelId)
  if (!channel) throw new Error(`channel ${channelId} missing from the publish screen`)
  return channel
}

const emptyState: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

/**
 * เดินทุกกิ่งของ flex bubble/carousel หาคอมโพเนนต์ปุ่มที่ toFlexBubble สร้าง
 *
 * component() ใน lib/render/flex.ts กระจาย options.action ของบล็อกออกไปเป็น action
 * ของ LINE ตรงๆ โดยไม่ตรวจรูปร่าง — ปุ่มที่พังจะไม่มีวันโผล่เป็น error ตอนสร้าง
 * ข้อความ แต่จะโผล่ตอน LINE ปฏิเสธข้อความทั้งใบเมื่อส่งจริงเท่านั้น (ดู 0006)
 */
function collectButtonActions(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out
  const obj = node as Record<string, unknown>
  if (obj.type === 'button' && obj.action && typeof obj.action === 'object') {
    out.push(obj.action as Record<string, unknown>)
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) value.forEach((v) => collectButtonActions(v, out))
    else if (value && typeof value === 'object') collectButtonActions(value, out)
  }
  return out
}

/**
 * เทมเพลตที่ seed ไว้จริง ไม่ใช่ที่เขียนซ้ำไว้ในเทสต์
 *
 * `supabase/migrations/0004_card_templates.sql` เป็นแหล่งเดียวของเทมเพลตทั้งสิบ
 * เทสต์นี้อ่านจากตารางเพื่อไม่ให้เกิดสำเนาที่สองที่วันหนึ่งจะไม่ตรงกับของจริง
 */
describe('card_template ที่ seed ไว้', () => {
  /**
   * เฉพาะเทมเพลตที่มากับระบบ
   *
   * เทสต์ในไฟล์นี้ตัวหนึ่งเพิ่มแถวของตัวเองเข้าไปแล้วลบทิ้งไม่ได้ เพราะ
   * `card.template_code` เป็น FK มาหามัน · ข้อรับประกันข้างล่างเป็นข้อรับประกัน
   * ของเทมเพลตที่เราส่งมอบ ไม่ใช่ของทุกแถวที่ใครก็ตามเคยเขียนลงตาราง
   */
  const builtins = async () => (await listCardTemplates(sql)).filter((t) => t.isBuiltin)

  it('มีเทมเพลตอยู่จริง ไม่ใช่ตารางเปล่าเหมือน activity_template', async () => {
    expect((await builtins()).length).toBe(10)
  })

  it('มีครบทั้งสองกลุ่มที่ BR-63 สั่ง และมี "เริ่มจากศูนย์" อยู่ในชุดเดียวกัน', async () => {
    const groups = new Set((await builtins()).map((t) => t.group))
    expect(groups).toContain('from_line')
    expect(groups).toContain('beyond_line')
    expect(groups).toContain('blank')
  })

  it('ไม่มีเทมเพลตตัวไหนตกกลุ่ม · ทุกตัวมีที่ยืนบนจอ', async () => {
    const stray = (await builtins()).filter((t) => t.group === 'other')
    expect(stray.map((t) => t.code)).toEqual([])
  })

  /**
   * ห้าสิบคู่ที่ไม่มีคู่ไหนคืนการ์ดเปล่า
   *
   * การ์ดที่ไม่มีบล็อกสักอันถูกส่งออกไปเป็นข้อความว่าง ซึ่งผู้เล่นแยกไม่ออกจากบอท
   * ที่พัง · ด่านส่งขึ้นบล็อกมันไว้อยู่แล้ว แต่การให้จอสร้างของแบบนั้นออกมาได้ตั้งแต่
   * แรกคือการโยนงานให้ด่านที่อยู่ปลายทางสุด
   */
  it('ทุกเทมเพลตคูณทุกชนิดที่เปิด ได้บล็อกอย่างน้อยหนึ่งอัน', async () => {
    const templates = await builtins()
    const empty: string[] = []
    for (const template of templates) {
      for (const sendType of OPEN_SEND_TYPES) {
        if (blocksFromTemplate(template.blocks, sendType).length === 0) {
          empty.push(`${template.code} × ${sendType}`)
        }
      }
    }
    expect(empty).toEqual([])
  })

  it('ทุกเทมเพลตใช้เฉพาะชนิดบล็อกที่ตัววาดรู้จัก', async () => {
    // CHECK ของ card_block รับสิบสามชนิด แต่ lib/render/flex.ts มีสาขาให้แปดชนิด
    // เทมเพลตที่ใช้อีกห้าตัวจะได้บล็อกที่คนตั้งค่าเห็นแต่ผู้เล่นไม่มีวันเห็น
    const drawable = new Set([
      'image', 'title', 'body', 'caption', 'progress_bar', 'divider', 'spacer', 'button',
    ])
    const unknown: string[] = []
    for (const template of await builtins()) {
      for (const block of template.blocks) {
        if (!drawable.has(block.blockType)) unknown.push(`${template.code}: ${block.blockType}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('ทุกเทมเพลตพูดอะไรออกมาได้จริงตอนส่งเป็นข้อความล้วน', async () => {
    // toPlainText คืนประโยคขัดข้องเมื่อไม่มีบรรทัดไหนเหลือ — เทมเพลตที่ไปถึงตรงนั้น
    // คือเทมเพลตที่ผู้เล่นจะได้รับข้อความว่าระบบพัง แทนที่จะได้รับการ์ด
    for (const template of await builtins()) {
      const blocks = blocksFromTemplate(template.blocks, 'text').map((b) => ({
        id: `${template.code}-${b.sortOrder}`,
        blockType: b.blockType,
        sortOrder: b.sortOrder,
        content: b.content,
        showWhen: null,
        options: b.options,
      }))
      const text = toPlainText(groupBlocks(blocks, emptyState), emptyState)
      expect(text, template.code).not.toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่')
    }
  })

  /**
   * 0004 เคยทิ้ง {"action":{"type":"postback","data":""}} ไว้ในเจ็ดปุ่ม (0006 แก้)
   *
   * LINE ปฏิเสธข้อความทั้งใบด้วย 400 ทันทีที่การ์ดถูกส่งจริง ไม่ใช่ตอนแก้ไขการ์ด
   * และไม่ใช่ตอนกดปุ่ม — เอดิเตอร์เองก็ไม่มีทางเห็นบั๊กนี้เพราะ readButtonAction()
   * อ่านรูปนี้เป็น "ยังไม่ได้ตั้งปลายทาง" อยู่แล้ว เทสต์นี้จึงต้องเดินทาง render
   * จริงแทนการอ่านค่า options ตรงๆ — เส้นทางเดียวที่เห็นสิ่งที่ LINE จะเห็นจริง
   */
  it('ทุกปุ่มในทุกเทมเพลตมี action ที่ LINE รับได้จริง — postback ต้องไม่มี data ว่าง', async () => {
    const bad: string[] = []
    for (const template of await builtins()) {
      const blocks = template.blocks.map((b, i) => ({
        id: `${template.code}-${i}`, blockType: b.blockType, sortOrder: i,
        content: b.content ?? null, showWhen: null, options: b.options ?? null,
      }))
      const card = { code: template.code, renderAs: 'flex_bubble' as const, blocks }
      const message = renderCard(card, emptyState, DEFAULT_THEME)
      if (message.type !== 'flex') continue

      for (const action of collectButtonActions(message.contents)) {
        if (action.type === 'postback' && !(typeof action.data === 'string' && action.data.length > 0)) {
          bad.push(template.code)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('createCardFromTemplate · ฐานข้อมูลจริง', () => {
  it('เขียนการ์ดกับบล็อกของเทมเพลตลงไปครบ เรียงจากศูนย์', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'welcome',
      sendType: 'flex_bubble', templateCode: 'line_buttons',
    })

    const blocks = await sql<{ block_type: string; sort_order: number }[]>`
      SELECT block_type, sort_order FROM card_block WHERE card_id = ${id} ORDER BY sort_order`
    expect(blocks.map((b) => b.block_type)).toEqual(['image', 'title', 'body', 'button'])
    expect(blocks.map((b) => b.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('ชนิดที่เลือกถูกเขียนลง render_as และเทมเพลตถูกจดไว้ที่ template_code', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'swipe',
      sendType: 'flex_carousel', templateCode: 'beyond_stamp',
    })

    const [row] = await sql<{ render_as: string; template_code: string }[]>`
      SELECT render_as, template_code FROM card WHERE id = ${id}`
    expect(row.render_as).toBe('flex_carousel')
    expect(row.template_code).toBe('beyond_stamp')
  })

  it('ข้อความล้วนไม่พาบล็อกภาพติดไปด้วย', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'plain',
      sendType: 'text', templateCode: 'line_buttons',
    })

    const blocks = await sql<{ block_type: string }[]>`
      SELECT block_type FROM card_block WHERE card_id = ${id} ORDER BY sort_order`
    expect(blocks.map((b) => b.block_type)).toEqual(['title', 'body', 'button'])
  })

  it('options ของบล็อกเดินทางถึงฐานข้อมูลเป็น JSON ไม่ใช่สตริง', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'opts',
      sendType: 'flex_bubble', templateCode: 'beyond_stamp',
    })

    const [bar] = await sql<{ options: { counter?: string; target?: number } }[]>`
      SELECT options FROM card_block
       WHERE card_id = ${id} AND block_type = 'progress_bar'`
    expect(bar.options.counter).toBe('stamp')
    expect(bar.options.target).toBe(10)
  })

  it('รหัสซ้ำในแคมเปญเดียวกันไม่ทิ้งการ์ดครึ่งใบไว้', async () => {
    const s = await scene()
    await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'dup', sendType: 'text', templateCode: 'blank',
    })
    await expect(createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'dup', sendType: 'text', templateCode: 'blank',
    })).rejects.toThrow()

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM card WHERE campaign_id = ${s.campaignId} AND code = 'dup'`
    expect(count).toBe(1)
  })

  it('เทมเพลตที่ไม่มีอยู่ถูกปฏิเสธก่อนแตะตาราง card', async () => {
    const s = await scene()
    await expect(createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'ghost',
      sendType: 'text', templateCode: 'no_such_template',
    })).rejects.toThrow(CardCreateError)

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM card WHERE campaign_id = ${s.campaignId} AND code = 'ghost'`
    expect(count).toBe(0)
  })

  /**
   * คู่ที่ไม่เหลือบล็อกสักอันถูกปฏิเสธ ไม่ใช่เขียนการ์ดเปล่าลงไป
   *
   * เทมเพลตที่ระบบส่งมอบไม่มีตัวไหนไปถึงสถานะนี้ — เทสต์ข้างบนบังคับไว้แล้ว — แต่
   * ตารางเทมเพลตแก้ได้ด้วย SQL และคนถัดไปที่เติมเทมเพลตภาพล้วนเข้ามาไม่ควรได้
   * การ์ดเปล่าที่จอส่งขึ้นค่อยไปบล็อกเอาปลายทาง
   */
  it('เทมเพลตภาพล้วนคูณข้อความล้วน ถูกปฏิเสธก่อนเขียนการ์ด', async () => {
    const s = await scene()
    const [imageOnly] = await sql<{ code: string }[]>`
      INSERT INTO card_template (code, name, blocks, is_builtin, sort_order)
      VALUES (${`line_imageonly_${tag()}`}, 'ภาพล้วน',
              ${sql.json([{ blockType: 'image', content: '' }] as never)}, false, 99)
      RETURNING code`

    await expect(createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'nothing',
      sendType: 'text', templateCode: imageOnly.code,
    })).rejects.toThrow(CardCreateError)

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM card WHERE campaign_id = ${s.campaignId} AND code = 'nothing'`
    expect(count).toBe(0)

    await sql`DELETE FROM card_template WHERE code = ${imageOnly.code}`
  })

  it('รหัสการ์ดที่ผิดรูปถูกปฏิเสธ ไม่ใช่ปล่อยให้ฐานข้อมูลรับไว้', async () => {
    const s = await scene()
    await expect(createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'Card Code',
      sendType: 'text', templateCode: 'blank',
    })).rejects.toThrow(CardCreateError)
  })

  it('การ์ดที่สร้างแล้วโผล่ในจอรายการการ์ด M3-S01 ทันที', async () => {
    const s = await scene()
    await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'listed',
      sendType: 'flex_bubble', templateCode: 'line_product',
    })

    const cards = await listCards(sql, s.campaignId)
    const listed = cards.find((card) => card.code === 'listed')
    expect(listed?.renderName).toBe('การ์ดเดี่ยว')
    expect(listed?.hasImage).toBe(true)
    // ยังไม่มีใครชี้มา — จอ M3-S01 ต้องขึ้นป้าย "ไม่มีใครใช้" ให้เห็น
    expect(listed?.isOrphan).toBe(true)
  })
})

/**
 * ด่าน BR-37 มีชีวิตแล้ว
 *
 * ก่อนหน้านี้ `card.has_sample_text` มีคอลัมน์ · จอส่งขึ้น LINE อ่านมันและบล็อกได้จริง
 * แต่ไม่มีโค้ดไหนในระบบเขียนค่าลงไปเลย — เครื่องหมายถูกบนจอส่งขึ้นจึงแปลว่า "ยังไม่มี
 * ใครบอกว่าใบไหนเป็น" ไม่ใช่ "ตรวจแล้วไม่เจอ" · เทสต์เดิมที่ tests/publish.integration
 * พิสูจน์ครึ่งเดียวเพราะมันเขียนค่าเองด้วย UPDATE
 *
 * สามข้อข้างล่างปิดวงจร: สร้างการ์ดจากเทมเพลตด้วยเส้นทางจริงของจอ แล้วด่านติดเอง
 * โดยไม่มี UPDATE ไหนในเทสต์แตะคอลัมน์นั้น
 */
describe('BR-37 · การ์ดที่สร้างจากเทมเพลตบล็อกการส่งขึ้นเอง', () => {
  it('createCardFromTemplate ติดธง has_sample_text ให้เอง', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'sample',
      sendType: 'flex_bubble', templateCode: 'line_buttons',
    })

    const [row] = await sql<{ has_sample_text: boolean }[]>`
      SELECT has_sample_text FROM card WHERE id = ${id}`
    expect(row.has_sample_text).toBe(true)
  })

  it('การ์ดที่สร้างจากเทมเพลตทำให้ validateForPublish บล็อกจริง (ERR-034)', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'gate',
      sendType: 'flex_bubble', templateCode: 'line_buttons',
    })
    await wireUp(s, id)

    const data = await loadPublishScreen(sql, s.campaignId)
    const problems = validateForPublish(
      configFor(data.base, pickChannel(data, s.channelId), true),
    )

    expect(problems.map((p) => p.code)).toContain('ERR-034')
    expect(problems.find((p) => p.code === 'ERR-034')?.message).toContain('gate')
  })

  it('แก้ข้อความให้เป็นของจริงแล้วด่านปล่อยผ่าน — ไม่ใช่ด่านที่ติดตลอดกาล', async () => {
    const s = await scene()
    const { id } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'fixed',
      sendType: 'flex_bubble', templateCode: 'line_buttons',
    })
    await wireUp(s, id)
    // Task 13 จะเป็นคนถอดธงนี้ตอนคนกดบันทึกหลังแก้ข้อความ · ที่นี่ทำแทนด้วย UPDATE
    // เพื่อพิสูจน์ว่าปลายทางของด่านนี้มีอยู่จริง
    await sql`UPDATE card SET has_sample_text = false WHERE id = ${id}`

    const data = await loadPublishScreen(sql, s.campaignId)
    const problems = validateForPublish(
      configFor(data.base, pickChannel(data, s.channelId), true),
    )

    expect(problems.map((p) => p.code)).not.toContain('ERR-034')
  })

  it('เทมเพลตที่ไม่มีข้อความเลยไม่ถูกติดธง · ด่านที่แก้ไม่ได้ไม่ใช่ด่าน', async () => {
    const s = await scene()
    const [silent] = await sql<{ code: string }[]>`
      INSERT INTO card_template (code, name, blocks, is_builtin, sort_order)
      VALUES (${`line_silent_${tag()}`}, 'ภาพล้วน',
              ${sql.json([{ blockType: 'image', content: '' }] as never)}, false, 99)
      RETURNING code`

    const { id, hasSampleText } = await createCardFromTemplate(sql, {
      campaignId: s.campaignId, code: 'silent',
      sendType: 'flex_bubble', templateCode: silent.code,
    })

    expect(hasSampleText).toBe(false)
    const [row] = await sql<{ has_sample_text: boolean }[]>`
      SELECT has_sample_text FROM card WHERE id = ${id}`
    expect(row.has_sample_text).toBe(false)
    // ไม่ลบแถวเทมเพลตทิ้ง · `card.template_code` เป็น FK มาหามัน และการ์ดที่เพิ่ง
    // สร้างยังชี้อยู่ · รหัสมี tag ของตัวเองจึงไม่ชนกับใคร และเทสต์อื่นในไฟล์นี้
    // ไม่ได้นับจำนวนแถวทั้งตาราง
  })
})

describe('listCardsForActivity / listUnownedCards', () => {
  it('listCardsForActivity คืนเฉพาะการ์ดที่เป็นของ activity นั้น', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    const [owned] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})
      RETURNING id`
    await sql`INSERT INTO card (campaign_id, code) VALUES (${s.campaignId}, ${`general_${tag()}`})`

    const rows = await listCardsForActivity(sql, activity.id)

    expect(rows.map((c) => c.id)).toEqual([owned.id])
  })

  it('listUnownedCards ไม่รวมการ์ดที่เป็นของ activity ใดๆ', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    await sql`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})`
    const [general] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${s.campaignId}, ${`general_${tag()}`})
      RETURNING id`

    const rows = await listUnownedCards(sql, s.campaignId)

    expect(rows.map((c) => c.id)).toEqual([general.id])
  })
})
