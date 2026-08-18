import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishChannel, PublishScreenData } from '@/lib/db/publish'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  screen: PublishScreenData
  statements: Array<{ text: string; values: unknown[] }>
  events: string[]
  redirectedTo: string | null
  lineFails: boolean
  campaignCardIds: string[]
} = {
  cookie: undefined,
  user: undefined,
  screen: {} as PublishScreenData,
  statements: [],
  events: [],
  redirectedTo: null,
  lineFails: false,
  campaignCardIds: ['c1'],
}

/** ทุกคำสั่งที่เขียนของ · การอ่านไม่นับ เพราะสิ่งที่ต้องพิสูจน์คือ "ไม่ได้แตะอะไรเลย" */
const writes = () => state.statements.filter((s) => /INSERT|UPDATE|DELETE/i.test(s.text))

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    state.statements.push({ text, values })
    if (/INSERT/i.test(text)) state.events.push('write')
    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
    if (/INSERT INTO config_version/.test(text)) return Promise.resolve([{ version_no: 4 }])
    if (/FROM card WHERE/.test(text)) {
      const [cardId] = values
      return Promise.resolve(
        state.campaignCardIds.includes(String(cardId)) ? [{ id: cardId }] : [],
      )
    }
    return Promise.resolve([])
  },
  {
    array: (value: unknown) => value,
    json: (value: unknown) => value,
    begin: (run: (tx: unknown) => unknown) => {
      state.events.push('tx-open')
      return Promise.resolve(run(sql))
    },
  },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to
    throw new Error('NEXT_REDIRECT')
  },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))
vi.mock('@/lib/db/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/publish')>()),
  loadPublishScreen: async () => state.screen,
}))
vi.mock('@/lib/db/tokens', () => ({
  readChannelSecret: vi.fn(async (_sql: unknown, opts: Record<string, unknown>) => {
    state.events.push(`read-token:${opts.purpose}:${opts.appUserId}`)
    return 'oa-access-token'
  }),
}))
vi.mock('@/lib/line/client', () => ({
  setWebhookEndpoint: vi.fn(async (token: string, endpoint: string) => {
    state.events.push(`line:${token}:${endpoint}`)
    if (state.lineFails) throw new Error('เชื่อมต่อ LINE ไม่สำเร็จ ตั้ง webhook ไม่ได้ (401)')
  }),
}))

const { publish, saveDefaultCard } = await import('./actions')
const { CONFIRM_WORD } = await import('@/lib/publish/validate')
const { readChannelSecret } = await import('@/lib/db/tokens')
const { setWebhookEndpoint } = await import('@/lib/line/client')

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

/** config ที่ผ่านด่านตรวจทุกข้อ · เทสต์ที่อยากให้ติดด่าน ทำให้ก้อนนี้เสียทีละอย่าง */
const goodScreen = (channels: PublishChannel[]): PublishScreenData => ({
  base: {
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
  },
  channels,
  latestVersion: 3,
  campaignDayLengthSec: 86_400,
})

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const runExpectingRedirect = async (data: FormData) => {
  await expect(publish('camp-1', data)).rejects.toThrow('NEXT_REDIRECT')
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.statements = []
  state.events = []
  state.redirectedTo = null
  state.lineFails = false
  state.screen = goodScreen([aChannel()])
  state.campaignCardIds = ['c1']
  vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
  vi.mocked(setWebhookEndpoint).mockClear()
  vi.mocked(readChannelSecret).mockClear()
})

/**
 * ด่านสิทธิ์อยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * จอนี้เป็นจอเดียวที่ความผิดพลาดไปโผล่หาผู้ใช้จริงบน LINE และข้อความที่ส่งเข้า
 * LINE แล้วเรียกคืนไม่ได้ · ฟอร์มเป็นของที่ผู้ส่งแต่งเองได้ทั้งใบ ปุ่มที่จอซ่อนไว้
 * จึงไม่ใช่ด่าน
 */
describe('publish · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ส่งขึ้นไม่ได้', async () => {
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
    expect(setWebhookEndpoint).not.toHaveBeenCalled()
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ส่งขึ้นไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(writes()).toEqual([])
  })

  for (const role of ['content_editor', 'reporter']) {
    it(`${role} ส่งขึ้นไม่ได้ — การส่งขึ้นเป็นสิทธิ์ของผู้ตั้งค่าแคมเปญ`, async () => {
      signedInAs(role)
      await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
        .rejects.toThrow('ไม่มีสิทธิ์')
      expect(writes()).toEqual([])
      expect(setWebhookEndpoint).not.toHaveBeenCalled()
    })
  }

  it('ผู้ตั้งค่าแคมเปญส่งขึ้นได้', async () => {
    signedInAs('configurator')
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(writes().length).toBeGreaterThan(0)
  })

  it('ด่านสิทธิ์มาก่อนการอ่านกุญแจ — role ที่ไม่มีสิทธิ์ต้องไม่ทำให้กุญแจถูกถอดรหัส', async () => {
    signedInAs('reporter')
    await expect(publish('camp-1', form({ channel_id: 'ch-test' }))).rejects.toThrow()
    expect(readChannelSecret).not.toHaveBeenCalled()
  })
})

describe('publish · เลือกบัญชีปลายทาง', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ยังไม่ได้เลือกบัญชี ไม่เขียนอะไรเลย', async () => {
    await expect(publish('camp-1', form({ channel_id: '' }))).rejects.toThrow('บัญชี')
    expect(writes()).toEqual([])
  })

  it('บัญชีที่ไม่มีอยู่ในรายการที่ส่งขึ้นได้ ถูกปฏิเสธ', async () => {
    await expect(publish('camp-1', form({ channel_id: 'ch-preview' })))
      .rejects.toThrow('ไม่พบบัญชี')
    expect(writes()).toEqual([])
    expect(readChannelSecret).not.toHaveBeenCalled()
  })
})

/**
 * §4.4 ขั้น 1 · ไม่ผ่านด่านตรวจแล้วห้ามมีอะไรเกิดขึ้นเลย
 */
describe('publish · ด่านตรวจความครบถ้วน', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('มีปัญหาค้างอยู่ ส่งขึ้นไม่ได้ และไม่มี version ถูกสร้าง', async () => {
    state.screen.base.cards = [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 2 }]
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('ยังส่งขึ้นไม่ได้')
    expect(writes()).toEqual([])
    expect(setWebhookEndpoint).not.toHaveBeenCalled()
  })

  it('บอกจำนวนที่ขาด ไม่ใช่บอกแค่ว่าไม่ผ่าน', async () => {
    state.screen.base.cards = [
      { id: 'c1', code: 'win', hasSampleText: true, blocks: 2 },
      { id: 'c2', code: 'lose', hasSampleText: true, blocks: 0 },
    ]
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow(/ขาด \d+ รายการ/)
  })

  it('ด่านตรวจมาก่อนการอ่านกุญแจ — config ที่ยังไม่ครบต้องไม่ทำให้กุญแจถูกถอดรหัส', async () => {
    state.screen.base.keywordRules = []
    await expect(publish('camp-1', form({ channel_id: 'ch-test' }))).rejects.toThrow()
    expect(readChannelSecret).not.toHaveBeenCalled()
  })
})

/**
 * BR-18 · บัญชีจริงของลูกค้าต้องยืนยันซ้ำ และคำยืนยันมาจากฟอร์ม
 */
describe('publish · BR-18', () => {
  beforeEach(() => {
    signedInAs('configurator')
    state.screen = goodScreen([aChannel({ id: 'ch-prod', channelType: 'production' })])
  })

  it('บัญชีจริงที่ไม่ได้พิมพ์ยืนยัน ส่งขึ้นไม่ได้', async () => {
    await expect(publish('camp-1', form({ channel_id: 'ch-prod' })))
      .rejects.toThrow('ยังส่งขึ้นไม่ได้')
    expect(writes()).toEqual([])
  })

  it('พิมพ์คำอื่นมา ก็ยังไม่ผ่าน', async () => {
    await expect(publish('camp-1', form({ channel_id: 'ch-prod', confirm: 'ok' })))
      .rejects.toThrow('ยังส่งขึ้นไม่ได้')
    expect(writes()).toEqual([])
  })

  it('พิมพ์คำยืนยันถูก ผ่าน', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-prod', confirm: CONFIRM_WORD }))
    expect(writes().length).toBeGreaterThan(0)
  })

  it('ช่องว่างหน้าหลังไม่ทำให้คำยืนยันใช้ไม่ได้', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-prod', confirm: `  ${CONFIRM_WORD} ` }))
    expect(writes().length).toBeGreaterThan(0)
  })

  it('บัญชีทดสอบไม่ต้องยืนยัน', async () => {
    state.screen = goodScreen([aChannel()])
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(writes().length).toBeGreaterThan(0)
  })
})

/**
 * BR-68 · §4.4 ขั้น 3 · OA หนึ่งบัญชีรันแคมเปญทีละหนึ่ง
 */
describe('publish · กันชนบัญชี', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('มีแคมเปญอื่นเปิดอยู่บนบัญชีนี้ ส่งขึ้นไม่ได้ และบอกว่าชนกับตัวไหน', async () => {
    state.screen = goodScreen([
      aChannel({ liveCampaign: { id: 'camp-2', name: 'ปีใหม่ 2569' } }),
    ])
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('ปีใหม่ 2569')
    expect(writes()).toEqual([])
    expect(setWebhookEndpoint).not.toHaveBeenCalled()
  })

  it('ข้อความบอกวิธีแก้ ไม่ใช่แค่บอกว่าชน', async () => {
    state.screen = goodScreen([
      aChannel({ liveCampaign: { id: 'camp-2', name: 'ปีใหม่ 2569' } }),
    ])
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow(/ถอนแคมเปญนั้นก่อน/)
  })

  it('แคมเปญที่เปิดอยู่คือตัวเอง ส่งขึ้นซ้ำได้ — เป็นการทับด้วยเวอร์ชันใหม่', async () => {
    state.screen = goodScreen([
      aChannel({ liveCampaign: { id: 'camp-1', name: 'ตัวเอง' }, publishedVersion: 3 }),
    ])
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(writes().length).toBeGreaterThan(0)
  })
})

/**
 * §4.4 ขั้น 4 · 6 · 7 · ลำดับและสิ่งที่ถูกเขียน
 */
describe('publish · สิ่งที่เกิดขึ้นเมื่อผ่านทุกด่าน', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('สร้าง config_version ใหม่ · เลขเวอร์ชันมาจากฐานข้อมูล ไม่ใช่จากที่จอนับมา', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    const insert = writes().find((w) => /INSERT INTO config_version/.test(w.text))!
    expect(insert.text).toContain('max(version_no)')
    expect(insert.values).not.toContain(4)
  })

  it('ผูกบัญชีกับแคมเปญและตั้งว่าเปิดอยู่', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    const bind = writes().find((w) => /INSERT INTO campaign_channel/.test(w.text))!
    expect(bind.text).toContain('is_published = true')
  })

  it('แคมเปญถูกตั้งเป็นส่งขึ้นแล้ว', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(writes().some((w) => /UPDATE campaign SET status = 'published'/.test(w.text))).toBe(true)
  })

  it('ตั้ง webhook ที่ LINE ด้วยโทเคนของบัญชีนั้น ไม่ใช่ของ env', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(setWebhookEndpoint)
      .toHaveBeenCalledWith('oa-access-token', 'https://flex.example.com/api/line/webhook')
  })

  it('การอ่านกุญแจถูกบันทึกด้วยจุดประสงค์ publish และชื่อคนกด', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(readChannelSecret).toHaveBeenCalledWith(sql, {
      channelId: 'ch-test', field: 'token', purpose: 'publish', appUserId: 'u1',
    })
  })

  /**
   * ร่องรอยการอ่านกุญแจต้องรอดจากการย้อนธุรกรรม
   *
   * `readChannelSecret` เขียนแถวลง token_access_log ก่อนถอดรหัส · ถ้าเรียกมันอยู่
   * ข้างในธุรกรรมของการส่งขึ้น การส่งขึ้นที่ล้มจะลบร่องรอยของตัวเองไปด้วย ซึ่งเป็น
   * ร่องรอยที่คนจะอยากหาที่สุด
   */
  it('กุญแจถูกอ่านก่อนธุรกรรมเปิด', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    const readAt = state.events.findIndex((e) => e.startsWith('read-token'))
    const txAt = state.events.indexOf('tx-open')
    expect(readAt).toBeGreaterThanOrEqual(0)
    expect(txAt).toBeGreaterThanOrEqual(0)
    expect(readAt).toBeLessThan(txAt)
  })

  it('LINE ถูกเรียกหลังจาก version ถูกเขียน — ล้มแล้วธุรกรรมย้อนทั้งก้อน', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    const writeAt = state.events.indexOf('write')
    const lineAt = state.events.findIndex((e) => e.startsWith('line:'))
    expect(writeAt).toBeLessThan(lineAt)
    expect(state.events.indexOf('tx-open')).toBeLessThan(lineAt)
  })

  it('LINE ปฏิเสธแล้วข้อผิดพลาดถูกส่งต่อ ไม่ถูกกลืน และไม่พาไปหน้าสำเร็จ', async () => {
    state.lineFails = true
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow(/webhook/)
    expect(state.redirectedTo).toBeNull()
  })

  it('ยังไม่ได้ตั้งที่อยู่สาธารณะ ส่งขึ้นไม่ได้ และไม่เขียนอะไรเลย', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', '')
    await expect(publish('camp-1', form({ channel_id: 'ch-test' })))
      .rejects.toThrow('PUBLIC_BASE_URL')
    expect(writes()).toEqual([])
  })

  it('พากลับมาที่จอเดิมพร้อมเลขเวอร์ชันที่เพิ่งได้', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test' }))
    expect(state.redirectedTo).toBe('/campaigns/camp-1/publish?done=4')
  })
})

/**
 * ค่าที่ตัดสินผลมาจากที่ที่ผู้ส่งฟอร์มแต่งไม่ได้
 */
describe('publish · ฟอร์มแต่งเองแล้วข้ามด่านไม่ได้', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('รหัสแคมเปญมาจากตัว action ไม่ใช่จากฟอร์ม', async () => {
    await runExpectingRedirect(form({ channel_id: 'ch-test', campaign_id: 'camp-อื่น' }))
    const insert = writes().find((w) => /INSERT INTO config_version/.test(w.text))!
    expect(insert.values).toContain('camp-1')
    expect(insert.values).not.toContain('camp-อื่น')
  })

  it('ชื่อคนส่งขึ้นมาจาก session ไม่ใช่จากฟอร์ม', async () => {
    await runExpectingRedirect(form({
      channel_id: 'ch-test', published_by: 'ใครก็ไม่รู้', app_user_id: 'ใครก็ไม่รู้',
    }))
    const insert = writes().find((w) => /INSERT INTO config_version/.test(w.text))!
    expect(insert.values).toContain('u1')
    expect(insert.values).not.toContain('ใครก็ไม่รู้')
  })

  it('ส่งช่องที่ขอข้ามด่านตรวจมาด้วย ก็ไม่มีอะไรเปลี่ยน', async () => {
    state.screen.base.cards = [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 2 }]
    const forged = form({ channel_id: 'ch-test' })
    for (const key of ['skip_validation', 'force', 'ignore_problems', 'confirmed']) {
      forged.append(key, 'true')
    }
    await expect(publish('camp-1', forged)).rejects.toThrow('ยังส่งขึ้นไม่ได้')
    expect(writes()).toEqual([])
  })

  it('ส่งชนิดของบัญชีมาเองเพื่อเลี่ยง BR-18 ก็ไม่มีผล', async () => {
    state.screen = goodScreen([aChannel({ id: 'ch-prod', channelType: 'production' })])
    const forged = form({ channel_id: 'ch-prod', channel_type: 'test' })
    await expect(publish('camp-1', forged)).rejects.toThrow('ยังส่งขึ้นไม่ได้')
    expect(writes()).toEqual([])
  })
})

/**
 * BR-39 · การ์ดตั้งต้นเมื่อผู้เล่นพิมพ์ลอยๆ (channel.default_card_id)
 *
 * ไม่มีจอไหนในระบบเคยให้กรอกค่านี้มาก่อน (ตรวจแล้วทั้งโปรเจกต์) ทั้งที่ webhook
 * และด่านตรวจก่อนส่งขึ้นอ่านมันอยู่แล้ว — จอนี้เป็นทางเดียวที่ค่านี้เขียนได้
 */
describe('saveDefaultCard', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ต้องเข้าสู่ระบบและมีสิทธิ์ configurator เท่านั้น', async () => {
    state.cookie = undefined
    await expect(saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: 'c1' })))
      .rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('reporter ทำไม่ได้', async () => {
    signedInAs('reporter')
    await expect(saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: 'c1' })))
      .rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('บันทึกการ์ดของแคมเปญนี้ลงบัญชีที่ระบุได้จริง', async () => {
    await saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: 'c1' }))
    const update = writes().find((w) => /UPDATE channel/.test(w.text))!
    expect(update.text).toContain('default_card_id')
    expect(update.values).toContain('c1')
    expect(update.values).toContain('ch-test')
  })

  it('การ์ดที่ไม่ใช่ของแคมเปญนี้ ปฏิเสธ ไม่เขียน — กันการ์ดของแคมเปญอื่นหลุดเข้ามา', async () => {
    await expect(saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: 'ของแคมเปญอื่น' })))
      .rejects.toThrow()
    expect(writes()).toEqual([])
  })

  it('เว้นว่างไว้ = ล้างค่าเดิม ไม่ใช่ error', async () => {
    await saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: '' }))
    const update = writes().find((w) => /UPDATE channel/.test(w.text))!
    expect(update.values).toContain(null)
  })

  it('channel_id มาจากที่เรียก action ไม่ใช่จากฟอร์ม — ฟอร์มแต่งเองข้ามไปบัญชีอื่นไม่ได้', async () => {
    await saveDefaultCard('camp-1', 'ch-test', form({ default_card_id: 'c1', channel_id: 'ch-อื่น' }))
    const update = writes().find((w) => /UPDATE channel/.test(w.text))!
    expect(update.values).toContain('ch-test')
    expect(update.values).not.toContain('ch-อื่น')
  })
})
