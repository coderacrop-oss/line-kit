'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { encryptSecret, last4 } from '@/lib/crypto/secretbox'
import type { ChannelType } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { readChannelSecret } from '@/lib/db/tokens'
import { getBotInfo } from '@/lib/line/client'

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

/**
 * ทั้ง line_channel_id และ line_bot_user_id เป็น UNIQUE เต็มทั้งคู่ (BR-68 / migration
 * 0010) — คนละคอลัมน์ คนละความหมาย ข้อความที่โชว์บนจอจึงต้องบอกให้ตรงว่าใครชนกับใคร
 * ไม่ใช่ข้อความเดียวเหมารวมทั้งสองคอลัมน์ · postgres.js ใส่ constraint_name ของ error
 * มาให้ (ชื่อ default ของ Postgres คือ `<table>_<column>_key`) จึงอ่านจากตรงนั้นได้
 * โดยไม่ต้องเดา
 */
function uniqueViolationMessage(error: unknown): unknown {
  const pgError = error as { code?: string; constraint_name?: string }
  if (pgError.code !== UNIQUE_VIOLATION) return error

  if (pgError.constraint_name?.includes('line_bot_user_id')) {
    return new Error('userId ของบอทนี้ถูกผูกกับบัญชีอื่นอยู่แล้ว — บอทหนึ่งตัวผูกได้แถวเดียว')
  }
  return new Error('Channel ID นี้ถูกผูกกับบัญชีอื่นอยู่แล้ว — หนึ่ง Channel ID ผูกได้แถวเดียว')
}

/**
 * error ที่ไม่คาดคิดจริงๆ (ไม่ใช่ Error instance) ยังต้องมีข้อความให้คนอ่านได้อยู่ดี —
 * ไม่ใช่ปล่อยให้ ActionResult พังหรือแสดง "undefined" (เหตุผลเดียวกับ resultMessage
 * ของ ../campaigns/[id]/publish/actions.ts)
 */
const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

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
 *
 * คืนค่า `ActionResult` แทนที่จะ throw/redirect ตรงๆ — จอนี้เจอบั๊กเดียวกับที่
 * createMenu/saveMenu ของ Rich Menu (../campaigns/[id]/richmenu/actions.ts) และ
 * publish() (../campaigns/[id]/publish/actions.ts) เจอมาแล้ว: Next.js เซ็นเซอร์
 * ข้อความของ error ที่ throw ออกจาก Server Action ทิ้งเสมอในโปรดักชัน (พิสูจน์จริงกับ
 * `next build && next start` แล้ว) — คนที่กรอกกุญแจมาแค่ช่องเดียวเคยเจอเคสนี้จริง:
 * บันทึกไม่สำเร็จเงียบๆ (token_last4 ไม่ขยับ) โดยไม่มีข้อความอะไรบอกว่าทำไม ห้าม
 * throw หรือ redirect ข้าม Server Action boundary เด็ดขาด ให้ฝั่ง client ทำ
 * navigation เองด้วย useRouter() แทนเสมอ — ดู ChannelForm.tsx
 */
export async function saveChannel(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
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
    const lineBotUserId = trimmedOrNull(formData, 'line_bot_user_id')

    if (!token && !secret) {
      // แก้ของเดิมโดยไม่แตะกุญแจ · บัญชีใหม่ต้องมีกุญแจ เพราะ CHECK ของตารางบังคับ
      if (!id) throw new Error('บัญชีใหม่ต้องมีกุญแจทั้งสองตัวจาก LINE Developers Console')

      try {
        await sql`
          UPDATE channel
             SET name = ${name}, channel_type = ${channelType},
                 existing_keywords = ${sql.array(keywords)},
                 line_channel_id = ${lineChannelId},
                 line_bot_user_id = ${lineBotUserId}
           WHERE id = ${id}`
      } catch (error) {
        throw uniqueViolationMessage(error)
      }

      revalidatePath('/channels')
      return { ok: true }
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
                 line_bot_user_id = ${lineBotUserId},
                 encrypted_token = ${encryptedToken.cipher},
                 encrypted_secret = ${encryptedSecret.cipher},
                 token_last4 = ${last4(token)},
                 key_version = ${encryptedToken.keyVersion}
           WHERE id = ${id}`
      } else {
        await sql`
          INSERT INTO channel
                 (name, channel_type, existing_keywords, line_channel_id, line_bot_user_id,
                  encrypted_token, encrypted_secret, token_last4, key_version, created_by)
          VALUES (${name}, ${channelType}, ${sql.array(keywords)}, ${lineChannelId}, ${lineBotUserId},
                  ${encryptedToken.cipher}, ${encryptedSecret.cipher},
                  ${last4(token)}, ${encryptedToken.keyVersion}, ${session.userId})`
      }
    } catch (error) {
      throw uniqueViolationMessage(error)
    }

    revalidatePath('/channels')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}

/**
 * ผลของปุ่ม "ดึง Bot User ID อัตโนมัติ" — พ่วง userId ที่ได้จาก LINE มาด้วยตอนสำเร็จ
 * ใช้ ActionResult ตรงๆ ไม่ได้เพราะที่นั่นไม่มีที่เก็บค่า (เหตุผลเดียวกับที่ PublishResult
 * ของ ../campaigns/[id]/publish/actions.ts แยกออกมาเป็นของตัวเอง เพราะผลสำเร็จต้อง
 * พ่วง versionNo) — คนละบริบทกับ ActionResult ที่ใช้ร่วมกับ saveChannel ข้างบนได้
 * เพราะที่นั่นผลสำเร็จไม่มีอะไรให้ฝั่ง client อ่านต่อนอกจาก ok:true เฉยๆ
 */
export type FetchBotInfoResult = { ok: true; userId: string } | { ok: false; message: string }

/**
 * ดึง userId ตัวจริงของบอทจาก LINE มาเติมช่อง Bot user ID ให้เอง — แก้ปัญหาที่เพิ่งทำ
 * บัญชีจริงพังไปหลายชั่วโมง: คนกรอกช่องนี้ผิดเพราะไปก๊อปค่า "Your user ID" จากแท็บ
 * Basic settings ของ LINE Developers Console มา ซึ่งเป็น userId ส่วนตัวของนักพัฒนา
 * ไม่ใช่ของบอทเลย (ดู comment ของ getBotInfo() ใน lib/line/client.ts)
 *
 * โทเคนที่ใช้เรียก LINE มาจากสองทางแล้วแต่สถานการณ์ของฟอร์มตอนกดปุ่ม:
 *
 * 1) ช่อง Channel access token มีค่าอยู่ (กำลังสร้างบัญชีใหม่ หรือกำลังพิมพ์โทเคนใหม่
 *    ทับของเดิม) → ใช้ค่านั้นตรงๆ ที่ส่งมากับ FormData ไม่ต้องแตะฐานข้อมูลเลย เพราะค่า
 *    ยังไม่ถูกเข้ารหัสเก็บที่ไหน
 * 2) ช่องนั้นถูกเว้นว่างไว้ตอนแก้บัญชีเดิม (ความหมายคือ "ใช้กุญแจเดิม" — ดู saveChannel
 *    ด้านบน) → หน้าเว็บไม่มีโทเคนตัวจริงให้ใช้เลย ต้องอ่านของที่เข้ารหัสเก็บไว้แล้วผ่าน
 *    readChannelSecret() (บันทึกร่องรอยทุกครั้งเหมือนทุกจุดที่อ่านกุญแจ) แล้วค่อยเรียก
 *    LINE — ไม่มีทางไหนที่โทเคนที่ถอดแล้วไหลกลับไปถึงฝั่ง client เลย คืนแค่ userId
 *
 * คืนค่า FetchBotInfoResult เสมอ ไม่ throw ข้าม Server Action boundary — เหตุผลเดียวกับ
 * saveChannel ทุกประการ (ดู comment ยาวด้านบน)
 */
export async function fetchBotUserId(id: string | null, formData: FormData): Promise<FetchBotInfoResult> {
  try {
    const session = await requireRole('configurator')

    const typedToken = trimmed(formData, 'access_token')
    let token = typedToken

    if (!token) {
      if (!id) {
        throw new Error('กรอก Channel access token ก่อน หรือบันทึกบัญชีนี้ไว้ก่อนแล้วค่อยกดดึงอัตโนมัติ')
      }
      token = await readChannelSecret(db(), {
        channelId: id, field: 'token', purpose: 'fetch_bot_info', appUserId: session.userId,
      })
    }

    const { userId } = await getBotInfo(token)
    return { ok: true, userId }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'ดึง Bot User ID จาก LINE ไม่สำเร็จ — ลองใหม่') }
  }
}
