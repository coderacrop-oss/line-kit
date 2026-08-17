import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Note, PageHead, Panel, Rows, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { listRewards, REWARD_TYPES, REWARD_TYPE_NAME, type RewardView } from '@/lib/db/rewards'
import { saveReward } from './actions'

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

const trackStyle: CSSProperties = {
  height: 6, background: 'var(--panel-2)', borderRadius: 'var(--r-pill)', overflow: 'hidden',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

/**
 * แถบของที่เหลือ · เต็มแถบคือยังไม่มีใครได้รับ
 *
 * สีเปลี่ยนเมื่อใกล้หมด ไม่ใช่เพราะสวย — คนที่กวาดตาผ่านรายการยาวๆ อ่านแถบก่อนอ่านตัวเลข
 * และรางวัลที่เหลือ 5% ต้องแยกออกจากรางวัลที่เหลือครึ่งหนึ่งโดยไม่ต้องหยุดอ่าน
 */
function StockBar({ reward }: { reward: RewardView }) {
  return (
    <div style={trackStyle}>
      <div style={{
        height: 6,
        width: `${reward.stockPercent}%`,
        borderRadius: 'var(--r-pill)',
        background: reward.isLowStock ? STATUS_TONES.danger.border : 'var(--ink)',
      }} />
    </div>
  )
}

function RewardRow({ campaignId, reward }: { campaignId: string; reward: RewardView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <a
          href={`/campaigns/${campaignId}/rewards/${reward.id}`}
          style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}
        >
          {reward.code}
        </a>
        <Badge tone="mute">{reward.typeName}</Badge>
        {reward.isCoupon && <Badge tone="info">คูปอง</Badge>}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>
          {reward.quotaText}
        </span>
      </div>

      <StockBar reward={reward} />

      {reward.lowStockText && (
        <div style={{ fontSize: 11, color: STATUS_TONES.danger.fg }}>⚠ {reward.lowStockText}</div>
      )}

      {reward.codesText && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          {reward.codesText}
        </div>
      )}

      {/* รางวัลที่ยังไม่มีค่าอยู่ในตัวเป็นผลของฟอร์มสร้างที่ถามแค่ตัวตน · คำเตือนอยู่
          ในกล่องที่มีสีของตัวเอง ไม่ใช่บรรทัดเทาๆ เพราะมันคือของที่ต้องกลับมาทำให้จบ */}
      {reward.valueMissingText && <Note tone="warn">{reward.valueMissingText}</Note>}

      {reward.codeShortfallText && <Note tone="warn">{reward.codeShortfallText}</Note>}

      {reward.couponGapText && <Note tone="warn">{reward.couponGapText}</Note>}

      {reward.isOrphan && (
        <div style={{ fontSize: 11, color: STATUS_TONES.danger.fg }}>
          ไม่มีกิจกรรมหรือจุดปลดล็อกไหนชี้มา — รางวัลนี้ไม่มีทางถูกแจก
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {reward.usedBy.map((label) => (
          <span key={label} style={usedByChipStyle}>{label}</span>
        ))}
      </div>
    </div>
  )
}

export default async function RewardsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const rewards = await listRewards(sql, campaign.id)
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M7-S04 · Rewards"
        title="รางวัล"
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
          <summary style={summaryStyle}>＋ สร้างรางวัล</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <form
                action={saveReward.bind(null, campaign.id, '')}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field
                    label="รหัสรางวัล (บังคับ · ใช้ในตัวแปร)"
                    hint="ใช้ใน {{reward.xxx}} และเป็นชื่อที่ผลลัพธ์ของกิจกรรมอ้างถึง — แก้ไม่ได้หลังสร้าง"
                  >
                    <input
                      name="code"
                      required
                      maxLength={20}
                      pattern="[a-z0-9_]{1,20}"
                      placeholder="เช่น discount_100"
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </Field>

                  <Field label="ชนิดรางวัล (บังคับ)">
                    <select name="reward_type" defaultValue="link">
                      {REWARD_TYPES.map((type) => (
                        <option key={type} value={type}>{REWARD_TYPE_NAME[type]}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field
                  label="โควตา (เว้นว่าง = ไม่จำกัด)"
                  hint="ลดลงต่ำกว่าจำนวนที่แจกไปแล้วไม่ได้ — ตารางกันไว้ด้วย CHECK (quota IS NULL OR issued_count <= quota)"
                >
                  <input
                    name="quota"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="ไม่จำกัด"
                    style={{ fontFamily: 'var(--mono)', width: 160 }}
                  />
                </Field>

                {/* ฟอร์มสร้างถามแค่ตัวตนของรางวัล · ช่องที่ใส่ภาพเป็นรายการภาพของแคมเปญ
                    ส่วนช่องที่ใส่ลิงก์เป็นกล่องข้อความ และจอที่ไม่มี state ฝั่ง client
                    เลือกแสดงอันเดียวไม่ได้ · หน้าถัดไปรู้ชนิดแล้วจึงถามให้ตรงชนิด */}
                <span style={noteStyle}>
                  ค่าของรางวัลถามที่หน้าถัดไป เพราะช่องของแต่ละชนิดคนละหน้าตากัน —
                  จนกว่าจะใส่ รางวัลนี้จะติดคำเตือนไว้ว่ายังไม่มีอะไรอยู่ในนั้น
                </span>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">สร้างรางวัล</Button>
                </div>
              </form>
            </Panel.Row>
          </Panel>
        </details>
      )}

      <Rows
        items={rewards}
        renderRow={(reward) => (
          <RewardRow key={reward.id} campaignId={campaign.id} reward={reward} />
        )}
        empty={
          <Empty
            title="แคมเปญที่ไม่มีรางวัลก็ทำได้ แต่ถ้าจะแจกอะไร เริ่มที่นี่"
            note="รางวัลคือของที่ผู้เล่นได้รับ เช่นโค้ดส่วนลด ลิงก์ หรือภาพ · กำหนดโควตาแล้วนำไปผูกกับผลลัพธ์ของกิจกรรมหรือจุดปลดล็อกของค่าสะสม"
          />
        }
      />

      <div style={{ ...noteStyle, marginTop: 14 }}>
        จำนวนคงเหลือมีเจ้าของที่เดียวคือรางวัล (BR-30) — หน้าตั้งค่ากิจกรรมแสดงยอดนี้แบบอ่านอย่างเดียว
        ไม่มีช่องกรอกโควตาซ้ำที่ผลลัพธ์
      </div>
    </main>
  )
}
