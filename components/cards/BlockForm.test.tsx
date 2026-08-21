// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardBlock } from '@/lib/render/groups'
import { BlockForm } from './BlockForm'

afterEach(cleanup)

vi.mock('@/app/(admin)/campaigns/[id]/cards/[cardId]/actions', () => ({
  saveBlockContent: vi.fn(),
  addShowWhenCondition: vi.fn(),
  removeShowWhenCondition: vi.fn(),
  uploadBlockImage: vi.fn(),
}))

let n = 0
const block = (over: Partial<CardBlock> = {}): CardBlock => ({
  id: `b${n++}`, blockType: 'title', sortOrder: 0, content: null, showWhen: null, options: null,
  ...over,
})

const screen = { activities: [{ id: 'a1', code: 'quiz', name: 'ตอบคำถาม' }], rewardCodes: ['mug'] }

const draw = (over: Partial<Parameters<typeof BlockForm>[0]> = {}) =>
  render(
    <BlockForm
      campaignId="c1" cardId="card-1" block={block()} canEdit selectorCount={0} screen={screen}
      {...over}
    />,
  )

describe('BlockForm · ส่วนที่ 1 (ค่าของตัวเอง) ต่างกันตามชนิด', () => {
  it('title/body/caption มีช่องข้อความเดียว เติมค่าจาก content', () => {
    const { container } = draw({ block: block({ blockType: 'body', content: 'สวัสดี' }) })
    const textarea = container.querySelector('textarea[name="content"]') as HTMLTextAreaElement
    expect(textarea.value).toBe('สวัสดี')
  })

  it('image มีช่อง URL และสวิตช์ภาพหัวการ์ดเติมจาก options.placement', () => {
    const { container } = draw({
      block: block({ blockType: 'image', content: 'https://x.test/a.png', options: { placement: 'full_top' } }),
    })
    const input = container.querySelector('input[name="content"]') as HTMLInputElement
    const checkbox = container.querySelector('input[name="full_top"]') as HTMLInputElement
    expect(input.value).toBe('https://x.test/a.png')
    expect(checkbox.checked).toBe(true)
  })

  it('progress_bar มีช่องค่าสะสมกับเป้าหมาย เติมจาก options', () => {
    const { container } = draw({
      block: block({ blockType: 'progress_bar', options: { counter: 'checkin', target: 7 } }),
    })
    const counter = container.querySelector('input[name="counter"]') as HTMLInputElement
    const target = container.querySelector('input[name="target"]') as HTMLInputElement
    expect(counter.value).toBe('checkin')
    expect(target.value).toBe('7')
  })

  it('divider/spacer ไม่มีช่องกรอกอะไรเลยในฟอร์มค่าของตัวเอง (ฟอร์มแรกของจอ)', () => {
    for (const blockType of ['divider', 'spacer'] as const) {
      const { container } = draw({ block: block({ blockType }) })
      const ownValueForm = container.querySelector('form') as HTMLFormElement
      expect(ownValueForm.querySelectorAll('input, textarea, select').length).toBe(0)
      expect(container.textContent).toContain('ไม่มีค่าให้ตั้ง')
      cleanup()
    }
  })

  it('button มีช่องป้าย และช่องปลายทางที่เติมจาก options.action', () => {
    const { container } = draw({
      block: block({ blockType: 'button', content: 'เล่นเลย', options: { action: { type: 'uri', uri: 'https://x.test' } } }),
    })
    const label = container.querySelector('input[name="content"]') as HTMLInputElement
    const kind = container.querySelector('select[name="action_kind"]') as HTMLSelectElement
    const target = container.querySelector('input[name="action_target"]') as HTMLInputElement
    expect(label.value).toBe('เล่นเลย')
    expect(kind.value).toBe('uri')
    expect(target.value).toBe('https://x.test')
  })
})

describe('BlockForm · BR-40 ปลายทางของปุ่มคงที่เสมอ', () => {
  it('มีกุญแจ 🔒 พร้อมคำอธิบาย ไม่ได้ซ่อนเงียบๆ', () => {
    const { container } = draw({ block: block({ blockType: 'button' }) })
    expect(container.textContent).toContain('🔒')
    expect(container.textContent).toContain('BR-40')
    expect(container.textContent).toContain('ปลายทางต้องเป็นค่าคงที่เสมอ')
  })

  it('"ไปกิจกรรมอื่น (postback)" อยู่ในตัวเลือกแต่กดไม่ได้ (disabled)', () => {
    const { container } = draw({ block: block({ blockType: 'button' }) })
    const option = Array.from(container.querySelectorAll('option'))
      .find((o) => o.value === 'postback_activity') as HTMLOptionElement
    expect(option).toBeDefined()
    expect(option.disabled).toBe(true)
  })

  it('ไม่มีช่องสวิตช์คงที่/เลือกจากค่าสำหรับปลายทาง — ช่องปลายทางรับ text ธรรมดาเท่านั้น', () => {
    const { container } = draw({ block: block({ blockType: 'button' }) })
    const target = container.querySelector('input[name="action_target"]')
    expect(target?.tagName).toBe('INPUT')
  })
})

describe('BlockForm · ส่วนที่ 2 (สวิตช์ตามสถานะ) ใช้โค้ดเดียวกันทุกชนิดที่รองรับ', () => {
  it('image · title · body · caption · button แสดงกล่องเดียวกัน', () => {
    for (const blockType of ['image', 'title', 'body', 'caption', 'button'] as const) {
      const { container } = draw({ block: block({ blockType }) })
      expect(container.textContent).toContain('เลือกจากชุดเนื้อหา')
      expect(container.textContent).toContain('ยังใช้งานจริงไม่ได้')
      cleanup()
    }
  })

  it('divider · spacer · progress_bar ไม่แสดงกล่องนี้ เพราะไม่มีเนื้อหาให้สลับ', () => {
    for (const blockType of ['divider', 'spacer', 'progress_bar'] as const) {
      const { container } = draw({ block: block({ blockType }) })
      expect(container.textContent).not.toContain('เลือกจากชุดเนื้อหา')
      cleanup()
    }
  })

  it('บอกจำนวนชุดเนื้อหาที่มีอยู่จริงเมื่อมากกว่าศูนย์', () => {
    const { container } = draw({ block: block({ blockType: 'title' }), selectorCount: 3 })
    expect(container.textContent).toContain('3 ชุด')
  })
})

describe('BlockForm · ส่วนที่ 3 (เงื่อนไขการแสดง) ใช้โค้ดเดียวกันทุกชนิด', () => {
  it('ไม่มีเงื่อนไข บอกว่าแสดงเสมอ', () => {
    const { container } = draw({ block: block({ showWhen: null }) })
    expect(container.textContent).toContain('ไม่มีเงื่อนไข')
  })

  it('มีเงื่อนไข แสดงคำอธิบายของแต่ละข้อและปุ่มเอาออก', () => {
    const { container } = draw({
      block: block({ showWhen: [{ type: 'has_entitlement', rewardCode: 'mug' }] }),
    })
    expect(container.textContent).toContain('ถือสิทธิ์รางวัล "mug"')
    expect(container.querySelector('form button')).toBeTruthy()
  })

  it('ฟอร์มเพิ่มเงื่อนไขมีตัวเลือกครบหกชนิด', () => {
    const { container } = draw()
    const select = container.querySelector('select[name="type"]') as HTMLSelectElement
    expect(select.querySelectorAll('option').length).toBe(6)
  })

  it('รูปแบบเดียวกันไม่ว่าจะเป็นบล็อกชนิดไหน — เทียบ divider กับ button', () => {
    const a = draw({ block: block({ blockType: 'divider', showWhen: [{ type: 'not_has_attribute', key: 'x' }] }) })
    expect(a.container.textContent).toContain('ไม่มีค่าประจำตัว "x"')
    cleanup()
    const b = draw({ block: block({ blockType: 'button', showWhen: [{ type: 'not_has_attribute', key: 'x' }] }) })
    expect(b.container.textContent).toContain('ไม่มีค่าประจำตัว "x"')
  })
})

describe('BlockForm · สิทธิ์', () => {
  it('canEdit=false ปิดช่องกรอกทั้งหมดและไม่มีปุ่มบันทึก', () => {
    const { container } = draw({ canEdit: false, block: block({ blockType: 'title' }) })
    const input = container.querySelector('input[name="content"], textarea[name="content"]') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(within(container).queryByText('บันทึกบล็อกนี้')).toBeNull()
  })

  it('canEdit=false ยังไม่มีฟอร์มเพิ่มเงื่อนไข (เป็นของผู้ตั้งค่าเท่านั้น)', () => {
    const { container } = draw({ canEdit: false })
    expect(container.querySelector('select[name="type"]')).toBeNull()
  })
})
