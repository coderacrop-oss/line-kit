import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import {
  Badge, type BadgeTone, Button, Empty, Field, Note, PageHead, Panel, Rows, STATUS_TONES,
} from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import {
  describeTarget, findConflicts, inMatchOrder, type KeywordRuleView,
} from '@/lib/campaign/keywords'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { loadKeywordScreen, type KeywordScreenData } from '@/lib/db/keywords'
import { deleteKeyword, saveKeyword } from './actions'

const MODE_LABEL: Record<KeywordRuleView['matchMode'], { badge: string; tone: BadgeTone; note: string }> = {
  exact: { badge: 'exact', tone: 'info', note: 'ตรงทั้งข้อความเท่านั้น' },
  contains: { badge: 'contains', tone: 'mute', note: 'มีคำนี้อยู่ที่ไหนก็ได้ในข้อความ' },
}

/** ปุ่มเปิดฟอร์มแบบเดียวกับหน้ารายการแคมเปญ — <details> แทน state ฝั่ง client */
const summaryStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
}

const chipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 12,
  background: 'var(--ground)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)', padding: '2px 6px',
}

function TargetOptions({ catalogue }: { catalogue: KeywordScreenData }) {
  return (
    <>
      <option value="">— เลือกปลายทาง —</option>
      {catalogue.activities.length > 0 && (
        <optgroup label="พาไปเล่นกิจกรรม">
          {catalogue.activities.map((a) => (
            <option key={a.id} value={`activity:${a.id}`}>
              {a.name} · {a.code}{a.isEnabled ? '' : ' (ปิดอยู่)'}
            </option>
          ))}
        </optgroup>
      )}
      {catalogue.cards.length > 0 && (
        <optgroup label="ตอบด้วยการ์ด">
          {catalogue.cards.map((c) => (
            <option key={c.id} value={`card:${c.id}`}>{c.code}</option>
          ))}
        </optgroup>
      )}
    </>
  )
}

/**
 * ฟอร์มเดียวกันทั้งตอนสร้างและตอนแก้ · ต่างกันแค่ช่อง id ที่ซ่อนไว้
 *
 * Every Field is given an explicit id. Field derives one from its label, and
 * this screen puts the same three labels on the page once per rule, so letting
 * it derive would point every "คำที่ผู้ใช้พิมพ์" label at the first row's input.
 */
function KeywordForm({ campaignId, data, rule }: {
  campaignId: string
  data: KeywordScreenData
  rule?: KeywordRuleView
}) {
  const key = rule ? rule.id : 'new'
  const selected = rule?.targetActivityId
    ? `activity:${rule.targetActivityId}`
    : rule?.targetCardId
      ? `card:${rule.targetCardId}`
      : ''

  return (
    <form
      // id ของแคมเปญผูกมากับ action · ช่องซ่อนในฟอร์มเป็นของที่ผู้ส่งแก้เองได้ทั้งใบ
      action={saveKeyword.bind(null, campaignId)}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <Field
        id={`kw-${key}`}
        label="คำที่ผู้ใช้พิมพ์ · Keyword"
        hint="เก็บในรูปมาตรฐาน — ตัดช่องว่างซ้ำและลดเป็นตัวพิมพ์เล็กก่อนบันทึก เพราะเครื่องเทียบข้อความที่รับเข้ามาด้วยรูปเดียวกัน (BR-48)"
      >
        <input
          name="keyword"
          defaultValue={rule?.keyword}
          required
          maxLength={120}
          placeholder="เช่น เล่นเกม"
          style={{ fontFamily: 'var(--mono)' }}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field id={`mode-${key}`} label="โหมดจับคู่ · Match mode">
          <select name="match_mode" defaultValue={rule?.matchMode ?? 'exact'}>
            <option value="exact">exact · {MODE_LABEL.exact.note}</option>
            <option value="contains">contains · {MODE_LABEL.contains.note}</option>
          </select>
        </Field>

        <Field
          id={`target-${key}`}
          label="ปลายทาง · Target (บังคับ)"
          hint="เลือกได้อย่างเดียว — เครื่องเล่นกิจกรรมก่อนเสมอ การ์ดที่ตั้งไว้พร้อมกันจะไม่ถูกใช้"
        >
          <select name="target" defaultValue={selected} required>
            <TargetOptions catalogue={data} />
          </select>
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit">{rule ? 'บันทึกคำนี้' : 'เพิ่มคีย์เวิร์ด'}</Button>
      </div>
    </form>
  )
}

function KeywordRow({ campaignId, rule, data, canEdit, canDelete }: {
  campaignId: string
  rule: KeywordRuleView
  data: KeywordScreenData
  canEdit: boolean
  canDelete: boolean
}) {
  const mode = MODE_LABEL[rule.matchMode]
  const target = describeTarget(rule, data)

  const line = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
      <span style={chipStyle}>{rule.keyword}</span>
      <Badge tone={mode.tone} title={mode.note}>{mode.badge}</Badge>
      <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>→</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        <span style={{ color: 'var(--ink-3)', fontWeight: 400, marginRight: 6 }}>
          {target.kind === 'card' ? 'การ์ด' : 'กิจกรรม'}
        </span>
        {target.label}
      </span>
      {target.kind === 'dead' && <Badge tone="danger">คำนี้ไม่ทำอะไร</Badge>}
    </span>
  )

  const body = (
    <>
      {line}
      {target.warning && (
        <span style={{ display: 'block', fontSize: 11, marginTop: 6, color: STATUS_TONES.warn.fg }}>
          ⚠ {target.warning}
        </span>
      )}
    </>
  )

  if (!canEdit) return <div>{body}</div>

  return (
    <details>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
        {line}
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>แก้</span>
      </summary>

      {target.warning && (
        <Note tone="warn" style={{ marginTop: 12 }}>{target.warning}</Note>
      )}

      <div style={{ marginTop: 14 }}>
        <KeywordForm campaignId={campaignId} data={data} rule={rule} />
      </div>

      {canDelete && (
        <form
          action={deleteKeyword.bind(null, campaignId, rule.id)}
          style={{
            marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule)',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}
        >
          <Button variant="danger" type="submit">ลบคำนี้</Button>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            ลบแล้วคนที่พิมพ์คำนี้จะได้การ์ดตั้งต้นของบัญชีแทน และไม่มี error ที่ไหนบอกว่าเคยมีคำนี้อยู่
          </span>
        </form>
      )}
    </details>
  )
}

export default async function KeywordsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const data = await loadKeywordScreen(sql, id)
  const rules = inMatchOrder(data.rules)
  const conflicts = findConflicts(rules.map((r) => r.keyword), data.channels)

  const canEdit = session.role === 'configurator' || session.role === 'content_editor'
  const canDelete = session.role === 'configurator'
  const hasTargets = data.activities.length > 0 || data.cards.length > 0

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M1-S06 · Keywords"
        title="คีย์เวิร์ดตอบกลับ"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {campaign.name}
            </a>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <Panel style={{ padding: '14px 18px', marginBottom: 16, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--ink)' }}>exact ตรวจก่อน contains เสมอ</b> — ในกลุ่มเดียวกันไล่จากบนลงล่าง
        · รายการข้างล่างเรียงตามลำดับที่เครื่องตรวจจริง ไม่ใช่ตามลำดับที่สร้าง
        · คำที่ไม่ตรงกับข้อไหนเลย จะได้การ์ดตั้งต้นของบัญชี
      </Panel>

      {/* คำเตือนที่เป็นเหตุผลของทั้งจอนี้ (BR-44) */}
      {conflicts.length > 0 && (
        <Note tone="warn" style={{ marginBottom: 16 }}>
          <b>คีย์เวิร์ดชนกับที่ลูกค้าตั้งไว้เองใน OA Manager</b>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
            {conflicts.map((c) => (
              <li key={`${c.keyword}-${c.channelName}`} style={{ marginBottom: 4 }}>
                คำว่า <b>{c.keyword}</b> ชนกับคีย์เวิร์ดเดิมของ <b>{c.channelName}</b> —
                ของลูกค้าจะตอบก่อน แล้วกิจกรรมนี้จะไม่ทำงาน โดยไม่มี error ให้เห็น
              </li>
            ))}
          </ul>
        </Note>
      )}

      {campaign.status === 'published' && (
        <Note tone="info" style={{ marginBottom: 16 }}>
          แคมเปญนี้ส่งขึ้นแล้ว — เครื่องอ่านชุดคีย์เวิร์ดตอนโหลด config เวอร์ชันที่ส่งขึ้น
          แล้วเก็บไว้ในหน่วยความจำ คำที่แก้ตรงนี้จึงมีผลกับเครื่องที่ยังไม่ได้โหลดใหม่เท่านั้น
        </Note>
      )}

      {canEdit && (hasTargets ? (
        <details style={{ marginBottom: 14 }}>
          <summary style={summaryStyle}>＋ เพิ่มคีย์เวิร์ด</summary>
          <Panel style={{ marginTop: 10 }}>
            <Panel.Row>
              <KeywordForm campaignId={campaign.id} data={data} />
            </Panel.Row>
          </Panel>
        </details>
      ) : (
        <Note tone="info" style={{ marginBottom: 14 }}>
          แคมเปญนี้ยังไม่มีกิจกรรมหรือการ์ดให้คีย์เวิร์ดชี้ไปหา — สร้างอย่างใดอย่างหนึ่งก่อน
          แล้วค่อยกลับมาตั้งคำที่จะพาคนไปที่นั่น
        </Note>
      ))}

      <Rows
        items={rules}
        renderRow={(rule) => (
          <KeywordRow
            key={rule.id}
            campaignId={campaign.id}
            rule={rule}
            data={data}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
        empty={
          <Empty
            title="ยังไม่มีคีย์เวิร์ด"
            note="ผู้ใช้พิมพ์อะไรก็จะได้การ์ดตั้งต้นของบัญชีเท่านั้น — ไม่มีคำไหนพาไปเล่นกิจกรรมได้"
          />
        }
      />
    </main>
  )
}
