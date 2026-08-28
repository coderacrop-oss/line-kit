import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Note, PageHead, Panel } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import {
  CARD_TEMPLATE_GROUPS, SEND_TYPE_OPTIONS,
  type CardTemplate, type SendType, type TemplateGroupKey,
  asSendType, blocksFromTemplate, hasSampleText, listCardTemplates, sendTypeName,
} from '@/lib/cards/create'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { createCard } from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const stepStyle: CSSProperties = {
  ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
}

const gridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 10,
}

const tileStyle = (chosen: boolean, open: boolean): CSSProperties => ({
  border: `1px solid ${chosen ? 'var(--ink)' : 'var(--rule)'}`,
  background: open ? 'var(--panel)' : 'var(--panel-2)',
  borderRadius: 'var(--r)',
  padding: '13px 14px',
  display: 'flex', flexDirection: 'column', gap: 5,
  textDecoration: 'none', color: 'var(--ink)',
  opacity: open ? 1 : 0.65,
  cursor: open ? 'pointer' : 'not-allowed',
})

const tileNameStyle: CSSProperties = { fontSize: 13, fontWeight: 600, lineHeight: 1.35 }
const tileNoteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }
const axisTagStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.04em', color: 'var(--ink-3)',
}

/**
 * เครื่องหมายคูณคือทั้งหมดของเรื่องนี้
 *
 * ชนิดการส่งกับเทมเพลตเป็นแกนอิสระสองแกน ไม่ใช่รายการเดียวที่ยาวขึ้น · เทมเพลตสิบตัว
 * คูณชนิดห้าชนิดคือห้าสิบคู่ที่ต้องคอยดูแลให้ตรงกัน ถ้ายุบเป็นรายการเดียว แต่เป็นของ
 * สิบห้าชิ้นถ้าปล่อยให้มันคูณกันตอนคนเลือก · หัวจอจึงเขียนคูณให้เห็นตลอด แม้ตอนที่
 * ยังเลือกไม่ครบทั้งสองแกน
 */
function Axes({ send, template }: { send: SendType | null; template: CardTemplate | null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      fontSize: 16, fontWeight: 600, marginBottom: 18,
    }}>
      <span style={{ color: send ? 'var(--ink)' : 'var(--rule-2)' }}>
        {send ? sendTypeName(send) : 'ยังไม่เลือกชนิด'}
      </span>
      <span style={{ color: 'var(--ink-3)', fontSize: 18 }}>×</span>
      <span style={{ color: template ? 'var(--ink)' : 'var(--rule-2)' }}>
        {template ? template.name : 'ยังไม่เลือกเทมเพลต'}
      </span>
    </div>
  )
}

function StepHead({ step, title, done }: { step: number; title: string; done: boolean }) {
  return (
    <div style={stepStyle}>
      <span>ขั้นที่ {step}</span>
      <span style={{ color: 'var(--ink)', textTransform: 'none', fontFamily: 'inherit', fontSize: 13 }}>
        {title}
      </span>
      {done && <Badge tone="ok">เลือกแล้ว</Badge>}
    </div>
  )
}

export default async function NewCardPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const query = await searchParams

  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  // สร้างการ์ดคือการเพิ่มโครงสร้างของแคมเปญ ไม่ใช่การแก้เนื้อหาในนั้น
  if (session.role !== 'configurator') redirect(`/campaigns/${campaign.id}/cards`)

  const single = (key: string) => (typeof query[key] === 'string' ? query[key] : undefined)
  const send = asSendType(single('send'))
  const ownerActivityId = single('owner')
  const templates = send ? await listCardTemplates(sql) : []
  const template = templates.find((row) => row.code === single('tpl')) ?? null

  const ownerSuffix = ownerActivityId ? `&owner=${encodeURIComponent(ownerActivityId)}` : ''
  const cardsHref = ownerActivityId
    ? `/campaigns/${campaign.id}/activities/${ownerActivityId}/quiz`
    : `/campaigns/${campaign.id}/cards`
  const stepOneHref = (value: string) => `?send=${encodeURIComponent(value)}${ownerSuffix}`
  const stepTwoHref = (code: string) =>
    `?send=${encodeURIComponent(send ?? '')}&tpl=${encodeURIComponent(code)}${ownerSuffix}`

  const byGroup = (key: TemplateGroupKey) => templates.filter((row) => row.group === key)
  const preview = template && send ? blocksFromTemplate(template.blocks, send) : []
  const dropped = template && send ? template.blocks.length - preview.length : 0

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1000, margin: '0 auto' }}>
      <a href={cardsHref} style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-block', marginBottom: 10 }}>
        {ownerActivityId ? '← กลับไปตั้งค่าควิซ' : '← การ์ดทั้งหมด'}
      </a>

      <PageHead
        code="M3-S02 · Card"
        title="สร้างการ์ด"
        actions={<span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{campaign.name}</span>}
      />

      <Axes send={send} template={template} />

      {campaign.status !== 'draft' && (
        <Note tone="info" style={{ marginBottom: 18, maxWidth: 640 }}>
          แคมเปญนี้ส่งขึ้น LINE แล้ว — การ์ดที่เพิ่มตอนนี้จะมีผลกับ<b>การ์ดที่ส่งครั้งถัดไป</b>
          {' '}ไม่ใช่ใบที่ส่งเข้าแชทไปแล้ว (ข้อจำกัดของ Flex · L1 §1.4)
        </Note>
      )}

      {/* ── ขั้นที่ 1 · ชนิดการส่ง (BR-89) ───────────────────────────────── */}
      <section style={{ marginBottom: 22 }}>
        <StepHead step={1} title="ผู้เล่นจะได้รับการ์ดนี้เป็นอะไร" done={send !== null} />

        <div style={gridStyle}>
          {SEND_TYPE_OPTIONS.map((option) => {
            const chosen = option.value === send
            const body = (
              <>
                <span style={tileNameStyle}>{option.name}</span>
                <span style={tileNoteStyle}>{option.detail}</span>
                {option.blockedReason && (
                  <span style={{ ...axisTagStyle, color: 'var(--warn)' }}>
                    ⏳ {option.blockedReason}
                  </span>
                )}
              </>
            )

            /*
             * ตัวที่ยังทำไม่ได้อยู่ในรายการแบบกดไม่ได้ ไม่ใช่หายไป
             *
             * ซ่อนแล้วเพดานของสไลซ์นี้จะดูเหมือนการตัดสินใจออกแบบ แทนที่จะเป็น
             * ตัววาดภาพที่ยังไม่มีใครเขียน · คนที่ต้องการริชเมสเสจจะได้รู้ว่ามันกำลัง
             * มา ไม่ใช่เดาเอาว่าระบบนี้ทำไม่ได้
             */
            return option.open ? (
              <a key={option.value} href={stepOneHref(option.value)} style={tileStyle(chosen, true)}>
                {body}
              </a>
            ) : (
              <div
                key={option.value}
                aria-disabled="true"
                data-send-type-locked={option.value}
                style={tileStyle(false, false)}
              >
                {body}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── ขั้นที่ 2 · เทมเพลต (BR-63) ──────────────────────────────────── */}
      <section style={{ marginBottom: 22 }}>
        <StepHead step={2} title="เริ่มจากโครงไหน" done={template !== null} />

        {send === null ? (
          <Empty
            title="เลือกชนิดการส่งก่อน"
            note="เทมเพลตกับชนิดการส่งเป็นคนละแกนกัน — เทมเพลตเดียวกันใช้ได้กับทุกชนิด แต่ต้องรู้ก่อนว่าจะส่งเป็นอะไร จึงจะบอกได้ว่าบล็อกไหนรอด"
          />
        ) : templates.length === 0 ? (
          <Empty
            title="ยังไม่มีเทมเพลตในระบบ"
            note="ตาราง card_template ว่างอยู่ — ลง migration ล่าสุดแล้วลองใหม่"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {CARD_TEMPLATE_GROUPS.map((group) => {
              const rows = byGroup(group.key)
              if (rows.length === 0) return null

              return (
                <div key={group.key}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>{group.label}</div>
                  <div style={{ ...tileNoteStyle, marginBottom: 9 }}>{group.note}</div>
                  <div style={gridStyle}>
                    {rows.map((row) => (
                      <a
                        key={row.code}
                        href={stepTwoHref(row.code)}
                        data-template={row.code}
                        style={tileStyle(row.code === template?.code, true)}
                      >
                        <span style={tileNameStyle}>{row.name}</span>
                        <span style={axisTagStyle}>
                          {sendTypeName(send)} × {row.name}
                        </span>
                        {row.description && <span style={tileNoteStyle}>{row.description}</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── ตั้งชื่อแล้วสร้าง ─────────────────────────────────────────────── */}
      {send && template && (
        <Panel>
          <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form action={createCard} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <input type="hidden" name="send_type" value={send} />
              <input type="hidden" name="template_code" value={template.code} />
              {ownerActivityId && <input type="hidden" name="owner_activity_id" value={ownerActivityId} />}

              <Field
                label="รหัสการ์ด (บังคับ · ไม่ซ้ำในแคมเปญ)"
                hint="ใช้เรียกการ์ดใบนี้ในที่อื่น — a-z 0-9 และขีดล่าง"
              >
                <input
                  name="code"
                  required
                  pattern="[a-z0-9_]{1,40}"
                  maxLength={40}
                  defaultValue={template.code === 'blank' ? 'card' : template.code}
                  style={{ fontFamily: 'var(--mono)' }}
                />
              </Field>

              <div style={{ ...tileNoteStyle }}>
                จะได้ {preview.length} บล็อก: {preview.map((block) => block.blockType).join(' · ')}
                {dropped > 0 && (
                  <>
                    {' '}· ตัดออก {dropped} บล็อกที่ส่งเป็นข้อความล้วนแล้วผู้เล่นไม่มีวันเห็น
                  </>
                )}
              </div>

              {hasSampleText(preview) && (
                <Note tone="warn">
                  ยังเป็น<b>ข้อความตัวอย่าง</b>จากเทมเพลต — แก้ให้เป็นของจริงก่อนส่งขึ้น (BR-37)
                  {' '}· การ์ดใบนี้จะบล็อกการส่งขึ้นบัญชีจริงไว้จนกว่าจะแก้
                </Note>
              )}

              <Button type="submit">สร้างการ์ด</Button>
            </form>

            {/* ปลายทางหลังกดสร้าง เขียนไว้บนจอ ไม่ใช่ให้คนเดาเอาตอนหน้าเปลี่ยน —
                บล็อกเอดิเตอร์ของ M3-S02 มีไฟล์จริงแล้ว (Task 13) */}
            <div style={tileNoteStyle}>
              กดแล้วพาไปแก้บล็อกของการ์ดใบนี้ทันที — บล็อกของเทมเพลตติดมาให้แล้ว พร้อมแก้ต่อได้เลย
            </div>
          </Panel.Row>
        </Panel>
      )}
    </main>
  )
}
