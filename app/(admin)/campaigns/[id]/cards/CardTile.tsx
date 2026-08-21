import type { CSSProperties } from 'react'
import { ActionForm } from '@/components/richmenu/ActionForm'
import { Badge, Button, STATUS_TONES } from '@/components/ui'
import type { CardView } from '@/lib/db/cards'
import { deleteCard } from './actions'

/**
 * แผ่นการ์ดใน page.tsx เท่านั้น — แยกออกมาเป็นไฟล์ของตัวเอง แทนที่จะเป็นฟังก์ชัน
 * ส่วนตัวใน page.tsx เหมือน MenuCard ของ richmenu/page.tsx เพราะ Next.js ตรวจ
 * typed routes จาก page.tsx โดยตรง แล้วปฏิเสธ named export อื่นนอกจาก default/
 * metadata/... ที่ประกาศไว้ตายตัว — export CardTile จาก page.tsx เองพัง
 * `tsc --noEmit` ทันที (`.next/types/.../page.ts` ไม่รู้จัก export ที่เพิ่มมา) ย้ายมา
 * ไฟล์แยกจึง export ได้ตามปกติ และยังทดสอบแยกจากทั้งจอได้เหมือนที่ต้นแบบร้องขอ
 */

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

/** โซนปุ่มลบ · อยู่นอกลิงก์ไปจอแก้เสมอ เพราะ <button>/<form> ซ้อนใน <a> ไม่ใช่ HTML ที่ถูกต้อง */
const deleteZoneStyle: CSSProperties = {
  padding: '10px 15px', borderTop: '1px solid var(--rule)',
}

/**
 * แผ่นการ์ดหนึ่งใบ · ลิงก์ไปจอแก้บล็อกทีละใบ พร้อมปุ่มลบเมื่อลบได้จริง
 *
 * จอ M3-S02 ตอนนี้มีไฟล์รองรับครบทั้งสองขั้นแล้ว — ขั้นสร้าง (ชนิด × เทมเพลต) อยู่ที่
 * `cards/new` และปุ่ม "+ สร้างการ์ด" บนหัวจอพาไปที่นั่น ส่วนแผ่นการ์ดแต่ละใบพาไปจอแก้
 * บล็อกทีละใบ (`cards/[cardId]`) ซึ่งเป็น Task 13 และเขียนเสร็จแล้ว
 *
 * The dashed edge and the pill say the same thing twice on purpose. Colour alone
 * is not a message, and this is the one state on the screen that means "nothing
 * can ever send this card" — the reason the screen is worth opening at all.
 *
 * ขอบ/พื้นของแผ่นย้ายมาอยู่ที่ `<div>` นอกสุด ไม่ใช่ `<a>` เหมือนเดิม เพราะปุ่มลบ
 * (`<form>`) ต้องอยู่นอกต้นไม้ของ `<a>` — `<form>` ซ้อนใน `<a>` ไม่ใช่ HTML ที่ถูกต้อง
 * `<a>` จึงเหลือแค่ห่อส่วนที่พาไปจอแก้ (ภาพหัวการ์ด + เนื้อหา) ส่วนปุ่มลบเป็นพี่น้อง
 * ของมันแทน `data-card-tile` ก็ย้ายตามมาอยู่ที่ `<div>` นอกสุดด้วย เพราะนั่นคือ "แผ่น"
 * ที่เทสต์เดินตามหาจริงๆ
 */
export function CardTile({ campaignId, card, canEdit }: { campaignId: string; card: CardView; canEdit: boolean }) {
  // ลบได้เฉพาะตอนแก้ได้ *และ* ไม่มีใครใช้อยู่จริง — ซ่อนปุ่มไปเลยแทนที่จะโชว์แต่กดไม่ได้
  // เพราะการ์ดที่ยังมีคนใช้อยู่ไม่ควรมีปุ่มลบให้เห็นด้วยซ้ำ ด่านจริงยังอยู่ที่ deleteCard
  // เสมอ (เผื่อจอที่ค้างเปิดไว้เห็นสถานะเก่า) ปุ่มนี้แค่ไม่ชวนกดสิ่งที่ทำไม่ได้
  const canDelete = canEdit && card.isOrphan

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
      <a
        href={`/campaigns/${campaignId}/cards/${card.id}`}
        style={{
          display: 'flex', flexDirection: 'column', flex: 1,
          textDecoration: 'none', color: 'inherit',
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
      </a>

      {canDelete && (
        <div style={deleteZoneStyle}>
          <ActionForm action={deleteCard.bind(null, campaignId, card.id)}>
            <Button variant="danger" type="submit" style={{ fontSize: 11, padding: '6px 12px' }}>
              ลบการ์ดนี้
            </Button>
          </ActionForm>
        </div>
      )}
    </div>
  )
}
