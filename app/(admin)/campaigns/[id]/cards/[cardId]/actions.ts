'use server'

import { revalidatePath } from 'next/cache'
import type postgres from 'postgres'
import { requireRole } from '@/lib/auth/require'
import {
  SHOW_WHEN_FIELDS, asShowWhenType, buildCondition, canAddBlock, canRoleEditBlock,
  isDrawableBlockType, parseBlockSave, reorder as reorderPure, UNDRAWABLE_REASON,
  validateConditionValues,
} from '@/lib/cards/blocks'
import { db } from '@/lib/db/client'
import type { BlockType, CardBlock } from '@/lib/render/groups'
import type { Condition } from '@/lib/state'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

async function requireCard(sql: postgres.Sql, campaignId: string, cardId: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM card WHERE id = ${cardId} AND campaign_id = ${campaignId}`
  if (!row) throw new Error('ไม่พบการ์ดนี้ในแคมเปญนี้')
}

async function loadOrderedBlocks(
  sql: postgres.Sql, cardId: string,
): Promise<{ id: string; block_type: BlockType; sort_order: number }[]> {
  return sql<{ id: string; block_type: BlockType; sort_order: number }[]>`
    SELECT id, block_type, sort_order FROM card_block
     WHERE card_id = ${cardId} ORDER BY sort_order`
}

/** เขียน sort_order ใหม่ตามลำดับ id ที่ส่งมา · ธุรกรรมเดียวกันทั้งหมดหรือไม่มีเลย */
async function persistOrder(
  sql: postgres.Sql, cardId: string, orderedIds: readonly string[],
): Promise<void> {
  await sql.begin(async (tx) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx`
        UPDATE card_block SET sort_order = ${index}
         WHERE id = ${orderedIds[index]} AND card_id = ${cardId}`
    }
  })
}

const path = (campaignId: string, cardId: string) => `/campaigns/${campaignId}/cards/${cardId}`

/**
 * บันทึก "ค่าของตัวเอง" ของบล็อกหนึ่งอัน (ส่วนที่ 1 ของสามส่วน)
 *
 * ล้างธง `has_sample_text` ทุกครั้งที่บันทึกสำเร็จ ไม่มีเงื่อนไขอื่น (BR-37) — ต้นแบบ
 * เขียนไว้ว่าธงหายตอนบันทึกหลังแก้ข้อความ และการบันทึกผ่านฟอร์มนี้คือจุดเดียวที่
 * นับเป็น "แก้ข้อความ" ในความหมายของกฎข้อนี้ · ราคาของการเคลียร์ "เกินจำเป็น" (เช่น
 * บันทึกด้วยข้อความเดิมเป๊ะ) ต่ำกว่าราคาของการค้างธงไว้ทั้งที่คนตั้งใจกดบันทึกแล้ว
 */
export async function saveBlockContent(
  campaignId: string, cardId: string, blockId: string, formData: FormData,
): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const [block] = await sql<{ block_type: BlockType }[]>`
    SELECT block_type FROM card_block WHERE id = ${blockId} AND card_id = ${cardId}`
  if (!block) throw new Error('ไม่พบบล็อกนี้ในการ์ดนี้')

  if (!canRoleEditBlock(session.role, block.block_type)) {
    throw new Error(
      'บทบาทผู้ดูแลเนื้อหาแก้ได้เฉพาะข้อความและภาพ (Permission Matrix · L1 §2)'
      + ' — บล็อกชนิดนี้แก้ได้เฉพาะผู้ตั้งค่า',
    )
  }

  const result = parseBlockSave({
    blockType: block.block_type,
    content: String(formData.get('content') ?? ''),
    fullTop: formData.get('full_top') !== null,
    counter: trimmed(formData, 'counter'),
    target: trimmed(formData, 'target'),
    actionKind: trimmed(formData, 'action_kind'),
    actionTarget: trimmed(formData, 'action_target'),
  })
  if (!result.ok) throw new Error(result.reason)

  await sql.begin(async (tx) => {
    await tx`
      UPDATE card_block
         SET content = ${result.content},
             options = ${result.options === null ? null : tx.json(result.options as never)}
       WHERE id = ${blockId} AND card_id = ${cardId}`
    await tx`UPDATE card SET has_sample_text = false WHERE id = ${cardId}`
  })

  revalidatePath(path(campaignId, cardId))
}

/**
 * เพิ่มบล็อกใหม่ต่อท้ายรายการเสมอ · ผู้ตั้งค่าเท่านั้น (โครงสร้างของการ์ด)
 *
 * ปฏิเสธชนิดที่วาดไม่ได้ที่นี่ ไม่ใช่แค่ทำให้จอกดไม่ได้ — `card_block.block_type`
 * ยังรับอีกหกชนิดตาม CHECK และค่าที่ยิงตรงเข้ามาต้องเจอด่านเดียวกับที่จอเห็น
 */
export async function addBlock(
  campaignId: string, cardId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const rawType = trimmed(formData, 'block_type')
  if (!isDrawableBlockType(rawType)) {
    throw new Error(`ยังเพิ่มบล็อกชนิด "${rawType}" ไม่ได้ — ${UNDRAWABLE_REASON}`)
  }

  const existing = await loadOrderedBlocks(sql, cardId)
  const asBlocks: CardBlock[] = existing.map((row) => ({
    id: row.id, blockType: row.block_type, sortOrder: row.sort_order,
    content: null, showWhen: null, options: null,
  }))

  const can = canAddBlock(asBlocks, rawType)
  if (!can.ok) throw new Error(can.reason)

  await sql`
    INSERT INTO card_block (card_id, block_type, sort_order, content, options)
    VALUES (${cardId}, ${rawType}, ${existing.length}, ${null}, ${null})`

  revalidatePath(path(campaignId, cardId))
}

/**
 * ลบบล็อกแล้วไล่ลำดับที่เหลือใหม่จากศูนย์ (BR-92) · ผู้ตั้งค่าเท่านั้น
 */
export async function deleteBlock(
  campaignId: string, cardId: string, blockId: string,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  await sql.begin(async (tx) => {
    await tx`DELETE FROM card_block WHERE id = ${blockId} AND card_id = ${cardId}`
    const remaining = await tx<{ id: string }[]>`
      SELECT id FROM card_block WHERE card_id = ${cardId} ORDER BY sort_order`
    for (let index = 0; index < remaining.length; index += 1) {
      await tx`UPDATE card_block SET sort_order = ${index} WHERE id = ${remaining[index].id}`
    }
  })

  revalidatePath(path(campaignId, cardId))
}

/**
 * ลากเรียงใหม่ทั้งชุด · เรียกตรงจาก BlockList.tsx (client component) ไม่ใช่ผ่าน
 * `<form>` — วิธีเดียวกับที่ ChatSim.tsx เรียก play/reset ตรงๆ (Task 16)
 *
 * ตรวจว่า `orderedIds` เป็นการสลับที่ของบล็อกที่มีอยู่จริงเท่านั้น ไม่ใช่เชื่อค่าที่
 * ฝั่ง client ส่งมาตรงๆ — ฝั่ง client แต่งเองได้ทุกอย่างรวมถึงยัด id ที่ไม่มีอยู่จริง
 * หรือใบเดิมซ้ำหลายรอบ
 */
export async function reorderBlocks(
  campaignId: string, cardId: string, orderedIds: string[],
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const existing = await loadOrderedBlocks(sql, cardId)
  const existingIds = new Set(existing.map((row) => row.id))
  const isPermutation = orderedIds.length === existing.length
    && new Set(orderedIds).size === orderedIds.length
    && orderedIds.every((id) => existingIds.has(id))
  if (!isPermutation) {
    throw new Error('ลำดับที่ส่งมาไม่ตรงกับบล็อกที่มีอยู่จริงในการ์ดนี้')
  }

  await persistOrder(sql, cardId, orderedIds)
  revalidatePath(path(campaignId, cardId))
}

/**
 * ปุ่มขึ้น/ลง · ทางเลือกสำรองที่ทดสอบได้ง่ายกว่าการลาก และใช้ตรรกะเดียวกับ
 * `reorder()` บริสุทธิ์ใน lib/cards/blocks.ts — mutate ฟังก์ชันนั้นแล้วทางนี้ต้องแดง
 * ไปด้วย ไม่ใช่มีตรรกะสำรองของตัวเอง
 */
export async function moveBlock(
  campaignId: string, cardId: string, blockId: string, direction: 'up' | 'down',
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const existing = await loadOrderedBlocks(sql, cardId)
  const index = existing.findIndex((row) => row.id === blockId)
  if (index === -1) throw new Error('ไม่พบบล็อกนี้ในการ์ดนี้')

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= existing.length) return

  const asBlocks: CardBlock[] = existing.map((row) => ({
    id: row.id, blockType: row.block_type, sortOrder: row.sort_order,
    content: null, showWhen: null, options: null,
  }))
  const moved = reorderPure(asBlocks, index, target)

  await persistOrder(sql, cardId, moved.map((block) => block.id))
  revalidatePath(path(campaignId, cardId))
}

/**
 * เพิ่มเงื่อนไขการแสดงหนึ่งข้อ (ส่วนที่ 3 ของสามส่วน) · ผู้ตั้งค่าเท่านั้น เพราะ
 * กระทบทางเดินของแคมเปญเหมือนปุ่ม
 */
export async function addShowWhenCondition(
  campaignId: string, cardId: string, blockId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const type = asShowWhenType(trimmed(formData, 'type'))
  if (!type) throw new Error('ต้องเลือกชนิดของเงื่อนไข')

  const values: Record<string, string> = {}
  for (const field of SHOW_WHEN_FIELDS[type]) values[field.key] = trimmed(formData, field.key)
  const problem = validateConditionValues(type, values)
  if (problem) throw new Error(problem)

  const condition = buildCondition(type, values)

  const [row] = await sql<{ show_when: Condition[] | null }[]>`
    SELECT show_when FROM card_block WHERE id = ${blockId} AND card_id = ${cardId}`
  if (!row) throw new Error('ไม่พบบล็อกนี้ในการ์ดนี้')

  const next = [...(row.show_when ?? []), condition]
  await sql`UPDATE card_block SET show_when = ${sql.json(next as never)} WHERE id = ${blockId}`

  revalidatePath(path(campaignId, cardId))
}

export async function removeShowWhenCondition(
  campaignId: string, cardId: string, blockId: string, index: number,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCard(sql, campaignId, cardId)

  const [row] = await sql<{ show_when: Condition[] | null }[]>`
    SELECT show_when FROM card_block WHERE id = ${blockId} AND card_id = ${cardId}`
  if (!row) throw new Error('ไม่พบบล็อกนี้ในการ์ดนี้')

  const next = (row.show_when ?? []).filter((_, i) => i !== index)
  await sql`
    UPDATE card_block SET show_when = ${next.length === 0 ? null : sql.json(next as never)}
     WHERE id = ${blockId}`

  revalidatePath(path(campaignId, cardId))
}
