// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RichMenuScreenData } from '@/lib/db/richmenu'
import { createMenu } from './actions'

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

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ refresh }),
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/db/richmenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/richmenu')>()),
  loadRichMenuScreen: async () => state.screen,
}))
vi.mock('./actions', () => ({
  createMenu: vi.fn(async () => ({ ok: true })), saveMenu: vi.fn(async () => ({ ok: true })),
  changeLayout: vi.fn(), setEntry: vi.fn(), deleteMenu: vi.fn(),
}))

// jsdom ไม่มี URL.createObjectURL/revokeObjectURL — CropModal (เปิดผ่าน ImagePicker
// ตอนเลือกไฟล์) เรียกใช้ทันทีที่ mount ปลอมไว้เท่าที่ต้องใช้จริง เหมือนที่
// CropModal.test.tsx/ImagePicker.test.tsx ทำไว้แล้ว
URL.createObjectURL = vi.fn(() => 'blob:fake')
URL.revokeObjectURL = vi.fn()

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
  layout: 'large_1' as const,
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

  it('เมนูที่ใช้ภาพใหญ่ (2500×1686) เห็นปุ่มสลับผังครบเจ็ดแบบของกลุ่มภาพใหญ่เท่านั้น', async () => {
    state.screen = { ...state.screen, menus: [goodMenu({ layout: 'large_1' })] }
    await open()
    for (const label of [
      'เต็มภาพ', '2 ช่อง (บน–ล่าง)', '2 ช่อง (ซ้าย–ขวา)', '3 ช่อง (บน 1 ใหญ่ + ล่าง 2)',
      '3 ช่อง (บน 2 + ล่าง 1 ใหญ่)', '4 ช่อง (ซ้าย 1 ใหญ่ + ขวา 3)', '6 ช่อง (ตาราง 2×3)',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    // ผังของกลุ่มภาพเล็กต้องไม่ปนมาด้วย — สลับข้ามขนาดผืนภาพจากปุ่มนี้ไม่ได้
    // (เทียบเฉพาะ role="button" เพราะฟอร์ม "+ เพิ่มเมนู" มีป้ายเดียวกันเป็นตัวเลือก radio อยู่แล้วเสมอ)
    expect(screen.queryByRole('button', { name: '3 ช่อง (แนวตั้ง 3 คอลัมน์)' })).toBeNull()
  })

  it('เมนูที่ใช้ภาพเล็ก (2500×843) เห็นปุ่มสลับผังครบห้าแบบของกลุ่มภาพเล็กเท่านั้น', async () => {
    state.screen = {
      ...state.screen,
      menus: [goodMenu({
        layout: 'small_1', imageWidth: 2500, imageHeight: 843,
        areas: [{ x: 0, y: 0, width: 2500, height: 843, kind: 'none' as const, target: null }],
      })],
    }
    await open()
    for (const label of [
      'เต็มภาพ', '2 ช่อง (ซ้าย–ขวา)', '3 ช่อง (แนวตั้ง 3 คอลัมน์)',
      '3 ช่อง (ซ้าย 1 ใหญ่ + ขวา 2)', '3 ช่อง (ซ้าย 2 + ขวา 1 ใหญ่)',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    // ผังของกลุ่มภาพใหญ่ที่นับช่องต่างกันต้องไม่ปนมาด้วย
    expect(screen.queryByRole('button', { name: '6 ช่อง (ตาราง 2×3)' })).toBeNull()
  })

  it('บอกด้วยว่าสลับข้ามขนาดผืนภาพจากปุ่มนี้ไม่ได้ ต้องเปลี่ยนภาพก่อน', async () => {
    state.screen = { ...state.screen, menus: [goodMenu({ layout: 'large_1' })] }
    await open()
    expect(screen.getByText(/สลับข้ามขนาดผืนภาพ.*ต้องอัปโหลดภาพขนาดนั้นก่อน/)).toBeDefined()
  })
})

describe('M4-S01 · ป้าย "กิจกรรมปลายทางถูกปิดใช้งาน"', () => {
  const WARNING = 'กิจกรรมปลายทางถูกปิดใช้งาน'
  const disabledActivity = { id: 'act-1', code: 'quiz', name: 'ตอบคำถาม', isEnabled: false }
  const enabledActivity = { id: 'act-2', code: 'draw', name: 'สุ่มรางวัล', isEnabled: true }

  it('ช่องที่ไม่ชี้ไปไหน ไม่ขึ้นป้าย', async () => {
    state.screen = {
      ...state.screen, activities: [disabledActivity],
      menus: [goodMenu({ areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'none', target: null }] })],
    }
    await open()
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('ช่องที่ชี้ไปกิจกรรมที่เปิดใช้งานอยู่ ไม่ขึ้นป้าย', async () => {
    state.screen = {
      ...state.screen, activities: [enabledActivity],
      menus: [goodMenu({
        areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'activity', target: enabledActivity.id }],
      })],
    }
    await open()
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('ช่องที่ชี้ไปการ์ด/ลิงก์/เมนูอีกชุด ไม่ขึ้นป้าย แม้แคมเปญนี้จะมีกิจกรรมที่ปิดใช้งานอยู่ก็ตาม', async () => {
    state.screen = {
      ...state.screen, activities: [disabledActivity],
      menus: [
        goodMenu({ id: 'm1', areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'card', target: 'card-1' }] }),
        goodMenu({ id: 'm2', areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'url', target: 'https://x.example' }] }),
      ],
    }
    await open()
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('ช่องที่ชี้ไปกิจกรรมที่ถูกปิดใช้งานอยู่ ขึ้นป้ายเตือน', async () => {
    state.screen = {
      ...state.screen, activities: [disabledActivity],
      menus: [goodMenu({
        areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'activity', target: disabledActivity.id }],
      })],
    }
    await open()
    expect(screen.getByText(WARNING)).toBeDefined()
  })

  it('ช่องที่ชี้ไปกิจกรรมที่หาไม่เจอในรายการ (เช่นข้อมูลไม่ตรงกัน) ไม่ขึ้นป้าย — ไม่เดาว่าปิดใช้งานทั้งที่ยืนยันไม่ได้', async () => {
    state.screen = {
      ...state.screen, activities: [],
      menus: [goodMenu({
        areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'activity', target: 'ghost-id' }],
      })],
    }
    await open()
    expect(screen.queryByText(WARNING)).toBeNull()
  })
})

describe('M4-S01 · ช่องเลือกปลายทางผูกกับฟอร์ม "บันทึกเมนู" จริง (form=)', () => {
  // ช่องเลือกปลายทาง (select + input url) วาดอยู่นอก <form> ทางโครงสร้าง JSX — ถ้า
  // ขาด attribute form= ที่ชี้กลับไปยัง id ของฟอร์มบันทึกเมนู เบราว์เซอร์จะไม่ส่งค่า
  // ที่เลือกไปกับฟอร์มเลย กดบันทึกกี่ครั้งก็รีเซ็ตทุกช่องกลับเป็น "ไม่ชี้ไปไหน" เสมอ
  // (บั๊กจริงที่เจอจากการใช้งานจริง ไม่ใช่สมมติ)
  it('select และ input ของช่องปลายทาง ผูก form= ตรงกับ id ของฟอร์มบันทึกเมนู', async () => {
    state.screen = {
      ...state.screen,
      menus: [goodMenu({ areas: [{ x: 0, y: 0, width: 2500, height: 1686, kind: 'url', target: 'https://x.example' }] })],
    }
    const { container } = await open()

    const form = container.querySelector('form#rm-save-m1') as HTMLFormElement
    expect(form).not.toBeNull()

    const select = container.querySelector('select[name="area_target_0"]') as HTMLSelectElement
    const urlInput = container.querySelector('input[name="area_url_0"]') as HTMLInputElement
    expect(select.getAttribute('form')).toBe('rm-save-m1')
    expect(urlInput.getAttribute('form')).toBe('rm-save-m1')
  })
})

describe('M4-S01 · ผังของฟอร์ม "+ เพิ่มเมนู" — สิบสามแบบ จัดกลุ่มภาพใหญ่/ภาพเล็ก', () => {
  it('มีทั้งแปดผังของภาพใหญ่และห้าผังของภาพเล็ก รวมสิบสามแบบ ไม่มีค่าซ้ำ', async () => {
    const { container } = await open()
    const radios = Array.from(container.querySelectorAll('input[name="layout"]')) as HTMLInputElement[]
    const values = radios.map((r) => r.value)
    expect(values).toHaveLength(13)
    expect(new Set(values).size).toBe(13)
  })

  // สิบสองแบบลอกมาจาก LINE ตรงๆ (large_8 · ตาราง 2×4 เป็นแบบเดียวที่ระบบนี้เพิ่มเอง)
  it('ทุกผังติดป้ายกำกับที่มาของตัวเอง — "แบบ LINE" สิบสองอัน "แบบกำหนดเอง" หนึ่งอัน', async () => {
    await open()
    expect(screen.getAllByText('แบบ LINE')).toHaveLength(12)
    expect(screen.getAllByText('แบบกำหนดเอง')).toHaveLength(1)
  })

  it('ผังแบบกำหนดเอง (ตาราง 2×4) อยู่ในกลุ่มภาพใหญ่ ไม่ใช่ภาพเล็ก', async () => {
    const { container } = await open()
    const custom = container.querySelector('input[name="layout"][value="large_8"]')
    expect(custom).not.toBeNull()
    expect(screen.getByRole('radio', { name: /8 ช่อง \(ตาราง 2×4\)/ })).toBeDefined()
  })

  it('ผังเริ่มต้นคือเต็มภาพของภาพใหญ่ (large_1)', async () => {
    const { container } = await open()
    const checked = container.querySelector('input[name="layout"]:checked') as HTMLInputElement
    expect(checked.value).toBe('large_1')
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

/**
 * แก้บั๊กที่เจอในโปรดักชัน: อัปโหลดภาพเล็กเกินไปถูกปฏิเสธถูกต้อง (ERR-037) แต่ฟอร์ม
 * เดิม (`<form action={createMenu}>` ตรงๆ) ไม่มีอะไรจับ error ฝั่ง client เลย ข้อความ
 * จริงเลยถูก Next.js เซ็นเซอร์ทิ้งในโปรดักชัน กลายเป็นหน้า "Application error" ที่
 * ไม่บอกอะไร — ฟอร์มนี้ต้องเปลี่ยนมาจับเองผ่าน ActionForm แล้วโชว์ใน ErrorModal แทน
 */
describe('M4-S01 · error modal บนฟอร์ม "+ เพิ่มเมนู" (แก้บั๊กข้อความ error หาย)', () => {
  beforeEach(() => {
    vi.mocked(createMenu).mockReset()
  })

  const fillAndSubmit = (container: HTMLElement) => {
    fireEvent.change(screen.getByPlaceholderText('เช่น main'), { target: { value: 'promo' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['a'], 'small.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' }))
    // jsdom ไม่นับว่า input[type=file] ที่ตั้ง .files ผ่าน fireEvent.change มีไฟล์แล้ว
    // ตอนตรวจ required ผ่านการคลิกปุ่ม submit จริง (ข้อจำกัดของ jsdom เอง ไม่ใช่ของ
    // ปุ่ม/ฟอร์ม) — ยิง submit event ตรงๆ แทน ซึ่งข้าม interactive validation นั้นไป
    // เหมือนที่ browser จริงทำตอนเรียก requestSubmit() มาจากโค้ด ไม่ใช่จากคนคลิกปุ่ม
    const form = container.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
  }

  it('createMenu ปฏิเสธด้วยข้อความ ERR-037 จริง — ข้อความเป๊ะๆ โผล่ใน ErrorModal ไม่ใช่หน้าเว็บพัง', async () => {
    const errorMessage = 'ERR-037 · ภาพเล็กเกินไปสำหรับผังนี้ — ต้องขยาย 2.8 เท่าเพื่อให้เต็มผืน 2500×1686 ซึ่งจะเห็นเบลอชัดเจน ใช้ภาพความละเอียดสูงกว่านี้'
    vi.mocked(createMenu).mockResolvedValueOnce({ ok: false, message: errorMessage })
    const { container } = await open()

    fillAndSubmit(container)

    await waitFor(() => expect(screen.getByText(errorMessage)).toBeDefined())
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('ปิด ErrorModal ด้วยปุ่ม "ปิด" — ข้อความหายไป', async () => {
    vi.mocked(createMenu).mockResolvedValueOnce({ ok: false, message: 'พัง' })
    const { container } = await open()

    fillAndSubmit(container)
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
  })

  it('ส่งสำเร็จ — ไม่มี ErrorModal โผล่ขึ้นมาเลย', async () => {
    vi.mocked(createMenu).mockResolvedValueOnce({ ok: true })
    const { container } = await open()

    fillAndSubmit(container)

    await waitFor(() => expect(createMenu).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
