'use server'

import { revalidatePath } from 'next/cache'
import { assetStore } from '@/lib/assets/store'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { configFor, loadPublishScreen, snapshotOf, writePublish } from '@/lib/db/publish'
import { publishRichMenus } from '@/lib/db/richmenu'
import { readChannelSecret } from '@/lib/db/tokens'
import { setWebhookEndpoint } from '@/lib/line/client'
import { isConfirmed, validateForPublish } from '@/lib/publish/validate'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

export type PublishResult = { ok: true; versionNo: number } | { ok: false; message: string }

/**
 * error ที่ไม่คาดคิดจริงๆ (ไม่ใช่ Error instance) ยังต้องมีข้อความให้คนอ่านได้อยู่ดี —
 * ไม่ใช่ปล่อยให้ PublishResult พังหรือแสดง "undefined" (เหตุผลเดียวกับ resultMessage
 * ของ ../richmenu/actions.ts)
 */
const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/**
 * การ์ดตั้งต้นเมื่อผู้เล่นพิมพ์ลอยๆ (BR-39) — ไม่มีจอไหนเคยให้กรอกค่านี้มาก่อน
 * ทั้งที่ webhook (`lib/webhook/handle.ts`) และด่านตรวจ BR-39 อ่านมันอยู่แล้ว
 *
 * channel_id ผูกมากับตัว action เหมือน publish ข้างบน ไม่ใช่ให้ฟอร์มส่งมาเอง —
 * เหตุผลเดียวกัน: ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้ทั้งใบ
 *
 * การ์ดต้องตรวจว่าเป็นของแคมเปญนี้จริง ไม่ใช่ id ที่ปลอมมา เพราะ channel ไม่มี
 * FK ผูกกับแคมเปญตรงๆ (ผูกทีละแคมเปญผ่าน campaign_channel แทน) คอลัมน์นี้ยอมรับ
 * id อะไรก็ได้ที่มีอยู่ในตาราง card ถ้าไม่ตรวจเอง
 */
export async function saveDefaultCard(
  campaignId: string, channelId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const cardId = trimmed(formData, 'default_card_id')
  if (cardId) {
    const [card] = await sql<{ id: string }[]>`
      SELECT id FROM card WHERE id = ${cardId} AND campaign_id = ${campaignId}`
    if (!card) throw new Error('การ์ดที่เลือกไม่ใช่ของแคมเปญนี้')
  }

  await sql`UPDATE channel SET default_card_id = ${cardId || null} WHERE id = ${channelId}`
  revalidatePath(`/campaigns/${campaignId}/publish`)
}

/**
 * ที่อยู่ที่ LINE จะยิง event มา
 *
 * เป็น env ไม่ใช่ค่าที่คนกรอกบนจอ เพราะมันเป็นคุณสมบัติของที่ที่ระบบนี้ถูกติดตั้ง
 * ไม่ใช่ของแคมเปญ · ไม่มีค่าแล้วต้องล้มตรงนี้ ไม่ใช่ตั้ง webhook ไปที่ localhost
 * แล้วปล่อยให้แคมเปญที่ "ส่งขึ้นแล้ว" เงียบใส่ผู้เล่นจริง
 */
function webhookEndpoint(): string {
  const base = process.env.PUBLIC_BASE_URL
  if (!base) {
    throw new Error(
      'ยังไม่ได้ตั้ง PUBLIC_BASE_URL — ระบบไม่รู้ว่าจะบอก LINE ให้ยิง event มาที่ไหน'
      + ' จึงส่งขึ้นไม่ได้',
    )
  }
  return `${base.replace(/\/+$/, '')}/api/line/webhook`
}

/**
 * ส่งแคมเปญขึ้น LINE · ลำดับตาม §4.4 ของ L2
 *
 * ตรวจ → ยืนยันถ้าเป็น production → กันชนบัญชี → สร้าง version → เมนู (4b·5·5b·5c) → ตั้ง webhook
 * ขั้น 5a (วาดภาพล่วงหน้าของริชเมสเสจ) ไม่อยู่ในงานนี้ — ดู docs/HANDOFF.md
 *
 * ลำดับไม่ใช่เรื่องของความสวยงาม · ด่านตรวจอยู่ก่อนการอ่านกุญแจ เพราะกุญแจที่ถูก
 * ถอดรหัสคือเหตุการณ์ที่ถูกบันทึกถาวรและย้อนไม่ได้ · กันชนบัญชีอยู่ก่อนการเขียน
 * version เพราะ version ที่สร้างแล้วไม่ได้ใช้คือขยะที่อ่านทีหลังแล้วเข้าใจผิด
 *
 * รหัสแคมเปญผูกมากับตัว action ไม่ได้อยู่ในฟอร์ม — ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้
 * ทั้งใบ และนี่คือจอที่ความผิดพลาดไปโผล่หาผู้ใช้จริงบน LINE โดยเรียกคืนไม่ได้
 *
 * คืนค่า `PublishResult` แทนที่จะ throw/redirect ตรงๆ เหมือน createMenu/saveMenu
 * (../richmenu/actions.ts) — จอนี้เดิมพึ่งกลไก "ตามการ redirect ที่โยนออกจาก Server
 * Action ให้เอง" ของ Next.js ซึ่งพังจริงในโปรดักชัน (v6 · v7 · v9): POST คืน 303
 * พร้อม x-action-redirect ที่ถูกต้อง แต่ฝั่ง client ไม่เคยตาม redirect นั้นต่อเลย ปุ่ม
 * ค้างหมุนตลอดไปทั้งที่การส่งขึ้นสำเร็จแล้วจริงๆ — เหตุผลเดียวกับที่ ActionForm.tsx
 * บันทึกไว้ (ทดสอบกับ next build && next start จริง): ห้าม throw หรือ redirect ข้าม
 * Server Action boundary เด็ดขาด ให้ฝั่ง client ทำ navigation เองด้วย useRouter()
 * แทนเสมอ — ดู PublishForm.tsx
 */
export async function publish(campaignId: string, formData: FormData): Promise<PublishResult> {
  try {
    const session = await requireRole('configurator')
    const sql = db()

    const channelId = trimmed(formData, 'channel_id')
    if (!channelId) throw new Error('ต้องเลือกบัญชี LINE ปลายทางก่อนจึงจะส่งขึ้นได้')

    const { base, channels, campaignCode } = await loadPublishScreen(sql, campaignId)

    // ชั้นของบัญชีถูกอ่านจากแถวจริง ไม่ใช่จากฟอร์ม · ไม่งั้น BR-18 จะเป็นด่านที่
    // ปลดได้ด้วยการพิมพ์ channel_type=test ลงไปเอง
    const channel = channels.find((row) => row.id === channelId)
    if (!channel) {
      throw new Error('ไม่พบบัญชี LINE นี้ หรือเป็นบัญชีที่ยังส่งขึ้นไม่ได้ — ผูกกุญแจที่หน้าบัญชี LINE ก่อน')
    }

    // §4.4 ขั้น 1 · 2 — BR-18 อยู่ในตัวตรวจตัวเดียวกับที่จอใช้วาดรายการ
    const confirmed = isConfirmed(String(formData.get('confirm') ?? ''))
    const problems = validateForPublish(configFor(base, channel, confirmed))
    if (problems.length > 0) {
      throw new Error(
        `ยังส่งขึ้นไม่ได้ — ขาด ${problems.length} รายการ · ${problems[0].message}`,
      )
    }

    // §4.4 ขั้น 3 · BR-68 · ERR-032
    //
    // ตัวบังคับจริงคือ unique index บางส่วน campaign_channel_one_live_per_channel
    // ในฐานข้อมูล · ด่านนี้ไม่ได้แทนมัน แต่แปลมันเป็นประโยคที่บอกว่าชนกับตัวไหนและ
    // ต้องทำอะไรต่อ ซึ่งเป็นสิ่งที่ชื่อ constraint ทำแทนไม่ได้
    if (channel.liveCampaign && channel.liveCampaign.id !== campaignId) {
      throw new Error(
        `บัญชี LINE นี้มีแคมเปญ ${channel.liveCampaign.name} เปิดอยู่`
        + ' · ต้องถอนแคมเปญนั้นก่อนจึงจะส่งแคมเปญนี้ขึ้นได้ (BR-68 · ERR-032)',
      )
    }

    const endpoint = webhookEndpoint()

    /*
     * §4.4 ขั้น 6 ต้องใช้โทเคนของบัญชีปลายทาง ไม่ใช่ของ env
     *
     * อ่านนอกธุรกรรมโดยตั้งใจ · readChannelSecret เขียนแถวลง token_access_log ก่อน
     * ถอดรหัส และแถวนั้นต้องรอดแม้การส่งขึ้นจะล้มแล้วย้อนกลับ — การอ่านที่ล้มระหว่าง
     * ทางคือการอ่านที่คนจะอยากหาที่สุด
     */
    const accessToken = await readChannelSecret(sql, {
      channelId: channel.id,
      field: 'token',
      purpose: 'publish',
      appUserId: session.userId,
    })

    const { versionNo } = await writePublish(sql, {
      campaignId,
      channelId: channel.id,
      publishedBy: session.userId,
      snapshot: snapshotOf(base, channel),
      // §4.4 ขั้น 4b·5·5b·5c ก่อนขั้น 6 (ตั้ง webhook) เสมอ — ทั้งหมดอยู่ในธุรกรรม
      // เดียวกับ config_version ผ่าน `tx` ที่ writePublish ส่งเข้ามา · ขั้นไหนล้ม
      // ธุรกรรมทั้งก้อนย้อนกลับหมด ไม่เหลือเมนูที่อัปโหลดไปแล้วครึ่งๆ กลางๆ
      runAtLine: async (tx) => {
        await publishRichMenus(tx, { campaignId, campaignCode, accessToken, store: assetStore() })
        await setWebhookEndpoint(accessToken, endpoint)
      },
    })

    revalidatePath('/campaigns')
    revalidatePath('/channels')
    revalidatePath(`/campaigns/${campaignId}`)
    return { ok: true, versionNo }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'ส่งขึ้น LINE ไม่สำเร็จ — ลองใหม่') }
  }
}
