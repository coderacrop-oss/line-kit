'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorModal } from '@/components/ui'
import type { ActionResult } from '@/lib/actions/result'

/**
 * ฟอร์มลงทะเบียน LIFF app ที่แสดง error ของ Server Action ได้จริง — บั๊กเดียวกับที่
 * ChannelForm.tsx (app/(admin)/channels/[id]/ChannelForm.tsx) แก้ไปแล้ว และก่อนหน้านั้น
 * ActionForm.tsx (Rich Menu) กับ PublishForm.tsx (ส่งขึ้น LINE) ก็เจอมาแล้วเหมือนกัน:
 * `<form action={fn}>` ที่เรียก Server Action ตรงๆ ทำให้ Next.js เซ็นเซอร์ข้อความ error
 * ทิ้งเสมอในโปรดักชัน (ยืนยันจริงกับ `next build && next start` แล้ว ไม่ใช่แค่ทฤษฎี) —
 * คนกรอกซ้ำ LIFF ID เดิม หรือเจอ error อื่นจาก DB จะเห็นแค่จอเดิม ไม่มีข้อความอะไรบอกว่า
 * ทำไมรายการไม่โผล่ในลิสต์ด้านล่าง
 *
 * ทางแก้เดียวกับ ChannelForm ทุกประการ: ห้าม throw/redirect ข้าม Server Action boundary
 * — createLiffAppAction คืน ActionResult อยู่แล้ว ฟอร์มนี้จึงเรียก action ตรงๆ ผ่าน
 * `onSubmit` (ไม่ใช้ `action=`) แล้วอ่านผลลัพธ์เอง
 *
 * ต่างจาก ChannelForm ตรงจุดเดียว: จอนี้เป็นจอสร้าง+รายการอยู่หน้าเดียวกัน (v1 ยังไม่มี
 * หน้าแก้ ตาม spec §7) ผลสำเร็จจึงไม่ต้อง router.push ไปหน้าอื่นเหมือน ChannelForm —
 * router.refresh() พอ (รัน Server Component ของหน้านี้ใหม่ ให้ listLiffApps() ดึงแถวที่
 * เพิ่งสร้างมาแสดงในลิสต์) แล้วเคลียร์ฟอร์มด้วย form.reset() ไม่ให้ค้างค่าที่บันทึกไปแล้ว
 * ให้ดูเหมือนยังไม่ได้กด — ผลคือ busy ปลดล็อกทันทีหลังสำเร็จ (ต่างจาก ChannelForm ที่
 * ตั้งใจค้าง busy ไว้จนกว่า router.push จะพาไปหน้าอื่นจริง เพราะที่นี่ไม่มีหน้าอื่นให้รอ)
 */

export type LiffAppFormProps = {
  /** เรียกจริงพร้อม FormData ของฟอร์มนี้ — คืนค่า ActionResult ไม่ throw/redirect */
  action: (formData: FormData) => Promise<ActionResult>
  children: ReactNode
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

const busyNoteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }

export function LiffAppForm({ action, children }: LiffAppFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    // เคลียร์ error ของรอบก่อนตั้งแต่เริ่มรอบใหม่ทันที — เหตุผลเดียวกับ ChannelForm
    setError(null)
    setBusy(true)
    try {
      const result = await action(formData)
      if (result.ok) {
        form.reset()
        router.refresh()
        setBusy(false)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      // safety net เผื่อ action เองพังแบบไม่คาดคิดจริงๆ — เหตุผลเดียวกับ ChannelForm
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
