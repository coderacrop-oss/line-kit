/**
 * เพดานของไฟล์ที่คลังภาพรับ · §5.2 ตาราง `asset`
 *
 * The ceilings are LINE's, not ours. They are written here as numbers with names
 * so a screen, an action and a test all quote the same value: a limit repeated
 * as a literal in three places is a limit that will be three different numbers
 * by the time somebody raises it.
 *
 * 1 MB means 1,048,576 bytes rather than 1,000,000. The difference is 48 KB of
 * files that would be accepted or refused depending on which meaning the reader
 * had in mind, and the file manager the person is looking at says the first one.
 */
export const IMAGE_MAX_BYTES = 1024 * 1024
export const VIDEO_MAX_BYTES = 10 * 1024 * 1024
export const VIDEO_MAX_SEC = 60

/**
 * ภาพต้องกว้างพอจะเป็นภาพเมนูได้ · 800–2500 และสูงอย่างน้อย 250
 *
 * The floor is not about quality. A rich menu image is scaled to the width of
 * the chat, so anything narrower arrives in the conversation visibly soft, and
 * the person who uploaded it finds out from a customer rather than from here.
 */
export const IMAGE_MIN_WIDTH = 800
export const IMAGE_MAX_WIDTH = 2500
export const IMAGE_MIN_HEIGHT = 250

/** ชนิดที่รับ · คู่กับ CHECK ของคอลัมน์ media_type */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const
export const VIDEO_MIME_TYPES = ['video/mp4'] as const

export type UploadCandidate = {
  mime: string
  bytes: number
  width: number
  height: number
  /** วินาที · มีเฉพาะวิดีโอ และวิดีโอที่ไม่มีค่านี้ถูกปฏิเสธ */
  durationSec?: number
}

export type UploadVerdict = { ok: true } | { ok: false; reason: string }

/** คั่นหลักพันเองแทน toLocaleString · ผลของ toLocaleString ขึ้นกับ ICU ที่ node ถูกคอมไพล์มา */
const grouped = (n: number): string => {
  const digits = String(Math.trunc(Math.abs(n)))
  const parts = []
  for (let i = digits.length; i > 0; i -= 3) parts.unshift(digits.slice(Math.max(0, i - 3), i))
  return (n < 0 ? '-' : '') + parts.join(',')
}

/**
 * ขนาดไฟล์อย่างที่คนพูดถึงมัน
 *
 * KB below a megabyte and MB above it, because that is what the file manager on
 * the other screen says. It is a label, not a measurement — every message that
 * uses it also carries the exact byte count, since a file one byte over the
 * ceiling rounds to the ceiling and "1.0 MB เกินเพดาน 1 MB" reads as a bug.
 */
export function describeBytes(bytes: number): string {
  if (bytes < IMAGE_MAX_BYTES) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / IMAGE_MAX_BYTES).toFixed(1)} MB`
}

const tooBig = (bytes: number, limit: number, limitLabel: string, what: string): string =>
  `ไฟล์ ${describeBytes(bytes)} (${grouped(bytes)} ไบต์) เกินเพดาน${what} ${limitLabel}`
  + ` (${grouped(limit)} ไบต์) — บีบอัดก่อนแล้วลองใหม่`

/**
 * ไฟล์นี้ขึ้นคลังได้ไหม และถ้าไม่ได้ เพราะอะไร
 *
 * Every refusal carries the number that was measured next to the number that was
 * allowed. "ไฟล์ไม่ถูกต้อง" tells a person holding a 2 MB export nothing they
 * can act on; "1.9 MB เกินเพดาน 1 MB" tells them to compress it, and by how much.
 *
 * Images and videos are checked against their own ceilings and nothing else's. A
 * video is refused for its length or for its size, never for both at once and
 * never for one while the other is the actual problem — a message naming the
 * wrong limit sends somebody off to re-encode a file that was already fine.
 *
 * Dimensions of zero are read as "nobody could measure this", not as a picture
 * with no width. Nothing that got this far should have unmeasured dimensions,
 * and writing a zero into a NOT NULL column is how a row that cannot be rendered
 * ends up looking like a row that can.
 */
export function validateUpload(file: UploadCandidate): UploadVerdict {
  const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(file.mime)
  const isVideo = (VIDEO_MIME_TYPES as readonly string[]).includes(file.mime)

  if (!isImage && !isVideo) {
    return {
      ok: false,
      reason: `ไฟล์ชนิด ${file.mime} ใช้ไม่ได้ — รับเฉพาะภาพ JPEG หรือ PNG และวิดีโอ MP4`,
    }
  }

  if (file.bytes <= 0) {
    return { ok: false, reason: 'ไฟล์ว่าง ไม่มีข้อมูลอยู่ข้างใน — อัปโหลดใหม่อีกครั้ง' }
  }

  if (file.width <= 0 || file.height <= 0) {
    return {
      ok: false,
      reason: 'อ่านขนาดของภาพในไฟล์นี้ไม่ออก — ไฟล์อาจเสียหายหรือไม่ใช่ชนิดที่บอกไว้',
    }
  }

  if (isVideo) {
    if (file.durationSec === undefined) {
      return {
        ok: false,
        reason: 'อ่านความยาวของวิดีโอไฟล์นี้ไม่ออก — ระบบไม่เดาความยาวให้ เพราะ LINE ปฏิเสธคลิปที่ยาวเกินหนึ่งนาทีตอนส่ง ไม่ใช่ตอนอัปโหลด',
      }
    }
    if (file.durationSec <= 0) {
      return { ok: false, reason: `ความยาว ${file.durationSec} วินาที ไม่ใช่ความยาวของคลิปที่เล่นได้` }
    }
    if (file.bytes > VIDEO_MAX_BYTES) {
      return { ok: false, reason: tooBig(file.bytes, VIDEO_MAX_BYTES, '10 MB', 'ของวิดีโอ') }
    }
    if (file.durationSec > VIDEO_MAX_SEC) {
      return {
        ok: false,
        reason: `วิดีโอยาว ${file.durationSec} วินาที เกินเพดาน ${VIDEO_MAX_SEC} วินาที — ตัดให้สั้นลงก่อน`,
      }
    }
    return { ok: true }
  }

  if (file.bytes > IMAGE_MAX_BYTES) {
    return { ok: false, reason: tooBig(file.bytes, IMAGE_MAX_BYTES, '1 MB', 'ของภาพ') }
  }

  if (file.width < IMAGE_MIN_WIDTH || file.width > IMAGE_MAX_WIDTH) {
    return {
      ok: false,
      reason: `ภาพกว้าง ${file.width} px — ต้องกว้างระหว่าง ${IMAGE_MIN_WIDTH} ถึง ${IMAGE_MAX_WIDTH} px`,
    }
  }

  if (file.height < IMAGE_MIN_HEIGHT) {
    return {
      ok: false,
      reason: `ภาพสูง ${file.height} px — ต้องสูงอย่างน้อย ${IMAGE_MIN_HEIGHT} px`,
    }
  }

  return { ok: true }
}
