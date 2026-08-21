const VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify'

export type LiffVerifyResult =
  | { ok: true; lineUserId: string }
  | { ok: false; reason: string }

/**
 * ยืนยัน id_token ของ LIFF กับ LINE จริงเสมอ ห้ามเชื่อ userId ที่เบราว์เซอร์อ้างมาตรงๆ
 * — LINE เป็นคนเซ็นรับรอง sub (LINE userId) ให้ ไม่ใช่เราถอด JWT เองแล้วเชื่อลอยๆ
 *
 * client_id ที่ส่งไปต้องเป็น Channel ID ของ LINE Login channel ที่ LIFF นั้นขึ้นทะเบียน
 * ไว้ (liff_app.line_login_channel_id) — คนละค่ากับ Messaging API channel เสมอ ส่งผิด
 * ตัวแล้ว LINE จะปฏิเสธ token ทุกใบ
 */
export async function verifyLiffIdToken(
  idToken: string, lineLoginChannelId: string,
): Promise<LiffVerifyResult> {
  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: lineLoginChannelId }).toString(),
    })

    const body = await response.json() as { sub?: string; aud?: string; error_description?: string }

    if (!response.ok) {
      return { ok: false, reason: body.error_description ?? `LINE ปฏิเสธ id_token (${response.status})` }
    }
    if (!body.sub) {
      return { ok: false, reason: 'LINE ตอบกลับมาโดยไม่มี sub — token นี้อ่านตัวตนไม่ได้' }
    }
    if (body.aud !== lineLoginChannelId) {
      return { ok: false, reason: 'audience ของ id_token ไม่ตรงกับ LINE Login channel ที่ลงทะเบียนไว้' }
    }

    return { ok: true, lineUserId: body.sub }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'
    return { ok: false, reason: `เชื่อมต่อ LINE ไม่ได้: ${message}` }
  }
}
