// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'

afterEach(cleanup)

describe('TopBar', () => {
  it('แสดงชื่อโปรแกรม อีเมล และป้ายบทบาทของผู้ใช้', () => {
    render(<TopBar email="a@b.com" roleLabel="ผู้ตั้งค่าแคมเปญ" isAdmin={false} />)
    expect(screen.getByText('Flex System Builder')).toBeDefined()
    expect(screen.getByText(/a@b\.com/)).toBeDefined()
    expect(screen.getByText(/ผู้ตั้งค่าแคมเปญ/)).toBeDefined()
  })

  it('ปุ่มออกจากระบบอยู่เสมอ ไม่ว่าบทบาทไหน', () => {
    render(<TopBar email="a@b.com" roleLabel="ผู้ดูรายงาน" isAdmin={false} />)
    expect(screen.getByRole('button', { name: /ออก/ })).toBeDefined()
  })

  it('ลิงก์ผู้ใช้ภายในเห็นเฉพาะผู้ตั้งค่าแคมเปญ — คนอื่นไม่เห็นเลย', () => {
    render(<TopBar email="a@b.com" roleLabel="ผู้ตั้งค่าแคมเปญ" isAdmin={false} />)
    expect(screen.queryByRole('link', { name: 'ผู้ใช้ภายใน' })).toBeNull()
  })

  it('ผู้ตั้งค่าแคมเปญเห็นลิงก์ผู้ใช้ภายใน ชี้ไปที่ /users', () => {
    render(<TopBar email="a@b.com" roleLabel="ผู้ตั้งค่าแคมเปญ" isAdmin />)
    const link = screen.getByRole('link', { name: 'ผู้ใช้ภายใน' })
    expect(link.getAttribute('href')).toBe('/users')
  })
})
