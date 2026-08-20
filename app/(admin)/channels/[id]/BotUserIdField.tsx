'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { Button, ErrorModal, Field } from '@/components/ui'
import type { FetchBotInfoResult } from '../actions'

/**
 * ช่อง Bot user ID พร้อมปุ่ม "ดึง Bot User ID อัตโนมัติ" — แยกออกมาเป็น client
 * component ต่างหากจากฟิลด์อื่นๆ ของ page.tsx (Server Component) เพราะเป็นจุดเดียวใน
 * ฟอร์มนี้ที่ต้องมี state ของตัวเอง (กำลังดึง / ดึงพลาด) และต้องอ่านค่าที่พิมพ์ไว้ใน
 * ช่อง Channel access token แบบสดๆ ตอนกดปุ่ม โดยไม่ submit ทั้งฟอร์ม
 *
 * เหตุการณ์จริงที่แก้: คนกรอกช่องนี้ผิดเพราะไปก๊อปค่า "Your user ID" จากแท็บ Basic
 * settings ของ LINE Developers Console มา ซึ่งเป็น userId ส่วนตัวของนักพัฒนา ไม่ใช่ของ
 * บอท ทำให้บัญชีจริงตอบ 401 ทุก webhook อยู่หลายชั่วโมงกว่าจะรู้ตัว — ปุ่มนี้เรียก LINE
 * Get Bot Info API แทนคนกรอกเอง ไม่ต้องรู้เรื่องกับดักนี้อีกต่อไป
 *
 * อ่านโทเคนที่พิมพ์ไว้ผ่าน `event.currentTarget.form` แทนที่จะรับเป็น prop ตรงๆ —
 * ช่อง Channel access token เป็น input ธรรมดาของ page.tsx (Server Component) ไม่มี
 * state ของ React ผูกอยู่ (defaultValue เฉยๆ) การอ่านค่าปัจจุบันจริงๆ ต้องอ่านจาก DOM
 * ของฟอร์มที่ครอบอยู่ ไม่ใช่จาก props ที่เรนเดอร์ครั้งแรก — วิธีเดียวกับที่ ActionForm/
 * ChannelForm อ่าน FormData ทั้งฟอร์มตอน submit
 *
 * ปุ่มเป็น type="button" (ค่าเริ่มต้นของ <Button>) จึงไม่ trigger submit ของฟอร์มที่
 * ครอบอยู่ — กดดึงได้โดยไม่ต้องพร้อมบันทึกทั้งฟอร์ม และผลที่ได้แค่เติมช่องให้เห็น ไม่ auto
 * submit ต่อ ให้คนตรวจก่อนกดบันทึกเองเสมอ (ตรงกับสิ่งที่คนเจอปัญหาจริงต้องการ — เห็นค่า
 * ที่ถูกต้องมาเติมให้ ไม่ใช่ระบบเงียบๆ ทำอะไรบางอย่างแทน)
 */

export type BotUserIdFieldProps = {
  /** id ของบัญชีที่กำลังแก้ · null = กำลังสร้างบัญชีใหม่ (ยังไม่มีโทเคนเก็บไว้ในฐานข้อมูลเลย) */
  channelId: string | null
  defaultValue: string
  disabled: boolean
  /** เรียกจริงพร้อม channelId และ FormData ของฟอร์มที่ครอบอยู่ — คืนค่า ไม่ throw */
  action: (channelId: string | null, formData: FormData) => Promise<FetchBotInfoResult>
}

const hintText: ReactNode = (
  <>
    รหัสผู้ใช้ของบอทเอง (userId) — คนละค่ากับ Channel ID ข้างบน LINE ใช้ค่านี้บอกว่า event
    ที่ส่งเข้า webhook มาจากบัญชีไหน ไม่กรอกไว้แล้ว webhook จะหาบัญชีนี้ไม่เจอเลย และปฏิเสธ
    ข้อความทุกข้อความจากบัญชีนี้ทันที ไม่ใช่แค่ตอบว่ากิจกรรมจบไปแล้ว
    <br />
    <b>กดปุ่ม “ดึง Bot User ID อัตโนมัติ” ด้านล่างให้ระบบดึงค่านี้จาก LINE ให้เอง</b> — อย่า
    หาเองจากแท็บ Messaging API ในคอนโซล เพราะแท็บ Basic settings ของ LINE มีช่อง
    “Your user ID” ที่หน้าตาคล้ายกันมาก แต่เป็น userId ส่วนตัวของนักพัฒนา ไม่ใช่ของบอท
    กรอกค่านั้นผิดคือสาเหตุที่บัญชีจริงเคยตอบ 401 ทุก webhook มาแล้ว
  </>
)

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }

const statusStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)' }

export function BotUserIdField({ channelId, defaultValue, disabled, action }: BotUserIdFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [justFilled, setJustFilled] = useState(false)

  async function handleFetch(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    const form = event.currentTarget.form
    if (!form) return

    setError(null)
    setJustFilled(false)
    setBusy(true)
    try {
      const formData = new FormData(form)
      const result = await action(channelId, formData)
      if (result.ok) {
        if (inputRef.current) inputRef.current.value = result.userId
        setJustFilled(true)
      } else {
        setError(result.message)
      }
    } catch (err) {
      // safety net เผื่อ action เองพังแบบไม่คาดคิดจริงๆ — เหตุผลเดียวกับ ActionForm/ChannelForm
      setError(err instanceof Error ? err.message : 'ดึง Bot User ID ไม่สำเร็จ — ลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Field label="Bot user ID" hint={hintText}>
        <input
          ref={inputRef}
          name="line_bot_user_id"
          defaultValue={defaultValue}
          disabled={disabled}
          placeholder="เช่น U1234567890abcdef1234567890abcdef"
          style={{ fontFamily: 'var(--mono)' }}
        />
      </Field>

      <div style={rowStyle}>
        <Button type="button" variant="ghost" onClick={(event) => void handleFetch(event)} disabled={disabled || busy}>
          {busy ? 'กำลังดึง…' : 'ดึง Bot User ID อัตโนมัติ'}
        </Button>
        {justFilled && !busy && (
          <span style={statusStyle} aria-live="polite">ดึงสำเร็จ — ตรวจค่าในช่องด้านบนก่อนกดบันทึก</span>
        )}
      </div>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  )
}
