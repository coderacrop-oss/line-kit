'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { createLiffApp } from '@/lib/db/liffApps'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/**
 * คืน ActionResult แทนที่จะ throw/redirect ตรงๆ — ทางเดียวกับ saveChannel
 * (app/(admin)/channels/actions.ts) เพราะเหตุผลเดียวกัน: Next.js เซ็นเซอร์ข้อความของ
 * error ที่ throw ออกจาก Server Action ทิ้งเสมอในโปรดักชัน
 */
export async function createLiffAppAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('configurator')

    const name = trimmed(formData, 'name')
    if (!name) throw new Error('ต้องตั้งชื่อ LIFF ให้ทีมรู้ว่าเป็นตัวไหน')

    const liffId = trimmed(formData, 'liff_id')
    if (!liffId) throw new Error('ต้องกรอก LIFF ID')

    const lineLoginChannelId = trimmed(formData, 'line_login_channel_id')
    if (!lineLoginChannelId) throw new Error('ต้องกรอก Channel ID ของ LINE Login channel')

    const channelId = trimmed(formData, 'channel_id')
    if (!channelId) throw new Error('ต้องเลือกบัญชี LINE (OA) ที่ LIFF นี้ผูกด้วย')

    const apiKey = trimmed(formData, 'api_key')
    if (!apiKey) throw new Error('ต้องตั้ง API key ให้ backend ของ LIFF ใช้เรียกกลับมา')

    await createLiffApp(db(), { name, liffId, lineLoginChannelId, channelId, apiKey, createdBy: session.userId })

    revalidatePath('/liff-apps')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}
