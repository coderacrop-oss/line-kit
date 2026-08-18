import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, type BadgeTone, Empty, Note, PageHead, Panel } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import {
  type ChannelGroup, type ChannelSummary, type ChannelType, describeLastUsed, describePublished,
  groupByTier, listChannels, maskedKey,
} from '@/lib/db/channels'
import { db } from '@/lib/db/client'

type ChannelTier = { head: string; sub: string; tone: BadgeTone; emptyText: string }

/**
 * ชื่อและคำอธิบายของสามชั้น · ถอดจาก chTypeMeta ของต้นแบบ
 *
 * A tier is described by who sees a mistake made on it, because that is the
 * whole difference between them: nobody, the team, or every customer the brand
 * has. The three tones are three different tones for the same reason — a
 * production OA that looks like a simulator is a screen that helped.
 *
 * The simulator's empty line is the one string not taken from the mock. The mock
 * repeats the production one there, which reads as "no production account yet"
 * underneath the simulator heading.
 */
const CHANNEL_TIERS: Record<ChannelType, ChannelTier> = {
  preview: {
    head: 'ทดลองเล่นในระบบ · Simulator',
    sub: 'ไม่ต้องใช้กุญแจ ใช้ตรวจงานก่อนขึ้นจริง',
    tone: 'mute',
    emptyText: 'ยังไม่มีบัญชีสำหรับทดลองเล่นในระบบ',
  },
  test: {
    head: 'บัญชีทดสอบ · Test OA',
    sub: 'OA ภายในทีม เห็นเฉพาะคนในทีม',
    tone: 'info',
    emptyText: 'ยังไม่มีบัญชีทดสอบ',
  },
  production: {
    head: 'บัญชีจริงของลูกค้า · Production OA',
    sub: 'ผู้ร่วมสนุกจริงมองเห็น — ส่งแล้วลบไม่ได้',
    tone: 'warn',
    emptyText: 'ยังไม่มีบัญชีจริงของลูกค้า',
  },
}

/** ปุ่มหลักในรูปของลิงก์ · <Button> เป็น <button> ซึ่งพาไปหน้าอื่นเองไม่ได้ */
const primaryLinkStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, width: 'fit-content',
}

const keyChipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)',
  background: 'var(--ground)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)', padding: '4px 10px', whiteSpace: 'nowrap',
}

function ChannelRow({ channel, canEdit }: { channel: ChannelSummary; canEdit: boolean }) {
  const published = describePublished(channel)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{channel.name}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
          ใช้ล่าสุด: {describeLastUsed(channel.lastUsedAt, new Date())}
          {published.isLive && ` · แคมเปญที่เปิดอยู่: ${channel.liveCampaignName}`}
        </div>
      </div>

      <span style={keyChipStyle}>key {maskedKey(channel.tokenLast4)}</span>

      <Badge tone={published.isLive ? 'ok' : 'mute'}>{published.label}</Badge>

      {channel.isEditable && canEdit && (
        <a
          href={`/channels/${channel.id}`}
          style={{
            border: '1px solid var(--rule)', borderRadius: 'var(--r)',
            padding: '7px 13px', fontSize: 12, fontWeight: 600,
          }}
        >
          แก้ไข
        </a>
      )}
    </div>
  )
}

function TierPanel({ group, canEdit }: { group: ChannelGroup; canEdit: boolean }) {
  const meta = CHANNEL_TIERS[group.type]

  return (
    <Panel>
      <Panel.Row style={{
        padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <Badge tone={meta.tone}>{meta.head}</Badge>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{meta.sub}</span>
      </Panel.Row>

      {group.channels.length === 0 ? (
        <Panel.Row style={{ padding: '14px 18px', fontSize: 12, color: 'var(--ink-3)' }}>
          {meta.emptyText}
        </Panel.Row>
      ) : (
        group.channels.map((channel) => (
          <Panel.Row key={channel.id} style={{ padding: '14px 18px' }}>
            <ChannelRow channel={channel} canEdit={canEdit} />
          </Panel.Row>
        ))
      )}
    </Panel>
  )
}

export default async function ChannelsPage() {
  const session = await getSession()
  // ชั้น layout กันไว้อยู่แล้ว แต่ layout กับ page เรนเดอร์พร้อมกัน ไม่ใช่ทีละชั้น
  if (!session) redirect('/login')

  const channels = await listChannels(db())
  const groups = groupByTier(channels)
  const canEdit = session.role === 'configurator'

  // ต้นแบบถือว่า "ว่าง" คือยังไม่มีบัญชีที่ต้องใช้กุญแจ · บัญชีทดลองเล่นในระบบมีอยู่แล้วเสมอ
  const nothingBound = channels.every((channel) => channel.channelType === 'preview')
  const live = channels.filter((channel) => describePublished(channel).isLive)

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin={canEdit} />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 820, margin: '0 auto' }}>
      <PageHead
        code="M6-S01 · LINE Channels"
        title="บัญชี LINE"
        actions={canEdit
          ? <a href="/channels/new" style={primaryLinkStyle}>+ ผูกบัญชีใหม่</a>
          : <Badge tone="mute">ดูอย่างเดียว</Badge>}
      />

      {nothingBound && (
        <Empty
          title="ยังไม่ได้ผูกบัญชี LINE — ทดลองเล่นในระบบได้ก่อนเลย"
          note="เมื่อพร้อมส่งขึ้น LINE จริง ให้ขอ Channel access token และ Channel secret จากคนที่ดูแล LINE Official Account (อยู่ใน LINE Developers Console) แล้วนำมาผูกที่นี่"
          action={canEdit
            ? <a href="/channels/new" style={primaryLinkStyle}>+ ผูกบัญชีแรก</a>
            : null}
        />
      )}

      {/* หนึ่งบัญชีรันแคมเปญทีละหนึ่ง (BR-68) — คนที่กำลังจะส่งขึ้นต้องรู้ก่อนกด ไม่ใช่หลังกด */}
      {live.length > 0 && (
        <Note tone="info" style={{ margin: '16px 0' }}>
          <b>หนึ่งบัญชีรันแคมเปญได้ทีละหนึ่ง (BR-68)</b> — ส่งแคมเปญใหม่ขึ้นบัญชีที่มีของอยู่แล้ว
          จะถอนของเดิมลงโดยไม่ถามซ้ำ ผู้เล่นที่ค้างอยู่กลางแคมเปญเดิมจะเจอกติกาชุดใหม่ทันที
        </Note>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
        {groups.map((group) => (
          <TierPanel key={group.type} group={group} canEdit={canEdit} />
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.6 }}>
        กุญแจถูกเก็บแบบเข้ารหัสและแสดงเฉพาะ 4 ตัวท้ายเสมอ (BR-16) — ไม่มีปุ่มเปิดดูค่าเต็ม
      </div>
      </main>
    </div>
  )
}
