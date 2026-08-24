'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { requireDraftCampaign } from '../../actions'

// ZodError.message เป็น JSON ดิบยาวๆ ไม่ใช่ข้อความให้คนอ่าน — ต่อ .issues เป็นบรรทัดเดียว
// อ่านง่ายแทน เหตุผลเดียวกับที่ทุกฟอร์มอื่นในระบบเขียน error message เองเป็นภาษาไทย
// ไม่ปล่อยให้ error ดิบหลุดไปหาคนกรอกฟอร์ม
const resultMessage = (err: unknown, fallback: string): string => {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ')
  }
  return err instanceof Error ? err.message : fallback
}

/**
 * บันทึกเนื้อหาควิซบุคลิกภาพทั้งชุด (mode/axes/questions/results) เป็นก้อนเดียว
 *
 * รับ FormData ที่มีช่องเดียวคือ `config` เป็น JSON ของ QuizConfig ทั้งก้อน — ไม่ใช่
 * flat field ต่อค่าแบบฟอร์มอื่นในระบบ เหตุผลเต็มอยู่ที่คอมเมนต์ของ QuizConfigForm.tsx
 *
 * WHERE ผูก campaign_id และ input_type = 'personality_quiz' ไว้ด้วยโดยตั้งใจ — แม้ id
 * จาก URL จะไม่น่าตรงกับกิจกรรมชนิดอื่นหรือแคมเปญอื่นได้เลยในทางปกติ แต่ด่านนี้ปฏิเสธ
 * การเขียนทับ input_config ของกิจกรรมชนิดอื่น/แคมเปญอื่นไว้อีกชั้น ไม่ไว้ใจแค่สิ่งที่
 * URL บอก — เหมือน requireActivity() ของ ../../actions.ts ที่ผูก campaign_id เสมอ
 *
 * เรียก requireDraftCampaign() ก่อนเขียนเสมอ (BR-05) — action นี้เคยเป็นตัวเดียวใน
 * บรรดา action ที่เขียน input_config ของกิจกรรมที่ข้ามด่านนี้ไปเฉยๆ ทั้งที่ design spec
 * เองกังวลไว้แล้วว่าแก้ควิซระหว่างมีคน duo เล่นค้างอยู่จะทำให้ผลลัพธ์เพี้ยนได้ (§2) —
 * ควรบล็อกเหมือนกิจกรรมชนิดอื่นทุกชนิดในระบบ ไม่ใช่ยกเว้นให้ควิซแก้ได้เสมอ (Finding 3
 * ของรีวิวรอบสุดท้าย)
 */
export async function saveQuizConfigAction(
  campaignId: string, activityId: string, formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole('configurator')
    const sql = db()
    await requireDraftCampaign(sql, campaignId)

    const raw = String(formData.get('config') ?? '')
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw new Error('บันทึกไม่สำเร็จ — โครงสร้างข้อมูลเสีย ลองรีเฟรชหน้าแล้วแก้ใหม่')
    }

    const config = QuizConfig.parse(parsedJson) // throws ZodError with .issues on failure — caught below

    await sql`
      UPDATE activity SET input_config = ${sql.json(config as never)}
       WHERE id = ${activityId} AND campaign_id = ${campaignId} AND input_type = 'personality_quiz'`

    revalidatePath(`/campaigns/${campaignId}/activities/${activityId}/quiz`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}
