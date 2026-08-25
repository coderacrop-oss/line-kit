import type postgres from 'postgres'
import { decryptSecret } from '../crypto/secretbox'

/**
 * ค่าที่ CHECK ของ token_access_log.purpose ยอมรับ (§5.2 + migration 0005 + 0012)
 *
 * `test_send` เพิ่มโดย Task 14 สำหรับปุ่มส่งการ์ดทดสอบของ M3-S02 — คนละเหตุการณ์กับ
 * `send_reply` ซึ่งสงวนไว้ให้เส้นทางตอบผู้เล่นจริงผ่าน webhook (route.ts เรียกด้วย
 * purpose นี้ทุกครั้งที่ตอบ — replyMessage เลิกอ่านโทเคนจาก env แล้ว ดู migration
 * 0010_channel_bot_user_id.sql)
 *
 * `fetch_bot_info` เพิ่มโดย migration 0012 สำหรับปุ่ม "ดึง Bot User ID อัตโนมัติ" ของจอ
 * แก้บัญชี LINE — คนละเหตุการณ์กับทั้ง `test_send` (ส่งข้อความออกไปหาผู้เล่น) และ
 * `publish` (ส่งขึ้นแคมเปญ) เพราะที่นี่แค่ "ถาม" LINE ว่าบอทตัวนี้คือ userId อะไร
 * ไม่ได้ส่งอะไรออกไปหาใครเลย และเกิดเฉพาะตอนช่อง Channel access token บนฟอร์มถูก
 * เว้นว่างไว้ (แก้บัญชีเดิมโดยไม่พิมพ์โทเคนใหม่) จึงต้องอ่านโทเคนที่เก็บไว้แล้วผ่าน
 * readChannelSecret() — พิมพ์โทเคนใหม่มาตรงๆ ในฟอร์มไม่ต้องอ่านจากตรงนี้เลย เพราะมีค่า
 * อยู่ในมือ (ฝั่ง client) แล้ว
 *
 * `push_notify` เพิ่มโดย migration 0016 สำหรับการส่งข้อความอัตโนมัติที่เริ่มต้นจากเซิร์ฟเวอร์
 * (เช่น การแจ้งเตือนการจับคู่สำหรับโหมด duo ของ quiz engine) — คนละเหตุการณ์กับ
 * `send_reply` (ตอบสิ่งที่ผู้เล่นส่งมา) และ `test_send` (การส่งทดสอบด้วยตนเอง)
 */
export type TokenPurpose =
  | 'send_reply' | 'publish' | 'verify_signature' | 'display_last4' | 'test_send' | 'fetch_bot_info' | 'push_notify'

/** สองกุญแจที่บัญชีหนึ่งบัญชีเก็บไว้ · โทเคนไว้พูด ซีเคร็ตไว้ตรวจว่าใครพูด */
export type SecretField = 'token' | 'secret'

type SecretRow = {
  encrypted_token: string | null
  encrypted_secret: string | null
  key_version: number | null
}

/**
 * ทางเดียวที่กุญแจของบัญชีจะกลายเป็นข้อความอ่านได้ และทุกครั้งมีร่องรอย
 *
 * decryptSecret() on its own does not know which channel it is working for or
 * who asked, so it cannot write the audit row. Putting the two together in one
 * exported function is what makes "every decrypt is logged" a property of the
 * code rather than a rule people remember: there is no other way to reach the
 * plaintext, because no other query selects the encrypted columns.
 *
 * The row goes in before the decrypt, not after. token_access_log cannot be
 * backfilled — a read that failed, or one that succeeded and then threw on its
 * way out, is exactly the read someone will want to find later.
 *
 * A missing channel is refused without a row because the foreign key has
 * nothing to point at; that call never reached a key either.
 */
export async function readChannelSecret(
  sql: postgres.Sql,
  opts: {
    channelId: string
    field: SecretField
    purpose: TokenPurpose
    /** null = ระบบอ่านเอง เช่นตอนตอบ webhook · ไม่ใช่คนกด */
    appUserId: string | null
  },
): Promise<string> {
  const [row] = await sql<SecretRow[]>`
    SELECT encrypted_token, encrypted_secret, key_version FROM channel WHERE id = ${opts.channelId}`
  if (!row) throw new Error('ไม่พบบัญชี LINE นี้')

  const cipher = opts.field === 'token' ? row.encrypted_token : row.encrypted_secret
  if (!cipher || row.key_version === null) {
    throw new Error('บัญชีนี้ยังไม่ได้ผูกกุญแจของ LINE')
  }

  await sql`
    INSERT INTO token_access_log (channel_id, actor_type, app_user_id, purpose)
    VALUES (${opts.channelId}, ${opts.appUserId ? 'user' : 'system'},
            ${opts.appUserId}, ${opts.purpose})`

  return decryptSecret(cipher, row.key_version)
}
