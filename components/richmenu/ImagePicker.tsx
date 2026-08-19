'use client'

import { useRef, useState } from 'react'
import type { AriaAttributes, ChangeEvent, CSSProperties } from 'react'
import { asLayoutKey, canvasFor, MENU_CANVAS } from '@/lib/richmenu/layouts'
import { CropModal } from './CropModal'
import { setFormOverride } from './formOverride'

export type ImagePickerProps = {
  name: string
  required?: boolean
  accept?: string
  ariaLabel?: string
  /** ผูกกับฟอร์มที่อยู่นอก DOM tree ของตัวเอง — เหมือนที่ช่องอื่นๆ ของจอนี้ทำอยู่แล้ว */
  formId?: string
  /**
   * ขนาดผืนเป้าหมายที่รู้แน่นอนอยู่แล้ว (เช่นตอนแก้ไขเมนูที่ผังคงที่ ไม่ได้เปลี่ยนใน
   * ฟอร์มนี้) — ถ้าไม่ส่งมา จะอ่านจาก `input[name="layout"]:checked` ของฟอร์มเดียวกัน
   * แทน (ตอนสร้างเมนูใหม่ที่ยังเลือกผังไม่นิ่งจนกว่าจะกดสร้าง)
   */
  canvas?: { width: number; height: number }
  id?: string
  style?: CSSProperties
  'aria-invalid'?: AriaAttributes['aria-invalid']
  'aria-describedby'?: string
}

const inputStyle: CSSProperties = { fontSize: 11 }

const previewWrapStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }

/**
 * ช่องเลือกไฟล์ภาพของเมนู — เปิด CropModal ให้ทันทีที่เลือกไฟล์ เพื่อไม่ให้ใครพลาด
 * การครอบตัดอัตโนมัติแบบเดิมโดยไม่รู้ตัว (มีตัวเลือก "ใช้ภาพนี้ทั้งภาพ" สำหรับคนที่
 * อยากได้พฤติกรรมเดิมจริงๆ)
 *
 * ไฟล์ที่ตัดมาแล้วไม่ได้ยัดกลับเข้า `<input type=file>` ตรงๆ (ต้องใช้ DataTransfer
 * ซึ่งเบราว์เซอร์ส่วนใหญ่รองรับแต่ jsdom ไม่รองรับเลย ทำให้เทสต์ไม่ได้) — ลงทะเบียนไว้
 * กับฟอร์มเจ้าของ (`input.form` — ใช้ได้ทั้งตอนซ้อนอยู่จริงและตอนผูกด้วย `form=`)
 * ผ่าน `setFormOverride` (components/richmenu/formOverride.ts) แล้วให้ ActionForm
 * เป็นคนสลับไฟล์ตอน submit จริง
 *
 * ช่อง input เดิมยังต้องมีไฟล์อยู่เสมอ (แม้จะไม่ใช่ไฟล์ที่ส่งจริงในที่สุด) เพื่อให้
 * `required` ของเบราว์เซอร์ยังตรวจสอบได้ตามปกติ — ครอปเป็นชั้นเสริมที่ต่อยอดจาก input
 * เดิม ไม่ใช่แทนที่กลไก validation ที่มีอยู่แล้ว
 */
export function ImagePicker({
  name, required, accept = 'image/png,image/jpeg', ariaLabel, formId, canvas, id, style,
  'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cropTarget, setCropTarget] = useState<{ width: number; height: number } | null>(null)

  function resolveCanvas(input: HTMLInputElement): { width: number; height: number } {
    if (canvas) return canvas
    const checked = input.form?.querySelector<HTMLInputElement>('input[name="layout"]:checked')
    const key = asLayoutKey(checked?.value)
    return key ? canvasFor(key) : MENU_CANVAS.large
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCropTarget(resolveCanvas(event.target))
    setPendingFile(file)
  }

  function closeCrop() {
    setPendingFile(null)
    setCropTarget(null)
  }

  function onConfirm(blob: Blob) {
    const finalFile = new File([blob], 'cropped.jpg', { type: 'image/jpeg' })
    setFormOverride(inputRef.current?.form, { field: name, file: finalFile })
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })
    closeCrop()
  }

  function onSkip() {
    if (pendingFile) {
      setFormOverride(inputRef.current?.form, { field: name, file: pendingFile })
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(pendingFile)
      })
    }
    closeCrop()
  }

  function onCancel() {
    // ยกเลิกครอป — เอาไฟล์ที่เพิ่งเลือกออกจากช่อง input ด้วย ไม่งั้น required จะเห็นว่า
    // "มีไฟล์แล้ว" ทั้งที่ยังไม่ได้ยืนยันอะไรเลย แล้วก็ไม่มี override ให้ส่งจริงตอน submit
    const form = inputRef.current?.form
    if (inputRef.current) inputRef.current.value = ''
    setFormOverride(form, null)
    closeCrop()
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        name={name}
        required={required}
        accept={accept}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        form={formId}
        onChange={onChange}
        style={{ ...inputStyle, ...style }}
      />
      {previewUrl && (
        <div style={previewWrapStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl} alt="ภาพที่ตัดไว้แล้ว"
            style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--rule)' }}
          />
          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>ตัดภาพไว้แล้ว — จะใช้ภาพนี้ตอนบันทึก</span>
        </div>
      )}
      {pendingFile && cropTarget && (
        <CropModal open file={pendingFile} target={cropTarget} onConfirm={onConfirm} onSkip={onSkip} onCancel={onCancel} />
      )}
    </div>
  )
}
