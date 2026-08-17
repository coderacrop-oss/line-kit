import type { LineMessage } from '../render/card'

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'
const WEBHOOK_ENDPOINT = 'https://api.line.me/v2/bot/channel/webhook/endpoint'

export function getChannelSecret(): string {
  return requireEnv('LINE_CHANNEL_SECRET')
}

export function getAccessToken(): string {
  return requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
}

/**
 * Replies to a single event. Reply messages are free; push messages are not, so
 * this is the only way anything leaves the system.
 *
 * The timeout matters more than it looks: a reply token expires, and a request
 * left hanging turns into silence the player cannot distinguish from a broken
 * bot (BR-01).
 */
export async function replyMessage(replyToken: string, message: LineMessage): Promise<void> {
  const response = await fetch(REPLY_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages: [message] }),
  })

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`)
  }
}

/**
 * ขั้น 6 ของ §4.4 · บอก LINE ว่าให้ส่ง event ของบัญชีนี้มาที่ไหน
 *
 * โทเคนเป็นพารามิเตอร์ ไม่ได้อ่านจาก env เหมือน replyMessage — การส่งขึ้นเกิดกับ
 * บัญชีที่คนกดเลือกบนจอ ซึ่งเป็นคนละบัญชีกันได้ในแต่ละครั้ง และโทเคนของบัญชีนั้น
 * อยู่ในฐานข้อมูลแบบเข้ารหัส · ตัวเรียกอ่านมันผ่าน readChannelSecret() ซึ่งบันทึก
 * ร่องรอยไว้ทุกครั้ง แล้วส่งเข้ามาที่นี่ · replyMessage ยังอ่านจาก env อยู่ ซึ่งคือ
 * หนี้ทางเทคนิคข้อ 1 ที่ยังไม่ถูกปลด — ไม่ใช่แบบแผนที่ควรทำตาม
 *
 * PUT ไม่ใช่ POST เพราะปลายทางนี้เป็นการตั้งค่าที่มีค่าเดียว การเรียกซ้ำด้วยค่าเดิม
 * จึงไม่สร้างของเพิ่ม ซึ่งเป็นสิ่งที่ต้องการเมื่อการส่งขึ้นถูกกดใหม่หลังล้มกลางทาง
 */
export async function setWebhookEndpoint(accessToken: string, endpoint: string): Promise<void> {
  const response = await fetch(WEBHOOK_ENDPOINT, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ endpoint }),
  })

  if (!response.ok) {
    throw new Error(
      `เชื่อมต่อ LINE ไม่สำเร็จ ตั้ง webhook ไม่ได้ (${response.status}) ${await response.text()}`,
    )
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
