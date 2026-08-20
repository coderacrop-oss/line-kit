'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorModal } from '@/components/ui'
import type { ActionResult } from '@/lib/actions/result'
import { getFormOverride } from './formOverride'

/**
 * ฟอร์มที่แสดง error ของ Server Action ได้จริง — แก้บั๊กที่เจอในโปรดักชัน: จอนี้เดิม
 * ใช้ `<form action={serverAction}>` ตรงๆ ซึ่งพอ serverAction throw Next.js จะ
 * "เซ็นเซอร์" ข้อความ error จริงออกในโปรดักชัน กลายเป็นหน้า "Application error:
 * a server-side exception has occurred" ที่ไม่บอกอะไรเลย — ต่อให้ error นั้นเป็นการ
 * ปฏิเสธที่ตั้งใจ (เช่น ERR-037 ภาพเล็กเกินไป) ไม่ใช่บั๊กจริงก็ตาม
 *
 * **สิ่งที่ลองแล้วไม่ได้ผล จริงๆ** (ทดสอบกับ `next build && next start` แล้ว ไม่ใช่
 * แค่ทฤษฎี): ทั้ง `<form action={fn}>` ที่ fn เป็นฟังก์ชันฝั่ง client คอย
 * await/catch เอง และการเรียก action เป็นฟังก์ชันธรรมดาตรงๆ (`onSubmit` +
 * `preventDefault`, ไม่ผ่าน `action=` เลย เหมือน Compositor.tsx's applyChange)
 * ยัง**โดนเซ็นเซอร์ข้อความเหมือนกันทั้งคู่** — Next.js เซ็นเซอร์ข้อความของ error ที่
 * throw ออกจาก Server Action ทิ้งเสมอในโปรดักชัน ไม่ว่าฝั่ง client จะเรียกแบบไหนหรือ
 * catch เองหรือไม่ก็ตาม การเซ็นเซอร์เกิดฝั่งเซิร์ฟเวอร์ตอน serialize error กลับมา
 * ไม่ใช่เรื่องของฝั่ง client เลย
 *
 * **ทางที่ได้ผลจริง**: ห้าม throw ข้าม Server Action boundary เด็ดขาด — ให้ action
 * (createMenu/saveMenu ใน ../actions.ts) คืนค่า `ActionResult` แทน (`{ok:true}` หรือ
 * `{ok:false, message}`) เพราะเป็นแค่ข้อมูลธรรมดาที่ส่งกลับมาในผลลัพธ์ ไม่ใช่
 * exception ที่ผ่าน pipeline เซ็นเซอร์ของ Next.js เลย ฟอร์มนี้เรียก action ตรงๆ
 * ผ่าน `onSubmit` (ไม่ใช้ `action=`) แล้วอ่านค่าที่คืนมา
 *
 * ผลข้างเคียงของการเลิกใช้ `action=`: `useFormStatus` (ที่ <Button> ใช้) ไม่ track
 * สถานะ pending ให้อีกต่อไป เพราะนั่นผูกกับกลไก form-action ของ React โดยเฉพาะ —
 * ฟอร์มนี้จึงล็อกทุกช่องกรอกเองด้วย `<fieldset disabled={busy}>` (ปิดปุ่ม/ช่องกรอก
 * ทั้งหมดของฟอร์มพร้อมกันทีเดียว ไม่ต้องรู้ว่าอันไหนคือปุ่ม submit) และโชว์ข้อความ
 * "กำลังบันทึก…" ให้เห็นชัดแทนสปินเนอร์บนปุ่ม
 *
 * `<fieldset disabled>` ปิดได้แค่ลูกหลานจริงๆ ของมัน — ช่องที่ผูกด้วย `form=` จากนอก
 * ฟอร์ม (เช่น alias/area select ของ MenuCard ใน page.tsx) ไม่ได้เป็นลูกหลานในต้นไม้
 * React จึงไม่ถูกปิดไปด้วย ปุ่ม submit เองยังถูกปิดเสมอ (กันกดซ้ำได้จริง) แก้ระหว่างส่ง
 * ได้แค่ไม่กระทบข้อมูลที่ส่งไปแล้ว (FormData snapshot ไว้ตอน submit) ความเสี่ยงต่ำพอ
 * ที่จะไม่คุ้มความซับซ้อนของการล็อกข้ามต้นไม้ React ผ่าน DOM โดยตรง
 */

export type ActionFormProps = {
  id?: string
  style?: CSSProperties
  /** เรียกจริงพร้อม FormData ของฟอร์มนี้ (รวมช่องที่ผูกด้วย `form=` จากนอกฟอร์มด้วย) — คืนค่า ไม่ throw */
  action: (formData: FormData) => Promise<ActionResult>
  children: ReactNode
}

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

const busyNoteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }

export function ActionForm({ id, style, action, children }: ActionFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const override = getFormOverride(formRef.current)
    if (override) formData.set(override.field, override.file, override.file.name)
    // เคลียร์ error ของรอบก่อนตั้งแต่เริ่มรอบใหม่ทันที — ไม่งั้นส่งซ้ำแล้วสำเร็จ
    // ErrorModal ของรอบที่พังไปแล้วจะยังค้างอยู่ต่อ เพราะไม่มีอะไรไปเคลียร์ให้เอง
    setError(null)
    setBusy(true)
    try {
      const result = await action(formData)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.message)
      }
    } catch (err) {
      // safety net เผื่อ action เองพังแบบไม่คาดคิดจริงๆ (บั๊กที่ทำให้ throw หลุดออกมา
      // แทนที่จะ return ActionResult ตามสัญญา) — ยังต้องไม่ปล่อยเป็น unhandled rejection
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form ref={formRef} id={id} onSubmit={(event) => void handleSubmit(event)} style={style}>
        <fieldset disabled={busy} style={fieldsetStyle}>{children}</fieldset>
        {busy && <p style={busyNoteStyle} aria-live="polite">กำลังบันทึก…</p>}
      </form>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
