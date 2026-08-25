// lib/db/quizNotify.ts
import type postgres from 'postgres'
import { loadCards } from './queries'
import { readChannelSecret } from './tokens'
import { renderCard } from '../render/card'
import type { Theme } from '../render/flex'
import { pushMessage } from '../line/client'
import type { QuizConfig } from '../quiz/schema'

const EMPTY_STATE = { attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [] }

/**
 * แจ้ง A (ผู้ชวน) ว่า B ตอบครบแล้ว — best-effort เสมอ ไม่ throw ออกไปเด็ดขาด (docs/
 * superpowers/specs/2026-08-25-quiz-duo-reply-notify-design.md §4/§6) เพื่อไม่ให้
 * response ของ B ที่กำลังจะส่งกลับได้รับผลกระทบ — ทุกจุดที่ข้ามจะ log เหตุผลไว้แต่
 * ไม่ throw · ไม่มีการแทรกเนื้อหาผลลัพธ์ควิซแบบไดนามิก การ์ดถูกส่งไปตามที่แอดมิน
 * สร้างไว้ตรงๆ ด้วย state ว่างเปล่า (§2)
 */
export async function sendDuoMatchNotify(
  sql: postgres.Sql,
  opts: {
    campaignId: string
    channelId: string
    config: QuizConfig
    theme: Theme
    inviterParticipantId: string
  },
): Promise<void> {
  const cardId = opts.config.replies?.duoMatchNotifyCardId
  if (!cardId) return

  try {
    const cardsById = await loadCards(sql, opts.campaignId)
    const card = cardsById[cardId]
    if (!card) {
      console.error(`[quiz duo notify] card ${cardId} not found in campaign ${opts.campaignId} — skipping`)
      return
    }

    const [inviter] = await sql<{ line_uid: string }[]>`
      SELECT line_uid FROM participant WHERE id = ${opts.inviterParticipantId}`
    if (!inviter) {
      console.error(`[quiz duo notify] inviter participant ${opts.inviterParticipantId} not found — skipping`)
      return
    }

    const accessToken = await readChannelSecret(sql, {
      channelId: opts.channelId, field: 'token', purpose: 'push_notify', appUserId: null,
    })

    const message = renderCard(card, EMPTY_STATE, opts.theme)
    await pushMessage(accessToken, inviter.line_uid, message)
  } catch (err) {
    console.error(`[quiz duo notify] failed to notify inviter ${opts.inviterParticipantId}:`, err)
  }
}
