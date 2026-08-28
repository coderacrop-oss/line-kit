import { notFound, redirect } from 'next/navigation'
import { Badge, PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { ExportButton } from './ExportButton'
import { QuizConfigForm } from './QuizConfigForm'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

/**
 * จอตั้งเนื้อหาควิซบุคลิกภาพ (mode/axes/questions/results) · Task 11
 *
 * แยกจอนี้ออกจาก M7-S02 (../ActivitySetup.tsx) แทนที่จะเพิ่มบล็อกที่ 4 เข้าไปที่นั่น
 * เพราะ personality_quiz ไม่มี resolve_method เลย — จอ M7-S02 ทั้งหน้าประกอบมาจาก
 * fieldsForActivity()/fieldsFor() ที่ผูกกับคู่ (resolve_method × input_type) ทั้งคู่
 * (BR-87) การยัดควิซเข้าไปที่นั่นจะเป็นการฝืนโครงที่มีอยู่ ไม่ใช่ต่อยอดมัน
 *
 * โหลดข้อมูลด้วย query ตรงๆ ที่นี่ ไม่ใช้ loadActivity() ของ lib/db/activities.ts —
 * ฟังก์ชันนั้นประกอบ entry_rules/outcomes/reached_by ที่ personality_quiz ยังไม่ใช้
 * ในรอบนี้ (เงื่อนไขการเข้าเล่นกับผลลัพธ์ของควิซเป็นคนละเรื่องจาก axes/questions/
 * results ที่จอนี้ตั้งค่า) โหลดของหนักที่ยังไม่ต้องใช้ไปก่อนจึงไม่มีประโยชน์
 */
export default async function QuizConfigPage({ params }: {
  params: Promise<{ id: string; activityId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, activityId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const [row] = await sql<ActivityRow[]>`
    SELECT id, name, input_type, input_config FROM activity
     WHERE id = ${activityId} AND campaign_id = ${campaign.id}`
  // กิจกรรมชนิดอื่นไม่มีจอนี้ — เหมือน M7-S02 ที่ปฏิเสธ personality_quiz กลับด้าน
  if (!row || row.input_type !== 'personality_quiz') notFound()

  // Task 10 สร้างกิจกรรมด้วย input_config = { mode: 'solo' | 'duo' } เท่านั้น ยังไม่มี
  // axes/questions/results เลย — safeParse ล้มเหลวแน่สำหรับกิจกรรมที่เพิ่งสร้าง (schema
  // บังคับ axes ≥2, questions ≥3, results ≥2) กรณีนั้นเริ่มจากร่างเปล่าแต่ชนิดถูกต้อง
  // แทนที่จะโยน error ใส่คนที่เพิ่งสร้างกิจกรรมเสร็จ
  const parsed = QuizConfig.safeParse(row.input_config)
  const draft: QuizConfig = parsed.success ? parsed.data : {
    mode: (row.input_config as { mode?: unknown })?.mode === 'duo' ? 'duo' : 'solo',
    axes: [],
    questions: [],
    results: [],
    fallbackResultCode: '',
  }

  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1180, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/activities`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← กิจกรรมทั้งหมด
      </a>

      <PageHead
        code="M7-S05 · Quiz content"
        title={`ควิซบุคลิกภาพ: ${row.name}`}
        actions={
          <>
            <a href={`/campaigns/${campaign.id}/activities/${row.id}/quiz/replies`} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Replies →
            </a>
            <a href={`/campaigns/${campaign.id}/activities/${row.id}/quiz/template`} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              เทมเพลต →
            </a>
            <ExportButton
              href={`/campaigns/${campaign.id}/activities/${row.id}/quiz/export`}
              fallbackFileName={`${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'quiz'}-liff-template.zip`}
            />
            <Badge tone="mute">{draft.mode === 'duo' ? 'โหมดคู่ · Duo' : 'โหมดเดี่ยว · Solo'}</Badge>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <QuizConfigForm campaignId={campaign.id} activityId={row.id} initial={draft} canEdit={canEdit} />

      <div style={{ marginTop: 18 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          ไม่มีการบันทึกอัตโนมัติ — กดปุ่ม &ldquo;บันทึกควิซ&rdquo; ทุกครั้งที่แก้เสร็จ
        </span>
      </div>
    </main>
  )
}
