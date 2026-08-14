import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import {
  COUNTER_MODES, type CounterCatalogue, type CounterView, effectOptions,
  loadCounter, MODE_COPY, type MilestoneView,
} from '@/lib/db/counters'
import { deleteCounter, deleteMilestone, saveCounter, saveMilestone } from '../actions'

const readOnlyBoxStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 13,
  background: 'var(--panel-2)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: '9px 12px', color: 'var(--ink)',
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const milestoneBoxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 12,
  display: 'flex', flexDirection: 'column', gap: 8,
}

const checkboxRowStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  fontSize: 11, border: '1px solid var(--rule)', background: 'var(--panel)',
  borderRadius: 'var(--r-pill)', padding: '3px 11px',
}

function MilestoneForm({ campaignId, counter, catalogue, milestone }: {
  campaignId: string
  counter: CounterView
  catalogue: CounterCatalogue
  milestone?: MilestoneView
}) {
  // Field คิด id จาก hash ของป้าย · ป้ายเดียวกันซ้ำทุกจุดปลดล็อกจะได้ id ชนกันทั้งหน้า
  const key = milestone ? milestone.id : 'new'
  const options = effectOptions(catalogue, milestone?.effectKeys ?? [])

  return (
    <div style={milestoneBoxStyle}>
      <form
        id={`ms-${key}`}
        action={saveMilestone.bind(null, campaignId, counter.id, milestone?.id ?? '')}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field id={`at-${key}`} label="เมื่อค่าถึง">
            <input
              name="at_value"
              required
              inputMode="numeric"
              pattern="[0-9]+"
              defaultValue={milestone?.atValue}
              style={{ fontFamily: 'var(--mono)', width: 96, textAlign: 'right' }}
            />
          </Field>
          <Button type="submit" variant="ghost">
            {milestone ? 'บันทึกจุดนี้' : '＋ เพิ่มจุดปลดล็อก'}
          </Button>
          {milestone?.isBeyondTarget && (
            <span style={{ fontSize: 11, color: STATUS_TONES.warn.fg }}>
              เกินเป้า {counter.target} — เป้าเป็นตัวเลขที่เอาไว้วัดความคืบหน้า ไม่ใช่เพดานของการนับ
              จุดนี้จะทำงานก็ต่อเมื่อค่าสะสมเลยเป้าไปได้จริง
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={labelStyle}>ผลที่ตามมา</span>
          {options.length === 0 && (
            <span style={noteStyle}>
              ยังไม่มีรางวัลหรือค่าสะสมตัวอื่นให้เลือก — สร้างรางวัลก่อนแล้วกลับมาที่นี่
            </span>
          )}
          {options.map((option) => (
            <label
              key={option.key}
              style={option.isDead
                ? { ...checkboxRowStyle, borderColor: STATUS_TONES.danger.border, color: STATUS_TONES.danger.fg }
                : checkboxRowStyle}
            >
              <input
                type="checkbox"
                name="effect"
                value={option.key}
                defaultChecked={milestone?.effectKeys.includes(option.key) ?? false}
              />
              {option.label}
            </label>
          ))}
        </div>
      </form>

      {/* ฟอร์มลบอยู่ข้างนอก ไม่ได้ซ้อนอยู่ในฟอร์มบันทึก · ฟอร์มซ้อนกันไม่ใช่ HTML ที่ใช้ได้ */}
      {milestone && (
        <form action={deleteMilestone.bind(null, campaignId, counter.id, milestone.id)}>
          <Button type="submit" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
            ลบจุดปลดล็อกนี้
          </Button>
        </form>
      )}
    </div>
  )
}

export default async function CounterEditPage({ params }: {
  params: Promise<{ id: string; counterId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, counterId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const found = await loadCounter(sql, campaign.id, counterId)
  if (!found) notFound()

  const { counter, catalogue } = found
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 720, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/counters`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← ค่าสะสมทั้งหมด
      </a>

      <PageHead
        code="M7-S03 · Counter setup"
        title={counter.name}
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <Panel style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <form
          action={saveCounter.bind(null, campaign.id, counter.id)}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={labelStyle}>รหัสค่าสะสม (บังคับ)</span>
              <div style={readOnlyBoxStyle}>{counter.code}</div>
              <span style={noteStyle}>
                แก้ไม่ได้หลังสร้าง — ผลลัพธ์ของกิจกรรมอ้างค่าสะสมด้วยรหัสนี้เป็นข้อความ ไม่ใช่ด้วย id
                เปลี่ยนแล้วผลลัพธ์นั้นจะเงียบไปเฉยๆ ไม่มี error ที่ไหนบอก
              </span>
            </div>

            <Field label="ชื่อ (บังคับ)">
              <input name="name" required maxLength={100} defaultValue={counter.name} />
            </Field>
          </div>

          <Field
            label="วิธีนับ (บังคับ)"
            hint={`"นับสิ่งที่ต่างกัน" ยังไม่มีแคมเปญตัวอย่างไหนใช้ (OI-17) — เลือกได้แต่ยังไม่มีเคสอ้างอิง`}
          >
            <select name="mode" defaultValue={counter.mode}>
              {COUNTER_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_COPY[mode].name} · {MODE_COPY[mode].note}
                </option>
              ))}
            </select>
          </Field>

          {counter.participantCount > 0 && (
            <Note tone="warn">
              แก้วิธีนับไม่ได้ — มีผู้เล่นสะสมอยู่แล้ว {counter.participantCount} คน
              ค่าที่สะสมมาจะถูกตีความคนละแบบ โดยไม่มีอะไรบอกว่าแถวไหนนับมาแบบเก่า
            </Note>
          )}

          <Field
            label="เป้าหมาย (บังคับ · ≥ 1)"
            hint="นี่คือค่าตั้งต้น — แต่ละบัญชี LINE ปรับทับได้ที่หน้าผูกบัญชี (DD-06)"
          >
            <input
              name="target"
              required
              inputMode="numeric"
              pattern="[0-9]+"
              defaultValue={counter.target}
              style={{ fontFamily: 'var(--mono)', width: 160 }}
            />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ ...checkboxRowStyle, fontSize: 13, width: 'fit-content' }}>
              <input
                type="checkbox"
                name="require_consecutive"
                defaultChecked={counter.requireConsecutive}
              />
              ต้องกดติดกันทุกวัน
            </label>
            <span style={noteStyle}>
              กติกานี้อยู่ที่ค่าสะสม ไม่ได้อยู่ที่บัตรแสตมป์ — ตั้งเป้า 60 วันติดได้
              โดยไม่ติดเพดานจำนวนช่องบนบัตร · ขาดวันเดียวรีเซ็ตเป็นศูนย์
              ระบบย้อนอ่านร่องรอยจริง ไม่เดาจากยอดรวม (BR-56)
            </span>
          </div>

          {/* สิ่งที่ต้นแบบไม่ได้บอกเพราะต้นแบบไม่มีหลังบ้าน · เขียนไว้เพราะจอที่สัญญา
              พฤติกรรมที่ยังไม่มีใครเขียน คือจอที่โกหกอย่างสุภาพ */}
          <Note tone="warn">
            วิธีนับกับสวิตช์นี้ยังไม่มีอะไรอ่าน — ทางที่บวกค่าจริงคือ play_and_apply
            ซึ่งบวกตามจำนวนที่ผลลัพธ์ของกิจกรรมสั่ง ไม่ได้ดูวิธีนับ และยังไม่มีที่ไหนรีเซ็ตค่าเมื่อขาดวัน
            · ค่าที่ตั้งตรงนี้ถูกเก็บไว้รอทางนั้น ยังไม่ใช่กติกาที่มีผลกับผู้เล่นวันนี้
          </Note>

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">บันทึก</Button>
            </div>
          )}
        </form>

        <div style={{ height: 1, background: 'var(--rule)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={labelStyle}>จุดปลดล็อก · Milestones</span>

          {counter.milestones.map((milestone) => (
            <MilestoneForm
              key={milestone.id}
              campaignId={campaign.id}
              counter={counter}
              catalogue={catalogue}
              milestone={milestone}
            />
          ))}

          {canEdit && (
            <MilestoneForm campaignId={campaign.id} counter={counter} catalogue={catalogue} />
          )}

          <span style={noteStyle}>ผลที่ตามมาใช้ตัวเลือกชุดเดียวกับกิจกรรม ไม่มีชนิดใหม่</span>
        </div>

        {!counter.hasWriter && (
          <Note tone="danger">
            ยังไม่มีกิจกรรมเขียนค่าเข้ามา — เพิ่มผลที่ตามมา &ldquo;ค่าสะสม +…&rdquo;
            ในตารางผลลัพธ์ของกิจกรรมก่อน ไม่งั้นค่านี้จะไม่มีวันเพิ่ม
          </Note>
        )}

        {canEdit && (
          counter.canDelete ? (
            <form action={deleteCounter.bind(null, campaign.id, counter.id)}>
              <Button type="submit" variant="danger">ลบค่าสะสม</Button>
            </form>
          ) : (
            <span style={noteStyle}>{counter.deleteBlockedWhy}</span>
          )
        )}
      </Panel>
    </main>
  )
}
