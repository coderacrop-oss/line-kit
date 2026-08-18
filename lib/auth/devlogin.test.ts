import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devLoginAllowed } from './devlogin'

const original = { ...process.env }
beforeEach(() => {
  delete process.env.ALLOW_DEV_LOGIN
  delete process.env.VERCEL_ENV
  delete process.env.DEV_LOGIN_EVEN_IN_PRODUCTION
})
afterEach(() => { process.env = { ...original } })

describe('devLoginAllowed', () => {
  it('ปิดไว้เป็นค่าเริ่มต้น', () => {
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(false)
  })

  it('เปิดได้เมื่อสั่งชัดเจนและไม่ใช่ production', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(true)
    expect(devLoginAllowed({ nodeEnv: 'test' })).toBe(true)
  })

  it('production ปิดตายแม้ตั้ง env ไว้', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(false)
  })

  it('deploy จริงบน Vercel ปิดตายแม้ NODE_ENV จะบอกอย่างอื่น', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    process.env.VERCEL_ENV = 'production'
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(false)
  })

  it('ค่าอื่นที่ไม่ใช่ 1 ไม่นับว่าเปิด', () => {
    for (const value of ['true', 'yes', 'on', '0', '', ' 1']) {
      process.env.ALLOW_DEV_LOGIN = value
      expect(devLoginAllowed({ nodeEnv: 'development' }), `ค่า ${JSON.stringify(value)}`).toBe(false)
    }
  })

  it('VERCEL_ENV preview ไม่ปิด — เป็นที่ที่ตั้งใจให้ทดสอบ', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    process.env.VERCEL_ENV = 'preview'
    expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(false) // NODE_ENV ยังกันอยู่
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(true)
  })

  // ประตูฉุกเฉิน — ตั้งใจให้เปิดยากกว่า ALLOW_DEV_LOGIN หนึ่งชั้น ชื่อขู่ไว้ไม่ให้เผลอ
  // เปิดค้าง และต้องเปิดพร้อมกับ ALLOW_DEV_LOGIN เสมอ เปิดตัวเดียวไม่พอ
  describe('DEV_LOGIN_EVEN_IN_PRODUCTION', () => {
    it('เปิดทั้งสองตัวถึงจะผ่าน NODE_ENV production ได้', () => {
      process.env.ALLOW_DEV_LOGIN = '1'
      process.env.DEV_LOGIN_EVEN_IN_PRODUCTION = '1'
      expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(true)
    })

    it('เปิดทั้งสองตัวถึงจะผ่าน VERCEL_ENV production ได้', () => {
      process.env.ALLOW_DEV_LOGIN = '1'
      process.env.DEV_LOGIN_EVEN_IN_PRODUCTION = '1'
      process.env.VERCEL_ENV = 'production'
      expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(true)
    })

    it('เปิดตัวนี้ตัวเดียวไม่พอ — ต้องมี ALLOW_DEV_LOGIN=1 ด้วยเสมอ', () => {
      process.env.DEV_LOGIN_EVEN_IN_PRODUCTION = '1'
      expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(false)
    })

    it('ค่าอื่นที่ไม่ใช่ "1" ไม่นับว่าเปิด', () => {
      process.env.ALLOW_DEV_LOGIN = '1'
      for (const value of ['true', 'yes', '0', '']) {
        process.env.DEV_LOGIN_EVEN_IN_PRODUCTION = value
        expect(devLoginAllowed({ nodeEnv: 'production' }), `ค่า ${JSON.stringify(value)}`).toBe(false)
      }
    })
  })
})
