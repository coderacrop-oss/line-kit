import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Panel, PageHead, Rows } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import {
  INPUT_TYPES, RESOLVE_METHODS, inputTypeName, isComboAllowed, resolveMethodName,
} from '@/lib/activities/wizard'
import { listActivities } from '@/lib/db/activities'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { ActivityRow } from './ActivityRow'
import { createActivity } from './actions'

const summaryStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

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
          <summary style={summaryStyle}>＋ เพิ่มกิจกรรม</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <form
                action={createActivity.bind(null, campaign.id)}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <Field label="ชื่อกิจกรรม (บังคับ)">
                  <input name="name" required maxLength={100} placeholder="เช่น สุ่มรางวัลประจำวัน" />
                </Field>

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
                    ที่ที่ถามมัน ไม่ใช่ที่นี่ · ตัวเลือกที่ปิดไว้ตรงนี้อิงชนิดอินพุตค่าเริ่มต้น
                    เพราะจอนี้ไม่มีสถานะฝั่งเบราว์เซอร์ที่จะตามช่องแรกทัน — คู่ที่ผสมกันไม่ได้
                    ถูกปฏิเสธอีกครั้งใน createActivity() ซึ่งเป็นด่านจริง */}
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

      {/* ตาราง activity_template มีอยู่ในสคีมาแต่ยังไม่มีแถวไหนเลย ทั้งใน migration
          และในโค้ดที่ไหนก็ตาม · กล่องเทมเพลตของต้นแบบจึงยังวาดไม่ได้ และการวาดกล่อง
          ว่างที่บอกว่ามีแปดแบบให้เลือกคือการโกหก */}
      <div style={{ ...noteStyle, marginTop: 8 }}>
        เทมเพลตกิจกรรมยังไม่มีให้เลือก — ตาราง activity_template ยังไม่มีแถวไหนอยู่เลย
        ทุกกิจกรรมจึงเริ่มจากศูนย์ด้วยฟอร์มข้างบนไปก่อน
      </div>
    </main>
  )
}
