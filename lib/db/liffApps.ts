// lib/db/liffApps.ts
import { timingSafeEqual } from 'node:crypto'
import type { Queryable } from './client'
import { decryptSecret, encryptSecret, last4 } from '../crypto/secretbox'

export type LiffApp = {
  id: string
  name: string
  liffId: string
  lineLoginChannelId: string
  channelId: string
  apiKeyLast4: string
  createdAt: Date
}

type LiffAppRow = {
  id: string
  name: string
  liff_id: string
  line_login_channel_id: string
  channel_id: string
  api_key_last4: string
  created_at: Date
}

function toLiffApp(row: LiffAppRow): LiffApp {
  return {
    id: row.id, name: row.name, liffId: row.liff_id,
    lineLoginChannelId: row.line_login_channel_id, channelId: row.channel_id,
    apiKeyLast4: row.api_key_last4, createdAt: row.created_at,
  }
}

const SELECT_COLUMNS = 'id, name, liff_id, line_login_channel_id, channel_id, api_key_last4, created_at'

export async function loadLiffAppByLiffId(sql: Queryable, liffId: string): Promise<LiffApp | null> {
  const [row] = await sql<LiffAppRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM liff_app WHERE liff_id = ${liffId}`
  return row ? toLiffApp(row) : null
}

export async function listLiffApps(sql: Queryable): Promise<LiffApp[]> {
  const rows = await sql<LiffAppRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM liff_app ORDER BY created_at DESC`
  return rows.map(toLiffApp)
}

export async function loadLiffApp(sql: Queryable, id: string): Promise<LiffApp | null> {
  const [row] = await sql<LiffAppRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM liff_app WHERE id = ${id}`
  return row ? toLiffApp(row) : null
}

/**
 * บันทึกกุญแจแบบเดียวกับที่ channel ทำ (DD-03) — เข้ารหัสก่อนเก็บเสมอ ไม่มีทาง
 * อ่านค่าเต็มกลับได้อีกหลัง insert แม้แต่จากในไฟล์นี้เอง
 *
 * encrypted_api_key เป็นคอลัมน์ BYTEA (ต่างจาก channel.encrypted_token ที่เป็น TEXT)
 * จึงต้องแปลง base64 cipher เป็น Buffer ก่อน insert ไม่งั้น postgres.js จะส่งเป็นพารามิเตอร์
 * ชนิด text แล้วอาศัย implicit cast ซึ่งไม่มีอยู่จริงสำหรับ text→bytea
 */
export async function createLiffApp(
  sql: Queryable,
  input: {
    name: string; liffId: string; lineLoginChannelId: string; channelId: string
    apiKey: string; createdBy: string
  },
): Promise<LiffApp> {
  const encrypted = encryptSecret(input.apiKey)
  const [row] = await sql<LiffAppRow[]>`
    INSERT INTO liff_app
           (name, liff_id, line_login_channel_id, channel_id, encrypted_api_key, api_key_last4, key_version, created_by)
    VALUES (${input.name}, ${input.liffId}, ${input.lineLoginChannelId}, ${input.channelId},
            ${Buffer.from(encrypted.cipher, 'base64')}, ${last4(input.apiKey)}, ${encrypted.keyVersion}, ${input.createdBy})
    RETURNING ${sql.unsafe(SELECT_COLUMNS)}`
  return toLiffApp(row)
}

/**
 * แก้ข้อมูล LIFF app ที่ลงทะเบียนไว้แล้ว — `apiKey: null` แปลว่าเว้นช่องไว้ตอนแก้ฟอร์ม
 * (ใช้กุญแจเดิมต่อ) เหตุผลเดียวกับ saveChannel ของ ../../app/(admin)/channels/actions.ts:
 * จอนี้ไม่มีทางโชว์กุญแจเต็มให้เห็นซ้ำได้เลย (BR-16 เดียวกัน) เว้นว่างไว้จึงต้องแปลว่า
 * "ไม่เปลี่ยน" ไม่ใช่ "ล้างค่า" ไม่งั้นแก้แค่ชื่อจะเผลอตัดการเชื่อมต่อของ LIFF ตัวจริงไปเงียบๆ
 */
export async function updateLiffApp(
  sql: Queryable,
  id: string,
  input: {
    name: string; liffId: string; lineLoginChannelId: string; channelId: string
    apiKey: string | null
  },
): Promise<LiffApp> {
  if (input.apiKey) {
    const encrypted = encryptSecret(input.apiKey)
    const [row] = await sql<LiffAppRow[]>`
      UPDATE liff_app
         SET name = ${input.name}, liff_id = ${input.liffId},
             line_login_channel_id = ${input.lineLoginChannelId}, channel_id = ${input.channelId},
             encrypted_api_key = ${Buffer.from(encrypted.cipher, 'base64')},
             api_key_last4 = ${last4(input.apiKey)}, key_version = ${encrypted.keyVersion}
       WHERE id = ${id}
       RETURNING ${sql.unsafe(SELECT_COLUMNS)}`
    return toLiffApp(row)
  }

  const [row] = await sql<LiffAppRow[]>`
    UPDATE liff_app
       SET name = ${input.name}, liff_id = ${input.liffId},
           line_login_channel_id = ${input.lineLoginChannelId}, channel_id = ${input.channelId}
     WHERE id = ${id}
     RETURNING ${sql.unsafe(SELECT_COLUMNS)}`
  return toLiffApp(row)
}

/** ลบ cascade เอา liff_session ของ LIFF app นี้ไปด้วยทั้งหมด (migration 0013) — เตือนผู้ใช้ก่อนเรียกเสมอ */
export async function deleteLiffApp(sql: Queryable, id: string): Promise<void> {
  await sql`DELETE FROM liff_app WHERE id = ${id}`
}

/**
 * เทียบแบบ constant-time เหมือน verifySignature() ของ lib/line/verify.ts — เหตุผล
 * เดียวกัน: เทียบสตริงลับด้วย === ธรรมดารั่วเวลาที่ใช้เทียบออกมาเป็นสัญญาณให้เดา
 * ทีละตัวอักษรได้ ไม่ต่างจากเปรียบเทียบลายเซ็น
 */
export async function verifyLiffApiKey(
  sql: Queryable, liffAppId: string, presentedKey: string,
): Promise<boolean> {
  const [row] = await sql<{ encrypted_api_key: Buffer; key_version: number }[]>`
    SELECT encrypted_api_key, key_version FROM liff_app WHERE id = ${liffAppId}`
  if (!row) return false

  const actual = decryptSecret(row.encrypted_api_key.toString('base64'), row.key_version)
  const expected = Buffer.from(actual)
  const received = Buffer.from(presentedKey)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}
