'use server'

import { requireRole } from '@/lib/auth/require'
import { findTestSendChannel } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { loadCardEditor } from '@/lib/db/cardEditor'
import { loadCardImagemap } from '@/lib/db/card-imagemap'
import { readChannelSecret } from '@/lib/db/tokens'
import { loadTestLineUid } from '@/lib/db/users'
import { publicImagemapBaseUrl } from '@/lib/imagemap/url'
import { pushMessage } from '@/lib/line/client'
import { renderCard, type RenderableCard } from '@/lib/render/card'
import type { PlayerState } from '@/lib/state'

/**
 * ปุ่มส่งการ์ดทดสอบของ M3-S02 (Task 14) — จุดที่ครึ่งหลังของ BR-91 เป็นจริงหรือไม่
 *
 * เรียก `renderCard` ตัวเดียวกับที่ `lib/webhook/handle.ts` เรียกให้ผู้เล่นจริง (ตัวเดียว
 * กับที่ `Preview.tsx` เรียกวาดจอด้วย) แล้วส่งผลลัพธ์นั้นตรงๆ เข้า LINE ผ่าน `pushMessage`
 * ที่เพิ่งเพิ่มใน lib/line/client.ts — ไม่มีการประกอบข้อความขึ้นมาใหม่ที่นี่เลย
 *
 * BR-62 บังคับสองชั้น:
 *   1. ปลายทางต้องเป็น test_line_uid ของ "คนที่กำลังกดปุ่มเอง" อ่านจาก session
 *      (requireRole คืนมา) เท่านั้น ไม่มีพารามิเตอร์ไหนรับ line uid จากฝั่ง client เลย
 *      แม้แต่ช่องเดียว — จึงไม่มีทางส่งไปเครื่องคนอื่นได้ไม่ว่าจะพยายามยังไง
 *   2. บัญชี LINE ที่ใช้ยิงต้องเป็นชั้น 'test' เท่านั้น (findTestSendChannel กรองไว้แล้ว)
 *      ห้ามเป็นบัญชีจริงของลูกค้า
 *
 * ไม่จำกัดบทบาท (เรียก requireRole() เปล่าๆ) เพราะการ์ดทดสอบไปที่เครื่องของคนกดเอง
 * ไม่มีสิทธิ์อะไรติดไปด้วย — เหมือนเหตุผลเดียวกับที่ saveTestLineUid (app/(admin)/users/actions.ts)
 * เปิดให้ทุกบทบาทตั้งค่าของตัวเองได้
 */
export async function sendTestCard(
  campaignId: string, cardId: string, state: PlayerState,
): Promise<void> {
  const session = await requireRole()
  const sql = db()

  // BR-62 ข้อ 1 — อ่านจาก session.userId เสมอ ไม่รับ id จากที่อื่น
  const testLineUid = await loadTestLineUid(sql, session.userId)
  if (!testLineUid) {
    throw new Error(
      'ยังไม่ได้ตั้ง LINE user id ของตัวเองไว้รับการ์ดทดสอบ — ไปตั้งที่หน้าผู้ใช้ (/users) ก่อน',
    )
  }

  const screen = await loadCardEditor(sql, campaignId, cardId)
  if (!screen) throw new Error('ไม่พบการ์ดนี้ในแคมเปญนี้')

  // BR-62 ข้อ 2 — ต้องเป็นบัญชีชั้นทดสอบเท่านั้น ห้ามเป็นบัญชีจริงของลูกค้า
  const channel = await findTestSendChannel(sql)
  if (!channel) {
    throw new Error(
      'ยังไม่มีบัญชี LINE ประเภททดสอบที่ผูกกุญแจไว้เลย (BR-62 ห้ามส่งผ่านบัญชีจริงของลูกค้า)'
      + ' — ไปผูกกุญแจที่หน้าบัญชี LINE (M6) ก่อน',
    )
  }

  const accessToken = await readChannelSecret(sql, {
    channelId: channel.id, field: 'token', purpose: 'test_send', appUserId: session.userId,
  })

  const card: RenderableCard = { code: screen.card.code, renderAs: screen.card.renderAs, blocks: screen.blocks }

  // ริชเมสเสจไม่ได้ประกอบจากบล็อก (screen.blocks) เลย — ต้องโหลดสถานะของมันเองแยก
  // ต่างหาก แล้วมี "พร้อมส่ง" ก็ต่อเมื่อเคยกด "ใช้" สำเร็จ (มีภาพ 5 ขนาดจริง) และตั้ง
  // ที่อยู่สาธารณะของระบบไว้แล้วเท่านั้น — เหมือนเงื่อนไขเดียวกับที่ lib/db/queries.ts
  // ใช้ตอนโหลด config ให้ผู้เล่นจริง เพื่อให้ปุ่มนี้ตอบตรงกับสิ่งที่ผู้เล่นจะได้เห็นจริง
  if (screen.card.renderAs === 'imagemap') {
    const imagemap = await loadCardImagemap(sql, campaignId, cardId)
    const baseUrl = publicImagemapBaseUrl(cardId)
    if (imagemap && baseUrl && imagemap.baseWidth && imagemap.baseHeight && Object.keys(imagemap.variantUrls).length > 0) {
      card.imagemap = {
        baseUrl, altText: imagemap.altText,
        baseSize: { width: imagemap.baseWidth, height: imagemap.baseHeight },
        actions: imagemap.actions,
      }
    }
  }

  const message = renderCard(card, state, screen.theme)

  await pushMessage(accessToken, testLineUid, message)
}
