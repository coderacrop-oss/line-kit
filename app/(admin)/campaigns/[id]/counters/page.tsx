import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Note, PageHead, Panel, Rows, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { COUNTER_MODES, type CounterView, loadCountersScreen, MODE_COPY } from '@/lib/db/counters'
import { saveCounter } from './actions'

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

const writerChipStyle: CSSProperties = {
  fontSize: 11, border: '1px solid var(--rule)', background: 'var(--ground)',
  borderRadius: 'var(--r-pill)', padding: '2px 10px',
}

const trackStyle: CSSProperties = {
  position: 'absolute', top: 12, left: 0, right: 0, height: 3,
  background: 'var(--panel-2)', borderRadius: 'var(--r-pill)',
}

const pinStyle: CSSProperties = {
  width: 11, height: 11, borderRadius: '50%', background: 'var(--ink)',
  border: '2px solid var(--panel)', boxShadow: '0 0 0 1px var(--ink)',
  display: 'block', marginTop: 8,
}

/** แถบที่วางหมุดของจุดปลดล็อกตามสัดส่วนของเป้า · ต้นแบบวาดไว้ในทุกแถว */
function MilestoneTrack({ counter }: { counter: CounterView }) {
  return (
    <div style={{ position: 'relative', height: 34, marginTop: 4 }}>
      <div style={trackStyle} />
      {counter.milestones.map((milestone) => (
        <div
          key={milestone.id}
          title={milestone.effectSummary}
          style={{
            position: 'absolute', top: 0, transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            left: `${milestone.leftPercent}%`,
          }}
        >
          <span style={pinStyle} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9 }}>{milestone.atValue}</span>
        </div>
      ))}
    </div>
  )
}

function CounterRow({ campaignId, counter }: { campaignId: string; counter: CounterView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <a
          href={`/campaigns/${campaignId}/counters/${counter.id}`}
          style={{ fontSize: 14, fontWeight: 600 }}
        >
          {counter.name}
        </a>
        <span style={codeChipStyle}>{counter.code}</span>
        <Badge tone="mute">{counter.modeName}</Badge>
        {counter.requireConsecutive && <Badge tone="info">ต้องกดติดกัน</Badge>}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>
          เป้า {counter.target} · {counter.milestones.length} จุดปลดล็อก
        </span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>{counter.modeNote}</div>

      <MilestoneTrack counter={counter} />

      {!counter.hasWriter && (
        <div style={{ fontSize: 11, color: STATUS_TONES.danger.fg }}>
          ไม่มีกิจกรรมเขียนค่าเข้ามา — ค่าสะสมนี้จะไม่มีวันเพิ่ม
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {counter.writers.map((writer) => (
          <span key={writer} style={writerChipStyle}>{writer}</span>
        ))}
      </div>

      {counter.overrides.length > 0 && (
        <Note tone="warn">
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em',
            textTransform: 'uppercase', marginBottom: 3,
          }}>
            บัญชีที่ปรับเป้าทับ (DD-06)
          </div>
          {counter.overrides.map((override) => (
            <div key={override} style={{ fontSize: 11 }}>{override}</div>
          ))}
        </Note>
      )}
    </div>
  )
}

export default async function CountersPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const { counters } = await loadCountersScreen(sql, campaign.id)
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M7-S03 · Counters"
        title="ค่าสะสม"
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
        ค่าสะสมตรวจจุดปลดล็อกของตัวเองทุกครั้งที่ค่าเปลี่ยน — กิจกรรมที่บวกค่าเข้ามาไม่ต้องรู้เรื่องนี้
        ไม่ต้องไปผูกจุดปลดล็อกกับกิจกรรมเอง
      </Note>

      {canEdit && (
        <details style={{ marginBottom: 14 }}>
          <summary style={summaryStyle}>＋ สร้างค่าสะสม</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <form
                action={saveCounter.bind(null, campaign.id, '')}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field
                    label="รหัสค่าสะสม (บังคับ)"
                    hint="ใช้ใน {{counter.xxx}} และเป็นชื่อที่ผลลัพธ์ของกิจกรรมอ้างถึง — แก้ไม่ได้หลังสร้าง"
                  >
                    <input
                      name="code"
                      required
                      maxLength={20}
                      pattern="[a-z0-9_]{1,20}"
                      placeholder="เช่น checkin_days"
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </Field>

                  <Field label="ชื่อ (บังคับ)">
                    <input name="name" required maxLength={100} placeholder="เช่น วันเช็คอิน" />
                  </Field>
                </div>

                <Field label="วิธีนับ (บังคับ)">
                  <select name="mode" defaultValue="daily_unique">
                    {COUNTER_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {MODE_COPY[mode].name} · {MODE_COPY[mode].note}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="เป้าหมาย (บังคับ · ≥ 1)">
                  <input
                    name="target"
                    required
                    inputMode="numeric"
                    pattern="[0-9]+"
                    defaultValue="7"
                    style={{ fontFamily: 'var(--mono)', width: 160 }}
                  />
                </Field>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit">สร้างค่าสะสม</Button>
                </div>
              </form>
            </Panel.Row>
          </Panel>
        </details>
      )}

      <Rows
        items={counters}
        renderRow={(counter) => (
          <CounterRow key={counter.id} campaignId={campaign.id} counter={counter} />
        )}
        empty={
          <Empty
            title="แคมเปญที่เล่นครั้งเดียวจบไม่ต้องมีค่าสะสม"
            note="ถ้าต้องการให้ผู้เล่นสะสมข้ามวัน เช่นเช็คอินครบ 7 วันรับรางวัล เริ่มที่นี่"
          />
        }
      />
    </main>
  )
}
