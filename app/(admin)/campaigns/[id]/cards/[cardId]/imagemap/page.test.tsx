// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardImagemap } from '@/lib/db/card-imagemap'
import type { CardView } from '@/lib/db/cards'

afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: {
  session: Session
  campaign: Record<string, unknown> | null
  card: CardView | null
  imagemap: CardImagemap | null
} = {
  session: null,
  campaign: null,
  card: null,
  imagemap: null,
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/db/cards', () => ({ loadCard: async () => state.card }))
vi.mock('@/lib/db/card-imagemap', () => ({ loadCardImagemap: async () => state.imagemap }))
vi.mock('./actions', () => ({
  uploadBaseImage: vi.fn(), saveDraft: vi.fn(), applyImagemap: vi.fn(),
  uploadVideo: vi.fn(), uploadVideoPreview: vi.fn(),
}))

const ImagemapPage = (await import('./page')).default

const goodCard = (patch: Partial<CardView> = {}): CardView => ({
  id: 'card-1', code: 'promo', renderAs: 'imagemap', renderName: 'ริชเมสเสจ',
  hasImage: false, previewText: null, usedBy: [], isOrphan: true,
  ownerActivityId: null, ownerActivityName: null,
  ...patch,
})

const emptyImagemap = (patch: Partial<CardImagemap> = {}): CardImagemap => ({
  cardId: 'card-1', baseAssetId: null, baseImageUrl: null, baseWidth: null, baseHeight: null,
  altText: '', actions: [], variantUrls: {},
  videoAssetId: null, videoUrl: null, videoPreviewAssetId: null, videoPreviewUrl: null,
  videoArea: null, videoLinkUri: '', videoLinkLabel: '',
  ...patch,
})

beforeEach(() => {
  state.session = { userId: 'u1', email: 'someone@example.com', role: 'configurator' }
  state.campaign = { id: 'c1', name: 'แคมเปญทดสอบ' }
  state.card = goodCard()
  state.imagemap = emptyImagemap()
})

const open = async (cardId = 'card-1') =>
  render(await ImagemapPage({ params: Promise.resolve({ id: 'c1', cardId }) }))

describe('ตัวแก้ไขริชเมสเสจ · โครงจอ', () => {
  it('มีป้ายรหัสจอและรหัสการ์ดในหัวข้อ', async () => {
    await open()
    expect(screen.getByText('M3-S02 · Rich Message')).toBeDefined()
    expect(screen.getByRole('heading', { name: /promo/ })).toBeDefined()
  })

  it('มีทางกลับไปหน้าการ์ดทั้งหมด', async () => {
    await open()
    expect(screen.getByRole('link', { name: '← การ์ดทั้งหมด' }).getAttribute('href')).toBe('/campaigns/c1/cards')
  })

  it('ยังไม่เข้าระบบ พาไปหน้า login', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('ไม่พบแคมเปญ ขึ้น 404', async () => {
    state.campaign = null
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('ไม่พบการ์ดนี้ในแคมเปญนี้ ขึ้น 404', async () => {
    state.card = null
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('การ์ดที่ไม่ใช่ imagemap/imagemap_video ถูกส่งกลับไปบล็อกเอดิเตอร์ปกติ', async () => {
    state.card = goodCard({ renderAs: 'flex_bubble' })
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/campaigns/c1/cards/card-1')
  })

  it('การ์ด imagemap_video ไม่ถูกส่งกลับ — เปิดจอเดียวกันนี้ พร้อมป้าย Rich Video', async () => {
    state.card = goodCard({ renderAs: 'imagemap_video', renderName: 'ริชวิดีโอ' })
    await open()
    expect(screen.getByText('M3-S02 · Rich Video')).toBeDefined()
    expect(screen.getByRole('heading', { name: /ริชวิดีโอ — promo/ })).toBeDefined()
  })
})

describe('ตัวแก้ไขริชเมสเสจ · สิทธิ์', () => {
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

describe('ตัวแก้ไขริชเมสเสจ · สถานะเริ่มต้น', () => {
  it('ยังไม่เคยอัปโหลดภาพฐานเลย — จอบอกให้อัปโหลดก่อน', async () => {
    await open()
    expect(screen.getByText(/ยังไม่มีภาพฐาน/)).toBeDefined()
  })

  it('มีภาพฐานแล้วแต่ยังไม่เคยกด "ใช้" — จอบอกว่ายังไม่พร้อมส่ง', async () => {
    state.imagemap = emptyImagemap({ baseImageUrl: '/x/base.jpg', baseWidth: 1040, baseHeight: 585 })
    await open()
    expect(screen.getByText(/ยังไม่พร้อมส่ง/)).toBeDefined()
  })

  it('เคยกด "ใช้" สำเร็จแล้ว — จอบอกว่าพร้อมส่งจริง', async () => {
    state.imagemap = emptyImagemap({
      baseImageUrl: '/x/base.jpg', baseWidth: 1040, baseHeight: 585,
      variantUrls: { 240: '/x/240', 300: '/x/300', 460: '/x/460', 700: '/x/700', 1040: '/x/1040' },
    })
    await open()
    expect(screen.getByText(/พร้อมส่งจริง/)).toBeDefined()
  })
})
