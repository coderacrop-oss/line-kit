/**
 * ขนาดจริงของภาพ อ่านจากไบต์ในไฟล์ ไม่ใช่จากที่เบราว์เซอร์บอก
 *
 * The browser's Content-Type comes from the file extension, so a GIF renamed to
 * .png arrives claiming to be a PNG. Width and height cannot be asked for at
 * all — the upload has no client-side code to measure them, and if it had, the
 * numbers would be written by whoever submitted the form.
 *
 * Both matter because they land in NOT NULL columns that later decide whether a
 * rich menu image is the right shape. A guessed dimension is a row that looks
 * measured, and nothing downstream can tell the difference.
 *
 * Only JPEG and PNG are read here. MP4 is not: its duration lives in an mvhd
 * atom this file does not parse, and an asset row whose duration_sec was assumed
 * is exactly the row that fails at LINE when the clip turns out to be 90 seconds.
 */

export type ImageMeta = { mime: 'image/png' | 'image/jpeg'; width: number; height: number }
export type ProbeResult = { ok: true; meta: ImageMeta } | { ok: false; reason: string }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** SOFn ที่มีขนาดภาพอยู่ข้างใน · C4 คือ DHT · C8 คือ JPG · CC คือ DAC ซึ่งไม่ใช่ SOF */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const UNREADABLE = (what: string) => ({
  ok: false as const,
  reason: `อ่านขนาดของภาพจากไฟล์นี้ไม่ได้ (${what}) — ไฟล์อาจไม่สมบูรณ์`,
})

const WRONG_TYPE = {
  ok: false as const,
  reason: 'ชนิดของไฟล์นี้ไม่ใช่ JPEG หรือ PNG — ดูจากไบต์ในไฟล์ ไม่ใช่จากนามสกุล',
}

// ไฟล์ที่สั้นกว่าลายเซ็นไม่ต้องกันเป็นพิเศษ · ไบต์ที่เลยท้ายไฟล์เป็น undefined
// ซึ่งไม่มีทางเท่ากับตัวเลข การเทียบจึงเป็นเท็จอยู่แล้ว
const startsWith = (data: Uint8Array, bytes: number[]) =>
  bytes.every((byte, i) => data[i] === byte)

const be16 = (data: Uint8Array, at: number) => (data[at] << 8) | data[at + 1]
const be32 = (data: Uint8Array, at: number) =>
  ((data[at] << 24) >>> 0) + (data[at + 1] << 16) + (data[at + 2] << 8) + data[at + 3]

/** IHDR ต้องเป็นก้อนแรกเสมอตามสเปก · ขนาดอยู่ที่ไบต์ 16 ถึง 23 */
function probePng(data: Uint8Array): ProbeResult {
  if (data.length < 24) return UNREADABLE('ไฟล์สั้นกว่าส่วนหัว')
  const isIhdr = data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52
  if (!isIhdr) return UNREADABLE('ไม่พบก้อน IHDR')

  const width = be32(data, 16)
  const height = be32(data, 20)
  if (width <= 0 || height <= 0) return UNREADABLE('ขนาดใน IHDR เป็นศูนย์')
  return { ok: true, meta: { mime: 'image/png', width, height } }
}

/**
 * เดินข้ามเซกเมนต์ไปจนเจอ SOFn
 *
 * The size is not at a fixed offset: a photograph carries EXIF, a colour profile
 * and quantisation tables before it, in whatever order the encoder wrote them.
 * Walking the segment lengths is the only way to arrive at the right one, and a
 * segment claiming a length below two would walk backwards forever, so it ends
 * the walk instead.
 */
function probeJpeg(data: Uint8Array): ProbeResult {
  let at = 2
  while (at + 3 < data.length) {
    if (data[at] !== 0xff) return UNREADABLE('เซกเมนต์ไม่ได้ขึ้นต้นด้วย FF')

    const marker = data[at + 1]
    // ตัวคั่นซ้ำและ marker ที่ไม่มีเนื้อตามหลัง เดินทีละไบต์
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue }

    const length = be16(data, at + 2)
    if (length < 2) return UNREADABLE('เซกเมนต์บอกความยาวที่เป็นไปไม่ได้')

    if (SOF_MARKERS.has(marker)) {
      if (at + 9 > data.length) return UNREADABLE('SOF ขาดกลาง')
      const height = be16(data, at + 5)
      const width = be16(data, at + 7)
      if (width <= 0 || height <= 0) return UNREADABLE('ขนาดใน SOF เป็นศูนย์')
      return { ok: true, meta: { mime: 'image/jpeg', width, height } }
    }

    at += 2 + length
  }
  return UNREADABLE('ไม่พบเซกเมนต์ SOF ที่บอกขนาด')
}

export function probeImage(data: Uint8Array): ProbeResult {
  if (startsWith(data, PNG_SIGNATURE)) return probePng(data)
  if (startsWith(data, [0xff, 0xd8, 0xff])) return probeJpeg(data)
  return WRONG_TYPE
}
