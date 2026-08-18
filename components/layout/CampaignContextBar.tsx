import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui'
import type { CampaignHeaderChannel } from '@/lib/db/campaigns'

type CampaignContextBarProps = { name: string; channels: CampaignHeaderChannel[] }

const CHANNEL_BADGE: Record<CampaignHeaderChannel['channelType'], { label: string; tone: 'ok' | 'warn' }> = {
  production: { label: 'บัญชีลูกค้า', tone: 'ok' },
  test: { label: 'บัญชีทดสอบ', tone: 'warn' },
}

const bar: CSSProperties = {
  position: 'sticky', top: 56, zIndex: 30,
  background: 'var(--panel)', borderBottom: '1px solid var(--rule)',
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  padding: '6px var(--page-x)', minHeight: 32,
}

const NOT_YET_LABEL: Record<CampaignHeaderChannel['channelType'], string> = {
  production: 'ยังไม่ขึ้นบัญชีลูกค้า',
  test: 'ยังไม่ขึ้นบัญชีทดสอบ',
}

/**
 * แถบบอกว่าอยู่แคมเปญไหน ค้างอยู่ใต้แถบบนสุดตลอดเวลาที่อยู่ในแคมเปญ — ตรงกับ
 * ต้นแบบ `{{ inCamp }}` ที่ต่อชื่อแคมเปญกับ `campBadges` เข้ากับแถบบน
 *
 * สองช่องเสมอ — loadCampaignHeader คืน 'test' กับ 'production' มาให้ทุกครั้ง —
 * `versionNo === null` วาดเป็นป้ายจางบอกตรงๆ ว่ายังไม่ขึ้น แทนที่จะซ่อนช่องนั้นไป
 * เฉยๆ ซึ่งจะดูเหมือนไม่มีใครถามคำถามนี้เลย ตรงข้ามกับที่ต้นแบบตั้งใจให้เป็น
 * เตือนสองข้อตายตัวเสมอ · บัญชีทดลองเล่นไม่มีช่องของตัวเอง เพราะมันมีอยู่ทุก
 * แคมเปญเสมอ ไม่ใช่ข้อมูลที่ต้องบอก
 */
export function CampaignContextBar({ name, channels }: CampaignContextBarProps) {
  return (
    <div style={bar}>
      <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </span>
      {channels.map((c) =>
        c.versionNo === null ? (
          <span key={c.channelType} data-channel-badge-empty>
            <Badge tone="mute">{NOT_YET_LABEL[c.channelType]}</Badge>
          </span>
        ) : (
          <span key={c.channelType} data-channel-badge>
            <Badge tone={CHANNEL_BADGE[c.channelType].tone}>
              {CHANNEL_BADGE[c.channelType].label} · v{c.versionNo}
            </Badge>
          </span>
        ),
      )}
    </div>
  )
}
