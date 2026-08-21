'use client'

import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { Field, Note } from '@/components/ui'

const fileButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)',
}

export type ImageBlockFieldProps = {
  campaignId: string
  cardId: string
  blockId: string
  defaultValue: string
  disabled: boolean
  uploadAction: (
    campaignId: string, cardId: string, formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; message: string }>
}

/**
 * ช่อง URL ภาพของบล็อกภาพ + ปุ่มอัปโหลดตรง — แทนที่การออกไปคลังภาพ (คลังภาพของ
 * แคมเปญ) ก่อนแล้วก็อป URL กลับมาวาง
 *
 * ไม่มี `<form>` ของตัวเอง — `<input name="content">` ที่นี่เป็นช่องหนึ่งของฟอร์ม
 * บันทึกบล็อกที่ครอบอยู่ (BlockForm.tsx) ยังต้องกด "บันทึกบล็อกนี้" เองเสมอหลัง
 * อัปโหลดสำเร็จ — ปุ่มอัปโหลดที่นี่ทำแค่ auto-fill ช่อง ไม่ submit ฟอร์มแทน จึงต้องใช้
 * ค่าคุมเอง (useState) แทน defaultValue เฉยๆ เพื่อเซ็ตค่าใหม่ให้ input ได้หลังอัปโหลด
 */
export function ImageBlockField({
  campaignId, cardId, blockId, defaultValue, disabled, uploadAction,
}: ImageBlockFieldProps) {
  const [value, setValue] = useState(defaultValue)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputId = useId()

  async function onFileSelected(file: File): Promise<void> {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const result = await uploadAction(campaignId, cardId, formData)
      if (!result.ok) {
        // ไม่ล้างค่าเดิมในช่องเมื่ออัปโหลดพัง — คนอาจพิมพ์/วาง URL ไว้อยู่แล้วก่อนลองอัปโหลด
        setError(result.message)
        return
      }
      setValue(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดภาพไม่สำเร็จ — ลองใหม่')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <Field label="URL ภาพ (บังคับ)" hint="ก็อป URL จากคลังภาพของแคมเปญนี้มาวาง หรืออัปโหลดตรงจากปุ่มด้านล่าง">
        <input
          name="content" value={value} disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>

      {!disabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor={`${fileInputId}-${blockId}`} style={{ ...fileButtonStyle, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'กำลังอัปโหลด…' : '+ อัปโหลดภาพ'}
            <input
              id={`${fileInputId}-${blockId}`}
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
