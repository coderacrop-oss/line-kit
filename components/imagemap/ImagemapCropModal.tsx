'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Button, Modal, Note } from '@/components/ui'
import { imagemapUpscaleWarning } from '@/lib/imagemap/sizes'
import { clampPan, clampZoom, drawOrigin, drawScale, MAX_ZOOM, MIN_ZOOM } from '@/lib/richmenu/crop'

/**
 * ครอบ/จัดกรอบภาพฐานก่อนอัปโหลดจริง — เปิดทันทีที่เลือกไฟล์ เหมือนแนวทางของ
 * components/richmenu/ImagePicker.tsx (มีทางลัด "ใช้ภาพนี้ทั้งภาพ" สำหรับคนที่ไม่อยาก
 * ครอบ)
 *
 * เคยเป็นกรอบสี่เหลี่ยม "สัดส่วนอิสระ" ให้ลาก/ปรับขนาด 8 จุดบนภาพเต็มที่แสดงคงที่
 * (free-aspect rectangular selection) — ผู้ใช้จริงบอกว่างงกับโมเดลนั้น เพราะเครื่องมือ
 * ตัดภาพของ LINE เอง (Rich Message image editor ใน LINE Official Account Manager —
 * ริชเมสเสจชนิดข้อความเดียวกับการ์ด Imagemap ของ LineKit แค่คนละชื่อทางการตลาด) ทำ
 * ตรงข้าม: กรอบนิ่ง ภาพเลื่อน/ซูมได้ใต้กรอบ — เปลี่ยนมาใช้โมเดลนั้นแทนตามที่ตกลงกันไว้
 * ไม่มีขั้นตอน "เลือกสัดส่วนก่อน" ด้วย กรอบล็อกสัดส่วนตามภาพที่อัปโหลดมาเองเสมอ (ที่ซูม
 * 100% ภาพเต็มพอดีกรอบ ไม่มีการครอบตัดเลยเป็นค่าเริ่มต้น) และกรอบเองไม่ปรับขนาดได้ใน
 * รอบนี้ — มีแค่ pan/zoom เท่านั้น
 *
 * โมเดลนี้มีอยู่แล้วในโค้ดเบสนี้เป๊ะๆ — components/richmenu/CropModal.tsx (เครื่องมือ
 * ตัดภาพของ Rich Menu) ใช้กรอบเป้าหมายตายตัว + pan ด้วยการลาก + zoom ด้วย +/-/แถบเลื่อน
 * กับ lib/richmenu/crop.ts (คณิตศาสตร์ล้วนๆ) — ไฟล์นี้ก็อปโมเดลเดียวกันมาตรงๆ ไม่ประดิษฐ์
 * ชุดที่สาม ต่างแค่ target ไม่ใช่ prop ตายตัว (Rich Menu รู้ขนาดผืนเป้าหมายล่วงหน้าเสมอ
 * เช่น 2500×1686) แต่เป็นขนาดจริงของภาพที่เพิ่งอัปโหลด (natural.width/height) เพราะ
 * ริชเมสเสจไม่มีสัดส่วนเป้าหมายตายตัว (ย่อตามสัดส่วนเดิมของภาพที่คนอัปโหลดเอง ดู header
 * comment ของ lib/imagemap/sizes.ts) — lib/richmenu/crop.ts เขียนไว้ generic กับ
 * target ใดๆ อยู่แล้ว (ไม่ผูกกับขนาดเมนู) จึงส่ง natural เข้าไปแทนค่าคงที่ได้ตรงๆ
 * ผลลัพธ์: coverScale(natural, natural) = 1 เสมอ ที่ MIN_ZOOM=1 ภาพวาดที่ขนาดจริงเต็ม
 * ผืนเป้าหมายขนาดจริงพอดี (ไม่มีครอบตัด) — คือ "เต็มพอดีไม่ต้องเลือกสัดส่วนก่อน" ที่ตกลง
 * กันไว้ ซูมเข้าคือเก็บพื้นที่ที่มองเห็นของภาพตัวเองแคบลง (1/zoom เท่า) แล้ว pan เลื่อน
 * ว่าจะเอาส่วนไหน — confirm() วาดภาพที่สเกล/เลื่อนแล้วลงผืน canvas ขนาด
 * natural.width×natural.height เป๊ะ ให้ขอบเขตของ canvas เองเป็นตัวครอบสิ่งที่ล้นออกไป
 * (ไม่ต้องคำนวณ "พื้นที่ที่มองเห็น" แยกต่างหาก) เหมือน CropModal.tsx ทำกับผืนเป้าหมาย
 * จริงเป๊ะ
 *
 * สองจุดที่ไม่ก็อปมาเหมือนเดิม: (1) ริชเมสเสจไม่ปฏิเสธภาพเล็ก (Rich Menu ปฏิเสธที่อื่น
 * ในระบบ — ดู validateLayerImageUpload) เตือนแบบไม่บล็อกด้วย imagemapUpscaleWarning
 * ของ lib/imagemap/sizes.ts แทน (client-safe โดยตั้งใจ ดู header comment ของไฟล์นั้น —
 * ห้าม import จาก generate.ts/lib/richmenu/fit.ts เด็ดขาด ทั้งคู่ลาก @napi-rs/canvas
 * ซึ่งเป็นไบนารีฝั่งเซิร์ฟเวอร์ ติดมาด้วยจะพัง `next build` ตอน bundle ฝั่งเบราว์เซอร์ —
 * เคยพังมาแล้วจริงในโปรเจกต์นี้) คำเตือนต้องสดตามซูมด้วย (ยิ่งซูมเข้า ยิ่งจับความละเอียด
 * จริงของภาพต้นฉบับได้น้อยลง = natural.width/zoom) ไม่ใช่แค่ตอนกดยืนยัน — ซูมเปลี่ยนผ่าน
 * ปุ่ม/แถบเลื่อนเท่านั้น (ไม่ใช่ pointermove ถี่ๆ) setState ตรงๆ ทุกครั้งจึงเร็วพอ ไม่ต้อง
 * พึ่ง requestAnimationFrame แบบที่ pan ใช้ (2) onConfirm ที่นี่รับ File ไม่ใช่ Blob
 * (ImagemapEditor.tsx เรียกใช้แบบนั้นอยู่แล้ว) ห่อ Blob ด้วย
 * `new File([blob], 'cropped.jpg', { type: 'image/jpeg' })` ก่อนส่งกลับเหมือนเดิม
 */

export type ImagemapCropModalProps = {
  open: boolean
  file: File
  onConfirm: (file: File) => void
  onSkip: () => void
  onCancel: () => void
}

const DISPLAY_WIDTH = 480

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

export function ImagemapCropModal({ open, file, onConfirm, onSkip, onCancel }: ImagemapCropModalProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const panRef = useRef<HTMLDivElement>(null)
  const drag = useRef<PanDrag | null>(null)

  // ไฟล์ใหม่ (หรือ modal เปิดใหม่) — สร้าง object URL ใหม่ รีเซ็ตซูม/ตำแหน่ง/ขนาดจริง
  // กลับค่าเริ่มต้นเสมอ (เหมือน CropModal.tsx ของ Rich Menu) ไม่ค้างของภาพก่อนหน้าข้ามภาพ
  //
  // ต้องเป็น useState ไม่ใช่ useRef — เคยเป็น ref มาก่อนแล้วพัง: การแก้ .current ไม่ทำให้
  // React re-render เลย <img src={url.current}> เลยค้างที่ค่าตอน mount ครั้งแรก (undefined
  // เสมอ เพราะ effect ที่ตั้งค่าจริงรันหลัง render แรกไปแล้ว) ภาพเลยไม่โหลด ไม่มีวันยิง
  // onLoad ปุ่มยืนยันเลยปิดค้างตลอด — ของจริงบนเว็บพังแบบนี้เป๊ะๆ ก่อนแก้เป็น state
  useEffect(() => {
    if (!open) return
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    setNatural(null)
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [open, file])

  if (!open) return null

  // กรอบล็อกสัดส่วนตามภาพเสมอ (target === natural) — ระหว่างที่ยังไม่รู้ขนาดจริง ใช้
  // กรอบสี่เหลี่ยมจัตุรัสไปพลางๆ (คำนวณสัดส่วนจริงไม่ได้จนกว่า onLoad จะยิง)
  const displayHeight = natural ? Math.round((DISPLAY_WIDTH * natural.height) / natural.width) : DISPLAY_WIDTH

  const onImgLoad = () => {
    const el = imgRef.current
    if (!el) return
    setNatural({ width: el.naturalWidth, height: el.naturalHeight })
  }

  // ขนาดที่วาดจริงบนกรอบแสดงผล (พิกเซลของ DISPLAY_WIDTH ไม่ใช่พิกเซลผลลัพธ์สุดท้าย) —
  // เหมือน CropModal.tsx เป๊ะ เทียบกับกรอบแสดงผล (สัดส่วนเดียวกับ natural เองเสมอ เพราะ
  // กรอบล็อกสัดส่วนตามภาพ) จึงคูณกลับเป็นพิกเซลจริงได้ตรงๆ ตอนยืนยัน
  const baseDraw = natural
    ? {
      width: natural.width * drawScale(natural, { width: DISPLAY_WIDTH, height: displayHeight }, MIN_ZOOM),
      height: natural.height * drawScale(natural, { width: DISPLAY_WIDTH, height: displayHeight }, MIN_ZOOM),
    }
    : null

  // คำเตือนความกว้างสดตามซูม (ไม่ใช่แค่ตอนกดยืนยัน) — ยิ่งซูมเข้า ยิ่งจับความละเอียด
  // จริงของภาพต้นฉบับได้น้อยลง (natural.width หารด้วย zoom) imagemapUpscaleWarning เป็น
  // แค่คำเตือนไม่บล็อก (ริชเมสเสจไม่ปฏิเสธภาพเล็ก) ต่างจาก Rich Menu ที่ปฏิเสธไว้ที่อื่น
  const warning = natural ? imagemapUpscaleWarning(Math.round(natural.width / zoom)) : null

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
      canvas.width = natural.width
      canvas.height = natural.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('สร้างภาพไม่สำเร็จ — เบราว์เซอร์นี้ไม่รองรับ canvas')

      // ผืนเป้าหมายของการวาดจริงคือ natural เอง (ไม่ใช่กรอบแสดงผล DISPLAY_WIDTH) —
      // ผลลัพธ์จึงมีขนาดเท่าภาพต้นฉบับเป๊ะเสมอไม่ว่าจะซูมเท่าไหร่ (ซูมเข้าคือ resample
      // พื้นที่เล็กลงให้เต็มขนาดผลลัพธ์เท่าเดิม)
      const scale = drawScale(natural, natural, zoom)
      const drawWidth = natural.width * scale
      const drawHeight = natural.height * scale
      const outputScale = natural.width / DISPLAY_WIDTH
      const { dx, dy } = drawOrigin(drawWidth, drawHeight, natural, pan.x * outputScale, pan.y * outputScale)
      ctx.drawImage(imgRef.current, dx, dy, drawWidth, drawHeight)

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
        ลากภาพเพื่อเลื่อน · ใช้ปุ่ม + / − เพื่อซูม — ส่วนที่อยู่ในกรอบคือส่วนที่จะถูกใช้จริง
      </p>

      {warning && <Note tone="warn">{warning}</Note>}

      <div
        data-pan-frame
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
              src={url ?? undefined}
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
          <img ref={imgRef} src={url ?? undefined} alt="" onLoad={onImgLoad} style={{ display: 'none' }} />
        )}
      </div>

      {/* แถบซูมอยู่นอกกรอบที่ overflow:hidden — วางไว้ในกรอบเดียวกันจะจับปุ่มไม่โดนตอนซูมมาก
          (เหมือนบั๊กที่เจอกับจุดปรับขนาดของ LayerNode.tsx — ดู CropModal.tsx) */}
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
            {busy ? 'กำลังครอบภาพ…' : 'ยืนยันการครอบตัด'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
