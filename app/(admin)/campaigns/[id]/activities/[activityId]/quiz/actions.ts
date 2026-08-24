'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'

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
 * WHERE ผูก input_type = 'personality_quiz' ไว้ด้วยโดยตั้งใจ — แม้ id จาก URL จะไม่
 * น่าตรงกับกิจกรรมชนิดอื่นได้เลยในทางปกติ แต่ด่านนี้ปฏิเสธการเขียนทับ input_config
 * ของกิจกรรมชนิดอื่นไว้อีกชั้น ไม่ไว้ใจแค่สิ่งที่ URL บอก
 */
export async function saveQuizConfigAction(activityId: string, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('configurator')

    const raw = String(formData.get('config') ?? '')
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw new Error('บันทึกไม่สำเร็จ — โครงสร้างข้อมูลเสีย ลองรีเฟรชหน้าแล้วแก้ใหม่')
    }

    const config = QuizConfig.parse(parsedJson) // throws ZodError with .issues on failure — caught below

    const sql = db()
    await sql`
      UPDATE activity SET input_config = ${sql.json(config as never)}
       WHERE id = ${activityId} AND input_type = 'personality_quiz'`

    revalidatePath(`/campaigns/[id]/activities/${activityId}/quiz`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}
