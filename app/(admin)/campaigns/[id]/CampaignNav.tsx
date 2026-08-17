'use client'

import { usePathname } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'

export type NavItem = {
  label: string
  /**
   * ทางเดินต่อจาก `/campaigns/[id]` · ขึ้นต้นด้วย `/` = ที่อยู่เต็ม · ไม่ใส่ = จอนั้นยังไม่มี
   *
   * Absent means the screen does not exist yet, and the item renders as a
   * disabled row carrying the prototype's "รอบถัดไป" pill. Turning one on later
   * is adding `path` to its line here — the rendering already handles both.
   *
   * A leading slash means the screen is not inside this campaign at all. Only
   * บัญชี LINE is like that today: a channel belongs to the account and can be
   * shared by several campaigns, so filing it under one campaign's id would
   * promise an ownership the table does not have.
   */
  path?: string
}

export type NavGroup = { head: string; items: NavItem[] }

/**
 * กลุ่มและลำดับถอดจาก docs/design/flex-builder-prototype.html ตรงๆ
 *
 * The prototype builds this list for the configurator role; the two other roles
 * get shorter lists there. Every screen those shorter lists point at is still
 * unbuilt, so a role-specific rail today would be a rail of nothing but pills.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    head: 'Config · ตั้งค่า',
    items: [
      { label: 'ข้อมูลแคมเปญ', path: '' },
      { label: 'กิจกรรม', path: 'activities' },
      { label: 'การ์ด', path: 'cards' },
      { label: 'คลังภาพ', path: 'assets' },
    ],
  },
  {
    head: 'Rules · กติกา',
    items: [
      { label: 'ค่าสะสม', path: 'counters' },
      { label: 'รางวัล', path: 'rewards' },
      { label: 'ชุดเนื้อหา', path: 'selectors' },
      { label: 'คีย์เวิร์ด', path: 'keywords' },
    ],
  },
  {
    head: 'Channel · เชื่อมต่อ',
    items: [
      { label: 'Rich Menu' },
      { label: 'บัญชี LINE', path: '/channels' },
      { label: 'ส่งขึ้น LINE', path: 'publish' },
    ],
  },
  {
    head: 'Test · ตรวจ',
    items: [{ label: 'ทดลองเล่น' }],
  },
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

const backStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', fontSize: 12, color: 'var(--ink-3)', borderRadius: 6,
}

const headStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.09em',
  textTransform: 'uppercase', color: 'var(--ink-3)', padding: '14px 10px 5px',
}

const itemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  padding: '8px 10px', fontSize: 13, borderRadius: 7, color: 'var(--ink)',
}

const activeStyle: CSSProperties = {
  background: 'var(--ink)', color: 'var(--panel)', fontWeight: 600,
}

const pillStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
  border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)', padding: '2px 7px',
}

const hrefOf = (campaignId: string, path: string) => {
  if (path.startsWith('/')) return path
  return path === '' ? `/campaigns/${campaignId}` : `/campaigns/${campaignId}/${path}`
}

/**
 * จอลูกยังนับว่ารายการแม่เปิดอยู่ ยกเว้นรายการที่เป็นรากของแคมเปญ
 *
 * The prototype keeps an item selected while you are on the edit screen that
 * belongs to it. Prefix matching says the same thing here — except for
 * ข้อมูลแคมเปญ, whose href is the campaign root and so prefixes every other
 * screen in the campaign. It has to match exactly or it never goes out.
 */
export function isActive(pathname: string, href: string, isRoot: boolean): boolean {
  if (pathname === href) return true
  return !isRoot && pathname.startsWith(`${href}/`)
}

function Item({ item, campaignId, pathname }: {
  item: NavItem
  campaignId: string
  pathname: string
}) {
  const label = <span data-nav-label>{item.label}</span>

  if (item.path === undefined) {
    return (
      <div data-nav-item aria-disabled="true" style={itemStyle}>
        {label}
        <span style={pillStyle}>รอบถัดไป</span>
      </div>
    )
  }

  const href = hrefOf(campaignId, item.path)
  const on = isActive(pathname, href, item.path === '')

  return (
    <a
      data-nav-item
      className={on ? 'nav-item nav-item-on' : 'nav-item'}
      href={href}
      aria-current={on ? 'page' : undefined}
      style={on ? { ...itemStyle, ...activeStyle } : itemStyle}
    >
      {label}
    </a>
  )
}

/**
 * แถบซ้ายของทุกจอที่อยู่ในแคมเปญ · 212px ตามต้นแบบ
 *
 * A screen that does not exist yet is a disabled row with a pill, never a link.
 * A link to a route that has not been written is a 404 with no way back, and the
 * rail is the only navigation these screens have.
 */
export function CampaignNav({ campaignId, children }: {
  campaignId: string
  children?: ReactNode
}) {
  const pathname = usePathname()

  return (
    <nav aria-label="เมนูของแคมเปญ" style={railStyle}>
      <a className="nav-back" href="/campaigns" style={backStyle}>← แคมเปญทั้งหมด</a>
      {children}
      {NAV_GROUPS.map((group) => (
        <div key={group.head} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div data-nav-head style={headStyle}>{group.head}</div>
          {group.items.map((item) => (
            <Item key={item.label} item={item} campaignId={campaignId} pathname={pathname} />
          ))}
        </div>
      ))}
    </nav>
  )
}
