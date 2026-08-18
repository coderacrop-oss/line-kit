import { notFound, redirect } from 'next/navigation'
import { Badge, PageHead } from '@/components/ui'
import { Compositor } from '@/components/richmenu/Compositor'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { listAssets } from '@/lib/db/assets'
import { loadRichMenuScreen } from '@/lib/db/richmenu'
import { loadComposition } from '@/lib/db/richmenu-composition'
import { canvasFor } from '@/lib/richmenu/layouts'
import { applyComposition, saveComposition, uploadLayerImage } from './actions'

/**
 * M4-S02 · ตัวจัดวางภาพหลายชั้นของ Rich Menu — เข้าถึงได้เฉพาะเมนูที่มีอยู่แล้ว
 * เท่านั้น (สร้างเมนูใหม่ยังต้องผ่านฟอร์มอัปโหลดภาพเดียวของ M4-S01 ก่อนเสมอ เพราะ
 * `rich_menu.image_asset_id` เป็น NOT NULL — ตัวจัดวางนี้เป็น "แก้ต่อ" ไม่ใช่จุดสร้าง)
 *
 * ไม่มีต้นแบบจากไฟล์ prototype รองรับจอนี้ — บันทึกไว้ใน tests/design/landmarks.json
 * เป็น origin: 'local' พร้อมเหตุผล
 */
export default async function ComposeRichMenuPage({
  params,
}: {
  params: Promise<{ id: string; menuId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id: campaignId, menuId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, campaignId)
  if (!campaign) notFound()

  const screen = await loadRichMenuScreen(sql, campaignId)
  const menu = screen.menus.find((m) => m.id === menuId)
  if (!menu) notFound()

  const [composition, assets] = await Promise.all([
    loadComposition(sql, menuId, campaignId),
    listAssets(sql, campaignId),
  ])

  const canvas = canvasFor(menu.layout)
  const images = assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({ id: asset.id, url: asset.publicUrl, width: asset.width, height: asset.height }))

  const canEdit = session.role === 'configurator' || session.role === 'content_editor'
  const backHref = `/campaigns/${campaignId}/richmenu`

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1200, margin: '0 auto' }}>
      <a href={backHref} style={{ fontSize: 12, color: 'var(--ink-3)' }}>← Rich Menu</a>

      <PageHead
        code="M4-S02 · Rich Menu Compositor"
        title={`จัดวางภาพ — ${menu.alias}`}
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <div style={{ marginTop: 16 }}>
        <Compositor
          campaignId={campaignId}
          menuId={menuId}
          canvas={canvas}
          initialComposition={composition}
          images={images}
          canEdit={canEdit}
          backHref={backHref}
          uploadLayerImage={uploadLayerImage}
          saveComposition={saveComposition}
          applyComposition={applyComposition}
        />
      </div>
    </main>
  )
}
