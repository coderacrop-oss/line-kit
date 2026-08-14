import { describe, expect, it } from 'vitest'
import { classify, type UserRow } from './session'

const active: UserRow = { id: 'u1', email: 'a@x.co', role: 'configurator', is_active: true }

describe('classify', () => {
  it('ไม่มีแถวในรายชื่อ = ยังไม่ได้รับสิทธิ์', () => {
    expect(classify(undefined, 'new@x.co')).toEqual({ reason: 'not_on_list', email: 'new@x.co' })
  })

  it('มีแถวแต่ถูกปิด = สิทธิ์ถูกถอน ไม่ใช่ไม่รู้จัก', () => {
    expect(classify({ ...active, is_active: false }, 'a@x.co'))
      .toEqual({ reason: 'revoked', email: 'a@x.co' })
  })

  it('มีแถวและเปิดอยู่ = เข้าได้ พร้อม role', () => {
    expect(classify(active, 'a@x.co')).toEqual({ userId: 'u1', email: 'a@x.co', role: 'configurator' })
  })

  it('เทียบอีเมลแบบไม่แยกตัวพิมพ์ และคืนอีเมลรูปที่เก็บไว้', () => {
    expect(classify(active, 'A@X.CO')).toEqual({ userId: 'u1', email: 'a@x.co', role: 'configurator' })
  })

  it('อีเมลของคนที่ถูกถอนสิทธิ์ คืนรูปที่เก็บไว้ ไม่ใช่รูปที่พิมพ์เข้ามา', () => {
    expect(classify({ ...active, is_active: false }, 'A@X.CO'))
      .toEqual({ reason: 'revoked', email: 'a@x.co' })
  })
})
