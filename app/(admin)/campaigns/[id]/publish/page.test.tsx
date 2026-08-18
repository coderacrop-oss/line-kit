// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishChannel, PublishScreenData } from '@/lib/db/publish'
import { CONFIRM_WORD, WHERE } from '@/lib/publish/validate'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

type Session = { userId: string; email: string; role: string } | null

const state: {
  session: Session
  campaign: Record<string, unknown> | null
  screen: PublishScreenData
  redirectedTo: string | null
  notFound: boolean
} = {
  session: null,
  campaign: null,
  screen: {} as PublishScreenData,
  redirectedTo: null,
  notFound: false,
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
  notFound: () => {
    state.notFound = true
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => state.session }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/campaigns', () => ({ loadCampaign: async () => state.campaign }))
vi.mock('@/lib/db/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/publish')>()),
  loadPublishScreen: async () => state.screen,
}))
vi.mock('./actions', () => ({ publish: vi.fn() }))

const PublishPage = (await import('./page')).default

const aChannel = (patch: Partial<PublishChannel> = {}): PublishChannel => ({
  id: 'ch-test',
  name: 'OA ทดสอบ',
  channelType: 'test',
  tokenLast4: '9f2a',
  lastUsedAt: null,
  lineChannelId: '1234567890',
  defaultCardId: null,
  publishedVersion: null,
  liveCampaign: null,
  dayLengthSec: null,
  counterTargets: {},
  ...patch,
})

const goodBase = (): PublishScreenData['base'] => ({
  cards: [{ id: 'c1', code: 'win', hasSampleText: false, blocks: 2 }],
  activities: [{
    id: 'a1', code: 'draw', name: 'สุ่มรางวัล', inputType: 'none',
    resolveMethod: 'weighted', fallbackCardId: null, entryRules: [],
    outcomes: [{ id: 'o1', cardId: 'c1' }], isEnabled: true, trigger: 'manual',
    reachedBy: ['คีย์เวิร์ด "เล่น"'], counterCodes: [],
  }],
  keywordRules: [{ id: 'k1', keyword: 'เล่น', targetActivityId: 'a1', targetCardId: null }],
  rewards: [],
  counters: [],
  richMenus: [],
})

const aScreen = (patch: Partial<PublishScreenData> = {}): PublishScreenData => ({
  base: goodBase(),
  channels: [aChannel()],
  latestVersion: 0,
  campaignDayLengthSec: 86_400,
  campaignCode: 'summer',
  ...patch,
})

const open = async (query: Record<string, string> = {}) => render(
  await PublishPage({
    params: Promise.resolve({ id: 'camp-1' }),
    searchParams: Promise.resolve(query),
  }),
)

beforeEach(() => {
  state.session = { userId: 'u1', email: 'boss@example.com', role: 'configurator' }
  state.campaign = { id: 'camp-1', name: 'เมโล ครบเจ็ดวัน', code: 'melo7', status: 'draft' }
  state.screen = aScreen()
  state.redirectedTo = null
  state.notFound = false
})

describe('M1-S04 · โครงของจอตามต้นแบบ', () => {
  it('ป้ายรหัสจอกับหัวข้ออยู่ครบ', async () => {
    await open()
    expect(screen.getByText('M1-S04 · Publish')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ส่งขึ้น LINE')
  })

  it('มีทางกลับไปที่แคมเปญ', async () => {
    await open()
    expect(screen.getByRole('link', { name: /เมโล ครบเจ็ดวัน/ }).getAttribute('href'))
      .toBe('/campaigns/camp-1')
  })

  it('มีทั้งกล่องผลตรวจ กล่องเลือกบัญชี และกล่องค่าที่จะใช้จริง', async () => {
    await open()
    expect(screen.getByText('ผลตรวจความครบถ้วน')).toBeDefined()
    expect(screen.getByText('เลือกบัญชี LINE ปลายทาง')).toBeDefined()
    expect(screen.getByText('ค่าที่จะใช้จริงกับบัญชีนี้')).toBeDefined()
  })

  it('บอกว่าการส่งขึ้นบันทึกเป็นประวัติเสมอ', async () => {
    const { container } = await open()
    expect(container.textContent).toContain('การส่งขึ้นจะบันทึกเป็นประวัติ version ใหม่เสมอ (BR-18)')
  })
})

describe('M1-S04 · รายการผลตรวจ', () => {
  it('ผ่านหมดแล้วบอกว่าผ่านทุกข้อ', async () => {
    await open()
    expect(screen.getByText('ผ่านทุกข้อ')).toBeDefined()
  })

  it('มีปัญหาแล้วนับให้ ไม่ใช่บอกแค่ว่าไม่ผ่าน', async () => {
    state.screen.base.cards = [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 2 }]
    await open()
    expect(screen.getByText('1 ข้อต้องแก้')).toBeDefined()
  })

  it('ข้อที่ผ่านก็ยังเห็น ไม่ได้แสดงเฉพาะข้อที่พัง', async () => {
    const { container } = await open()
    expect(container.querySelectorAll('[data-check]').length).toBeGreaterThan(2)
  })

  /**
   * ⚠️ ด่านของ BR-37 ยังไม่มีวันติดจนกว่า Task 12 จะมา
   *
   * `card.has_sample_text` มีคอลัมน์แต่ยังไม่มีโค้ดไหนเขียนค่าลงไป — จอ M3-S02
   * ที่เป็นเจ้าของยังไม่ถูกสร้าง · จอต้องพูดเรื่องนี้ออกมา ไม่ใช่แสดงเครื่องหมายถูก
   * เงียบๆ แล้วให้คนอ่านเข้าใจว่าตรวจแล้วไม่เจอ
   */
  it('บอกตรงๆ ว่าด่าน BR-37 ยังไม่มีใครเขียนค่าให้ตรวจ', async () => {
    const { container } = await open()
    expect(container.textContent).toContain('ยังไม่มีจอไหนบันทึกว่าการ์ดใบไหนเป็นข้อความตัวอย่าง')
    expect(container.textContent).toContain('M3-S02')
  })
})

/**
 * "ทุกปัญหาต้องกดกระโดดไปแก้ได้" — ไม่ใช่แค่ลิสต์ไว้
 */
describe('M1-S04 · ทุกปัญหาบนจอเป็นลิงก์', () => {
  const brokenEverything = () => {
    state.screen = aScreen({
      base: {
        cards: [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 0 }],
        activities: [{
          id: 'a1', code: 'draw', name: 'สุ่ม', inputType: 'text',
          resolveMethod: 'quota', fallbackCardId: null,
          entryRules: [{ type: 'limit', cardId: null }],
          outcomes: [{ id: 'o1', cardId: null }], isEnabled: true, trigger: 'manual',
          reachedBy: [], counterCodes: [],
        }],
        keywordRules: [{ id: 'k1', keyword: 'เล่น', targetActivityId: null, targetCardId: null }],
        rewards: [{ id: 'r1', code: 'voucher', rewardType: 'code', codeShortfall: 5 }],
        counters: [{ id: 'ct1', code: 'stamp', name: 'แสตมป์', target: 7 }],
      },
      channels: [aChannel()],
    })
  }

  it('เทสต์นี้ได้ตรวจของจริง — จอกำลังแสดงปัญหาหลายข้อ', async () => {
    brokenEverything()
    const { container } = await open()
    expect(container.querySelectorAll('[data-check="blocked"]').length).toBeGreaterThan(4)
  })

  it('ทุกข้อที่บล็อกมีลิงก์ไปแก้ของตัวเอง', async () => {
    brokenEverything()
    const { container } = await open()
    for (const row of Array.from(container.querySelectorAll('[data-check="blocked"]'))) {
      const link = row.querySelector('a')
      expect(link, row.textContent ?? '').not.toBeNull()
      expect(link!.getAttribute('href'), row.textContent ?? '').toBeTruthy()
    }
  })

  it('ลิงก์พาไปที่จอในแคมเปญนี้ ไม่ใช่ที่อยู่ลอยๆ', async () => {
    brokenEverything()
    const { container } = await open()
    const hrefs = Array.from(container.querySelectorAll('[data-check] a'))
      .map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith('/campaigns/camp-1/') || href.startsWith('/'), href).toBe(true)
      expect(href).not.toContain('undefined')
      expect(href).not.toContain('[id]')
    }
  })

  it('ปัญหาของกิจกรรมพาไปที่จอของกิจกรรมนั้น ไม่ใช่ที่รายการรวม', async () => {
    brokenEverything()
    const { container } = await open()
    const hrefs = Array.from(container.querySelectorAll('[data-check] a'))
      .map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/campaigns/camp-1/activities/a1')
  })

  it('คำเตือนที่ไม่บล็อกก็ยังกดไปแก้ได้', async () => {
    state.screen.base.counters = [{ id: 'ct1', code: 'stamp', name: 'แสตมป์', target: 7 }]
    const { container } = await open()
    const warn = container.querySelector('[data-check="warn"]')
    expect(warn).not.toBeNull()
    expect(warn!.querySelector('a')!.getAttribute('href')).toBe('/campaigns/camp-1/counters')
  })

  /**
   * คำเตือนไม่ใช่ตัวบล็อก และตัวนับต้องพูดตรงกับปุ่ม
   *
   * ตัวนับที่รวมคำเตือนเข้าไปด้วยจะเขียนว่า "1 ข้อต้องแก้" ข้างปุ่มที่กดได้ · คนอ่าน
   * จะเรียนรู้ภายในสองครั้งว่าตัวเลขนั้นไม่ต้องเชื่อ แล้วจะไม่เชื่อมันอีกเลยตอนที่มัน
   * นับของจริง
   */
  it('มีแต่คำเตือน ตัวนับยังบอกว่าผ่านทุกข้อ และปุ่มยังกดได้', async () => {
    state.screen.base.counters = [{ id: 'ct1', code: 'stamp', name: 'แสตมป์', target: 7 }]
    const { container } = await open({ channel: 'ch-test' })

    expect(container.querySelector('[data-check="warn"]')).not.toBeNull()
    expect(container.querySelector('[data-check="blocked"]')).toBeNull()
    expect(screen.getByText('ผ่านทุกข้อ')).toBeDefined()
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('ปุ่มไปแก้ใช้ข้อความของต้นแบบ', async () => {
    brokenEverything()
    expect((await open()).container.textContent).toContain('ไปแก้ →')
  })
})

describe('M1-S04 · เลือกบัญชีปลายทาง', () => {
  it('ยังไม่ได้ผูกบัญชีเลย บอกทางไปผูกแทนที่จะโชว์รายการเปล่า', async () => {
    state.screen = aScreen({ channels: [] })
    await open()
    expect(screen.getByText(/ยังไม่ได้ผูกบัญชี LINE/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'ไปที่หน้าบัญชี LINE เพื่อผูก' }).getAttribute('href'))
      .toBe('/channels')
  })

  it('บัญชีทุกใบที่ส่งขึ้นได้เป็นตัวเลือก', async () => {
    state.screen = aScreen({
      channels: [aChannel(), aChannel({ id: 'ch-prod', name: 'OA ลูกค้า', channelType: 'production' })],
    })
    const { container } = await open()
    expect(Array.from(container.querySelectorAll('input[name="channel"]'))
      .map((input) => (input as HTMLInputElement).value)).toEqual(['ch-test', 'ch-prod'])
  })

  it('กุญแจโชว์แค่สี่ตัวท้าย ไม่มีทางเห็นเต็ม (BR-16)', async () => {
    const { container } = await open()
    expect(container.textContent).toContain('••••9f2a')
  })

  it('บัญชีที่เคยส่งขึ้นแล้ว เตือนว่าครั้งนี้จะทับของเดิม', async () => {
    state.screen = aScreen({
      channels: [aChannel({ publishedVersion: 2 })],
      latestVersion: 2,
    })
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).toContain('เคยส่งขึ้นแล้ว — ครั้งนี้จะทับ v2 ด้วย v3')
  })

  it('บัญชีที่เลือกไว้ถูกติ๊กค้างไว้หลังโหลดหน้าใหม่', async () => {
    state.screen = aScreen({
      channels: [aChannel(), aChannel({ id: 'ch-prod', channelType: 'production' })],
    })
    const { container } = await open({ channel: 'ch-prod' })
    const checked = container.querySelector('input[name="channel"]:checked') as HTMLInputElement
    expect(checked.value).toBe('ch-prod')
  })

  it('ยังไม่ได้เลือกบัญชี ยังไม่มีปุ่มส่งขึ้น', async () => {
    const { container } = await open()
    expect(container.querySelector('input[name="channel_id"]')).toBeNull()
  })

  it('เลือกแล้วบัญชีถูกส่งไปกับฟอร์ม ไม่ได้อ่านจาก URL ตอนกด', async () => {
    const { container } = await open({ channel: 'ch-test' })
    const hidden = container.querySelector('input[name="channel_id"]') as HTMLInputElement
    expect(hidden.value).toBe('ch-test')
  })
})

/**
 * BR-68 · บัญชีที่มีแคมเปญอื่นเปิดอยู่ต้องเห็นก่อนกด ไม่ใช่หลังกด
 */
describe('M1-S04 · กันชนบัญชี', () => {
  beforeEach(() => {
    state.screen = aScreen({
      channels: [aChannel({ liveCampaign: { id: 'camp-2', name: 'ปีใหม่ 2569' } })],
    })
  })

  it('บอกว่าบัญชีนี้มีแคมเปญอื่นเปิดอยู่ พร้อมชื่อของมัน', async () => {
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).toContain('ปีใหม่ 2569')
    expect(container.textContent).toContain('BR-68')
  })

  it('ปุ่มส่งขึ้นถูกปิดไว้ ไม่ปล่อยให้กดแล้วค่อยเจอ error', async () => {
    await open({ channel: 'ch-test' })
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('แคมเปญที่เปิดอยู่คือตัวเอง ไม่ใช่การชน — ส่งขึ้นซ้ำได้', async () => {
    state.screen = aScreen({
      channels: [aChannel({ liveCampaign: { id: 'camp-1', name: 'เมโล ครบเจ็ดวัน' } })],
    })
    await open({ channel: 'ch-test' })
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(false)
  })
})

/**
 * BR-18 · บัญชีจริงของลูกค้าต้องยืนยันซ้ำ
 */
describe('M1-S04 · บัญชีจริงของลูกค้า', () => {
  const prodScreen = () => aScreen({
    channels: [aChannel({ id: 'ch-prod', name: 'OA ลูกค้า', channelType: 'production' })],
  })

  it('เลือกบัญชีจริงแล้วมีกล่องยืนยันพร้อมคำเตือนที่เรียกคืนไม่ได้', async () => {
    state.screen = prodScreen()
    const { container } = await open({ channel: 'ch-prod' })
    expect(container.textContent).toContain('บัญชีจริงของลูกค้า')
    expect(container.textContent).toContain('ลบหรือเรียกคืนไม่ได้')
    expect(screen.getByText(`พิมพ์ "${CONFIRM_WORD}" เพื่อปลดล็อกปุ่ม`)).toBeDefined()
  })

  it('ช่องยืนยันบังคับกรอก และรับได้เฉพาะคำที่ถูก', async () => {
    state.screen = prodScreen()
    const { container } = await open({ channel: 'ch-prod' })
    const input = container.querySelector('input[name="confirm"]') as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.getAttribute('pattern')).toBe(CONFIRM_WORD)
  })

  it('ปุ่มบอกให้ชัดว่ากำลังยิงขึ้นบัญชีจริง', async () => {
    state.screen = prodScreen()
    await open({ channel: 'ch-prod' })
    expect(screen.getByRole('button', { name: 'ส่งขึ้น LINE — บัญชีจริงของลูกค้า' })).toBeDefined()
  })

  it('บัญชีทดสอบไม่มีกล่องยืนยัน — คำเตือนที่ขึ้นทุกครั้งคือคำเตือนที่ถูกข้าม', async () => {
    const { container } = await open({ channel: 'ch-test' })
    expect(container.querySelector('input[name="confirm"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'ส่งขึ้น LINE' })).toBeDefined()
  })

  it('ยังไม่ได้เลือกบัญชี ก็ยังไม่มีกล่องยืนยันให้กรอกลอยๆ', async () => {
    state.screen = prodScreen()
    const { container } = await open()
    expect(container.querySelector('input[name="confirm"]')).toBeNull()
  })

  it('การยืนยันไม่ถูกนับเป็นข้อในรายการผลตรวจ — มันมีกล่องของตัวเองอยู่แล้ว', async () => {
    state.screen = prodScreen()
    await open({ channel: 'ch-prod' })
    expect(screen.getByText('ผ่านทุกข้อ')).toBeDefined()
  })

  /**
   * `where` ของ BR-18 คือ `publish#confirm` · จุดยึดนั้นต้องมีอยู่จริงบนจอ
   *
   * เทสต์เส้นทางที่ lib/publish/validate.test.ts พิสูจน์ได้แค่ว่ามีไฟล์จออยู่ ไม่ได้
   * พิสูจน์ว่าในจอนั้นมี id ให้กระโดดไปถึง · ลิงก์ที่พาไปถูกหน้าแต่ไม่เลื่อนไปที่กล่อง
   * ยืนยันคือลิงก์ที่ทำงานครึ่งเดียวบนจอที่ยาวที่สุดของระบบ
   */
  it('จุดยึดที่ where ของ BR-18 ชี้ไป มีอยู่จริงบนจอ', async () => {
    state.screen = prodScreen()
    const { container } = await open({ channel: 'ch-prod' })
    const anchor = WHERE.confirm.split('#')[1]
    expect(anchor).toBeTruthy()
    expect(container.querySelector(`#${anchor}`)).not.toBeNull()
  })
})

/**
 * BR-28 · ค่าที่บัญชีนี้ตั้งทับค่าของแคมเปญ
 */
describe('M1-S04 · ค่าที่จะใช้จริงกับบัญชีนี้', () => {
  it('ไม่มีอะไรตั้งทับ ก็ไม่มีป้ายว่าต่างจากค่าตั้งต้น', async () => {
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).toContain('ความยาวของหนึ่งวัน')
    expect(screen.queryByText('ต่างจากค่าตั้งต้น')).toBeNull()
  })

  it('บัญชีที่ย่นวันให้สั้นลง ถูกชี้ว่าต่างจากค่าตั้งต้น', async () => {
    state.screen = aScreen({ channels: [aChannel({ dayLengthSec: 60 })] })
    const { container } = await open({ channel: 'ch-test' })
    expect(screen.getByText('ต่างจากค่าตั้งต้น')).toBeDefined()
    expect(container.textContent).toContain('บัญชีนี้ตั้งค่าต่างจากค่าตั้งต้นของแคมเปญ — ตรวจว่าตั้งใจจริง')
  })

  it('เป้าของค่าสะสมที่ถูกตั้งทับ ก็ขึ้นในตารางเดียวกัน', async () => {
    state.screen = aScreen({
      base: { ...goodBase(), counters: [{ id: 'ct1', code: 'stamp', name: 'แสตมป์', target: 7 }] },
      channels: [aChannel({ counterTargets: { stamp: 3 } })],
    })
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).toContain('เป้าของ "แสตมป์"')
    expect(screen.getByText('ต่างจากค่าตั้งต้น')).toBeDefined()
  })

  it('ค่าของโหมดเดโม่ที่กำลังจะขึ้นบัญชีจริง ถูกเตือนแยกเป็นกล่องของตัวเอง', async () => {
    state.screen = aScreen({
      channels: [aChannel({ id: 'ch-prod', channelType: 'production', dayLengthSec: 60 })],
    })
    const { container } = await open({ channel: 'ch-prod' })
    expect(container.textContent).toContain('กำลังส่งค่าของโหมดเดโม่ขึ้นบัญชีจริงของลูกค้า')
  })
})

/**
 * หนี้ทางเทคนิคข้อ 2 · `channel.line_channel_id` ยังไม่มีหน้าจอกรอก
 */
describe('M1-S04 · บัญชีที่ยังไม่มีรหัสช่องของ LINE', () => {
  it('เตือนว่า webhook จะยังหาแคมเปญนี้ไม่เจอ', async () => {
    state.screen = aScreen({ channels: [aChannel({ lineChannelId: null })] })
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).toContain('ยังไม่มีรหัสช่องของ LINE')
    expect(container.textContent).toContain('M6-S02')
  })

  it('บัญชีที่มีรหัสช่องแล้วไม่ถูกเตือน', async () => {
    const { container } = await open({ channel: 'ch-test' })
    expect(container.textContent).not.toContain('ยังไม่มีรหัสช่องของ LINE')
  })
})

/**
 * BR-39 · การ์ดตั้งต้นเป็นของบัญชี ไม่ใช่ของแคมเปญ
 *
 * ด่านนี้เปลี่ยนคำตอบเมื่อเลือกบัญชีคนละใบ ซึ่งเป็นเหตุผลที่ configFor ต้องส่งค่า
 * ของบัญชีที่เลือกต่อเข้าไปในตัวตรวจ · ถ้าส่งเป็น null ตายตัว แคมเปญที่ตั้งการ์ด
 * ตั้งต้นไว้เรียบร้อยแล้วจะส่งขึ้นไม่ได้ตลอดกาล โดยที่จอชี้ไปหน้าที่ตั้งไว้ถูกแล้ว
 */
describe('M1-S04 · การ์ดตั้งต้นของบัญชีที่เลือก', () => {
  const withTextInput = (defaultCardId: string | null) => aScreen({
    base: {
      ...goodBase(),
      activities: [{
        ...goodBase().activities[0], inputType: 'text',
      }],
    },
    channels: [aChannel({ defaultCardId })],
  })

  it('บัญชีที่ยังไม่มีการ์ดตั้งต้น ทำให้ส่งขึ้นไม่ได้ และพาไปหน้าบัญชี LINE', async () => {
    state.screen = withTextInput(null)
    const { container } = await open({ channel: 'ch-test' })

    const row = Array.from(container.querySelectorAll('[data-check="blocked"]'))
      .find((node) => node.textContent?.includes('BR-39'))
    expect(row, 'ต้องมีแถวของ BR-39').not.toBeUndefined()
    expect(row!.querySelector('a')!.getAttribute('href')).toBe('/channels')
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('บัญชีที่ตั้งการ์ดตั้งต้นไว้แล้ว ผ่าน', async () => {
    state.screen = withTextInput('c1')
    const { container } = await open({ channel: 'ch-test' })

    expect(container.querySelector('[data-check="blocked"]')).toBeNull()
    expect(screen.getByText('ผ่านทุกข้อ')).toBeDefined()
  })

  /**
   * ยังไม่ได้เลือกบัญชี = ยังไม่มีการ์ดตั้งต้นให้ตอบ จอจึงอ่านแบบเข้มไว้ก่อน
   *
   * เขียนเป็นเทสต์ไว้เพราะมันเป็นการตัดสินใจ ไม่ใช่ผลข้างเคียง · การอ่านแบบผ่อน
   * ก่อนเลือกบัญชีจะทำให้รายการเปลี่ยนจากเขียวเป็นแดงตอนคนเลือกบัญชี ซึ่งอ่านเหมือน
   * จอเพิ่งพัง · และตอนนี้ยังไม่มีปุ่มส่งขึ้นให้กด ความเข้มจึงไม่ได้ปิดกั้นใคร
   */
  it('ยังไม่ได้เลือกบัญชี · BR-39 ยังค้างอยู่และยังไม่มีปุ่มให้กด', async () => {
    state.screen = withTextInput('c1')
    const { container } = await open()
    const blocked = Array.from(container.querySelectorAll('[data-check="blocked"]'))
      .map((node) => node.textContent ?? '')

    expect(blocked.filter((text) => text.includes('BR-39'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /ส่งขึ้น LINE/ })).toBeNull()
  })
})

describe('M1-S04 · ปุ่มส่งขึ้น', () => {
  it('ยังมีปัญหาค้าง ปุ่มถูกปิด', async () => {
    state.screen.base.cards = [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 2 }]
    await open({ channel: 'ch-test' })
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('ผ่านทุกข้อและเลือกบัญชีแล้ว ปุ่มเปิด', async () => {
    await open({ channel: 'ch-test' })
    expect((screen.getByRole('button', { name: /ส่งขึ้น LINE/ }) as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('ฟอร์มส่งขึ้นไม่มีช่องที่ขอข้ามด่านตรวจ', async () => {
    const { container } = await open({ channel: 'ch-test' })
    for (const name of ['skip_validation', 'force', 'channel_type', 'campaign_id', 'published_by']) {
      expect(container.querySelector(`[name="${name}"]`), name).toBeNull()
    }
  })
})

describe('M1-S04 · หลังส่งขึ้นสำเร็จ', () => {
  it('บอกว่าส่งขึ้นแล้วพร้อมเลขเวอร์ชัน', async () => {
    state.screen = aScreen({ channels: [aChannel({ publishedVersion: 3 })], latestVersion: 3 })
    const { container } = await open({ done: '3' })
    expect(container.textContent).toContain('ส่งขึ้น LINE แล้ว')
    expect(container.textContent).toContain('v3')
  })

  it('ยังไม่ได้ส่งขึ้น ไม่มีแถบสำเร็จค้างไว้', async () => {
    const { container } = await open()
    expect(container.textContent).not.toContain('ส่งขึ้น LINE แล้ว')
  })
})

describe('M1-S04 · ใครเปิดได้', () => {
  it('ยังไม่ได้เข้าระบบ ส่งไปหน้าเข้าระบบ', async () => {
    state.session = null
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(state.redirectedTo).toBe('/login')
  })

  for (const role of ['content_editor', 'reporter']) {
    it(`${role} เปิดจอนี้ไม่ได้ — การส่งขึ้นเป็นสิทธิ์ของผู้ตั้งค่าแคมเปญ`, async () => {
      state.session = { userId: 'u2', email: 'x@example.com', role }
      await expect(open()).rejects.toThrow('NEXT_REDIRECT')
      expect(state.redirectedTo).toBe('/campaigns/camp-1')
    })
  }

  it('แคมเปญที่ไม่มีอยู่ ไม่ได้ถูกวาดเป็นจอเปล่า', async () => {
    state.campaign = null
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFound).toBe(true)
  })
})

describe('M1-S04 · แถวของบัญชีอ่านออกโดยไม่ต้องพึ่งสี', () => {
  it('ชั้นของบัญชีถูกเขียนเป็นคำ ไม่ใช่แค่แถบสี (BR-19)', async () => {
    state.screen = aScreen({
      channels: [aChannel(), aChannel({ id: 'ch-prod', name: 'OA ลูกค้า', channelType: 'production' })],
    })
    const { container } = await open()
    const rows = Array.from(container.querySelectorAll('[data-channel]'))
    expect(within(rows[0] as HTMLElement).getByText('บัญชีทดสอบ')).toBeDefined()
    expect(within(rows[1] as HTMLElement).getByText('บัญชีลูกค้า')).toBeDefined()
  })
})
