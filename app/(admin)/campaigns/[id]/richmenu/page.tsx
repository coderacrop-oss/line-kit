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
import {
  canvasFor, LAYOUTS, type LayoutKey, layoutRects, layoutsOfSize, MENU_CANVAS, type MenuSize,
} from '@/lib/richmenu/layouts'
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

function AreaTargetSelect({ area, index, data, menuId, formId }: {
  area: RichMenuArea; index: number; data: RichMenuScreenData; menuId: string; formId: string
}) {
  const current = areaSelectValue(area)
  return (
    <>
      <select name={`area_target_${index}`} defaultValue={current} form={formId} style={{ width: '100%' }}>
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
        form={formId}
        style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
      />
    </>
  )
}

function AreaBox({ area, index, data, menuId, formId }: {
  area: RichMenuArea; index: number; data: RichMenuScreenData; menuId: string; formId: string
}) {
  const isEmpty = area.kind === ('none' as AreaKind)
  // เตือนเฉพาะช่องที่ชี้ไปกิจกรรมที่ยังหาเจอ (กิจกรรมไม่เคยถูกลบจริง — ดู
  // lib/db/activities.ts) และกิจกรรมนั้นถูกปิดใช้งานอยู่ · ช่องที่ชี้การ์ด/เมนู/ลิงก์
  // หรือไม่ชี้ไปไหน ไม่เกี่ยวกับ is_enabled ของกิจกรรมเลย จึงไม่ควรขึ้นป้ายนี้
  const targetActivity = area.kind === 'activity' && area.target
    ? data.activities.find((a) => a.id === area.target)
    : undefined
  const activityDisabled = targetActivity !== undefined && !targetActivity.isEnabled
  return (
    <div style={boxStyle}>
      <div style={labelStyle}>ช่อง {index + 1}</div>
      <AreaTargetSelect area={area} index={index} data={data} menuId={menuId} formId={formId} />
      {isEmpty && (
        <span style={{ fontSize: 10, color: 'var(--danger)', lineHeight: 1.4 }}>
          กดแล้วเงียบ (BR-01)
        </span>
      )}
      {activityDisabled && (
        <span style={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          กิจกรรมปลายทางถูกปิดใช้งาน
        </span>
      )}
    </div>
  )
}

const SIZE_LABEL: Record<MenuSize, string> = { large: 'ภาพใหญ่', small: 'ภาพเล็ก' }

/** ผังหนึ่งแบบเป็นรูปสี่เหลี่ยมย่อส่วน — เทียบกับหน้าเลือกเทมเพลตจริงของ LINE ที่วาดผังเป็นรูปแบบนี้ ไม่ใช่แค่ตัวเลขจำนวนช่อง */
function LayoutDiagram({ layoutKey }: { layoutKey: LayoutKey }) {
  const canvas = canvasFor(layoutKey)
  const width = 56
  const height = Math.round((width * canvas.height) / canvas.width)
  return (
    <div style={{
      position: 'relative', width, height, flexShrink: 0,
      background: 'var(--ground)', border: '1px solid var(--rule)', borderRadius: 3, overflow: 'hidden',
    }}>
      {layoutRects(layoutKey).map((r, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${(r.x / canvas.width) * 100}%`, top: `${(r.y / canvas.height) * 100}%`,
            width: `${(r.width / canvas.width) * 100}%`, height: `${(r.height / canvas.height) * 100}%`,
            border: '1px solid var(--panel)', background: 'var(--rule)', boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  )
}

const layoutChoiceStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: '7px 10px',
  cursor: 'pointer', fontSize: 11,
}

/**
 * ผังทั้งชุดของขนาดผืนภาพหนึ่งขนาด — จัดกลุ่ม "ภาพใหญ่"/"ภาพเล็ก" แยกกันเหมือน
 * หน้าเลือกเทมเพลตจริงของ LINE Official Account Manager
 *
 * ป้ายกำกับอยู่ที่ "ตัวเลือก" ไม่ใช่ที่หัวกลุ่ม เพราะกลุ่มหนึ่งมีทั้งผังที่ลอกมาจาก
 * LINE ตรงๆ ("แบบ LINE") และผังที่ระบบนี้เพิ่มเอง ("แบบกำหนดเอง" — เช่นตาราง 2×4
 * ที่ไม่มีอยู่ในหน้าเลือกเทมเพลตของ LINE) ปนกันอยู่ — ป้ายเดียวที่หัวกลุ่มจะโกหก
 * ผังใดผังหนึ่งในกลุ่มเสมอ
 */
function LayoutSizeGroup({ size, current, onFormId }: {
  size: MenuSize; current?: LayoutKey; onFormId?: string
}) {
  const canvas = MENU_CANVAS[size]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{SIZE_LABEL[size]} · {canvas.width}×{canvas.height}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {layoutsOfSize(size).map((option) => (
          <label key={option.key} style={layoutChoiceStyle}>
            <input
              type="radio" name="layout" value={option.key} required
              defaultChecked={current === option.key}
              form={onFormId}
            />
            <LayoutDiagram layoutKey={option.key} />
            <span>{option.label}</span>
            <Badge tone={option.origin === 'line' ? 'mute' : 'info'}>
              {option.origin === 'line' ? 'แบบ LINE' : 'แบบกำหนดเอง'}
            </Badge>
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * สลับผังได้เฉพาะกลุ่มขนาดผืนภาพเดียวกับภาพปัจจุบันของเมนูนี้ — มีผลทันทีไม่ต้อง
 * รอกด "บันทึกเมนู" (`changeLayout` เป็นแอ็กชันของตัวเอง) สลับข้ามผืนภาพทำที่นี่
 * ไม่ได้เพราะพิกัดของผังต้องคำนวณจากขนาดภาพที่ใช้อยู่จริง — ต้องอัปโหลดภาพขนาดใหม่
 * ผ่าน "บันทึกเมนู" ก่อน ผังของขนาดนั้นถึงจะเลือกได้ (`actions.ts:changeLayout`
 * ปฏิเสธถ้าขนาดไม่ตรงอยู่ดี ตรงนี้กรองไว้ล่วงหน้าเพื่อไม่ให้กดแล้วเจอ error เฉยๆ)
 */
function LayoutSwitcher({ campaignId, menu, canEdit }: {
  campaignId: string; menu: RichMenuView; canEdit: boolean
}) {
  const size = LAYOUTS.find((option) => option.key === menu.layout)?.size ?? 'large'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>ผังช่อง</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {layoutsOfSize(size).map((option) => (
          <form key={option.key} action={changeLayout.bind(null, campaignId, menu.id, option.key)}>
            <button
              type="submit"
              disabled={!canEdit}
              style={{
                ...layoutChoiceStyle,
                cursor: canEdit ? 'pointer' : 'default',
                background: menu.layout === option.key ? 'var(--ink)' : 'var(--panel)',
                color: menu.layout === option.key ? 'var(--panel)' : 'var(--ink)',
              }}
            >
              <LayoutDiagram layoutKey={option.key} />
              <span>{option.label}</span>
            </button>
          </form>
        ))}
      </div>
      <span style={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.4 }}>
        สลับข้ามขนาดผืนภาพ ({size === 'large' ? 'ภาพเล็ก 2500×843' : 'ภาพใหญ่ 2500×1686'}) ต้องอัปโหลดภาพขนาดนั้นก่อน — เปลี่ยนภาพด้านบนแล้วกด &quot;บันทึกเมนู&quot;
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
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* ไฟล์จริงที่อัปโหลดไป ไม่ใช่กล่องแทนภาพ */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={menu.imageUrl} alt=""
                style={{
                  width: 72, height: Math.round((72 * 1686) / 2500), objectFit: 'cover',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--rule)', flexShrink: 0,
                }}
              />
              {/* ขนาดโผล่ในป้ายเตือนข้างล่างอยู่แล้วเมื่อผิด — ไม่พิมพ์ตัวเลขซ้ำสองที่ตอนภาพพัง */}
              {!badImage && (
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {menu.imageWidth}×{menu.imageHeight}
                </span>
              )}
            </div>
            <input type="hidden" form={formId} name="image_asset_id" value={menu.imageAssetId} />
            {canEdit && (
              <>
                <input
                  form={formId} type="file" name="image_file" accept="image/png,image/jpeg"
                  aria-label="แทนที่ภาพเมนู"
                  style={{ fontSize: 11, marginTop: 6 }}
                />
                <span style={{ fontSize: 10, color: 'var(--ink-3)', display: 'block', marginTop: 3 }}>
                  ไม่ต้องตัด/ย่อมาก่อน — ระบบตัดให้พอดีผังปัจจุบันอัตโนมัติ ·{' '}
                  <a href={`/campaigns/${campaignId}/richmenu/${menu.id}/compose`} style={{ color: 'var(--ink)' }}>
                    จัดวางภาพหลายชิ้น →
                  </a>
                </span>
              </>
            )}
          </div>
        </Field>
        {badImage && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{badImage}</span>}

        <LayoutSwitcher campaignId={campaignId} menu={menu} canEdit={canEdit} />

        <div style={{ ...gridStyle, gridTemplateColumns: `repeat(${layoutCols}, 1fr)` }}>
          {menu.areas.map((area, index) => (
            <AreaBox key={index} area={area} index={index} data={data} menuId={menu.id} formId={formId} />
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

function NewMenuForm({ campaignId }: { campaignId: string }) {
  return (
    <details style={{ marginBottom: 16 }}>
      <summary style={summaryStyle}>+ เพิ่มเมนู</summary>
      <Panel style={{ marginTop: 10 }}>
        <Panel.Row>
          <form
            action={createMenu.bind(null, campaignId)}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <Field label="ชื่อเรียกเมนู (alias)" hint="ใช้ตอนลงทะเบียนปุ่มสลับแท็บ (BR-77) — ตั้งชื่อที่จำง่าย เช่น main, promo">
              <input name="alias" required placeholder="เช่น main" />
            </Field>
            <Field
              label="ภาพเมนู (บังคับ)"
              hint="ไม่ต้องตัด/ย่อมาก่อน — ระบบตัดให้พอดีผังที่เลือกไว้อัตโนมัติ (เหมือนวิธี &quot;อัปโหลดรูปและนำไปใช้&quot; ของ LINE) ปฏิเสธเฉพาะภาพที่เล็กเกินจนต้องขยายจนเบลอ"
            >
              <input type="file" name="image_file" required accept="image/png,image/jpeg" />
            </Field>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={labelStyle}>ผังช่อง</span>
              <LayoutSizeGroup size="large" current="large_1" />
              <LayoutSizeGroup size="small" />
            </div>

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

      {canEdit && <NewMenuForm campaignId={campaign.id} />}

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
