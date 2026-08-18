'use client'

import { usePathname } from 'next/navigation'
import type { CSSProperties } from 'react'

type GlobalNavProps = { isAdmin: boolean }

type Item = { label: string; href: string; adminOnly?: boolean }

const ITEMS: Item[] = [
  { label: 'แคมเปญ', href: '/campaigns' },
  { label: 'บัญชี LINE', href: '/channels' },
  { label: 'ผู้ใช้ภายใน', href: '/users', adminOnly: true },
]

const railStyle: CSSProperties = {
  width: 212,
  flexShrink: 0,
  borderRight: '1px solid var(--rule)',
  background: 'var(--panel)',
  padding: '14px 10px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const headStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.09em',
  textTransform: 'uppercase', color: 'var(--ink-3)', padding: '14px 10px 5px',
}

const itemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 10px', fontSize: 13, borderRadius: 7, color: 'var(--ink)',
}

const activeStyle: CSSProperties = {
  background: 'var(--ink)', color: 'var(--panel)', fontWeight: 600,
}

/**
 * เมนูของจอที่อยู่นอกแคมเปญ (`/campaigns` · `/channels` · `/users`)
 *
 * CampaignNav (แถบซ้ายในแคมเปญ) กับจอนี้เป็นคนละแถบกันตั้งใจ ไม่ใช่ตัวเดียวกัน —
 * รายการของ CampaignNav ทุกอันผูกกับแคมเปญใดแคมเปญหนึ่งเสมอ (การ์ด · กิจกรรม ฯลฯ)
 * เอามาวางไว้นอกแคมเปญไม่ได้เพราะไม่มีแคมเปญให้ลิงก์ชี้ไป · ต้นแบบเองก็ไม่มีจอไหน
 * ในสามจอนี้ที่มีแถบซ้ายเลย (`{{ inCamp }}` = false) — จอนี้เป็นของที่เพิ่มขึ้นมา
 * นอกต้นแบบ เพราะกดเข้ามาจากแถบซ้ายของแคมเปญแล้วแถบหายไปเฉยๆ สร้างความสับสน
 *
 * รายชื่อตรงกับปุ่ม "ผู้ใช้ภายใน" ในท็อปบาร์ทุกประการ รวมถึงเงื่อนไขที่เห็น —
 * configurator เท่านั้น เพราะ requireRole('configurator') เป็นด่านเดียวที่
 * app/(admin)/users/actions.ts ยอมให้ผ่าน
 */
export function GlobalNav({ isAdmin }: GlobalNavProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="เมนูหลัก" style={railStyle}>
      <div style={headStyle}>จัดการ · Manage</div>
      {ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const on = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <a
            key={item.href}
            className={on ? 'nav-item nav-item-on' : 'nav-item'}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            style={on ? { ...itemStyle, ...activeStyle } : itemStyle}
          >
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
