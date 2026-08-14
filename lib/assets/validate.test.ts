import { describe, expect, it } from 'vitest'
import {
  IMAGE_MAX_BYTES, IMAGE_MAX_WIDTH, IMAGE_MIN_HEIGHT, IMAGE_MIN_WIDTH,
  VIDEO_MAX_BYTES, VIDEO_MAX_SEC, describeBytes, validateUpload,
} from './validate'

const image = { mime: 'image/png', bytes: 400_000, width: 1040, height: 640 }
const video = { mime: 'video/mp4', bytes: 5_000_000, width: 1280, height: 720, durationSec: 45 }

/** ข้อความปฏิเสธของกรณีที่ต้องไม่ผ่าน · โยนถ้ามันดันผ่าน */
const why = (candidate: Parameters<typeof validateUpload>[0]): string => {
  const out = validateUpload(candidate)
  if (out.ok) throw new Error(`ควรไม่ผ่านแต่ผ่าน: ${JSON.stringify(candidate)}`)
  return out.reason
}

describe('เพดานที่ประกาศไว้ ตรงกับ §5.2', () => {
  it('เพดานของภาพคือ 1 MB พอดี ไม่ใช่ 1,000,000', () => {
    expect(IMAGE_MAX_BYTES).toBe(1_048_576)
  })

  it('เพดานของวิดีโอคือ 10 MB และหนึ่งนาที', () => {
    expect(VIDEO_MAX_BYTES).toBe(10_485_760)
    expect(VIDEO_MAX_SEC).toBe(60)
  })

  it('ช่วงความกว้างและความสูงของภาพ', () => {
    expect(IMAGE_MIN_WIDTH).toBe(800)
    expect(IMAGE_MAX_WIDTH).toBe(2500)
    expect(IMAGE_MIN_HEIGHT).toBe(250)
  })
})

describe('validateUpload · ภาพ', () => {
  it('ภาพ PNG ขนาดปกติผ่าน', () => {
    expect(validateUpload(image)).toEqual({ ok: true })
  })

  it('ภาพ JPEG ก็ผ่าน · ทั้งสองชนิดที่ LINE รับ', () => {
    expect(validateUpload({ ...image, mime: 'image/jpeg' })).toEqual({ ok: true })
  })

  it('GIF ไม่ผ่าน และบอกว่ารับอะไร', () => {
    expect(why({ ...image, mime: 'image/gif' })).toContain('JPEG')
    expect(why({ ...image, mime: 'image/gif' })).toContain('PNG')
  })

  it('ข้อความปฏิเสธชนิดไฟล์ บอกชนิดที่ส่งมาจริง ไม่ใช่ "ไฟล์ไม่ถูกต้อง"', () => {
    expect(why({ ...image, mime: 'image/webp' })).toContain('image/webp')
    expect(why({ ...image, mime: 'application/pdf' })).toContain('application/pdf')
  })

  it('image/jpg ที่เบราว์เซอร์เก่าส่งมา ไม่ใช่ชนิดที่รับ', () => {
    // ชนิดจริงของ JPEG คือ image/jpeg · การรับ image/jpg ไว้ด้วยแปลว่ามีสองค่า
    // ที่หมายถึงของอย่างเดียวกันไหลลงคอลัมน์ mime_type
    expect(why({ ...image, mime: 'image/jpg' })).toContain('image/jpg')
  })

  it('เพดาน 1 MB · พอดีเพดานผ่าน เกินไปไบต์เดียวไม่ผ่าน', () => {
    expect(validateUpload({ ...image, bytes: IMAGE_MAX_BYTES })).toEqual({ ok: true })
    expect(validateUpload({ ...image, bytes: IMAGE_MAX_BYTES + 1 }).ok).toBe(false)
  })

  it('ภาพเกิน 1 MB บอกขนาดจริงของไฟล์ ไม่ใช่แค่ว่าใหญ่ไป', () => {
    const reason = why({ ...image, bytes: 2_000_000 })
    expect(reason).toContain('1.9 MB')
    expect(reason).toContain('2,000,000')
    expect(reason).toContain('1 MB')
  })

  it('ไฟล์ที่เกินไปไบต์เดียว ยังบอกจำนวนไบต์ที่แยกออกจากเพดานได้', () => {
    // 1,048,577 ปัดเป็น 1.0 MB เหมือนเพดานพอดี · ถ้าบอกแค่ MB ข้อความจะกลายเป็น
    // "1.0 MB เกินเพดาน 1 MB" ซึ่งอ่านแล้วเหมือนระบบพัง ไม่เหมือนไฟล์ใหญ่ไป
    const reason = why({ ...image, bytes: IMAGE_MAX_BYTES + 1 })
    expect(reason).toContain('1,048,577')
    expect(reason).toContain('1,048,576')
  })

  it('ไฟล์ว่างไม่ผ่าน · ศูนย์ไบต์ไม่ใช่ภาพที่เล็กมาก', () => {
    expect(why({ ...image, bytes: 0 })).toContain('ว่าง')
  })

  it('ภาพแคบกว่า 800 ไม่ผ่าน เพราะใช้เป็นภาพเมนูไม่ได้', () => {
    expect(validateUpload({ ...image, width: IMAGE_MIN_WIDTH - 1 }).ok).toBe(false)
    expect(validateUpload({ ...image, width: IMAGE_MIN_WIDTH }).ok).toBe(true)
  })

  it('ภาพกว้างเกิน 2500 ไม่ผ่าน', () => {
    expect(validateUpload({ ...image, width: IMAGE_MAX_WIDTH }).ok).toBe(true)
    expect(validateUpload({ ...image, width: IMAGE_MAX_WIDTH + 1 }).ok).toBe(false)
  })

  it('ข้อความเรื่องความกว้าง บอกทั้งค่าที่ได้และช่วงที่รับ', () => {
    const reason = why({ ...image, width: 400 })
    expect(reason).toContain('400')
    expect(reason).toContain('800')
    expect(reason).toContain('2500')
  })

  it('ภาพเตี้ยกว่า 250 ไม่ผ่าน · พอดี 250 ผ่าน', () => {
    expect(validateUpload({ ...image, height: IMAGE_MIN_HEIGHT }).ok).toBe(true)
    expect(validateUpload({ ...image, height: IMAGE_MIN_HEIGHT - 1 }).ok).toBe(false)
    expect(why({ ...image, height: 100 })).toContain('100')
    expect(why({ ...image, height: 100 })).toContain('250')
  })

  it('ภาพ Rich Menu 2500×1686 ผ่านโดยไม่ต้องยกเว้นให้เป็นพิเศษ', () => {
    expect(validateUpload({ ...image, width: 2500, height: 1686 })).toEqual({ ok: true })
  })

  it('ขนาดที่อ่านไม่ออก (ศูนย์) ถูกปฏิเสธในฐานะไฟล์ที่วัดไม่ได้ ไม่ใช่ภาพที่แคบไป', () => {
    // ศูนย์ต่ำกว่าเพดานความกว้างอยู่แล้ว การเช็ค .ok เฉยๆ จึงผ่านได้แม้ด่านนี้จะหายไป
    // ข้อความคือสิ่งเดียวที่แยกสองกรณีนี้ออกจากกัน
    expect(why({ ...image, width: 0 })).toContain('อ่านขนาด')
    expect(why({ ...image, height: 0 })).toContain('อ่านขนาด')
    expect(why({ ...image, width: 0 })).not.toContain('800')
  })

  it('ขนาดติดลบก็อ่านไม่ออกเหมือนกัน', () => {
    expect(why({ ...image, width: -1 })).toContain('อ่านขนาด')
    expect(why({ ...image, height: -1 })).toContain('อ่านขนาด')
  })

  it('ภาพไม่สนใจ durationSec ที่ติดมา', () => {
    expect(validateUpload({ ...image, durationSec: 900 })).toEqual({ ok: true })
  })
})

describe('validateUpload · วิดีโอ', () => {
  it('วิดีโอ mp4 ยาวไม่เกินหนึ่งนาทีผ่าน', () => {
    expect(validateUpload(video)).toEqual({ ok: true })
  })

  it('วิดีโอยาวเกินหนึ่งนาทีไม่ผ่าน · แม้ไฟล์จะเล็กกว่าเพดานไบต์มาก', () => {
    const reason = why({ ...video, bytes: 1_000, durationSec: VIDEO_MAX_SEC + 1 })
    expect(reason).toContain('61')
    expect(reason).toContain('60')
    // เพดานไบต์ต้องไม่โผล่มาในข้อความ · ไฟล์นี้ไม่ได้ผิดที่ขนาด
    expect(reason).not.toContain('10 MB')
  })

  it('พอดีหนึ่งนาทีผ่าน · CHECK ของคอลัมน์ก็ยอมรับ 60 เหมือนกัน', () => {
    expect(validateUpload({ ...video, durationSec: VIDEO_MAX_SEC })).toEqual({ ok: true })
  })

  it('วิดีโอใหญ่เกิน 10 MB ไม่ผ่าน · แม้จะยาวแค่วินาทีเดียว', () => {
    const reason = why({ ...video, bytes: VIDEO_MAX_BYTES + 1, durationSec: 1 })
    expect(reason).toContain('10 MB')
    // ความยาวต้องไม่ถูกกล่าวหา · 1 วินาทีอยู่ในเกณฑ์
    expect(reason).not.toContain('60 วินาที')
  })

  it('พอดี 10 MB ผ่าน', () => {
    expect(validateUpload({ ...video, bytes: VIDEO_MAX_BYTES }).ok).toBe(true)
  })

  it('วิดีโอที่ไม่รู้ความยาว ไม่ผ่าน · เดาแล้วเขียนลงคอลัมน์ไม่ได้', () => {
    const { durationSec, ...noDuration } = video
    expect(durationSec).toBe(45)
    expect(why(noDuration)).toContain('ความยาว')
  })

  it('ความยาวศูนย์หรือติดลบ ไม่ผ่าน', () => {
    expect(validateUpload({ ...video, durationSec: 0 }).ok).toBe(false)
    expect(validateUpload({ ...video, durationSec: -5 }).ok).toBe(false)
  })

  it('วิดีโอไม่ติดเพดานความกว้างของภาพ · 3840 กว้างกว่า 2500 แต่ผ่าน', () => {
    expect(validateUpload({ ...video, width: 3840, height: 2160 })).toEqual({ ok: true })
  })

  it('วิดีโอที่วัดขนาดภาพไม่ได้ ก็ยังถูกปฏิเสธ · วิดีโอไม่มีเพดานความกว้างมารับช่วงต่อ', () => {
    expect(why({ ...video, width: 0 })).toContain('อ่านขนาด')
    expect(why({ ...video, height: 0 })).toContain('อ่านขนาด')
  })

  it('mov ไม่ผ่าน · LINE เล่นได้แต่ mp4', () => {
    expect(why({ ...video, mime: 'video/quicktime' })).toContain('video/quicktime')
  })
})

describe('describeBytes', () => {
  it('ต่ำกว่าหนึ่งเมกะบอกเป็น KB', () => {
    expect(describeBytes(188 * 1024)).toBe('188 KB')
  })

  it('ตั้งแต่หนึ่งเมกะบอกเป็น MB ทศนิยมหนึ่งตำแหน่ง', () => {
    expect(describeBytes(2_000_000)).toBe('1.9 MB')
    expect(describeBytes(1_048_576)).toBe('1.0 MB')
  })

  it('ศูนย์ไบต์ไม่ใช่ค่าว่าง', () => {
    expect(describeBytes(0)).toBe('0 KB')
  })
})
