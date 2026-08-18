'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Layer } from '@/lib/richmenu/composition'
import { computeMove, computeResize, RESIZE_HANDLES, type Rect, type ResizeHandle } from '@/lib/richmenu/gesture'

/**
 * ชั้นเดียวบนพื้นที่แต่งภาพ — ลาก/ปรับขนาดได้ลื่นโดยไม่มีไลบรารีเสริม (ตาม
 * ธรรมเนียมของโปรเจกต์นี้ที่ components/cards/BlockList.tsx วางไว้แล้วสำหรับ
 * การลากแบบอื่น) กติกาข้อเดียวที่ทำให้ลื่น: ระหว่างลาก เขียนตำแหน่งลงสไตล์ของ DOM
 * ตรงๆ ผ่าน ref ทุกเฟรม (requestAnimationFrame) ไม่เรียก setState ของ React เลย
 * จนกว่าจะปล่อยนิ้ว/เมาส์ — React re-render กลางเจสเจอร์คือสาเหตุอันดับหนึ่งของ
 * อาการกระตุกเวลาลาก
 *
 * คณิตศาสตร์ของการลาก/ปรับขนาดอยู่ที่ lib/richmenu/gesture.ts (ฟังก์ชันบริสุทธิ์
 * ทดสอบแล้วแยกต่างหาก) — ไฟล์นี้มีหน้าที่แค่แปลง pointer event เป็นระยะที่ขยับ
 * (dx/dy หน่วยพิกเซลจริงของผืนภาพ ไม่ใช่พิกเซลบนจอที่ย่อไว้) แล้วส่งเข้าฟังก์ชัน
 * เหล่านั้น ส่วนการเชื่อม pointer/rAF/DOM ตรงนี้ไม่มีเทสต์อัตโนมัติ (jsdom ไม่มี
 * เวลาจริงของ rAF/เลย์เอาต์ให้ตรวจ) ตรวจด้วยตาจริงผ่าน Chrome DevTools Performance
 * panel แทน — คณิตศาสตร์ที่มันเรียกใช้ต่างหากที่มีเทสต์ครบ
 */

export type LayerNodeProps = {
  layer: Layer
  /** พิกเซลจอต่อพิกเซลจริงของผืนภาพ — ผืนใหญ่ 2500px ย่อลงมาแสดงที่จอเท่านี้เท่า */
  scale: number
  /** URL ของภาพ — เฉพาะชั้นภาพ resolve มาจากด้านนอก (Compositor รู้จัก asset ทั้งหมด) */
  imageUrl?: string
  selected: boolean
  canEdit: boolean
  onSelect: () => void
  onCommitBox: (box: Rect) => void
  onCommitText: (text: string) => void
}

type DragState = {
  mode: 'move' | ResizeHandle
  startX: number
  startY: number
  origin: Rect
  raf: number | null
  pending: Rect | null
}

const HANDLE_POSITION: Record<ResizeHandle, CSSProperties> = {
  nw: { top: -5, left: -5, cursor: 'nwse-resize' },
  n: { top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  ne: { top: -5, right: -5, cursor: 'nesw-resize' },
  e: { top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' },
  se: { bottom: -5, right: -5, cursor: 'nwse-resize' },
  s: { bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  sw: { bottom: -5, left: -5, cursor: 'nesw-resize' },
  w: { top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' },
}

const handleStyle: CSSProperties = {
  position: 'absolute', width: 10, height: 10, borderRadius: '50%',
  background: 'var(--panel)', border: '2px solid var(--ink)',
}

export function LayerNode({ layer, scale, imageUrl, selected, canEdit, onSelect, onCommitBox, onCommitText }: LayerNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(layer.type === 'text' ? layer.text : '')

  const applyStyle = (box: Rect) => {
    const el = nodeRef.current
    if (!el) return
    el.style.left = `${box.x * scale}px`
    el.style.top = `${box.y * scale}px`
    el.style.width = `${box.width * scale}px`
    el.style.height = `${box.height * scale}px`
  }

  const beginDrag = (mode: DragState['mode']) => (event: ReactPointerEvent) => {
    if (!canEdit || editing) return
    event.stopPropagation()
    onSelect()
    // jsdom (เทสต์) ไม่มี setPointerCapture — เบราว์เซอร์จริงมีเสมอ แต่กันไว้เผื่อสภาพแวดล้อมที่ไม่รองรับ
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      mode, startX: event.clientX, startY: event.clientY,
      origin: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
      raf: null, pending: null,
    }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current
    if (!state) return
    const dx = (event.clientX - state.startX) / scale
    const dy = (event.clientY - state.startY) / scale
    state.pending = state.mode === 'move'
      ? computeMove(state.origin, dx, dy)
      : computeResize(state.mode, state.origin, dx, dy)

    if (state.raf === null) {
      state.raf = requestAnimationFrame(() => {
        if (drag.current?.pending) applyStyle(drag.current.pending)
        if (drag.current) drag.current.raf = null
      })
    }
  }

  const onPointerUp = () => {
    const state = drag.current
    drag.current = null
    if (state?.pending) onCommitBox(state.pending)
  }

  const commitText = () => {
    setEditing(false)
    if (layer.type === 'text' && draft !== layer.text) onCommitText(draft)
  }

  return (
    <div
      ref={nodeRef}
      data-layer-id={layer.id}
      onPointerDown={beginDrag('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={() => { if (canEdit && layer.type === 'text') setEditing(true) }}
      style={{
        position: 'absolute',
        left: layer.x * scale, top: layer.y * scale, width: layer.width * scale, height: layer.height * scale,
        outline: selected ? '2px solid var(--ink)' : '1px dashed transparent',
        outlineOffset: 1,
        cursor: canEdit ? 'move' : 'default',
        touchAction: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {/*
        เนื้อชั้น (ภาพ/ข้อความ) ต้องถูกตัดให้พอดีกล่อง แต่ overflow:hidden บน div เดียวกับ
        จุดปรับขนาดจะบัง hit-test ของจุดที่ยื่นออกนอกกล่อง (ตำแหน่งติดลบ) ไปด้วย — จุดปรับ
        ขนาดจะกดไม่โดนเลยทั้งที่มองเห็น (เจอจากทดสอบเบราว์เซอร์จริง jsdom ตรวจไม่ได้)
        แยกเป็นชั้นในสำหรับตัด ชั้นนอก (div ด้านบน) ไว้ให้จุดปรับขนาดไม่ถูกตัด
      */}
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        {layer.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl} alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: layer.fit, pointerEvents: 'none' }}
          />
        ) : editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitText}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              width: '100%', height: '100%', resize: 'none', border: 0, padding: 0,
              fontSize: layer.fontSize * scale, fontWeight: layer.bold ? 700 : 400, color: layer.color,
              textAlign: layer.align, background: 'transparent', outline: 'none',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%', fontSize: layer.fontSize * scale,
              fontWeight: layer.bold ? 700 : 400, color: layer.color, textAlign: layer.align,
              overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', pointerEvents: 'none',
            }}
          >
            {layer.text}
          </div>
        )}
      </div>

      {selected && canEdit && RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          data-resize-handle={handle}
          onPointerDown={beginDrag(handle)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ ...handleStyle, ...HANDLE_POSITION[handle] }}
        />
      ))}
    </div>
  )
}
