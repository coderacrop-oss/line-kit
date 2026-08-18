// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RichMenuScreenData } from '@/lib/db/richmenu'

afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: {
  session: Session
  campaign: Record<string, unknown> | null
  screen: RichMenuScreenData
} = {
  session: null,
  campaign: null,
  screen: { menus: [], images: [], activities: [], cards: [] },
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/db/richmenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/richmenu')>()),
  loadRichMenuScreen: async () => state.screen,
}))
vi.mock('./actions', () => ({
  createMenu: vi.fn(), saveMenu: vi.fn(), changeLayout: vi.fn(), setEntry: vi.fn(), deleteMenu: vi.fn(),
}))

const RichMenuPage = (await import('./page')).default

const goodMenu = (patch: Partial<RichMenuScreenData['menus'][number]> = {}) => ({
  id: 'm1',
  alias: 'main',
  imageAssetId: 'asset-1',
  imageUrl: '/uploads/x/a.png',
  imageWidth: 2500,
  imageHeight: 1686,
  areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none' as const, target: null }],
  isEntry: false,
  lineRichMenuId: null,
  chatBarText: 'เมนู',
  layout: 'one' as const,
  emptyCount: 1,
  imageBad: false,
  ...patch,
})

beforeEach(() => {
  state.session = { userId: 'u1', email: 'someone@example.com', role: 'configurator' }
  state.campaign = { id: 'c1', name: 'แคมเปญทดสอบ' }
  state.screen = { menus: [], images: [], activities: [], cards: [] }
})

const open = async () => render(await RichMenuPage({ params: Promise.resolve({ id: 'c1' }) }))

describe('M4-S01 · Rich Menu — โครงจอ', () => {
  it('มีป้ายรหัสจอและหัวข้อ', async () => {
    await open()
    expect(screen.getByText('M4-S01 · Rich Menu')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Rich Menu' })).toBeDefined()
  })

  it('ไม่มีเมนูเลย แสดงสถานะว่าง', async () => {
    await open()
    expect(screen.getByText('ยังไม่มีเมนู — ผู้เล่นจะเข้าแคมเปญได้จากปุ่มบนการ์ดเท่านั้น')).toBeDefined()
  })

  it('ยังไม่เข้าระบบ พาไปหน้า login', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('ไม่พบแคมเปญ ขึ้น 404', async () => {
    state.campaign = null
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('M4-S01 · การ์ดของเมนูหนึ่งใบ', () => {
  it('แสดงชื่อเรียก จำนวนช่องที่ไม่ชี้ไปไหน และป้ายสถานะตัวเข้า', async () => {
    state.screen = { ...state.screen, menus: [goodMenu()] }
    await open()
    expect(screen.getByDisplayValue('main')).toBeDefined()
    expect(screen.getByText('1 ช่องไม่ชี้ไปไหน')).toBeDefined()
    expect(screen.getByText('แขวนเมนูนี้ตอนเข้าร่วม')).toBeDefined()
  })

  it('เมนูที่ไม่มีช่องว่างเลย ไม่มีป้ายเตือน', async () => {
    state.screen = {
      ...state.screen,
      menus: [goodMenu({
        emptyCount: 0,
        areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'url', target: 'https://x.example' }],
      })],
    }
    await open()
    expect(screen.queryByText(/ช่องไม่ชี้ไปไหน/)).toBeNull()
  })

  it('ภาพผิดขนาด ขึ้นคำเตือนขนาดภาพ', async () => {
    state.screen = {
      ...state.screen,
      menus: [goodMenu({ imageWidth: 1200, imageHeight: 400, imageBad: true })],
    }
    await open()
    expect(screen.getByText(/1200×400/)).toBeDefined()
  })

  it('ปุ่มเลือกผังแสดงครบสี่แบบ (1 · 2 · 3 · 6 ช่อง)', async () => {
    state.screen = { ...state.screen, menus: [goodMenu()] }
    await open()
    for (const label of ['1', '2', '3', '6']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })
})

describe('M4-S01 · สิทธิ์', () => {
  it('ผู้ดูรายงานไม่เห็นปุ่ม "+ เพิ่มเมนู" และเห็นป้ายดูอย่างเดียว', async () => {
    state.session = { userId: 'u2', email: 'r@example.com', role: 'reporter' }
    state.screen = { ...state.screen, menus: [goodMenu()] }
    await open()
    expect(screen.queryByText('+ เพิ่มเมนู')).toBeNull()
    expect(screen.getByText('ดูอย่างเดียว')).toBeDefined()
  })

  it('ผู้แก้เนื้อหาเห็นปุ่มบันทึกเมนู แต่ไม่เห็นปุ่มลบ', async () => {
    state.session = { userId: 'u3', email: 'ce@example.com', role: 'content_editor' }
    state.screen = { ...state.screen, menus: [goodMenu()] }
    await open()
    expect(screen.getByText('บันทึกเมนู')).toBeDefined()
    expect(screen.queryByText('ลบเมนูนี้')).toBeNull()
  })

  it('ผู้ตั้งค่าแคมเปญเห็นปุ่มลบเมนู', async () => {
    state.screen = { ...state.screen, menus: [goodMenu()] }
    await open()
    expect(screen.getByText('ลบเมนูนี้')).toBeDefined()
  })
})
