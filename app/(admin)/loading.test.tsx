// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AdminLoading from './loading'

afterEach(cleanup)

describe('AdminLoading', () => {
  it('ประกาศสถานะให้ screen reader รู้ว่ากำลังโหลด', () => {
    render(<AdminLoading />)
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeDefined()
  })

  it('ใช้ token สีเท่านั้น ไม่มี hex ของตัวเอง', () => {
    const { container } = render(<AdminLoading />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
