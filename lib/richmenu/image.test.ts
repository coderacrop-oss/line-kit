import { describe, expect, it } from 'vitest'
import { isValidMenuImageSize, menuImageSizeWarning } from './image'

describe('isValidMenuImageSize', () => {
  it('2500×1686 (ผืนใหญ่) ผ่าน', () => {
    expect(isValidMenuImageSize(2500, 1686)).toBe(true)
  })

  it('2500×843 (ผืนเล็ก) ผ่าน', () => {
    expect(isValidMenuImageSize(2500, 843)).toBe(true)
  })

  it.each([
    [2500, 1685], [2500, 1687], [2499, 1686], [2501, 1686],
    [2500, 842], [2500, 844], [1200, 405], [0, 0],
  ])('%i×%i ไม่ผ่าน — ไม่ตรงขนาดใดในสองขนาดที่รับ', (w, h) => {
    expect(isValidMenuImageSize(w, h)).toBe(false)
  })
})

describe('menuImageSizeWarning', () => {
  it('ผืนใหญ่ถูกต้อง → ไม่มีคำเตือน', () => {
    expect(menuImageSizeWarning(2500, 1686)).toBeNull()
  })

  it('ผืนเล็กถูกต้อง → ไม่มีคำเตือน', () => {
    expect(menuImageSizeWarning(2500, 843)).toBeNull()
  })

  it('ขนาดผิด → คำเตือนบอกขนาดจริงและทั้งสองขนาดที่รับได้', () => {
    const warning = menuImageSizeWarning(1200, 405)
    expect(warning).toContain('1200×405')
    expect(warning).toContain('2500×1686')
    expect(warning).toContain('2500×843')
  })
})
