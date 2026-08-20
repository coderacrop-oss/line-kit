import {
  IMAGE_MAX_BYTES, IMAGE_MIME_TYPES, VIDEO_MAX_BYTES, VIDEO_MAX_SEC, VIDEO_MIME_TYPES, describeBytes,
} from '../assets/validate'

/**
 * อ่านข้อมูลของไฟล์วิดีโอ MP4 (กล่อง ISO-BMFF: ftyp/moov/mvhd/trak/tkhd) ให้ได้
 * ความยาว (วินาที) กับขนาดภาพของแทร็กวิดีโอ — โดยไม่ถอดรหัสเฟรมสักเฟรมเดียว
 * เหมือนที่ lib/assets/probe.ts อ่านขนาดจาก IHDR ของ PNG / SOF ของ JPEG โดยไม่
 * ถอดรหัสภาพ (ไฟล์นั้นเขียนไว้ตรงๆ ว่าจงใจไม่แตะ MP4 เพราะ "ความยาวอยู่ใน mvhd
 * atom ที่ไฟล์นี้ไม่ได้ปาร์ส" — ที่นี่คือไฟล์ที่ปาร์สมันจริง)
 *
 * ตรวจสอบกับไฟล์ MP4 จริงที่เข้ารหัสด้วย ffmpeg (libx264, มี/ไม่มีแทร็กเสียง,
 * เรียง moov ก่อน/หลัง mdat) แล้วเทียบผลกับ ffprobe ตรงๆ ระหว่างพัฒนา — ไม่ใช่แค่
 * ไบต์ที่ประกอบขึ้นเองในเทสต์ (แม้เทสต์อัตโนมัติของไฟล์นี้จะประกอบไบต์เองก็ตาม
 * เพราะต้องรันได้โดยไม่พึ่ง ffmpeg ในเครื่อง CI)
 *
 * ไม่มีการเข้ารหัสซ้ำ/แปลงไฟล์ที่ไหนในนี้เลย — งานเดียวของไฟล์นี้คืออ่านค่าที่ผู้
 * อัปโหลดเข้ารหัสมาแล้วให้ครบพอจะตัดสินใจรับ/ปฏิเสธได้ ตรงกับ "no transcoding"
 * ของสไลซ์นี้
 */

type Box = { type: string; start: number; end: number }

const be32 = (data: Uint8Array, at: number): number =>
  (data[at] * 0x1000000) + (data[at + 1] << 16) + (data[at + 2] << 8) + data[at + 3]

const ascii4 = (data: Uint8Array, at: number): string =>
  String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3])

/**
 * รายการกล่อง ISO-BMFF ระดับเดียว ภายในช่วง [start, end) — กล่องที่มีความยาวไม่
 * สมเหตุสมผล (สั้นกว่าหัวกล่องเอง หรือยาวเลยขอบเขตที่ให้) ตัดจบการเดินตรงนั้นเลย
 * แทนที่จะ throw — คืนกล่องที่อ่านได้ก่อนหน้าไป ให้ผู้เรียกตัดสินว่าพอจะหาสิ่งที่
 * ต้องการเจอไหม (บาง MP4 มีกล่องแปลกท้ายไฟล์ที่ไม่กระทบกล่องหลักที่ต้องใช้จริง)
 */
function listBoxes(data: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let at = start
  while (at + 8 <= end) {
    const rawSize = be32(data, at)
    const type = ascii4(data, at + 4)
    let size = rawSize
    let headerSize = 8
    if (rawSize === 1) {
      // extended size 64 บิต — วิดีโอที่รับ (เพดาน 10MB) ไม่มีทางใหญ่ขนาดต้องใช้จริง
      // แต่ไฟล์เข้ารหัสบางตัวยังเขียนกล่องระดับบนด้วยฟอร์แมตนี้อยู่
      if (at + 16 > end) break
      size = be32(data, at + 8) * 2 ** 32 + be32(data, at + 12)
      headerSize = 16
    } else if (rawSize === 0) {
      size = end - at // กล่องสุดท้ายที่ขยายไปจนจบไฟล์
    }
    if (size < headerSize || at + size > end) break
    boxes.push({ type, start: at + headerSize, end: at + size })
    at += size
  }
  return boxes
}

const findBox = (boxes: Box[], type: string): Box | undefined => boxes.find((b) => b.type === type)

/** mvhd (movie header) — เวอร์ชัน 0 ใช้ฟิลด์ 32 บิต เวอร์ชัน 1 ใช้ 64 บิตสำหรับเวลา */
function readMvhdDurationSec(data: Uint8Array, mvhd: Box): number | null {
  const body = mvhd.start
  const version = data[body]
  if (version === 0) {
    if (mvhd.end - body < 20) return null
    const timescale = be32(data, body + 12)
    const duration = be32(data, body + 16)
    if (timescale <= 0) return null
    return duration / timescale
  }
  if (version === 1) {
    if (mvhd.end - body < 32) return null
    const timescale = be32(data, body + 20)
    const duration = be32(data, body + 24) * 2 ** 32 + be32(data, body + 28)
    if (timescale <= 0) return null
    return duration / timescale
  }
  return null
}

/**
 * ความกว้าง/สูงของแทร็ก (tkhd) — เก็บเป็นเลขจุดตรึงตำแหน่ง 16.16 (ตัวเลขจำนวนเต็ม
 * อยู่ 16 บิตบน) ออฟเซตของฟิลด์นี้ต่างกันระหว่างเวอร์ชัน 0/1 เพราะฟิลด์เวลาก่อนหน้า
 * เปลี่ยนจาก 32 เป็น 64 บิต — เลขออฟเซตตรวจกับไฟล์จริงจาก ffmpeg แล้ว (ดูหมายเหตุหัวไฟล์)
 */
function readTkhdDims(data: Uint8Array, tkhd: Box): { width: number; height: number } | null {
  const body = tkhd.start
  if (tkhd.end - body < 4) return null
  const version = data[body]
  const widthOffset = version === 1 ? 88 : 76
  const heightOffset = widthOffset + 4
  if (tkhd.end - body < heightOffset + 4) return null
  const width = be32(data, body + widthOffset) >>> 16
  const height = be32(data, body + heightOffset) >>> 16
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * ขนาดของแทร็กที่เป็น "วิดีโอ" จริง (ไม่ใช่แทร็กเสียง) — หา trak ที่ mdia/hdlr
 * ประกาศ handler_type เป็น "vide" ก่อน แล้วค่อยอ่าน tkhd ของ trak นั้น ไฟล์วิดีโอ
 * ทั่วไปมีทั้งแทร็กภาพและเสียงในกล่อง moov เดียวกัน อ่าน tkhd ตัวแรกเจอเฉยๆ
 * โดยไม่กรองก่อนจะได้ขนาดของแทร็กเสียง (ซึ่งไม่มี width/height จริง) แทนได้
 */
function findVideoTrackDims(data: Uint8Array, moov: Box): { width: number; height: number } | null {
  const traks = listBoxes(data, moov.start, moov.end).filter((b) => b.type === 'trak')
  for (const trak of traks) {
    const trakChildren = listBoxes(data, trak.start, trak.end)
    const mdia = findBox(trakChildren, 'mdia')
    if (!mdia) continue
    const hdlr = findBox(listBoxes(data, mdia.start, mdia.end), 'hdlr')
    // handler_type: ASCII 4 ไบต์ที่ออฟเซต 8 ของเนื้อกล่อง (หลัง version+flags(4) + predefined(4))
    if (!hdlr || hdlr.end - hdlr.start < 12 || ascii4(data, hdlr.start + 8) !== 'vide') continue

    const tkhd = findBox(trakChildren, 'tkhd')
    const dims = tkhd ? readTkhdDims(data, tkhd) : null
    if (dims) return dims
  }
  return null
}

export type Mp4Meta = { mime: 'video/mp4'; durationSec: number; width: number; height: number }
export type Mp4ProbeResult = { ok: true; meta: Mp4Meta } | { ok: false; reason: string }

const UNREADABLE = (what: string): { ok: false; reason: string } => ({
  ok: false,
  reason: `อ่านข้อมูลในไฟล์วิดีโอนี้ไม่ได้ (${what}) — ไฟล์อาจเสียหายหรือไม่ใช่ MP4 จริง`,
})

/**
 * ตรวจว่าไฟล์เป็น MP4/ISO-BMFF จริง (มีกล่อง ftyp) แล้วอ่านความยาว + ขนาดภาพของ
 * แทร็กวิดีโอ — ปฏิเสธ (ไม่เดา) เมื่ออ่านค่าที่ต้องใช้ตัดสินใจไม่ได้ครบ เหตุผล
 * เดียวกับที่ probeImage ปฏิเสธภาพที่อ่านขนาดไม่ออกแทนที่จะเดาเป็นศูนย์
 */
export function probeMp4(data: Uint8Array): Mp4ProbeResult {
  const top = listBoxes(data, 0, data.length)
  if (!findBox(top, 'ftyp')) return UNREADABLE('ไม่พบก้อน ftyp')
  const moov = findBox(top, 'moov')
  if (!moov) return UNREADABLE('ไม่พบก้อน moov')

  const mvhd = findBox(listBoxes(data, moov.start, moov.end), 'mvhd')
  if (!mvhd) return UNREADABLE('ไม่พบก้อน mvhd')
  const durationSec = readMvhdDurationSec(data, mvhd)
  if (durationSec === null || durationSec <= 0) return UNREADABLE('อ่านความยาวคลิปจาก mvhd ไม่ได้')

  const dims = findVideoTrackDims(data, moov)
  if (!dims) return UNREADABLE('ไม่พบแทร็กวิดีโอที่มีขนาดภาพ')

  return { ok: true, meta: { mime: 'video/mp4', durationSec, width: dims.width, height: dims.height } }
}

export type ImagemapVideoUploadVerdict = { ok: true } | { ok: false; reason: string }

/**
 * เพดานไฟล์วิดีโอของริชวิดีโอ (imagemap_video)
 *
 * ใช้ VIDEO_MAX_BYTES/VIDEO_MAX_SEC/VIDEO_MIME_TYPES ตัวเดียวกับ lib/assets/validate.ts
 * (10 MB · 60 วินาที · MP4 เท่านั้น) ไม่ใช่เลขชุดใหม่ — สองเหตุผล: (1) asset.duration_sec
 * มี CHECK (duration_sec <= 60) บังคับอยู่แล้วในฐานข้อมูลตั้งแต่ 0001_init.sql เพดาน
 * อื่นต้องแก้ constraint นั้นด้วยจึงจะใช้ได้จริง (2) นี่เป็นตัวเลขเดียวที่โปรเจกต์นี้
 * เคยตกลงไว้แล้วว่าเป็น "เพดานของ LINE เอง" (ดูคอมเมนต์ของ validate.ts) — เขียนเลข
 * ชุดที่สามซ้อนขึ้นมาอีกจะทำให้ "เพดานวิดีโอของ LINE" มีสามค่าใน สามที่ ซึ่งเป็น
 * บั๊กที่ validate.ts เตือนไว้เองว่ารอเกิด
 *
 * ตัวเลขนี้ **ยังไม่ได้ยืนยันจากเอกสารทางการของ LINE โดยตรงสำหรับวิดีโอในริชวิดีโอ
 * โดยเฉพาะ** — ค้นแล้วจริง: LINE's OpenAPI schema (github.com/line/line-openapi,
 * messaging-api.yml, schema ImagemapVideo) ไม่มี maxLength/limit กำกับไว้เลยสักฟิลด์
 * ต่างจาก ClipboardImagemapAction ที่มี "Max character limit: 1000" เขียนไว้ชัดเจน
 * ในไฟล์เดียวกัน และหน้าอ้างอิงจริงของ developers.line.biz เป็น SPA ที่ดึงเนื้อหา
 * ผ่าน JavaScript ทำให้ดึงข้อความมาอ่านตรงๆ ไม่ได้จากเครื่องมือที่มีอยู่ — ตัวเลขที่
 * ใช้จึงเป็น **เพดานปลอดภัยที่ตั้งใจให้หลวมกว่าจะไปบล็อกวิดีโอจริงที่ควรผ่าน** ไม่ใช่
 * ตัวเลขที่คัดลอกมาจากเอกสารของ LINE ตรงๆ — คนตั้งค่าต้องกดปุ่ม "ส่งการ์ดทดสอบเข้า
 * LINE ของตัวเอง" (BR-62) ยืนยันกับเครื่องจริงอีกที ก่อนเชื่อว่าวิดีโอที่ผ่านด่านนี้
 * เล่นได้จริงในแชท
 */
export function validateImagemapVideoUpload(
  file: { mime: string; bytes: number; durationSec: number },
): ImagemapVideoUploadVerdict {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.mime)) {
    return { ok: false, reason: `ไฟล์ชนิด ${file.mime} ใช้ไม่ได้ — รับเฉพาะวิดีโอ MP4 เท่านั้น` }
  }
  if (file.bytes <= 0) return { ok: false, reason: 'ไฟล์ว่าง ไม่มีข้อมูลอยู่ข้างใน — อัปโหลดใหม่อีกครั้ง' }
  if (file.bytes > VIDEO_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ ${describeBytes(file.bytes)} เกินเพดาน ${describeBytes(VIDEO_MAX_BYTES)} ของวิดีโอ — บีบอัดหรือตัดให้สั้นลงก่อน`,
    }
  }
  if (file.durationSec <= 0) {
    return { ok: false, reason: `ความยาว ${file.durationSec} วินาที ไม่ใช่ความยาวของคลิปที่เล่นได้` }
  }
  if (file.durationSec > VIDEO_MAX_SEC) {
    return {
      ok: false,
      reason: `วิดีโอยาว ${Math.round(file.durationSec)} วินาที เกินเพดาน ${VIDEO_MAX_SEC} วินาที — ตัดให้สั้นลงก่อน`,
    }
  }
  return { ok: true }
}

/**
 * ภาพตัวอย่างก่อนเล่น (previewImageUrl ของ LINE) — **ไม่ใช้ validateUpload()
 * ทั่วไปของ lib/assets/validate.ts ตรงๆ** แม้จะดูเหมือนภาพทั่วไปก็ตาม เพราะฟังก์ชัน
 * นั้นบังคับกว้างระหว่าง 800–2500px (IMAGE_MIN_WIDTH/IMAGE_MAX_WIDTH) ด้วยเหตุผล
 * เฉพาะของบริบทนั้น (คลังภาพทั่วไป/ภาพ Rich Menu) ที่ภาพต้องขยายเต็มความกว้างแชท
 * หรือเต็มผืนเมนู — ภาพตัวอย่างก่อนเล่นของวิดีโอไม่ได้ขยายเต็มอะไรแบบนั้นเลย มันแค่
 * เติมเต็มพื้นที่เล่นวิดีโอหนึ่งกล่องบนภาพฐาน (มักเล็กกว่า 800px กว้างมาก) การบังคับ
 * เพดานนั้นจะปฏิเสธภาพตัวอย่างขนาดปกติทิ้งไปเฉยๆ โดยไม่มีเหตุผลรองรับ — ที่นี่คง
 * ไว้แค่ชนิดไฟล์ (JPEG/PNG) กับเพดานขนาด (IMAGE_MAX_BYTES เดียวกับคลังภาพทั่วไป —
 * ไม่มีเหตุผลให้เพดานขนาดต่างกัน) และตรวจว่าอ่านขนาดภาพได้จริง ไม่ใช่ไฟล์เสีย
 */
export function validateImagemapVideoPreviewUpload(
  file: { mime: string; bytes: number; width: number; height: number },
): ImagemapVideoUploadVerdict {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mime)) {
    return { ok: false, reason: `ไฟล์ชนิด ${file.mime} ใช้ไม่ได้ — รับเฉพาะภาพ JPEG หรือ PNG` }
  }
  if (file.bytes <= 0) return { ok: false, reason: 'ไฟล์ว่าง ไม่มีข้อมูลอยู่ข้างใน — อัปโหลดใหม่อีกครั้ง' }
  if (file.width <= 0 || file.height <= 0) {
    return { ok: false, reason: 'อ่านขนาดของภาพในไฟล์นี้ไม่ออก — ไฟล์อาจเสียหายหรือไม่ใช่ชนิดที่บอกไว้' }
  }
  if (file.bytes > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ ${describeBytes(file.bytes)} เกินเพดาน ${describeBytes(IMAGE_MAX_BYTES)} — บีบอัดก่อนแล้วลองใหม่`,
    }
  }
  return { ok: true }
}
