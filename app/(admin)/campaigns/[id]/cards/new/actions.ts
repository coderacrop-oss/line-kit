'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { SEND_TYPE_OPTIONS, asSendType, createCardFromTemplate } from '@/lib/cards/create'
import { db } from '@/lib/db/client'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * สร้างการ์ดใบใหม่จากชนิดหนึ่งชนิดคูณเทมเพลตหนึ่งตัว
 *
 * ผู้ตั้งค่าแคมเปญเท่านั้น · ผู้ดูแลเนื้อหาแก้ข้อความและภาพบนการ์ดที่มีอยู่แล้วได้
 * แต่การ์ดใบใหม่เป็นโครงสร้างของแคมเปญ ไม่ใช่เนื้อหาในนั้น
 *
 * ชนิดที่สไลซ์นี้ยังไม่เปิดถูกปฏิเสธที่นี่ ไม่ใช่แค่ถูกทำให้กดไม่ได้บนจอ — ตัวเลือก
 * ที่กดไม่ได้คือคำใบ้ ส่วน action คือประตู และ `card.render_as` รับ `imagemap` ได้
 * ตั้งแต่วันแรก การ์ดที่ผ่านเข้ามาได้จึงจะเป็นการ์ดที่ไม่มีตัววาดไหนวาดออกมา
 */
export async function createCard(formData: FormData): Promise<void> {
  await requireRole('configurator')

  const campaignId = trimmed(formData, 'campaign_id')
  const rawSendType = trimmed(formData, 'send_type')
  const sendType = asSendType(rawSendType)

  if (!sendType) {
    const closed = SEND_TYPE_OPTIONS.find((option) => option.value === rawSendType)
    throw new Error(
      closed?.blockedReason
        ? `ยังสร้าง "${closed.name}" ไม่ได้ — ${closed.blockedReason}`
        : 'ยังไม่ได้เลือกชนิดการส่ง',
    )
  }

  const code = trimmed(formData, 'code')

  const { id } = await createCardFromTemplate(db(), {
    campaignId,
    code,
    sendType,
    templateCode: trimmed(formData, 'template_code'),
  })

  revalidatePath(`/campaigns/${campaignId}/cards`)

  // บล็อกเอดิเตอร์ของ M3-S02 มีไฟล์จริงแล้ว (Task 13) — พาไปแก้บล็อกทันทีหลังสร้าง
  // แทนที่จะกลับไปจอรายการแล้วให้คนกดเข้าไปเอง
  redirect(`/campaigns/${encodeURIComponent(campaignId)}/cards/${id}`)
}
