import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { ChatSim } from '@/components/preview/ChatSim'
import { Badge, Note, PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { loadPreviewScreen } from '@/lib/db/preview'
import { playPreview, resetPreviewPlayer } from './actions'

const linkButton: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px', fontSize: 13, fontWeight: 600,
}

/**
 * M8-S01 · ซ้อมทั้งแคมเปญโดยไม่ต้องมี LINE
 *
 * The page reads and the client component plays. Everything a tap does goes
 * through the Server Actions beside this file, which call the same handleEvent
 * the webhook route calls with Ports pointed at a channel of type preview —
 * there is no second implementation of the rules anywhere in this screen, which
 * is the only way a rehearsal is worth anything.
 */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const screen = await loadPreviewScreen(db(), id)
  if (!screen) notFound()

  // ผู้ดูรายงานดูได้อย่างเดียว · action ปฏิเสธซ้ำอีกชั้นด้วย requireRole ของตัวเอง
  const canPlay = session.role !== 'reporter'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1000, margin: '0 auto' }}>
      <PageHead
        code="M8-S01 · Preview"
        title="ทดลองเล่น"
        actions={
          <>
            <a href={`/campaigns/${id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {screen.campaignName}
            </a>
            {!canPlay && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      {/* แผนสั่งให้มีสวิตช์เลือกระหว่างชั้นตัวอย่างกับชั้นทดสอบที่ยิงขึ้น LINE จริง
          ซึ่งของที่มีอยู่ทำไม่ได้ · lib/line/client.ts ตอบได้เฉพาะ reply token ที่
          LINE ออกให้ตอนมีเหตุการณ์จริง จอนี้ไม่มีโทเคนแบบนั้น และไม่มีทางส่ง push
          · กุญแจก็ยังอ่านจาก env ตัวเดียว ไม่ได้อ่านจากช่องที่เลือก · ต้นแบบเองก็ไม่มี
          สวิตช์นั้น มันมีสวิตช์ ตรวจงาน/สาธิตลูกค้า แทน ซึ่งคือสิ่งที่จอนี้ทำ */}
      <Note tone="info" style={{ marginBottom: 14 }}>
        ทดลองเล่นที่นี่ไม่แตะบัญชี LINE เลย — ยังส่งขึ้นบัญชีทดสอบจากจอนี้ไม่ได้
        เพราะระบบตอบ LINE ได้เฉพาะเมื่อมีเหตุการณ์จริงส่งโทเคนตอบกลับมาให้
        · ตรวจบนบัญชีทดสอบจริงก่อนส่งขึ้นเสมอ
      </Note>

      {screen.blockers.length > 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          padding: '60px 24px', textAlign: 'center',
          border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)',
          background: 'var(--panel)',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>ยังตั้งค่าไม่พอจะเล่นได้</div>
          <div style={{
            fontSize: 13, color: 'var(--ink-3)', maxWidth: 340, lineHeight: 1.7,
          }}>
            {screen.blockers.join(' · ')}
          </div>
          <a href={`/campaigns/${id}/activities`} style={linkButton}>ไปหน้ากิจกรรม →</a>
        </div>
      ) : (
        <ChatSim
          channelName={screen.channelName}
          menu={screen.menu}
          canPlay={canPlay}
          snapshot={screen.snapshot}
          play={playPreview.bind(null, id)}
          reset={resetPreviewPlayer.bind(null, id)}
        />
      )}
    </main>
  )
}
