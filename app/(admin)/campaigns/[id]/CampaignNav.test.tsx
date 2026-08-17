// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignNav, NAV_GROUPS } from './CampaignNav'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

// usePathname เป็นตัวเดียวที่บอกได้ว่าตอนนี้อยู่จอไหน · เทสต์จึงเป็นคนบอกแทน router
const pathname = vi.hoisted(() => ({ value: '/campaigns/c1' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

const at = (path: string) => { pathname.value = path }

const itemNamed = (label: string): HTMLElement => {
  const found = screen.getByText(label)
  return found.closest('[data-nav-item]') as HTMLElement
}

describe('แถบซ้ายของแคมเปญ · โครงจากต้นแบบ', () => {
  it('มีทางกลับไปรายการแคมเปญเป็นอย่างแรก', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    const back = screen.getByRole('link', { name: '← แคมเปญทั้งหมด' })
    expect(back.getAttribute('href')).toBe('/campaigns')
  })

  it('หัวข้อกลุ่มครบสี่กลุ่มและเรียงตามต้นแบบ', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const heads = Array.from(container.querySelectorAll('[data-nav-head]')).map((h) => h.textContent)
    expect(heads).toEqual(['Config · ตั้งค่า', 'Rules · กติกา', 'Channel · เชื่อมต่อ', 'Test · ตรวจ'])
  })

  it('รายการในแต่ละกลุ่มครบและเรียงตามต้นแบบ', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const labels = Array.from(container.querySelectorAll('[data-nav-item]'))
      .map((i) => i.querySelector('[data-nav-label]')?.textContent)
    expect(labels).toEqual([
      'ข้อมูลแคมเปญ', 'กิจกรรม', 'การ์ด', 'คลังภาพ',
      'ค่าสะสม', 'รางวัล', 'ชุดเนื้อหา', 'คีย์เวิร์ด',
      'Rich Menu', 'บัญชี LINE', 'ส่งขึ้น LINE',
      'ทดลองเล่น',
    ])
  })

  it('หัวข้อกลุ่มเป็น mono เล็ก ระยะตัวห่าง ตามต้นแบบ', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const head = container.querySelector('[data-nav-head]') as HTMLElement
    expect(head.style.fontFamily).toBe('var(--mono)')
    expect(head.style.fontSize).toBe('9px')
    // jsdom เขียน .09em กลับมาเป็น 0.09em · ค่าที่ส่งเข้าไปคือค่าของต้นแบบ
    expect(head.style.letterSpacing).toBe('0.09em')
    expect(head.style.textTransform).toBe('uppercase')
  })

  it('แต่ละรายการใช้ช่องไฟและมุมโค้งของต้นแบบ', () => {
    at('/campaigns/c1')
    const item = (render(<CampaignNav campaignId="c1" />).container
      .querySelector('[data-nav-item]')) as HTMLElement
    expect(item.style.padding).toBe('8px 10px')
    expect(item.style.fontSize).toBe('13px')
    expect(item.style.borderRadius).toBe('7px')
  })

  it('แถบกว้าง 212 และมีเส้นคั่นด้านขวา', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const rail = container.firstElementChild as HTMLElement
    expect(rail.style.width).toBe('212px')
    expect(rail.style.borderRight).toContain('var(--rule)')
  })
})

describe('ปลายทางที่มีจริงกับที่ยังไม่มี', () => {
  it('ข้อมูลแคมเปญกับคีย์เวิร์ดเป็นลิงก์ที่ไปถึงจริง', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    expect(screen.getByRole('link', { name: 'ข้อมูลแคมเปญ' }).getAttribute('href'))
      .toBe('/campaigns/c1')
    expect(screen.getByRole('link', { name: 'คีย์เวิร์ด' }).getAttribute('href'))
      .toBe('/campaigns/c1/keywords')
    expect(screen.getByRole('link', { name: 'กิจกรรม' }).getAttribute('href'))
      .toBe('/campaigns/c1/activities')
    expect(screen.getByRole('link', { name: 'คลังภาพ' }).getAttribute('href'))
      .toBe('/campaigns/c1/assets')
    expect(screen.getByRole('link', { name: 'ค่าสะสม' }).getAttribute('href'))
      .toBe('/campaigns/c1/counters')
    expect(screen.getByRole('link', { name: 'รางวัล' }).getAttribute('href'))
      .toBe('/campaigns/c1/rewards')
    expect(screen.getByRole('link', { name: 'การ์ด' }).getAttribute('href'))
      .toBe('/campaigns/c1/cards')
    expect(screen.getByRole('link', { name: 'ชุดเนื้อหา' }).getAttribute('href'))
      .toBe('/campaigns/c1/selectors')
    expect(screen.getByRole('link', { name: 'ส่งขึ้น LINE' }).getAttribute('href'))
      .toBe('/campaigns/c1/publish')
  })

  /**
   * บัญชี LINE อยู่นอกแคมเปญ · ที่อยู่จึงไม่มี id ของแคมเปญอยู่ในนั้น
   *
   * A channel belongs to the account, not to one campaign — campaign_channel is
   * a join table precisely because several campaigns can point at the same OA.
   * Filing the screen under one campaign's id would promise an ownership the
   * table does not have, and would give the same screen a different address
   * depending on which campaign you happened to be in when you clicked it.
   */
  it('บัญชี LINE พาออกไปนอกแคมเปญ ไม่ใช่เข้าไปในแคมเปญ', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    expect(screen.getByRole('link', { name: 'บัญชี LINE' }).getAttribute('href')).toBe('/channels')
  })

  it('อยู่แคมเปญไหนก็ไปที่เดียวกัน', () => {
    at('/campaigns/c2')
    render(<CampaignNav campaignId="c2" />)
    expect(screen.getByRole('link', { name: 'บัญชี LINE' }).getAttribute('href')).toBe('/channels')
  })

  it('จอที่ยังไม่มีไม่เป็นลิงก์ · ไม่มีทางกดไปเจอหน้า 404', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const links = Array.from(container.querySelectorAll('[data-nav-item] a, a[data-nav-item]'))
      .map((a) => a.textContent)
    // ทางกลับไม่ได้อยู่ในรายการ · เหลือแค่จอที่มีจริง
    expect(links).toEqual([
      'ข้อมูลแคมเปญ', 'กิจกรรม', 'การ์ด', 'คลังภาพ',
      'ค่าสะสม', 'รางวัล', 'ชุดเนื้อหา', 'คีย์เวิร์ด',
      'บัญชี LINE', 'ส่งขึ้น LINE',
    ])
  })

  it('ทุกจอที่ยังไม่มีติดป้ายรอบถัดไปไว้ทุกอัน', () => {
    at('/campaigns/c1')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const soon = Array.from(container.querySelectorAll('[data-nav-item]'))
      .filter((i) => i.querySelector('a, [href]') === null && i.tagName !== 'A')
    expect(soon.length).toBe(2)
    for (const item of soon) {
      expect(within(item as HTMLElement).getByText('รอบถัดไป'), item.textContent ?? '').toBeDefined()
      expect(item.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('จอที่มีจริงไม่ติดป้ายรอบถัดไป', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('ข้อมูลแคมเปญ').textContent).toBe('ข้อมูลแคมเปญ')
    expect(itemNamed('คีย์เวิร์ด').textContent).toBe('คีย์เวิร์ด')
    expect(itemNamed('บัญชี LINE').textContent).toBe('บัญชี LINE')
    expect(itemNamed('คลังภาพ').textContent).toBe('คลังภาพ')
    expect(itemNamed('ค่าสะสม').textContent).toBe('ค่าสะสม')
    expect(itemNamed('รางวัล').textContent).toBe('รางวัล')
    expect(itemNamed('การ์ด').textContent).toBe('การ์ด')
    expect(itemNamed('ชุดเนื้อหา').textContent).toBe('ชุดเนื้อหา')
    expect(itemNamed('กิจกรรม').textContent).toBe('กิจกรรม')
  })

  it('ป้ายรอบถัดไปใช้ทรงเดียวกับต้นแบบ', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    const pill = screen.getAllByText('รอบถัดไป')[0] as HTMLElement
    expect(pill.style.fontFamily).toBe('var(--mono)')
    expect(pill.style.fontSize).toBe('8px')
    expect(pill.style.borderRadius).toBe('var(--r-pill)')
    expect(pill.style.padding).toBe('2px 7px')
  })

  it('เปิดจอใหม่ได้ด้วยการเติม path ให้รายการเดียว', () => {
    // รายการที่ยังไม่มีปลายทางคือรายการที่ไม่มี path — เติมบรรทัดเดียวก็เปิด
    const closed = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.path === undefined)
    expect(closed.map((i) => i.label)).toEqual([
      'Rich Menu', 'ทดลองเล่น',
    ])
  })
})

describe('รายการที่กำลังเปิดอยู่', () => {
  it('จอที่เปิดอยู่พื้นเข้มตัวอักษรสว่างตามต้นแบบ', () => {
    at('/campaigns/c1')
    render(<CampaignNav campaignId="c1" />)
    const active = itemNamed('ข้อมูลแคมเปญ')
    expect(active.style.background).toBe('var(--ink)')
    expect(active.style.color).toBe('var(--panel)')
    expect(active.style.fontWeight).toBe('600')
  })

  it('จออื่นไม่ถูกทำเป็นตัวเลือกที่เปิดอยู่พร้อมกัน', () => {
    at('/campaigns/c1/keywords')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const dark = Array.from(container.querySelectorAll('[data-nav-item]'))
      .filter((i) => (i as HTMLElement).style.background === 'var(--ink)')
    expect(dark.length).toBe(1)
    expect(dark[0]?.textContent).toBe('คีย์เวิร์ด')
  })

  it('ข้อมูลแคมเปญไม่ค้างสว่างตอนอยู่จอลูกของแคมเปญเดียวกัน', () => {
    at('/campaigns/c1/keywords')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('ข้อมูลแคมเปญ').style.background).not.toBe('var(--ink)')
  })

  it('จออัปโหลดยังนับว่าอยู่ที่คลังภาพ · ไม่ใช่หลุดออกจากรายการทั้งแถบ', () => {
    at('/campaigns/c1/assets/upload')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('คลังภาพ').style.background).toBe('var(--ink)')
  })

  it('จอแก้ค่าสะสมยังนับว่าอยู่ที่ค่าสะสม', () => {
    at('/campaigns/c1/counters/ct-9')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('ค่าสะสม').style.background).toBe('var(--ink)')
  })

  it('จอแก้ชุดเนื้อหายังนับว่าอยู่ที่ชุดเนื้อหา', () => {
    at('/campaigns/c1/selectors/sel-9')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('ชุดเนื้อหา').style.background).toBe('var(--ink)')
  })

  it('จอรายการการ์ดสว่างที่รายการการ์ด ไม่ใช่ที่ชุดเนื้อหาซึ่งอยู่คนละกลุ่ม', () => {
    at('/campaigns/c1/cards')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('การ์ด').style.background).toBe('var(--ink)')
    expect(itemNamed('ชุดเนื้อหา').style.background).not.toBe('var(--ink)')
  })

  it('จอตั้งค่ากิจกรรมยังนับว่าอยู่ที่กิจกรรม', () => {
    at('/campaigns/c1/activities/act-9')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('กิจกรรม').style.background).toBe('var(--ink)')
  })

  it('จอแก้รางวัลยังนับว่าอยู่ที่รางวัล', () => {
    at('/campaigns/c1/rewards/rw-3')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('รางวัล').style.background).toBe('var(--ink)')
  })

  it('จอลูกของรายการหนึ่งยังนับว่ารายการนั้นเปิดอยู่', () => {
    // ต้นแบบทำแบบนี้ด้วย kin — จอแก้ของอะไรยังเลือกอยู่ที่รายการของสิ่งนั้น
    at('/campaigns/c1/keywords/k9')
    render(<CampaignNav campaignId="c1" />)
    expect(itemNamed('คีย์เวิร์ด').style.background).toBe('var(--ink)')
  })

  it('แคมเปญอื่นไม่ทำให้รายการของแคมเปญนี้สว่าง', () => {
    at('/campaigns/c2/keywords')
    const { container } = render(<CampaignNav campaignId="c1" />)
    const dark = Array.from(container.querySelectorAll('[data-nav-item]'))
      .filter((i) => (i as HTMLElement).style.background === 'var(--ink)')
    expect(dark).toEqual([])
  })
})

describe('แถบซ้ายอยู่ในโครงของทุกจอในแคมเปญ', () => {
  const layout = readFileSync('app/(admin)/campaigns/[id]/layout.tsx', 'utf8')

  it('layout ของแคมเปญวาดแถบซ้ายไว้ให้ทุกจอข้างใน', () => {
    // เทียบกับตัวที่วาดจริง ไม่ใช่แค่บรรทัด import — ไฟล์ที่ import ไว้แล้วไม่ได้วาด
    // ก็ยังมีคำว่า CampaignNav อยู่ครบ
    expect(layout).toMatch(/<CampaignNav\s+campaignId=/)
    expect(layout).toContain('{children}')
  })

  it('เนื้อหาอยู่ข้างแถบ ไม่ใช่ใต้แถบ · และสูงเต็มจอลบแถบบน 56px', () => {
    expect(layout).toContain("display: 'flex'")
    expect(layout).toContain('calc(100vh - 56px)')
  })

  it('ไม่มีค่าสีเขียนตรงในไฟล์ของแถบซ้าย', () => {
    const nav = readFileSync('app/(admin)/campaigns/[id]/CampaignNav.tsx', 'utf8')
    expect(nav.match(/#[0-9A-Fa-f]{3,8}\b/g)).toBeNull()
    expect(layout.match(/#[0-9A-Fa-f]{3,8}\b/g)).toBeNull()
  })
})
