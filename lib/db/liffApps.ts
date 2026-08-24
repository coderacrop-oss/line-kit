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
