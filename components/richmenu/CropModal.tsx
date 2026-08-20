'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Button, Modal } from '@/components/ui'
import { clampPan, clampZoom, drawOrigin, drawScale, MAX_ZOOM, MIN_ZOOM } from '@/lib/richmenu/crop'

/**
 * เครื่องมือตัดภาพก่อนอัปโหลด (M4-S01) — ให้คนเลือกเองว่าจะเก็บส่วนไหนของภาพไว้
 * ในผืนเป้าหมาย แทนที่ให้ `fitImageToCanvas` ฝั่งเซิร์ฟเวอร์ครอบตัดจากกึ่งกลางให้
 * อัตโนมัติเสมอ (ดู lib/richmenu/fit.ts) — ครอปไม่ได้ช่วยภาพที่เล็กเกินไปจริงๆ
 * (ERR-037 ยังปฏิเสธได้เหมือนเดิมถ้าส่วนที่เลือกไว้ยังเล็กกว่าที่ขยายได้) มันแค่ให้
 * เลือก "ส่วนไหน" ของภาพที่ใหญ่พอแล้ว
 *
 * ลาก/ซูมลื่นด้วยวิธีเดียวกับ LayerNode.tsx (M4-S02 Compositor): ระหว่างเจสเจอร์
 * เขียนตำแหน่งลง CSS transform ของ DOM ตรงๆ ผ่าน ref ทุกเฟรม (requestAnimationFrame)
 * ไม่เรียก setState เลยจนกว่าจะปล่อย — แยกเป็นสองชั้น (ชั้นนอก translate = pan · ชั้นใน
 * scale = zoom) เพื่อให้ลากตามนิ้ว/เมาส์ได้ 1:1 พิกเซลเสมอไม่ว่าจะซูมอยู่เท่าไหร่
 * (`translate() scale()` ผสมกันเข้าระบบพิกัดเดียวกันจะทำให้ลากช้า/เร็วกว่านิ้วตอนซูมอยู่)
 *
 * เหมือน LayerNode.tsx สองจุด: (1) click ที่ตามหลัง pointerdown/pointerup บนชิ้นเดียวกัน
 * ต้อง stopPropagation ไม่งั้นไหลขึ้นไปโดน onClick ของฉากหลัง Modal (ปิดเอง) (2) ปุ่ม
 * ซูมต้องไม่อยู่ใต้ overflow:hidden เดียวกับกรอบตัดภาพ ไม่งั้น hit-test พัง (จับไม่โดน
 * ทั้งที่มองเห็น) — ที่นี่กรอบตัดภาพกับแถบควบคุมซูมจึงเป็นคนละกล่องกัน
 */

export type CropModalProps = {
  open: boolean
  file: File
  target: { width: number; height: number }
  onConfirm: (blob: Blob) => void
  onSkip: () => void
  onCancel: () => void
}

const DISPLAY_WIDTH = 380

type PanState = { x: number; y: number }

type PanDrag = {
  startClientX: number
  startClientY: number
  origin: PanState
  raf: number | null
  pending: PanState | null
}

const frameStyle = (displayHeight: number): CSSProperties => ({
  position: 'relative', width: DISPLAY_WIDTH, height: displayHeight,
  overflow: 'hidden', background: 'var(--ground)', borderRadius: 'var(--r)',
  border: '1px solid var(--rule-2)', margin: '0 auto', touchAction: 'none', cursor: 'grab',
})

export function CropModal({ open, file, target, onConfirm, onSkip, onCancel }: CropModalProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  const panRef = useRef<HTMLDivElement>(null)
  const url = useRef<string | null>(null)
  const drag = useRef<PanDrag | null>(null)

  const displayHeight = Math.round((DISPLAY_WIDTH * target.height) / target.width)

  // ไฟล์ใหม่ (หรือ modal เปิดใหม่) — สร้าง object URL ใหม่ รีเซ็ตซูม/ตำแหน่งกลับ
  // ค่าเริ่มต้นเสมอ ไม่ใช้ pan/zoom ของภาพก่อนหน้าค้างข้ามภาพ
  useEffect(() => {
    if (!open) return
    const nextUrl = URL.createObjectURL(file)
    url.current = nextUrl
    setNatural(null)
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
    return () => {
      URL.revokeObjectURL(nextUrl)
      url.current = null
    }
  }, [open, file])

  if (!open) return null

  const onImgLoad = () => {
    const el = imgRef.current
    if (!el) return
    setNatural({ width: el.naturalWidth, height: el.naturalHeight })
  }

  // ขนาดที่วาดจริงบนกรอบแสดงผล (พิกเซลของ DISPLAY_WIDTH ไม่ใช่พิกเซลผลลัพธ์สุดท้าย)
  // ใช้ coverScale เดียวกับ fit.ts เทียบกับกรอบที่แสดง — สัดส่วนเดียวกับผืนเป้าหมายเป๊ะ
  // (target กับกรอบแสดงผลเป็นอัตราส่วนเดียวกันเสมอ) จึงคูณกลับเป็นพิกเซลจริงได้ตรงๆ
  const baseDraw = natural
    ? { width: natural.width * drawScale(natural, { width: DISPLAY_WIDTH, height: displayHeight }, MIN_ZOOM), height: natural.height * drawScale(natural, { width: DISPLAY_WIDTH, height: displayHeight }, MIN_ZOOM) }
    : null

  const applyPanStyle = (nextPan: PanState) => {
    if (panRef.current) panRef.current.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px)`
  }

  const clampedPan = (candidate: PanState, currentZoom: number): PanState => {
    if (!baseDraw) return { x: 0, y: 0 }
    const drawW = baseDraw.width * currentZoom
    const drawH = baseDraw.height * currentZoom
    return {
      x: clampPan(candidate.x, drawW, DISPLAY_WIDTH),
      y: clampPan(candidate.y, drawH, displayHeight),
    }
  }

  const onPointerDownFrame = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      startClientX: event.clientX, startClientY: event.clientY,
      origin: pan, raf: null, pending: null,
    }
  }

  const onPointerMoveFrame = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const dx = event.clientX - state.startClientX
    const dy = event.clientY - state.startClientY
    state.pending = clampedPan({ x: state.origin.x + dx, y: state.origin.y + dy }, zoom)

    if (state.raf === null) {
      state.raf = requestAnimationFrame(() => {
        if (drag.current?.pending) applyPanStyle(drag.current.pending)
        if (drag.current) drag.current.raf = null
      })
    }
  }

  const onPointerUpFrame = () => {
    const state = drag.current
    drag.current = null
    if (state?.pending) setPan(state.pending)
  }

  const stepZoom = (delta: number) => {
    const next = clampZoom(zoom + delta)
    const nextPan = clampedPan(pan, next)
    setZoom(next)
    setPan(nextPan)
  }

  async function confirm(): Promise<void> {
    if (!imgRef.current || !natural) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = target.width
      canvas.height = target.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('สร้างภาพไม่สำเร็จ — เบราว์เซอร์นี้ไม่รองรับ canvas')

      const scale = drawScale(natural, target, zoom)
      const drawWidth = natural.width * scale
      const drawHeight = natural.height * scale
      // แปลงระยะเลื่อนจากพิกเซลของกรอบแสดงผล (DISPLAY_WIDTH) เป็นพิกเซลของผืนผลลัพธ์จริง
      const outputScale = target.width / DISPLAY_WIDTH
      const { dx, dy } = drawOrigin(drawWidth, drawHeight, target, pan.x * outputScale, pan.y * outputScale)
      ctx.drawImage(imgRef.current, dx, dy, drawWidth, drawHeight)

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('สร้างภาพไม่สำเร็จ — ลองใหม่'))),
          'image/jpeg', 0.9,
        )
      })
      onConfirm(blob)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onCancel} title="จัดตำแหน่งภาพ">
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        ลากภาพเพื่อเลื่อน · ใช้ปุ่ม + / − เพื่อซูม — ส่วนที่อยู่ในกรอบคือส่วนที่จะถูกใช้จริง
        ({target.width}×{target.height})
      </p>

      <div
        style={frameStyle(displayHeight)}
        onPointerDown={onPointerDownFrame}
        onPointerMove={onPointerMoveFrame}
        onPointerUp={onPointerUpFrame}
        onPointerCancel={onPointerUpFrame}
        onClick={(event) => event.stopPropagation()}
      >
        {baseDraw && (
          <div
            ref={panRef}
            style={{
              position: 'absolute',
              left: (DISPLAY_WIDTH - baseDraw.width) / 2, top: (displayHeight - baseDraw.height) / 2,
              width: baseDraw.width, height: baseDraw.height,
              transform: `translate(${pan.x}px, ${pan.y}px)`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={url.current ?? undefined}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                width: '100%', height: '100%', display: 'block',
                transformOrigin: '50% 50%', transform: `scale(${zoom})`, userSelect: 'none',
              }}
            />
          </div>
        )}
        {!natural && (
          // ต้องมี <img> อยู่จริงในเอกสารตั้งแต่แรกเพื่อให้ onLoad ยิง — ระหว่างที่ยังไม่รู้
          // ขนาดต้นฉบับ (naturalWidth/Height) วาดซ่อนไว้ก่อน คำนวณตำแหน่งไม่ได้จนกว่าจะรู้ขนาด
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imgRef} src={url.current ?? undefined} alt="" onLoad={onImgLoad} style={{ display: 'none' }} />
        )}
      </div>

      {/* แถบซูมอยู่นอกกรอบที่ overflow:hidden — วางไว้ในกรอบเดียวกันจะจับปุ่มไม่โดนตอนซูมมาก
          (เหมือนบั๊กที่เจอกับจุดปรับขนาดของ LayerNode.tsx) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Button type="button" variant="ghost" disabled={!natural || zoom <= MIN_ZOOM} onClick={() => stepZoom(-0.25)}>− ซูมออก</Button>
        <input
          type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
          disabled={!natural}
          onChange={(event) => {
            const next = clampZoom(Number(event.target.value))
            setZoom(next)
            setPan(clampedPan(pan, next))
          }}
          aria-label="ซูม"
          style={{ width: 140 }}
        />
        <Button type="button" variant="ghost" disabled={!natural || zoom >= MAX_ZOOM} onClick={() => stepZoom(0.25)}>+ ซูมเข้า</Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" variant="ghost" onClick={onSkip}>ใช้ภาพนี้ทั้งภาพ</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onCancel}>ยกเลิก</Button>
          <Button type="button" onClick={() => void confirm()} disabled={!natural || busy}>
            {busy ? 'กำลังตัดภาพ…' : 'ยืนยันตำแหน่ง'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
