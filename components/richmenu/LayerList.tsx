'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Layer } from '@/lib/richmenu/composition'
import type { StackMove } from '@/lib/richmenu/layers'

/**
 * รายชั้นเรียงลำดับซ้อน — ลากสลับได้ (HTML5 drag-and-drop ธรรมดา ไม่มีไลบรารีเสริม
 * ตามธรรมเนียมเดียวกับ components/cards/BlockList.tsx) ลำดับในลิสต์นี้ตรงกับ
 * ลำดับจริงในอาเรย์ของ composition.layers เป๊ะ (ล่างสุดของลิสต์ = ชั้นบนสุดที่
 * มองเห็น) เพราะ z-order คือลำดับอาเรย์เองอยู่แล้ว (ดู lib/richmenu/composition.ts)
 *
 * รัฐของการลากทั้งหมดอยู่ในคอมโพเนนต์นี้ ไม่แตะ composition state ของ Compositor
 * โดยตรง — ลากเสร็จแล้วเรียก onReorder ครั้งเดียวพร้อมลำดับ id ใหม่ทั้งชุด
 */

const rowStyle = (selected: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
  border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)',
  background: selected ? 'var(--ground)' : 'var(--panel)',
  fontSize: 12, cursor: 'pointer',
})

const iconButtonStyle: CSSProperties = {
  border: '1px solid var(--rule)', background: 'var(--panel)', borderRadius: 'var(--r-sm)',
  width: 24, height: 24, cursor: 'pointer', fontSize: 11, color: 'var(--ink)', flexShrink: 0,
}

const layerLabel = (layer: Layer): string => (layer.type === 'image' ? '🖼 ภาพ' : `🅣 ${layer.text.slice(0, 16) || 'ข้อความ'}`)

export type LayerListProps = {
  layers: Layer[]
  selectedId: string | null
  canEdit: boolean
  onSelect: (id: string) => void
  onReorder: (nextOrder: string[]) => void
  onMove: (id: string, move: StackMove) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

export function LayerList({ layers, selectedId, canEdit, onSelect, onReorder, onMove, onDuplicate, onDelete }: LayerListProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  // แสดงชั้นบนสุด (ท้ายอาเรย์) ไว้บนลิสต์ — คนคุ้นเคยกับ "ชั้นบนสุดอยู่บนสุด" มากกว่าไล่ตามอาเรย์ดิบ
  const displayed = [...layers].reverse()

  const reorderVisual = (fromId: string, toId: string) => {
    const order = layers.map((l) => l.id)
    const from = order.indexOf(fromId)
    const to = order.indexOf(toId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder(next)
  }

  if (layers.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>ยังไม่มีชั้นเลย — เพิ่มภาพหรือข้อความด้านล่าง</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {displayed.map((layer) => (
        <div
          key={layer.id}
          data-layer-row={layer.id}
          draggable={canEdit}
          onDragStart={() => setDragId(layer.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            if (!dragId || dragId === layer.id) return
            reorderVisual(dragId, layer.id)
            setDragId(null)
          }}
          onClick={() => onSelect(layer.id)}
          style={rowStyle(layer.id === selectedId)}
        >
          {canEdit && <span aria-hidden style={{ cursor: 'grab', color: 'var(--ink-3)' }}>⠿</span>}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {layerLabel(layer)}
          </span>
          {canEdit && (
            <span style={{ display: 'flex', gap: 3 }} onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label="ขึ้นหนึ่งชั้น" style={iconButtonStyle} onClick={() => onMove(layer.id, 'up')}>↑</button>
              <button type="button" aria-label="ลงหนึ่งชั้น" style={iconButtonStyle} onClick={() => onMove(layer.id, 'down')}>↓</button>
              <button type="button" aria-label="ทำสำเนา" style={iconButtonStyle} onClick={() => onDuplicate(layer.id)}>⧉</button>
              <button type="button" aria-label="ลบชั้นนี้" style={iconButtonStyle} onClick={() => onDelete(layer.id)}>✕</button>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
