import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Note, PageHead, Panel } from '@/components/ui'
import { BlockForm } from '@/components/cards/BlockForm'
import { BlockList } from '@/components/cards/BlockList'
import { getSession } from '@/lib/auth/session'
import {
  BLOCK_TYPE_NAME, DRAWABLE_BLOCK_TYPES, canAddBlock, canRoleEditBlock, countAgainstLimits,
} from '@/lib/cards/blocks'
import { loadCardEditor } from '@/lib/db/cardEditor'
import { db } from '@/lib/db/client'
import { addBlock } from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const noteStyle: CSSProperties = { fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }

const previewPlaceholderStyle: CSSProperties = {
  border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 8,
}

const usedByBoxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: '14px 16px', marginTop: 12,
}

/**
 * M3-S02 ขั้น 3 · บล็อกเอดิเตอร์ — จอที่ Task 12 ทิ้งปลายทางไว้ให้ (`createCardFromTemplate`
 * พาผู้เล่นมาที่นี่หลังสร้างการ์ดสำเร็จ)
 *
 * ต้นแบบ (`docs/design/flex-builder-prototype.html`, `M3-S02 ตั้งค่าการ์ด`) วาดการ์ดเป็น
 * โครงคงที่ (ชื่อ · ภาพหัวการ์ด · หัวข้อ · ข้อความ · ปุ่มสูงสุดสาม) แต่ schema จริง
 * (`card_block`) เป็นรายการบล็อกที่ลำดับและชนิดปรับได้แปดแบบ ยึด L2 §5.2 (schema)
 * เหนือรูปร่างคงที่ของต้นแบบตามกติกาข้อ 2 ของ docs/HANDOFF.md — สิ่งที่ยืมจาก
 * ต้นแบบมาตรงๆ คือกล่องเตือนสองกล่อง (แคมเปญส่งขึ้นแล้ว · โหมดผู้ดูแลเนื้อหา) กับ
 * โครงสามส่วนต่อบล็อก ("ค่าของตัวเอง · สวิตช์ตามสถานะ · เงื่อนไขการแสดง")
 */
export default async function CardEditPage({ params }: {
  params: Promise<{ id: string; cardId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, cardId } = await params
  const sql = db()
  const screen = await loadCardEditor(sql, id, cardId)
  if (!screen) notFound()

  const canEditAnything = session.role === 'configurator' || session.role === 'content_editor'
  const canEditStructure = session.role === 'configurator'
  const counts = countAgainstLimits(screen.blocks)

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 1100, margin: '0 auto' }}>
      <a
        href={`/campaigns/${id}/cards`}
        style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-block', marginBottom: 10 }}
      >
        ← การ์ดทั้งหมด
      </a>

      <PageHead
        code="M3-S02 · Card"
        title={screen.card.code}
        actions={
          <>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{screen.campaignName}</span>
            <Badge tone="mute">{screen.card.renderName}</Badge>
            {!canEditAnything && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      {screen.campaignStatus !== 'draft' && (
        <Note tone="info" style={{ marginBottom: 14, maxWidth: 680 }}>
          แคมเปญนี้ส่งขึ้น LINE แล้ว — ข้อความที่แก้จะมีผลกับ<b>การ์ดที่ส่งครั้งถัดไป</b> ไม่ใช่ใบที่ส่งเข้าแชท
          ไปแล้ว (ข้อจำกัดของ Flex · L1 §1.4)
        </Note>
      )}

      {session.role === 'content_editor' && (
        <Note tone="warn" style={{ marginBottom: 14, maxWidth: 680 }}>
          <b>โหมดผู้ดูแลเนื้อหา</b> — แก้ได้เฉพาะข้อความและภาพ ส่วนปุ่มและปลายทางแก้ไม่ได้
          (Permission Matrix · L1 §2) เพราะกระทบทางเดินของแคมเปญ
        </Note>
      )}

      {screen.hasSampleText && (
        <Note tone="warn" style={{ marginBottom: 18, maxWidth: 680 }}>
          ยังเป็น<b>ข้อความตัวอย่าง</b>จากเทมเพลต — แก้ข้อความแล้วกดบันทึกเพื่อปลดบล็อกการส่งขึ้นบัญชีจริง (BR-37)
        </Note>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BlockList
            campaignId={id}
            cardId={cardId}
            blocks={screen.blocks.map((block) => ({ id: block.id, blockType: block.blockType }))}
            canEdit={canEditStructure}
            counts={counts}
          >
            {screen.blocks.map((block) => (
              <BlockForm
                key={block.id}
                campaignId={id}
                cardId={cardId}
                block={block}
                canEdit={canRoleEditBlock(session.role, block.blockType)}
                selectorCount={screen.selectors.length}
                screen={{ activities: screen.activities, rewardCodes: screen.rewardCodes }}
              />
            ))}
          </BlockList>

          {screen.blocks.length === 0 && (
            <Note tone="warn">
              การ์ดใบนี้ยังไม่มีบล็อกสักอัน — ส่งออกไปตอนนี้จะเป็นข้อความว่างที่ผู้เล่นแยกไม่ออกจากบอทที่พัง
            </Note>
          )}

          {canEditStructure && (
            <Panel>
              <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={labelStyle}>เพิ่มบล็อกใหม่ต่อท้าย</span>
                <form
                  action={addBlock.bind(null, id, cardId)}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <select name="block_type" disabled={!canAddBlock(screen.blocks, 'body').ok}>
                    {DRAWABLE_BLOCK_TYPES.map((type) => (
                      <option key={type} value={type}>{BLOCK_TYPE_NAME[type]}</option>
                    ))}
                  </select>
                  <Button type="submit" variant="ghost" disabled={counts.blocksLeft === 0}>
                    ＋ เพิ่มบล็อก
                  </Button>
                </form>
                <span style={noteStyle}>
                  เลือกได้แปดชนิด — อีกหกชนิดที่ฐานข้อมูลรับ (status_row · stamp_grid · video · stamp_card ·
                  progress · reward_button) ยังไม่มีตัววาดภาพใน lib/render/flex.ts จึงไม่อยู่ในรายการนี้
                </span>
              </Panel.Row>
            </Panel>
          )}
        </div>

        <div>
          <div style={{ ...labelStyle, marginBottom: 10 }}>ตัวอย่างที่ผู้เล่นเห็น · Live preview</div>
          <div data-preview-placeholder style={previewPlaceholderStyle}>
            <span style={noteStyle}>
              ช่องนี้เป็นของ Task 14 — หน้าตัวอย่างเรียก <code>groupBlocks</code>/<code>toFlexBubble</code>/
              <code>toPlainText</code> ตัวเดียวกับที่ webhook เรียก (BR-91) พร้อมสวิตช์สลับสถานะผู้เล่นจำลอง
              และปุ่มส่งทดสอบเข้า LINE ตัวเอง — ยังไม่มีใครเขียนไฟล์นี้
            </span>
          </div>

          <div style={usedByBoxStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>ใครใช้การ์ดนี้อยู่</div>
            {screen.card.isOrphan && (
              <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.6, marginBottom: 6 }}>
                ไม่มีใครอ้างถึงเลย — การ์ดกำพร้า ผู้เล่นจะไม่มีวันเห็นการ์ดใบนี้
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {screen.card.usedBy.map((ref) => (
                <div key={ref.label} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--ink-3)' }}>·</span>{ref.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
