'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { loadCard } from '@/lib/db/cards'
import { db } from '@/lib/db/client'

/**
 * error ที่ไม่คาดคิดจริงๆ (ไม่ใช่ Error instance) ยังต้องมีข้อความให้คนอ่านได้อยู่ดี —
 * ไม่ใช่ปล่อยให้ ActionResult พังหรือแสดง "undefined" (เหตุผลเดียวกับ resultMessage
 * ของ richmenu/actions.ts และ channels/actions.ts)
 */
const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/**
 * ลบการ์ด · ผู้ตั้งค่าแคมเปญเท่านั้น และลบได้เฉพาะการ์ดที่ "ไม่มีใครใช้" เท่านั้น
 *
 * `isOrphan` มาจาก `loadCard` ตัวเดียวกับที่จอรายการใช้ตัดสินป้าย "ไม่มีใครใช้" —
 * ด่านนี้จึงไม่มีทางลบการ์ดที่จอเพิ่งบอกว่ายังมีคนใช้อยู่ (เก้าสาขาของ used_by ครบทั้ง
 * FK และ JSONB ดู comment ของ selectCards ใน lib/db/cards.ts) ไม่ต้องดัก FK
 * restrict/cascade เองที่นี่เลย เพราะด่านนี้ปฏิเสธไปตั้งแต่ก่อนจะยิง DELETE ในทุกกรณี
 * ที่มีอะไรชี้มาจริง — ถ้า DELETE ยังชนอยู่ดีหลังผ่านด่านนี้ไปแล้ว แปลว่า used_by
 * ตกหล่นสาขา ซึ่งเป็นบั๊กของ lib/db/cards.ts ไม่ใช่อะไรที่ควรกลืนไว้เงียบๆ ที่นี่
 *
 * คืนค่า `ActionResult` แทนที่จะ throw ตรงๆ — เหตุผลเดียวกับ createMenu/saveMenu/
 * saveChannel ทุกประการ (ดู lib/actions/result.ts) ต่างจาก deleteMenu ของ
 * richmenu/actions.ts ที่ยัง throw ตรงๆ อยู่ (ยังไม่ได้แก้ ไม่ใช่แบบที่ควรทำตาม)
 */
export async function deleteCard(campaignId: string, cardId: string): Promise<ActionResult> {
  try {
    await requireRole('configurator')
    const sql = db()

    const card = await loadCard(sql, campaignId, cardId)
    if (!card) return { ok: false, message: 'ไม่พบการ์ดนี้ในแคมเปญนี้' }

    if (!card.isOrphan) {
      const refs = card.usedBy.map((ref) => ref.label).join(' · ')
      return { ok: false, message: `การ์ดนี้ยังถูกใช้อยู่ ลบไม่ได้ — ${refs}` }
    }

    await sql`DELETE FROM card WHERE id = ${cardId} AND campaign_id = ${campaignId}`
    revalidatePath(`/campaigns/${campaignId}/cards`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'ลบการ์ดไม่สำเร็จ — ลองใหม่') }
  }
}
