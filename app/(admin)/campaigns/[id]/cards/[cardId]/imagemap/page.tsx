import { notFound, redirect } from 'next/navigation'
import { Badge, PageHead } from '@/components/ui'
import { ImagemapEditor } from '@/components/imagemap/ImagemapEditor'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { loadCard } from '@/lib/db/cards'
import { loadCardImagemap } from '@/lib/db/card-imagemap'
import { db } from '@/lib/db/client'
import {
  applyImagemap, saveDraft, uploadBaseImage, uploadVideo, uploadVideoPreview,
} from './actions'

/**
 * ตัวแก้ไขริชเมสเสจ/ริชวิดีโอ (Rich Message/Rich Video · imagemap ภาพล้วน หรือ
 * imagemap_video มีวิดีโอเล่นทับ) — ปลายทางเดียวกันสำหรับทั้งสอง render_as (จอ
 * เดียวกัน คนละ cardKind ที่ส่งให้ ImagemapEditor) การ์ดทั้งสองแบบไม่มีบล็อกให้แก้
 * เลย (ต่างจาก M3-S02 ที่แก้ทีละบล็อก) จึงเป็นจอแยกต่างหาก ไม่ใช่กิ่งย่อยในบล็อก
 * เอดิเตอร์เดิม — app/(admin)/campaigns/[id]/cards/[cardId]/page.tsx เปลี่ยนเส้นทาง
 * มาที่นี่เองเมื่อ renderAs ตรงเงื่อนไข ไม่ต้องให้ใครจำ URL นี้เอง
 *
 * ไม่มีต้นแบบจากไฟล์ prototype รองรับจอนี้ — เหมือนกับจอ M4-S02 (Rich Menu
 * Compositor) ซึ่ง LINE เองมีเครื่องมือคล้ายกัน (Rich Menu Creative Lab) แต่
 * flex-builder-prototype.html ไม่เคยวาดจอแบบนี้ไว้เลย จึงยึดธรรมเนียมของบ้านนี้แทน
 * (ป้ายรหัสจอ M3-Sxx · หัวข้อผูกกับรหัสการ์ดจริง · ป้าย "ดูอย่างเดียว" ตอน canEdit=false
 * · ลิงก์ย้อนกลับที่หัวจอ) — บันทึกไว้ใน tests/design/landmarks.json เป็น origin: 'local'
 */
export default async function ImagemapEditorPage({
  params,
}: {
  params: Promise<{ id: string; cardId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id: campaignId, cardId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, campaignId)
  if (!campaign) notFound()

  const card = await loadCard(sql, campaignId, cardId)
  if (!card) notFound()
  if (card.renderAs !== 'imagemap' && card.renderAs !== 'imagemap_video') {
    redirect(`/campaigns/${campaignId}/cards/${cardId}`)
  }

  const imagemap = await loadCardImagemap(sql, campaignId, cardId)
  if (!imagemap) notFound()

  const canEdit = session.role === 'configurator' || session.role === 'content_editor'
  const backHref = `/campaigns/${campaignId}/cards`
  const isVideo = card.renderAs === 'imagemap_video'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1200, margin: '0 auto' }}>
      <a href={backHref} style={{ fontSize: 12, color: 'var(--ink-3)' }}>← การ์ดทั้งหมด</a>

      <PageHead
        code={isVideo ? 'M3-S02 · Rich Video' : 'M3-S02 · Rich Message'}
        title={`${isVideo ? 'ริชวิดีโอ' : 'ริชเมสเสจ'} — ${card.code}`}
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <div style={{ marginTop: 16 }}>
        <ImagemapEditor
          campaignId={campaignId}
          cardId={cardId}
          cardKind={card.renderAs}
          initial={{
            baseImageUrl: imagemap.baseImageUrl,
            baseWidth: imagemap.baseWidth,
            baseHeight: imagemap.baseHeight,
            altText: imagemap.altText,
            actions: imagemap.actions,
            ready: Object.keys(imagemap.variantUrls).length > 0,
            videoUrl: imagemap.videoUrl,
            videoPreviewUrl: imagemap.videoPreviewUrl,
            videoArea: imagemap.videoArea,
            videoLinkUri: imagemap.videoLinkUri,
            videoLinkLabel: imagemap.videoLinkLabel,
          }}
          canEdit={canEdit}
          backHref={backHref}
          uploadBaseImage={uploadBaseImage}
          saveDraft={saveDraft}
          applyImagemap={applyImagemap}
          uploadVideo={uploadVideo}
          uploadVideoPreview={uploadVideoPreview}
        />
      </div>
    </main>
  )
}
