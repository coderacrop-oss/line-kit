import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicImagemapBaseUrl } from './url'

afterEach(() => vi.unstubAllEnvs())

describe('publicImagemapBaseUrl', () => {
  it('ประกอบ base + /api/imagemap/{cardId} ไม่มี "/" ต่อท้าย ไม่มีนามสกุลไฟล์', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
    expect(publicImagemapBaseUrl('card-1')).toBe('https://flex.example.com/api/imagemap/card-1')
  })

  it('ตัด "/" ท้าย PUBLIC_BASE_URL ทิ้งก่อนต่อ — กันทางที่อยู่กลายเป็น "//api"', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com/')
    expect(publicImagemapBaseUrl('card-1')).toBe('https://flex.example.com/api/imagemap/card-1')
  })

  it('ตัด "/" ท้ายหลายตัวทิ้งด้วย', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com///')
    expect(publicImagemapBaseUrl('card-1')).toBe('https://flex.example.com/api/imagemap/card-1')
  })

  it('ไม่ได้ตั้งค่าไว้เลย คืน null ไม่ใช่โยน error — ผู้เล่นยังต้องได้คำตอบ (BR-01)', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '')
    expect(publicImagemapBaseUrl('card-1')).toBeNull()
  })
})
