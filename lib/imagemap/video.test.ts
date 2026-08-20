import { describe, expect, it } from 'vitest'
import { probeMp4, validateImagemapVideoPreviewUpload, validateImagemapVideoUpload } from './video'

/**
 * ไบต์ MP4/ISO-BMFF ที่ประกอบขึ้นเองทีละกล่อง (ftyp/moov/mvhd/trak/mdia/hdlr/tkhd)
 * — ต่างจากที่ระบุไว้ในหมายเหตุของ video.ts (ตรวจกับไฟล์จริงจาก ffmpeg ระหว่างพัฒนา)
 * เทสต์อัตโนมัติเหล่านี้ประกอบไบต์เองเพื่อให้รันได้ในทุกเครื่อง CI โดยไม่ต้องมี
 * ffmpeg ติดตั้งไว้ — ออฟเซตของแต่ละฟิลด์อ้างอิงตัวเดียวกับที่ probeMp4 อ่าน ตรวจ
 * ทานกับผลจริงของ ffprobe แล้วก่อนเขียนไฟล์นี้
 */

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const fourcc = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const zeros = (n: number): number[] => new Array(n).fill(0)

function box(type: string, body: number[]): number[] {
  return [...be32(8 + body.length), ...fourcc(type), ...body]
}

const ftypBox = box('ftyp', [...fourcc('isom'), ...zeros(4), ...fourcc('isom')])

function mvhdBox(timescale: number, duration: number): number[] {
  return box('mvhd', [0, 0, 0, 0, ...zeros(4), ...zeros(4), ...be32(timescale), ...be32(duration)])
}

function hdlrBox(handlerType: string): number[] {
  return box('hdlr', [0, 0, 0, 0, ...zeros(4), ...fourcc(handlerType)])
}

function tkhdBox(width: number, height: number): number[] {
  const body = [
    0, 0, 0, 0, // version + flags
    ...zeros(4), ...zeros(4), ...zeros(4), ...zeros(4), ...zeros(4), // creation/mod/trackId/reserved/duration
    ...zeros(8), // reserved
    ...zeros(2), ...zeros(2), ...zeros(2), ...zeros(2), // layer/alt/volume/reserved
    ...zeros(36), // matrix
    ...be32(width << 16), ...be32(height << 16), // 16.16 fixed point
  ]
  return box('tkhd', body)
}

function trakBox(handlerType: string, width: number, height: number): number[] {
  const mdia = box('mdia', hdlrBox(handlerType))
  return box('trak', [...tkhdBox(width, height), ...mdia])
}

function mp4(opts: {
  timescale?: number; duration?: number; tracks?: Array<{ handlerType: string; width: number; height: number }>
  omitFtyp?: boolean; omitMoov?: boolean; omitMvhd?: boolean
} = {}): Uint8Array {
  const {
    timescale = 1000, duration = 2500,
    tracks = [{ handlerType: 'vide', width: 640, height: 360 }],
    omitFtyp = false, omitMoov = false, omitMvhd = false,
  } = opts

  const trakBoxes = tracks.flatMap((t) => trakBox(t.handlerType, t.width, t.height))
  const moovBody = [...(omitMvhd ? [] : mvhdBox(timescale, duration)), ...trakBoxes]
  const bytes = [
    ...(omitFtyp ? [] : ftypBox),
    ...(omitMoov ? [] : box('moov', moovBody)),
  ]
  return Uint8Array.from(bytes)
}

describe('probeMp4', () => {
  it('ไฟล์ MP4 ปกติ (วิดีโอ+เสียง) — อ่านความยาวและขนาดของแทร็กวิดีโอได้ถูกต้อง', () => {
    const data = mp4({
      timescale: 1000, duration: 2500,
      tracks: [{ handlerType: 'soun', width: 0, height: 0 }, { handlerType: 'vide', width: 640, height: 360 }],
    })
    const result = probeMp4(data)
    expect(result).toEqual({ ok: true, meta: { mime: 'video/mp4', durationSec: 2.5, width: 640, height: 360 } })
  })

  it('mvhd เวอร์ชัน 1 (ฟิลด์เวลา 64 บิต) — ยังอ่านขนาดแทร็กวิดีโอได้ปกติ', () => {
    // เฉพาะ tkhd ที่ต้องรองรับเวอร์ชัน 1 จริงจัง — สร้าง trak เองแบบกำหนด version ได้
    const tkhdV1 = box('tkhd', [
      1, 0, 0, 0,
      ...zeros(8), ...zeros(8), ...zeros(4), ...zeros(4), ...zeros(8),
      ...zeros(8), ...zeros(2), ...zeros(2), ...zeros(2), ...zeros(2), ...zeros(36),
      ...be32(320 << 16), ...be32(180 << 16),
    ])
    const mdia = box('mdia', hdlrBox('vide'))
    const trak = box('trak', [...tkhdV1, ...mdia])
    const moov = box('moov', [...mvhdBox(1000, 1000), ...trak])
    const data = Uint8Array.from([...ftypBox, ...moov])
    expect(probeMp4(data)).toEqual({ ok: true, meta: { mime: 'video/mp4', durationSec: 1, width: 320, height: 180 } })
  })

  it('ไม่มีก้อน ftyp — ปฏิเสธ ไม่ใช่ MP4 จริง', () => {
    const out = probeMp4(mp4({ omitFtyp: true }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('ftyp')
  })

  it('ไม่มีก้อน moov — ปฏิเสธ อ่านความยาวไม่ได้', () => {
    const out = probeMp4(mp4({ omitMoov: true }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('moov')
  })

  it('ไม่มีก้อน mvhd ในนั้น — ปฏิเสธ', () => {
    const out = probeMp4(mp4({ omitMvhd: true }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('mvhd')
  })

  it('มีแค่แทร็กเสียง ไม่มีแทร็กวิดีโอเลย — ปฏิเสธ หาแทร็กวิดีโอไม่เจอ', () => {
    const data = mp4({ tracks: [{ handlerType: 'soun', width: 0, height: 0 }] })
    const out = probeMp4(data)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('แทร็กวิดีโอ')
  })

  it('timescale เป็นศูนย์ — คำนวณความยาวไม่ได้ ปฏิเสธแทนที่จะหารด้วยศูนย์', () => {
    const out = probeMp4(mp4({ timescale: 0, duration: 1000 }))
    expect(out.ok).toBe(false)
  })

  it('ไฟล์สั้นเกินกว่าจะมีหัวกล่องด้วยซ้ำ — ปฏิเสธ ไม่ throw', () => {
    const out = probeMp4(Uint8Array.from([0, 0, 0]))
    expect(out.ok).toBe(false)
  })
})

describe('validateImagemapVideoUpload', () => {
  const ok = { mime: 'video/mp4', bytes: 1024, durationSec: 10 }

  it('ไฟล์ MP4 ขนาด/ความยาวปกติ — ผ่าน', () => {
    expect(validateImagemapVideoUpload(ok)).toEqual({ ok: true })
  })

  it('ชนิดไฟล์ไม่ใช่ MP4 — ปฏิเสธ', () => {
    const out = validateImagemapVideoUpload({ ...ok, mime: 'video/quicktime' })
    expect(out).toEqual({ ok: false, reason: expect.stringContaining('MP4') })
  })

  it('ไฟล์ว่าง — ปฏิเสธ', () => {
    expect(validateImagemapVideoUpload({ ...ok, bytes: 0 }).ok).toBe(false)
  })

  it('ไฟล์เกินเพดานขนาด (10MB) — ปฏิเสธ', () => {
    const out = validateImagemapVideoUpload({ ...ok, bytes: 11 * 1024 * 1024 })
    expect(out).toEqual({ ok: false, reason: expect.stringContaining('เกินเพดาน') })
  })

  it('ความยาวเป็นศูนย์หรือติดลบ — ปฏิเสธ', () => {
    expect(validateImagemapVideoUpload({ ...ok, durationSec: 0 }).ok).toBe(false)
  })

  it('ความยาวเกินเพดาน 60 วินาที — ปฏิเสธ', () => {
    const out = validateImagemapVideoUpload({ ...ok, durationSec: 61 })
    expect(out).toEqual({ ok: false, reason: expect.stringContaining('60 วินาที') })
  })

  it('ความยาวเท่าเพดานพอดี (60 วินาที) — ผ่าน', () => {
    expect(validateImagemapVideoUpload({ ...ok, durationSec: 60 }).ok).toBe(true)
  })
})

describe('validateImagemapVideoPreviewUpload', () => {
  const ok = { mime: 'image/jpeg', bytes: 1024, width: 300, height: 200 }

  it('ภาพ JPEG ขนาดเล็ก (เล็กกว่า 800px เพดานของ validateUpload ทั่วไป) — ยังผ่าน', () => {
    expect(validateImagemapVideoPreviewUpload(ok)).toEqual({ ok: true })
  })

  it('PNG ก็ผ่านเช่นกัน', () => {
    expect(validateImagemapVideoPreviewUpload({ ...ok, mime: 'image/png' }).ok).toBe(true)
  })

  it('ชนิดไฟล์ไม่ใช่ JPEG/PNG — ปฏิเสธ', () => {
    expect(validateImagemapVideoPreviewUpload({ ...ok, mime: 'image/gif' }).ok).toBe(false)
  })

  it('ไฟล์ว่างหรืออ่านขนาดไม่ออก — ปฏิเสธ', () => {
    expect(validateImagemapVideoPreviewUpload({ ...ok, bytes: 0 }).ok).toBe(false)
    expect(validateImagemapVideoPreviewUpload({ ...ok, width: 0 }).ok).toBe(false)
  })

  it('ไฟล์เกินเพดาน 1MB — ปฏิเสธ', () => {
    const out = validateImagemapVideoPreviewUpload({ ...ok, bytes: 2 * 1024 * 1024 })
    expect(out).toEqual({ ok: false, reason: expect.stringContaining('เกินเพดาน') })
  })
})
