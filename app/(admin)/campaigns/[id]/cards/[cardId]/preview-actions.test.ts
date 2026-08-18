import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardEditorScreen } from '@/lib/db/cardEditor'
import { toFlexBubble } from '@/lib/render/flex'
import { groupBlocks } from '@/lib/render/groups'
import type { PlayerState } from '@/lib/state'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  testLineUid: string | null
  screen: CardEditorScreen | null
  channel: { id: string } | null
  pushed: Array<{ token: string; to: string; message: unknown }>
  tokenReads: Array<Record<string, unknown>>
} = {
  cookie: undefined,
  user: undefined,
  testLineUid: null,
  screen: null,
  channel: null,
  pushed: [],
  tokenReads: [],
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))

/** getSession() (เรียกผ่าน requireRole) ยิง SELECT ... FROM app_user จริงตัวหนึ่ง — fake sql ต้องตอบมันได้ */
const sql = (strings: TemplateStringsArray) => {
  const text = strings.join(' ? ')
  if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
  return Promise.resolve([])
}

vi.mock('@/lib/db/client', () => ({ db: () => sql }))
vi.mock('@/lib/db/cardEditor', () => ({ loadCardEditor: async () => state.screen }))
vi.mock('@/lib/db/users', () => ({ loadTestLineUid: async () => state.testLineUid }))
vi.mock('@/lib/db/channels', () => ({ findTestSendChannel: async () => state.channel }))
vi.mock('@/lib/db/tokens', () => ({
  readChannelSecret: vi.fn(async (_sql: unknown, opts: Record<string, unknown>) => {
    state.tokenReads.push(opts)
    return 'oa-access-token'
  }),
}))
vi.mock('@/lib/line/client', () => ({
  pushMessage: vi.fn(async (token: string, to: string, message: unknown) => {
    state.pushed.push({ token, to, message })
  }),
}))

const { sendTestCard } = await import('./preview-actions')
const { readChannelSecret } = await import('@/lib/db/tokens')
const { pushMessage } = await import('@/lib/line/client')

const theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }

const screenFor = (over: Partial<CardEditorScreen> = {}): CardEditorScreen => ({
  card: {
    id: 'card-1', code: 'welcome', renderAs: 'flex_bubble', renderName: 'การ์ดเดี่ยว',
    hasImage: false, previewText: 'สวัสดี', usedBy: [], isOrphan: true,
  },
  templateCode: null,
  hasSampleText: false,
  campaignName: 'แคมเปญคุกกี้',
  campaignStatus: 'draft',
  theme,
  blocks: [
    { id: 'b1', blockType: 'title', sortOrder: 0, content: 'สวัสดี {{attr.name}}', showWhen: null, options: null },
  ],
  selectors: [],
  activities: [],
  rewardCodes: [],
  counterCodes: [],
  ...over,
})

const aPlayerState = (): PlayerState => ({
  attributes: { name: 'มีนา' }, counters: {}, entitlements: [], playCounts: {}, completed: [],
})

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.testLineUid = null
  state.screen = screenFor()
  state.channel = { id: 'ch-test' }
  state.pushed = []
  state.tokenReads = []
  vi.mocked(readChannelSecret).mockClear()
  vi.mocked(pushMessage).mockClear()
})

/**
 * ด่านสิทธิ์ — ทุก Server Action ต้องตรวจเองด้วย requireRole() (Global Constraints)
 * แต่การ์ดทดสอบส่งเข้าเครื่องตัวเองไม่มีสิทธิ์อะไรติดไปด้วย (เหมือน saveTestLineUid)
 * จึงเป็นแค่ด่าน "เข้าระบบหรือยัง" ไม่ใช่ด่านบทบาท — reporter ก็ส่งได้
 */
describe('sendTestCard · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ส่งไม่ได้', async () => {
    await expect(sendTestCard('camp-1', 'card-1', aPlayerState())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.pushed).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว ส่งไม่ได้แม้คุกกี้ยังอยู่', async () => {
    signedInAs('configurator', false)
    await expect(sendTestCard('camp-1', 'card-1', aPlayerState())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
  })

  for (const role of ['configurator', 'content_editor', 'reporter']) {
    it(`${role} ส่งการ์ดทดสอบของตัวเองได้ — ไม่ใช่สิทธิ์พิเศษ`, async () => {
      signedInAs(role)
      state.testLineUid = `U${'a'.repeat(32)}`
      await sendTestCard('camp-1', 'card-1', aPlayerState())
      expect(state.pushed).toHaveLength(1)
    })
  }
})

describe('sendTestCard · BR-62 · ต้องมี test_line_uid ของตัวเองก่อน', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ยังไม่ได้ตั้ง test_line_uid บอกวิธีไปตั้ง ไม่ยิงอะไรออกไป', async () => {
    state.testLineUid = null
    await expect(sendTestCard('camp-1', 'card-1', aPlayerState())).rejects.toThrow('/users')
    expect(state.pushed).toEqual([])
    expect(readChannelSecret).not.toHaveBeenCalled()
  })
})

describe('sendTestCard · การ์ดต้องมีอยู่จริง', () => {
  beforeEach(() => {
    signedInAs('configurator')
    state.testLineUid = `U${'a'.repeat(32)}`
  })

  it('ไม่พบการ์ดในแคมเปญนี้ ส่งไม่ได้', async () => {
    state.screen = null
    await expect(sendTestCard('camp-1', 'card-1', aPlayerState())).rejects.toThrow('ไม่พบการ์ด')
    expect(state.pushed).toEqual([])
  })
})

describe('sendTestCard · BR-62 · ต้องมีบัญชี LINE ประเภททดสอบให้ใช้', () => {
  beforeEach(() => {
    signedInAs('configurator')
    state.testLineUid = `U${'a'.repeat(32)}`
  })

  it('ไม่มีบัญชีทดสอบที่ผูกกุญแจไว้เลย ส่งไม่ได้', async () => {
    state.channel = null
    await expect(sendTestCard('camp-1', 'card-1', aPlayerState())).rejects.toThrow(/ทดสอบ/)
    expect(state.pushed).toEqual([])
  })
})

describe('sendTestCard · เส้นทางสำเร็จ', () => {
  beforeEach(() => {
    signedInAs('configurator')
    state.testLineUid = `U${'a'.repeat(32)}`
  })

  it('อ่านกุญแจด้วย purpose test_send และชื่อคนกด ไม่ใช่ system', async () => {
    await sendTestCard('camp-1', 'card-1', aPlayerState())

    expect(state.tokenReads).toEqual([
      { channelId: 'ch-test', field: 'token', purpose: 'test_send', appUserId: 'u1' },
    ])
  })

  it('ส่งเข้า LINE ที่ test_line_uid ของตัวเอง ด้วยโทเคนที่อ่านมา', async () => {
    await sendTestCard('camp-1', 'card-1', aPlayerState())

    expect(state.pushed).toHaveLength(1)
    expect(state.pushed[0].to).toBe(state.testLineUid)
    expect(state.pushed[0].token).toBe('oa-access-token')
  })

  /**
   * BR-91 ที่จุดส่งจริง — ข้อความที่ยิงออกไปต้องมาจาก renderCard ตัวเดียวกับที่
   * Preview.tsx ใช้วาดจอ ไม่ใช่ก้อนที่ preview-actions.ts ประกอบขึ้นมาเอง
   */
  it('ข้อความที่ push ตรงกับ toFlexBubble(groupBlocks(...)) ของบล็อกจริง แบบ byte-identical', async () => {
    const playerState = aPlayerState()
    await sendTestCard('camp-1', 'card-1', playerState)

    const expected = toFlexBubble(groupBlocks(state.screen!.blocks, playerState), playerState, theme)
    const message = state.pushed[0].message as { type: string; contents: unknown }
    expect(message.type).toBe('flex')
    expect(message.contents).toEqual(expected)
  })

  it('renderAs เป็น text — ข้อความที่ push ตรงกับ toPlainText จริง', async () => {
    state.screen = screenFor({
      card: { ...screenFor().card, renderAs: 'text' },
    })
    const playerState = aPlayerState()
    await sendTestCard('camp-1', 'card-1', playerState)

    const message = state.pushed[0].message as { type: string; text: string }
    expect(message.type).toBe('text')
    expect(message.text).toBe('สวัสดี มีนา')
  })

  it('state ที่ส่งมาจากจอ (ผู้เล่นจำลอง) ถูกใช้จริงในการเรนเดอร์ — ไม่ใช่ state ว่าง', async () => {
    state.screen = screenFor({
      blocks: [{
        id: 'b1', blockType: 'body', sortOrder: 0, content: 'ลับ',
        showWhen: [{ type: 'has_entitlement', rewardCode: 'x' }], options: null,
      }],
    })

    await sendTestCard('camp-1', 'card-1', { ...aPlayerState(), entitlements: [] })
    const withoutEnt = state.pushed[0].message as { contents: { body: { contents: unknown[] } } }

    state.pushed = []
    await sendTestCard('camp-1', 'card-1', { ...aPlayerState(), entitlements: ['x'] })
    const withEnt = state.pushed[0].message as { contents: { body: { contents: unknown[] } } }

    expect(withoutEnt.contents.body.contents).not.toEqual(withEnt.contents.body.contents)
  })
})
