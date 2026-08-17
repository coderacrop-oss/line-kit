import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Panel, PageHead, Rows } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { INPUT_TYPES, RESOLVE_METHODS, inputTypeName, isComboAllowed, resolveMethodName } from '@/lib/activities/wizard'
import { type ActivityView, listActivities } from '@/lib/db/activities'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { createActivity, deleteActivity, setActivityEnabled } from './actions'

const summaryStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
}

const codeChipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)',
  background: 'var(--ground)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)', padding: '2px 8px',
}

const linkChipStyle: CSSProperties = {
  fontSize: 11, border: '1px solid var(--rule)', background: 'var(--ground)',
  borderRadius: 'var(--r-pill)', padding: '2px 10px',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const railLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

/**
 * แถวหนึ่งของกิจกรรม
 *
 * The three flags are not decoration. "ไม่มีทางเข้าถึง" means no keyword, no
 * button and no follow trigger points here, so the activity will never run no
 * matter how correct the rest of it is — and nothing else in the system says
 * so. "ตั้งค่าไม่ครบ" counts the things a player would hit. Both are computed in
 * lib/db/activities.ts, where they have tests.
 */
function ActivityRow({ campaignId, activity, canEdit }: {
  campaignId: string
  activity: ActivityView
  canEdit: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {canEdit && (
        <form action={setActivityEnabled.bind(null, campaignId, activity.id, !activity.isEnabled)}>
          <Button
            type="submit"
            variant="ghost"
            style={{ padding: '5px 12px', fontSize: 11 }}
            title={activity.isEnabled ? 'ปิดกิจกรรมนี้' : 'เปิดกิจกรรมนี้'}
          >
            {activity.isEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
          </Button>
        </form>
      )}

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={`/campaigns/${campaignId}/activities/${activity.id}`}
            style={{ fontSize: 14, fontWeight: 600 }}
          >
            {activity.name}
          </a>
          <span style={codeChipStyle}>{activity.code}</span>
          <Badge tone="mute">{activity.inputName}</Badge>
          <Badge tone="mute">{activity.resolveName}</Badge>
          {activity.isFollowEntry && <Badge tone="info">⌂ เข้าจากเมนูหลัก</Badge>}
          {activity.isUnreachable && <Badge tone="danger">ไม่มีทางเข้าถึง</Badge>}
          {activity.isIncomplete && <Badge tone="warn">ตั้งค่าไม่ครบ</Badge>}
        </div>

        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
          {activity.conditionText}
        </div>

        {activity.reachedBy.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={railLabelStyle}>เข้าจาก →</span>
            {activity.reachedBy.map((label) => (
              <span key={label} style={linkChipStyle}>{label}</span>
            ))}
          </div>
        )}

        {activity.links.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={railLabelStyle}>พาไป →</span>
            {activity.links.map((label) => (
              <span key={label} style={linkChipStyle}>{label}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {canEdit && (
          <form action={deleteActivity.bind(null, campaignId, activity.id)}>
            <Button type="submit" variant="ghost" style={{ padding: '8px 12px', fontSize: 12 }}>
              ✕
            </Button>
          </form>
        )}
        <a href={`/campaigns/${campaignId}/activities/${activity.id}`}>
          <Button variant="ghost" style={{ padding: '8px 14px', fontSize: 12 }}>ตั้งค่า →</Button>
        </a>
      </div>
    </div>
  )
}

export default async function ActivitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const activities = await listActivities(sql, campaign.id)
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M7-S01 · Activities"
        title="กิจกรรม"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {campaign.name}
            </a>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      {canEdit && (
        <details style={{ marginBottom: 14 }}>
          <summary style={summaryStyle}>+ เพิ่มกิจกรรม</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <form
                action={createActivity.bind(null, campaign.id)}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="ชื่อกิจกรรม (บังคับ)">
                    <input name="name" required maxLength={100} placeholder="เช่น สุ่มรางวัลประจำวัน" />
                  </Field>

                  <Field
                    label="รหัสกิจกรรม (บังคับ)"
                    hint="แนบไปกับปุ่มที่ส่งออกไปแล้ว — แก้ไม่ได้หลังสร้าง"
                  >
                    <input
                      name="code"
                      required
                      maxLength={20}
                      pattern="[a-z0-9_]{1,20}"
                      placeholder="เช่น daily_draw"
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="แกน 1 · รับอินพุตยังไง">
                    <select name="input_type" defaultValue="none">
                      {INPUT_TYPES.map((type) => (
                        <option key={type} value={type}>{inputTypeName(type)}</option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="แกน 2 · ตัดสินผลยังไง"
                    hint="ตัวเลือกที่ผสมกันไม่ได้จะกดไม่ได้ (BR-36)"
                  >
                    <select name="resolve_method" defaultValue="weighted">
                      {RESOLVE_METHODS.map((method) => (
                        <option
                          key={method}
                          value={method}
                          disabled={!isComboAllowed('none', method)}
                        >
                          {resolveMethodName(method)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* ฟอร์มสร้างถามแค่ตัวตนกับสองแกน · ช่องที่เหลือขึ้นกับคู่แกนที่เลือก
                    และ fieldsFor() เป็นคนบอกว่าคู่นั้นถามอะไร (BR-87) จอถัดไปจึงเป็น
                    ที่ที่ถามมัน ไม่ใช่ที่นี่ */}
                <span style={noteStyle}>
                  ช่องที่เหลือถามที่หน้าตั้งค่า เพราะแต่ละคู่แกนถามคนละชุดกัน —
                  ฟอร์มสร้างจากนิยามชนิด ไม่ได้เขียนแยกไว้ทีละกิจกรรม (BR-87)
                </span>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">เพิ่มกิจกรรม</Button>
                </div>
              </form>
            </Panel.Row>
          </Panel>
        </details>
      )}

      <Rows
        items={activities}
        renderRow={(activity) => (
          <ActivityRow
            key={activity.id}
            campaignId={campaign.id}
            activity={activity}
            canEdit={canEdit}
          />
        )}
        empty={
          <Empty
            title="เริ่มจากเลือกเทมเพลตกิจกรรม"
            note="เทมเพลตมาพร้อมเงื่อนไข ผลลัพธ์ และการ์ดตัวอย่างครบชุด — แก้ข้อความให้เป็นของจริงแล้วส่งขึ้นได้เลย"
          />
        }
      />

      <div style={{ ...noteStyle, marginTop: 14 }}>
        ความเชื่อมโยงระหว่างกิจกรรมมาจากปุ่มบนการ์ดของแต่ละกิจกรรม — แถว &quot;พาไป →&quot;
        คือภาพรวมทางเดินทั้งหมดของแคมเปญนี้
      </div>
    </main>
  )
}
