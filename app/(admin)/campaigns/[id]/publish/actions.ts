'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { configFor, loadPublishScreen, snapshotOf, writePublish } from '@/lib/db/publish'
import { readChannelSecret } from '@/lib/db/tokens'
import { setWebhookEndpoint } from '@/lib/line/client'
import { isConfirmed, validateForPublish } from '@/lib/publish/validate'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

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
 * ตรวจ → ยืนยันถ้าเป็น production → กันชนบัญชี → สร้าง version → ตั้ง webhook
 * ขั้นที่เกี่ยวกับริชเมนู (4b · 5 · 5a · 5b · 5c) ไม่อยู่ในสไลซ์นี้
 *
 * ลำดับไม่ใช่เรื่องของความสวยงาม · ด่านตรวจอยู่ก่อนการอ่านกุญแจ เพราะกุญแจที่ถูก
 * ถอดรหัสคือเหตุการณ์ที่ถูกบันทึกถาวรและย้อนไม่ได้ · กันชนบัญชีอยู่ก่อนการเขียน
 * version เพราะ version ที่สร้างแล้วไม่ได้ใช้คือขยะที่อ่านทีหลังแล้วเข้าใจผิด
 *
 * รหัสแคมเปญผูกมากับตัว action ไม่ได้อยู่ในฟอร์ม — ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้
 * ทั้งใบ และนี่คือจอที่ความผิดพลาดไปโผล่หาผู้ใช้จริงบน LINE โดยเรียกคืนไม่ได้
 */
export async function publish(campaignId: string, formData: FormData): Promise<void> {
  const session = await requireRole('configurator')
  const sql = db()

  const channelId = trimmed(formData, 'channel_id')
  if (!channelId) throw new Error('ต้องเลือกบัญชี LINE ปลายทางก่อนจึงจะส่งขึ้นได้')

  const { base, channels } = await loadPublishScreen(sql, campaignId)

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
    runAtLine: () => setWebhookEndpoint(accessToken, endpoint),
  })

  revalidatePath('/campaigns')
  revalidatePath('/channels')
  revalidatePath(`/campaigns/${campaignId}`)
  redirect(`/campaigns/${campaignId}/publish?done=${versionNo}`)
}
