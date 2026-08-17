import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BLOCK_TYPE_NAME,
  BUTTON_ACTION_OPTIONS,
  CONTENT_EDITOR_TYPES,
  DRAWABLE_BLOCK_TYPES,
  MAX_BLOCKS,
  MAX_BUTTONS,
  SHOW_WHEN_FIELDS,
  SHOW_WHEN_NAME,
  SHOW_WHEN_TYPES,
  asShowWhenType,
  buildButtonAction,
  buildCondition,
  canAddBlock,
  canRoleEditBlock,
  countAgainstLimits,
  isDrawableBlockType,
  parseBlockSave,
  readButtonAction,
  reorder,
  supportsContentSource,
  validateConditionValues,
} from './blocks'
import type { CardBlock } from '../render/groups'

let n = 0
const b = (type: CardBlock['blockType']): CardBlock => ({
  id: `b${n++}`, blockType: type, sortOrder: n, content: null, showWhen: null, options: null,
})

describe('reorder', () => {
  it('ย้ายขึ้นแล้ว sortOrder ไล่ใหม่ต่อเนื่องจากศูนย์', () => {
    const out = reorder([b('title'), b('body'), b('button')], 2, 0)
    expect(out.map((x) => x.blockType)).toEqual(['button', 'title', 'body'])
    expect(out.map((x) => x.sortOrder)).toEqual([0, 1, 2])
  })

  it('ย้ายไปที่เดิมไม่เปลี่ยนอะไร', () => {
    const input = [b('title'), b('body')]
    expect(reorder(input, 1, 1).map((x) => x.blockType)).toEqual(['title', 'body'])
  })

  it('ไม่แก้ array เดิม', () => {
    const input = [b('title'), b('body')]
    reorder(input, 0, 1)
    expect(input[0].blockType).toBe('title')
  })

  it('ย้ายลงก็ไล่เลขใหม่เหมือนกัน', () => {
    const out = reorder([b('title'), b('body'), b('button')], 0, 2)
    expect(out.map((x) => x.blockType)).toEqual(['body', 'button', 'title'])
    expect(out.map((x) => x.sortOrder)).toEqual([0, 1, 2])
  })
})

describe('countAgainstLimits', () => {
  it('นับบล็อกและปุ่มแยกกัน', () => {
    const out = countAgainstLimits([b('title'), b('button'), b('button')])
    expect(out).toMatchObject({ blocks: 3, buttons: 2, blocksLeft: 7, buttonsLeft: 1 })
  })

  it('ล้นไม่ติดลบ', () => {
    const full = Array.from({ length: 12 }, () => b('button'))
    const out = countAgainstLimits(full)
    expect(out.blocksLeft).toBe(0)
    expect(out.buttonsLeft).toBe(0)
  })
})

describe('canAddBlock', () => {
  it('ครบ 10 บล็อกแล้วเพิ่มไม่ได้ และบอกเพดาน', () => {
    const full = Array.from({ length: MAX_BLOCKS }, () => b('body'))
    const out = canAddBlock(full, 'body')
    if (out.ok) throw new Error('unreachable')
    expect(out.reason).toContain(String(MAX_BLOCKS))
  })

  it('ครบ 3 ปุ่มแล้วเพิ่มปุ่มไม่ได้ แต่เพิ่มบล็อกอื่นได้', () => {
    const blocks = [b('button'), b('button'), b('button')]
    expect(canAddBlock(blocks, 'button').ok).toBe(false)
    expect(canAddBlock(blocks, 'body').ok).toBe(true)
  })

  it('ยังไม่เต็มก็เพิ่มได้', () => {
    expect(canAddBlock([b('title')], 'body').ok).toBe(true)
  })

  it('เพิ่มบล็อกที่ 10 พอดีได้ · เพิ่มบล็อกที่ 11 ไม่ได้', () => {
    const nine = Array.from({ length: MAX_BLOCKS - 1 }, () => b('body'))
    expect(canAddBlock(nine, 'body').ok).toBe(true)
    const ten = Array.from({ length: MAX_BLOCKS }, () => b('body'))
    expect(canAddBlock(ten, 'body').ok).toBe(false)
  })
})

describe('DRAWABLE_BLOCK_TYPES · ต้องตรงกับ lib/render/flex.ts จริง ไม่ใช่ตามที่มีใครจำไว้', () => {
  it('มีแปดชนิด ตัวชื่อครบตาม BLOCK_TYPE_NAME', () => {
    expect(DRAWABLE_BLOCK_TYPES.length).toBe(8)
    for (const type of DRAWABLE_BLOCK_TYPES) {
      expect(BLOCK_TYPE_NAME[type]).toBeTruthy()
    }
  })

  it('lib/render/flex.ts มี case ครบทุกตัวใน DRAWABLE_BLOCK_TYPES และไม่มี case เกิน', () => {
    const source = readFileSync(new URL('../render/flex.ts', import.meta.url), 'utf8')
    const caseLines = [...source.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1])
    // title · body · caption ใช้ case ร่วมกันหนึ่งกิ่ง (textComponent) — ยังนับเป็นสามชนิดที่วาดได้
    expect(new Set(caseLines)).toEqual(new Set(DRAWABLE_BLOCK_TYPES))
  })

  it('CHECK ของ card_block.block_type มี 14 ชนิด · 8 วาดได้ 6 วาดไม่ได้', () => {
    const migration = readFileSync(
      new URL('../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8',
    )
    const match = migration.match(/block_type\s+TEXT NOT NULL CHECK \(block_type IN \(([^)]+)\)\)/)
    if (!match) throw new Error('ไม่พบ CHECK ของ card_block.block_type ใน migration')
    const allTypes = match[1].split(',').map((raw) => raw.trim().replace(/'/g, ''))

    expect(allTypes.length).toBe(14)
    const undrawable = allTypes.filter((type) => !isDrawableBlockType(type))
    expect(new Set(undrawable)).toEqual(new Set([
      'status_row', 'stamp_grid', 'video', 'stamp_card', 'progress', 'reward_button',
    ]))
  })

  it('isDrawableBlockType ปฏิเสธชนิดที่วาดไม่ได้', () => {
    expect(isDrawableBlockType('stamp_grid')).toBe(false)
    expect(isDrawableBlockType('body')).toBe(true)
    expect(isDrawableBlockType('not_a_real_type')).toBe(false)
  })
})

describe('supportsContentSource · สวิตช์คงที่/เลือกจากค่าใช้ได้กับบล็อกที่มีเนื้อหาเป็นข้อความหรือ URL เท่านั้น', () => {
  it('image · title · body · caption · button ใช้ได้', () => {
    for (const type of ['image', 'title', 'body', 'caption', 'button'] as const) {
      expect(supportsContentSource(type)).toBe(true)
    }
  })

  it('divider · spacer · progress_bar ใช้ไม่ได้ เพราะไม่มีเนื้อหาให้สลับ', () => {
    for (const type of ['divider', 'spacer', 'progress_bar'] as const) {
      expect(supportsContentSource(type)).toBe(false)
    }
  })
})

describe('ปลายทางของปุ่ม (BR-40) · ปลายทางต้องคงที่เสมอ ห้ามผูก selector', () => {
  it('BUTTON_ACTION_OPTIONS มีตัวที่เปิดอยู่อย่างน้อยหนึ่งตัว และทุกตัวที่ปิดต้องมีเหตุผล', () => {
    expect(BUTTON_ACTION_OPTIONS.some((o) => o.open)).toBe(true)
    for (const option of BUTTON_ACTION_OPTIONS) {
      if (!option.open) expect(option.blockedReason?.length ?? 0).toBeGreaterThan(10)
    }
  })

  it('buildButtonAction(uri) สร้าง action ชนิด uri', () => {
    expect(buildButtonAction('uri', 'https://example.com')).toEqual({
      type: 'uri', uri: 'https://example.com',
    })
  })

  it('buildButtonAction(message) สร้าง action ชนิด message', () => {
    expect(buildButtonAction('message', 'สวัสดี')).toEqual({ type: 'message', text: 'สวัสดี' })
  })

  it('readButtonAction อ่านค่ากลับมาได้ตรงกับที่ build ไป', () => {
    expect(readButtonAction(buildButtonAction('uri', 'https://x.test'))).toEqual({
      kind: 'uri', target: 'https://x.test',
    })
    expect(readButtonAction(buildButtonAction('message', 'เล่น'))).toEqual({
      kind: 'message', target: 'เล่น',
    })
  })

  it('readButtonAction คืนค่าว่างเมื่อไม่มี action หรือเป็นค่าว่างเปล่าจากเทมเพลต', () => {
    expect(readButtonAction(null)).toEqual({ kind: null, target: '' })
    expect(readButtonAction({ type: 'postback', data: '' })).toEqual({ kind: null, target: '' })
  })

  it('ไม่มีตัวเลือกไหนใน BUTTON_ACTION_OPTIONS ที่ผูกกับ selector — เป็นค่าคงที่เสมอ (BR-40)', () => {
    // ทุกตัวเลือกสร้างจาก buildButtonAction ซึ่งรับ target เป็น string ธรรมดา ไม่มี
    // ทางไหนรับ selectorId เข้ามาแทน — โครงสร้างของฟังก์ชันเองคือด่าน ไม่ใช่การเช็ค
    // เพิ่มเติมที่ต้องมาคอยดูแลให้ตรงกัน
    expect(buildButtonAction.length).toBe(2)
  })
})

describe('เงื่อนไขการแสดง (show_when) · ต้องตรงกับ Condition ใน lib/state.ts เป๊ะ', () => {
  it('SHOW_WHEN_TYPES มีหกชนิดตรงกับ Condition union', () => {
    expect(SHOW_WHEN_TYPES).toEqual([
      'has_attribute', 'not_has_attribute', 'has_entitlement',
      'activity_completed', 'activity_not_completed', 'activity_play_count',
    ])
  })

  it('ทุกชนิดมีชื่อและช่องกรอกกำกับ', () => {
    for (const type of SHOW_WHEN_TYPES) {
      expect(SHOW_WHEN_NAME[type]).toBeTruthy()
      expect(SHOW_WHEN_FIELDS[type].length).toBeGreaterThan(0)
    }
  })

  it('asShowWhenType ปฏิเสธค่าที่ไม่รู้จัก', () => {
    expect(asShowWhenType('has_attribute')).toBe('has_attribute')
    expect(asShowWhenType('ไม่มีจริง')).toBeNull()
    expect(asShowWhenType(undefined)).toBeNull()
  })

  it('buildCondition สร้าง has_attribute พร้อมค่าที่ต้องเท่ากับ', () => {
    expect(buildCondition('has_attribute', { key: 'pet', value: 'cat' })).toEqual({
      type: 'has_attribute', key: 'pet', value: 'cat',
    })
  })

  it('buildCondition สร้าง has_attribute แบบไม่ระบุค่าเมื่อเว้นว่าง — evaluate() อ่านต่างกัน', () => {
    expect(buildCondition('has_attribute', { key: 'pet', value: '' })).toEqual({
      type: 'has_attribute', key: 'pet',
    })
  })

  it('buildCondition สร้าง activity_play_count พร้อม op และ count เป็นตัวเลข', () => {
    expect(buildCondition('activity_play_count', {
      activityCode: 'quiz', op: 'lt', count: '3',
    })).toEqual({ type: 'activity_play_count', activityCode: 'quiz', op: 'lt', count: 3 })
  })

  it('buildCondition ปัด op ที่ไม่รู้จักเป็น gte', () => {
    expect(buildCondition('activity_play_count', {
      activityCode: 'quiz', op: 'weird', count: '2',
    })).toMatchObject({ op: 'gte' })
  })

  it('validateConditionValues ฟ้องเมื่อช่องบังคับว่าง', () => {
    expect(validateConditionValues('has_attribute', { key: '', value: '' })).not.toBeNull()
    expect(validateConditionValues('has_attribute', { key: 'pet', value: '' })).toBeNull()
  })

  it('validateConditionValues ฟ้องเมื่อ activity_play_count ไม่กรอกจำนวนครั้ง', () => {
    expect(validateConditionValues('activity_play_count', {
      activityCode: 'quiz', op: 'gte', count: '',
    })).not.toBeNull()
  })
})

const saveInput = (over: Partial<Parameters<typeof parseBlockSave>[0]> = {}) => ({
  blockType: 'title' as const,
  content: '', fullTop: false, counter: '', target: '', actionKind: '', actionTarget: '',
  ...over,
})

describe('parseBlockSave · ค่าจากฟอร์มกลายเป็น content/options ที่บันทึกได้ ต่างกันเฉพาะส่วนที่ 1 ตามชนิด', () => {
  it('title · body · caption เก็บข้อความตรงๆ ไม่มี options', () => {
    for (const blockType of ['title', 'body', 'caption'] as const) {
      const out = parseBlockSave(saveInput({ blockType, content: 'สวัสดี {{attr.name}}' }))
      expect(out).toEqual({ ok: true, content: 'สวัสดี {{attr.name}}', options: null })
    }
  })

  it('divider · spacer ไม่มีอะไรให้กรอก คืน content/options เป็น null เสมอ', () => {
    for (const blockType of ['divider', 'spacer'] as const) {
      expect(parseBlockSave(saveInput({ blockType, content: 'ใส่มาก็ไม่เก็บ' })))
        .toEqual({ ok: true, content: null, options: null })
    }
  })

  it('image ต้องมี URL ไม่งั้นฟ้อง', () => {
    const out = parseBlockSave(saveInput({ blockType: 'image', content: '  ' }))
    expect(out.ok).toBe(false)
  })

  it('image เก็บ URL ลง content และ placement ลง options เมื่อติ๊กภาพหัวการ์ด', () => {
    const out = parseBlockSave(saveInput({ blockType: 'image', content: 'https://x.test/a.png', fullTop: true }))
    expect(out).toEqual({
      ok: true, content: 'https://x.test/a.png', options: { placement: 'full_top' },
    })
  })

  it('image ไม่ติ๊กภาพหัวการ์ด → options เป็น null', () => {
    const out = parseBlockSave(saveInput({ blockType: 'image', content: 'https://x.test/a.png' }))
    expect(out).toEqual({ ok: true, content: 'https://x.test/a.png', options: null })
  })

  it('progress_bar ต้องเลือกค่าสะสมและเป้าหมายเป็นบวก', () => {
    expect(parseBlockSave(saveInput({ blockType: 'progress_bar', counter: '', target: '10' })).ok).toBe(false)
    expect(parseBlockSave(saveInput({ blockType: 'progress_bar', counter: 'c1', target: '0' })).ok).toBe(false)
    expect(parseBlockSave(saveInput({ blockType: 'progress_bar', counter: 'c1', target: '-5' })).ok).toBe(false)
    expect(parseBlockSave(saveInput({ blockType: 'progress_bar', counter: 'c1', target: 'abc' })).ok).toBe(false)
  })

  it('progress_bar เก็บ counter/target ลง options · content เป็น null เสมอ', () => {
    const out = parseBlockSave(saveInput({ blockType: 'progress_bar', counter: 'checkin', target: '7' }))
    expect(out).toEqual({ ok: true, content: null, options: { counter: 'checkin', target: 7 } })
  })

  it('button ต้องมีป้าย ต้องเลือกปลายทาง และปลายทางต้องไม่ว่าง', () => {
    expect(parseBlockSave(saveInput({ blockType: 'button', content: '' })).ok).toBe(false)
    expect(parseBlockSave(saveInput({ blockType: 'button', content: 'กด', actionKind: '' })).ok).toBe(false)
    expect(parseBlockSave(saveInput({
      blockType: 'button', content: 'กด', actionKind: 'uri', actionTarget: '',
    })).ok).toBe(false)
  })

  it('button ปฏิเสธ postback_activity แม้มีคนยิงค่านี้เข้ามาตรงๆ (BR-40 ปิดไว้ที่ตัวเรนเดอร์)', () => {
    const out = parseBlockSave(saveInput({
      blockType: 'button', content: 'กด', actionKind: 'postback_activity', actionTarget: 'quiz',
    }))
    expect(out.ok).toBe(false)
  })

  it('button เก็บป้ายลง content และปลายทางลง options.action', () => {
    const out = parseBlockSave(saveInput({
      blockType: 'button', content: 'เปิดเว็บ', actionKind: 'uri', actionTarget: 'https://x.test',
    }))
    expect(out).toEqual({
      ok: true, content: 'เปิดเว็บ', options: { action: { type: 'uri', uri: 'https://x.test' } },
    })
  })
})

describe('canRoleEditBlock · Permission Matrix (L1 §2)', () => {
  it('ผู้ตั้งค่าแก้ได้ทุกชนิด', () => {
    for (const type of DRAWABLE_BLOCK_TYPES) {
      expect(canRoleEditBlock('configurator', type)).toBe(true)
    }
  })

  it('ผู้ดูแลเนื้อหาแก้ได้เฉพาะข้อความและภาพ ไม่ใช่ปุ่ม', () => {
    for (const type of CONTENT_EDITOR_TYPES) {
      expect(canRoleEditBlock('content_editor', type)).toBe(true)
    }
    expect(canRoleEditBlock('content_editor', 'button')).toBe(false)
    expect(canRoleEditBlock('content_editor', 'progress_bar')).toBe(false)
  })

  it('ผู้ดูรายงานแก้อะไรไม่ได้เลย', () => {
    for (const type of DRAWABLE_BLOCK_TYPES) {
      expect(canRoleEditBlock('reporter', type)).toBe(false)
    }
  })
})
