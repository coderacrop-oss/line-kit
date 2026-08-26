import type postgres from 'postgres'
import { CARD_RENDER_NAME, type CardRenderType } from '../db/cards'
import type { BlockType } from '../render/groups'

/**
 * สร้างการ์ดหนึ่งใบ · ชนิดการส่ง แล้วเทมเพลต
 *
 * ทั้งการอ่านเทมเพลตและการเขียนการ์ดอยู่ในไฟล์เดียวกัน แบบเดียวกับที่
 * `lib/campaign/duplicate.ts` เป็นเจ้าของการก๊อปทั้งขาอ่านและขาเขียน — สิ่งที่
 * ผูกโค้ดก้อนนี้เข้าด้วยกันคือ "การ์ดใบใหม่เกิดขึ้นยังไง" ไม่ใช่ "แตะตารางไหน"
 *
 * ⚠️ `card_template` ถูกเติมข้อมูลจริงที่ `supabase/migrations/0004_card_templates.sql`
 * ไม่มีเทมเพลตตัวไหนถูกเขียนไว้ในไฟล์นี้หรือในไฟล์จอ · ที่นี่รู้แค่ว่าเทมเพลตหน้าตา
 * ยังไง ไม่ได้รู้ว่ามีตัวไหนบ้าง
 */

/** ห้าชนิดที่สไลซ์นี้เปิดให้สร้างได้ทั้งหมด — ตรงกับ CHECK ของ card.render_as เป๊ะ */
export type SendType = 'flex_bubble' | 'flex_carousel' | 'imagemap' | 'imagemap_video' | 'text'

export type SendTypeOption = {
  value: CardRenderType
  name: string
  /** ประโยคเดียวที่บอกว่าเลือกอันนี้แล้วผู้เล่นจะเห็นอะไร */
  detail: string
  open: boolean
  /** มีเฉพาะตัวที่ยังเลือกไม่ได้ · ตัวที่เปิดอยู่ต้องไม่มีค่านี้ค้างไว้ */
  blockedReason?: string
}

/**
 * ห้าชนิด ครบทุกตัว
 *
 * `card.render_as` รับห้าค่าและจอแสดงครบห้า — imagemap (ริชเมสเสจภาพล้วน, เฟส 1)
 * กับ imagemap_video (ริชวิดีโอ, เฟส 2 · OI-27) เปิดทั้งคู่แล้ว ตัวจัดวางภาพของทั้ง
 * สองคือจอแยกต่างหากเดียวกัน (app/(admin)/campaigns/[id]/cards/[cardId]/imagemap)
 * ไม่ใช่บล็อกเอดิเตอร์แบบสามตัวแรก — imagemap_video ต่างตรงที่มีช่องอัปโหลดวิดีโอ/
 * ภาพตัวอย่างเพิ่มมาในจอเดียวกัน (ดู components/imagemap/ImagemapEditor.tsx)
 */
export const SEND_TYPE_OPTIONS: readonly SendTypeOption[] = [
  {
    value: 'flex_bubble',
    name: CARD_RENDER_NAME.flex_bubble,
    detail: 'การ์ดใบเดียว มีภาพ ข้อความ และปุ่มได้ถึงสามปุ่ม — ใช้บ่อยที่สุด',
    open: true,
  },
  {
    value: 'flex_carousel',
    name: CARD_RENDER_NAME.flex_carousel,
    detail: 'หลายใบเรียงกันให้ปัดดู — ใบแรกคือใบที่ตั้งค่าที่นี่ ใบถัดไปเพิ่มทีหลัง',
    open: true,
  },
  {
    value: 'text',
    name: CARD_RENDER_NAME.text,
    detail: 'ข้อความเปล่าไม่มีกรอบ — บล็อกที่ไม่พาข้อความออกไปจะถูกตัดทิ้ง',
    open: true,
  },
  {
    value: 'imagemap',
    name: CARD_RENDER_NAME.imagemap,
    detail: 'ภาพเต็มใบที่กดตามพื้นที่ได้',
    open: true,
  },
  {
    value: 'imagemap_video',
    name: CARD_RENDER_NAME.imagemap_video,
    detail: 'ภาพเต็มใบที่มีวิดีโอเล่นอยู่ข้างใน',
    open: true,
  },
]

/**
 * ชนิดที่เลือกได้จริง อ่านจากตารางข้างบน ไม่ใช่รายการที่สอง
 *
 * รายการที่สองคือที่ที่วันหนึ่งจะมีตัวที่เปิดในรายการหนึ่งแต่ปิดในอีกรายการ และ
 * ฝั่งที่ผ่อนกว่าจะเป็นฝั่งที่ตัดสินว่าอะไรถูกเขียนลงฐานข้อมูล
 */
export const OPEN_SEND_TYPES: readonly SendType[] = SEND_TYPE_OPTIONS
  .filter((option) => option.open)
  .map((option) => option.value as SendType)

/** ค่าจาก URL หรือจากฟอร์มที่แต่งเอง กลายเป็นชนิดที่ยอมรับได้ — อ่านจาก OPEN_SEND_TYPES เท่านั้น ไม่มีรายการที่สอง */
export function asSendType(raw: string | null | undefined): SendType | null {
  return (OPEN_SEND_TYPES as readonly string[]).includes(raw ?? '')
    ? (raw as SendType)
    : null
}

export type TemplateGroupKey = 'blank' | 'from_line' | 'beyond_line' | 'other'

export type TemplateGroup = { key: TemplateGroupKey; label: string; note: string }

/**
 * สองกลุ่มที่ BR-63 สั่ง บวกที่ทางของ "เริ่มจากศูนย์" และของที่ยังไม่ได้จัดกลุ่ม
 *
 * "เริ่มจากศูนย์" มีกลุ่มของตัวเองแต่ยังอยู่ในชุดเดียวกันและถูกเลือกด้วยการกดแบบ
 * เดียวกัน — ต้นแบบของจอกิจกรรมซ่อนมันไว้หลังลิงก์ "ดูตัวเลือกเพิ่มเติม" ซึ่ง BR-63
 * ห้ามไว้สำหรับการ์ด · คนที่รู้อยู่แล้วว่าจะทำอะไรไม่ควรต้องหาปุ่มเริ่มจากศูนย์
 *
 * `other` มีไว้ให้เทมเพลตที่รหัสไม่เข้ากลุ่มไหน · เทมเพลตที่หลุดกลุ่มแล้วหายจากจอ
 * คือของที่มีอยู่ในฐานข้อมูลแต่ไม่มีใครเลือกได้ และไม่มีอะไรบนจอบอกว่ามันหายไป
 */
export const CARD_TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  {
    key: 'blank',
    label: 'เริ่มจากศูนย์',
    note: 'ได้การ์ดที่มีหัวข้อกับข้อความเปล่าให้เขียนทับ — อยู่ในชุดเดียวกันเสมอ (BR-63)',
  },
  {
    key: 'from_line',
    label: 'ลอกจาก LINE',
    note: 'รูปแบบที่ LINE มีให้อยู่แล้ว — คนที่เคยเห็นในแชทอื่นจะคุ้นตาทันที',
  },
  {
    key: 'beyond_line',
    label: 'LINE ไม่มี',
    note: 'รูปแบบที่ต้องประกอบเอง เช่นบัตรแสตมป์กับแถบความคืบหน้า',
  },
  {
    key: 'other',
    label: 'ยังไม่ได้จัดกลุ่ม',
    note: 'รหัสเทมเพลตไม่ขึ้นต้นด้วยกลุ่มไหน — แสดงไว้เพื่อไม่ให้หายไปเงียบๆ',
  },
]

/**
 * กลุ่มของเทมเพลตอ่านจากรหัสของมันเอง
 *
 * `card_template` ไม่มีคอลัมน์กลุ่ม และการเติมคอลัมน์เข้าไปจะทำให้ schema ไม่ตรง
 * L2 §5.2 ซึ่ง `npm run db:check` บังคับอยู่ · รหัสจึงเป็นที่เก็บกลุ่ม และ migration
 * ที่ seed เทมเพลตเขียนคำอธิบายเรื่องนี้ไว้เหนือแถวทั้งสิบ
 */
export function templateGroupOf(code: string): TemplateGroupKey {
  if (code === 'blank') return 'blank'
  if (code.startsWith('line_')) return 'from_line'
  if (code.startsWith('beyond_')) return 'beyond_line'
  return 'other'
}

/** รูปของบล็อกหนึ่งอันอย่างที่เก็บอยู่ใน `card_template.blocks` */
export type TemplateBlock = {
  blockType: BlockType
  content?: string | null
  options?: Record<string, unknown> | null
}

export type NewBlock = {
  blockType: BlockType
  sortOrder: number
  content: string | null
  options: Record<string, unknown> | null
}

/**
 * ชนิดบล็อกที่ `toPlainText` อ่านออกมาเป็นบรรทัด
 *
 * ต้องตรงกับ `CARRIES_TEXT` ใน `lib/render/text.ts` · ที่นี่ไม่ import มันมาเพราะ
 * ไฟล์นั้นไม่ได้ส่งออก และการแก้ให้ส่งออกจะทำให้ตัวเลือกของจอไปผูกกับตัววาด
 * ในทิศที่ไม่มีใครตั้งใจ · เทสต์ของไฟล์นี้ผูกสองรายการไว้ด้วยกันแทน
 */
const CARRIES_TEXT: readonly BlockType[] = ['title', 'body', 'caption', 'button']

const hasText = (block: TemplateBlock): boolean => (block.content ?? '').trim() !== ''

/**
 * เทมเพลตหนึ่งตัวคูณกับชนิดหนึ่งชนิด กลายเป็นบล็อกของการ์ดใบใหม่
 *
 * สองแกนนี้เป็นอิสระต่อกัน — เทมเพลตสิบตัวกับชนิดห้าชนิดคือหกสิบคู่ที่เลือกได้
 * โดยเก็บของไว้สิบห้าชิ้น ไม่ใช่ห้าสิบแถวที่ต้องคอยดูแลให้ตรงกัน
 *
 * ลำดับคือสิ่งเดียวที่คนตั้งค่ากับผู้เล่นต้องเห็นตรงกัน (BR-92) จึงไล่เลขใหม่จาก
 * ศูนย์เสมอ — ไม่ใช่หยิบเลขของเทมเพลตมาใช้ต่อ ซึ่งจะเหลือรูตรงที่ถูกตัดออก แล้ว
 * บล็อกที่แทรกทีหลังจะไปตกในรูนั้น
 *
 * ข้อความล้วนตัดบล็อกที่ไม่มีข้อความออก เพราะ `toPlainText` ไม่เคยอ่านมันอยู่แล้ว
 * บล็อกที่เหลือไว้จะเป็นบล็อกที่เห็นบนจอตั้งค่าแต่ผู้เล่นไม่มีวันเห็น
 */
export function blocksFromTemplate(
  templateBlocks: readonly TemplateBlock[],
  sendType: SendType,
): NewBlock[] {
  const kept = sendType === 'text'
    ? templateBlocks.filter((block) => CARRIES_TEXT.includes(block.blockType) && hasText(block))
    : templateBlocks

  return kept.map((block, index) => ({
    blockType: block.blockType,
    sortOrder: index,
    content: block.content ?? null,
    options: block.options ?? null,
  }))
}

/**
 * BR-37 · การ์ดใบนี้ยังเป็นข้อความของเทมเพลต ไม่ใช่ของคนเขียน
 *
 * ทุกตัวอักษรในบล็อกชุดนี้มาจากเทมเพลต ไม่ได้มาจากใครสักคนที่ตั้งใจเขียนมัน —
 * ถ้ามีสักตัวอักษร การ์ดใบนี้จึงยังเป็นข้อความตัวอย่าง · จอส่งขึ้น LINE อ่าน
 * `card.has_sample_text` แล้วบล็อกการส่งขึ้นบัญชีจริงจากค่านี้ (ERR-034)
 *
 * เขียนเป็นฟังก์ชันของบล็อกที่จะถูกเขียนจริง ไม่ใช่ค่าคงที่ `true` ต่อท้ายการสร้าง
 * ทุกครั้ง เพราะเทมเพลตที่ไม่มีข้อความเลย (ภาพล้วน) ไม่มีข้อความตัวอย่างให้หลุด
 * ขึ้นบัญชีจริง และการติดธงให้มันจะเป็นด่านที่ไม่มีทางแก้ได้
 */
export function hasSampleText(blocks: readonly NewBlock[]): boolean {
  return blocks.some((block) => (block.content ?? '').trim() !== '')
}

/**
 * รหัสการ์ด · ตัวพิมพ์เล็ก ตัวเลข ขีดล่าง
 *
 * ยาวได้กว่ารหัสกิจกรรมเพราะไม่ได้เดินทางไปกับ postback ที่ LINE จำกัดไว้ 300
 * ตัวอักษร — ปุ่มแนบ `id` ของการ์ดไปไม่ใช่รหัส
 */
const CODE_PATTERN = /^[a-z0-9_]{1,40}$/

export const isCardCode = (raw: string): boolean => CODE_PATTERN.test(raw)

export type CardTemplate = {
  code: string
  name: string
  description: string | null
  blocks: TemplateBlock[]
  group: TemplateGroupKey
  /** เทมเพลตที่มากับระบบ · แยกจากที่ใครสักคนเพิ่มเข้ามาทีหลัง */
  isBuiltin: boolean
  sortOrder: number
}

type TemplateRow = {
  code: string
  name: string
  description: string | null
  blocks: TemplateBlock[]
  is_builtin: boolean
  sort_order: number
}

/** เทมเพลตทุกตัวที่มีอยู่ · เรียงตามกลุ่มแล้วตามลำดับที่ migration ตั้งไว้ */
export async function listCardTemplates(sql: postgres.Sql): Promise<CardTemplate[]> {
  const rows = await sql<TemplateRow[]>`
    SELECT code, name, description, blocks, is_builtin, sort_order
      FROM card_template ORDER BY sort_order, code`

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    blocks: row.blocks,
    group: templateGroupOf(row.code),
    isBuiltin: row.is_builtin,
    sortOrder: row.sort_order,
  }))
}

export type CreateCardInput = {
  campaignId: string
  code: string
  sendType: SendType
  templateCode: string
  ownerActivityId?: string
}

export class CardCreateError extends Error {}

/**
 * การ์ดใบใหม่ พร้อมบล็อกของเทมเพลตที่เลือก · ธุรกรรมเดียว
 *
 * การ์ดกับบล็อกอยู่ในธุรกรรมเดียวกันเพราะการ์ดที่ไม่มีบล็อกสักอันคือการ์ดที่ส่ง
 * ออกไปเป็นข้อความว่าง ซึ่งผู้เล่นแยกไม่ออกจากบอทที่พัง · ถ้าครึ่งหลังล้ม ครึ่งแรก
 * ต้องไม่เหลืออยู่
 *
 * ไม่ห้ามแคมเปญที่ส่งขึ้นแล้ว ต่างจากกิจกรรมที่ BR-05 ล็อกไว้ — เนื้อหาของการ์ด
 * แก้ได้ตลอด และมีผลกับการ์ดที่ส่งครั้งถัดไป ไม่ใช่ใบที่อยู่ในแชทไปแล้ว ซึ่งเป็น
 * สิ่งที่ต้นแบบของจอนี้เขียนไว้เองเป็นกล่องข้อมูลบนหัวจอ
 */
export async function createCardFromTemplate(
  sql: postgres.Sql,
  input: CreateCardInput,
): Promise<{ id: string; hasSampleText: boolean }> {
  if (!isCardCode(input.code)) {
    throw new CardCreateError(
      'รหัสการ์ดใช้ได้เฉพาะ a-z 0-9 และขีดล่าง ยาวไม่เกิน 40 ตัว',
    )
  }

  const [template] = await sql<{ code: string; blocks: TemplateBlock[] }[]>`
    SELECT code, blocks FROM card_template WHERE code = ${input.templateCode}`
  if (!template) {
    throw new CardCreateError(`ไม่พบเทมเพลต "${input.templateCode}"`)
  }

  const blocks = blocksFromTemplate(template.blocks, input.sendType)
  if (blocks.length === 0) {
    throw new CardCreateError(
      `เทมเพลต "${template.code}" ไม่เหลือบล็อกไหนเลยเมื่อส่งแบบข้อความล้วน`,
    )
  }

  const sample = hasSampleText(blocks)

  const id = await sql.begin(async (tx) => {
    const [card] = await tx<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, render_as, template_code, has_sample_text, owner_activity_id)
      VALUES (${input.campaignId}, ${input.code}, ${input.sendType},
              ${template.code}, ${sample}, ${input.ownerActivityId ?? null})
      RETURNING id`

    for (const block of blocks) {
      await tx`
        INSERT INTO card_block (card_id, block_type, sort_order, content, options)
        VALUES (${card.id}, ${block.blockType}, ${block.sortOrder}, ${block.content},
                ${block.options === null ? null : tx.json(block.options as never)})`
    }

    return card.id
  })

  return { id: id as string, hasSampleText: sample }
}

/** ชื่อชนิดที่หัวจอเอาไปวางไว้ข้างเครื่องหมายคูณ */
export const sendTypeName = (value: CardRenderType): string => CARD_RENDER_NAME[value]
