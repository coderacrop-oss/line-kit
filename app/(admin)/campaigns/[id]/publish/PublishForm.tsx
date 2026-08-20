'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal } from '@/components/ui'
import type { PublishResult } from './actions'

/**
 * ฟอร์มส่งขึ้น LINE ที่ตาม redirect ของตัวเองจริงในโปรดักชัน — แก้บั๊กที่เจอมาแล้ว
 * สามครั้ง (v6 · v7 · v9): จอนี้เดิมเป็น `<form action={publish.bind(...)}>` ธรรมดา
 * ซึ่งพึ่งกลไก "ตาม redirect ที่โยนออกจาก Server Action ให้เอง" ของ Next.js — Network
 * panel ทุกครั้งเห็น POST คืน 303 พร้อม `x-action-redirect` ที่ถูกต้อง (เช่น
 * `?done=9`) แต่ฝั่ง client ไม่เคยยิง request ตามไปเลย ปุ่มค้างหมุนตลอดไปทั้งที่การ
 * ส่งขึ้นสำเร็จจริงแล้ว
 *
 * เหตุผลเดียวกับ ActionForm.tsx (createMenu/saveMenu ของ Rich Menu — อ่าน comment
 * เต็มที่นั่น): ห้าม throw หรือ redirect ข้าม Server Action boundary เด็ดขาด ให้
 * `publish()` คืน `PublishResult` แทน แล้วฟอร์มนี้ทำ navigation เองด้วย
 * `router.push()` — ต่างจาก ActionForm ตรงที่ผลสำเร็จของที่นี่ต้องพาไปหน้าใหม่จริง
 * (`?done=N`) ไม่ใช่แค่ `router.refresh()` หน้าเดิม
 *
 * ผลข้างเคียงของการเลิกใช้ `action=` เหมือนกับ ActionForm: `useFormStatus` ของ
 * `<Button>` ไม่ track สถานะ pending ให้อีกต่อไป ฟอร์มนี้จึงล็อกทุกช่องเองด้วย
 * `<fieldset disabled={busy}>` และเปลี่ยนข้อความปุ่มเป็น "กำลังส่งขึ้น LINE…" แทน
 */

export type PublishFormProps = {
  campaignId: string
  channelId: string
  canPublish: boolean
  isProduction: boolean
  /** เรียกจริงพร้อมรหัสแคมเปญและ FormData ของฟอร์มนี้ — คืนค่า ไม่ throw/redirect */
  action: (campaignId: string, formData: FormData) => Promise<PublishResult>
  children: ReactNode
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

export function PublishForm({ campaignId, channelId, canPublish, isProduction, action, children }: PublishFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    // เคลียร์ error ของรอบก่อนตั้งแต่เริ่มรอบใหม่ทันที — เหตุผลเดียวกับ ActionForm
    setError(null)
    setBusy(true)
    try {
      const result = await action(campaignId, formData)
      if (result.ok) {
        router.push(`/campaigns/${campaignId}/publish?done=${result.versionNo}`)
        // จงใจไม่ setBusy(false) ตรงนี้ — ปุ่มต้องล็อกค้างจนกว่าจอจะเปลี่ยนจริง
        // ไม่ใช่กะพริบกลับมากดซ้ำได้ก่อน router.push จะพาไปหน้าใหม่เสร็จ (ซึ่งเป็น
        // งานส่งของจริงเข้า LINE ที่กดซ้ำแล้วเรียกคืนไม่ได้)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      // safety net เผื่อ action เองพังแบบไม่คาดคิดจริงๆ — เหตุผลเดียวกับ ActionForm
      setError(err instanceof Error ? err.message : 'ส่งขึ้น LINE ไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} style={formStyle}>
        <fieldset disabled={busy} style={fieldsetStyle}>
          <input type="hidden" name="channel_id" value={channelId} />
          {children}
          <Button
            type="submit"
            variant={isProduction ? 'danger' : 'primary'}
            disabled={!canPublish || busy}
            style={{ padding: 14, fontSize: 15 }}
          >
            {busy
              ? 'กำลังส่งขึ้น LINE…'
              : (isProduction ? 'ส่งขึ้น LINE — บัญชีจริงของลูกค้า' : 'ส่งขึ้น LINE')}
          </Button>
        </fieldset>
      </form>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
