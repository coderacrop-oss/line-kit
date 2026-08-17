// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Preview } from './Preview'
import { groupBlocks, type CardBlock } from '@/lib/render/groups'
import { toFlexBubble } from '@/lib/render/flex'
import { toPlainText } from '@/lib/render/text'
import type { PlayerState } from '@/lib/state'

afterEach(cleanup)

/**
 * BR-91 เป็นจริงหรือไม่ก็ตัดสินกันที่ไฟล์นี้ — ต้องพิสูจน์แบบ toEqual/ค่าตรงเป๊ะ
 * ไม่ใช่แค่ toContain บางส่วน (แผนบรรทัด 1835–1839 เป็นแค่จุดเริ่ม)
 */

const blocks: CardBlock[] = [
  { id: 'b1', blockType: 'title', sortOrder: 0, content: 'สวัสดี {{attr.name}}', showWhen: null, options: null },
]
const theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#111111' }
const state: PlayerState = {
  attributes: { name: 'มีนา' }, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

/** ดึงข้อความ JSON ที่จอแสดงออกมา parse กลับเป็น object เพื่อเทียบแบบ deep-equal */
function jsonShownIn(container: HTMLElement): unknown {
  const pre = container.querySelector('[data-preview-json]')
  if (!pre) throw new Error('ไม่มีช่อง JSON บนจอ — เปิด showJson หรือ toggle ก่อน')
  return JSON.parse(pre.textContent ?? '')
}

describe('Preview · แสดงข้อความหลังแทนค่าตัวแปรแล้ว', () => {
  it('แทนค่า {{attr.name}} แล้วแสดงผล', () => {
    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" />,
    )
    expect(container.textContent).toContain('สวัสดี มีนา')
  })
})

describe('Preview · JSON ตรงกับ renderer ของ webhook แบบ byte-identical', () => {
  it('flex_bubble — JSON ที่โชว์ toEqual กับ toFlexBubble(groupBlocks(...)) ตรงๆ ไม่ใช่แค่ contain', () => {
    const fromEngine = toFlexBubble(groupBlocks(blocks, state), state, theme)

    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" showJson />,
    )

    expect(jsonShownIn(container)).toEqual(fromEngine)
  })

  it('เปลี่ยน blocks แล้ว JSON ที่โชว์เปลี่ยนตาม toFlexBubble จริง ไม่ใช่ค่าค้าง', () => {
    const richer: CardBlock[] = [
      ...blocks,
      { id: 'b2', blockType: 'button', sortOrder: 1, content: 'กดที่นี่', showWhen: null,
        options: { action: { type: 'message', text: 'เล่น' } } },
    ]
    const fromEngine = toFlexBubble(groupBlocks(richer, state), state, theme)

    const { container } = render(
      <Preview blocks={richer} state={state} theme={theme} renderAs="flex_bubble" showJson />,
    )

    expect(jsonShownIn(container)).toEqual(fromEngine)
    // การพิสูจน์ที่แน่นจริงคือ "ไม่ใช่ของเดิม" ด้วย ไม่ใช่แค่บังเอิญ toEqual เฉยๆ
    const fromOriginal = toFlexBubble(groupBlocks(blocks, state), state, theme)
    expect(jsonShownIn(container)).not.toEqual(fromOriginal)
  })

  it('renderAs="text" — ข้อความที่โชว์ toEqual กับ toPlainText(groupBlocks(...)) ตรงๆ', () => {
    const fromEngine = toPlainText(groupBlocks(blocks, state), state)

    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="text" showJson />,
    )

    const box = container.querySelector('[data-preview-text]')
    expect(box?.textContent).toBe(fromEngine)
  })

  it('theme ต่างกัน สีใน JSON เปลี่ยนตาม ไม่ใช่ค่าคงที่ที่ Preview ผูกเอง', () => {
    const otherTheme = { primary: '#000001', secondary: '#000002', text: '#000003' }
    const fromEngine = toFlexBubble(groupBlocks(blocks, state), state, otherTheme)

    const { container } = render(
      <Preview blocks={blocks} state={state} theme={otherTheme} renderAs="flex_bubble" showJson />,
    )

    expect(jsonShownIn(container)).toEqual(fromEngine)
  })
})

describe('Preview · สลับสถานะแล้วบล็อกที่ show_when ไม่ผ่านหายไปจากตัวอย่าง', () => {
  const gated: CardBlock[] = [
    ...blocks,
    { id: 'b2', blockType: 'body', sortOrder: 1, content: 'เห็นเมื่อมีสิทธิ์',
      showWhen: [{ type: 'has_entitlement', rewardCode: 'x' }], options: null },
  ]

  it('ไม่มีสิทธิ์ — ข้อความที่ล็อกไว้ไม่ปรากฏ ทั้งในตัวอย่างและใน JSON', () => {
    const { container } = render(
      <Preview blocks={gated} state={state} theme={theme} renderAs="flex_bubble" showJson />,
    )
    expect(container.textContent).not.toContain('เห็นเมื่อมีสิทธิ์')

    const fromEngine = toFlexBubble(groupBlocks(gated, state), state, theme)
    expect(jsonShownIn(container)).toEqual(fromEngine)
  })

  it('มีสิทธิ์แล้ว — ข้อความที่ล็อกไว้ปรากฏ', () => {
    const withIt = { ...state, entitlements: ['x'] }
    const { container } = render(
      <Preview blocks={gated} state={withIt} theme={theme} renderAs="flex_bubble" showJson />,
    )
    expect(container.textContent).toContain('เห็นเมื่อมีสิทธิ์')

    const fromEngine = toFlexBubble(groupBlocks(gated, withIt), withIt, theme)
    expect(jsonShownIn(container)).toEqual(fromEngine)
  })
})

describe('Preview · คำเตือนที่ซื่อสัตย์ (แผนบรรทัด 1863–1866)', () => {
  it('บอกตรงๆ ว่าเป็น CSS เลียนแบบ ไม่ใช่ LINE จริง และความจริงอยู่ที่ปุ่มส่งทดสอบ', () => {
    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" />,
    )
    expect(container.textContent).toContain('เป็น CSS ที่เราเขียนเลียน LINE ไม่ใช่ LINE จริง')
    expect(container.textContent).toContain('ความจริงอยู่ที่ปุ่มส่งทดสอบ')
  })
})

describe('Preview · ปุ่มดู JSON', () => {
  it('showJson=false (ค่าเริ่มต้น) ไม่แสดง JSON จนกว่าจะกดดู', () => {
    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" />,
    )
    expect(container.querySelector('[data-preview-json]')).toBeNull()
  })

  it('กดสวิตช์ดู JSON แล้วโผล่ กดอีกทีแล้วหาย', () => {
    const { container } = render(
      <Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" />,
    )
    const toggle = container.querySelector('[data-preview-json-toggle]') as HTMLInputElement
    expect(toggle).not.toBeNull()

    fireEvent.click(toggle)
    expect(container.querySelector('[data-preview-json]')).not.toBeNull()

    fireEvent.click(toggle)
    expect(container.querySelector('[data-preview-json]')).toBeNull()
  })
})

describe('Preview · การ์ดที่บล็อกถูกซ่อนหมด', () => {
  it('ไม่ล่ม และ JSON ยังตรงกับ toFlexBubble (filler)', () => {
    const hiddenAll: CardBlock[] = [
      { id: 'b1', blockType: 'body', sortOrder: 0, content: 'ลับ',
        showWhen: [{ type: 'has_entitlement', rewardCode: 'never' }], options: null },
    ]
    const fromEngine = toFlexBubble(groupBlocks(hiddenAll, state), state, theme)

    const { container } = render(
      <Preview blocks={hiddenAll} state={state} theme={theme} renderAs="flex_bubble" showJson />,
    )

    expect(jsonShownIn(container)).toEqual(fromEngine)
  })
})
