// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RichMenuScreenData } from '@/lib/db/richmenu'
import type { Composition } from '@/lib/richmenu/composition'

afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: {
  session: Session
  campaign: Record<string, unknown> | null
  screen: RichMenuScreenData
  composition: Composition | null
  assets: Array<{ id: string; publicUrl: string; width: number; height: number; mediaType: string }>
} = {
  session: null,
  campaign: null,
  screen: { menus: [], images: [], activities: [], cards: [] },
  composition: null,
  assets: [],
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/db/richmenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/richmenu')>()),
  loadRichMenuScreen: async () => state.screen,
}))
vi.mock('@/lib/db/assets', () => ({ listAssets: async () => state.assets }))
vi.mock('@/lib/db/richmenu-composition', () => ({ loadComposition: async () => state.composition }))
vi.mock('./actions', () => ({
  uploadLayerImage: vi.fn(), saveComposition: vi.fn(), applyComposition: vi.fn(),
}))

const ComposePage = (await import('./page')).default

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
  layout: 'large_1' as const,
  emptyCount: 1,
  imageBad: false,
  ...patch,
})

beforeEach(() => {
  state.session = { userId: 'u1', email: 'someone@example.com', role: 'configurator' }
  state.campaign = { id: 'c1', name: 'แคมเปญทดสอบ' }
  state.screen = { menus: [goodMenu()], images: [], activities: [], cards: [] }
  state.composition = null
  state.assets = []
})

const open = async (menuId = 'm1') =>
  render(await ComposePage({ params: Promise.resolve({ id: 'c1', menuId }) }))

describe('M4-S02 · โครงจอ', () => {
  it('มีป้ายรหัสจอและชื่อเมนูในหัวข้อ', async () => {
    await open()
    expect(screen.getByText('M4-S02 · Rich Menu Compositor')).toBeDefined()
    expect(screen.getByRole('heading', { name: /main/ })).toBeDefined()
  })

  it('มีทางกลับไปหน้า Rich Menu', async () => {
    await open()
    expect(screen.getByRole('link', { name: '← Rich Menu' }).getAttribute('href')).toBe('/campaigns/c1/richmenu')
  })

  it('ยังไม่เข้าระบบ พาไปหน้า login', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('ไม่พบแคมเปญ ขึ้น 404', async () => {
    state.campaign = null
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('ไม่พบเมนูนี้ในแคมเปญ (ลบไปแล้ว หรือ id ผิด) ขึ้น 404', async () => {
    await expect(open('ghost-menu')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('M4-S02 · สิทธิ์', () => {
  it('ผู้ดูรายงานเห็นป้ายดูอย่างเดียว', async () => {
    state.session = { userId: 'u2', email: 'r@example.com', role: 'reporter' }
    await open()
    expect(screen.getByText('ดูอย่างเดียว')).toBeDefined()
  })

  it('ผู้ตั้งค่าแคมเปญไม่เห็นป้ายดูอย่างเดียว', async () => {
    await open()
    expect(screen.queryByText('ดูอย่างเดียว')).toBeNull()
  })
})

describe('M4-S02 · ตัวจัดวางภาพ', () => {
  it('เมนูผังผืนใหญ่ — พื้นที่แต่งภาพสัดส่วนของผืนใหญ่ (2500×1686)', async () => {
    const { container } = await open()
    const stage = container.querySelector('[data-compositor-stage]') as HTMLElement
    expect(Math.round(parseFloat(stage.style.height) / parseFloat(stage.style.width) * 1000))
      .toBe(Math.round((1686 / 2500) * 1000))
  })

  it('เมนูผังผืนเล็ก — พื้นที่แต่งภาพสัดส่วนของผืนเล็ก (2500×843)', async () => {
    state.screen = { ...state.screen, menus: [goodMenu({ layout: 'small_1' })] }
    const { container } = await open()
    const stage = container.querySelector('[data-compositor-stage]') as HTMLElement
    expect(Math.round(parseFloat(stage.style.height) / parseFloat(stage.style.width) * 1000))
      .toBe(Math.round((843 / 2500) * 1000))
  })

  it('ไม่เคยมีงานแต่งภาพมาก่อน — เริ่มจากศูนย์ ไม่มีชั้นเลย', async () => {
    await open()
    expect(screen.getByText('ยังไม่มีชั้นเลย — เพิ่มภาพหรือข้อความด้านล่าง')).toBeDefined()
  })

  it('มีงานแต่งภาพค้างจากรอบก่อน — โหลดชั้นเดิมกลับมาแสดง', async () => {
    state.composition = {
      canvasWidth: 2500, canvasHeight: 1686, background: { type: 'color', color: '#FFFFFF' },
      layers: [{ id: 'l1', type: 'text', text: 'ค้างไว้', fontSize: 40, color: '#000000', align: 'left', bold: false, x: 0, y: 0, width: 200, height: 60 }],
    }
    await open()
    expect(screen.getAllByText(/ค้างไว้/).length).toBeGreaterThan(0)
  })
})
