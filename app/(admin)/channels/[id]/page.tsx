import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import {
  type ChannelSummary, type ChannelType, describePublished, loadChannel, maskedKey,
} from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { fetchBotUserId, saveChannel } from '../actions'
import { BotUserIdField } from './BotUserIdField'
import { ChannelForm } from './ChannelForm'

/**
 * `/channels/new` เป็นจอเดียวกับ `/channels/<id>`
 *
 * The prototype draws one screen and changes only its title, so this is one
 * file. `new` is not a channel id — every real one is a uuid — and splitting it
 * into its own route would mean the same twelve fields maintained twice.
 */
const NEW = 'new'

/** สองชั้นที่ผูกกุญแจได้ · preview ระบบเป็นคนสร้าง และ CHECK ห้ามมันมีกุญแจ */
const CHOICES: Array<{ type: ChannelType; name: string; note: string }> = [
  { type: 'test', name: 'บัญชีทดสอบ', note: 'OA ภายในทีม ใช้ตรวจก่อนขึ้นจริง' },
  { type: 'production', name: 'บัญชีจริงของลูกค้า', note: 'ผู้ร่วมสนุกจริงมองเห็น' },
]

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const choiceStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: '12px 14px',
  cursor: 'pointer',
}

/**
 * ชั้นของบัญชีเป็นวิทยุสองปุ่ม ไม่ใช่ช่องเลือก
 *
 * Each tier carries a sentence about who can see a mistake made on it, and a
 * <select> has nowhere to put that sentence. It is a <fieldset> so the two
 * options are announced as one question rather than as two unrelated checkboxes.
 */
function TierChoice({ current, disabled }: { current: ChannelType; disabled: boolean }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <legend style={{ ...labelStyle, padding: 0 }}>ประเภทบัญชี · Type</legend>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {CHOICES.map((choice) => (
          <label key={choice.type} style={choiceStyle}>
            <input
              type="radio"
              name="channel_type"
              value={choice.type}
              defaultChecked={choice.type === current}
              disabled={disabled}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{choice.name}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                {choice.note}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default async function BindChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const isNew = id === NEW

  let channel: ChannelSummary | null = null
  if (!isNew) {
    channel = await loadChannel(db(), id)
    if (!channel) notFound()
  }

  const canEdit = session.role === 'configurator'
  const locked = !canEdit
  // ชั้น preview ไม่มีกุญแจให้แก้ · action ปฏิเสธเองอีกชั้นหนึ่ง
  const isPreview = channel?.channelType === 'preview'
  const published = channel ? describePublished(channel) : null

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin={canEdit} />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 600 }}>
      <a href="/channels" style={{ fontSize: 12, color: 'var(--ink-3)' }}>← บัญชี LINE ทั้งหมด</a>

      <PageHead
        code="M6-S02 · Bind Channel"
        title={isNew ? 'ผูกบัญชี LINE ใหม่' : 'แก้บัญชี LINE'}
        actions={locked ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <Panel>
        <Panel.Row>
          {/*
            id ของบัญชีผูกมากับตัว action ผ่าน channelId prop ไม่ใช่ให้ฟอร์มส่งมาเอง
            — เหตุผลเดียวกับ campaignId ของ PublishForm: ฟอร์มเป็นของที่ผู้ส่งแต่งเอง
            ได้ทั้งใบ · ดู ChannelForm.tsx สำหรับเหตุผลที่ต้องเลิกใช้ `action=` ตรงๆ
          */}
          <ChannelForm channelId={isNew ? null : id} action={saveChannel}>
            {isPreview && (
              <Note tone="warn">
                <b>บัญชีสำหรับทดลองเล่นในระบบไม่มีกุญแจให้แก้</b> — ระบบเป็นคนสร้างไว้เอง
                และตารางห้ามไม่ให้มันเก็บกุญแจ ถ้าจะส่งขึ้น LINE จริงให้ผูกบัญชีทดสอบหรือบัญชีจริงแทน
              </Note>
            )}

            {published?.isLive && (
              <Note tone="info">
                <b>บัญชีนี้กำลังรัน “{channel?.liveCampaignName}” อยู่ (BR-68)</b> — หนึ่งบัญชี
                รันแคมเปญได้ทีละหนึ่ง การเปลี่ยนกุญแจตรงนี้มีผลกับแคมเปญนั้นทันที ไม่ต้องส่งขึ้นใหม่
              </Note>
            )}

            <TierChoice current={channel?.channelType ?? 'test'} disabled={locked || isPreview} />

            <Field label="ชื่อบัญชี (ตั้งเองให้ทีมเข้าใจ)">
              <input
                name="name"
                defaultValue={channel?.name}
                required
                maxLength={120}
                disabled={locked || isPreview}
                placeholder="เช่น OA Melo Milk (ลูกค้า)"
              />
            </Field>

            {!isNew && (
              <Note tone="info">
                กุญแจที่ผูกไว้ตอนนี้: <b>{maskedKey(channel?.tokenLast4 ?? null)}</b> —
                เว้นสองช่องข้างล่างว่างไว้ถ้ายังใช้กุญแจเดิม
                · <b>ไม่มีทางไหนดูค่าเต็มได้ ทั้งก่อนและหลังกดแก้ (BR-16)</b>
              </Note>
            )}

            <Field
              label="Channel ID"
              hint="ตัวเลขล้วนจากแท็บ Basic settings ของ LINE Developers Console — คนละค่ากับ token/secret ข้างล่าง และเป็นค่าเดียวที่ระบบใช้จับคู่ข้อความที่เข้ามาจากไลน์จริงกับแคมเปญนี้ ไม่กรอกไว้แล้วบัญชีจะตอบว่า “กิจกรรมจบไปแล้ว” ทุกครั้ง"
            >
              <input
                name="line_channel_id"
                defaultValue={channel?.lineChannelId ?? ''}
                disabled={locked || isPreview}
                placeholder="เช่น 1657123456"
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>

            <BotUserIdField
              channelId={isNew ? null : id}
              defaultValue={channel?.lineBotUserId ?? ''}
              disabled={locked || isPreview}
              action={fetchBotUserId}
            />

            <Field label="Channel access token">
              <input
                name="access_token"
                type="password"
                autoComplete="off"
                disabled={locked || isPreview}
                placeholder="วางกุญแจที่ได้จาก LINE Developers Console"
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>

            <Field
              label="Channel secret"
              hint="คนที่มีกุญแจมักไม่ใช่คนกรอก — ส่งลิงก์หน้านี้ให้เจ้าของกุญแจกรอกเองได้ ค่าจะไม่แสดงบนจอหลังบันทึก"
            >
              <input
                name="channel_secret"
                type="password"
                autoComplete="off"
                disabled={locked || isPreview}
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>

            <div style={{ height: 1, background: 'var(--rule)' }} />

            <Field
              label="คีย์เวิร์ดเดิมของลูกค้า · Existing keywords"
              hint="SA กรอกจาก OA Manager · ใช้เตือนตอนตั้งคีย์เวิร์ดใน M1-S06 — บรรทัดละหนึ่งคำ คำที่ลูกค้าตั้งไว้เองจะตอบก่อนเสมอ กิจกรรมที่ใช้คำเดียวกันจะไม่ทำงานโดยไม่มี error ให้เห็น (BR-44)"
            >
              <textarea
                name="existing_keywords"
                rows={5}
                defaultValue={(channel?.existingKeywords ?? []).join('\n')}
                disabled={locked || isPreview}
                placeholder={'โปรโมชั่น\nที่ตั้งสาขา\nเวลาเปิด'}
                style={{ fontFamily: 'var(--mono)', resize: 'vertical' }}
              />
            </Field>

            {canEdit && !isPreview && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <Button type="submit">บันทึกบัญชี</Button>
              </div>
            )}
          </ChannelForm>
        </Panel.Row>
      </Panel>

      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.6 }}>
        กุญแจถูกเข้ารหัสก่อนเก็บ (DD-03) และทุกครั้งที่ระบบอ่านมันไปใช้ จะมีบันทึกไว้ว่าใครอ่านและอ่านทำไม
        · บัญชีจริงของลูกค้าคือชั้นที่ผู้ร่วมสนุกจริงมองเห็น ส่งแล้วลบไม่ได้
      </div>
      </main>
    </div>
  )
}
