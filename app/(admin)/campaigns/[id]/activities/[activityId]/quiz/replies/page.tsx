import { notFound, redirect } from 'next/navigation'
import { PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { listCardsForActivity } from '@/lib/db/cards'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { RepliesForm } from './RepliesForm'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

/**
 * จอตั้งการ์ดแจ้งเตือนของควิซ (replies.duoMatchNotifyCardId) — แยกจาก ../page.tsx
 * (M7-S05 · เนื้อหาควิซ) เพราะเป็นเรื่องคนละชั้น: mode/axes/questions/results คือ
 * "ควิซคืออะไร" ส่วนนี้คือ "ระบบทำอะไรเมื่อคู่จับกันสำเร็จ" — จอเดียวกันจะยาวเกิน
 * และปนสองความรับผิดชอบที่แก้แยกกันได้อยู่แล้ว
 */
export default async function QuizRepliesPage({ params }: {
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

  const cardRows = await listCardsForActivity(sql, row.id)
  const cards = cardRows.map((c) => ({ id: c.id, code: c.code }))
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 760, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/activities/${row.id}/quiz`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← ตั้งค่าควิซ
      </a>

      <PageHead code="M7-S06 · Quiz replies" title={`Replies: ${row.name}`} />

      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <a
            href={`/campaigns/${campaign.id}/cards/new?owner=${encodeURIComponent(row.id)}`}
            style={{ fontSize: 12, color: 'var(--ink-3)' }}
          >
            + สร้างการ์ดใหม่สำหรับ quiz นี้
          </a>
        </div>
      )}

      <RepliesForm campaignId={campaign.id} activityId={row.id} initial={draft} cards={cards} canEdit={canEdit} />
    </main>
  )
}
