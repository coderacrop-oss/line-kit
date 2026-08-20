'use client'

import { useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { TapArea } from '@/lib/imagemap/regions'
import { computeMove, computeResize, RESIZE_HANDLES, type Rect, type ResizeHandle } from '@/lib/richmenu/gesture'

/**
 * พื้นที่กดหนึ่งจุดบนภาพริชเมสเสจ — ลาก/ปรับขนาดได้ลื่นแบบเดียวกับ
 * components/richmenu/LayerNode.tsx (M4-S02) ทุกประการ: ระหว่างลาก เขียนตำแหน่งลง
 * สไตล์ของ DOM ตรงๆ ผ่าน ref ทุกเฟรม (requestAnimationFrame) ไม่เรียก setState ของ
 * React เลยจนกว่าจะปล่อยนิ้ว/เมาส์ — คณิตศาสตร์ของการลาก/ปรับขนาดใช้
 * lib/richmenu/gesture.ts ตัวเดียวกันตรงๆ ไม่ประดิษฐ์ชุดที่สอง (พิสูจน์แล้วด้วยเทสต์
 * ของไฟล์นั้นเอง)
 *
 * สองบั๊กที่เจอตอนสร้าง LayerNode.tsx (จับได้จากเบราว์เซอร์จริงเท่านั้น jsdom มองไม่
 * เห็น) ถูกกันไว้ตั้งแต่ต้นที่นี่เหมือนกัน:
 *   1. onClick stopPropagation — ไม่งั้น click ที่ browser ยิงตามหลัง pointerup แม้
 *      จะเพิ่งลากเสร็จ จะลอยขึ้นไปโดน onClick ของพื้นเวที (ล้างการเลือก) ทันที
 *   2. แยกชั้นนอก (ไม่มี overflow:hidden ถือจุดปรับขนาด) กับชั้นใน (overflow:hidden
 *      ถือป้ายชื่อ) — ถ้าจุดปรับขนาดอยู่ชั้นเดียวกับ overflow:hidden จะกดไม่โดนเลย
 *      ทั้งที่มองเห็น (ไม่ใช่แค่มองไม่เห็น)
 */

/**
 * กรอบสี่เหลี่ยมหนึ่งกรอบที่ AreaNode ลาก/ปรับขนาดได้ — TapArea (พื้นที่กด) มีครบ
 * ทุกฟิลด์นี้อยู่แล้วบวก action จึงส่งตรงๆ ได้โดยไม่ต้องแปลง ส่วนพื้นที่เล่นวิดีโอ
 * ของริชวิดีโอ (ไม่มี action) ประกอบ id ปลอมขึ้นมาคู่กับกรอบเพื่อส่งเข้าพร็อพนี้
 */
export type AreaBox = { id: string; x: number; y: number; width: number; height: number }

export type AreaNodeProps = {
  area: AreaBox
  /** ป้ายข้อความในกล่อง — คำนวณจากภายนอก (areaSummary สำหรับพื้นที่กด · ข้อความคงที่สำหรับพื้นที่เล่นวิดีโอ) ไม่ใช่ผูกกับ TapArea.action ตรงๆ */
  label: string
  /** พิกเซลจอต่อพิกเซลจริงของพิกัดอ้างอิง 1040 — ผืนใหญ่ย่อลงมาแสดงที่จอเท่านี้เท่า */
  scale: number
  selected: boolean
  canEdit: boolean
  onSelect: () => void
  onCommitBox: (box: Rect) => void
  /**
   * ขอบเขตพิกัดอ้างอิงของภาพ (1040 กว้าง × baseHeight สูง) — กันไม่ให้ลาก/ปรับขนาด
   * ออกนอกภาพได้เลยตั้งแต่ต้นทาง บั๊กจริงที่เจอในโปรดักชัน: เวที (data-imagemap-stage
   * ใน ImagemapEditor.tsx) ตัดภาพด้วย overflow:hidden จึงมองไม่เห็นว่าพื้นที่กดถูกลาก
   * เลยขอบไปแล้ว แต่ computeMove/computeResize (lib/richmenu/gesture.ts) ไม่ clamp
   * พิกัดให้เอง (คณิตศาสตร์บริสุทธิ์ ไม่รู้จักขอบเขตของภาพ ใช้ร่วมกับ Rich Menu ที่ไม่มี
   * ขอบเขตแบบนี้) ผลคือ onCommitBox ส่งกล่องที่หลุดขอบไปให้ saveDraft (autosave) ซึ่ง
   * validateRect (lib/imagemap/regions.ts) ปฏิเสธด้วย error จริง — ก่อนแก้ error นั้น
   * ถูกเซ็นเซอร์เป็น 500 ดิบๆ ในโปรดักชัน ทำให้ดูเหมือนบั๊กลึกลับ ทั้งที่จริงคือกล่องที่
   * มองไม่เห็นว่าหลุดขอบไปแล้ว — clamp ที่นี่ (จุดเดียวที่รู้ทั้งกล่องที่กำลังลากและขอบเขต
   * จริงของภาพ) ทำให้กล่องที่ผู้ใช้เห็นบนจอกับกล่องที่ถูกส่งไปบันทึกตรงกันเสมอ
   */
  maxWidth: number
  maxHeight: number
}

/** บังคับกล่องให้อยู่ในขอบเขต [0,maxWidth]×[0,maxHeight] เสมอ — ไม่แตะขนาดถ้ากล่องเล็กกว่าเพดานอยู่แล้ว แค่เลื่อนตำแหน่งให้ไม่หลุดขอบ */
function clampToBounds(box: Rect, maxWidth: number, maxHeight: number): Rect {
  const width = Math.min(box.width, maxWidth)
  const height = Math.min(box.height, maxHeight)
  const x = Math.min(Math.max(box.x, 0), maxWidth - width)
  const y = Math.min(Math.max(box.y, 0), maxHeight - height)
  return { x, y, width, height }
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

/** ป้ายสั้นๆ บอกว่ากดแล้วจะเกิดอะไร — ใช้บนกล่องเองและในรายการด้านข้าง */
export function areaSummary(area: TapArea): string {
  return area.action.type === 'uri'
    ? `🔗 ${area.action.label ?? area.action.linkUri}`
    : `💬 ${area.action.label ?? area.action.text}`
}

export function AreaNode({
  area, label, scale, selected, canEdit, onSelect, onCommitBox, maxWidth, maxHeight,
}: AreaNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)

  const applyStyle = (box: Rect) => {
    const el = nodeRef.current
    if (!el) return
    el.style.left = `${box.x * scale}px`
    el.style.top = `${box.y * scale}px`
    el.style.width = `${box.width * scale}px`
    el.style.height = `${box.height * scale}px`
  }

  const beginDrag = (mode: DragState['mode']) => (event: ReactPointerEvent) => {
    if (!canEdit) return
    event.stopPropagation()
    onSelect()
    // jsdom (เทสต์) ไม่มี setPointerCapture — เบราว์เซอร์จริงมีเสมอ แต่กันไว้เผื่อสภาพแวดล้อมที่ไม่รองรับ
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      mode, startX: event.clientX, startY: event.clientY,
      origin: { x: area.x, y: area.y, width: area.width, height: area.height },
      raf: null, pending: null,
    }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current
    if (!state) return
    const dx = (event.clientX - state.startX) / scale
    const dy = (event.clientY - state.startY) / scale
    const raw = state.mode === 'move'
      ? computeMove(state.origin, dx, dy)
      : computeResize(state.mode, state.origin, dx, dy)
    state.pending = clampToBounds(raw, maxWidth, maxHeight)

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

  return (
    <div
      ref={nodeRef}
      data-area-id={area.id}
      onPointerDown={beginDrag('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}
      style={{
        position: 'absolute',
        left: area.x * scale, top: area.y * scale, width: area.width * scale, height: area.height * scale,
        outline: selected ? '2px solid var(--info)' : '1px dashed var(--info)',
        outlineOffset: 1,
        background: selected ? 'rgba(23,117,106,0.28)' : 'rgba(23,117,106,0.14)',
        cursor: canEdit ? 'move' : 'default',
        touchAction: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {/*
        ป้ายชื่อต้องถูกตัดให้พอดีกล่อง แต่ overflow:hidden บน div เดียวกับจุดปรับขนาด
        จะบัง hit-test ของจุดที่ยื่นออกนอกกล่อง (ตำแหน่งติดลบ) ไปด้วย — จุดปรับขนาด
        จะกดไม่โดนเลยทั้งที่มองเห็น (เจอจากทดสอบเบราว์เซอร์จริง jsdom ตรวจไม่ได้)
        แยกเป็นชั้นในสำหรับตัด ชั้นนอก (div ด้านบน) ไว้ให้จุดปรับขนาดไม่ถูกตัด
      */}
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink)', background: 'var(--panel)',
          padding: '2px 5px', display: 'inline-block', maxWidth: '100%', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        >
          {label}
        </div>
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
