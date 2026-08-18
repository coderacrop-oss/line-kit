import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_KEY_VERSION, decryptSecret, encryptSecret, last4 } from './secretbox'

/**
 * กุญแจของเทสต์สร้างใหม่ทุกครั้ง ไม่ได้อ่านจาก .env
 *
 * A fixture key checked into the repo is a key, and the point of this module is
 * that keys do not sit where anyone can read them. Generating one per run also
 * means these tests never depend on a developer's .env.local being filled in,
 * and never silently pass against a key someone else's laptop happens to hold.
 */
const freshKey = () => randomBytes(32).toString('base64')

const saved = { ...process.env }

beforeEach(() => {
  process.env.SECRET_KEY_V1 = freshKey()
})

afterEach(() => {
  process.env = { ...saved }
})

describe('encryptSecret · decryptSecret', () => {
  it('เข้ารหัสแล้วถอดกลับได้ของเดิม', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    expect(decryptSecret(cipher, keyVersion)).toBe('super-secret-token')
  })

  it('ข้อความเดิมเข้ารหัสสองครั้งได้ผลต่างกัน', () => {
    expect(encryptSecret('x').cipher).not.toBe(encryptSecret('x').cipher)
  })

  it('ค่าที่เก็บไม่มีข้อความเดิมปนอยู่ ไม่ว่าจะอ่านเป็น base64 หรือเป็นไบต์', () => {
    const plain = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-token-tail'
    const { cipher } = encryptSecret(plain)
    expect(cipher).not.toContain(plain)
    expect(Buffer.from(cipher, 'base64').toString('latin1')).not.toContain(plain)
  })

  it('บอกรุ่นของกุญแจที่ใช้กลับมาด้วย จะได้หมุนกุญแจโดยไม่ต้องเขียนทุกแถวใหม่', () => {
    expect(encryptSecret('x').keyVersion).toBe(CURRENT_KEY_VERSION)
  })

  it('ข้อความว่างก็เข้ารหัสและถอดกลับได้ ไม่ใช่โยน', () => {
    const { cipher, keyVersion } = encryptSecret('')
    expect(decryptSecret(cipher, keyVersion)).toBe('')
  })

  it('อักษรไทยและอักขระนอก ASCII กลับมาครบ ไม่เพี้ยน', () => {
    const plain = 'กุญแจ·ทดสอบ·🔑'
    const { cipher, keyVersion } = encryptSecret(plain)
    expect(decryptSecret(cipher, keyVersion)).toBe(plain)
  })

  it('โทเคนยาวแบบของจริงก็กลับมาครบทุกตัว', () => {
    const plain = randomBytes(128).toString('base64')
    const { cipher, keyVersion } = encryptSecret(plain)
    expect(decryptSecret(cipher, keyVersion)).toBe(plain)
  })
})

/**
 * ป้ายยืนยันของ GCM ต้องปฏิเสธจริง ไม่ใช่คืนขยะ
 *
 * This is the whole reason for AES-GCM over plain AES. A ciphertext that has
 * been altered must fail loudly; one that decrypts into garbage becomes a bearer
 * token sent to LINE, and the failure surfaces as a 401 from someone else's
 * server rather than as a broken row here.
 *
 * Every region is tried separately — IV, tag and body — because a
 * decrypt that ignored the tag would still fail on a mangled body and look
 * defended.
 */
describe('ของที่ถูกแก้ระหว่างทาง', () => {
  const IV_BYTES = 12
  const TAG_BYTES = 16

  const flipByteAt = (cipher: string, index: number): string => {
    const raw = Buffer.from(cipher, 'base64')
    raw[index] ^= 0x01
    return raw.toString('base64')
  }

  it('แก้ท้าย ciphertext แล้วถอดไม่ได้ ไม่ใช่ได้ขยะ', () => {
    const { cipher, keyVersion } = encryptSecret('x')
    const tampered = cipher.slice(0, -4) + 'AAAA'
    expect(() => decryptSecret(tampered, keyVersion)).toThrow()
  })

  it('พลิกบิตเดียวในเนื้อความ ป้ายยืนยันจับได้', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    const tampered = flipByteAt(cipher, IV_BYTES + TAG_BYTES)
    expect(() => decryptSecret(tampered, keyVersion)).toThrow()
  })

  it('พลิกบิตเดียวในป้ายยืนยันเอง ก็ยังถอดไม่ได้', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    const tampered = flipByteAt(cipher, IV_BYTES)
    expect(() => decryptSecret(tampered, keyVersion)).toThrow()
  })

  it('พลิกบิตเดียวใน IV ก็ยังถอดไม่ได้', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    const tampered = flipByteAt(cipher, 0)
    expect(() => decryptSecret(tampered, keyVersion)).toThrow()
  })

  /**
   * พลิกได้ทุกไบต์ ไม่ใช่แค่ไบต์ที่เทสต์ข้างบนเลือกมา
   *
   * The three cases above each name one offset, which a decrypt could survive by
   * accident. This one walks the whole value, so there is nowhere left in it
   * that can be changed without being noticed.
   */
  it('ไม่มีไบต์ไหนในค่าที่เก็บที่แก้แล้วรอด', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    const length = Buffer.from(cipher, 'base64').length

    const survivors: number[] = []
    for (let index = 0; index < length; index += 1) {
      try {
        decryptSecret(flipByteAt(cipher, index), keyVersion)
        survivors.push(index)
      } catch { /* ปฏิเสธ = ถูกแล้ว */ }
    }
    expect(survivors).toEqual([])
  })

  /**
   * สั้นเกินกว่าจะเป็น ciphertext ต้องบอกแบบนั้น ไม่ใช่บอกว่ากุญแจผิด
   *
   * The two failures call for opposite responses — one means the row is not a
   * ciphertext at all, the other means the key is wrong — so the message is
   * asserted rather than only the fact that something was thrown.
   */
  it('ค่าที่สั้นกว่า IV กับป้ายยืนยันรวมกัน ถูกปฏิเสธ พร้อมบอกว่าสั้นเกินไป', () => {
    expect(() => decryptSecret(Buffer.alloc(4).toString('base64'), CURRENT_KEY_VERSION))
      .toThrow(/too short/i)
  })

  it('ค่าว่างเปล่าถูกปฏิเสธ พร้อมเหตุผลเดียวกัน', () => {
    expect(() => decryptSecret('', CURRENT_KEY_VERSION)).toThrow(/too short/i)
  })
})

/**
 * กุญแจคนละดอกถอดของกันไม่ได้
 *
 * Rotation is only safe if a value encrypted under the old key is unreadable
 * with the new one — otherwise "rotated" means nothing, and a leaked key stays
 * useful forever. Both directions are checked: a different version, and the same
 * version pointed at different key material.
 */
describe('กุญแจคนละดอก', () => {
  it('ของที่เข้ารหัสด้วยกุญแจรุ่น 1 ถอดด้วยกุญแจอีกดอกไม่ได้', () => {
    const { cipher } = encryptSecret('super-secret-token')
    process.env.SECRET_KEY_V2 = freshKey()

    expect(() => decryptSecret(cipher, 2)).toThrow()
  })

  it('เปลี่ยนเนื้อกุญแจของรุ่นเดิม ของเก่าก็ถอดไม่ได้อีกต่อไป', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    process.env.SECRET_KEY_V1 = freshKey()

    expect(() => decryptSecret(cipher, keyVersion)).toThrow()
  })

  it('ไม่มีกุญแจของรุ่นนั้น โยนโดยบอกชื่อตัวแปรที่ต้องตั้ง', () => {
    delete process.env.SECRET_KEY_V99
    expect(() => decryptSecret('x', 99)).toThrow(/SECRET_KEY_V99/)
  })

  /**
   * ไม่มีทางล้มทางไหนที่พากุญแจติดออกไปกับข้อความผิดพลาด
   *
   * Checking one failure path is not enough: an error message is written by
   * whoever is closest to the failure, and this walks every way this module can
   * fail so a new message cannot be added on a path nobody was looking at.
   */
  it('ข้อความผิดพลาดไม่พากุญแจหรือของเดิมติดออกไปด้วย ไม่ว่าจะล้มทางไหน', () => {
    const key = process.env.SECRET_KEY_V1 as string
    const { cipher, keyVersion } = encryptSecret('super-secret-token')

    const ways: Array<[string, () => unknown]> = [
      ['แก้ค่าที่เก็บ', () => decryptSecret(cipher.slice(0, -4) + 'AAAA', keyVersion)],
      ['สั้นเกินไป', () => decryptSecret(Buffer.alloc(4).toString('base64'), keyVersion)],
      ['ว่างเปล่า', () => decryptSecret('', keyVersion)],
      ['ไม่มีกุญแจรุ่นนั้น', () => decryptSecret(cipher, 99)],
      ['กุญแจผิดขนาด', () => {
        process.env.SECRET_KEY_V1 = randomBytes(16).toString('base64')
        return encryptSecret('super-secret-token')
      }],
    ]

    for (const [name, run] of ways) {
      let message = ''
      try { run() } catch (error) { message = `${String(error)} ${(error as Error).stack ?? ''}` }

      expect(message, `${name} ต้องล้ม`).not.toBe('')
      expect(message, name).not.toContain(key)
      expect(message, name).not.toContain('super-secret-token')
    }
  })

  it('กุญแจที่ไม่ใช่ 32 ไบต์ ถูกปฏิเสธตอนใช้ ไม่ใช่ตอนถอดไม่ออก', () => {
    for (const bytes of [16, 31, 33, 64]) {
      process.env.SECRET_KEY_V1 = randomBytes(bytes).toString('base64')
      expect(() => encryptSecret('x'), `${bytes} ไบต์`).toThrow(/SECRET_KEY_V1/)
    }
  })

  it('ไม่ได้ตั้งกุญแจของรุ่นปัจจุบันไว้เลย เข้ารหัสไม่ได้', () => {
    delete process.env.SECRET_KEY_V1
    expect(() => encryptSecret('x')).toThrow(/SECRET_KEY_V1/)
  })
})

/**
 * สี่ตัวท้าย แปลว่าสี่ตัว ไม่ว่าจะป้อนอะไรเข้าไป (BR-16)
 *
 * The screen shows this and nothing else, so an input that could make it return
 * more than four characters is a leak with a friendly label on it.
 */
describe('last4', () => {
  it('คืนสี่ตัวท้าย ไม่เผยส่วนอื่น', () => {
    expect(last4('abcdefgh1234')).toBe('1234')
    expect(last4('ab')).toBe('ab')
  })

  it('ไม่ว่าจะป้อนอะไร ก็ไม่เกินสี่ตัวอักษร', () => {
    const inputs = [
      '',
      'a',
      'abcd',
      'abcde',
      'x'.repeat(10_000),
      randomBytes(256).toString('base64'),
      '     ',
      'กุญแจของบัญชีนี้ยาวมาก',
      '🔑🔑🔑🔑🔑🔑',
      'a\nb\nc\nd\ne',
      '     ',
    ]

    for (const input of inputs) {
      const shown = last4(input)
      expect(shown.length, JSON.stringify(input.slice(0, 20))).toBeLessThanOrEqual(4)
      expect([...shown].length, JSON.stringify(input.slice(0, 20))).toBeLessThanOrEqual(4)
    }
  })

  it('คืนได้แค่ส่วนท้ายของค่าเดิมเท่านั้น ไม่ใช่ค่าอื่น', () => {
    for (const input of ['abcdefgh1234', 'ab', '', 'x'.repeat(500)]) {
      expect(input.endsWith(last4(input)), JSON.stringify(input.slice(0, 20))).toBe(true)
    }
  })

  // สุ่มยาวๆ หลายรอบ เพราะเงื่อนไข "ไม่เกินสี่" ต้องจริงกับทุกความยาว ไม่ใช่กับที่เลือกมา
  it('ยาวเท่าไหร่ก็ยังสี่ตัว', () => {
    for (let length = 0; length < 200; length += 1) {
      expect(last4('z'.repeat(length)).length).toBe(Math.min(4, length))
    }
  })
})
