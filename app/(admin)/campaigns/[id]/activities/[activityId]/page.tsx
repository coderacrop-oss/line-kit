import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { followHolder, loadActivity } from '@/lib/db/activities'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { ActivitySetup } from '../ActivitySetup'
import { deleteActivity } from '../actions'

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

/**
 * M7-S02 · ตั้งค่ากิจกรรม
 *
 * ตัวจอทั้งใบอยู่ใน ../ActivitySetup.tsx เพราะกฎสามข้อที่จอนี้ถือ — BR-87 ที่ทุกช่อง
 * มาจาก fieldsFor() · BR-31 ที่การ์ดสำรองต้องอยู่ในฟอร์มเดียวกับช่องวิธีตัดสินผล ·
 * BR-90 ที่ต้องบอกว่ากิจกรรมไหนถือทริกเกอร์อยู่พร้อมลิงก์ไปแก้ — พิสูจน์ได้ด้วยการวาด
 * ออกมาดูเท่านั้น ไม่ใช่ด้วยการอ่านข้อความในไฟล์ · ไฟล์นี้จึงเหลือแค่การอ่านข้อมูลกับหัวจอ
 */
export default async function ActivitySetupPage({ params }: {
  params: Promise<{ id: string; activityId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, activityId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const screen = await loadActivity(sql, campaign.id, activityId)
  if (!screen) notFound()

  // ตัวที่ถือทริกเกอร์ "ตอนแอดเป็นเพื่อน" อยู่ (BR-90) · อาจเป็นตัวนี้เอง
  const holder = await followHolder(sql, campaign.id)
  const canEdit = session.role === 'configurator'
  const { activity } = screen

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 760, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/activities`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← กิจกรรมทั้งหมด
      </a>

      <PageHead
        code="M7-S02 · Activity setup"
        title={activity.name}
        actions={
          <>
            <Badge tone="mute">{activity.comboName}</Badge>
            {!activity.isEnabled && <Badge tone="warn">ปิดอยู่</Badge>}
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <ActivitySetup
        campaignId={campaign.id}
        screen={screen}
        followHolder={holder}
        canEdit={canEdit}
      />

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={noteStyle}>
          ไม่มีการบันทึกอัตโนมัติ — กติกาที่แก้ตรงนี้ตัดสินว่าใครได้อะไร
        </span>

        {canEdit && (
          <form action={deleteActivity.bind(null, campaign.id, activity.id)}>
            <Button type="submit" variant="danger">ลบกิจกรรม</Button>
          </form>
        )}

        {canEdit && (
          <span style={noteStyle}>
            ลบได้เฉพาะตอนที่ยังไม่มีใครเล่นและไม่มีคีย์เวิร์ดชี้มา — ประวัติการเล่นห้อยอยู่กับ
            ON DELETE CASCADE ลบกิจกรรมแล้วประวัติหายตามไปด้วย · ปิดกิจกรรมแทนถ้าไม่อยากให้เล่นต่อ
          </span>
        )}
      </div>
    </main>
  )
}
