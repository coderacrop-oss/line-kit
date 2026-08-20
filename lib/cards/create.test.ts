import { describe, expect, it } from 'vitest'
import {
  CARD_TEMPLATE_GROUPS, OPEN_SEND_TYPES, SEND_TYPE_OPTIONS,
  asSendType, blocksFromTemplate, hasSampleText, isCardCode, templateGroupOf,
  type TemplateBlock,
} from './create'
import { CARD_RENDER_TYPES } from '../db/cards'

const template: TemplateBlock[] = [
  { blockType: 'image', content: '', options: { placement: 'full_top' } },
  { blockType: 'title', content: 'หัวข้อตัวอย่าง' },
  { blockType: 'button', content: 'กดเลย', options: { action: { type: 'postback' } } },
]

describe('blocksFromTemplate', () => {
  it('คัดลอกบล็อกมาครบและรักษาลำดับ', () => {
    const blocks = blocksFromTemplate(template, 'flex_bubble')
    expect(blocks.map((b) => b.blockType)).toEqual(['image', 'title', 'button'])
    expect(blocks.map((b) => b.sortOrder)).toEqual([0, 1, 2])
  })

  it('ข้อความล้วนตัดบล็อกที่ไม่มีข้อความออก', () => {
    const blocks = blocksFromTemplate(template, 'text')
    expect(blocks.map((b) => b.blockType)).toEqual(['title', 'button'])
  })

  it('ทุกเทมเพลตใช้ได้กับทุกชนิด ไม่มีการคืนรายการว่าง', () => {
    for (const type of OPEN_SEND_TYPES) {
      expect(blocksFromTemplate(template, type).length).toBeGreaterThan(0)
    }
  })

  it('ตัดออกแล้วเลขลำดับไล่ใหม่จากศูนย์ ไม่เหลือรู', () => {
    // รูใน sort_order คือที่ที่บล็อกที่แทรกทีหลังไปตกลงไป แล้วลำดับที่คนตั้งค่าเห็น
    // จะไม่ใช่ลำดับที่ผู้เล่นได้รับ (BR-92)
    const blocks = blocksFromTemplate(template, 'text')
    expect(blocks.map((b) => b.sortOrder)).toEqual([0, 1])
  })

  it('การ์ดปัดได้ยังเก็บบล็อกภาพไว้ เพราะมันวาดภาพได้', () => {
    expect(blocksFromTemplate(template, 'flex_carousel').map((b) => b.blockType))
      .toEqual(['image', 'title', 'button'])
  })

  it('ข้อความล้วนตัดบล็อกที่ชนิดไม่พาข้อความออกไปด้วย', () => {
    // progress_bar มี content ได้ แต่ toPlainText ไม่เคยอ่านมัน · เก็บไว้จะได้บล็อก
    // ที่คนตั้งค่าเห็นบนจอแต่ผู้เล่นไม่มีวันเห็น
    const withBar: TemplateBlock[] = [
      { blockType: 'progress_bar', content: 'สะสมแล้ว', options: { counter: 'stamp', target: 5 } },
      { blockType: 'body', content: 'อีก 2 ดวงได้ของรางวัล' },
    ]
    expect(blocksFromTemplate(withBar, 'text').map((b) => b.blockType)).toEqual(['body'])
  })

  it('ข้อความล้วนตัดบล็อกที่มีแต่ช่องว่างออก', () => {
    const blank: TemplateBlock[] = [
      { blockType: 'body', content: '   ' },
      { blockType: 'title', content: 'มีจริง' },
    ]
    expect(blocksFromTemplate(blank, 'text').map((b) => b.blockType)).toEqual(['title'])
  })

  it('ไม่แก้ของที่ส่งเข้ามา', () => {
    const input: TemplateBlock[] = [{ blockType: 'title', content: 'ก' }]
    blocksFromTemplate(input, 'text')
    expect(input).toEqual([{ blockType: 'title', content: 'ก' }])
  })

  it('บล็อกที่ไม่มี content หรือ options กลายเป็น null ไม่ใช่ undefined', () => {
    // postgres.js เขียน undefined ลงคอลัมน์ไม่ได้ · null คือ "ยังไม่มีค่า" ที่ DB รู้จัก
    const [block] = blocksFromTemplate([{ blockType: 'divider' }], 'flex_bubble')
    expect(block.content).toBeNull()
    expect(block.options).toBeNull()
  })
})

describe('hasSampleText · BR-37', () => {
  it('บล็อกที่มีข้อความมาจากเทมเพลต แปลว่ายังเป็นข้อความตัวอย่าง', () => {
    expect(hasSampleText(blocksFromTemplate(template, 'flex_bubble'))).toBe(true)
  })

  it('ไม่มีบล็อกไหนมีข้อความเลย ก็ไม่มีข้อความตัวอย่างให้หลุดขึ้นบัญชีจริง', () => {
    const silent: TemplateBlock[] = [
      { blockType: 'image', content: '' },
      { blockType: 'divider' },
    ]
    expect(hasSampleText(blocksFromTemplate(silent, 'flex_bubble'))).toBe(false)
  })

  it('ช่องว่างล้วนไม่นับว่าเป็นข้อความ', () => {
    expect(hasSampleText(blocksFromTemplate([{ blockType: 'body', content: ' ' }], 'flex_bubble')))
      .toBe(false)
  })
})

/**
 * แกนที่หนึ่ง · ห้าชนิดใน CHECK และสไลซ์นี้เปิดครบทั้งห้า (imagemap_video เปิดแล้ว — เฟส 2)
 */
describe('SEND_TYPE_OPTIONS', () => {
  it('มีครบทั้งห้าค่าที่ CHECK ของ card.render_as ยอมรับ ไม่ขาดไม่เกิน', () => {
    // ลำดับบนจอไม่เท่ากับลำดับใน CHECK · ที่ต้องตรงกันคือชุดของค่า ไม่ใช่ลำดับ
    expect([...SEND_TYPE_OPTIONS.map((o) => o.value)].sort())
      .toEqual([...CARD_RENDER_TYPES].sort())
  })

  it('เปิดครบทั้งห้าตัว ไม่มีตัวไหนถูกปิดค้างไว้', () => {
    expect(SEND_TYPE_OPTIONS.every((o) => o.open)).toBe(true)
    expect(SEND_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual([...CARD_RENDER_TYPES].sort())
  })

  it('ไม่มีตัวไหนมีเหตุผลค้างไว้ให้จอเผลอไปวาด', () => {
    for (const option of SEND_TYPE_OPTIONS) {
      expect(option.blockedReason).toBeUndefined()
    }
  })

  it('OPEN_SEND_TYPES คือรายการเดียวกับที่ตารางบอกว่าเปิด ไม่ใช่รายการที่สอง', () => {
    expect([...OPEN_SEND_TYPES])
      .toEqual(SEND_TYPE_OPTIONS.filter((o) => o.open).map((o) => o.value))
  })
})

describe('asSendType', () => {
  it('รับทุกชนิดที่สไลซ์นี้เปิด', () => {
    expect(asSendType('flex_bubble')).toBe('flex_bubble')
    expect(asSendType('text')).toBe('text')
    expect(asSendType('imagemap')).toBe('imagemap')
    expect(asSendType('imagemap_video')).toBe('imagemap_video')
  })

  it('ค่าที่ไม่รู้จักและค่าว่างคืน null', () => {
    expect(asSendType('flex')).toBeNull()
    expect(asSendType('')).toBeNull()
    expect(asSendType(undefined)).toBeNull()
  })
})

/**
 * แกนที่สอง · เทมเพลตแบ่งสองกลุ่ม และ "เริ่มจากศูนย์" อยู่ในชุดเดียวกันเสมอ (BR-63)
 */
describe('templateGroupOf', () => {
  it('รหัสขึ้นต้น line_ คือกลุ่มที่ลอกจาก LINE', () => {
    expect(templateGroupOf('line_buttons')).toBe('from_line')
  })

  it('รหัสขึ้นต้น beyond_ คือกลุ่มที่ LINE ไม่มี', () => {
    expect(templateGroupOf('beyond_stamp')).toBe('beyond_line')
  })

  it('เริ่มจากศูนย์เป็นกลุ่มของตัวเอง แต่ยังอยู่ในชุดเดียวกัน', () => {
    expect(templateGroupOf('blank')).toBe('blank')
    expect(CARD_TEMPLATE_GROUPS.map((g) => g.key)).toContain('blank')
  })

  it('รหัสที่ไม่เข้ากลุ่มไหนไม่หายไป · ตกไปอยู่กลุ่มที่บอกว่ายังไม่ได้จัด', () => {
    // เทมเพลตที่หลุดกลุ่มแล้วหายจากจอ คือของที่มีอยู่ในฐานข้อมูลแต่ไม่มีใครเลือกได้
    // และไม่มีอะไรบนจอบอกว่ามันหายไป
    expect(templateGroupOf('seasonal_2027')).toBe('other')
    expect(CARD_TEMPLATE_GROUPS.map((g) => g.key)).toContain('other')
  })

  it('ทุกกลุ่มมีชื่อไทยให้จอวาด และไม่มีกลุ่มซ้ำ', () => {
    for (const group of CARD_TEMPLATE_GROUPS) expect(group.label.length).toBeGreaterThan(0)
    expect(new Set(CARD_TEMPLATE_GROUPS.map((g) => g.key)).size).toBe(CARD_TEMPLATE_GROUPS.length)
  })

  it('สองกลุ่มที่แผนสั่งมีอยู่จริงและเรียงก่อนกลุ่มที่ยังไม่ได้จัด', () => {
    const keys = CARD_TEMPLATE_GROUPS.map((g) => g.key)
    expect(keys.indexOf('from_line')).toBeLessThan(keys.indexOf('other'))
    expect(keys.indexOf('beyond_line')).toBeLessThan(keys.indexOf('other'))
  })
})

describe('isCardCode', () => {
  it('รับตัวพิมพ์เล็ก ตัวเลข และขีดล่าง', () => {
    expect(isCardCode('win_2')).toBe(true)
  })

  it('ปฏิเสธช่องว่าง ตัวพิมพ์ใหญ่ และค่าว่าง', () => {
    expect(isCardCode('win 2')).toBe(false)
    expect(isCardCode('Win')).toBe(false)
    expect(isCardCode('')).toBe(false)
  })

  it('ปฏิเสธรหัสที่ยาวเกินกว่าที่คอลัมน์ตั้งใจไว้', () => {
    expect(isCardCode('a'.repeat(40))).toBe(true)
    expect(isCardCode('a'.repeat(41))).toBe(false)
  })
})
