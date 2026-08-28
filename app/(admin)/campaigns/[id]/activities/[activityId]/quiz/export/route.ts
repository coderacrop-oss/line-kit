import { Readable } from 'node:stream'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { assembleTemplateFiles } from '@/lib/liffExport/assemble'
import { zipFiles } from '@/lib/liffExport/zip'
import { QuizConfig } from '@/lib/quiz/schema'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

/**
 * Export ควิซกิจกรรมนี้เป็น LIFF template แบบ standalone (.zip) — docs/superpowers/specs/
 * 2026-08-28-liff-template-export-design.md §9. อ่าน input_config ตรงๆ ไม่ผ่าน
 * loadQuizActivity() (lib/quiz/loadActivity.ts) เพราะฟังก์ชันนั้นเช็ค "live/published/
 * in-window" ซึ่งไม่เกี่ยวกับ export เลย — แอดมินต้อง export ควิซที่ยังไม่ publish ได้ด้วย
 * (เช่นเดียวกับ replies/template ตั้งค่าได้ตั้งแต่ก่อน publish)
 *
 * อ่านอย่างเดียว ไม่แก้ไขอะไร จึงอนุญาตไม่ว่าแคมเปญจะ draft หรือ live ก็ตาม (ต่างจาก
 * saveQuizConfigAction ที่ requireDraftCampaign บล็อกไว้) — เช็คแค่ role
 */
export async function GET(_request: Request, { params }: {
  params: Promise<{ id: string; activityId: string }>
}): Promise<Response> {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (session.role !== 'configurator') return new Response('Forbidden', { status: 403 })

  const { id, activityId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) return new Response('Not found', { status: 404 })

  const [row] = await sql<ActivityRow[]>`
    SELECT id, name, input_type, input_config FROM activity
     WHERE id = ${activityId} AND campaign_id = ${campaign.id}`
  if (!row || row.input_type !== 'personality_quiz') return new Response('Not found', { status: 404 })

  const parsed = QuizConfig.safeParse(row.input_config)
  if (!parsed.success) {
    return Response.json(
      { error: 'Quiz config is invalid — fix it on the quiz content screen before exporting.' },
      { status: 400 },
    )
  }

  let files
  try {
    files = assembleTemplateFiles(parsed.data)
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 400 })
  }

  const nodeStream = zipFiles(files)
  const webStream = Readable.toWeb(nodeStream) as ReadableStream

  const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'quiz'

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-liff-template.zip"`,
    },
  })
}
