import { describe, expect, it } from 'vitest'
import { isValidMenuImageSize, menuImageSizeWarning } from './image'

describe('isValidMenuImageSize', () => {
  it('2500×1686 พอดีเท่านั้นที่ผ่าน', () => {
    expect(isValidMenuImageSize(2500, 1686)).toBe(true)
  })

  it.each([
    [2500, 1685], [2500, 1687], [2499, 1686], [2501, 1686], [1200, 405], [0, 0],
  ])('%i×%i ไม่ผ่าน', (w, h) => {
    expect(isValidMenuImageSize(w, h)).toBe(false)
  })
})

describe('menuImageSizeWarning', () => {
  it('ขนาดถูกต้อง → ไม่มีคำเตือน', () => {
    expect(menuImageSizeWarning(2500, 1686)).toBeNull()
  })

  it('ขนาดผิด → คำเตือนบอกขนาดจริงและขนาดที่ต้องการ', () => {
    const warning = menuImageSizeWarning(1200, 405)
    expect(warning).toContain('1200×405')
    expect(warning).toContain('2500×1686')
  })
})
