import type postgres from 'postgres'
import type { Composition } from '../richmenu/composition'

/**
 * ชั้น DB ของงานแต่งภาพหลายชั้น (M4-S02) — ไม่มีแถวในตาราง แปลว่าเมนูนั้นยังไม่
 * เคยเปิดตัวจัดวางเลย (อัปโหลดภาพเดียวตรงๆ ตามทางเดิมยังทำงานปกติ ไม่แตะที่นี่)
 *
 * แต่ละฟังก์ชันตรวจว่า rich_menu_id เป็นของ campaignId ที่อ้างมาจริงก่อนเสมอ ผ่าน
 * SELECT/UPDATE ที่ join กลับไปที่ rich_menu — เหตุผลเดียวกับทุกฟังก์ชันใน
 * lib/db/richmenu.ts (setLayout ฯลฯ): id ของเมนูมาจาก URL ซึ่งใครก็แก้เองได้
 */

type CompositionRow = {
  canvas_width: number
  canvas_height: number
  background: Composition['background']
  layers: Composition['layers']
}

function toComposition(row: CompositionRow): Composition {
  return {
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    background: row.background,
    layers: row.layers,
  }
}

/** ไม่พบแถว = ยังไม่เคยมีงานแต่งภาพ (ไม่ใช่ error) · คืน null ให้จอเริ่มจากพื้นเปล่า */
export async function loadComposition(
  sql: postgres.Sql, richMenuId: string, campaignId: string,
): Promise<Composition | null> {
  const [row] = await sql<CompositionRow[]>`
    SELECT rc.canvas_width, rc.canvas_height, rc.background, rc.layers
      FROM rich_menu_composition rc
      JOIN rich_menu rm ON rm.id = rc.rich_menu_id
     WHERE rc.rich_menu_id = ${richMenuId} AND rm.campaign_id = ${campaignId}`
  return row ? toComposition(row) : null
}

/**
 * สร้างหรือแก้งานแต่งภาพของเมนูหนึ่งใบ — บันทึกทุกครั้งที่มีการกระทำที่ควรค่าแก่
 * การ undo (ดู components/richmenu/Compositor.tsx) จึงทำหน้าที่เป็น autosave ไป
 * ในตัว ไม่ต้องมีปุ่ม "บันทึกร่าง" แยกหรือตัวจับเวลา debounce ต่างหาก
 *
 * canvas_width/height เขียนใหม่ทุกครั้งจากค่าที่ validateComposition() ตรวจผ่าน
 * มาแล้ว (มาจากผังปัจจุบันของเมนู ตอนแรกที่เปิดจอนี้) ไม่ใช่คำนวณสดจาก layout ที่
 * เก็บใน rich_menu — กันไม่ให้การสลับผังระหว่างที่ยังแก้ไม่เสร็จ ทำให้ขนาดผืนของ
 * งานที่ทำค้างอยู่ไม่ตรงกับที่บันทึกไว้เงียบๆ
 */
export async function upsertComposition(
  sql: postgres.Sql,
  input: { richMenuId: string; campaignId: string; composition: Composition; userId: string },
): Promise<void> {
  const [menu] = await sql<{ id: string }[]>`
    SELECT id FROM rich_menu WHERE id = ${input.richMenuId} AND campaign_id = ${input.campaignId}`
  if (!menu) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')

  const { composition } = input
  await sql`
    INSERT INTO rich_menu_composition
           (rich_menu_id, canvas_width, canvas_height, background, layers, updated_by)
    VALUES (${input.richMenuId}, ${composition.canvasWidth}, ${composition.canvasHeight},
            ${sql.json(composition.background as never)}, ${sql.json(composition.layers as never)},
            ${input.userId})
    ON CONFLICT (rich_menu_id) DO UPDATE
       SET canvas_width = EXCLUDED.canvas_width,
           canvas_height = EXCLUDED.canvas_height,
           background = EXCLUDED.background,
           layers = EXCLUDED.layers,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`
}
