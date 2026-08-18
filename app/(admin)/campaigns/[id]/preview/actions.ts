'use server'

import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { loadPreviewSnapshot, resetPreview, runPreviewEvent } from '@/lib/db/preview'
import { toChatBubble, type PreviewReply } from '@/lib/preview/chat'
import { STOCK_MODES, type PreviewInput, type PreviewStock } from '@/lib/preview/sim'

/** LINE ปฏิเสธข้อความที่ยาวกว่านี้ · ยอมให้ทดสอบสิ่งที่ส่งจริงไม่ได้คือการโกหก */
const MAX_TEXT = 2000

/** event_log.postback_data มี CHECK ว่ายาวได้ไม่เกินนี้ (§5.2) */
const MAX_POSTBACK = 300

/** ข้ามได้สิบปี · มากกว่านี้ไม่ได้ทดสอบอะไรเพิ่ม แต่ทำให้วันที่ล้นได้ */
const MAX_SKIP_DAYS = 3650

export type PreviewSim = { dayOffset: number; stock: PreviewStock }

/**
 * สิ่งที่มาจากเบราว์เซอร์ ตรวจก่อนถึงกติกาเสมอ
 *
 * These arguments arrive from a client component, which means they arrive from
 * whoever is holding the browser. Two of the three limits below are not
 * politeness: past them the database refuses the write, and it refuses it after
 * play_and_apply has already granted a reward.
 */
function checkedInput(input: PreviewInput): PreviewInput {
  if (input?.kind === 'text') {
    const text = String(input.text ?? '').trim()
    if (text === '') throw new Error('พิมพ์ข้อความก่อนกดส่ง')
    if (text.length > MAX_TEXT) {
      throw new Error(`ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร ซึ่งเกินที่ LINE รับ — ผู้เล่นจริงส่งแบบนี้ไม่ได้`)
    }
    return { kind: 'text', text }
  }

  if (input?.kind === 'postback') {
    const data = String(input.data ?? '')
    if (data === '') throw new Error('ปุ่มนี้ไม่มีข้อมูลติดมาด้วย — การ์ดยังตั้งค่าปุ่มไม่ครบ')
    if (data.length > MAX_POSTBACK) {
      throw new Error(`ข้อมูลของปุ่มยาวเกิน ${MAX_POSTBACK} ตัวอักษร ซึ่งเกินที่ตารางบันทึกเหตุการณ์รับได้`)
    }
    return { kind: 'postback', data }
  }

  if (input?.kind === 'follow') return { kind: 'follow' }

  throw new Error('ทดลองเล่นรับได้แค่พิมพ์ข้อความ กดปุ่มบนการ์ด และแอดเป็นเพื่อน')
}

function checkedSim(sim: PreviewSim): PreviewSim {
  const stock = STOCK_MODES.find((mode) => mode.value === sim?.stock)?.value
  if (!stock) throw new Error('สภาพคลังรางวัลที่ขอมาไม่มีอยู่ในระบบ')

  const asked = Number(sim?.dayOffset)
  const dayOffset = Number.isFinite(asked)
    ? Math.min(MAX_SKIP_DAYS, Math.max(0, Math.trunc(asked)))
    : 0

  return { dayOffset, stock }
}

/**
 * ผู้เล่นจำลองแตะอะไรสักอย่างหนึ่งครั้ง
 *
 * ผู้ดูรายงานดูได้อย่างเดียว — a simulated play writes rows, grants
 * entitlements and moves counters on a real channel. That it is the preview
 * channel makes the rows harmless to a report, not harmless to the campaign
 * being rehearsed by somebody else.
 */
export async function playPreview(
  campaignId: string, input: PreviewInput, sim: PreviewSim,
): Promise<PreviewReply> {
  await requireRole('configurator', 'content_editor')

  const checked = checkedInput(input)
  const { dayOffset, stock } = checkedSim(sim)

  const run = await runPreviewEvent(db(), { campaignId, input: checked, dayOffset, stock })

  return {
    // null คือกติกาไม่ได้ให้ตอบอะไร ซึ่งผู้เล่นจริงเจอเป็นความเงียบ · จอเป็นคนบอกว่ามันคือความเงียบ
    bubble: run.message ? toChatBubble(run.message) : null,
    snapshot: run.snapshot,
  }
}

/** ลบผู้เล่นจำลองทิ้งแล้วเริ่มนับใหม่ · ช่องตัวอย่างยังอยู่ */
export async function resetPreviewPlayer(campaignId: string): Promise<PreviewReply> {
  await requireRole('configurator', 'content_editor')

  const sql = db()
  await resetPreview(sql, campaignId)

  return { bubble: null, snapshot: await loadPreviewSnapshot(sql, campaignId) }
}
