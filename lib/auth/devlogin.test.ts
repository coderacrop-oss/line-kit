import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devLoginAllowed } from './devlogin'

const original = { ...process.env }
beforeEach(() => { delete process.env.ALLOW_DEV_LOGIN; delete process.env.VERCEL_ENV })
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
})
