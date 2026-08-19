import { describe, expect, it } from 'vitest'
import {
  TIER_ORDER, describeLastUsed, describePublished, groupByTier, maskedKey,
  summarizeChannel, type ChannelRow, type ChannelSummary,
} from './channels'

const row = (patch: Partial<ChannelRow> = {}): ChannelRow => ({
  id: 'ch1',
  name: 'OA ทดสอบ',
  channel_type: 'test',
  line_channel_id: null,
  line_bot_user_id: null,
  token_last4: 'wxyz',
  key_version: 1,
  last_used_at: null,
  existing_keywords: [],
  live_campaign_name: null,
  published_version: null,
  ...patch,
})

const NOW = new Date('2026-08-14T04:00:00Z') // 11:00 ตามเวลาไทย

describe('summarizeChannel', () => {
  it('แปลงชื่อคอลัมน์เป็นชื่อที่หน้าจอใช้', () => {
    expect(summarizeChannel(row())).toMatchObject({
      id: 'ch1', name: 'OA ทดสอบ', channelType: 'test', tokenLast4: 'wxyz',
    })
  })

  /**
   * ค่าที่ออกจากชั้นนี้ ไม่มีช่องไหนเก็บกุญแจได้เลย (BR-16)
   *
   * The screen can only show what this returns, so the guarantee is cheapest to
   * make here: there is no field for a token, encrypted or not, and no query
   * that could fill one.
   */
  it('ไม่มีช่องไหนในผลลัพธ์ที่ชื่อเหมือนจะเก็บกุญแจ', () => {
    const keys = Object.keys(summarizeChannel(row()))
    expect(keys.filter((k) => /token|secret|cipher|encrypted/i.test(k))).toEqual(['tokenLast4'])
  })

  it('บัญชีที่ยังไม่มีกุญแจ คืน null ไม่ใช่สตริงว่าง', () => {
    expect(summarizeChannel(row({ channel_type: 'preview', token_last4: null })).tokenLast4)
      .toBeNull()
  })

  it('คีย์เวิร์ดเดิมที่ยังไม่ได้กรอก คืนอาเรย์ว่าง ไม่ใช่ null', () => {
    expect(summarizeChannel(row({ existing_keywords: null as never })).existingKeywords)
      .toEqual([])
  })

  // BR-68 · หนึ่งบัญชีรันแคมเปญทีละหนึ่ง · แถวต้องบอกว่าตอนนี้ตัวไหนอยู่
  it('บัญชีที่มีแคมเปญเปิดอยู่ บอกชื่อแคมเปญกับรุ่นที่ส่งขึ้น', () => {
    const live = summarizeChannel(row({ live_campaign_name: 'ครบเจ็ดวัน', published_version: 3 }))
    expect(live.liveCampaignName).toBe('ครบเจ็ดวัน')
    expect(live.publishedVersion).toBe(3)
  })

  it('บัญชีที่ยังไม่มีแคมเปญไหนเปิดอยู่ คืน null ทั้งคู่', () => {
    const idle = summarizeChannel(row())
    expect(idle.liveCampaignName).toBeNull()
    expect(idle.publishedVersion).toBeNull()
  })

  // แก้ได้เฉพาะชั้นที่มีกุญแจ · preview ไม่มีกุญแจให้แก้ และ CHECK ห้ามใส่ไว้ด้วย
  it('บัญชีทดลองเล่นในระบบแก้ไม่ได้ ชั้นอื่นแก้ได้', () => {
    expect(summarizeChannel(row({ channel_type: 'preview' })).isEditable).toBe(false)
    expect(summarizeChannel(row({ channel_type: 'test' })).isEditable).toBe(true)
    expect(summarizeChannel(row({ channel_type: 'production' })).isEditable).toBe(true)
  })

  /**
   * ค่านี้คือสิ่งเดียวที่ webhook ใช้จับคู่ข้อความที่เข้ามากับแคมเปญ — ไม่มีมันแล้ว
   * ทุกข้อความจากไลน์จริงจะหาแคมเปญไม่เจอเสมอ ไม่ว่ากุญแจจะถูกหรือผิด
   */
  it('บัญชีที่ยังไม่ได้กรอก Channel ID คืน null', () => {
    expect(summarizeChannel(row()).lineChannelId).toBeNull()
  })

  it('บัญชีที่กรอก Channel ID แล้ว ส่งค่านั้นออกมาตรงๆ', () => {
    expect(summarizeChannel(row({ line_channel_id: '1657123456' })).lineChannelId)
      .toBe('1657123456')
  })

  /**
   * destination ที่ LINE ส่งมาในทุก webhook — คนละค่ากับ Channel ID ข้างบน
   * ไม่มีมันแล้ว webhook หาไม่เจอว่า event เป็นของบัญชีไหนเลย ไม่ว่ากุญแจจะถูกหรือผิด
   */
  it('บัญชีที่ยังไม่ได้กรอก userId ของบอท คืน null', () => {
    expect(summarizeChannel(row()).lineBotUserId).toBeNull()
  })

  it('บัญชีที่กรอก userId ของบอทแล้ว ส่งค่านั้นออกมาตรงๆ', () => {
    expect(summarizeChannel(row({ line_bot_user_id: 'U1234567890abcdef' })).lineBotUserId)
      .toBe('U1234567890abcdef')
  })
})

/**
 * "ใช้ล่าสุด" ต้องอ่านแล้วรู้ทันทีว่านานแค่ไหน
 *
 * A timestamp answers "when" and leaves "how long ago" to the reader, which is
 * the actual question on this screen: a production OA nobody has spoken through
 * for a month is either finished or broken, and a date does not say which.
 */
describe('describeLastUsed', () => {
  it('ยังไม่เคยใช้ บอกตรงๆ ไม่ใช่ขีดกลาง', () => {
    expect(describeLastUsed(null, NOW)).toBe('ยังไม่เคยใช้')
  })

  it('วันนี้ ตามเวลาไทย', () => {
    expect(describeLastUsed(new Date('2026-08-14T01:00:00Z'), NOW)).toBe('วันนี้')
  })

  // เที่ยงคืนของไทยคือ 17:00Z ของวันก่อนหน้า · เวลา 18:00Z วันที่ 13 จึงเป็น "วันนี้"
  it('นับวันตามเขตเวลาไทย ไม่ใช่ตาม UTC (BR-04)', () => {
    expect(describeLastUsed(new Date('2026-08-13T18:00:00Z'), NOW)).toBe('วันนี้')
    expect(describeLastUsed(new Date('2026-08-13T16:00:00Z'), NOW)).toBe('เมื่อวาน')
  })

  it('เมื่อวาน', () => {
    expect(describeLastUsed(new Date('2026-08-13T04:00:00Z'), NOW)).toBe('เมื่อวาน')
  })

  it('ไม่กี่วันก่อน บอกเป็นจำนวนวัน', () => {
    expect(describeLastUsed(new Date('2026-08-09T04:00:00Z'), NOW)).toBe('5 วันก่อน')
  })

  it('นานกว่าหนึ่งเดือน บอกเป็นวันที่ เพราะ "45 วันก่อน" ไม่ได้ช่วยให้นึกออก', () => {
    expect(describeLastUsed(new Date('2026-06-01T04:00:00Z'), NOW)).toBe('2026-06-01')
  })

  it('เส้นแบ่งอยู่ที่ 30 วันพอดี', () => {
    expect(describeLastUsed(new Date('2026-07-15T04:00:00Z'), NOW)).toBe('30 วันก่อน')
    expect(describeLastUsed(new Date('2026-07-14T04:00:00Z'), NOW)).toBe('2026-07-14')
  })

  // นาฬิกาของเซิร์ฟเวอร์เดินคนละทางกับของฐานข้อมูลได้ · อย่าโชว์ "-2 วันก่อน"
  it('เวลาที่ล้ำหน้าปัจจุบัน ยังอ่านว่าวันนี้ ไม่ใช่จำนวนวันติดลบ', () => {
    expect(describeLastUsed(new Date('2026-08-15T04:00:00Z'), NOW)).toBe('วันนี้')
  })
})

describe('maskedKey', () => {
  it('แสดงเป็นจุดสี่จุดแล้วตามด้วยสี่ตัวท้าย', () => {
    expect(maskedKey('wxyz')).toBe('••••wxyz')
  })

  it('ยังไม่มีกุญแจ บอกว่าไม่มี ไม่ใช่จุดเปล่าๆ', () => {
    expect(maskedKey(null)).toBe('ยังไม่มีกุญแจ')
  })

  // ถ้าคอลัมน์มีค่าเกินสี่ตัวเพราะแถวเก่า จอก็ยังต้องไม่โชว์เกินสี่ (BR-16)
  it('ต่อให้คอลัมน์เก็บมาเกินสี่ตัว ก็ยังแสดงแค่สี่', () => {
    expect(maskedKey('abcdefghij')).toBe('••••ghij')
  })
})

/**
 * บัญชีนี้กำลังรันแคมเปญไหนอยู่ (BR-68)
 *
 * The one question worth answering before somebody publishes onto this channel,
 * because doing so takes the campaign that is on it down without asking.
 */
describe('describePublished', () => {
  const summary = (patch: Partial<ChannelRow>) => summarizeChannel(row(patch))

  it('มีแคมเปญเปิดอยู่ บอกว่าส่งขึ้นแล้วพร้อมรุ่น', () => {
    expect(describePublished(summary({ live_campaign_name: 'ก', published_version: 4 })))
      .toEqual({ label: 'ส่งขึ้นแล้ว · v4', isLive: true })
  })

  it('ยังไม่มีแคมเปญไหนเปิดอยู่ บอกว่ายังไม่ส่งขึ้น', () => {
    expect(describePublished(summary({}))).toEqual({ label: 'ยังไม่ส่งขึ้น', isLive: false })
  })

  // รุ่นที่ค้างอยู่จากแคมเปญที่ถอนไปแล้ว ไม่ใช่รุ่นที่กำลังทำงาน
  it('มีรุ่นเก่าค้างแต่ไม่มีแคมเปญเปิดอยู่ ยังนับว่ายังไม่ส่งขึ้น', () => {
    expect(describePublished(summary({ published_version: 9 })))
      .toEqual({ label: 'ยังไม่ส่งขึ้น', isLive: false })
  })

  it('เปิดอยู่แต่ยังไม่มีรุ่นบันทึกไว้ ไม่โชว์ v ว่างๆ', () => {
    expect(describePublished(summary({ live_campaign_name: 'ก' })))
      .toEqual({ label: 'ส่งขึ้นแล้ว', isLive: true })
  })
})

describe('groupByTier', () => {
  const summary = (patch: Partial<ChannelRow>): ChannelSummary =>
    summarizeChannel(row(patch))

  it('สามชั้นเรียงจากปลอดภัยที่สุดไปเสี่ยงที่สุด', () => {
    expect(groupByTier([]).map((g) => g.type)).toEqual(['preview', 'test', 'production'])
    expect(TIER_ORDER).toEqual(['preview', 'test', 'production'])
  })

  // ชั้นที่ว่างยังต้องอยู่ · เมนูที่มีแต่ชั้นที่มีของ ไม่บอกว่ายังขาดชั้นไหน
  it('ชั้นที่ไม่มีบัญชีเลยก็ยังอยู่ เป็นกลุ่มว่าง', () => {
    const groups = groupByTier([summary({ id: 'a', channel_type: 'test' })])
    expect(groups.map((g) => g.channels.length)).toEqual([0, 1, 0])
    expect(groups.map((g) => g.type)).toEqual(['preview', 'test', 'production'])
  })

  it('แต่ละบัญชีอยู่ในชั้นของตัวเองเท่านั้น', () => {
    const groups = groupByTier([
      summary({ id: 'p', channel_type: 'preview' }),
      summary({ id: 't', channel_type: 'test' }),
      summary({ id: 'q', channel_type: 'production' }),
      summary({ id: 't2', channel_type: 'test' }),
    ])
    expect(groups.map((g) => g.channels.map((c) => c.id)))
      .toEqual([['p'], ['t', 't2'], ['q']])
  })

})
