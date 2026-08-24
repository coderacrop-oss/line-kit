'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal } from '@/components/ui'
import type { ActionResult } from '@/lib/actions/result'

/**
 * ลบ LIFF app นี้ทิ้งถาวร — cascade เอา liff_session ไปด้วยทั้งหมด (migration 0013)
 * ไม่มีด่าน "ไม่มีใครใช้อยู่" แบบ CardTile (../../campaigns/[id]/cards/CardTile.tsx)
 * มากันไว้ ปุ่มนี้จึงต้องมีด่าน `window.confirm` ของตัวเองก่อนเรียก action จริง —
 * โค้ดฐานนี้ไม่มี modal ยืนยันแบบใช้ซ้ำได้ที่ไหนเลย confirm() ของเบราว์เซอร์เพียงพอ
 * สำหรับปุ่มความถี่ต่ำแบบนี้ ไม่คุ้มสร้างคอมโพเนนต์ modal ใหม่แค่จุดเดียว
 */
export function DeleteLiffAppButton({
  name, action,
}: {
  name: string
  action: () => Promise<ActionResult>
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleClick(): Promise<void> {
    const confirmed = window.confirm(
      `ลบ "${name}" เลยไหม — ข้อมูล session ทั้งหมดที่เก็บไว้ให้ LIFF นี้จะหายไปด้วย กู้คืนไม่ได้`,
    )
    if (!confirmed) return

    setError(null)
    setBusy(true)
    try {
      const result = await action()
      if (result.ok) {
        router.push('/liff-apps')
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="danger" type="button" disabled={busy} onClick={() => void handleClick()}>
        {busy ? 'กำลังลบ…' : 'ลบ LIFF นี้'}
      </Button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
