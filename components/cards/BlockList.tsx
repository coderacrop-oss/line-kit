'use client'

import { Children, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { BLOCK_TYPE_NAME, MAX_BLOCKS, MAX_BUTTONS } from '@/lib/cards/blocks'
import type { BlockType } from '@/lib/render/groups'
import { moveBlock, reorderBlocks } from '@/app/(admin)/campaigns/[id]/cards/[cardId]/actions'

/**
 * รายการบล็อกที่ลากเรียงได้ · ตัวนับ "4/10 · ปุ่ม 1/3" เห็นตลอด (BR-66) · แต่ละแถว
 * กางออกในที่ให้เห็นช่องตั้งค่า (`BlockForm` ที่ page.tsx ส่งมาเป็น children)
 *
 * สองทางที่ทำได้ผลเดียวกันแต่เป็นอิสระต่อกัน — ลาก (HTML5 drag-and-drop ธรรมดา ไม่มี
 * ไลบรารีเสริม) เรียกด้วย JS ตรงๆ ผ่าน `reorderBlocks` และปุ่มขึ้น/ลงที่เป็น
 * `<form action={moveBlock...}>` จริง ไม่ได้ผูกกับ state เดียวกับตัวลาก — ปุ่มยังใช้
 * ได้แม้ตัวจัดการลากมี bug และเป็นทางที่เทสต์ jsdom ยิง submit event ทดสอบได้ตรงๆ
 * โดยไม่ต้องจำลอง drag event ซึ่ง jsdom รองรับได้ไม่ครบ
 */

const barStyle: CSSProperties = {
  position: 'sticky', top: 0, zIndex: 1,
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
}

const rowStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', background: 'var(--panel)',
  overflow: 'hidden',
}

const summaryStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', listStyle: 'none',
}

const handleStyle: CSSProperties = {
  cursor: 'grab', color: 'var(--ink-3)', fontSize: 14, lineHeight: 1,
}

const indexStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', width: 18,
}

const moveButtonStyle: CSSProperties = {
  border: '1px solid var(--rule)', background: 'var(--panel)', borderRadius: 'var(--r-sm)',
  width: 26, height: 26, cursor: 'pointer', fontSize: 12, color: 'var(--ink)',
}

export type BlockRowInfo = { id: string; blockType: BlockType }

export type BlockListProps = {
  campaignId: string
  cardId: string
  blocks: BlockRowInfo[]
  canEdit: boolean
  counts: { blocks: number; buttons: number; blocksLeft: number; buttonsLeft: number }
  /** `BlockForm` ของแต่ละบล็อก เรียงตามลำดับเดียวกับ `blocks` — ยังเป็น Server Component อยู่ */
  children: ReactNode
}

export function BlockList({ campaignId, cardId, blocks, canEdit, counts, children }: BlockListProps) {
  const [order, setOrder] = useState<string[]>(() => blocks.map((b) => b.id))
  const [dragId, setDragId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const serverOrderKey = blocks.map((b) => b.id).join(',')
  // เมื่อ Server Action revalidate หน้าแล้ว blocks ที่ส่งมาใหม่คือความจริงล่าสุด —
  // ให้ลำดับที่จอแสดงตามนั้นเสมอ ไม่ใช่ค้างของเดิมที่ optimistic ไว้ก่อนหน้า
  useEffect(() => { setOrder(blocks.map((b) => b.id)) }, [serverOrderKey])

  const byId = new Map(blocks.map((b) => [b.id, b]))
  const formById = new Map(blocks.map((b, i) => [b.id, Children.toArray(children)[i]]))

  async function commit(nextOrder: string[]) {
    const previous = order
    setOrder(nextOrder)
    setPending(true)
    setError(null)
    try {
      await reorderBlocks(campaignId, cardId, nextOrder)
    } catch (err) {
      setOrder(previous)
      setError(err instanceof Error ? err.message : 'ย้ายลำดับไม่สำเร็จ — ลองใหม่')
    } finally {
      setPending(false)
    }
  }

  function moveByIndex(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void commit(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-block-counter style={barStyle}>
        <span>{counts.blocks}/{MAX_BLOCKS} บล็อก</span>
        <span style={{ color: 'var(--ink-3)' }}>· ปุ่ม {counts.buttons}/{MAX_BUTTONS}</span>
        {pending && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>กำลังบันทึกลำดับ…</span>}
      </div>

      {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}

      {order.map((id, index) => {
        const info = byId.get(id)
        if (!info) return null

        return (
          <details key={id} data-block-row={id} style={rowStyle}>
            <summary
              draggable={canEdit}
              onDragStart={() => setDragId(id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (!dragId || dragId === id) return
                moveByIndex(order.indexOf(dragId), order.indexOf(id))
                setDragId(null)
              }}
              style={summaryStyle}
            >
              {canEdit && <span aria-hidden style={handleStyle}>⠿</span>}
              <span style={indexStyle}>{index + 1}</span>
              <span>{BLOCK_TYPE_NAME[info.blockType]}</span>

              {canEdit && (
                // ปุ่มขึ้น/ลงเป็น <form> จริงที่เรียก moveBlock ตรงๆ — อิสระจากตัวลาก
                // และจาก state ของมันทั้งหมด ทำงานได้แม้ตัวจัดการลากมี bug และเป็นทาง
                // ที่เทสต์ jsdom ยิง submit event ทดสอบได้ตรงๆ โดยไม่ต้องจำลอง drag
                <span
                  style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <form action={moveBlock.bind(null, campaignId, cardId, id, 'up')} data-move-form="up">
                    <button
                      type="submit" aria-label="ย้ายขึ้น" disabled={index === 0}
                      style={{ ...moveButtonStyle, opacity: index === 0 ? 0.4 : 1 }}
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveBlock.bind(null, campaignId, cardId, id, 'down')} data-move-form="down">
                    <button
                      type="submit" aria-label="ย้ายลง" disabled={index === order.length - 1}
                      style={{ ...moveButtonStyle, opacity: index === order.length - 1 ? 0.4 : 1 }}
                    >
                      ↓
                    </button>
                  </form>
                </span>
              )}
            </summary>

            <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--rule)' }}>
              {formById.get(id)}
            </div>
          </details>
        )
      })}
    </div>
  )
}
