import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { CopyUrlButton } from '@/components/assets/CopyUrlButton'
import { getSession } from '@/lib/auth/session'
import { decodeOutcome } from '@/lib/assets/outcome'
import { ASSET_FILTERS, asAssetFilter, type AssetView, filterAssets, listAssets } from '@/lib/db/assets'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { periodKey } from '@/lib/daykey'
import { deleteAsset } from './actions'

/** วันของแคมเปญเริ่มเที่ยงคืนเวลาไทยเสมอ (BR-04) — วันที่อัปโหลดก็อ่านด้วยนาฬิกาเดียวกัน */
const CLOCK_TZ = 'Asia/Bangkok'

const primaryLinkStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, width: 'fit-content',
}

const segmentStyle = (on: boolean): CSSProperties => ({
  borderRight: '1px solid var(--rule)',
  padding: '8px 14px', fontSize: 12, fontWeight: 600,
  background: on ? 'var(--ink)' : 'var(--panel)',
  color: on ? 'var(--panel)' : 'var(--ink)',
})

const chipStyle: CSSProperties = {
  fontSize: 10, border: '1px solid var(--rule)', background: 'var(--ground)',
  borderRadius: 'var(--r-pill)', padding: '2px 9px',
}

const orphanPillStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase',
  color: STATUS_TONES.danger.border, borderWidth: 1, borderStyle: 'dashed',
  borderColor: STATUS_TONES.danger.border, borderRadius: 'var(--r-pill)',
  padding: '3px 9px', width: 'fit-content',
}

const replacesBoxStyle: CSSProperties = {
  fontSize: 10, color: STATUS_TONES.warn.fg, background: STATUS_TONES.warn.bg,
  borderRadius: 'var(--r-sm)', padding: '5px 8px', lineHeight: 1.5,
}

/** พื้นลายทางของต้นแบบ · เห็นขอบของภาพโปร่งใสว่าจบตรงไหน */
const thumbStyle: CSSProperties = {
  height: 112,
  background:
    'repeating-linear-gradient(45deg,var(--ground),var(--ground) 8px,var(--panel-2) 8px,var(--panel-2) 16px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderBottom: '1px solid var(--rule)', position: 'relative', overflow: 'hidden',
}

function AssetCard({ campaignId, asset, canDelete }: {
  campaignId: string
  asset: AssetView
  canDelete: boolean
}) {
  return (
    <div style={{
      borderRadius: 'var(--r-lg)', background: 'var(--panel)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      borderWidth: 1,
      borderStyle: asset.isOrphan ? 'dashed' : 'solid',
      borderColor: asset.isOrphan ? STATUS_TONES.danger.border : 'var(--rule)',
    }}>
      <div style={thumbStyle}>
        {/* ไฟล์จริงที่อัปโหลดไป ไม่ใช่กล่องแทนภาพ · ถ้าตรงนี้ว่าง แปลว่าไฟล์ไม่ได้ถูกเก็บจริง */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.publicUrl}
          alt={asset.fileName}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
        <span style={{
          position: 'absolute', bottom: 4, right: 6,
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.06em',
          textTransform: 'uppercase', color: 'var(--ink-3)', background: 'var(--panel)',
          borderRadius: 'var(--r-sm)', padding: '1px 5px',
        }}>
          {asset.meta}
        </span>
      </div>

      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.4 }}>
          {asset.fileName}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)' }}>
          {periodKey(asset.uploadedAt, CLOCK_TZ, 86_400)} · {asset.uploadedBy}
        </div>

        {asset.replacesText && <div style={replacesBoxStyle}>{asset.replacesText}</div>}
        {asset.replacedByText && <div style={replacesBoxStyle}>{asset.replacedByText}</div>}

        {asset.isOrphan && <span style={orphanPillStyle}>ไม่มีใครใช้</span>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {asset.usedBy.map((label) => <span key={label} style={chipStyle}>{label}</span>)}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* คัดลอก URL ไม่ใช่การเขียนข้อมูล ทุกคนที่เห็นภาพจึงก็อปได้ ต่างจากลบที่จำกัดเฉพาะ configurator */}
          <CopyUrlButton url={asset.publicUrl} />

          {canDelete && (
            asset.canDelete ? (
              <form action={deleteAsset.bind(null, campaignId, asset.id)}>
                <Button
                  variant="ghost"
                  type="submit"
                  style={{ width: '100%', padding: 7, fontSize: 11 }}
                >
                  ลบภาพ
                </Button>
              </form>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                {asset.deleteBlockedWhy}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export default async function AssetsPage({ params, searchParams }: {
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

  const all = await listAssets(sql, campaign.id)
  const search = typeof query.q === 'string' ? query.q : ''
  const filter = asAssetFilter(typeof query.f === 'string' ? query.f : undefined)
  const shown = filterAssets(all, { query: search, filter })

  const outcome = decodeOutcome(query)
  const canUpload = session.role === 'configurator' || session.role === 'content_editor'
  const canDelete = session.role === 'configurator'
  const uploadHref = `/campaigns/${campaign.id}/assets/upload`

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1000, margin: '0 auto' }}>
      <PageHead
        code="M9-S01 · Assets"
        title="คลังภาพ"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}`} style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              ← {campaign.name}
            </a>
            {canUpload
              ? <a href={uploadHref} style={primaryLinkStyle}>อัปโหลดภาพ</a>
              : <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 16, maxWidth: 560 }}>
        ภาพผูกกับแคมเปญนี้เท่านั้น ไม่ใช่คลังกลาง — สร้างแคมเปญใหม่ต้องอัปโหลดใหม่
      </div>

      {outcome !== null && outcome.uploaded > 0 && (
        <Note tone="ok" style={{ marginBottom: 16 }}>
          อัปโหลดสำเร็จ {outcome.uploaded} ไฟล์
        </Note>
      )}

      {all.length === 0 ? (
        <Empty
          title="ยังไม่มีภาพ"
          note="JPEG หรือ PNG · ไม่เกิน 1 MB ต่อไฟล์"
          action={canUpload ? <a href={uploadHref} style={primaryLinkStyle}>อัปโหลดภาพแรก</a> : null}
        />
      ) : (
        <>
          {/* ค้นและกรองด้วย GET · จอนี้เป็น Server Component ทั้งใบ ไม่มี state ฝั่ง client */}
          <form
            method="get"
            style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input type="hidden" name="f" value={filter} />
            <input
              name="q"
              defaultValue={search}
              placeholder="ค้นหาจากชื่อไฟล์"
              aria-label="ค้นหาจากชื่อไฟล์"
              style={{
                flex: 1, minWidth: 200, border: '1px solid var(--rule)',
                borderRadius: 'var(--r)', padding: '9px 13px', fontSize: 13,
                background: 'var(--panel)', color: 'var(--ink)',
              }}
            />
            <Button variant="ghost" type="submit">ค้นหา</Button>

            <div style={{
              display: 'flex', border: '1px solid var(--rule)',
              borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--panel)',
            }}>
              {ASSET_FILTERS.map((name) => (
                <a
                  key={name}
                  href={`?f=${encodeURIComponent(name)}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                  style={segmentStyle(name === filter)}
                >
                  {name}
                </a>
              ))}
            </div>
          </form>

          {shown.length === 0 ? (
            <Panel style={{ padding: '18px 20px', fontSize: 12, color: 'var(--ink-3)' }}>
              ไม่มีภาพที่ตรงกับที่ค้นหรือที่กรองไว้
            </Panel>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(216px,1fr))', gap: 14,
            }}>
              {shown.map((asset) => (
                <AssetCard
                  key={asset.id}
                  campaignId={campaign.id}
                  asset={asset}
                  canDelete={canDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 16, lineHeight: 1.6 }}>
        การเอาภาพออกจากคลังลบแค่แถว ไม่ได้ลบไฟล์ — ไฟล์เดิมยังอยู่ที่เดิมตลอดไป
        การ์ดที่ส่งเข้าแชทไปแล้วจึงยังแสดงภาพได้ (BR-25)
      </div>
    </main>
  )
}
