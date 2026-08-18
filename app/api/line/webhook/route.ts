import { db } from '@/lib/db/client'
import { makePorts } from '@/lib/db/queries'
import { getAccessToken, getChannelSecret, linkRichMenu, replyMessage } from '@/lib/line/client'
import { verifySignature } from '@/lib/line/verify'
import { handleEvent, type IncomingEvent } from '@/lib/webhook/handle'

/** The channel this deployment serves. One OA runs one campaign at a time (BR-68). */
function lineChannelId(): string {
  const id = process.env.LINE_CHANNEL_ID
  if (!id) throw new Error('Missing environment variable: LINE_CHANNEL_ID')
  return id
}

/**
 * The single entry point from LINE.
 *
 * Always answers 200 unless the signature is wrong. LINE retries a non-200, and
 * a retry after a reward has been granted would look to the player like a second
 * chance — so a failure on our side must never become a retry on theirs. The
 * error is logged and the player still gets an answer (BR-01).
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text()

  if (!verifySignature(raw, request.headers.get('x-line-signature'), getChannelSecret())) {
    return new Response('invalid signature', { status: 401 })
  }

  let events: IncomingEvent[] = []
  try {
    const body = JSON.parse(raw) as { events?: unknown }
    if (Array.isArray(body?.events)) events = body.events as IncomingEvent[]
  } catch {
    // LINE's console sends a signed body that is not our shape during setup.
    return Response.json({ ok: true })
  }

  // LINE's console verifies a webhook with an empty batch. Nothing to do, and
  // no reason to open a database connection to find that out.
  if (events.length === 0) return Response.json({ ok: true })

  const channelId = lineChannelId()
  const ports = makePorts(db(), channelId)
  const now = new Date()

  for (const event of events) {
    try {
      const handled = await handleEvent(event, channelId, ports, now, Math.random)
      if (handled) await replyMessage(handled.replyToken, handled.message)

      // ผูกเมนูตัวเข้าให้ผู้เล่นแยกจากการตอบ — คนละความเสี่ยง (BR-01 ต้องได้คำตอบ
      // เสมอ ไม่ว่าเรื่องนี้จะสำเร็จหรือไม่) mark ว่าผูกแล้วเฉพาะตอนยิงสำเร็จจริง
      // เท่านั้น ล้มแล้วไม่ mark ข้อความถัดไปจะลองผูกใหม่เอง
      if (handled?.linkRichMenu) {
        try {
          const { participantId, lineUid, richMenuId } = handled.linkRichMenu
          await linkRichMenu(getAccessToken(), lineUid, richMenuId)
          await ports.markRichMenuLinked(participantId)
        } catch (error) {
          console.error('link entry rich menu failed', error)
        }
      }
    } catch (error) {
      console.error('webhook event failed', error)
      // One event failing must not swallow the rest of the batch.
      if (event.replyToken) {
        await replyMessage(event.replyToken, {
          type: 'text',
          text: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่',
        }).catch(() => {})
      }
    }
  }

  return Response.json({ ok: true })
}
