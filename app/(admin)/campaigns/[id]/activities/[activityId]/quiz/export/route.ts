import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { assembleTemplateFiles } from '@/lib/liffExport/assemble'
import { zipToBuffer } from '@/lib/liffExport/zip'
import { QuizConfig } from '@/lib/quiz/schema'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

/**
 * Export ควิซกิจกรรมนี้เป็น LIFF template แบบ standalone (.zip) — docs/superpowers/specs/
 * 2026-08-28-liff-template-export-design.md §9. อ่าน input_config ตรงๆ ไม่เช็ค "live/
 * published/in-window" อะไรเลย เพราะไม่เกี่ยวกับ export — แอดมินต้อง export ควิซที่ยังไม่
 * publish ได้ด้วย (เช่นเดียวกับ template ตั้งค่าได้ตั้งแต่ก่อน publish)
 *
 * อ่านอย่างเดียว ไม่แก้ไขอะไร จึงอนุญาตไม่ว่าแคมเปญจะ draft หรือ live ก็ตาม (ต่างจาก
 * saveQuizConfigAction ที่ requireDraftCampaign บล็อกไว้) — ต้องแค่ล็อกอินอยู่ก็พอ ไม่บังคับ
 * role 'configurator' เหมือนก่อนหน้านี้ (Finding 4 ของรีวิว): จอพี่น้องกันที่อ่านข้อมูลชุด
 * เดียวกันนี้ (../page.tsx M7-S05) อนุญาตทุก session ที่ล็อกอินแล้วดูได้อยู่แล้ว (canEdit
 * แยกต่างหากจากการดู) — routeนี้ก็อ่านอย่างเดียวเหมือนกันทุกประการ ไม่มีเหตุผลให้เข้มกว่า
 * จอที่แสดงข้อมูลเดียวกันบนหน้าจอ
 */
export async function GET(_request: Request, { params }: {
  params: Promise<{ id: string; activityId: string }>
}): Promise<Response> {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

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
    files = await assembleTemplateFiles(parsed.data)
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 400 })
  }

  // ใช้ zipToBuffer (await เต็มก้อน) แทนที่จะ pipe stream ตรงเข้า response เหมือนเดิม —
  // finalize() ล้มเหลวกลางทาง (เช่น zlib/module error ภายใน archiver) ตอนนี้ถูก catch ได้จริง
  // ตรงนี้ก่อนตัดสินใจ status code ของ response แทนที่จะปล่อยให้ response 200 ตัดจบเป็น zip
  // เสียครึ่งๆ กลางๆ เงียบๆ หรือแย่กว่านั้นคือปล่อย promise ของ finalize() ค้างไม่มีใคร catch
  // จน unhandled rejection ทำ process ทั้งตัวล่ม (Finding 1 ของรีวิว)
  let buffer: Buffer
  try {
    buffer = await zipToBuffer(files)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Export failed while creating the zip file' },
      { status: 500 },
    )
  }

  const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'quiz'

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-liff-template.zip"`,
    },
  })
}
