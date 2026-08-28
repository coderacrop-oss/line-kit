'use client'

import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { Field, Note } from '@/components/ui'

const fileButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)',
}

export type ImageUrlUploadFieldProps = {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (url: string) => void
  disabled: boolean
  campaignId: string
  activityId: string
  uploadAction: (
    campaignId: string, activityId: string, formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; message: string }>
}

/**
 * ช่อง URL ภาพ + ปุ่มอัปโหลดตรง สำหรับฟอร์มควิซ (แกน/ผลลัพธ์/archetype กลุ่ม) —
 * เหมือน components/cards/ImageBlockField.tsx ทุกกลไก ต่างกันแค่เป็น controlled
 * component (value/onChange จากผู้เรียก) แทน uncontrolled name/defaultValue เพราะ
 * ฟอร์มควิซเก็บ QuizConfig ทั้งก้อนไว้เป็น client state เอง ไม่ได้อ่านค่าจาก FormData
 * ตอน submit แบบฟอร์มบล็อกการ์ด
 */
export function ImageUrlUploadField({
  id, label, hint, value, onChange, disabled, campaignId, activityId, uploadAction,
}: ImageUrlUploadFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputId = useId()

  async function onFileSelected(file: File): Promise<void> {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const result = await uploadAction(campaignId, activityId, formData)
      if (!result.ok) {
        // ไม่ล้างค่าเดิมในช่องเมื่ออัปโหลดพัง — คนอาจพิมพ์/วาง URL ไว้อยู่แล้วก่อนลองอัปโหลด
        setError(result.message)
        return
      }
      onChange(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดภาพไม่สำเร็จ — ลองใหม่')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <Field id={id} label={label} hint={hint}>
        <input
          value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      {!disabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor={`${fileInputId}-file`} style={{ ...fileButtonStyle, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'กำลังอัปโหลด…' : '+ อัปโหลดภาพ'}
            <input
              id={`${fileInputId}-file`}
              type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onFileSelected(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {error && <Note tone="danger" style={{ fontSize: 11 }}>{error}</Note>}
    </>
  )
}
