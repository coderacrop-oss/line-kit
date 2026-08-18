import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Empty, Field, Note, PageHead, Panel } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import {
  loadRichMenuScreen, type RichMenuScreenData, type RichMenuView,
} from '@/lib/db/richmenu'
import { type AreaKind, type RichMenuArea } from '@/lib/richmenu/areas'
import { LAYOUTS } from '@/lib/richmenu/layouts'
import { menuImageSizeWarning } from '@/lib/richmenu/image'
import { changeLayout, createMenu, deleteMenu, saveMenu, setEntry } from './actions'

const summaryStyle: CSSProperties = {
  display: 'inline-block',
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: '10px 18px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
}

const gridStyle: CSSProperties = {
  background: 'var(--ground)', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: 8, display: 'grid', gap: 8,
}

const boxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: 10,
  display: 'flex', flexDirection: 'column', gap: 7, minHeight: 96, background: 'var(--panel)',
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase',
  color: 'var(--ink-3)',
}

const dotOuter: CSSProperties = {
  width: 16, height: 16, border: '1.5px solid var(--rule)', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const dotInner: CSSProperties = { width: 8, height: 8, borderRadius: '50%', background: 'var(--ink)' }

/** ค่ารวมของ select ปลายทางหนึ่งช่อง · `""`=ไม่ชี้ไปไหน · `kind:id` · `url` (อ่าน target จากช่องข้อความคู่กัน) */
function areaSelectValue(area: RichMenuArea): string {
  if (area.kind === 'none') return ''
  if (area.kind === 'url') return 'url'
  return `${area.kind}:${area.target ?? ''}`
}

function AreaTargetSelect({ area, index, data, menuId }: {
  area: RichMenuArea; index: number; data: RichMenuScreenData; menuId: string
}) {
  const current = areaSelectValue(area)
  return (
    <>
      <select name={`area_target_${index}`} defaultValue={current} style={{ width: '100%' }}>
        <option value="">— ไม่ชี้ไปไหน —</option>
        <optgroup label="กิจกรรม">
          {data.activities.length === 0 && <option value="" disabled>— เลือกกิจกรรม —</option>}
          {data.activities.map((a) => (
            <option key={a.id} value={`activity:${a.id}`}>{a.name}</option>
          ))}
        </optgroup>
        <optgroup label="การ์ด">
          {data.cards.length === 0 && <option value="" disabled>— เลือกการ์ด —</option>}
          {data.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.code}</option>)}
        </optgroup>
        <optgroup label="เมนูอีกชุด">
          {data.menus.length === 0 && <option value="" disabled>— เลือกเมนูอีกชุด —</option>}
          {data.menus.map((m) => (
            <option key={m.id} value={`menu:${m.id}`}>{m.id === menuId ? `${m.alias} (เมนูนี้เอง)` : m.alias}</option>
          ))}
        </optgroup>
        <option value="url">— กรอกลิงก์เอง —</option>
      </select>
      <input
        name={`area_url_${index}`}
        placeholder="https://…"
        defaultValue={area.kind === 'url' ? area.target ?? '' : ''}
        style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
      />
    </>
  )
}

function AreaBox({ area, index, data, menuId }: {
  area: RichMenuArea; index: number; data: RichMenuScreenData; menuId: string
}) {
  const isEmpty = area.kind === ('none' as AreaKind)
  return (
    <div style={boxStyle}>
      <div style={labelStyle}>ช่อง {index + 1}</div>
      <AreaTargetSelect area={area} index={index} data={data} menuId={menuId} />
      {isEmpty && (
        <span style={{ fontSize: 10, color: 'var(--danger)', lineHeight: 1.4 }}>
          กดแล้วเงียบ (BR-01)
        </span>
      )}
      <span style={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.4 }}>
        กิจกรรมปลายทางถูกปิดใช้งาน
      </span>
    </div>
  )
}

function MenuCard({ campaignId, menu, data, canEdit, canDelete }: {
  campaignId: string; menu: RichMenuView; data: RichMenuScreenData; canEdit: boolean; canDelete: boolean
}) {
  const formId = `rm-save-${menu.id}`
  const layoutCols = Math.min(menu.areas.length, 3) || 1
  const badImage = menuImageSizeWarning(menu.imageWidth, menu.imageHeight)

  return (
    <Panel>
      <Panel.Row style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          form={formId}
          name="alias"
          defaultValue={menu.alias}
          disabled={!canEdit}
          style={{
            flex: 1, minWidth: 180, border: '1px solid transparent', borderRadius: 'var(--r)',
            padding: '7px 9px', fontSize: 14, fontWeight: 600, background: 'transparent',
          }}
        />
        {canEdit ? (
          <form action={setEntry.bind(null, campaignId, menu.id)}>
            <button
              type="submit"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, background: 'transparent',
                border: 0, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
              }}
            >
              <span style={dotOuter}>{menu.isEntry && <span style={dotInner} />}</span>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>แขวนเมนูนี้ตอนเข้าร่วม</span>
            </button>
          </form>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={dotOuter}>{menu.isEntry && <span style={dotInner} />}</span>
            <span style={{ fontSize: 12 }}>แขวนเมนูนี้ตอนเข้าร่วม</span>
          </span>
        )}
        {menu.emptyCount > 0 && (
          <Badge tone="danger">{menu.emptyCount} ช่องไม่ชี้ไปไหน</Badge>
        )}
      </Panel.Row>

      <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="ภาพเมนู (บังคับ · 2500×1686)">
          <select form={formId} name="image_asset_id" defaultValue={menu.imageAssetId} disabled={!canEdit}>
            <option value="">— เลือกภาพจากคลัง —</option>
            {data.images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.label} · {image.width}×{image.height}
              </option>
            ))}
          </select>
        </Field>
        {badImage && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{badImage}</span>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>ผังช่อง</span>
          <div style={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 'var(--r)', width: 'fit-content', overflow: 'hidden' }}>
            {LAYOUTS.map((option) => (
              <form key={option.key} action={changeLayout.bind(null, campaignId, menu.id, option.key)}>
                <button
                  type="submit"
                  disabled={!canEdit}
                  style={{
                    border: 0, borderRight: '1px solid var(--rule)', padding: '8px 15px',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)', cursor: 'pointer',
                    background: menu.layout === option.key ? 'var(--ink)' : 'var(--panel)',
                    color: menu.layout === option.key ? 'var(--panel)' : 'var(--ink)',
                  }}
                >
                  {option.label}
                </button>
              </form>
            ))}
          </div>
        </div>

        <div style={{ ...gridStyle, gridTemplateColumns: `repeat(${layoutCols}, 1fr)` }}>
          {menu.areas.map((area, index) => (
            <AreaBox key={index} area={area} index={index} data={data} menuId={menu.id} />
          ))}
        </div>

        {canEdit && (
          <form id={formId} action={saveMenu.bind(null, campaignId, menu.id)}>
            <input type="hidden" name="area_count" value={menu.areas.length} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">บันทึกเมนู</Button>
            </div>
          </form>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          ช่องที่ไม่ชี้ไปไหนบันทึกได้ แต่จะถูกบล็อกตอนส่งขึ้น LINE
        </span>

        {canDelete && (
          <form
            action={deleteMenu.bind(null, campaignId, menu.id)}
            style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--rule)' }}
          >
            <Button variant="danger" type="submit">ลบเมนูนี้</Button>
          </form>
        )}
      </Panel.Row>
    </Panel>
  )
}

function NewMenuForm({ campaignId, data }: { campaignId: string; data: RichMenuScreenData }) {
  return (
    <details style={{ marginBottom: 16 }}>
      <summary style={summaryStyle}>+ เพิ่มเมนู</summary>
      <Panel style={{ marginTop: 10 }}>
        <Panel.Row>
          <form action={createMenu.bind(null, campaignId)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="ชื่อเรียกเมนู (alias)" hint="ใช้ตอนลงทะเบียนปุ่มสลับแท็บ (BR-77) — ตั้งชื่อที่จำง่าย เช่น main, promo">
              <input name="alias" required placeholder="เช่น main" />
            </Field>
            <Field label="ภาพเมนู (บังคับ · 2500×1686)">
              <select name="image_asset_id" required defaultValue="">
                <option value="">— เลือกภาพจากคลัง —</option>
                {data.images.map((image) => (
                  <option key={image.id} value={image.id}>{image.label} · {image.width}×{image.height}</option>
                ))}
              </select>
            </Field>
            <Field label="ผังช่อง">
              <select name="layout" defaultValue="one">
                {LAYOUTS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label} ช่อง</option>
                ))}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">+ สร้างเมนูแรก</Button>
            </div>
          </form>
        </Panel.Row>
      </Panel>
    </details>
  )
}

export default async function RichMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const data = await loadRichMenuScreen(sql, id)
  const canEdit = session.role === 'configurator' || session.role === 'content_editor'
  const canDelete = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        code="M4-S01 · Rich Menu"
        title="Rich Menu"
        actions={
          <>
            <a href={`/campaigns/${campaign.id}/preview`} style={{ fontSize: 13, color: 'var(--ink)' }}>
              ทดลองในหน้าจำลอง →
            </a>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <Note tone="info" style={{ marginBottom: 16, lineHeight: 1.7 }}>
        <b>แขวนเมนูทีละคน</b> — เมนูของเราซ้อนชั้นบนเฉพาะคนที่เข้าร่วมแคมเปญ
        คนที่ไม่ได้เข้าร่วมยังเห็นเมนูเดิมของแบรนด์ ·
        ตอนแคมเปญจบถอดออกรายคน เมนูเดิมกลับมาเอง
      </Note>

      {canEdit && <NewMenuForm campaignId={campaign.id} data={data} />}

      {data.menus.length === 0 ? (
        <Empty
          title="ยังไม่มีเมนู — ผู้เล่นจะเข้าแคมเปญได้จากปุ่มบนการ์ดเท่านั้น"
          action={canEdit ? (
            <details>
              <summary style={summaryStyle}>+ สร้างเมนูแรก</summary>
            </details>
          ) : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.menus.map((menu) => (
            <MenuCard
              key={menu.id} campaignId={campaign.id} menu={menu} data={data}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </main>
  )
}
