import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Empty, PageHead, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { asCardFilter, CARD_FILTERS, type CardView, filterCards, listCards } from '@/lib/db/cards'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'

const segmentStyle = (on: boolean): CSSProperties => ({
  borderRight: '1px solid var(--rule)',
  padding: '8px 14px', fontSize: 12, fontWeight: 600,
  background: on ? 'var(--ink)' : 'var(--panel)',
  color: on ? 'var(--panel)' : 'var(--ink)',
})

/** พื้นลายทางของต้นแบบ · บอกว่าตรงนี้มีภาพหัวการ์ด โดยไม่ต้องโหลดภาพจริงมาวาด */
const headerImageStyle: CSSProperties = {
  height: 74,
  background:
    'repeating-linear-gradient(45deg,var(--ground),var(--ground) 8px,var(--panel-2) 8px,var(--panel-2) 16px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderBottom: '1px solid var(--rule)',
}

const headerImageLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const orphanPillStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase',
  color: STATUS_TONES.danger.border, borderWidth: 1, borderStyle: 'dashed',
  borderColor: STATUS_TONES.danger.border, borderRadius: 'var(--r-pill)',
  padding: '3px 9px', width: 'fit-content',
}

const usedByChipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.03em', color: 'var(--ink-3)',
  border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)', padding: '3px 9px',
}

/** ตัดที่สองบรรทัดเหมือนต้นแบบ · การ์ดที่ข้อความยาวไม่ควรดันแผ่นอื่นในตารางให้เตี้ยลง */
const previewStyle: CSSProperties = {
  fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5, overflow: 'hidden',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
}

/**
 * แผ่นการ์ดหนึ่งใบ
 *
 * ยังไม่ใช่ลิงก์ เพราะจอตั้งค่าการ์ด (M3-S02) ยังไม่มีอยู่ · ลิงก์ไปยังที่อยู่ที่ยังไม่มี
 * ใครเขียนคือหน้า 404 ที่กลับออกมาไม่ได้ หลักเดียวกับที่แถบซ้ายใช้กับจอที่ยังไม่ได้ทำ
 *
 * The dashed edge and the pill say the same thing twice on purpose. Colour alone
 * is not a message, and this is the one state on the screen that means "nothing
 * can ever send this card" — the reason the screen is worth opening at all.
 */
function CardTile({ card }: { card: CardView }) {
  return (
    <div
      data-card-tile={card.code}
      style={{
        borderRadius: 'var(--r-lg)', background: 'var(--panel)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        borderWidth: 1,
        borderStyle: card.isOrphan ? 'dashed' : 'solid',
        borderColor: card.isOrphan ? STATUS_TONES.danger.border : 'var(--rule)',
      }}
    >
      {card.hasImage && (
        <div style={headerImageStyle}>
          <span style={headerImageLabelStyle}>header image</span>
        </div>
      )}

      <div style={{
        padding: '13px 15px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{card.code}</span>
          <Badge tone="mute">{card.renderName}</Badge>
        </div>

        {card.previewText === null ? (
          <div style={{ ...previewStyle, fontStyle: 'italic' }}>ยังไม่มีข้อความบนการ์ดใบนี้</div>
        ) : (
          <div style={previewStyle}>{card.previewText}</div>
        )}

        <div style={{
          marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 6,
        }}>
          {card.isOrphan && <span style={orphanPillStyle}>ไม่มีใครใช้</span>}
          {card.usedBy.map((ref) => (
            <span key={ref.label} style={usedByChipStyle}>{ref.label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function CardsPage({ params, searchParams }: {
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

  const all = await listCards(sql, campaign.id)
  const filter = asCardFilter(typeof query.f === 'string' ? query.f : undefined)
  const shown = filterCards(all, filter)
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1000, margin: '0 auto' }}>
      <PageHead
        code="M3-S01 · Cards"
        title="การ์ด"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {campaign.name}
            </a>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <div style={{
        fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 16, maxWidth: 620,
      }}>
        &ldquo;ยังไม่ถูกใช้&rdquo; อ่านจากสิ่งที่ชี้มาหาการ์ดจริง ไม่ใช่จากป้ายที่เก็บไว้ข้างๆ —
        การ์ดที่ไม่มีใครชี้มาคือการ์ดที่ไม่มีทางถูกส่งออกไปหาผู้เล่น
      </div>

      {all.length === 0 ? (
        <Empty
          title="ยังไม่มีการ์ดในแคมเปญนี้"
          note="การ์ดคือสิ่งที่ผู้เล่นเห็นในแชท — กิจกรรม คีย์เวิร์ด และบัตรแสตมป์ ล้วนตอบด้วยการ์ดใบใดใบหนึ่ง"
        />
      ) : (
        <>
          {/* กรองด้วย GET · จอนี้เป็น Server Component ทั้งใบ ไม่มี state ฝั่ง client */}
          <div
            data-card-filters=""
            style={{
              display: 'flex', flexWrap: 'wrap', border: '1px solid var(--rule)',
              borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--panel)',
              width: 'fit-content', marginBottom: 14,
            }}
          >
            {CARD_FILTERS.map((name) => (
              <a key={name} href={`?f=${encodeURIComponent(name)}`} style={segmentStyle(name === filter)}>
                {name}
              </a>
            ))}
          </div>

          {shown.length === 0 ? (
            <Empty
              title="ไม่มีการ์ดที่ตรงกับตัวกรองนี้"
              note="ลองกลับไปที่ ทั้งหมด เพื่อดูการ์ดทุกใบของแคมเปญนี้"
            />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))',
              gap: 14,
            }}>
              {shown.map((card) => <CardTile key={card.id} card={card} />)}
            </div>
          )}
        </>
      )}
    </main>
  )
}
