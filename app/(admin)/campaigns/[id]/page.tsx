import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { describeDayClock } from '@/lib/campaign/dayclock'
import { loadCampaign, type CampaignDetail } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { periodKey } from '@/lib/daykey'
import { saveCampaignInfo } from './actions'

const STATUS_LABEL: Record<CampaignDetail['status'], string> = {
  draft: 'ร่าง',
  published: 'ส่งขึ้นแล้ว',
  closed: 'จบแล้ว',
}

/**
 * วันที่ในหน้านี้อ่านผ่าน periodKey ตัวเดียวกับที่เครื่องใช้นับ "วันละครั้ง"
 *
 * A campaign day is whatever periodKey says it is, so the dates on the settings
 * screen are read out of the same function rather than formatted a second way
 * that agrees with it today.
 */
const asDateInput = (at: Date, timezone: string) => periodKey(at, timezone, 86_400)

function SummaryStrip({ campaign }: { campaign: CampaignDetail }) {
  const cells: Array<[string, ReactNode]> = [
    ['status', STATUS_LABEL[campaign.status]],
    ['code', campaign.code],
    ['start', asDateInput(campaign.startAt, campaign.timezone)],
    ['end', asDateInput(campaign.endAt, campaign.timezone)],
    ['day length', campaign.dayLengthSec === 0 ? 'ตลอดแคมเปญ' : `${campaign.dayLengthSec} วิ`],
  ]

  return (
    <Panel style={{ display: 'flex', marginBottom: 16 }}>
      {cells.map(([key, value], index) => (
        <div
          key={key}
          style={{
            flex: 1, padding: '13px 16px', minWidth: 0,
            borderRight: index === cells.length - 1 ? undefined : '1px solid var(--rule)',
          }}
        >
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.07em',
            textTransform: 'uppercase', color: 'var(--ink-3)',
          }}>
            {key}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3, overflowWrap: 'anywhere' }}>
            {value}
          </div>
        </div>
      ))}
    </Panel>
  )
}

export default async function CampaignInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const campaign = await loadCampaign(db(), id)
  if (!campaign) notFound()

  // BR-05 · กติกาที่ส่งขึ้นแล้วห้ามแก้ · action ก็ปฏิเสธเองอีกชั้นหนึ่ง
  const locked = campaign.status === 'published' || session.role !== 'configurator'
  const publishedLock = campaign.status === 'published'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 660 }}>
      <PageHead
        code="M1-S02 · Campaign Info"
        title="ข้อมูลแคมเปญ"
        actions={
          <>
            {/* ทางเข้าจากภายนอกอยู่คนละจอ · จอนี้เป็นที่เดียวที่คนจะหามันเจอ */}
            <a href={`/campaigns/${campaign.id}/keywords`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              คีย์เวิร์ดตอบกลับ →
            </a>
            <Badge tone={campaign.status === 'published' ? 'ok' : 'mute'}>
              {STATUS_LABEL[campaign.status]}
            </Badge>
            {session.role !== 'configurator' && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <SummaryStrip campaign={campaign} />

      <Panel>
        <Panel.Row>
          <form
            // ผูก id มากับตัว action แทนที่จะให้ลอยมาในฟอร์ม · ค่าที่ผูกไว้ถูกเซ็นมาจากเซิร์ฟเวอร์
            // ส่วนช่องซ่อนในฟอร์มเป็นของที่ผู้ส่งแก้เองได้ทั้งใบ
            action={saveCampaignInfo.bind(null, campaign.id)}
            style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {publishedLock && (
              <Note tone="warn">
                <b>แคมเปญนี้ส่งขึ้น LINE แล้ว จึงแก้กติกาไม่ได้ (BR-05)</b>
                <br />
                การ์ดที่ส่งออกไปแล้วอ้างถึงกติกาชุดนี้อยู่ — ถ้าต้องแก้ ให้ถอนออกจากบัญชีก่อน
                หรือก๊อปเป็นแคมเปญใหม่แล้วแก้ที่ตัวใหม่
              </Note>
            )}

            <Field label="ชื่อแคมเปญ · Name (บังคับ)">
              <input name="name" defaultValue={campaign.name} required maxLength={120} disabled={locked} />
            </Field>

            <Field
              label="รหัสแคมเปญ · Code"
              hint="แก้ไม่ได้หลังสร้างแล้ว — รหัสนี้แนบไปกับปุ่มของการ์ดที่ส่งออกไปแล้ว (BR-33)"
            >
              <input
                defaultValue={campaign.code}
                disabled
                style={{ fontFamily: 'var(--mono)', background: 'var(--ground)', color: 'var(--ink-3)' }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="วันเริ่ม · Start">
                <input
                  type="date"
                  defaultValue={asDateInput(campaign.startAt, campaign.timezone)}
                  disabled
                  style={{ background: 'var(--ground)', color: 'var(--ink-3)' }}
                />
              </Field>

              <Field
                label="วันสิ้นสุด · End (บังคับ)"
                hint="เป็นจุดเริ่มนับของสถิติและของการลบข้อมูล (BR-29)"
              >
                <input
                  name="end_at"
                  type="date"
                  defaultValue={asDateInput(campaign.endAt, campaign.timezone)}
                  required
                  disabled={locked}
                />
              </Field>
            </div>

            <Field
              label="Timezone"
              hint="วันใหม่ของแคมเปญเริ่มเที่ยงคืนเวลาไทยเสมอ (BR-04)"
            >
              <input
                defaultValue={campaign.timezone}
                disabled
                style={{ background: 'var(--ground)', color: 'var(--ink-3)' }}
              />
            </Field>

            <div style={{ height: 1, background: 'var(--rule)' }} />

            <Field
              label="ความยาวของหนึ่งวัน · Day length (วินาที · ต่ำสุด 10 · 0 = ตลอดแคมเปญ)"
            >
              <input
                name="day_length_sec"
                type="number"
                min={0}
                step={1}
                defaultValue={campaign.dayLengthSec}
                disabled={locked}
                style={{ width: 180, fontFamily: 'var(--mono)' }}
              />
            </Field>

            {/* ผลของสองช่องข้างบนเขียนออกมาเป็นประโยค เพราะไม่มีใครอ่านตัวเลขแล้วเดาผลได้ */}
            <Note tone="info">
              <b>ตอนนี้แปลว่า:</b> {describeDayClock(campaign.timezone, campaign.dayLengthSec)}
            </Note>

            {campaign.hasPlays && (
              <Note tone="warn">
                <b>แคมเปญนี้มีคนเล่นอยู่แล้ว</b> — การแก้ค่านี้มีผลทันทีกับผู้เล่นที่กำลังรอ
                &ldquo;เล่นได้อีกครั้ง&rdquo; บางคนอาจเล่นได้เร็วขึ้นหรือช้าลงกว่าที่สื่อสารไว้
              </Note>
            )}

            <Field label="สีหลักของธีม · Theme primary">
              <input
                name="theme_primary"
                type="color"
                defaultValue={campaign.themePrimary ?? '#17756A'}
                disabled={locked}
                style={{ width: 96, padding: 4, height: 38 }}
              />
            </Field>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
              <Button type="submit" disabled={locked}>บันทึก</Button>
            </div>
          </form>
        </Panel.Row>
      </Panel>
    </main>
  )
}
