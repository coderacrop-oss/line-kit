import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** รุ่นของกุญแจที่ใช้เข้ารหัสของใหม่ · ของเก่ายังถอดด้วยรุ่นที่เขียนติดมากับแถว */
export const CURRENT_KEY_VERSION = 1

const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/** จำนวนตัวอักษรท้ายที่หน้าจอเห็นได้ (BR-16) */
const SHOWN_TAIL = 4

/**
 * กุญแจของรุ่นที่ขอ · อ่านจาก env ทุกครั้ง ไม่แคช
 *
 * Read on each call rather than captured at import time so a process that has
 * its keys injected late still works, and so a rotated key takes effect without
 * a restart. The error names the variable and nothing else — an error message is
 * a place secrets escape to.
 */
function keyFor(version: number): Buffer {
  const name = `SECRET_KEY_V${version}`
  const raw = process.env[name]
  if (!raw) throw new Error(`Missing environment variable: ${name}`)

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must be ${KEY_BYTES} bytes, base64 encoded`)
  }
  return key
}

/**
 * กุญแจของ LINE ถูกเข้ารหัสก่อนเก็บ (DD-03) และหน้าจอเห็นแค่สี่ตัวท้าย (BR-16)
 *
 * A channel access token lets whoever holds it speak as the brand, so it is
 * never written down in the clear.
 *
 * AES-GCM rather than plain AES: a ciphertext that has been altered must fail
 * loudly instead of decrypting into garbage that is then sent to LINE as a
 * bearer token, where the only symptom is a 401 from somebody else's server.
 *
 * The layout is iv ‖ tag ‖ body, base64. The IV is random per value, so the same
 * token encrypted twice does not produce the same row — two channels sharing a
 * token would otherwise be visible to anyone who can read the column. The key
 * version travels beside the value in its own column so keys rotate without one
 * migration rewriting every row at once.
 */
export function encryptSecret(plain: string): { cipher: string; keyVersion: number } {
  const iv = randomBytes(IV_BYTES)
  const box = createCipheriv('aes-256-gcm', keyFor(CURRENT_KEY_VERSION), iv)
  const body = Buffer.concat([box.update(plain, 'utf8'), box.final()])

  return {
    cipher: Buffer.concat([iv, box.getAuthTag(), body]).toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  }
}

/**
 * ถอดกลับ · ของที่ถูกแก้หรือกุญแจผิดรุ่น จะโยน ไม่ใช่คืนขยะ
 *
 * A value too short to hold an IV and a tag is rejected before the cipher gets
 * to guess at it: subarray() past the end returns an empty buffer rather than
 * failing, so without this a four-byte string would arrive at setAuthTag as an
 * empty tag and the shape of the failure would depend on the node version.
 */
export function decryptSecret(cipher: string, keyVersion: number): string {
  const key = keyFor(keyVersion)
  const raw = Buffer.from(cipher, 'base64')
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Stored secret is too short to be a ciphertext')
  }

  const box = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES))
  box.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  return Buffer.concat([box.update(raw.subarray(IV_BYTES + TAG_BYTES)), box.final()]).toString('utf8')
}

/**
 * สี่ตัวท้ายของกุญแจ · มากกว่านี้คือการรั่ว (BR-16)
 *
 * slice from the end is bounded by construction: it can only ever return a
 * suffix, and never more than four units of it, whatever arrives. That bound is
 * the whole contract — this is the only part of a key a screen is allowed to
 * carry, so it must not be able to grow.
 */
export function last4(plain: string): string {
  return plain.slice(-SHOWN_TAIL)
}
