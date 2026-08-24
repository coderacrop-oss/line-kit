'use client'

import { useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui'

const rowStyle: CSSProperties = { display: 'flex', gap: 6 }

const inputStyle: CSSProperties = { flex: 1, fontFamily: 'var(--mono)' }

/**
 * ก่อนหน้านี้ต้องคิดค่า API key เอาเองแล้วพิมพ์ใส่ช่อง password — ไม่มีทางรู้ว่า
 * ค่าที่คิดมันสุ่ม/ยาวพอจะเดายากจริงไหม ปุ่ม "สุ่ม" นี้ใช้ crypto.getRandomValues
 * (เข้ารหัสแรงพอสำหรับกุญแจ ต่างจาก Math.random) สร้าง hex 64 ตัวอักษรแทน — เปิดเป็น
 * ช่อง text ธรรมดา (ไม่ใช่ password) เพราะจุดประสงค์คือให้ก็อปไปวางที่อื่นได้ ซ่อนไว้
 * ไม่มีประโยชน์และหมายเหตุข้างล่างฟอร์มก็บอกอยู่แล้วว่าดูค่าเต็มซ้ำไม่ได้หลังบันทึก
 *
 * `required` เป็น false ตอนใช้ในจอแก้ (../[id]/page.tsx) — เว้นว่างไว้ตอนแก้แปลว่า
 * "ใช้กุญแจเดิมต่อ" เหตุผลเดียวกับช่องกุญแจของ ChannelForm (../../channels/[id]/page.tsx)
 */
export function ApiKeyField({ required = true }: { required?: boolean }) {
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)

  function handleGenerate() {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    setValue(hex)
    setCopied(false)
  }

  async function handleCopy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div style={rowStyle}>
      <input
        name="api_key"
        required={required}
        value={value}
        onChange={(event) => { setValue(event.target.value); setCopied(false) }}
        style={inputStyle}
      />
      <Button type="button" variant="ghost" onClick={handleGenerate}>สุ่ม</Button>
      <Button type="button" variant="ghost" onClick={() => void handleCopy()} disabled={!value}>
        {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
      </Button>
    </div>
  )
}
