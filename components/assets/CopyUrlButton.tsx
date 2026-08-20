'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui'

export type CopyUrlButtonProps = {
  /** asset.publicUrl — ค่าที่ configurator ต้องก็อปไปวางเป็น image URL ของ card block */
  url: string
}

/** เวลาที่ข้อความ "คัดลอกแล้ว" ค้างอยู่ก่อนกลับเป็นปุ่มปกติ */
const CONFIRM_MS = 1600

const fallbackNoteStyle: CSSProperties = {
  fontSize: 10, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.5,
}

const fallbackInputStyle: CSSProperties = {
  width: '100%', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)',
  padding: '5px 7px', fontSize: 10, fontFamily: 'var(--mono)',
  background: 'var(--ground)', color: 'var(--ink)', marginTop: 5,
}

/**
 * จุดเดียวในหน้าคลังภาพที่มี state ฝั่ง client — ทั้งใบเป็น Server Component
 * (ดูคอมเมนต์หัว page.tsx) ยกเว้นปุ่มนี้ที่ต้องเรียก navigator.clipboard ซึ่งทำได้
 * เฉพาะฝั่ง browser เท่านั้น
 *
 * แก้ช่องว่างที่หน้าอื่นบอกให้ "ก็อป URL จากคลังภาพมาวาง" แต่คลังภาพเองไม่มีทาง
 * ก็อปให้เลย — ผู้ใช้เดิมต้องคลิกขวา "copy image address" ซึ่งใช้ไม่ได้บนมือถือ/แท็บเล็ต
 *
 * navigator.clipboard.writeText ปฏิเสธได้จริง (ไม่ใช่ secure context, embed เก่าที่
 * ไม่ให้สิทธิ์คลิปบอร์ด) — ตกไปที่ช่อง URL แบบ readonly ที่เลือกข้อความให้เองแทน
 * ผู้ใช้กด Cmd/Ctrl+C เองได้ ไม่ใช่ทางตันเงียบๆ · สถานะนี้ไม่หายไปเองเหมือน "คัดลอกแล้ว"
 * เพราะผู้ใช้ต้องมีเวลาพอจะกดเลือก/คัดลอกด้วยมือ
 */
export function CopyUrlButton({ url }: CopyUrlButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const fallbackRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (status !== 'copied') return
    const timer = setTimeout(() => setStatus('idle'), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (status === 'error') fallbackRef.current?.select()
  }, [status])

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(url)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div>
      <Button
        variant="ghost"
        type="button"
        onClick={handleClick}
        style={{ width: '100%', padding: 7, fontSize: 11 }}
      >
        {status === 'copied' ? 'คัดลอกแล้ว ✓' : 'คัดลอก URL'}
      </Button>
      {status === 'error' && (
        <>
          <div style={fallbackNoteStyle}>คัดลอกอัตโนมัติไม่ได้ · เลือกข้อความแล้วคัดลอกเอง</div>
          <input
            ref={fallbackRef}
            readOnly
            value={url}
            aria-label="URL ของภาพ"
            onFocus={(event) => event.currentTarget.select()}
            style={fallbackInputStyle}
          />
        </>
      )}
    </div>
  )
}
