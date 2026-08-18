import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATUS_TONES } from './tokens'

const css = readFileSync('app/globals.css', 'utf8')

describe('design tokens', () => {
  it('มี token ทุกตัวที่ต้นแบบใช้', () => {
    for (const name of [
      '--ground', '--panel', '--panel-2', '--ink', '--ink-2', '--ink-3',
      '--rule', '--rule-2', '--accent', '--warn', '--danger', '--ok', '--info',
      '--sans', '--mono', '--r', '--r-lg', '--r-pill', '--r-sm',
    ]) {
      expect(css, `ขาด ${name}`).toContain(`${name}:`)
    }
  })

  it('ค่าสีตรงกับต้นแบบ', () => {
    expect(css).toContain('--ground: #F7F7F5')
    expect(css).toContain('--panel: #FFFFFF')
    expect(css).toContain('--ink: #111111')
    expect(css).toContain('--ink-3: #9B9B98')
    expect(css).toContain('--accent: #E63B2E')
    expect(css).toContain('--rule: #E5E5E3')
  })

  it('สถานะทั้งสี่มีสีตัวอักษรที่อ่านออกบนพื้นของตัวเอง', () => {
    for (const tone of ['ok', 'warn', 'danger', 'info'] as const) {
      expect(STATUS_TONES[tone].fg).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(STATUS_TONES[tone].bg).toMatch(/^rgba\(/)
      expect(STATUS_TONES[tone].border).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('สีตัวอักษรของแต่ละสถานะไม่ใช่สีเส้นขอบ — สีเส้นขอบอ่านบนพื้นอ่อนไม่ออก', () => {
    for (const tone of ['ok', 'warn', 'danger', 'info'] as const) {
      expect(STATUS_TONES[tone].fg).not.toBe(STATUS_TONES[tone].border)
    }
  })

  it('ทั้งสี่โทนมีสีตัวอักษรต่างกัน จึงแยกออกได้แม้ไม่เห็นเส้นขอบ', () => {
    const fgs = Object.values(STATUS_TONES).map((t) => t.fg)
    expect(new Set(fgs).size).toBe(fgs.length)
  })

  it('เคารพ prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion')
  })

  it('มีสถานะโฟกัสที่มองเห็น — เดินด้วยคีย์บอร์ดได้', () => {
    expect(css).toContain(':focus-visible')
  })
})
