// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanel } from './PreviewPanel'
import type { CardBlock } from '@/lib/render/groups'
import type { PlayerState } from '@/lib/state'

afterEach(cleanup)

/**
 * PreviewPanel คือกาวที่ต่อ StateSwitcher เข้ากับ Preview เข้ากับปุ่มส่งทดสอบ — ตาม
 * แบบเดียวกับที่ ChatSim (Task 16) รับ play/reset เป็น prop function ที่ page.tsx
 * ผูก server action มาให้แล้ว ไม่ import server action ตรงๆ จึงทดสอบได้โดยไม่ต้อง
 * mock module
 */

const blocks: CardBlock[] = [
  { id: 'b1', blockType: 'title', sortOrder: 0, content: 'หัวข้อ', showWhen: null, options: null },
]
const theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }

const baseProps = {
  blocks,
  theme,
  renderAs: 'flex_bubble' as const,
  rewardCodes: ['gold'],
  activities: [{ code: 'quiz', name: 'ตอบคำถาม' }],
  counterCodes: ['checkin_days'],
}

describe('PreviewPanel · ไม่มี test_line_uid', () => {
  it('บอกวิธีไปตั้งค่า ไม่มีปุ่มส่งทดสอบให้กด', () => {
    const sendTest = vi.fn()
    render(<PreviewPanel {...baseProps} testLineUid={null} sendTest={sendTest} />)

    expect(screen.queryByRole('button', { name: /ส่งการ์ดทดสอบ/ })).toBeNull()
    expect(screen.getByText(/ยังไม่ได้ตั้ง/)).toBeDefined()
  })
})

describe('PreviewPanel · มี test_line_uid แล้ว', () => {
  it('กดปุ่มส่งทดสอบ เรียก sendTest ด้วย state ปัจจุบันจาก StateSwitcher', async () => {
    const sendTest = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <PreviewPanel {...baseProps} testLineUid={`U${'a'.repeat(32)}`} sendTest={sendTest} />,
    )

    // แก้ค่าประจำตัวผ่าน StateSwitcher ก่อน แล้วดูว่า state ที่ส่งไปมีค่านั้นจริง
    fireEvent.click(container.querySelector('[data-add-attribute]')!)
    const keyInput = container.querySelector('[data-attr-row="0"] input[name="key"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'name' } })
    const valueInput = container.querySelector('[data-attr-row="name"] input[name="value"]') as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: 'มีนา' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งการ์ดทดสอบ/ }))
    })

    expect(sendTest).toHaveBeenCalledTimes(1)
    const sentState = sendTest.mock.calls[0][0] as PlayerState
    expect(sentState.attributes).toEqual({ name: 'มีนา' })
  })

  it('ส่งสำเร็จแล้วบอกผลสำเร็จ', async () => {
    const sendTest = vi.fn().mockResolvedValue(undefined)
    render(<PreviewPanel {...baseProps} testLineUid={`U${'a'.repeat(32)}`} sendTest={sendTest} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งการ์ดทดสอบ/ }))
    })

    await waitFor(() => expect(screen.getByText(/ส่งการ์ดทดสอบแล้ว/)).toBeDefined())
  })

  it('ส่งไม่สำเร็จแล้วโชว์ข้อความ error ของ action ไม่ใช่ข้อความทั่วไปที่กลืนเหตุผลทิ้ง', async () => {
    const sendTest = vi.fn().mockRejectedValue(new Error('ยังไม่มีบัญชี LINE ประเภททดสอบ'))
    render(<PreviewPanel {...baseProps} testLineUid={`U${'a'.repeat(32)}`} sendTest={sendTest} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งการ์ดทดสอบ/ }))
    })

    await waitFor(() => expect(screen.getByText('ยังไม่มีบัญชี LINE ประเภททดสอบ')).toBeDefined())
  })
})

describe('PreviewPanel · เชื่อม StateSwitcher เข้ากับ Preview จริง', () => {
  it('สลับสถานะผ่าน StateSwitcher แล้วตัวอย่างเปลี่ยนตาม (ไม่ใช่สอง state คนละก้อน)', () => {
    const gated: CardBlock[] = [
      { id: 'b1', blockType: 'body', sortOrder: 0, content: 'เห็นเมื่อมีสิทธิ์',
        showWhen: [{ type: 'has_entitlement', rewardCode: 'gold' }], options: null },
    ]
    const { container } = render(
      <PreviewPanel
        {...baseProps} blocks={gated} testLineUid={null} sendTest={vi.fn()}
      />,
    )

    expect(container.textContent).not.toContain('เห็นเมื่อมีสิทธิ์')

    fireEvent.click(container.querySelector('[data-entitlement-toggle="gold"]')!)

    expect(container.textContent).toContain('เห็นเมื่อมีสิทธิ์')
  })
})
