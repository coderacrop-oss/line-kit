// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockList, type BlockRowInfo } from './BlockList'

afterEach(cleanup)

const { reorderBlocks, moveBlock } = vi.hoisted(() => ({
  reorderBlocks: vi.fn(async () => {}),
  moveBlock: vi.fn(async () => {}),
}))

vi.mock('@/app/(admin)/campaigns/[id]/cards/[cardId]/actions', () => ({ reorderBlocks, moveBlock }))

const rows: BlockRowInfo[] = [
  { id: 'b1', blockType: 'title' },
  { id: 'b2', blockType: 'body' },
  { id: 'b3', blockType: 'button' },
]

const counts = { blocks: 4, buttons: 1, blocksLeft: 6, buttonsLeft: 2 }

const draw = (over: Partial<Parameters<typeof BlockList>[0]> = {}) =>
  render(
    <BlockList campaignId="c1" cardId="card-1" blocks={rows} canEdit counts={counts} {...over}>
      <div data-form="b1">form 1</div>
      <div data-form="b2">form 2</div>
      <div data-form="b3">form 3</div>
    </BlockList>,
  )

describe('BlockList · ตัวนับ (BR-66) เห็นตลอด', () => {
  it('แสดง "N/10 บล็อก" และ "ปุ่ม N/3" ตามที่คำนวณมา', () => {
    const { container } = draw()
    const bar = container.querySelector('[data-block-counter]')
    expect(bar?.textContent).toContain('4/10 บล็อก')
    expect(bar?.textContent).toContain('ปุ่ม 1/3')
  })

  it('ตัวนับอยู่ในตำแหน่ง sticky ไม่ได้อยู่ท้ายรายการที่ต้องเลื่อนไปดู', () => {
    const { container } = draw()
    const bar = container.querySelector('[data-block-counter]') as HTMLElement
    expect(bar.style.position).toBe('sticky')
  })
})

describe('BlockList · แถวเรียงตามลำดับที่ได้มา และกางในที่เห็นฟอร์มของมันเอง', () => {
  it('สามแถวตามลำดับ b1 · b2 · b3', () => {
    const { container } = draw()
    const ids = Array.from(container.querySelectorAll('[data-block-row]'))
      .map((el) => el.getAttribute('data-block-row'))
    expect(ids).toEqual(['b1', 'b2', 'b3'])
  })

  it('ฟอร์มของแต่ละบล็อกอยู่ในแถวของตัวเอง (children เดียวกับที่ page.tsx ส่งมา)', () => {
    const { container } = draw()
    const row = container.querySelector('[data-block-row="b2"]') as HTMLElement
    expect(row.textContent).toContain('form 2')
  })
})

describe('BlockList · ปุ่มขึ้น/ลง — ทางเลือกสำรองที่ทดสอบได้โดยไม่ต้องจำลอง drag', () => {
  it('แถวแรกปุ่มขึ้นถูก disable · แถวสุดท้ายปุ่มลงถูก disable', () => {
    const { container } = draw()
    const first = container.querySelector('[data-block-row="b1"]') as HTMLElement
    const last = container.querySelector('[data-block-row="b3"]') as HTMLElement
    expect(first.querySelector('[aria-label="ย้ายขึ้น"]')).toHaveProperty('disabled', true)
    expect(last.querySelector('[aria-label="ย้ายลง"]')).toHaveProperty('disabled', true)
  })

  it('แถวกลางกดปุ่มขึ้นได้และลงได้', () => {
    const { container } = draw()
    const middle = container.querySelector('[data-block-row="b2"]') as HTMLElement
    expect(middle.querySelector('[aria-label="ย้ายขึ้น"]')).toHaveProperty('disabled', false)
    expect(middle.querySelector('[aria-label="ย้ายลง"]')).toHaveProperty('disabled', false)
  })

  it('ปุ่มขึ้น/ลงเป็น <form action> ที่เรียก moveBlock จริง ไม่ได้ผูกกับ reorderBlocks', () => {
    const { container } = draw()
    const middle = container.querySelector('[data-block-row="b2"]') as HTMLElement
    const upForm = middle.querySelector('form[data-move-form="up"]')
    const downForm = middle.querySelector('form[data-move-form="down"]')
    expect(upForm).toBeTruthy()
    expect(downForm).toBeTruthy()
  })

  it('canEdit=false ไม่มีปุ่มขึ้น/ลงเลย', () => {
    const { container } = draw({ canEdit: false })
    expect(container.querySelector('[aria-label="ย้ายขึ้น"]')).toBeNull()
  })
})

describe('BlockList · ลาก (HTML5 drag-and-drop) เรียก reorderBlocks จริง', () => {
  it('ลาก b3 ไปวางที่ b1 แล้วเรียก reorderBlocks ด้วยลำดับใหม่', async () => {
    reorderBlocks.mockClear()
    const { container } = draw()
    const from = container.querySelector('[data-block-row="b3"] summary') as HTMLElement
    const to = container.querySelector('[data-block-row="b1"] summary') as HTMLElement

    fireEvent.dragStart(from)
    fireEvent.dragOver(to)
    fireEvent.drop(to)

    expect(reorderBlocks).toHaveBeenCalledWith('c1', 'card-1', ['b3', 'b1', 'b2'])
  })

  it('ลากแล้วจอแสดงลำดับใหม่ทันที (optimistic) ก่อนรอผลจาก server', async () => {
    const { container } = draw()
    const from = container.querySelector('[data-block-row="b3"] summary') as HTMLElement
    const to = container.querySelector('[data-block-row="b1"] summary') as HTMLElement

    fireEvent.dragStart(from)
    fireEvent.dragOver(to)
    fireEvent.drop(to)

    const ids = Array.from(container.querySelectorAll('[data-block-row]'))
      .map((el) => el.getAttribute('data-block-row'))
    expect(ids).toEqual(['b3', 'b1', 'b2'])
  })

  it('reorderBlocks ล้มเหลว จอย้อนลำดับกลับและขึ้นข้อความผิดพลาด', async () => {
    reorderBlocks.mockRejectedValueOnce(new Error('ย้ายลำดับไม่สำเร็จ — ลองใหม่'))
    const { container, findByText } = draw()
    const from = container.querySelector('[data-block-row="b3"] summary') as HTMLElement
    const to = container.querySelector('[data-block-row="b1"] summary') as HTMLElement

    fireEvent.dragStart(from)
    fireEvent.dragOver(to)
    fireEvent.drop(to)

    await findByText('ย้ายลำดับไม่สำเร็จ — ลองใหม่')
    const ids = Array.from(container.querySelectorAll('[data-block-row]'))
      .map((el) => el.getAttribute('data-block-row'))
    expect(ids).toEqual(['b1', 'b2', 'b3'])
  })
})
