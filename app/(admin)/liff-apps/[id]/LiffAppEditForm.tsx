'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorModal } from '@/components/ui'
import type { ActionResult } from '@/lib/actions/result'

/**
 * ฟอร์มแก้ LIFF app ที่แสดง error ของ Server Action ได้จริง — โครงเดียวกับ ChannelForm
 * (../../channels/[id]/ChannelForm.tsx) ทุกประการ รวมเหตุผลที่ห้าม `<form action={fn}>`
 * ตรงๆ (Next.js เซ็นเซอร์ข้อความ error ทิ้งเสมอในโปรดักชัน) แยกไฟล์จาก ChannelForm
 * เพราะคนละ id/action ผูกกัน ไม่ใช่ของใช้ร่วมกันได้จริง
 */

export type LiffAppEditFormProps = {
  liffAppId: string
  action: (id: string, formData: FormData) => Promise<ActionResult>
  children: ReactNode
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

const busyNoteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }

export function LiffAppEditForm({ liffAppId, action, children }: LiffAppEditFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)
    setBusy(true)
    try {
      const result = await action(liffAppId, formData)
      if (result.ok) {
        router.push('/liff-apps')
        // จงใจไม่ setBusy(false) — ปุ่มล็อกค้างจนกว่าจอจะเปลี่ยนจริง เหตุผลเดียวกับ ChannelForm
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} style={formStyle}>
        <fieldset disabled={busy} style={fieldsetStyle}>{children}</fieldset>
        {busy && <p style={busyNoteStyle} aria-live="polite">กำลังบันทึก…</p>}
      </form>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
