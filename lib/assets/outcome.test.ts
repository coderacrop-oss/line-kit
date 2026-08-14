import { describe, expect, it } from 'vitest'
import { MAX_REPORTED, MAX_TEXT, decodeOutcome, encodeOutcome } from './outcome'

const roundTrip = (outcome: Parameters<typeof encodeOutcome>[0]) => {
  const params = Object.fromEntries(new URLSearchParams(encodeOutcome(outcome)))
  return decodeOutcome(params)
}

describe('encodeOutcome · decodeOutcome ไปกลับ', () => {
  it('จำนวนที่อัปโหลดสำเร็จเดินทางกลับมาครบ', () => {
    expect(roundTrip({ uploaded: 3, rejected: [] })).toEqual({ uploaded: 3, rejected: [] })
  })

  it('ไฟล์ที่ไม่ผ่านเดินทางกลับมาพร้อมเหตุผลของมัน', () => {
    const outcome = {
      uploaded: 2,
      rejected: [
        { file: 'promo-day2.jpg', why: 'ไฟล์ 1.5 MB เกินเพดานของภาพ 1 MB' },
        { file: 'reward-card.gif', why: 'ไฟล์ชนิด image/gif ใช้ไม่ได้' },
      ],
    }
    expect(roundTrip(outcome)).toEqual(outcome)
  })

  it('ชื่อไฟล์ไทยและอักขระของ URL ไม่ทำให้ผลเพี้ยน', () => {
    const outcome = {
      uploaded: 0,
      rejected: [{ file: 'ภาพ&รางวัล=1?.png', why: 'เหตุผลที่มี & กับ = อยู่ข้างใน' }],
    }
    expect(roundTrip(outcome)).toEqual(outcome)
  })

  it('ไม่มีไฟล์ที่ไม่ผ่าน ก็ไม่ใส่พารามิเตอร์นั้นมาให้รก', () => {
    expect(encodeOutcome({ uploaded: 1, rejected: [] })).toBe('uploaded=1')
  })
})

describe('decodeOutcome · ค่าที่ใครก็พิมพ์เองได้', () => {
  it('ไม่มีพารามิเตอร์เลย = ยังไม่ได้ส่งอะไร ไม่ใช่ส่งแล้วศูนย์ไฟล์', () => {
    expect(decodeOutcome({})).toBeNull()
  })

  it('ส่งแล้วไม่มีไฟล์ไหนผ่าน ต่างจากยังไม่ได้ส่ง', () => {
    expect(decodeOutcome({ uploaded: '0' })).toEqual({ uploaded: 0, rejected: [] })
  })

  it('JSON ที่พังไม่ทำให้จอล่ม และไม่กลายเป็นข้อความบนจอ', () => {
    expect(decodeOutcome({ uploaded: '1', rejected: '{ไม่ใช่ json' }))
      .toEqual({ uploaded: 1, rejected: [] })
  })

  it('JSON ที่ถูกต้องแต่ผิดรูป ถูกทิ้ง ไม่ใช่วาดออกมาดิบๆ', () => {
    for (const raw of ['{"a":1}', '"ข้อความ"', '[1,2,3]', '[["only-one"]]', 'null', '[[1,2]]']) {
      expect(decodeOutcome({ uploaded: '0', rejected: raw })?.rejected, raw).toEqual([])
    }
  })

  it('รายการที่ผิดรูปบางอันถูกทิ้งทีละอัน ไม่ล้มทั้งชุด', () => {
    const raw = JSON.stringify([['a.png', 'เหตุผล'], 'ขยะ', ['b.png', 'อีกเหตุผล']])
    expect(decodeOutcome({ uploaded: '0', rejected: raw })?.rejected).toEqual([
      { file: 'a.png', why: 'เหตุผล' },
      { file: 'b.png', why: 'อีกเหตุผล' },
    ])
  })

  it('จำนวนที่ไม่ใช่ตัวเลขหรือติดลบ กลายเป็นศูนย์ ไม่ใช่ NaN บนจอ', () => {
    for (const raw of ['ห้า', '-3', 'Infinity', '', '1e999']) {
      expect(decodeOutcome({ uploaded: raw })?.uploaded, raw).toBe(0)
    }
  })

  it('ทศนิยมถูกตัดเป็นจำนวนเต็ม · "อัปโหลด 2.7 ไฟล์" ไม่มีความหมาย', () => {
    expect(decodeOutcome({ uploaded: '2.7' })?.uploaded).toBe(2)
  })

  it('รายการยาวเกินกว่าที่รายงานได้ ถูกตัด ไม่ใช่วาดหมดทุกอัน', () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_REPORTED + 40 }, (_, i) => [`f${i}.png`, 'เหตุผล']),
    )
    expect(decodeOutcome({ uploaded: '0', rejected: many })?.rejected.length).toBe(MAX_REPORTED)
  })

  it('ข้อความยาวมากถูกตัด · URL ไม่ใช่ที่เก็บเรียงความ', () => {
    const long = JSON.stringify([['x'.repeat(5000), 'y'.repeat(5000)]])
    const got = decodeOutcome({ uploaded: '0', rejected: long })?.rejected[0]
    expect(got?.file.length).toBe(MAX_TEXT)
    expect(got?.why.length).toBe(MAX_TEXT)
  })

  it('เข้ารหัสก็ตัดตั้งแต่ต้นทาง ไม่ใช่ตัดแค่ตอนอ่าน', () => {
    const encoded = encodeOutcome({
      uploaded: 1,
      rejected: Array.from({ length: MAX_REPORTED + 5 }, () => ({
        file: 'x'.repeat(400), why: 'y'.repeat(400),
      })),
    })
    const pairs = JSON.parse(new URLSearchParams(encoded).get('rejected') as string)
    expect(pairs.length).toBe(MAX_REPORTED)
    expect(pairs[0][0].length).toBe(MAX_TEXT)
  })

  it('พารามิเตอร์ที่ส่งมาซ้ำสองครั้ง อ่านอันแรก ไม่ใช่พังเพราะเป็นอาเรย์', () => {
    expect(decodeOutcome({ uploaded: ['2', '99'] })?.uploaded).toBe(2)
  })
})
