import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Button, Empty, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import {
  COPIED_LABELS, REFUSED_LABELS, countCopyable, describeCounts,
} from '@/lib/campaign/duplicate'
import { listCampaigns } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { duplicate } from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8,
}

/** วันที่ในรูปที่ <input type="date"> รับได้ */
const asDateValue = (at: Date): string => at.toISOString().slice(0, 10)

/**
 * รายการที่ไม่มีช่องให้ติ๊ก
 *
 * The prototype draws these as two coloured lists and that is exactly right:
 * the moment either one becomes a set of checkboxes, the question stops being
 * "what happens" and becomes "what should I choose", and BR-24 is not a choice.
 * There is no input element anywhere in this component, and the action behind
 * the form has no parameter that would listen to one.
 */
function Outcome({ tone, heading, children }: {
  tone: 'ok' | 'danger'
  heading: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      border: `1px solid ${STATUS_TONES[tone].border}`,
      background: STATUS_TONES[tone].bg,
      borderRadius: 'var(--r-lg)',
      padding: '15px 18px',
    }}>
      <div style={{ ...labelStyle, color: STATUS_TONES[tone].fg }}>{heading}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  )
}

export default async function DuplicateCampaignPage({ searchParams }: {
  searchParams: Promise<{ from?: string }>
}) {
  const session = await getSession()
  // ชั้น layout กันไว้อยู่แล้ว แต่ layout กับ page เรนเดอร์พร้อมกัน ไม่ใช่ทีละชั้น
  if (!session) redirect('/login')
  if (session.role !== 'configurator') redirect('/campaigns')

  const { from } = await searchParams
  const sql = db()
  const campaigns = await listCampaigns(sql, new Date())
  const source = campaigns.find((campaign) => campaign.id === from) ?? null
  const counts = source ? await countCopyable(sql, source.id) : null

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <a href="/campaigns" style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-block', marginBottom: 10 }}>
        ← แคมเปญทั้งหมด
      </a>

      <PageHead code="M1-S03 · Duplicate" title="ก๊อปแคมเปญ" />

      {/* ข้อห้ามอยู่เหนือฟอร์ม ไม่ใช่ใต้ปุ่ม · คนอ่านมันก่อนกรอก ไม่ใช่หลังกด */}
      <Note tone="danger" style={{ marginBottom: 18, padding: '16px 18px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
          บัญชี LINE ไม่ถูกก๊อปไปด้วยเด็ดขาด (BR-24)
        </div>
        ถ้าก๊อปกุญแจตามไป แคมเปญใหม่จะยิงข้อความเข้า OA ของลูกค้ารายเดิมได้ตั้งแต่วินาทีแรกโดยไม่มีใครตั้งใจ
        — และข้อความที่ส่งเข้า LINE แล้วเรียกคืนไม่ได้
      </Note>

      {campaigns.length === 0 ? (
        <Empty
          title="ยังไม่มีแคมเปญให้ก๊อป"
          note="สร้างแคมเปญแรกก่อน แล้วค่อยกลับมาที่หน้านี้เมื่อต้องการทำตัวที่สองจากของเดิม"
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <Panel>
            <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* เลือกต้นทางเป็นฟอร์มของตัวเอง · จอเป็น Server Component ทั้งหน้า
                  การเลือกจึงเป็นการโหลดหน้าใหม่พร้อมจำนวนจริงของต้นทางนั้น */}
              <form method="get" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Field label="แคมเปญต้นทาง">
                  <select name="from" defaultValue={source?.id ?? ''}>
                    <option value="">— เลือกแคมเปญ —</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name} ({campaign.code})
                        {campaign.status === 'closed' ? ' · จบแล้ว' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button type="submit" variant="ghost">ดูว่าจะได้อะไรมาบ้าง</Button>
              </form>

              {source && (
                <form action={duplicate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <input type="hidden" name="source_id" value={source.id} />

                  <Field label="ชื่อแคมเปญใหม่ (บังคับ)">
                    <input name="name" required maxLength={100} defaultValue={`${source.name} (สำเนา)`} />
                  </Field>

                  <Field label="รหัสแคมเปญใหม่ (บังคับ · ไม่ซ้ำ)">
                    <input
                      name="code"
                      required
                      pattern="[a-z0-9_]{1,20}"
                      defaultValue={`${source.code}_copy`.slice(0, 20)}
                      style={{ fontFamily: 'var(--mono)' }}
                    />
                  </Field>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="วันเริ่ม (บังคับ)" id="dup-start">
                      <input name="start_at" type="date" required defaultValue={asDateValue(new Date())} />
                    </Field>
                    <Field label="วันสิ้นสุด (บังคับ)" id="dup-end">
                      <input name="end_at" type="date" required />
                    </Field>
                  </div>

                  <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                    ไม่ก๊อปวันเดิมมาให้ เพราะแคมเปญใหม่ย่อมเป็นคนละช่วงเวลา
                  </span>

                  <Button type="submit">ก๊อปแคมเปญ</Button>
                </form>
              )}
            </Panel.Row>
          </Panel>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {counts && (
              <Panel>
                <Panel.Row style={{ padding: '15px 18px' }}>
                  <div style={labelStyle}>จำนวนที่จะถูกก๊อป</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>{describeCounts(counts)}</div>
                </Panel.Row>
              </Panel>
            )}

            <Outcome tone="ok" heading="ก๊อปตามไป">
              {COPIED_LABELS.map((label) => (
                <div key={label} style={{ fontSize: 12, lineHeight: 1.5 }}>✓ {label}</div>
              ))}
            </Outcome>

            <Outcome tone="danger" heading="ไม่ก๊อป — ไม่มีช่องให้เปิด">
              {REFUSED_LABELS.map((refusal) => (
                <div key={refusal.what} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  ✕ {refusal.what}
                  <span style={{ display: 'block', opacity: 0.85, fontSize: 11 }}>
                    {refusal.why}
                  </span>
                </div>
              ))}
            </Outcome>
          </div>
        </div>
      )}
      </main>
    </div>
  )
}
