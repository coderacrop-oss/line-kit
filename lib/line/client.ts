import type { LineMessage } from '../render/card'

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'
const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const WEBHOOK_ENDPOINT = 'https://api.line.me/v2/bot/channel/webhook/endpoint'
const RICHMENU_ENDPOINT = 'https://api.line.me/v2/bot/richmenu'
const RICHMENU_VALIDATE_ENDPOINT = 'https://api.line.me/v2/bot/richmenu/validate'
const RICHMENU_ALIAS_ENDPOINT = 'https://api.line.me/v2/bot/richmenu/alias'
const RICHMENU_BATCH_ENDPOINT = 'https://api.line.me/v2/bot/richmenu/batch'
// L2 §5.2 (v0.17) · อัปโหลด/ดาวน์โหลดภาพเมนูยิงไปโดเมนนี้ คนละโดเมนกับคำสั่งอื่นทั้งหมด
const RICHMENU_DATA_HOST = 'https://api-data.line.me'

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
 * ส่งข้อความหนึ่งชิ้นถึงผู้ใช้คนเดียวโดยไม่ต้องมี event ต้นทาง — สิ่งที่ปุ่ม "ส่งการ์ด
 * ทดสอบ" ของ M3-S02 (Task 14) ต้องใช้ เพราะการกดปุ่มบนจอแอดมินไม่ใช่ event จาก LINE
 * จึงไม่มี reply token ให้ replyMessage ใช้
 *
 * โทเคนเป็นพารามิเตอร์เหมือน setWebhookEndpoint ไม่ใช่แบบ replyMessage ที่ยังอ่าน
 * env อยู่ (หนี้ทางเทคนิคข้อ 1 ของ docs/HANDOFF.md) — การ์ดทดสอบต้องออกจากบัญชี LINE
 * ประเภททดสอบที่ผู้เรียกเลือกมา ไม่ใช่บัญชีเดียวที่ผูกกับ process ตอนดีพลอย และ BR-62
 * ห้ามส่งผ่านบัญชีจริงของลูกค้าไม่ว่ากรณีใด — ตัวเรียก (Server Action) เป็นผู้เลือก
 * บัญชีและถอดกุญแจผ่าน readChannelSecret() ก่อนส่งเข้ามาที่นี่
 */
export async function pushMessage(accessToken: string, to: string, message: LineMessage): Promise<void> {
  const response = await fetch(PUSH_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages: [message] }),
  })

  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status} ${await response.text()}`)
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

export type LineRichMenuArea = {
  bounds: { x: number; y: number; width: number; height: number }
  action: Record<string, unknown>
}

export type LineRichMenuPayload = {
  size: { width: number; height: number }
  selected: boolean
  name: string
  chatBarText: string
  areas: LineRichMenuArea[]
}

/**
 * ขั้น 4b ของ §4.4 (BR-96) · ให้ LINE ตรวจโครงเมนูก่อนสร้างจริง
 *
 * `POST /v2/bot/richmenu/validate` ไม่กินโควตาการสร้าง (จำกัด 100 ครั้ง/ชั่วโมง)
 * ต้องผ่านทั้งด่านนี้และด่านของเรา (`lib/publish/validate.ts`) — ไม่ใช่ใช้แทนกัน
 * เพราะกฎผังช่องของเราเขียนจากเอกสารที่อ่านมา อาจไม่ตรงกับที่ LINE ตรวจจริง
 *
 * ล้มแล้วต้องโยนข้อความของ LINE ตรงๆ ห้ามแปลหรือย่อ (ERR-044) — ตัวเรียกเป็นคนแปะ
 * รหัส error ทางฝั่งแอป ฟังก์ชันนี้แค่ส่งต่อสิ่งที่ LINE ตอบมา
 */
export async function validateRichMenuObject(
  accessToken: string, payload: LineRichMenuPayload,
): Promise<void> {
  const response = await fetch(RICHMENU_VALIDATE_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`LINE ตรวจโครงเมนูไม่ผ่าน (${response.status}) ${await response.text()}`)
  }
}

/**
 * ขั้น 5 ของ §4.4 · สร้างเมนูจริงบน LINE แล้วคืน richMenuId ที่จะเก็บลง
 * `rich_menu.line_rich_menu_id`
 */
export async function createRichMenu(
  accessToken: string, payload: LineRichMenuPayload,
): Promise<{ richMenuId: string }> {
  const response = await fetch(RICHMENU_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`สร้าง Rich Menu ไม่สำเร็จ (${response.status}) ${await response.text()}`)
  }
  const body = await response.json() as { richMenuId: string }
  return { richMenuId: body.richMenuId }
}

/**
 * อัปโหลดภาพของเมนูที่สร้างไว้แล้ว · ยิงไป `api-data.line.me` ไม่ใช่ `api.line.me`
 * (L2 §5.2 v0.17) — ยิงผิดโดเมนแล้วอัปโหลดไม่ผ่านโดยไม่มีคำอธิบาย
 *
 * §4.4 เตือนไว้ตรงๆ — วาดไม่ครบ (เรียกฟังก์ชันนี้ไม่สำเร็จ) ต้องถือว่า publish ล้ม
 * ห้ามปล่อยผ่านเพราะจะมีเมนูที่ไม่มีภาพให้แสดง
 */
export async function uploadRichMenuImage(
  accessToken: string, richMenuId: string, image: { bytes: Uint8Array; contentType: string },
): Promise<void> {
  const response = await fetch(`${RICHMENU_DATA_HOST}/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': image.contentType, Authorization: `Bearer ${accessToken}` },
    body: image.bytes as BodyInit,
  })

  if (!response.ok) {
    throw new Error(`อัปโหลดภาพเมนูไม่สำเร็จ (${response.status}) ${await response.text()}`)
  }
}

/** รหัสสถานะที่ LINE ตอบเมื่อ alias นี้มีอยู่แล้ว — ต้องเรียกอัปเดตแทนการสร้างใหม่ */
const ALIAS_ALREADY_EXISTS = 409

/**
 * ขั้น 5b ของ §4.4 (BR-77) · ลงทะเบียน alias ให้ชี้ไปที่เมนูรุ่นล่าสุด
 *
 * alias ใหม่เอี่ยม (แคมเปญนี้เพิ่งใช้ชื่อนี้ครั้งแรก) → สร้าง (`POST .../alias`)
 * alias ที่มีอยู่แล้วจากแคมเปญก่อน (สร้างซ้ำแล้วโดน 409) → อัปเดตให้ชี้ใหม่แทน
 * (`POST .../alias/{id}`) — ไม่บังคับให้ผู้เรียกรู้ล่วงหน้าว่าเคยมีหรือยัง เพราะ
 * "เคยมีหรือยัง" เป็นสถานะของ LINE เอง ไม่ใช่สถานะที่ฝั่งเราต้องเก็บคู่ขนานไว้เอง
 */
export async function setRichMenuAlias(
  accessToken: string, alias: { richMenuAliasId: string; richMenuId: string },
): Promise<void> {
  const created = await fetch(RICHMENU_ALIAS_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(alias),
  })
  if (created.ok) return

  if (created.status !== ALIAS_ALREADY_EXISTS) {
    throw new Error(`ลงทะเบียน alias เมนูไม่สำเร็จ (${created.status}) ${await created.text()}`)
  }

  const updated = await fetch(`${RICHMENU_ALIAS_ENDPOINT}/${alias.richMenuAliasId}`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ richMenuId: alias.richMenuId }),
  })
  if (!updated.ok) {
    throw new Error(`ปรับ alias เมนูเดิมให้ชี้เมนูใหม่ไม่สำเร็จ (${updated.status}) ${await updated.text()}`)
  }
}

/**
 * ขั้น 5c ของ §4.4 (BR-97) · ย้ายคนที่แขวนเมนูรุ่นก่อนอยู่ ไปเมนูรุ่นใหม่ ทีเดียวยกชุด
 *
 * ห้ามสับสนกับ `POST /v2/bot/user/all/richmenu` (ตั้งเมนูเริ่มต้นทั้งบัญชี — ห้ามใช้)
 * ตัวนี้คือ `POST /v2/bot/richmenu/batch` ซึ่งย้ายเฉพาะคนที่ผูกกับเมนูเก่าอยู่จริง
 * ไม่แตะคนอื่น · ตัวเรียกเป็นคนแบ่ง operations ให้ไม่เกิน 1000 ต่อครั้ง
 * (`lib/richmenu/batch.ts` · `chunkOperations`) ก่อนเรียกฟังก์ชันนี้
 */
export async function linkRichMenuBatch(
  accessToken: string, operations: ReadonlyArray<{ type: 'link'; from: string; to: string }>,
): Promise<void> {
  const response = await fetch(RICHMENU_BATCH_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ operations }),
  })

  if (!response.ok) {
    throw new Error(`ย้ายผู้ใช้ไปเมนูรุ่นใหม่ไม่สำเร็จ (${response.status}) ${await response.text()}`)
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
