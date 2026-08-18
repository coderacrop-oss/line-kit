// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let pathname = '/campaigns'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

const { GlobalNav } = await import('./GlobalNav')

afterEach(cleanup)

describe('GlobalNav', () => {
  it('มีลิงก์ไปแคมเปญและบัญชี LINE เสมอ', () => {
    pathname = '/campaigns'
    render(<GlobalNav isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'แคมเปญ' }).getAttribute('href')).toBe('/campaigns')
    expect(screen.getByRole('link', { name: 'บัญชี LINE' }).getAttribute('href')).toBe('/channels')
  })

  it('ผู้ใช้ภายในเห็นเฉพาะ configurator เหมือนปุ่มในท็อปบาร์', () => {
    pathname = '/campaigns'
    render(<GlobalNav isAdmin={false} />)
    expect(screen.queryByRole('link', { name: 'ผู้ใช้ภายใน' })).toBeNull()
  })

  it('configurator เห็นลิงก์ผู้ใช้ภายใน', () => {
    pathname = '/campaigns'
    render(<GlobalNav isAdmin />)
    expect(screen.getByRole('link', { name: 'ผู้ใช้ภายใน' }).getAttribute('href')).toBe('/users')
  })

  it('อยู่หน้าบัญชี LINE รายการ — รายการ "บัญชี LINE" สว่าง', () => {
    pathname = '/channels'
    render(<GlobalNav isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'บัญชี LINE' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'แคมเปญ' }).getAttribute('aria-current')).toBeNull()
  })

  it('อยู่หน้าแก้บัญชี LINE ทีละใบ — รายการ "บัญชี LINE" ยังนับว่าเปิดอยู่', () => {
    pathname = '/channels/ch-1'
    render(<GlobalNav isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'บัญชี LINE' }).getAttribute('aria-current')).toBe('page')
  })

  it('อยู่หน้าผู้ใช้ภายใน — รายการนั้นสว่าง ตัวอื่นไม่สว่าง', () => {
    pathname = '/users'
    render(<GlobalNav isAdmin />)
    expect(screen.getByRole('link', { name: 'ผู้ใช้ภายใน' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'แคมเปญ' }).getAttribute('aria-current')).toBeNull()
  })
})
