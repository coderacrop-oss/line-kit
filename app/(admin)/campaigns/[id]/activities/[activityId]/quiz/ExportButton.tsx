'use client'

import { useState } from 'react'
import { ErrorModal } from '@/components/ui'

export type ExportButtonProps = {
  href: string
  /** ใช้เป็นชื่อไฟล์ดาวน์โหลด fallback กรณีอ่าน filename จาก Content-Disposition ไม่ได้ */
  fallbackFileName: string
}

/**
 * ปุ่ม Export .zip — เดิมเป็น `<a href="…/quiz/export">` เฉยๆ (plain link) ซึ่งพา browser
 * ไปแสดง raw JSON ตรงๆ เวลา route คืน error 400 (เช่น config ยังไม่ครบ) แทนที่จะโชว์ UI error
 * ของแอปเอง (Finding 7 ของรีวิว) เปลี่ยนมาเป็นปุ่มที่ยิง fetch() เอง เช็ค response.ok ก่อน:
 * - สำเร็จ → เอา blob มาสร้าง object URL ชั่วคราว สั่งดาวน์โหลดเอง อยู่หน้าเดิมไม่พาออกไปไหน
 * - ไม่สำเร็จ (400/500 เป็นต้น) → โชว์ ErrorModal เดียวกับที่จออื่นในระบบใช้ พร้อมข้อความ error
 *   จริงจาก response body แทนที่จะโหลดหน้าไปแสดง JSON ดิบ
 */
export function ExportButton({ href, fallbackFileName }: ExportButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        let message = `Export ไม่สำเร็จ (HTTP ${res.status})`
        try {
          const body = await res.json()
          if (body && typeof body.error === 'string') message = body.error
        } catch {
          // response ไม่ใช่ JSON — ใช้ข้อความ fallback ด้านบนต่อไป
        }
        setError(message)
        return
      }

      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') ?? ''
      const match = /filename="?([^"]+)"?/.exec(disposition)
      const fileName = match?.[1] ?? fallbackFileName

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export ไม่สำเร็จ — ลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        style={{
          fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 0, padding: 0,
          cursor: busy ? 'not-allowed' : 'pointer', textDecoration: 'underline', font: 'inherit',
        }}
      >
        {busy ? 'กำลัง Export…' : '↓ Export .zip'}
      </button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
