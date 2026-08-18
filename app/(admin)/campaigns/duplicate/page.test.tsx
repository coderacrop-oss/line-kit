// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPIED_LABELS, REFUSED_LABELS } from '@/lib/campaign/duplicate'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: {
  session: Session
  campaigns: Array<Record<string, unknown>>
  counts: Record<string, number>
  redirectedTo: string | null
} = { session: null, campaigns: [], counts: {}, redirectedTo: null }

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
  usePathname: () => '/campaigns/duplicate',
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ listCampaigns: async () => state.campaigns }))
vi.mock('./actions', () => ({ duplicate: vi.fn() }))
vi.mock('@/lib/campaign/duplicate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/campaign/duplicate')>()),
  countCopyable: async () => state.counts,
}))

const DuplicatePage = (await import('./page')).default

const aCampaign = (patch: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'เมโล ครบเจ็ดวัน', code: 'melo7', status: 'published',
  activityCount: 3, channelName: 'Melo OA', daysLeft: 12, purgeInDays: null,
  ...patch,
})

const open = async (from?: string) => render(
  await DuplicatePage({ searchParams: Promise.resolve(from ? { from } : {}) }),
)

beforeEach(() => {
  state.session = { userId: 'u1', email: 'boss@example.com', role: 'configurator' }
  state.campaigns = [aCampaign(), aCampaign({ id: 'c2', name: 'ปีใหม่', code: 'ny', status: 'closed' })]
  state.counts = { activity: 3, card: 7, asset: 5, counter: 1, reward: 2, rich_menu: 1 }
  state.redirectedTo = null
})

describe('M1-S03 · โครงของจอตามต้นแบบ', () => {
  it('ป้ายรหัสจอกับหัวข้ออยู่ครบ', async () => {
    await open()
    expect(screen.getByText('M1-S03 · Duplicate')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ก๊อปแคมเปญ')
  })

  it('มีทางกลับไปรายการแคมเปญ', async () => {
    await open()
    expect(screen.getByRole('link', { name: '← แคมเปญทั้งหมด' }).getAttribute('href'))
      .toBe('/campaigns')
  })

  it('เลือกต้นทางได้จากทุกแคมเปญที่มี', async () => {
    const { container } = await open()
    const select = container.querySelector('select[name="from"]') as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value))
      .toEqual(['', 'c1', 'c2'])
  })

  it('ยังไม่เลือกต้นทาง ยังไม่มีฟอร์มก๊อป', async () => {
    const { container } = await open()
    expect(container.querySelector('input[name="name"]')).toBeNull()
    expect(container.querySelector('input[name="code"]')).toBeNull()
  })

  it('เลือกต้นทางแล้วได้ฟอร์มครบทุกช่องที่ต้นแบบวาดไว้', async () => {
    const { container } = await open('c1')
    for (const name of ['name', 'code', 'start_at', 'end_at', 'source_id']) {
      expect(container.querySelector(`[name="${name}"]`), name).not.toBeNull()
    }
  })

  it('ต้นทางถูกส่งไปกับฟอร์ม ไม่ได้อ่านจาก URL ตอนกด', async () => {
    const { container } = await open('c1')
    const hidden = container.querySelector('input[name="source_id"]') as HTMLInputElement
    expect(hidden.value).toBe('c1')
  })

  it('วันเริ่มและวันสิ้นสุดเป็นสองช่องคนละ id ไม่ชนกัน', async () => {
    const { container } = await open('c1')
    const start = container.querySelector('input[name="start_at"]') as HTMLInputElement
    const end = container.querySelector('input[name="end_at"]') as HTMLInputElement
    expect(start.id).not.toBe('')
    expect(start.id).not.toBe(end.id)
  })

  it('วันของต้นทางไม่ถูกก๊อปมาให้ · วันสิ้นสุดว่างไว้ให้กรอกเอง', async () => {
    const { container } = await open('c1')
    const end = container.querySelector('input[name="end_at"]') as HTMLInputElement
    expect(end.value).toBe('')
    expect(screen.getByText(/ไม่ก๊อปวันเดิมมาให้/)).toBeDefined()
  })

  it('จำนวนที่จะถูกก๊อปมาจากแถวจริงของต้นทาง', async () => {
    await open('c1')
    expect(screen.getByText('กิจกรรม 3 · การ์ด 7 · ภาพ 5 · ค่าสะสม 1 · รางวัล 2 · Rich Menu 1'))
      .toBeDefined()
  })

  it('ยังไม่เลือกต้นทาง ก็ยังไม่มีตัวเลขให้เข้าใจผิดว่าเป็นของใคร', async () => {
    await open()
    expect(screen.queryByText(/^กิจกรรม \d/)).toBeNull()
  })

  it('ยังไม่มีแคมเปญเลย บอกว่ายังไม่มีอะไรให้ก๊อป แทนที่จะโชว์ฟอร์มเปล่า', async () => {
    state.campaigns = []
    const { container } = await open()
    expect(screen.getByText('ยังไม่มีแคมเปญให้ก๊อป')).toBeDefined()
    expect(container.querySelector('select[name="from"]')).toBeNull()
  })
})

/**
 * BR-24 · สองรายการล่างเป็นข้อห้าม ไม่ใช่ตัวเลือก
 *
 * ห้ามพิสูจน์ด้วย `disabled` เพราะ disabled เป็นเรื่องของสายตาและถูกปลดได้จาก
 * devtools ในสามวินาที · สิ่งที่ต้องจริงคือ **ไม่มีตัวควบคุมอยู่ตรงนั้นเลย** ทั้ง
 * ในจอและในฟอร์มที่ถูกส่งไป
 */
describe('M1-S03 · ข้อห้ามที่ติ๊กไม่ได้', () => {
  const everyState = [
    ['ยังไม่เลือกต้นทาง', undefined],
    ['เลือกต้นทางแล้ว', 'c1'],
  ] as const

  for (const [label, from] of everyState) {
    it(`${label} · ทั้งหน้าไม่มีช่องติ๊กแม้แต่ช่องเดียว`, async () => {
      const { container } = await open(from)
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
      expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    })

    it(`${label} · ไม่มี checkbox ที่ซ่อนตัวเป็น role อื่น`, async () => {
      await open(from)
      expect(screen.queryAllByRole('checkbox')).toEqual([])
      expect(screen.queryAllByRole('radio')).toEqual([])
      expect(screen.queryAllByRole('switch')).toEqual([])
    })
  }

  it('ข้อห้ามทุกข้อถูกวาดเป็นข้อความ ไม่ใช่ป้ายของตัวควบคุม', async () => {
    const { container } = await open('c1')

    for (const refusal of REFUSED_LABELS) {
      const line = screen.getByText(new RegExp(refusal.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect(line.closest('label'), refusal.what).toBeNull()
      expect(
        line.closest('div')!.querySelectorAll('input, select, button').length,
        refusal.what,
      ).toBe(0)
    }
    // และไม่มีช่องไหนในหน้าที่ชื่อพาดพิงถึงตารางต้องห้าม
    for (const name of ['channel', 'campaign_channel', 'participant', 'entitlement']) {
      expect(container.querySelector(`[name="${name}"]`), name).toBeNull()
    }
  })

  it('ทุกข้อห้ามมีเหตุผลกำกับ ไม่ใช่รายการห้ามลอยๆ', async () => {
    await open('c1')
    for (const refusal of REFUSED_LABELS) {
      expect(screen.getByText(refusal.why), refusal.what).toBeDefined()
    }
  })

  it('ทุกข้อที่ก๊อปตามไปถูกเขียนไว้ให้อ่านก่อนกด', async () => {
    await open('c1')
    for (const label of COPIED_LABELS) {
      expect(screen.getByText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), label)
        .toBeDefined()
    }
  })

  it('คำเตือนเรื่องบัญชี LINE อยู่เหนือฟอร์ม ไม่ใช่ใต้ปุ่ม', async () => {
    const { container } = await open('c1')
    const warning = screen.getByText(/บัญชี LINE ไม่ถูกก๊อปไปด้วยเด็ดขาด \(BR-24\)/)
    const submit = screen.getByRole('button', { name: 'ก๊อปแคมเปญ' })

    const order = warning.compareDocumentPosition(submit)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING, 'คำเตือนต้องมาก่อนปุ่ม').toBeTruthy()
    expect(container.textContent).toContain('ข้อความที่ส่งเข้า LINE แล้วเรียกคืนไม่ได้')
  })

  it('รายการห้ามและรายการที่ก๊อป อยู่คนละกล่องกัน อ่านแล้วไม่ปนกัน', async () => {
    await open('c1')
    const copied = screen.getByText('ก๊อปตามไป').closest('div')!.parentElement!
    const refused = screen.getByText('ไม่ก๊อป — ไม่มีช่องให้เปิด').closest('div')!.parentElement!
    expect(copied).not.toBe(refused)
    expect(within(copied).queryByText(REFUSED_LABELS[0].why)).toBeNull()
  })
})

describe('M1-S03 · ใครเปิดได้', () => {
  it('ยังไม่ได้เข้าระบบ ส่งไปหน้าเข้าระบบ', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  for (const role of ['content_editor', 'reporter']) {
    it(`${role} เปิดจอนี้ไม่ได้ · ก๊อปเป็นสิทธิ์ของผู้ตั้งค่าแคมเปญ`, async () => {
      state.session = { userId: 'u2', email: 'x@example.com', role }
      await expect(open()).rejects.toThrow('NEXT_REDIRECT')
      expect(state.redirectedTo).toBe('/campaigns')
    })
  }
})
