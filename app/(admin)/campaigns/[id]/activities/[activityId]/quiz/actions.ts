'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { assetStore } from '@/lib/assets/store'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { requireDraftCampaign } from '../../actions'
import { storeOne } from '../../../assets/actions'

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

/**
 * บันทึกเฉพาะ templateCopy (แบรนด์/ข้อความสำหรับ LIFF template export) — แยก action ออกจาก
 * saveQuizConfigAction โดยตั้งใจ ไม่เรียก requireDraftCampaign() (Finding 3 ของรีวิว)
 *
 * templateCopy เป็น metadata ของเทมเพลตแบบ standalone ที่ export แยกออกไปต่างหาก ไม่ใช่ config
 * ที่ engine ใช้ตัดสินผลของผู้เล่นที่กำลังเล่นแคมเปญนี้อยู่จริง (ตรงข้ามกับ mode/axes/
 * questions/results/group ที่ saveQuizConfigAction คุมและต้องบล็อกตอน publish แล้วเพราะ
 * design spec §2 กังวลไว้ว่าแก้กติการะหว่างมีคน duo เล่นค้างอยู่จะทำให้ผลเพี้ยน) — แก้
 * templateCopy หลัง publish ไม่กระทบผู้เล่นที่กำลังเล่นอยู่เลยแม้แต่น้อย เพราะเทมเพลตที่ export
 * ไปแล้วเป็นโปรเจกต์แยกที่ไม่ผูกกับแคมเปญนี้อีกต่อไป
 *
 * ไม่เชื่อ axes/questions/results/group ที่มากับ FormData (แม้ TemplateCopyForm.tsx จะส่ง
 * QuizConfig ทั้งก้อนมาเหมือน saveQuizConfigAction ก็ตาม) — อ่านเฉพาะ .templateCopy ออกมา
 * แล้วเอาไปวางทับบน input_config ปัจจุบันที่โหลดจาก DB สดๆ ตรงนี้เท่านั้น กัน action ที่ไม่มี
 * ด่าน BR-05 ตัวนี้ถูกใช้เป็นทางลัดแก้เนื้อหาควิซจริงหลัง publish โดยไม่ได้ตั้งใจ
 */
export async function saveTemplateCopyAction(
  campaignId: string, activityId: string, formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole('configurator')
    const sql = db()

    const raw = String(formData.get('config') ?? '')
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw new Error('บันทึกไม่สำเร็จ — โครงสร้างข้อมูลเสีย ลองรีเฟรชหน้าแล้วแก้ใหม่')
    }
    const submittedTemplateCopy = (parsedJson as { templateCopy?: unknown } | null)?.templateCopy

    const [row] = await sql<{ input_config: unknown }[]>`
      SELECT input_config FROM activity
       WHERE id = ${activityId} AND campaign_id = ${campaignId} AND input_type = 'personality_quiz'`
    if (!row) throw new Error('ไม่พบกิจกรรมนี้')

    const currentParsed = QuizConfig.safeParse(row.input_config)
    if (!currentParsed.success) {
      throw new Error('บันทึกไม่สำเร็จ — เนื้อหาควิซปัจจุบันยังไม่ผ่าน validation ตั้งค่าเนื้อหาควิซให้ครบก่อนตั้งค่าเทมเพลต')
    }

    const config = QuizConfig.parse({ ...currentParsed.data, templateCopy: submittedTemplateCopy })

    await sql`
      UPDATE activity SET input_config = ${sql.json(config as never)}
       WHERE id = ${activityId} AND campaign_id = ${campaignId} AND input_type = 'personality_quiz'`

    revalidatePath(`/campaigns/${campaignId}/activities/${activityId}/quiz`)
    revalidatePath(`/campaigns/${campaignId}/activities/${activityId}/quiz/template`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}

export type UploadQuizImageResult = { ok: true; url: string } | { ok: false; message: string }

/**
 * อัปโหลดภาพของแกน/ผลลัพธ์/archetype กลุ่มตรงจากฟอร์มควิซ — ท่อไปป์ไลน์เดียวกับ
 * uploadBlockImage ของ ../../cards/[cardId]/actions.ts เป๊ะๆ ผ่าน storeOne ตัวเดียวกัน
 * (วัดขนาดจริง → validateUpload → เขียนไฟล์ → แถวใหม่ใน asset) ภาพที่อัปโหลดทางนี้จึง
 * โผล่ในคลังภาพของแคมเปญเหมือนอัปโหลดจากจอคลังภาพตรงๆ — ไม่ใช่ไฟล์ที่ลอยอยู่นอกคลัง
 *
 * คืน URL ถาวรกลับไปเฉยๆ ไม่แตะ input_config เลย — ผู้เรียก (ImageUrlUploadField) เอา URL
 * นี้ไปเติมช่อง imageUrl ใน client state ต่อ ผู้ใช้ยังต้องกด "บันทึก" ของฟอร์มนั้นเองอยู่ดี
 * เหมือนวางลิงก์เอง ต่างกันแค่ไม่ต้องออกไปหา URL จากที่อื่นมาวาง — URL ที่ได้เป็นลิงก์
 * สาธารณะถาวรจาก assetStore() (Supabase Storage หรือ disk fallback) ใช้งานได้เหมือนกัน
 * ไม่ว่าแคมเปญนี้จะ export เป็น LIFF template กี่ครั้งก็ตาม เพราะ export พา URL นี้ไปด้วย
 * เฉยๆ ไม่ได้พาไฟล์จริงไปด้วย (LINE Flex message บังคับให้ image URL เป็นลิงก์สาธารณะ
 * จริงอยู่แล้ว ฝังไฟล์เข้าไปตรงๆ ไม่ได้)
 *
 * คืน UploadQuizImageResult แทนการ throw — เหตุผลเดียวกับ uploadBlockImage: Next.js
 * เซ็นเซอร์ข้อความ error ที่ throw ออกจาก Server Action ทิ้งเสมอในโปรดักชัน
 */
export async function uploadQuizImage(
  campaignId: string, activityId: string, formData: FormData,
): Promise<UploadQuizImageResult> {
  try {
    const session = await requireRole('configurator')
    const sql = db()

    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM activity
       WHERE id = ${activityId} AND campaign_id = ${campaignId} AND input_type = 'personality_quiz'`
    if (!row) throw new Error('ไม่พบกิจกรรมนี้')

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) throw new Error('ยังไม่ได้เลือกไฟล์')

    const result = await storeOne(sql, assetStore(), file, {
      campaignId, userId: session.userId, replacesId: null,
    })
    if (!result.ok) throw new Error(result.why)

    revalidatePath(`/campaigns/${campaignId}/activities/${activityId}/quiz`)
    revalidatePath(`/campaigns/${campaignId}/assets`)
    return { ok: true, url: result.url }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'อัปโหลดภาพไม่สำเร็จ — ลองใหม่') }
  }
}
