import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Note, PageHead, Panel, Rows, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import {
  listSelectors, MAX_OPTIONS, RETURN_NAME, SELECTOR_RETURNS, SELECTOR_SOURCES,
  type SelectorView, SOURCE_NAME,
} from '@/lib/db/selectors'
import { saveSelector } from './actions'

const summaryStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
}

const usedByChipStyle: CSSProperties = {
  fontSize: 11, border: '1px solid var(--rule)', background: 'var(--ground)',
  borderRadius: 'var(--r-pill)', padding: '2px 10px',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

function SelectorRow({ campaignId, selector }: { campaignId: string; selector: SelectorView }) {
  return (
    <div
      data-selector-row={selector.id}
      style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <a
          href={`/campaigns/${campaignId}/selectors/${selector.id}`}
          style={{ fontSize: 14, fontWeight: 600 }}
        >
          {selector.name}
        </a>
        <Badge tone="mute">คืน{selector.returnName}</Badge>
        <Badge tone="mute">ตาม{selector.sourceName}</Badge>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>
          {selector.countText}
        </span>
      </div>

      {selector.cycleText !== null && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          {selector.cycleText}
        </div>
      )}

      {selector.isNearFull && (
        <div style={{ fontSize: 11, color: STATUS_TONES.warn.fg }}>
          ใกล้เต็ม {MAX_OPTIONS} ทางเลือกแล้ว — ถ้าต้องการมากกว่านี้ ให้แยกเป็นชุดที่สองแล้วใช้คนละช่องของการ์ด
        </div>
      )}

      {/* ต้นแบบเขียนว่า "การ์ดหรือกิจกรรม" · มีแค่ครึ่งแรกที่มีคอลัมน์รองรับ
          card_block.selector_id ไม่มีทางให้กิจกรรมชี้มาที่ชุดเนื้อหาเลยในสคีมานี้
          ประโยคยังจริงสำหรับชุดที่ไม่มีใครใช้ จึงเก็บไว้ทั้งประโยค */}
      {selector.isOrphan ? (
        <div style={{ fontSize: 11, color: STATUS_TONES.danger.fg }}>
          ยังไม่มีการ์ดหรือกิจกรรมไหนใช้ชุดนี้
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {selector.usedBy.map((label) => (
            <span key={label} style={usedByChipStyle}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default async function SelectorsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const selectors = await listSelectors(sql, campaign.id)
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M3-S03 · Content selectors"
        title="ชุดเนื้อหา"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {campaign.name}
            </a>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <Note tone="info" style={{ marginBottom: 18 }}>
        <b>ชุดเนื้อหาไม่ใช่สิ่งที่ผู้เล่นเห็น</b> — เป็นตัวเลือกว่าจะเอาอะไรไปใส่ในช่องของการ์ด ·
        การ์ดใบเดียวใช้ชุดเนื้อหาคนละชุดในคนละช่องได้ ทำให้ 7 วัน × 4 รอบ เหลือแค่ 7 + 4 = 11 ทางเลือก
        แทนที่จะเป็น 28 การ์ด
      </Note>

      {canEdit && (
        <details style={{ marginBottom: 14 }}>
          <summary style={summaryStyle}>＋ สร้างชุดเนื้อหา</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <form
                action={saveSelector.bind(null, campaign.id, '')}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <Field label="ชื่อชุด (บังคับ)">
                  <input name="name" required maxLength={100} placeholder="เช่น คำทำนายประจำวัน" />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field
                    label="คืนอะไร (บังคับ)"
                    hint="เปลี่ยนไม่ได้หลังมีทางเลือกแล้ว — ค่าในตารางถูกเขียนไว้เป็นของชนิดที่เลือกไว้ตอนนั้น"
                  >
                    <select name="returns" defaultValue="text">
                      {SELECTOR_RETURNS.map((value) => (
                        <option key={value} value={value}>{RETURN_NAME[value]}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="เลือกจากค่าไหน (บังคับ)">
                    <select name="source_type" defaultValue="campaign_day">
                      {SELECTOR_SOURCES.map((value) => (
                        <option key={value} value={value}>{SOURCE_NAME[value]}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* สองช่องเหนือคอลัมน์เดียว · source_key เก็บความยาวรอบให้สองชนิด
                    และเก็บชื่อของค่าที่จะอ่านให้อีกสามชนิด · จอนี้ไม่มี state ฝั่ง client
                    ที่จะสลับช่องตอนเปลี่ยนชนิด จึงวาดทั้งคู่แล้วให้ action อ่านช่องที่ชนิดนั้นหมายถึง */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14 }}>
                  <Field
                    label="ชื่อค่าที่จะอ่าน"
                    hint="ใช้กับผลลัพธ์ของกิจกรรม · ค่าที่ผู้เล่นตอบไว้ · ระดับของค่าสะสม — สองชนิดที่เป็นรอบไม่ใช้ช่องนี้"
                  >
                    <input name="source_key" maxLength={100} placeholder="เช่น pet_type" />
                  </Field>

                  <Field label="ความยาวรอบ (วัน)" hint="7 = รายสัปดาห์ · 30 = รายเดือน">
                    <input
                      name="cycle_days"
                      inputMode="numeric"
                      pattern="[0-9]+"
                      defaultValue="7"
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </Field>
                </div>

                <Field
                  label="ของสำรอง (บังคับ · BR-27)"
                  hint="บังคับเพราะถ้าค่าไม่ตรงทางไหนเลยแล้วไม่มีของสำรอง ผู้เล่นจะกดแล้วเงียบ"
                >
                  <textarea
                    name="fallback_value"
                    required
                    placeholder="ใช้เมื่อค่าไม่ตรงทางเลือกใดเลย"
                    style={{ minHeight: 44 }}
                  />
                </Field>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">สร้างชุดเนื้อหา</Button>
                </div>
              </form>
            </Panel.Row>
          </Panel>
        </details>
      )}

      <Rows
        items={selectors}
        renderRow={(selector) => (
          <SelectorRow key={selector.id} campaignId={campaign.id} selector={selector} />
        )}
        empty={
          <Empty
            title="ชุดเนื้อหาใช้ตอนที่อยากให้การ์ดใบเดียวแสดงต่างกันตามสถานะของผู้เล่น"
            note="เช่นคำทำนายที่เปลี่ยนทุกสัปดาห์ หรือภาพที่เปลี่ยนตามชนิดของสัตว์เลี้ยง — ถ้าการ์ดของคุณคงที่ทุกใบ ไม่ต้องใช้หน้านี้เลย"
          />
        }
      />

      <div style={{ ...noteStyle, marginTop: 12 }}>
        ชุดหนึ่งมีทางเลือกได้มากที่สุด {MAX_OPTIONS} แถว (BR-27) — เกินกว่านี้คนตั้งค่าจะตรวจงานไม่ไหว
      </div>
    </main>
  )
}
