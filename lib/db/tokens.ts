import type postgres from 'postgres'
import { decryptSecret } from '../crypto/secretbox'

/**
 * ค่าที่ CHECK ของ token_access_log.purpose ยอมรับ (§5.2 + migration 0005)
 *
 * `test_send` เพิ่มโดย Task 14 สำหรับปุ่มส่งการ์ดทดสอบของ M3-S02 — คนละเหตุการณ์กับ
 * `send_reply` ซึ่งสงวนไว้ให้เส้นทางตอบผู้เล่นจริงผ่าน webhook (ยังไม่มีใครเรียกจริง
 * เพราะ replyMessage ยังอ่านโทเคนจาก env อยู่ ดู docs/HANDOFF.md หนี้ทางเทคนิคข้อ 1)
 */
export type TokenPurpose = 'send_reply' | 'publish' | 'verify_signature' | 'display_last4' | 'test_send'

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
