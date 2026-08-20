'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorModal } from '@/components/ui'
import type { ActionResult } from '@/lib/actions/result'

/**
 * ฟอร์มผูก/แก้บัญชี LINE ที่แสดง error ของ Server Action ได้จริง — แก้บั๊กที่เจอใน
 * โปรดักชันจริง: คนที่กรอกกุญแจมาแค่ช่องเดียวตอนแก้บัญชี เจอ `saveChannel` ปฏิเสธ
 * (BR-เดิม "กุญแจต้องเปลี่ยนพร้อมกันทั้งสองช่อง") แต่จอเดิมใช้
 * `<form action={saveChannel.bind(...)}>` ตรงๆ ซึ่ง Next.js เซ็นเซอร์ข้อความ error
 * ของ Server Action ทิ้งเสมอในโปรดักชัน กลายเป็นการบันทึกที่ล้มเหลวแบบเงียบๆ —
 * token_last4 ไม่ขยับ ไม่มีข้อความอะไรบอกว่าทำไม (ยืนยันจริงกับ `next build &&
 * next start` แล้ว ไม่ใช่แค่ทฤษฎี — เหมือนที่ ActionForm.tsx ของ Rich Menu และ
 * PublishForm.tsx ของหน้าส่งขึ้น LINE เจอมาแล้วสองครั้งก่อนหน้านี้)
 *
 * ทางที่ได้ผลจริง (เหตุผลเดียวกับสองที่นั้น): ห้าม throw หรือ redirect ข้าม Server
 * Action boundary เด็ดขาด — `saveChannel` คืน `ActionResult` แทน (`{ok:true}` หรือ
 * `{ok:false, message}`) แล้วฟอร์มนี้เรียก action ตรงๆ ผ่าน `onSubmit` (ไม่ใช้
 * `action=`) พออ่านผลลัพธ์แล้วค่อยทำ navigation เองด้วย `router.push('/channels')`
 * — ต่างจาก ActionForm ตรงที่ผลสำเร็จของที่นี่ต้องพาไปหน้ารายการบัญชีจริง ไม่ใช่แค่
 * รีเฟรชหน้าเดิม (เหมือน PublishForm ที่พาไปหน้าใหม่จริงเช่นกัน)
 *
 * ผลข้างเคียงของการเลิกใช้ `action=`: `useFormStatus` (ที่ <Button> ใช้) ไม่ track
 * สถานะ pending ให้อีกต่อไป — ฟอร์มนี้จึงล็อกทุกช่องเองด้วย `<fieldset
 * disabled={busy}>` (ปิดปุ่ม/ช่องกรอกทั้งหมดพร้อมกันทีเดียว รวมถึงปุ่มบันทึกที่เป็น
 * ลูกของฟอร์มอยู่แล้ว ไม่ต้องรู้ว่าอันไหนคือปุ่ม submit) และโชว์ข้อความ "กำลัง
 * บันทึก…" ให้เห็นชัดแทนสปินเนอร์บนปุ่ม
 */

export type ChannelFormProps = {
  /** id ของบัญชีที่กำลังแก้ · null = กำลังสร้างบัญชีใหม่ */
  channelId: string | null
  /** เรียกจริงพร้อม id และ FormData ของฟอร์มนี้ — คืนค่า ไม่ throw/redirect */
  action: (channelId: string | null, formData: FormData) => Promise<ActionResult>
  children: ReactNode
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 }

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

const busyNoteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }

export function ChannelForm({ channelId, action, children }: ChannelFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    // เคลียร์ error ของรอบก่อนตั้งแต่เริ่มรอบใหม่ทันที — เหตุผลเดียวกับ ActionForm/PublishForm
    setError(null)
    setBusy(true)
    try {
      const result = await action(channelId, formData)
      if (result.ok) {
        router.push('/channels')
        // จงใจไม่ setBusy(false) ตรงนี้ — ปุ่มต้องล็อกค้างจนกว่าจอจะเปลี่ยนจริง
        // ไม่ใช่กะพริบกลับมากดซ้ำได้ก่อน router.push จะพาไปหน้ารายการบัญชีเสร็จ
        // (เหตุผลเดียวกับ PublishForm)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      // safety net เผื่อ action เองพังแบบไม่คาดคิดจริงๆ — เหตุผลเดียวกับ ActionForm/PublishForm
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
