import { describe, expect, it } from 'vitest'
import { probeImage } from './probe'

/** PNG 1×1 โปร่งใสของจริง · ผลจากตัวเข้ารหัสจริง ไม่ใช่ไบต์ที่เทสต์ประกอบเอง */
const REAL_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number) => [(n >>> 8) & 255, n & 255]

const png = (width: number, height: number, tail: number[] = []) =>
  Uint8Array.from([
    ...PNG_SIGNATURE,
    ...be32(13), 0x49, 0x48, 0x44, 0x52, // length + "IHDR"
    ...be32(width), ...be32(height),
    8, 6, 0, 0, 0, // bit depth · colour type · compression · filter · interlace
    ...tail,
  ])

/** ส่วนหัวของ JPEG ที่มีเซกเมนต์อื่นคั่นก่อนถึง SOF · เหมือนไฟล์จากกล้องและจากโปรแกรมแต่งภาพ */
const jpeg = (width: number, height: number, opts: { sof?: number; before?: number[] } = {}) => {
  const sof = opts.sof ?? 0xc0
  const before = opts.before ?? [
    0xff, 0xe0, ...be16(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, // APP0/JFIF
    0xff, 0xdb, ...be16(6), 0, 1, 2, 3, // DQT ย่อ
  ]
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    ...before,
    0xff, sof, ...be16(17), 8, ...be16(height), ...be16(width), 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, // SOS
  ])
}

const measured = (data: Uint8Array) => {
  const out = probeImage(data)
  if (!out.ok) throw new Error(`ควรอ่านได้แต่ไม่ได้: ${out.reason}`)
  return out.meta
}

const refused = (data: Uint8Array) => {
  const out = probeImage(data)
  if (out.ok) throw new Error(`ควรอ่านไม่ได้แต่ได้ ${out.meta.width}×${out.meta.height}`)
  return out.reason
}

describe('probeImage · PNG', () => {
  it('อ่านไฟล์จริงที่ตัวเข้ารหัสจริงสร้าง', () => {
    expect(measured(REAL_PNG_1X1)).toEqual({ mime: 'image/png', width: 1, height: 1 })
  })

  it('อ่านความกว้างและความสูงจาก IHDR', () => {
    expect(measured(png(1024, 678))).toEqual({ mime: 'image/png', width: 1024, height: 678 })
  })

  it('กว้างกับสูงไม่สลับกัน', () => {
    expect(measured(png(2500, 1686))).toMatchObject({ width: 2500, height: 1686 })
  })

  it('ค่าที่ใหญ่กว่า 65535 ยังอ่านถูก · IHDR เก็บสี่ไบต์ ไม่ใช่สองไบต์', () => {
    expect(measured(png(70_000, 80_000))).toMatchObject({ width: 70_000, height: 80_000 })
  })

  it('ลายเซ็นผิดไปหนึ่งไบต์ ไม่ถือว่าเป็น PNG', () => {
    const bad = png(1024, 678)
    bad[3] = 0x00
    expect(refused(bad)).toContain('ชนิด')
  })

  it('ก้อนแรกที่ไม่ใช่ IHDR อ่านไม่ได้ · ไม่ใช่เดาว่าตัวเลขอยู่ตรงนั้น', () => {
    const bad = png(1024, 678)
    bad[13] = 0x45 // "IHDR" กลายเป็น "IEDR"
    expect(refused(bad)).toContain('อ่าน')
  })

  it('ไฟล์ที่ขาดกลาง IHDR อ่านไม่ได้ ไม่ใช่คืนศูนย์', () => {
    expect(refused(png(1024, 678).slice(0, 20))).toContain('ไฟล์สั้นกว่าส่วนหัว')
  })

  it('IHDR ที่บอกขนาดศูนย์ ถูกปฏิเสธ ไม่ใช่ปล่อยศูนย์ลงคอลัมน์', () => {
    expect(refused(png(0, 0))).toContain('เป็นศูนย์')
    expect(refused(png(1024, 0))).toContain('เป็นศูนย์')
  })
})

describe('probeImage · JPEG', () => {
  it('อ่านขนาดจาก SOF0 ที่อยู่หลังเซกเมนต์อื่น', () => {
    expect(measured(jpeg(1600, 900))).toEqual({ mime: 'image/jpeg', width: 1600, height: 900 })
  })

  it('ข้ามเซกเมนต์ที่ยาวมากได้ · EXIF ของกล้องยาวเป็นหมื่นไบต์', () => {
    const exif = [0xff, 0xe1, ...be16(20_002), ...new Array(20_000).fill(0x41)]
    expect(measured(jpeg(1200, 800, { before: exif }))).toMatchObject({ width: 1200, height: 800 })
  })

  it('SOF2 ของภาพแบบ progressive ก็อ่านได้', () => {
    expect(measured(jpeg(1024, 512, { sof: 0xc2 }))).toMatchObject({ width: 1024, height: 512 })
  })

  it('ไม่หลงอ่าน DHT (0xC4) เป็น SOF · เลขในนั้นไม่ใช่ขนาดภาพ', () => {
    const dht = [0xff, 0xc4, ...be16(6), 0x11, 0x22, 0x33, 0x44]
    expect(measured(jpeg(900, 600, { before: dht }))).toMatchObject({ width: 900, height: 600 })
  })

  it('กว้างกับสูงไม่สลับกัน · SOF เก็บสูงก่อนกว้าง', () => {
    expect(measured(jpeg(1686, 2500))).toMatchObject({ width: 1686, height: 2500 })
  })

  it('ข้ามตัวคั่นซ้ำ FF FF และ marker ที่ไม่มีเนื้อตามหลัง', () => {
    // marker เดี่ยวไม่มีความยาวต่อท้าย · ถ้าอ่านสองไบต์ถัดไปเป็นความยาว
    // ตัวเดินจะกระโดดข้าม SOF ไปเลย
    const padding = [0xff, 0xff, 0xff, 0x01, 0xff, 0xd0]
    expect(measured(jpeg(1400, 700, { before: padding }))).toMatchObject({ width: 1400, height: 700 })
  })

  it('ไฟล์ที่ไม่มี SOF เลย อ่านไม่ได้', () => {
    expect(refused(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...be16(4), 0, 0])))
      .toContain('ไม่พบเซกเมนต์ SOF')
  })

  it('เซกเมนต์ที่บอกความยาวเป็นไปไม่ได้ ถูกปฏิเสธที่ความยาวนั้นเอง', () => {
    // ถ้าเชื่อความยาวศูนย์หรือหนึ่ง ตัวเดินจะเดินถอยหลังหรือเดินเหลื่อมไปทีละไบต์
    // และเจอ "SOF" ที่ไม่มีอยู่จริงในที่สุด
    for (const length of [0, 1]) {
      const broken = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...be16(length), 0x41, 0x42, 0x43])
      expect(refused(broken), `length=${length}`).toContain('ความยาวที่เป็นไปไม่ได้')
    }
  })

  it('ไบต์ที่ควรเป็นหัวเซกเมนต์แต่ไม่ใช่ FF ถูกปฏิเสธตรงนั้น ไม่ใช่เดินต่อไปเรื่อยๆ', () => {
    const broken = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, ...be16(4), 0x00, 0x00, 0x41, 0x42, 0x43, 0x44,
    ])
    expect(refused(broken)).toContain('ไม่ได้ขึ้นต้นด้วย FF')
  })

  it('SOF ที่ขาดกลาง ถูกปฏิเสธ ไม่ใช่คืนขนาดที่เป็น NaN', () => {
    // ไบต์ที่เลยท้ายไฟล์เป็น undefined · คำนวณต่อได้ NaN ซึ่ง NaN <= 0 เป็นเท็จ
    // ด่านความยาวจึงเป็นตัวเดียวที่กันไม่ให้ NaN ไหลลงคอลัมน์ width
    const cut = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, ...be16(17)])
    expect(refused(cut)).toContain('ขาดกลาง')
  })
})

describe('probeImage · ชนิดที่คลังไม่รับ', () => {
  it('GIF ที่เปลี่ยนนามสกุลเป็น .png ยังถูกจับได้จากไบต์แรก', () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00])
    expect(refused(gif)).toContain('ชนิด')
  })

  it('WebP ไม่ผ่าน', () => {
    const webp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ])
    expect(refused(webp)).toContain('ชนิด')
  })

  it('mp4 ไม่ผ่านทางนี้ · ตัวอ่านนี้อ่านได้แต่ภาพ', () => {
    const mp4 = Uint8Array.from([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0,
    ])
    expect(refused(mp4)).toContain('ชนิด')
  })

  it('ไฟล์ว่างไม่ทำให้ระเบิด', () => {
    expect(refused(new Uint8Array(0))).toContain('ชนิด')
  })

  it('ไฟล์สั้นกว่าลายเซ็นไม่ทำให้ระเบิด', () => {
    expect(refused(Uint8Array.from([0x89, 0x50]))).toContain('ชนิด')
    expect(refused(Uint8Array.from([0xff, 0xd8]))).toContain('ชนิด')
  })

  it('FF D8 ที่ไม่มี FF ตามมา ไม่ใช่ JPEG · ลายเซ็นคือสามไบต์', () => {
    // FF D8 สองไบต์เจอได้ในไฟล์อะไรก็ได้ · ถ้ารับแค่นั้น ไฟล์ที่ไม่ใช่ภาพจะถูก
    // รายงานว่า "อ่านขนาดไม่ได้" แทนที่จะถูกรายงานว่าเป็นชนิดที่คลังไม่รับ
    const notJpeg = Uint8Array.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    expect(refused(notJpeg)).toContain('ชนิด')
  })
})
