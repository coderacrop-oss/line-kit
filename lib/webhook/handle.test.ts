import { describe, expect, it, vi } from 'vitest'
import { handleEvent, type IncomingEvent } from './handle'
import { FALLBACK } from './messages'
import type { LiveCampaign, PlayOutcome, Ports } from './ports'
import type { CardBlock } from '../render/groups'
import { seededRng } from '../test-utils/rng'

const NOW = new Date('2026-08-14T05:00:00Z') // 12:00 ที่กรุงเทพ
const TODAY = '2026-08-14'

const bodyBlock = (text: string): CardBlock[] => [
  { id: 'b1', blockType: 'body', sortOrder: 1, content: text, showWhen: null, options: null },
]

function campaign(over: Partial<LiveCampaign> = {}): LiveCampaign {
  return {
    campaignId: 'camp-1',
    code: 'krobpet',
    timezone: 'Asia/Bangkok',
    dayLengthSec: 86400,
    startAt: new Date('2026-08-01T00:00:00Z'),
    endAt: new Date('2026-08-31T00:00:00Z'),
    theme: { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' },
    configVersionId: 'cv-1',
    keywordRules: [{ id: 'k1', keyword: 'เล่น', matchMode: 'exact', sortOrder: 1 }],
    keywordTargets: { k1: { activityId: 'act-1' } },
    activities: [{
      id: 'act-1', code: 'draw', inputType: 'none', resolveMethod: 'weighted',
      outcomes: [{ id: 'a', cardId: 'card-win', weight: 1, rewardCode: 'sticker' }],
      entryRules: [], effectSpec: [{ type: 'grant_reward' }],
      fallbackCardId: 'card-fallback', trigger: 'manual',
    }],
    cardsById: {
      'card-win': { code: 'win', renderAs: 'flex_bubble', blocks: bodyBlock('คุณได้รางวัล') },
      'card-fallback': { code: 'fallback', renderAs: 'text', blocks: bodyBlock('ของหมดแล้ว') },
      'card-default': { code: 'default', renderAs: 'text', blocks: bodyBlock('พิมพ์ว่า เล่น') },
      'card-greeting': { code: 'greeting', renderAs: 'text', blocks: bodyBlock('ยินดีต้อนรับ') },
      'card-blocked': { code: 'blocked', renderAs: 'text', blocks: bodyBlock('วันนี้เล่นแล้ว') },
    },
    defaultCardId: 'card-default',
    greetingCardId: 'card-greeting',
    greetingEnabled: true,
    // ค่าเริ่มต้นเป็น null โดยตั้งใจ — เทสต์เดิมส่วนใหญ่ไม่เกี่ยวกับการผูกเมนูตัวเข้า
    // เลย ตั้งเป็นค่าจริงเฉพาะกลุ่มเทสต์ที่ตรวจพฤติกรรมนี้โดยตรงแทน
    entryRichMenuLineId: null,
    ...over,
  }
}

function ports(over: Partial<Ports> = {}, live: LiveCampaign | null = campaign()) {
  const play: Ports['play'] & { mock: { calls: Parameters<Ports['play']>[] } } =
    vi.fn(async (_args: Parameters<Ports['play']>[0]): Promise<PlayOutcome> => ({
      kind: 'played', outcomeId: 'a', cardId: 'card-win',
    })) as never
  const logEvent: Ports['logEvent'] & { mock: { calls: Parameters<Ports['logEvent']>[] } } =
    vi.fn(async (_args: Parameters<Ports['logEvent']>[0]) => {}) as never
  const hasRichMenuLinked: Ports['hasRichMenuLinked'] & { mock: { calls: Parameters<Ports['hasRichMenuLinked']>[] } } =
    vi.fn(async (_participantId: string) => false) as never
  const markRichMenuLinked: Ports['markRichMenuLinked'] & { mock: { calls: Parameters<Ports['markRichMenuLinked']>[] } } =
    vi.fn(async (_participantId: string) => {}) as never
  const base: Ports = {
    findLiveCampaign: async () => live,
    ensureParticipant: async () => 'p-1',
    loadPlayerState: async () => ({
      attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
    }),
    playsThisPeriod: async () => 0,
    play,
    logEvent,
    hasRichMenuLinked,
    markRichMenuLinked,
    ...over,
  }
  return { ports: base, play, logEvent, hasRichMenuLinked, markRichMenuLinked }
}

const userEvent = (over: Partial<IncomingEvent> & { type: string }): IncomingEvent => ({
  replyToken: 'rt-1',
  source: { type: 'user', userId: 'U1' },
  ...over,
})

const run = (event: IncomingEvent, p: Ports) =>
  handleEvent(event, 'line-channel-1', p, NOW, seededRng(1))

describe('การกดสลับแท็บเมนู', () => {
  it('ไม่ตอบข้อความ และไม่แตะฐานข้อมูลเลย', async () => {
    const { ports: p, logEvent } = ports()
    const findLiveCampaign = vi.fn()
    const out = await run(
      { type: 'postback', replyToken: 'rt', source: { type: 'user', userId: 'U1' },
        postback: { data: '', params: { status: 'SUCCESS', newRichMenuAliasId: 'tab-b' } } },
      { ...p, findLiveCampaign },
    )
    expect(out).toBeNull()
    expect(findLiveCampaign).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('ผลไม่สำเร็จก็ยังไม่ตอบข้อความหาผู้ใช้', async () => {
    const { ports: p } = ports()
    const out = await run(
      { type: 'postback', replyToken: 'rt', source: { type: 'user', userId: 'U1' },
        postback: { data: '', params: { status: 'RICHMENU_ALIAS_ID_NOTFOUND' } } },
      p,
    )
    expect(out).toBeNull()
  })

  it('แตะแท็บสิบครั้งไม่มีข้อความออกไปเลยแม้ครั้งเดียว', async () => {
    const { ports: p } = ports()
    const results = []
    for (let i = 0; i < 10; i++) {
      results.push(await run(
        { type: 'postback', replyToken: `rt-${i}`, source: { type: 'user', userId: 'U1' },
          postback: { data: '', params: { status: 'SUCCESS' } } },
        p,
      ))
    }
    expect(results.every((r) => r === null)).toBe(true)
  })
})

describe('ปุ่มบนการ์ด', () => {
  it('กดปุ่มของแคมเปญที่ยังเปิดอยู่ ได้การ์ดผลลัพธ์', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=krobpet&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toMatchObject({ type: 'flex' })
    expect(play).toHaveBeenCalledOnce()
  })

  it('รหัสแคมเปญไม่ตรง ตอบว่ากิจกรรมจบแล้ว และไม่เล่น', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=other&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.campaignOver })
    expect(play).not.toHaveBeenCalled()
  })

  it('การ์ดของวันก่อน ตอบว่าหมดอายุ', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'c=krobpet&a=draw&d=2026-08-01' },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.cardExpired })
    expect(play).not.toHaveBeenCalled()
  })

  it('payload อ่านไม่ออก ยังตอบ ไม่เงียบ', async () => {
    const { ports: p } = ports()
    const out = await run(userEvent({ type: 'postback', postback: { data: 'ขยะ' } }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.systemDown })
  })

  it('เข้าเล่นไม่ได้ ได้การ์ดของเงื่อนไขที่กั้น', async () => {
    const live = campaign()
    live.activities[0].entryRules = [{ type: 'limit', count: 1, per: 'day', cardId: 'card-blocked' }]
    const { ports: p, play } = ports({ playsThisPeriod: async () => 1 }, live)
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=krobpet&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'วันนี้เล่นแล้ว' })
    expect(play).not.toHaveBeenCalled()
  })

  it('ของหมดทุกแบบ ได้การ์ดสำรอง', async () => {
    const { ports: p } = ports({ play: async () => ({ kind: 'exhausted' }) })
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=krobpet&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'ของหมดแล้ว' })
  })

  it('กดซ้ำได้การ์ดเดิม และบันทึกว่าเป็นการเล่นซ้ำ', async () => {
    const { ports: p, logEvent } = ports({
      play: async () => ({ kind: 'replayed', outcomeId: 'a', cardId: 'card-win' }),
    })
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=krobpet&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toMatchObject({ type: 'flex' })
    expect(logEvent.mock.calls[0][0]).toMatchObject({ eventType: 'replay' })
  })
})

describe('ปุ่มบน Rich Menu (แก้บั๊ก: decodePostback ไม่รู้จักปุ่มเมนู ตอบระบบขัดข้องเสมอ)', () => {
  it('ช่องที่ชี้ไปกิจกรรม → เล่นกิจกรรมนั้นเหมือนปุ่มบนการ์ด', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=krobpet&a=draw' },
    }), p)
    expect(out?.message).toMatchObject({ type: 'flex' })
    expect(play).toHaveBeenCalledOnce()
  })

  it('ช่องที่ชี้ไปการ์ด → ตอบด้วยการ์ดนั้นตรงๆ ไม่ผ่าน playActivity', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=krobpet&card=card-greeting' },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'ยินดีต้อนรับ' })
    expect(play).not.toHaveBeenCalled()
  })

  it('การ์ดที่ระบุไม่พบ → ตอบระบบขัดข้อง (เหมือนเส้นทางคีย์เวิร์ด→การ์ดที่หาไม่เจอ)', async () => {
    const { ports: p } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=krobpet&card=card-missing' },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.systemDown })
  })

  it('รหัสแคมเปญไม่ตรง (เมนูจากแคมเปญเก่าที่ถูกแทนที่) → ตอบว่ากิจกรรมจบแล้ว และไม่เล่น', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=other&a=draw' },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.campaignOver })
    expect(play).not.toHaveBeenCalled()
  })

  it('รหัสกิจกรรมที่ไม่มีอยู่จริง → ตอบว่ากิจกรรมจบแล้ว และไม่เล่น', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=krobpet&a=no-such-activity' },
    }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.campaignOver })
    expect(play).not.toHaveBeenCalled()
  })

  it('ไม่เช็ควันหมดอายุเลย — ปุ่มเมนูไม่มีวันที่ออกให้เทียบเหมือนการ์ด', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: 'rm=1&c=krobpet&a=draw' },
    }), p)
    expect(out?.message).not.toEqual({ type: 'text', text: FALLBACK.cardExpired })
    expect(play).toHaveBeenCalledOnce()
  })

  it('payload ของปุ่มบนการ์ดจริง ยังทำงานตามเดิมทุกอย่าง — ไม่ถูกเส้นทางเมนูแย่งไป', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({
      type: 'postback', postback: { data: `c=krobpet&a=draw&d=${TODAY}` },
    }), p)
    expect(out?.message).toMatchObject({ type: 'flex' })
    expect(play).toHaveBeenCalledOnce()
  })
})

describe('พิมพ์ข้อความ', () => {
  it('คีย์เวิร์ดที่ชี้ไปกิจกรรม พาไปเล่นเลย', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)
    expect(play).toHaveBeenCalledOnce()
    expect(out?.message).toMatchObject({ type: 'flex' })
  })

  it('คีย์เวิร์ดที่ชี้ไปการ์ด ตอบด้วยการ์ดนั้น', async () => {
    const live = campaign({ keywordTargets: { k1: { cardId: 'card-greeting' } } })
    const { ports: p, play } = ports({}, live)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'ยินดีต้อนรับ' })
    expect(play).not.toHaveBeenCalled()
  })

  it('ไม่ตรงคีย์เวิร์ดไหน ตอบด้วยการ์ดตั้งต้นของบัญชี', async () => {
    const { ports: p, logEvent } = ports()
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'สวัสดี' } }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'พิมพ์ว่า เล่น' })
    expect(logEvent.mock.calls[0][0]).toMatchObject({ eventType: 'text_unmatched' })
  })

  it('ไม่มีการ์ดตั้งต้น ก็ยังตอบ ไม่เงียบ', async () => {
    const { ports: p } = ports({}, campaign({ defaultCardId: null }))
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'สวัสดี' } }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.systemDown })
  })
})

describe('ผูกเมนูตัวเข้าตอนพิมพ์คีย์เวิร์ดครั้งแรก (BR-78 ฝั่งผู้เล่น)', () => {
  const live = campaign({ entryRichMenuLineId: 'line-rm-entry' })

  it('คีย์เวิร์ดที่ชี้ไปกิจกรรม ยังไม่เคยผูก → ติดคำสั่งผูกเมนูมาด้วย', async () => {
    const hasRichMenuLinked = vi.fn(async () => false)
    const { ports: p } = ports({ hasRichMenuLinked }, live)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)

    expect(hasRichMenuLinked).toHaveBeenCalledWith('p-1')
    expect(out?.linkRichMenu).toEqual({ participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' })
  })

  it('คีย์เวิร์ดที่ชี้ไปการ์ด ยังไม่เคยผูก → ติดคำสั่งผูกเมนูมาด้วยเหมือนกัน', async () => {
    const live2 = campaign({ entryRichMenuLineId: 'line-rm-entry', keywordTargets: { k1: { cardId: 'card-greeting' } } })
    const { ports: p } = ports({ hasRichMenuLinked: async () => false }, live2)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)

    expect(out?.linkRichMenu).toEqual({ participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' })
  })

  it('เคยผูกไปแล้ว → ไม่ติดคำสั่งผูกซ้ำ', async () => {
    const { ports: p } = ports({ hasRichMenuLinked: async () => true }, live)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)

    expect(out?.linkRichMenu).toBeUndefined()
  })

  it('แคมเปญนี้ไม่มีเมนูตัวเข้า (entryRichMenuLineId เป็น null) → ไม่ติดคำสั่งผูก และไม่เช็คด้วยซ้ำ', async () => {
    const { ports: p, hasRichMenuLinked } = ports({}, campaign({ entryRichMenuLineId: null }))
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)

    expect(hasRichMenuLinked).not.toHaveBeenCalled()
    expect(out?.linkRichMenu).toBeUndefined()
  })

  it('ข้อความไม่ตรงคีย์เวิร์ดไหนเลย → ไม่ติดคำสั่งผูก แม้ยังไม่เคยผูกและแคมเปญมีเมนูตัวเข้าก็ตาม', async () => {
    const hasRichMenuLinked = vi.fn(async () => false)
    const { ports: p } = ports({ hasRichMenuLinked }, live)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'ไม่มีคำนี้ในกติกา' } }), p)

    expect(hasRichMenuLinked).not.toHaveBeenCalled()
    expect(out?.linkRichMenu).toBeUndefined()
  })
})

describe('แอดเป็นเพื่อน', () => {
  it('มีกิจกรรมทักทาย พาไปเล่นกิจกรรมนั้น', async () => {
    const live = campaign()
    live.activities.push({ ...live.activities[0], id: 'act-hello', code: 'hello', trigger: 'follow' })
    const { ports: p, play } = ports({}, live)
    const out = await run(userEvent({ type: 'follow' }), p)
    expect(play).toHaveBeenCalledOnce()
    expect(play.mock.calls[0][0].activity.id).toBe('act-hello')
    expect(out?.message).toMatchObject({ type: 'flex' })
  })

  it('ไม่มีกิจกรรมทักทาย ใช้การ์ดทักทายของบัญชี', async () => {
    const { ports: p, play } = ports()
    const out = await run(userEvent({ type: 'follow' }), p)
    expect(out?.message).toEqual({ type: 'text', text: 'ยินดีต้อนรับ' })
    expect(play).not.toHaveBeenCalled()
  })

  it('แอดเป็นเพื่อน ยังไม่เคยผูกเมนู แคมเปญมีเมนูตัวเข้า → ผูกให้ทันทีก่อนพิมพ์อะไรเลยด้วยซ้ำ (ไม่มีกิจกรรมทักทาย)', async () => {
    const hasRichMenuLinked = vi.fn(async () => false)
    const { ports: p } = ports({ hasRichMenuLinked }, campaign({ entryRichMenuLineId: 'line-rm-entry' }))
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(hasRichMenuLinked).toHaveBeenCalledWith('p-1')
    expect(out?.linkRichMenu).toEqual({ participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' })
  })

  it('แอดเป็นเพื่อน ยังไม่เคยผูกเมนู มีกิจกรรมทักทายด้วย → ผูกให้เหมือนกัน (ไม่ว่าจะตอบด้วยกิจกรรมหรือการ์ด)', async () => {
    const live = campaign({ entryRichMenuLineId: 'line-rm-entry' })
    live.activities.push({ ...live.activities[0], id: 'act-hello', code: 'hello', trigger: 'follow' })
    const { ports: p } = ports({ hasRichMenuLinked: async () => false }, live)
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(out?.linkRichMenu).toEqual({ participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' })
  })

  it('เคยผูกเมนูไปแล้ว → แอดซ้ำ (unfollow แล้ว follow ใหม่) ไม่ติดคำสั่งผูกซ้ำ', async () => {
    const { ports: p } = ports({ hasRichMenuLinked: async () => true }, campaign({ entryRichMenuLineId: 'line-rm-entry' }))
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(out?.linkRichMenu).toBeUndefined()
  })

  it('แคมเปญนี้ไม่มีเมนูตัวเข้า → ไม่ติดคำสั่งผูก และไม่เช็คด้วยซ้ำ', async () => {
    const hasRichMenuLinked = vi.fn(async () => false)
    const { ports: p } = ports({ hasRichMenuLinked }, campaign({ entryRichMenuLineId: null }))
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(hasRichMenuLinked).not.toHaveBeenCalled()
    expect(out?.linkRichMenu).toBeUndefined()
  })

  it('ปิดการทักทายไว้ ไม่ตอบ ปล่อยให้ OA Manager ทำงาน', async () => {
    const { ports: p } = ports({}, campaign({ greetingEnabled: false }))
    expect(await run(userEvent({ type: 'follow' }), p)).toBeNull()
  })

  it('เปิดการทักทายไว้ แคมเปญมีเมนูตัวเข้า → ได้ทั้งข้อความทักทายและคำสั่งผูกเมนูมาด้วยกัน (พฤติกรรมเดิมต้องไม่เปลี่ยน)', async () => {
    const { ports: p } = ports(
      { hasRichMenuLinked: async () => false },
      campaign({ greetingEnabled: true, entryRichMenuLineId: 'line-rm-entry' }),
    )
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(out).toMatchObject({
      replyToken: 'rt-1',
      message: { type: 'text', text: 'ยินดีต้อนรับ' },
      linkRichMenu: { participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' },
    })
  })
})

describe('แอดเป็นเพื่อน ปิดการทักทายไว้ แต่การผูกเมนูตัวเข้าต้องยังทำงาน (แยกอิสระจากข้อความทักทาย)', () => {
  it('มีเมนูตัวเข้า ยังไม่เคยผูก → ได้ผลลัพธ์ผูกเมนูอย่างเดียว ไม่มี message/replyToken', async () => {
    const hasRichMenuLinked = vi.fn(async () => false)
    const { ports: p, logEvent } = ports(
      { hasRichMenuLinked },
      campaign({ greetingEnabled: false, entryRichMenuLineId: 'line-rm-entry' }),
    )
    const out = await run(userEvent({ type: 'follow' }), p)

    expect(hasRichMenuLinked).toHaveBeenCalledWith('p-1')
    expect(out).toEqual({
      linkRichMenu: { participantId: 'p-1', lineUid: 'U1', richMenuId: 'line-rm-entry' },
    })
    expect(out && 'message' in out).toBe(false)
    // ไม่มีการตอบเกิดขึ้นจริง จึงไม่มีอะไรให้บันทึกเป็น event
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('ไม่มีเมนูตัวเข้า (entryRichMenuLineId เป็น null) → ไม่ตอบอะไรเลย', async () => {
    const { ports: p } = ports({}, campaign({ greetingEnabled: false, entryRichMenuLineId: null }))
    expect(await run(userEvent({ type: 'follow' }), p)).toBeNull()
  })

  it('เคยผูกเมนูไปแล้ว (hasRichMenuLinked คืนจริง) → ไม่ผูกซ้ำ ไม่ตอบอะไรเลย', async () => {
    const { ports: p } = ports(
      { hasRichMenuLinked: async () => true },
      campaign({ greetingEnabled: false, entryRichMenuLineId: 'line-rm-entry' }),
    )
    expect(await run(userEvent({ type: 'follow' }), p)).toBeNull()
  })
})

describe('กรณีที่ต้องไม่ตอบ', () => {
  it('ข้อความจากแชทกลุ่ม', async () => {
    const { ports: p } = ports()
    const out = await run(
      { type: 'message', replyToken: 'rt', source: { type: 'group', userId: 'U1' }, message: { type: 'text', text: 'เล่น' } },
      p,
    )
    expect(out).toBeNull()
  })

  it('event ที่ไม่มี reply token', async () => {
    const { ports: p } = ports()
    expect(await run({ type: 'unfollow' }, p)).toBeNull()
  })

  it('ไม่มีแคมเปญเปิดอยู่บนบัญชีนี้ ยังตอบว่าจบแล้ว ไม่เงียบ', async () => {
    const { ports: p } = ports({}, null)
    const out = await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)
    expect(out?.message).toEqual({ type: 'text', text: FALLBACK.campaignOver })
  })
})

describe('การบันทึกร่องรอย', () => {
  it('ทุกคำตอบมี duration_ms', async () => {
    const { ports: p, logEvent } = ports()
    await run(userEvent({ type: 'message', message: { type: 'text', text: 'เล่น' } }), p)
    expect(logEvent.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0)
    expect(logEvent.mock.calls[0][0].configVersionId).toBe('cv-1')
  })
})
