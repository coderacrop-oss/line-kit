'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { encryptSecret, last4 } from '@/lib/crypto/secretbox'
import type { ChannelType } from '@/lib/db/channels'
import { db } from '@/lib/db/client'

/**
 * ชั้นที่จอนี้สร้างหรือแก้ได้ · preview ไม่อยู่ในนี้
 *
 * The table's CHECK says a preview channel holds no keys, and keys are the only
 * thing this screen writes. Offering that tier would produce a row the database
 * refuses, explained to the person filling in the form by a constraint name.
 */
const BINDABLE_TYPES: readonly ChannelType[] = ['test', 'production']

const isBindable = (value: string): value is ChannelType =>
  (BINDABLE_TYPES as readonly string[]).includes(value)

const UNIQUE_VIOLATION = '23505'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/** ว่าง = ยังไม่ได้กรอก ไม่ใช่ค่าจริง — เขียนเป็น NULL ไม่ใช่สตริงว่าง เพราะคอลัมน์นี้ UNIQUE (BR-68) และหลายบัญชีที่ยังไม่กรอกต้องอยู่ด้วยกันได้ */
const trimmedOrNull = (formData: FormData, key: string) => trimmed(formData, key) || null

/**
 * ข้อความในกล่องเดียว กลายเป็นรายการคำ
 *
 * The keyword screen reads this column to warn that a word it is about to hand
 * out is already answered by the client's own auto-reply (BR-44). It compares
 * word by word, so one blob of text would produce exactly one collision and
 * never the right one. Duplicates are dropped because two identical rows warn
 * about the same thing twice and teach the reader to skip the box.
 */
function asKeywordList(raw: string): string[] {
  // \r ที่ติดมากับการก๊อปจากวินโดวส์ถูก trim กินไปแล้ว จึงไม่ต้องแยกด้วย \r?\n
  const words = raw.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return [...new Set(words)]
}

/**
 * ผูกบัญชี LINE ใหม่ หรือแก้ของเดิม · ผู้ตั้งค่าแคมเปญเท่านั้น
 *
 * A channel access token lets whoever holds it speak as the brand, so it is
 * encrypted before it is written (DD-03) and only its last four characters are
 * kept in the clear (BR-16). Nothing that leaves this file can read it back —
 * lib/db/channels.ts does not select the encrypted columns at all.
 *
 * Leaving both key fields blank while editing keeps the keys that are already
 * there. The screen cannot show a key, so it cannot put it back in the field
 * either; reading blank as "clear it" would make every rename silently unbind
 * the OA, and the campaign would stop replying with no screen able to say why.
 *
 * Both keys move together or neither does. Rotating one leaves a token from one
 * OA beside a secret from another, which fails at LINE as a signature that never
 * verifies rather than as anything this system reports.
 *
 * The channel id is bound to the action rather than carried in the form: the
 * form is written by whoever submits it, and this is the one screen where that
 * distinction is worth the extra argument.
 */
export async function saveChannel(id: string | null, formData: FormData): Promise<void> {
  const session = await requireRole('configurator')
  const sql = db()

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องตั้งชื่อบัญชีให้ทีมรู้ว่าเป็นบัญชีไหน')

  const channelType = trimmed(formData, 'channel_type')
  if (!isBindable(channelType)) {
    throw new Error('ชั้นของบัญชีต้องเป็นบัญชีทดสอบหรือบัญชีจริงของลูกค้า')
  }

  if (id) {
    const [current] = await sql<{ channel_type: string }[]>`
      SELECT channel_type FROM channel WHERE id = ${id}`
    if (!current) throw new Error('ไม่พบบัญชี LINE นี้')
    if (current.channel_type === 'preview') {
      throw new Error('บัญชีสำหรับทดลองเล่นในระบบไม่มีกุญแจให้แก้ — ระบบเป็นคนสร้างไว้เอง')
    }
  }

  const token = trimmed(formData, 'access_token')
  const secret = trimmed(formData, 'channel_secret')
  const keywords = asKeywordList(String(formData.get('existing_keywords') ?? ''))
  const lineChannelId = trimmedOrNull(formData, 'line_channel_id')

  if (!token && !secret) {
    // แก้ของเดิมโดยไม่แตะกุญแจ · บัญชีใหม่ต้องมีกุญแจ เพราะ CHECK ของตารางบังคับ
    if (!id) throw new Error('บัญชีใหม่ต้องมีกุญแจทั้งสองตัวจาก LINE Developers Console')

    try {
      await sql`
        UPDATE channel
           SET name = ${name}, channel_type = ${channelType},
               existing_keywords = ${sql.array(keywords)},
               line_channel_id = ${lineChannelId}
         WHERE id = ${id}`
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new Error('Channel ID นี้ถูกผูกกับบัญชีอื่นอยู่แล้ว — หนึ่ง Channel ID ผูกได้แถวเดียว')
      }
      throw error
    }

    revalidatePath('/channels')
    redirect('/channels')
    return
  }

  if (!token || !secret) {
    throw new Error('กุญแจต้องเปลี่ยนพร้อมกันทั้งสองช่อง — โทเคนของ OA หนึ่งกับซีเคร็ตของอีก OA หนึ่งใช้ด้วยกันไม่ได้')
  }

  const encryptedToken = encryptSecret(token)
  const encryptedSecret = encryptSecret(secret)

  try {
    if (id) {
      await sql`
        UPDATE channel
           SET name = ${name}, channel_type = ${channelType},
               existing_keywords = ${sql.array(keywords)},
               line_channel_id = ${lineChannelId},
               encrypted_token = ${encryptedToken.cipher},
               encrypted_secret = ${encryptedSecret.cipher},
               token_last4 = ${last4(token)},
               key_version = ${encryptedToken.keyVersion}
         WHERE id = ${id}`
    } else {
      await sql`
        INSERT INTO channel
               (name, channel_type, existing_keywords, line_channel_id,
                encrypted_token, encrypted_secret, token_last4, key_version, created_by)
        VALUES (${name}, ${channelType}, ${sql.array(keywords)}, ${lineChannelId},
                ${encryptedToken.cipher}, ${encryptedSecret.cipher},
                ${last4(token)}, ${encryptedToken.keyVersion}, ${session.userId})`
    }
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error('Channel ID นี้ถูกผูกกับบัญชีอื่นอยู่แล้ว — หนึ่ง Channel ID ผูกได้แถวเดียว')
    }
    throw error
  }

  revalidatePath('/channels')
  redirect('/channels')
}
