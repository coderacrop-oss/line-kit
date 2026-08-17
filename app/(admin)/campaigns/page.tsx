import { redirect } from 'next/navigation'
import { Badge, type BadgeTone, Button, Empty, Field, PageHead, Panel, Rows, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { listCampaigns, type CampaignStatus, type CampaignSummary } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { createCampaign } from './actions'

const STATUS_LABEL: Record<CampaignStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'ร่าง', tone: 'mute' },
  published: { label: 'ส่งขึ้นแล้ว', tone: 'ok' },
  closed: { label: 'จบแล้ว', tone: 'mute' },
}

/** ใกล้หมดเวลาเท่านี้ถึงเปลี่ยนเป็นสีเตือน — พอให้ยังแก้อะไรทัน */
const CLOSING_SOON_DAYS = 3

/**
 * นับถอยหลังได้เรื่องเดียวต่อแถว และ summarize() เป็นคนตัดสินว่าเรื่องไหน
 *
 * A live campaign counts down to its end date; a closed one counts down to the
 * day its player data is deleted. Showing both would put two numbers with two
 * different meanings side by side and let the reader pick the wrong one.
 */
function Deadline({ campaign }: { campaign: CampaignSummary }) {
  if (campaign.purgeInDays !== null) {
    return campaign.purgeInDays === 0
      ? <Badge tone="danger">ถึงกำหนดลบข้อมูลแล้ว</Badge>
      : <Badge tone="warn">ลบข้อมูลใน {campaign.purgeInDays} วัน</Badge>
  }
  if (campaign.daysLeft === null) return null
  if (campaign.daysLeft === 0) return <Badge tone="danger">หมดเวลาแล้ว</Badge>
  return (
    <Badge tone={campaign.daysLeft <= CLOSING_SOON_DAYS ? 'warn' : 'info'}>
      เหลือ {campaign.daysLeft} วัน
    </Badge>
  )
}

function CampaignRow({ campaign }: { campaign: CampaignSummary }) {
  const status = STATUS_LABEL[campaign.status]

  return (
    // ยืดลิงก์ออกไปกินพื้นที่ padding ของแถว เพื่อให้ทั้งแถวกดได้จริงอย่างที่ตาเห็น
    // ไม่ใช่กดได้เฉพาะตรงตัวอักษร
    <a
      href={`/campaigns/${campaign.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        margin: '-18px -20px', padding: '18px 20px',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--panel-2)', color: 'var(--ink-2)', fontSize: 15, fontWeight: 600,
        }}
      >
        {[...campaign.name][0] ?? '?'}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          fontSize: 14, fontWeight: 600,
        }}>
          {campaign.name}
          <span className="code" style={{ fontSize: 10, background: 'var(--ground)', color: 'var(--ink-3)' }}>
            {campaign.code}
          </span>
        </span>

        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          กิจกรรม {campaign.activityCount} รายการ ·{' '}
          {campaign.channelName ?? 'ยังไม่ผูกบัญชี LINE'}
        </span>

        {campaign.purgeInDays !== null && (
          <span style={{
            display: 'block', fontSize: 11, marginTop: 4, color: STATUS_TONES.warn.fg,
          }}>
            ⚠ ข้อมูลผู้เล่นของแคมเปญนี้จะถูกลบตามนโยบายเก็บข้อมูล 30 วันหลังปิด
          </span>
        )}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Deadline campaign={campaign} />
      </span>

      <span aria-hidden="true" style={{ color: 'var(--ink-3)', fontSize: 14, flexShrink: 0 }}>→</span>
    </a>
  )
}

/**
 * ปุ่มเปิดฟอร์มที่ไม่ต้องมี state ฝั่ง client
 *
 * <details> is the disclosure the browser already knows how to open, which keeps
 * this whole screen a Server Component. Reaching for useState here would pull
 * the list across the client boundary to win a triangle.
 */
const summaryStyle = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
} as const

/** ทางไป M1-S03 · ปุ่มรองข้างปุ่มสร้าง ไม่ใช่ปุ่มหลักที่สอง */
const secondaryLinkStyle = {
  display: 'inline-block',
  background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, width: 'fit-content', marginBottom: 14,
} as const

function CreateCampaign() {
  return (
    <details style={{ marginBottom: 14 }}>
      <summary style={summaryStyle}>＋ สร้างแคมเปญ</summary>

      <Panel style={{ marginTop: 10 }}>
        <Panel.Row>
          <form action={createCampaign} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="ชื่อแคมเปญ · Name (บังคับ)">
              <input name="name" required maxLength={120} placeholder="เช่น ครบเจ็ดวันรับของรางวัล" />
            </Field>

            <Field
              label="รหัสแคมเปญ · Code (บังคับ · a-z 0-9 _)"
              hint="รหัสนี้แนบไปกับปุ่มของการ์ดที่ส่งออกไปแล้ว จึงแก้ไม่ได้หลังส่งขึ้น LINE ครั้งแรก"
            >
              <input
                name="code"
                required
                pattern="[a-z0-9_]{1,20}"
                placeholder="เช่น melo_streak7"
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>

            <Field
              label="วันสิ้นสุด · End (บังคับ)"
              hint="เป็นจุดเริ่มนับของสถิติและของการลบข้อมูล จึงไม่มีค่าเริ่มต้นให้เดา (BR-29)"
            >
              <input name="end_at" type="date" required />
            </Field>

            <div>
              <Button type="submit">สร้างแคมเปญ</Button>
            </div>
          </form>
        </Panel.Row>
      </Panel>
    </details>
  )
}

export default async function CampaignsPage() {
  const session = await getSession()
  // ชั้น layout กันไว้อยู่แล้ว แต่ layout กับ page เรนเดอร์พร้อมกัน ไม่ใช่ทีละชั้น
  if (!session) redirect('/login')

  const campaigns = await listCampaigns(db(), new Date())
  const canCreate = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1060, margin: '0 auto' }}>
      <PageHead
        code="M1-S01 · Campaigns"
        title="แคมเปญ"
        actions={session.role === 'content_editor'
          ? <Badge tone="mute">ดูอย่างเดียว · ผู้ดูแลเนื้อหา</Badge>
          : null}
      />

      {canCreate && <CreateCampaign />}

      {/* ปุ่มนี้เคยไม่มี เพราะจอปลายทางยังไม่มีใครสร้าง · M1-S03 มีแล้ว จึงต่อได้จริง
          ซ่อนจากคนที่ก๊อปไม่ได้ ไม่ใช่แสดงไว้ให้กดแล้วโดนปฏิเสธที่ปลายทาง */}
      {canCreate && (
        <a href="/campaigns/duplicate" style={secondaryLinkStyle}>ก๊อปจากแคมเปญเดิม</a>
      )}

      <Rows
        items={campaigns}
        renderRow={(campaign) => <CampaignRow key={campaign.id} campaign={campaign} />}
        empty={
          <Empty
            title="ยังไม่มีแคมเปญ — เริ่มตัวแรกกันเลย"
            note={canCreate
              ? 'สร้างแคมเปญ ตั้งกรอบเวลา แล้วเพิ่มกิจกรรมแรก จากนั้นกดทดลองเล่นดูได้ทันทีโดยยังไม่ต้องผูกบัญชี LINE'
              : 'ผู้ตั้งค่าแคมเปญเป็นคนสร้างแคมเปญแรก'}
          />
        }
      />
    </main>
  )
}
