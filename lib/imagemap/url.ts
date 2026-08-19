/**
 * baseUrl ของริชเมสเสจหนึ่งใบ (`{baseUrl}` ที่ LINE เติม `/{width}` เองแล้วดึงภาพ)
 *
 * ประกอบจาก `PUBLIC_BASE_URL` (env เดียวกับที่ webhookEndpoint() ใน
 * app/(admin)/campaigns/[id]/publish/actions.ts ใช้ประกอบที่อยู่ webhook — คุณสมบัติ
 * ของที่ที่ระบบถูกติดตั้ง ไม่ใช่ของแคมเปญ) ต่อด้วย cardId — ไม่มีนามสกุลไฟล์ ไม่มี
 * "/" ต่อท้าย (BR-46 · LINE ไม่แสดงภาพเลยถ้ามี)
 *
 * คืน `null` แทนที่จะโยน error เมื่อยังไม่ได้ตั้งค่า — ต่างจาก webhookEndpoint() ที่
 * โยนตรงๆ เพราะจุดนั้นอยู่กลางขั้นตอน publish ซึ่งควรหยุดทั้งขบวนการถ้าตั้งค่าไม่ครบ
 * แต่ที่นี่อยู่กลางเส้นทางตอบผู้เล่นจริง (renderCard/loadCards) — ไม่มี PUBLIC_BASE_URL
 * ต้องยังตอบผู้เล่นด้วยข้อความสำรองได้ (BR-01) ไม่ใช่ทำให้ทั้งข้อความล้มเงียบๆ
 */
export function publicImagemapBaseUrl(cardId: string): string | null {
  const base = process.env.PUBLIC_BASE_URL
  if (!base) return null
  return `${base.replace(/\/+$/, '')}/api/imagemap/${cardId}`
}
