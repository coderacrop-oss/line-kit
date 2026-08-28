import { notFound, redirect } from 'next/navigation'
import { PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { TemplateCopyForm } from './TemplateCopyForm'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

/**
 * จอตั้งค่า templateCopy (branding/ข้อความสำหรับ LIFF template export) — แยกจาก
 * ../page.tsx (เนื้อหาควิซ) และ ../replies/page.tsx (การ์ดแจ้งเตือน duo) ด้วยเหตุผลเดียวกับ
 * ที่ replies แยกจาก quiz มาก่อน: คนละความรับผิดชอบ — จอนี้คือ "จะ export เทมเพลตแล้ว
 * หน้าตา/ข้อความของมันเป็นยังไง" ไม่ใช่ "ควิซให้คะแนนยังไง" (docs/superpowers/specs/
 * 2026-08-28-liff-template-export-design.md §10)
 */
export default async function QuizTemplatePage({ params }: {
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
  if (!row || row.input_type !== 'personality_quiz') notFound()

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
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 760, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/activities/${row.id}/quiz`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← ตั้งค่าควิซ
      </a>

      <PageHead code="M14-S01 · LIFF template export" title={`เทมเพลต: ${row.name}`} />

      <TemplateCopyForm campaignId={campaign.id} activityId={row.id} initial={draft} canEdit={canEdit} />
    </main>
  )
}
