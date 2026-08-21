import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Empty, Note, PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { asCardFilter, CARD_FILTERS, filterCards, listCards } from '@/lib/db/cards'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { CardTile } from './CardTile'

/** ลิงก์ไปจอสร้างการ์ด · ปุ่มหลักของหน้านี้ตามที่ต้นแบบวางไว้มุมขวาบน */
const createLinkStyle: CSSProperties = {
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px', fontSize: 13, fontWeight: 600,
  textDecoration: 'none', whiteSpace: 'nowrap',
}

const segmentStyle = (on: boolean): CSSProperties => ({
  borderRight: '1px solid var(--rule)',
  padding: '8px 14px', fontSize: 12, fontWeight: 600,
  background: on ? 'var(--ink)' : 'var(--panel)',
  color: on ? 'var(--panel)' : 'var(--ink)',
})

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
  // รหัสของการ์ดที่เพิ่งสร้างจากจอ M3-S02 · จอนั้นพากลับมาที่นี่เพราะบล็อกเอดิเตอร์
  // ยังไม่มีใครเขียน และการพาไปหน้าที่ยังไม่มีคือ 404 ทันทีหลังสร้างสำเร็จ
  const created = typeof query.created === 'string' ? query.created : null

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
            {/* ปลายทางมีไฟล์จริงแล้ว (M3-S02 ขั้น 1–2) จึงเป็นลิงก์ได้ · แผ่นการ์ด
                ยังไม่เป็นลิงก์ เพราะจอแก้บล็อกทีละใบยังไม่มีใครเขียน */}
            {canEdit && (
              <a href={`/campaigns/${campaign.id}/cards/new`} style={createLinkStyle}>
                + สร้างการ์ด
              </a>
            )}
          </>
        }
      />

      {created && (
        <Note tone="ok" style={{ marginBottom: 14, maxWidth: 620 }}>
          สร้างการ์ด <b>{created}</b> แล้ว — บล็อกของเทมเพลตติดมาให้ครบ
          และยังไม่มีใครชี้มาหามัน จึงขึ้นป้ายว่าไม่มีใครใช้จนกว่าจะมีกิจกรรมหรือคีย์เวิร์ดชี้มา
        </Note>
      )}

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
              {shown.map((card) => (
                <CardTile key={card.id} campaignId={campaign.id} card={card} canEdit={canEdit} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
