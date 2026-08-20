'use client'

import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button } from './Button'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

const backdropStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(17, 17, 17, .5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20, zIndex: 1000,
}

const dialogStyle: CSSProperties = {
  background: 'var(--panel)', borderRadius: 'var(--r-lg)', border: '1px solid var(--rule)',
  boxShadow: '0 8px 30px rgba(17, 17, 17, .25)',
  padding: 20, maxWidth: 480, width: '100%', maxHeight: '85vh', overflow: 'auto',
  display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box',
}

const titleStyle: CSSProperties = { fontSize: 16, fontWeight: 600, margin: 0 }

/**
 * กล่องลอยกลางจอ — ไม่มีอยู่ในระบบนี้มาก่อน จนกว่าจอ Rich Menu ต้องการที่แสดงข้อความ
 * error ของ Server Action แบบไม่หลุดหายไปกับหน้า "Application error" ของ Next.js
 *
 * ปิดได้สามทาง: กด Escape · คลิกที่ฉากหลัง · หรือปุ่มที่เนื้อหาข้างในส่งมาเอง (เช่น
 * ปุ่ม "ปิด" ของ ErrorModal) — Modal เองไม่ยัดปุ่มปิดตายตัวให้ เพราะเนื้อหาบางแบบอยากคุม
 * ตำแหน่ง/ป้ายของปุ่มเอง
 *
 * ไม่ใช้ portal — วางเป็น position:fixed ตรงจุดที่ถูกเรียกใช้ ก็ลอยเต็มจอได้เหมือนกัน
 * โดยไม่ต้องพึ่ง createPortal/document.body ซึ่งเพิ่มเงื่อนไข SSR ที่ไม่จำเป็นสำหรับ
 * ขนาดของปัญหานี้ — ทุกจอที่ใช้ Modal ในระบบนี้ไม่มีบรรพบุรุษที่ตั้ง transform/overflow
 * บีบพื้นที่จนบัง fixed positioning
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const titleId = title ? 'modal-title' : undefined

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
      >
        {title && <h2 id={titleId} style={titleStyle}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}

export type ErrorModalProps = {
  /** ข้อความ error ที่จับมาได้ · `null` = ยังไม่มี error ให้แสดง (Modal ปิดอยู่เอง) */
  message: string | null
  onClose: () => void
}

/**
 * ตัวห่อเฉพาะสำหรับข้อความ error ที่จับมาจาก Server Action — คู่กับ pattern
 * `try { await action(...) } catch (err) { setError(err.message) }` ที่
 * Compositor.tsx วางไว้แล้ว เปลี่ยนแค่ปลายทางจาก `<Note tone="danger">` แบบฝังอยู่
 * ในหน้า มาเป็นกล่องลอยกลางจอที่คนต้องเห็นแน่ๆ ก่อนจะกลับไปทำอย่างอื่นต่อ
 */
export function ErrorModal({ message, onClose }: ErrorModalProps) {
  return (
    <Modal open={message !== null} onClose={onClose} title="เกิดข้อผิดพลาด">
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--ink)' }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="button" onClick={onClose}>ปิด</Button>
      </div>
    </Modal>
  )
}
