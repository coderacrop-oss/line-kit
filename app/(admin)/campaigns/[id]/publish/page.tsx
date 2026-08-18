import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { describeLastUsed, maskedKey } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { configFor, type PublishChannel, loadPublishScreen } from '@/lib/db/publish'
import {
  type Check, CONFIRM_WORD, type PublishCard, checkPublish, WHERE, whereHref,
} from '@/lib/publish/validate'
import { publish, saveDefaultCard } from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const headStyle: CSSProperties = {
  padding: '13px 18px', borderBottom: '1px solid var(--rule)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 10, flexWrap: 'wrap', fontSize: 14, fontWeight: 600,
}

const keyStyle: CSSProperties = {
  fontSize: 11, color: 'var(--ink-3)', marginTop: 2, fontFamily: 'var(--mono)',
}

const cellStyle: CSSProperties = { width: 96, fontFamily: 'var(--mono)', fontSize: 12 }

/** ชื่อชั้นของบัญชีอย่างที่ต้นแบบเขียน · เขียนเป็นคำ ไม่ใช่พึ่งสีอย่างเดียว (BR-19) */
const TIER_NAME: Record<string, string> = {
  test: 'บัญชีทดสอบ',
  production: 'บัญชีลูกค้า',
}

const TONE_MARK: Record<Check['tone'], { icon: string; tone: 'ok' | 'warn' | 'danger' }> = {
  ok: { icon: '✓', tone: 'ok' },
  warn: { icon: '!', tone: 'warn' },
  blocked: { icon: '✕', tone: 'danger' },
}

/**
 * หนึ่งแถวของผลตรวจ · ข้อที่แก้ได้จะมีทางไปแก้เสมอ
 *
 * ลิงก์ไม่ได้มีเฉพาะข้อที่บล็อก · คำเตือนก็กดไปแก้ได้ เพราะคำเตือนที่กดไม่ได้คือ
 * คำเตือนที่คนอ่านแล้วเลื่อนผ่าน
 */
function CheckRow({ campaignId, check }: { campaignId: string; check: Check }) {
  const mark = TONE_MARK[check.tone]

  return (
    <div
      data-check={check.tone}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: '13px 18px', borderBottom: '1px solid var(--rule)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: 'var(--panel)', background: STATUS_TONES[mark.tone].border,
        }}
      >
        {mark.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: check.tone === 'ok' ? 'var(--ink)' : STATUS_TONES[mark.tone].fg,
        }}>
          {check.label}
        </div>
        {check.detail && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
            {check.detail}
          </div>
        )}
      </div>
      {check.where && check.tone !== 'ok' && (
        <a
          href={whereHref(campaignId, check.where)}
          style={{
            flexShrink: 0, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--rule)', borderRadius: 'var(--r)',
            padding: '6px 12px', background: 'var(--panel)', color: 'var(--ink)',
          }}
        >
          ไปแก้ →
        </a>
      )}
    </div>
  )
}

type EffectiveRow = { key: string; base: string; effective: string; differs: boolean }

/** ค่าที่บัญชีนี้ตั้งทับค่าของแคมเปญ (BR-28) · ต้นแบบวาดเป็นสามคอลัมน์ */
function effectiveRows(
  channel: PublishChannel | null,
  counters: ReadonlyArray<{ code: string; name: string; target: number }>,
  campaignDayLengthSec: number,
): EffectiveRow[] {
  const day = channel?.dayLengthSec ?? null
  const rows: EffectiveRow[] = [{
    key: 'ความยาวของหนึ่งวัน',
    base: `${campaignDayLengthSec} วินาที`,
    effective: `${day ?? campaignDayLengthSec} วินาที`,
    differs: day !== null && day !== campaignDayLengthSec,
  }]

  for (const counter of counters) {
    const override = channel?.counterTargets[counter.code]
    rows.push({
      key: `เป้าของ "${counter.name}"`,
      base: String(counter.target),
      effective: String(override ?? counter.target),
      differs: override !== undefined && override !== counter.target,
    })
  }

  return rows
}

export default async function PublishPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ channel?: string; done?: string }>
}) {
  const session = await getSession()
  // ชั้น layout กันไว้อยู่แล้ว แต่ layout กับ page เรนเดอร์พร้อมกัน ไม่ใช่ทีละชั้น
  if (!session) redirect('/login')

  const { id } = await params
  if (session.role !== 'configurator') redirect(`/campaigns/${id}`)

  const { channel: picked, done } = await searchParams
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const { base, channels, latestVersion, campaignDayLengthSec } =
    await loadPublishScreen(sql, campaign.id)

  const selected = channels.find((row) => row.id === picked) ?? null

  /*
   * รายการผลตรวจถูกสร้างด้วย confirmed = true โดยตั้งใจ
   *
   * BR-18 มีกล่องสีแดงของตัวเองอยู่ล่างขวาแล้ว การให้มันโผล่เป็นข้อในรายการซ้ำอีก
   * จะทำให้ตัวนับ "N ข้อต้องแก้" นับสิ่งที่แก้ไม่ได้ด้วยการไปแก้ที่จออื่น และคนอ่าน
   * จะเรียนรู้ว่าตัวเลขนั้นไม่ตรง · ตัว Server Action ตรวจด้วยค่าที่พิมพ์มาจริง
   */
  const checks = checkPublish(configFor(base, selected, true))
    .filter((check) => check.where !== WHERE.confirm)
  const blockers = checks.filter((check) => check.tone === 'blocked')

  const isProduction = selected?.channelType === 'production'
  const rows = effectiveRows(selected, base.counters, campaignDayLengthSec)
  const anyDiff = rows.some((row) => row.differs)
  const clash = selected?.liveCampaign && selected.liveCampaign.id !== campaign.id
    ? selected.liveCampaign
    : null

  const canPublish = Boolean(selected) && blockers.length === 0 && !clash
  const nextVersion = latestVersion + 1

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        code="M1-S04 · Publish"
        title="ส่งขึ้น LINE"
        actions={
          <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            ← {campaign.name}
          </a>
        }
      />

      {done && (
        <Note tone="ok" style={{ marginBottom: 18, padding: '16px 18px', fontSize: 13 }}>
          <b>ส่งขึ้น LINE แล้ว</b> — v{done} · บันทึกเป็นประวัติเรียบร้อย
        </Note>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <Panel>
          <div style={headStyle}>
            <span>ผลตรวจความครบถ้วน</span>
            <span style={{
              ...labelStyle,
              color: blockers.length ? STATUS_TONES.danger.border : STATUS_TONES.ok.border,
            }}>
              {blockers.length ? `${blockers.length} ข้อต้องแก้` : 'ผ่านทุกข้อ'}
            </span>
          </div>

          {checks.map((check, index) => (
            <CheckRow key={`${check.code}-${index}`} campaignId={campaign.id} check={check} />
          ))}

          {/*
            หนี้ทางเทคนิคที่เขียนไว้บนจอ ไม่ใช่ในคอมเมนต์

            ด่าน BR-37 อ่าน card.has_sample_text ซึ่งยังไม่มีโค้ดไหนเขียนค่าลงไป
            เครื่องหมายถูกข้างบนจึงแปลว่า "ไม่มีใครบอกว่าใบไหนเป็น" ไม่ใช่ "ตรวจแล้ว
            ไม่เจอ" · ปล่อยให้คนอ่านเข้าใจผิดข้อนี้คือการโกหกด้วยเครื่องหมายถูก
          */}
          <div style={{ padding: '13px 18px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            ด่าน BR-37 อ่านค่าที่การ์ดบันทึกไว้ แต่<b>ยังไม่มีจอไหนบันทึกว่าการ์ดใบไหนเป็นข้อความตัวอย่าง</b>
            {' '}— จอสร้างการ์ด (M3-S02) ยังไม่ถูกสร้าง ด่านนี้จึงยังไม่มีวันติดจนกว่าจอนั้นจะมา
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel>
            <div style={headStyle}>เลือกบัญชี LINE ปลายทาง</div>

            {channels.length === 0 ? (
              <div style={{ padding: 18, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                ยังไม่ได้ผูกบัญชี LINE —{' '}
                <a href="/channels" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
                  ไปที่หน้าบัญชี LINE เพื่อผูก
                </a>
                {' '}แล้วค่อยกลับมาส่งขึ้น
              </div>
            ) : (
              <form method="get">
                {channels.map((row) => (
                  <label
                    key={row.id}
                    data-channel={row.channelType}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: '14px 18px', borderBottom: '1px solid var(--rule)', cursor: 'pointer',
                      background: row.id === selected?.id ? 'var(--ground)' : undefined,
                    }}
                  >
                    <input
                      type="radio"
                      name="channel"
                      value={row.id}
                      defaultChecked={row.id === selected?.id}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600, display: 'flex',
                        alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      }}>
                        {row.name}
                        <Badge tone={row.channelType === 'production' ? 'danger' : 'warn'}>
                          {TIER_NAME[row.channelType] ?? row.channelType}
                        </Badge>
                      </span>
                      <span style={{ ...keyStyle, display: 'block' }}>
                        key {maskedKey(row.tokenLast4)} · ใช้ล่าสุด {describeLastUsed(row.lastUsedAt, new Date())}
                      </span>
                      {row.publishedVersion !== null && (
                        <span style={{
                          display: 'block', fontSize: 11, marginTop: 3,
                          color: STATUS_TONES.warn.fg,
                        }}>
                          ⚠ เคยส่งขึ้นแล้ว — ครั้งนี้จะทับ v{row.publishedVersion} ด้วย v{nextVersion}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                <div style={{ padding: '12px 18px' }}>
                  <Button type="submit" variant="ghost">ดูค่าที่จะใช้จริงกับบัญชีนี้</Button>
                </div>
              </form>
            )}
          </Panel>

          {selected && (
            <Panel id="default-card">
              <div style={headStyle}>การ์ดตั้งต้น</div>
              <div style={{ padding: 18 }}>
                <form action={saveDefaultCard.bind(null, campaign.id, selected.id)}>
                  <Field
                    label="การ์ดตั้งต้นเมื่อผู้เล่นพิมพ์ลอยๆ (BR-39)"
                    hint="ผูกกับบัญชีนี้โดยเฉพาะ ไม่ใช่กับแคมเปญ — บัญชีอื่นตั้งค่าคนละใบได้"
                  >
                    <select name="default_card_id" defaultValue={selected.defaultCardId ?? ''}>
                      <option value="">— ยังไม่เลือก —</option>
                      {base.cards.map((card: PublishCard) => (
                        <option key={card.id} value={card.id}>{card.code}</option>
                      ))}
                    </select>
                  </Field>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button type="submit" variant="ghost">บันทึกการ์ดตั้งต้น</Button>
                  </div>
                </form>
              </div>
            </Panel>
          )}

          <Panel>
            <div style={headStyle}>
              <span>ค่าที่จะใช้จริงกับบัญชีนี้</span>
              {anyDiff && <Badge tone="warn">ต่างจากค่าตั้งต้น</Badge>}
            </div>

            <div style={{ display: 'flex', padding: '8px 18px', borderBottom: '1px solid var(--rule)' }}>
              <span style={{ ...labelStyle, flex: 1 }}>รายการ</span>
              <span style={{ ...labelStyle, width: 96 }}>ตั้งต้น</span>
              <span style={{ ...labelStyle, width: 96 }}>จะใช้จริง</span>
            </div>

            {rows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'flex', padding: '11px 18px', alignItems: 'center',
                  borderBottom: '1px solid var(--rule)',
                  background: row.differs ? STATUS_TONES.warn.bg : undefined,
                }}
              >
                <span style={{ flex: 1, fontSize: 12 }}>{row.key}</span>
                <span style={{ ...cellStyle, color: 'var(--ink-3)' }}>{row.base}</span>
                <span style={{
                  ...cellStyle,
                  color: row.differs ? STATUS_TONES.warn.fg : 'var(--ink)',
                  fontWeight: row.differs ? 600 : 400,
                }}>
                  {row.effective}
                </span>
              </div>
            ))}

            {anyDiff && (
              <div style={{
                padding: '11px 18px', fontSize: 11, lineHeight: 1.6,
                color: STATUS_TONES.warn.fg, background: STATUS_TONES.warn.bg,
              }}>
                บัญชีนี้ตั้งค่าต่างจากค่าตั้งต้นของแคมเปญ — ตรวจว่าตั้งใจจริง
              </div>
            )}
          </Panel>

          {clash && (
            <Note tone="danger" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                บัญชีนี้มีแคมเปญ {clash.name} เปิดอยู่ (BR-68)
              </div>
              OA หนึ่งบัญชีรันแคมเปญได้ทีละหนึ่ง — ต้องถอนแคมเปญนั้นก่อนจึงจะส่งแคมเปญนี้ขึ้นได้
            </Note>
          )}

          {selected && !selected.lineChannelId && (
            <Note tone="warn" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                บัญชีนี้ยังไม่มีรหัสช่องของ LINE
              </div>
              webhook หาว่า event เป็นของแคมเปญไหนจากรหัสนี้ — ว่างอยู่แปลว่าส่งขึ้นแล้วบอทจะยังเงียบ
              · ยังไม่มีช่องให้กรอกที่จอบัญชี LINE (M6-S02) เป็นหนี้ทางเทคนิคที่ค้างอยู่
            </Note>
          )}

          {isProduction && anyDiff && (
            <Note tone="danger" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                กำลังส่งค่าของโหมดเดโม่ขึ้นบัญชีจริงของลูกค้า
              </div>
              หนึ่งวันของแคมเปญนี้จะเท่ากับ {rows[0].effective} สำหรับผู้ร่วมสนุกจริง และกู้ไม่ได้
            </Note>
          )}

          {selected && (
            <form action={publish.bind(null, campaign.id)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input type="hidden" name="channel_id" value={selected.id} />

              {isProduction && (
                <div
                  id="confirm"
                  style={{
                    border: `2px solid ${STATUS_TONES.danger.border}`,
                    background: STATUS_TONES.danger.bg,
                    borderRadius: 'var(--r-lg)', padding: 18,
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                >
                  <Badge tone="danger">บัญชีจริงของลูกค้า</Badge>
                  <div style={{ fontSize: 13, color: STATUS_TONES.danger.fg, lineHeight: 1.65 }}>
                    กำลังจะส่งขึ้น <b>{selected.name}</b> ซึ่งผู้ร่วมสนุกจริงมองเห็น —
                    ข้อความที่ส่งเข้า LINE แล้ว<b>ลบหรือเรียกคืนไม่ได้</b>
                  </div>
                  <label
                    htmlFor="publish-confirm"
                    style={{ ...labelStyle, color: STATUS_TONES.danger.fg }}
                  >
                    พิมพ์ &quot;{CONFIRM_WORD}&quot; เพื่อปลดล็อกปุ่ม
                  </label>
                  {/*
                    required + pattern คือด่านของเบราว์เซอร์ ไม่ใช่ด่านจริง
                    ด่านจริงอยู่ที่ Server Action ซึ่งตรวจคำนี้อีกครั้งเสมอ (BR-18)
                  */}
                  <input
                    id="publish-confirm"
                    name="confirm"
                    required
                    pattern={CONFIRM_WORD}
                    placeholder={CONFIRM_WORD}
                    autoComplete="off"
                    style={{ borderColor: STATUS_TONES.danger.border }}
                  />
                </div>
              )}

              <Button
                type="submit"
                variant={isProduction ? 'danger' : 'primary'}
                disabled={!canPublish}
                style={{ padding: 14, fontSize: 15 }}
              >
                {isProduction ? 'ส่งขึ้น LINE — บัญชีจริงของลูกค้า' : 'ส่งขึ้น LINE'}
              </Button>
            </form>
          )}

          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            การส่งขึ้นจะบันทึกเป็นประวัติ version ใหม่เสมอ (BR-18) · แถบสีบอกบัญชีแสดงเฉพาะหน้า
            ทดลองเล่น / ส่งขึ้น / รายงาน (BR-19)
          </div>
        </div>
      </div>
    </main>
  )
}
