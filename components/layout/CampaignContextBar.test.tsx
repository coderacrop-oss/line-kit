// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CampaignContextBar } from './CampaignContextBar'

afterEach(cleanup)

const NOT_YET = [
  { channelType: 'test' as const, versionNo: null },
  { channelType: 'production' as const, versionNo: null },
]

describe('CampaignContextBar', () => {
  it('แสดงชื่อแคมเปญเสมอ แม้ยังไม่ขึ้นบัญชีไหนเลย', () => {
    render(<CampaignContextBar name="งานปีใหม่" channels={NOT_YET} />)
    expect(screen.getByText('งานปีใหม่')).toBeDefined()
  })

  it('ยังไม่ขึ้นบัญชีไหนเลย ขึ้นป้ายจางบอกทั้งสองช่อง', () => {
    render(<CampaignContextBar name="งานปีใหม่" channels={NOT_YET} />)
    expect(screen.getByText('ยังไม่ขึ้นบัญชีทดสอบ')).toBeDefined()
    expect(screen.getByText('ยังไม่ขึ้นบัญชีลูกค้า')).toBeDefined()
  })

  it('บัญชีทดสอบที่ส่งขึ้นแล้ว ขึ้นป้ายพร้อมเลขเวอร์ชัน · ช่องลูกค้ายังเป็นป้ายจาง', () => {
    render(<CampaignContextBar name="งานปีใหม่" channels={[
      { channelType: 'test', versionNo: 3 }, { channelType: 'production', versionNo: null },
    ]} />)
    expect(screen.getByText('บัญชีทดสอบ · v3')).toBeDefined()
    expect(screen.getByText('ยังไม่ขึ้นบัญชีลูกค้า')).toBeDefined()
  })

  it('บัญชีลูกค้าที่ส่งขึ้นแล้ว ขึ้นป้ายคนละคำกับบัญชีทดสอบ', () => {
    render(<CampaignContextBar name="งานปีใหม่" channels={[
      { channelType: 'test', versionNo: null }, { channelType: 'production', versionNo: 5 },
    ]} />)
    expect(screen.getByText('บัญชีลูกค้า · v5')).toBeDefined()
  })

  it('ส่งขึ้นทั้งสองบัญชี ขึ้นป้ายครบทั้งคู่ ไม่มีป้ายจางเหลือ', () => {
    const { container } = render(<CampaignContextBar name="งานปีใหม่" channels={[
      { channelType: 'test', versionNo: 1 },
      { channelType: 'production', versionNo: 2 },
    ]} />)
    expect(screen.getByText('บัญชีทดสอบ · v1')).toBeDefined()
    expect(screen.getByText('บัญชีลูกค้า · v2')).toBeDefined()
    expect(container.querySelectorAll('[data-channel-badge-empty]').length).toBe(0)
  })
})
