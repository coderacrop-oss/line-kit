// lib/liff/auth.ts
import type { Queryable } from '../db/client'
import { loadLiffAppByLiffId, verifyLiffApiKey, type LiffApp } from '../db/liffApps'
import { ensureParticipantByChannelId } from '../db/participants'
import { verifyLiffIdToken } from '../line/liffVerify'

export type LiffAuthResult =
  | { ok: true; participantId: string; liffApp: LiffApp }
  | { ok: false; status: 401 | 404; reason: string }

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

/**
 * จุดเดียวที่ทั้งสองทางตรวจตัวตน (id_token จากเบราว์เซอร์ / API key จาก server-to-
 * server) มาบรรจบกัน — คืนรูปร่างเดียวกันเสมอ ให้ route ที่เรียกใช้ไม่ต้องรู้เลยว่า
 * ทางไหนผ่านมา (spec §5)
 *
 * ลองทาง API key ก่อนเสมอ เพราะ bearer token ทั้งสองแบบหน้าตาเหมือนกันจากมุมมองของ
 * header — ตรงกับกุญแจที่ลงทะเบียนไว้ก็จบที่ทางนี้เลย ไม่เรียก LINE verify endpoint
 * โดยไม่จำเป็น (ประหยัด round-trip และไม่เผลอ log เป็น "id_token ไม่ถูกต้อง" ผิดเรื่อง)
 */
export async function resolveLiffParticipant(
  sql: Queryable, liffId: string, request: Request, body?: { lineUserId?: string },
): Promise<LiffAuthResult> {
  const liffApp = await loadLiffAppByLiffId(sql, liffId)
  if (!liffApp) return { ok: false, status: 404, reason: 'ไม่พบ LIFF นี้ในระบบ' }

  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, reason: 'ไม่มี Authorization header' }

  const keyMatches = await verifyLiffApiKey(sql, liffApp.id, token)

  /**
   * lineUserId ของทาง API key อ่านจาก header X-Line-User-Id เป็นหลัก ไม่ใช่ body —
   * เพราะ GET request ส่ง body ไม่ได้จริงในทางปฏิบัติ (fetch ของเบราว์เซอร์และ undici
   * ของ Node ปฏิเสธการแนบ body คู่กับ method GET ตรงๆ) จึงต้องมีช่องทางเดียวที่ใช้ได้
   * เหมือนกันทั้ง GET และ PUT — พารามิเตอร์ body ยังรับไว้เป็น fallback เผื่อผู้เรียกเดิม
   * ที่ยิง PUT พร้อม body อยู่แล้ว (ทางนั้นยังทำงานเหมือนเดิมโดยไม่ต้องแก้อะไร)
   */
  const lineUserId = request.headers.get('X-Line-User-Id') ?? body?.lineUserId

  /**
   * มี lineUserId (จาก header หรือ body) มาได้จากทาง server-to-server เท่านั้น (ไม่มี
   * browser context ให้เดา sub) ดังนั้นแค่มีค่านี้ก็เพียงพอจะฟันธงว่าผู้เรียกตั้งใจใช้
   * ทาง API key — ถ้ากุญแจไม่ตรงต้องตอบ 401 ของทาง API key ตรงๆ ไม่ใช่ตกไปลอง verify
   * เป็น id_token ต่อ (bearer ตัวนี้ไม่มีทางเป็น id_token ที่ถูกต้องอยู่แล้วในเคสนี้)
   */
  if (keyMatches || lineUserId !== undefined) {
    if (!keyMatches) return { ok: false, status: 401, reason: 'API key ไม่ถูกต้อง' }
    if (!lineUserId) {
      return {
        ok: false, status: 401,
        reason: 'เรียกด้วย API key ต้องระบุ lineUserId มาใน header X-Line-User-Id (หรือ body) ด้วย — ไม่มีบริบทเบราว์เซอร์ให้เดาตัวตนได้',
      }
    }
    const participantId = await ensureParticipantByChannelId(sql, liffApp.channelId, lineUserId)
    return { ok: true, participantId, liffApp }
  }

  const verified = await verifyLiffIdToken(token, liffApp.lineLoginChannelId)
  if (!verified.ok) return { ok: false, status: 401, reason: verified.reason }

  const participantId = await ensureParticipantByChannelId(sql, liffApp.channelId, verified.lineUserId)
  return { ok: true, participantId, liffApp }
}
