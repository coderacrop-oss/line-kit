'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { deleteLiffApp, updateLiffApp } from '@/lib/db/liffApps'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/**
 * แก้ LIFF app ที่ลงทะเบียนไว้แล้ว — คืน ActionResult แทนที่จะ throw/redirect ตรงๆ
 * เหตุผลเดียวกับ createLiffAppAction ทุกประการ (ดู ../actions.ts)
 *
 * id ผูกมากับตัว action ผ่าน bind ไม่ใช่ให้ฟอร์มส่งมาเอง เหตุผลเดียวกับ saveChannel
 * ของ ../../channels/actions.ts
 */
export async function updateLiffAppAction(id: string, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('configurator')

    const name = trimmed(formData, 'name')
    if (!name) throw new Error('ต้องตั้งชื่อ LIFF ให้ทีมรู้ว่าเป็นตัวไหน')

    const liffId = trimmed(formData, 'liff_id')
    if (!liffId) throw new Error('ต้องกรอก LIFF ID')

    const lineLoginChannelId = trimmed(formData, 'line_login_channel_id')
    if (!lineLoginChannelId) throw new Error('ต้องกรอก Channel ID ของ LINE Login channel')

    const channelId = trimmed(formData, 'channel_id')
    if (!channelId) throw new Error('ต้องเลือกบัญชี LINE (OA) ที่ LIFF นี้ผูกด้วย')

    // เว้นว่างไว้ = ใช้กุญแจเดิมต่อ — เหตุผลเดียวกับ updateLiffApp() ของ lib/db/liffApps.ts
    const apiKey = trimmed(formData, 'api_key') || null

    await updateLiffApp(db(), id, { name, liffId, lineLoginChannelId, channelId, apiKey })

    revalidatePath('/liff-apps')
    revalidatePath(`/liff-apps/${id}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}

/**
 * ลบ LIFF app — cascade ลบ liff_session ของมันไปด้วยทั้งหมด (migration 0013) ฟอร์มที่
 * เรียก action นี้ต้องยืนยันกับผู้ใช้ก่อนเสมอ (ดู DeleteZone ใน page.tsx) เพราะด่านนี้
 * ไม่มีการเช็ค "ไม่มีใครใช้อยู่" แบบที่ deleteCard ของ ../../campaigns/[id]/cards/actions.ts
 * มี — LIFF app ที่ backend จริงยังเรียกอยู่ก็ลบได้ตรงๆ (ต่างจากการ์ดที่ตรวจ isOrphan ก่อน)
 */
export async function deleteLiffAppAction(id: string): Promise<ActionResult> {
  try {
    await requireRole('configurator')
    await deleteLiffApp(db(), id)
    revalidatePath('/liff-apps')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'ลบไม่สำเร็จ — ลองใหม่') }
  }
}
