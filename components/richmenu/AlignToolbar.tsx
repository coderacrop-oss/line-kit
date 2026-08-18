'use client'

import type { CSSProperties } from 'react'
import { ALIGN_DIRECTIONS, type AlignDirection } from '@/lib/richmenu/align'

/** จัดชั้นที่เลือกอยู่ให้ชิดขอบ/กึ่งกลางของผืนภาพ — ปิดใช้งานทั้งแถวเมื่อยังไม่ได้เลือกชั้นไหนเลย */

const LABEL: Record<AlignDirection, string> = {
  left: '⇤ ชิดซ้าย', 'center-h': '↔ กึ่งกลางแนวนอน', right: 'ชิดขวา ⇥',
  top: '⇧ ชิดบน', 'center-v': '↕ กึ่งกลางแนวตั้ง', bottom: 'ชิดล่าง ⇩',
}

const buttonStyle = (disabled: boolean): CSSProperties => ({
  border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', background: 'var(--panel)',
  padding: '6px 9px', fontSize: 11, cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1, color: 'var(--ink)',
})

export type AlignToolbarProps = {
  disabled: boolean
  onAlign: (direction: AlignDirection) => void
}

export function AlignToolbar({ disabled, onAlign }: AlignToolbarProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {ALIGN_DIRECTIONS.map((direction) => (
        <button
          key={direction} type="button" disabled={disabled}
          style={buttonStyle(disabled)}
          onClick={() => onAlign(direction)}
        >
          {LABEL[direction]}
        </button>
      ))}
    </div>
  )
}
