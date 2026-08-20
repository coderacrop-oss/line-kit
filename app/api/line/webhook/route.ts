import { createHmac } from 'node:crypto'
import { findChannelByBotUserId } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { makePorts } from '@/lib/db/queries'
import { readChannelSecret } from '@/lib/db/tokens'
import { linkRichMenu, replyMessage } from '@/lib/line/client'
import { verifySignature } from '@/lib/line/verify'
import { handleEvent, type IncomingEvent } from '@/lib/webhook/handle'

/**
 * ตั้งซ้ำตรงนี้ด้วยแม้ root layout (app/layout.tsx) ตั้งไว้ทั้งแอปแล้ว — route
 * handler ไม่ได้อยู่ใต้ต้นไม้ของ layout เหมือนหน้าเว็บทั่วไป จุดนี้เป็นเส้นทางที่
 * ผู้เล่นจริงรอคำตอบสดๆ ทุกครั้งที่พิมพ์อะไรเข้ามา ไม่อยากเสี่ยงให้พลาดเงียบๆ
 * จากการอนุมานผิด — สิงคโปร์ ใกล้ทั้ง Supabase (ap-southeast-1) และผู้เล่นในเอเชีย
 */
export const preferredRegion = 'sin1'

/**
 * The single entry point from LINE — for every channel bound in the `channel`
 * table, not just one (M6-S0x multi-channel webhook).
 *
 * LINE's payload carries `destination`, the bot's own userId (a different value
 * from channel.line_channel_id, the numeric Channel ID) — the only thing in the
 * body that says which channel's secret this signature should be checked
 * against. That is why the order below reads the body before it verifies
 * anything: there is no secret to verify with until the channel is known.
 * Reading `destination` this way is safe on its own — JSON.parse does not
 * execute anything, and nothing parsed out of the body is acted on until after
 * the signature over the raw bytes has actually verified.
 *
 * Always answers 200 unless the channel or its signature cannot be trusted.
 * LINE retries a non-200, and a retry after a reward has been granted would
 * look to the player like a second chance — so a failure on our side, once we
 * know who we are talking to, must never become a retry on theirs. The error is
 * logged and the player still gets an answer (BR-01).
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text()

  let destination: string | null = null
  let events: IncomingEvent[] = []
  try {
    const body = JSON.parse(raw) as { destination?: unknown; events?: unknown }
    if (typeof body?.destination === 'string') destination = body.destination
    if (Array.isArray(body?.events)) events = body.events as IncomingEvent[]
  } catch {
    // LINE's console sends a signed body that is not our shape during setup.
    return Response.json({ ok: true })
  }

  // LINE's console verifies a webhook with an empty batch, sometimes before the
  // channel it belongs to even has a bot user id recorded on our side yet.
  // Nothing to do either way, and no reason to open a database connection or
  // check a signature to find that out.
  if (events.length === 0) return Response.json({ ok: true })

  // From here on there are real events to act on, so who sent them has to be
  // established for real: an unrecognised destination and a signature that
  // fails to verify against the channel it claims to belong to are refused the
  // same way (401) — neither is safe to guess at.
  if (!destination) {
    // TEMPORARY — ไล่บั๊ก 401 ของ Dew channel วันนี้ · destination ไม่ใช่ความลับ
    // (เป็น userId สาธารณะของบอทเอง คนคุยกับบอทเห็นได้อยู่แล้ว) log เต็มได้ปลอดภัย
    console.warn('webhook diagnostic: destination missing from body', { bodyPreview: raw.slice(0, 300) })
    return new Response('invalid signature', { status: 401 })
  }

  const sql = db()
  const channel = await findChannelByBotUserId(sql, destination)
  if (!channel) {
    // TEMPORARY — เหตุผลเดียวกับข้างบน
    console.warn('webhook diagnostic: no channel row matches this destination', { destination })
    return new Response('invalid signature', { status: 401 })
  }

  let verified: boolean
  try {
    const channelSecret = await readChannelSecret(sql, {
      channelId: channel.id, field: 'secret', purpose: 'verify_signature', appUserId: null,
    })
    verified = verifySignature(raw, request.headers.get('x-line-signature'), channelSecret)
    // TEMPORARY — เพื่อไล่ปัญหา 401 ที่เกิดจริงในโปรดักชันวันนี้ (Dew channel) โดยไม่
    // เผยกุญแจจริง: log แค่ความยาวของกุญแจที่อ่านได้ (บอกได้ว่าอ่านค่าว่างมาหรือเปล่า)
    // กับลายเซ็นที่คำนวณได้เทียบกับที่ LINE ส่งมา — ลายเซ็นเป็นผลลัพธ์จาก HMAC ทาง
    // เดียว ไม่ใช่กุญแจเอง จึง log เต็มได้อย่างปลอดภัย ต้องเอาออกหลังไล่บั๊กเสร็จ
    if (!verified) {
      console.warn('signature mismatch diagnostic', {
        channelId: channel.id,
        secretLength: channelSecret.length,
        bodyLength: raw.length,
        receivedSignature: request.headers.get('x-line-signature'),
        expectedSignature: createHmac('sha256', channelSecret).update(raw, 'utf8').digest('base64'),
      })
    }
  } catch (error) {
    // A channel row that exists but has no key yet (mid-setup) cannot be
    // verified against — that is not different from a signature that fails.
    console.error('failed to read channel secret for signature check', error)
    verified = false
  }
  if (!verified) {
    return new Response('invalid signature', { status: 401 })
  }

  const channelId = channel.lineChannelId ?? ''
  const accessToken = await readChannelSecret(sql, {
    channelId: channel.id, field: 'token', purpose: 'send_reply', appUserId: null,
  })
  const ports = makePorts(sql, channelId)
  const now = new Date()

  for (const event of events) {
    try {
      const handled = await handleEvent(event, channelId, ports, now, Math.random)
      if (handled) await replyMessage(accessToken, handled.replyToken, handled.message)

      // ผูกเมนูตัวเข้าให้ผู้เล่นแยกจากการตอบ — คนละความเสี่ยง (BR-01 ต้องได้คำตอบ
      // เสมอ ไม่ว่าเรื่องนี้จะสำเร็จหรือไม่) mark ว่าผูกแล้วเฉพาะตอนยิงสำเร็จจริง
      // เท่านั้น ล้มแล้วไม่ mark ข้อความถัดไปจะลองผูกใหม่เอง
      if (handled?.linkRichMenu) {
        try {
          const { participantId, lineUid, richMenuId } = handled.linkRichMenu
          await linkRichMenu(accessToken, lineUid, richMenuId)
          await ports.markRichMenuLinked(participantId)
        } catch (error) {
          console.error('link entry rich menu failed', error)
        }
      }
    } catch (error) {
      console.error('webhook event failed', error)
      // One event failing must not swallow the rest of the batch.
      if (event.replyToken) {
        await replyMessage(accessToken, event.replyToken, {
          type: 'text',
          text: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่',
        }).catch(() => {})
      }
    }
  }

  return Response.json({ ok: true })
}
