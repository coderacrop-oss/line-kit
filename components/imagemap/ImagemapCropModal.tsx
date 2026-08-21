'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Button, Modal, Note } from '@/components/ui'
import { imagemapUpscaleWarning } from '@/lib/imagemap/sizes'
import { computeMove, computeResize, RESIZE_HANDLES, type Rect, type ResizeHandle } from '@/lib/richmenu/gesture'

/**
 * ครอบ/จัดกรอบภาพฐานก่อนอัปโหลดจริง — เปิดทันทีที่เลือกไฟล์ เหมือนแนวทางของ
 * components/richmenu/ImagePicker.tsx (มีทางลัด "ใช้ภาพนี้ทั้งภาพ" สำหรับคนที่ไม่อยาก
 * ครอบ) แต่คนละโมเดลการครอบทั้งหมด — CropModal ของ Rich Menu (components/richmenu/
 * CropModal.tsx) ครอบด้วยการ pan/zoom-within-a-fixed-ratio-frame ได้เพราะมีผืนเป้าหมาย
 * ที่รู้ล่วงหน้าเสมอ (canvas ของเมนู 2500×1686 หรือ 2500×843) ส่วนที่นี่ริชเมสเสจไม่มี
 * สัดส่วนเป้าหมายตายตัว (ดู header comment ของ lib/imagemap/sizes.ts — ย่อตามสัดส่วน
 * เดิมของภาพที่คนอัปโหลดเอง ไม่ครอบตัด) จึงเป็นการเลือกกรอบสี่เหลี่ยม "สัดส่วนอิสระ"
 * (free-aspect rectangular selection) บนภาพเต็มแทน — ใช้คณิตศาสตร์ลาก/ปรับขนาดตัวเดียว
 * กับ AreaNode.tsx (lib/richmenu/gesture.ts) เพื่อให้โมเดลการโต้ตอบเหมือนกันทั้งแอป
 * ไม่ประดิษฐ์ชุดที่สี่ (Rich Menu มีสองชุดอยู่แล้ว: LayerNode ลาก/ปรับขนาดชั้น +
 * CropModal ลาก/ซูมแบบ pan-zoom ส่วน AreaNode ของ imagemap เองก็ใช้ตัวเดียวกับที่นี่)
 *
 * ต่างจาก AreaNode ตรงที่ไม่ใช้ requestAnimationFrame + เขียนสไตล์ผ่าน ref ระหว่างลาก
 * — ที่นี่มีกรอบเดียว (ไม่ใช่หลายสิบกล่องพร้อมกันแบบ Compositor ที่ RAF ช่วยกันเฟรมตก)
 * และคำเตือนความกว้าง (imagemapUpscaleWarning) ต้องอัปเดตสดตามกรอบที่กำลังลากอยู่จริง
 * ไม่ใช่แค่ตอนปล่อยนิ้ว — เขียนผ่าน setState ตรงๆ ทุกเฟรมของ pointermove เร็วพอสำหรับ
 * กรอบเดียว และทำให้ข้อความเตือนสดตามได้โดยไม่ต้องเขียนสอง DOM node แยกกันผ่าน ref
 */

export type ImagemapCropModalProps = {
  open: boolean
  file: File
  onConfirm: (file: File) => void
  onSkip: () => void
  onCancel: () => void
}

const DISPLAY_WIDTH = 480
/** ขนาดต่ำสุดของกรอบเลือก หน่วยพิกเซลจอ (DISPLAY_WIDTH) — กันไม่ให้ลากจนกรอบเหลือศูนย์/กลับด้าน */
const MIN_SELECTION_SIZE = 40

type DragState = { mode: 'move' | ResizeHandle; startX: number; startY: number; origin: Rect }

/** บังคับกรอบให้อยู่ในขอบเขต [0,maxWidth]×[0,maxHeight] เสมอ — เหมือน clampToBounds ของ AreaNode.tsx (ไม่มีข้อมูลภาพนอกขอบนี้ให้ครอบ) */
function clampToBounds(box: Rect, maxWidth: number, maxHeight: number): Rect {
  const width = Math.min(box.width, maxWidth)
  const height = Math.min(box.height, maxHeight)
  const x = Math.min(Math.max(box.x, 0), maxWidth - width)
  const y = Math.min(Math.max(box.y, 0), maxHeight - height)
  return { x, y, width, height }
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

export function ImagemapCropModal({ open, file, onConfirm, onSkip, onCancel }: ImagemapCropModalProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const url = useRef<string | null>(null)
  const drag = useRef<DragState | null>(null)

  // ไฟล์ใหม่ (หรือ modal เปิดใหม่) — สร้าง object URL ใหม่ รีเซ็ตกรอบเลือกกลับค่า
  // เริ่มต้นเสมอ (เหมือน CropModal.tsx ของ Rich Menu) ไม่ค้างกรอบของภาพก่อนหน้าข้ามภาพ
  useEffect(() => {
    if (!open) return
    const nextUrl = URL.createObjectURL(file)
    url.current = nextUrl
    setNatural(null)
    setSelection(null)
    return () => {
      URL.revokeObjectURL(nextUrl)
      url.current = null
    }
  }, [open, file])

  if (!open) return null

  const displayHeight = natural ? Math.round(DISPLAY_WIDTH * (natural.height / natural.width)) : 0

  const onImgLoad = () => {
    const el = imgRef.current
    if (!el) return
    const width = el.naturalWidth
    const height = el.naturalHeight
    setNatural({ width, height })
    // ค่าเริ่มต้น: เต็มภาพพอดี — เหมือนไม่ได้ครอบเลยจนกว่าจะลาก ง่ายสุดและคาดเดาได้
    // ไม่ต้องเดาว่าคนอยากได้ตำแหน่งไหนของภาพมาก่อน
    const dispHeight = Math.round(DISPLAY_WIDTH * (height / width))
    setSelection({ x: 0, y: 0, width: DISPLAY_WIDTH, height: dispHeight })
  }

  // อัตราส่วนแปลงพิกัดจอ (DISPLAY_WIDTH) กลับเป็นพิกัดจริงของภาพต้นฉบับ — ใช้ทั้งคำนวณ
  // คำเตือนความกว้าง (สดตามกรอบที่กำลังลาก) และตอนครอปจริงตอนกดยืนยัน
  const scaleToNatural = natural ? natural.width / DISPLAY_WIDTH : 1
  const selectionNaturalWidth = selection ? Math.round(selection.width * scaleToNatural) : 0
  const warning = selection ? imagemapUpscaleWarning(selectionNaturalWidth) : null

  const beginDrag = (mode: DragState['mode']) => (event: ReactPointerEvent) => {
    if (!selection) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { mode, startX: event.clientX, startY: event.clientY, origin: selection }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current
    if (!state) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const raw = state.mode === 'move'
      ? computeMove(state.origin, dx, dy)
      : computeResize(state.mode, state.origin, dx, dy, MIN_SELECTION_SIZE)
    setSelection(clampToBounds(raw, DISPLAY_WIDTH, displayHeight))
  }

  const endDrag = () => { drag.current = null }

  async function confirm(): Promise<void> {
    if (!imgRef.current || !natural || !selection) return
    setBusy(true)
    try {
      const sx = Math.round(selection.x * scaleToNatural)
      const sy = Math.round(selection.y * scaleToNatural)
      const sWidth = Math.round(selection.width * scaleToNatural)
      const sHeight = Math.round(selection.height * scaleToNatural)

      const canvas = document.createElement('canvas')
      canvas.width = sWidth
      canvas.height = sHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('สร้างภาพไม่สำเร็จ — เบราว์เซอร์นี้ไม่รองรับ canvas')
      // ครอปแบบ 1:1 ตรงๆ ไม่มีการซูม/pan ให้คำนวณ (ต่างจาก CropModal ของ Rich Menu ที่
      // ต้องคูณด้วย drawScale/coverScale เพราะมีผืนเป้าหมายตายตัวให้ครอบให้เต็ม) — กรอบที่
      // เลือกไว้คือผลลัพธ์เป๊ะๆ ตัดออกมาที่ความละเอียดต้นฉบับ
      ctx.drawImage(imgRef.current, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight)

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('สร้างภาพไม่สำเร็จ — ลองใหม่'))),
          'image/jpeg', 0.9,
        )
      })
      onConfirm(new File([blob], 'cropped.jpg', { type: 'image/jpeg' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onCancel} title="ครอบ/จัดกรอบภาพฐาน">
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        ลาก/ปรับขนาดกรอบเพื่อเลือกส่วนที่จะใช้ — ริชเมสเสจไม่บังคับสัดส่วนตายตัว ใช้สัดส่วนของกรอบที่เลือกไว้ตรงๆ
      </p>

      {warning && <Note tone="warn">{warning}</Note>}

      <div
        style={{
          position: 'relative', width: DISPLAY_WIDTH, height: displayHeight || DISPLAY_WIDTH,
          background: 'var(--ground)', overflow: 'hidden', margin: '0 auto',
          border: '1px solid var(--rule-2)', borderRadius: 'var(--r)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={url.current ?? undefined}
          alt=""
          draggable={false}
          onLoad={onImgLoad}
          style={{ width: DISPLAY_WIDTH, height: displayHeight || undefined, display: 'block' }}
        />

        {selection && (
          <div
            onPointerDown={beginDrag('move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              position: 'absolute',
              left: selection.x, top: selection.y, width: selection.width, height: selection.height,
              outline: '2px solid var(--info)', outlineOffset: -1,
              background: 'rgba(23,117,106,0.14)',
              cursor: 'move', touchAction: 'none', userSelect: 'none', boxSizing: 'border-box',
            }}
          >
            {RESIZE_HANDLES.map((handle) => (
              <div
                key={handle}
                data-resize-handle={handle}
                onPointerDown={beginDrag(handle)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ ...handleStyle, ...HANDLE_POSITION[handle] }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" variant="ghost" onClick={onSkip}>ใช้ภาพนี้ทั้งภาพ</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onCancel}>ยกเลิก</Button>
          <Button type="button" onClick={() => void confirm()} disabled={!selection || busy}>
            {busy ? 'กำลังครอบภาพ…' : 'ยืนยันการครอบตัด'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
