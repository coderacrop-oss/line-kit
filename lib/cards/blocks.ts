import type { BlockType, CardBlock } from '../render/groups'
import type { Condition } from '../state'

/**
 * เลขที่บล็อกเอดิเตอร์ (M3-S02 ขั้น 3) ใช้ตัดสินใจ · บริสุทธิ์ทั้งไฟล์
 *
 * ไม่แตะฐานข้อมูล ไม่แตะ Next — ฟังก์ชันในนี้รับ `CardBlock[]` เข้ามาแล้วคืนค่าใหม่
 * หรือคำตอบใหม่ ตัวจอกับ Server Action เป็นคนเรียกและเป็นคนเขียนลง DB เอง เหมือนที่
 * `lib/activities/wizard.ts` ทำกับกิจกรรม
 */

/** BR-66 · เกินแล้วขนาดข้อความเกินที่ LINE รับ ส่งไม่ออกและไม่มีข้อความบอกสาเหตุ */
export const MAX_BLOCKS = 10
export const MAX_BUTTONS = 3

/**
 * แปดชนิดที่ `lib/render/flex.ts` มีกิ่งวาดจริง — ไม่ใช่สิบสี่ชนิดที่ CHECK ของ
 * `card_block.block_type` ยอมรับ
 *
 * รายการนี้พิมพ์ไว้ที่นี่แทนที่จะ import จาก `lib/render/flex.ts` เพราะไฟล์นั้น
 * ไม่ส่งออกอะไรให้ไฟล์อื่นรู้ว่าวาดชนิดไหนได้บ้าง (มีแต่ `toFlexBubble` กับ
 * `toFlexCarousel`) และการเติม export ใหม่เข้าไปจะเป็นการแก้ `lib/render/` ซึ่ง
 * เป็นเขตห้ามแตะของสไลซ์นี้ · เทสต์ของไฟล์นี้อ่านซอร์สของ `flex.ts` กับ CHECK ใน
 * migration มาเทียบกับรายการนี้ตรงๆ แทน เพื่อไม่ให้สองที่นี้แยกออกจากกันเงียบๆ
 * ถ้าใครมาเพิ่มตัววาดภาพให้ชนิดใหม่ทีหลัง แล้วลืมมาแก้ที่นี่ เทสต์จะแดง
 */
export const DRAWABLE_BLOCK_TYPES: readonly BlockType[] = [
  'image', 'title', 'body', 'caption', 'progress_bar', 'divider', 'spacer', 'button',
]

export const BLOCK_TYPE_NAME: Record<BlockType, string> = {
  image: 'ภาพ',
  title: 'หัวข้อ',
  body: 'ข้อความ',
  caption: 'คำบรรยาย',
  progress_bar: 'แถบความคืบหน้า',
  divider: 'เส้นคั่น',
  spacer: 'ช่องว่าง',
  button: 'ปุ่ม',
}

/**
 * ชนิดที่ CHECK ยอมรับแต่ยังไม่มีตัววาด · แสดงเหตุผลไว้ที่นี่ที่เดียว จอกับ Server
 * Action อ่านข้อความเดียวกันจากที่นี่ ไม่ใช่ต่างคนต่างพิมพ์
 */
export const UNDRAWABLE_REASON =
  'ยังไม่มีตัววาดภาพสำหรับบล็อกชนิดนี้ (lib/render/flex.ts) — เพิ่มได้แต่ผู้เล่นจะไม่เห็นอะไรเลย'

export function isDrawableBlockType(type: string): type is BlockType {
  return (DRAWABLE_BLOCK_TYPES as readonly string[]).includes(type)
}

/**
 * ย้ายบล็อกแล้วไล่เลข `sortOrder` ใหม่จากศูนย์เสมอ
 *
 * ลำดับคือสิ่งเดียวที่เอดิเตอร์กับผู้เล่นต้องเห็นตรงกัน (BR-92) และรูใน sort_order
 * คือจุดที่ทั้งสองฝั่งเริ่มไม่ตรงกัน — บล็อกที่แทรกทีหลังจะไปตกในรูนั้น แล้วรายการที่
 * คนตั้งค่าเห็นจะไม่ใช่รายการที่ถูกวาดออกไปอีกต่อไป
 */
export function reorder(blocks: CardBlock[], fromIndex: number, toIndex: number): CardBlock[] {
  const next = [...blocks]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((block, index) => ({ ...block, sortOrder: index }))
}

export function countAgainstLimits(blocks: CardBlock[]): {
  blocks: number
  buttons: number
  blocksLeft: number
  buttonsLeft: number
} {
  const buttons = blocks.filter((block) => block.blockType === 'button').length
  return {
    blocks: blocks.length,
    buttons,
    blocksLeft: Math.max(0, MAX_BLOCKS - blocks.length),
    buttonsLeft: Math.max(0, MAX_BUTTONS - buttons),
  }
}

export function canAddBlock(
  blocks: CardBlock[],
  type: BlockType,
): { ok: true } | { ok: false; reason: string } {
  if (blocks.length >= MAX_BLOCKS) {
    return { ok: false, reason: `การ์ดหนึ่งใบมีได้ ${MAX_BLOCKS} บล็อก — เอาบล็อกอื่นออกก่อน` }
  }
  if (type === 'button' && countAgainstLimits(blocks).buttonsLeft === 0) {
    return { ok: false, reason: `การ์ดหนึ่งใบมีปุ่มได้ ${MAX_BUTTONS} ปุ่ม` }
  }
  return { ok: true }
}

/**
 * ชนิดที่ "ค่าของตัวเอง" เป็นข้อความหรือ URL ที่สลับเป็นค่าคงที่หรือดึงจากชุดเนื้อหา
 * ได้ (ส่วนที่ 2 ของสามส่วน — "สวิตช์ตามสถานะ")
 *
 * เส้นคั่น ช่องว่าง และแถบความคืบหน้า ไม่มีเนื้อหาแบบนี้ให้สลับ — เส้นคั่นกับช่องว่าง
 * ไม่มีเนื้อหาเลย ส่วนแถบความคืบหน้าอ่านค่าจาก `options.counter` ตรงๆ ซึ่งเป็นคนละ
 * กลไกกับ `content`/`selector_id`
 */
const CONTENT_CAPABLE_TYPES: readonly BlockType[] = ['image', 'title', 'body', 'caption', 'button']

export function supportsContentSource(type: BlockType): boolean {
  return (CONTENT_CAPABLE_TYPES as readonly string[]).includes(type)
}

/**
 * ชนิดที่บทบาทผู้ดูแลเนื้อหาแก้ได้ · Permission Matrix (L1 §2) ตามที่ต้นแบบเขียนไว้
 * บนจอเอง — "แก้ได้เฉพาะข้อความและภาพ ส่วนปุ่มและปลายทางแก้ไม่ได้เพราะกระทบทางเดิน
 * ของแคมเปญ" · จอกับ Server Action ใช้รายการเดียวกันนี้ ไม่ใช่ต่างคนต่างพิมพ์ชนิดเอง
 */
export const CONTENT_EDITOR_TYPES: readonly BlockType[] = ['title', 'body', 'caption', 'image']

export function canRoleEditBlock(
  role: 'configurator' | 'content_editor' | 'reporter',
  type: BlockType,
): boolean {
  if (role === 'configurator') return true
  if (role === 'content_editor') return (CONTENT_EDITOR_TYPES as readonly string[]).includes(type)
  return false
}

/** ชุดเนื้อหาที่ใช้ได้กับบล็อกชนิดนี้คืนอะไร — ตรงกับ `card_selector.returns` */
export const SELECTOR_RETURN_FOR: Partial<Record<BlockType, 'text' | 'asset'>> = {
  image: 'asset',
  title: 'text',
  body: 'text',
  caption: 'text',
  button: 'text',
}

// ── ปลายทางของปุ่ม (BR-40) ──────────────────────────────────────────────────
//
// L2 §7 (ตาราง §3 แถว Renderer) เขียน BR-40 ไว้ตรงๆ ว่า "ปุ่มไม่รับ selector" และ
// docs/design/FLEX_AD_L2_v0.32.html บรรทัด 994 ขยายว่า "ปลายทางใน options ต้อง
// คงที่เสมอ · ถ้าปลายทางเปลี่ยนตามค่าได้ จะเกิดเส้นทางที่ไม่มีใครมองเห็นภาพรวม
// ซึ่งคือ flow engine ที่ตัดออกไปแล้ว" — นี่คือกฎโครงสร้างที่จริงตลอดเวลา ไม่ใช่กฎ
// ที่ผูกกับว่าแคมเปญเคยส่งขึ้น production หรือยัง ป้ายบนแบบที่กำกับปุ่มจึงเป็นค่า
// คงที่เสมอ (ฟังก์ชันข้างล่างรับ target เป็น string ธรรมดา ไม่มีทางไหนรับ
// selectorId) ส่วนป้ายบนปุ่ม (content) ยังสลับคงที่/ชุดเนื้อหาได้ตามปกติเหมือน
// บล็อกอื่น — จอแสดงกุญแจ 🔒 ไว้ข้างช่องปลายทางเสมอ พร้อมประโยคนี้ ไม่ใช่ซ่อนช่อง
// สลับไปเงียบๆ

export type ButtonActionKind = 'message' | 'uri'

export type ButtonActionOption = {
  value: ButtonActionKind | 'postback_activity'
  name: string
  detail: string
  open: boolean
  blockedReason?: string
}

/**
 * "→ ไปกิจกรรมอื่น" ปิดอยู่ด้วยเหตุผลที่ตรวจสอบได้จากโค้ดจริงสามจุด
 *
 * `lib/match/postback.ts` ต้องการคีย์ `d` (period key ของวันนี้) เสมอ ·
 * `lib/webhook/handle.ts` ปฏิเสธทันทีถ้า `payload.d !== today` (การ์ดหมดอายุ) ·
 * และ `lib/render/card.ts`/`lib/render/flex.ts` ไม่มีจุดไหนฉีดค่า `today`/รหัส
 * แคมเปญเข้าไปใน `options.action` เลย — `component()` ใน flex.ts แค่กระจาย
 * `options.action` ตรงๆ ออกไปเป็น action ของ LINE เท่านั้น ปุ่ม postback ที่เอดิเตอร์
 * นี้สร้างได้จึงจะพังทุกครั้งด้วยข้อความ "การ์ดนี้หมดอายุแล้ว" ไม่ว่าจะกดวันไหนก็ตาม
 * (หรือ "ระบบขัดข้องชั่วคราว" ถ้าไม่ใส่ `d` เลยจน decodePostback คืน null)
 *
 * แก้จริงต้องเติมการฉีดค่าใน `lib/render/` ซึ่งเป็นเขตห้ามแตะของสไลซ์นี้ — ปิดไว้
 * พร้อมเหตุผลแทนการเปิดให้สร้างบล็อกที่ผู้เล่นกดแล้วเงียบ (หรือแย่กว่านั้นคือเจอ
 * ข้อความ error ทุกครั้ง)
 */
export const BUTTON_ACTION_OPTIONS: readonly ButtonActionOption[] = [
  {
    value: 'message',
    name: 'พิมพ์ข้อความ/คีย์เวิร์ด',
    detail: 'กดแล้วเหมือนผู้เล่นพิมพ์คำนี้เอง — ใช้กับคีย์เวิร์ดที่ตั้งไว้แล้วในแคมเปญนี้ได้ทันที ไม่ต้องแก้ตัวเรนเดอร์',
    open: true,
  },
  {
    value: 'uri',
    name: 'เปิดลิงก์',
    detail: 'เปิดหน้าเว็บ — ไม่นับเป็นการเล่นและไม่ยิงข้อมูลกลับเข้ากติกา',
    open: true,
  },
  {
    value: 'postback_activity',
    name: 'ไปกิจกรรมอื่น (postback)',
    detail: 'พาไปเล่นกิจกรรมอื่นโดยตรงโดยไม่ต้องพิมพ์คีย์เวิร์ด',
    open: false,
    blockedReason:
      'lib/render/flex.ts ยังไม่ฉีดวันที่ของวันนี้ (period key) ให้ปุ่ม — กดแล้วเจอ'
      + ' "การ์ดนี้หมดอายุแล้ว" เสมอ ตาม lib/webhook/handle.ts (payload.d !== today) · ต้องแก้ที่ตัวเรนเดอร์ก่อน',
  },
]

export type ButtonAction = { type: string; [key: string]: unknown }

/** สร้าง `options.action` จากชนิดกับปลายทางที่กรอก · target เป็นค่าคงที่เสมอ (BR-40) */
export function buildButtonAction(kind: ButtonActionKind, target: string): ButtonAction {
  if (kind === 'uri') return { type: 'uri', uri: target }
  return { type: 'message', text: target }
}

/** อ่านชนิดกับปลายทางกลับจาก `options.action` ที่บันทึกไว้ · ใช้เติมค่าเริ่มต้นในฟอร์ม */
export function readButtonAction(
  action: Record<string, unknown> | null | undefined,
): { kind: ButtonActionKind | null; target: string } {
  if (!action) return { kind: null, target: '' }
  if (action.type === 'uri' && typeof action.uri === 'string') {
    return { kind: 'uri', target: action.uri }
  }
  if (action.type === 'message' && typeof action.text === 'string') {
    return { kind: 'message', target: action.text }
  }
  // เทมเพลตของ Task 12 ทิ้ง {"action":{"type":"postback","data":""}} ไว้ — ค่าว่าง
  // เปล่าแบบนี้อ่านเป็น "ยังไม่ได้ตั้งปลายทาง" ไม่ใช่ปลายทางที่ใช้งานได้
  return { kind: null, target: '' }
}

// ── เงื่อนไขการแสดง (show_when) — ส่วนที่ 3 ของสามส่วน ใช้ร่วมกันทุกชนิดบล็อก ────
//
// ผูกกับ `Condition` ใน lib/state.ts ตรงๆ ทั้งชื่อ type และชื่อคีย์ — ฟอร์มที่เขียน
// คีย์คนละชื่อจะได้เงื่อนไขที่ `evaluate()` ไม่มีวันอ่านออก ซึ่งเงียบเหมือนกับที่
// `saveEntryRule` เคยพลาดมาก่อน (ดู docs/HANDOFF.md § 4b)

export const SHOW_WHEN_TYPES = [
  'has_attribute', 'not_has_attribute', 'has_entitlement',
  'activity_completed', 'activity_not_completed', 'activity_play_count',
] as const
export type ShowWhenType = (typeof SHOW_WHEN_TYPES)[number]

export const SHOW_WHEN_NAME: Record<ShowWhenType, string> = {
  has_attribute: 'ต้องมีค่าประจำตัว',
  not_has_attribute: 'ต้องไม่มีค่าประจำตัว',
  has_entitlement: 'ต้องถือสิทธิ์รางวัล',
  activity_completed: 'ต้องเล่นกิจกรรมอื่นจบแล้ว',
  activity_not_completed: 'ต้องยังไม่เล่นกิจกรรมอื่น',
  activity_play_count: 'ต้องเล่นกิจกรรมอื่นครบจำนวน',
}

export const asShowWhenType = (raw: string | undefined | null): ShowWhenType | null =>
  (SHOW_WHEN_TYPES as readonly string[]).includes(raw ?? '') ? (raw as ShowWhenType) : null

export type ShowWhenControl = 'text' | 'reward' | 'activity' | 'op' | 'number'

export type ShowWhenField = {
  key: string
  label: string
  control: ShowWhenControl
  required: boolean
  hint?: string
}

export const SHOW_WHEN_FIELDS: Record<ShowWhenType, ShowWhenField[]> = {
  has_attribute: [
    { key: 'key', label: 'ชื่อค่าประจำตัว', control: 'text', required: true },
    {
      key: 'value', label: 'ต้องเท่ากับ', control: 'text', required: false,
      hint: 'เว้นว่าง = มีค่าประจำตัวนี้อยู่ก็พอ ไม่สนว่าค่าเป็นอะไร',
    },
  ],
  not_has_attribute: [
    { key: 'key', label: 'ชื่อค่าประจำตัว', control: 'text', required: true },
  ],
  has_entitlement: [
    { key: 'rewardCode', label: 'รางวัลที่ต้องถืออยู่', control: 'reward', required: true },
  ],
  activity_completed: [
    { key: 'activityCode', label: 'กิจกรรมที่ต้องเล่นจบแล้ว', control: 'activity', required: true },
  ],
  activity_not_completed: [
    { key: 'activityCode', label: 'กิจกรรมที่ต้องยังไม่เล่น', control: 'activity', required: true },
  ],
  activity_play_count: [
    { key: 'activityCode', label: 'กิจกรรมที่นับจำนวนครั้ง', control: 'activity', required: true },
    { key: 'op', label: 'เทียบแบบไหน', control: 'op', required: true },
    { key: 'count', label: 'จำนวนครั้ง', control: 'number', required: true },
  ],
}

export const SHOW_WHEN_OPS: Array<{ value: 'lt' | 'gte'; label: string }> = [
  { value: 'gte', label: 'ครบแล้วอย่างน้อย' },
  { value: 'lt', label: 'ยังไม่ถึง' },
]

/** ฟ้องข้อความเดียวเมื่อช่องบังคับของเงื่อนไขชนิดนี้ว่าง · null คือกรอกครบ */
export function validateConditionValues(
  type: ShowWhenType,
  values: Record<string, string>,
): string | null {
  for (const field of SHOW_WHEN_FIELDS[type]) {
    if (field.required && (values[field.key] ?? '').trim() === '') {
      return `${SHOW_WHEN_NAME[type]} — ต้องกรอก "${field.label}"`
    }
  }
  return null
}

/**
 * ค่าจากฟอร์มกลายเป็น `Condition` หนึ่งข้อ · เรียกหลัง `validateConditionValues`
 * คืน null แล้วเท่านั้น
 *
 * `has_attribute` ตัดคีย์ `value` ออกทั้งคีย์เมื่อเว้นว่าง ไม่ใช่ใส่สตริงว่าง — ตรงกับ
 * `evaluate()` ที่ตีความสองแบบนี้ต่างกัน (มีค่าอะไรก็ได้ vs ต้องเท่ากับสตริงว่าง)
 */
export function buildCondition(type: ShowWhenType, values: Record<string, string>): Condition {
  switch (type) {
    case 'has_attribute': {
      const key = values.key.trim()
      const value = (values.value ?? '').trim()
      return value === '' ? { type, key } : { type, key, value }
    }
    case 'not_has_attribute':
      return { type, key: values.key.trim() }
    case 'has_entitlement':
      return { type, rewardCode: values.rewardCode.trim() }
    case 'activity_completed':
      return { type, activityCode: values.activityCode.trim() }
    case 'activity_not_completed':
      return { type, activityCode: values.activityCode.trim() }
    case 'activity_play_count':
      return {
        type,
        activityCode: values.activityCode.trim(),
        op: values.op === 'lt' ? 'lt' : 'gte',
        count: Number(values.count) || 0,
      }
  }
}

// ── ส่วนที่ 1 ของสามส่วน ("ค่าของตัวเอง") — ที่เดียวที่อนุญาตให้ต่างกันตามชนิด ──────

/** สิ่งที่ฟอร์มของบล็อกหนึ่งอันส่งมา ไม่ว่าจะเป็นชนิดไหน — ฟิลด์ที่ไม่เกี่ยวเว้นว่างไว้ */
export type BlockSaveInput = {
  blockType: BlockType
  /** หัวข้อ/ข้อความ/คำบรรยาย/URL ภาพ/ป้ายบนปุ่ม แล้วแต่ชนิด */
  content: string
  /** เฉพาะ image · ใช้เป็นภาพหัวการ์ดแบบเต็มความกว้างหรือไม่ */
  fullTop: boolean
  /** เฉพาะ progress_bar */
  counter: string
  target: string
  /** เฉพาะ button */
  actionKind: string
  actionTarget: string
}

export type BlockSaveResult =
  | { ok: true; content: string | null; options: Record<string, unknown> | null }
  | { ok: false; reason: string }

/**
 * ฟอร์มของบล็อกหนึ่งอันกลายเป็นคู่ `content`/`options` ที่บันทึกได้
 *
 * นี่คือ "ค่าของตัวเอง" — ส่วนเดียวใน `BlockForm.tsx` ที่อนุญาตให้ต่างกันตามชนิดบล็อก
 * ตามที่ตัดสินใจไว้ (ดูหมายเหตุที่ `supportsContentSource`) ส่วนอีกสองส่วน
 * (สวิตช์ตามสถานะ กับ เงื่อนไขการแสดง) ใช้โค้ดเดียวกันทุกชนิด
 */
export function parseBlockSave(input: BlockSaveInput): BlockSaveResult {
  switch (input.blockType) {
    case 'divider':
    case 'spacer':
      // ไม่มีอะไรให้กรอก — สิ่งที่ผู้ใช้พิมพ์เข้ามา (ถ้ามี) ไม่ถูกเก็บ เพราะ
      // lib/render/flex.ts ไม่อ่าน content ของสองชนิดนี้เลย
      return { ok: true, content: null, options: null }

    case 'title':
    case 'body':
    case 'caption':
      // ปล่อยให้บันทึกข้อความว่างได้ — ผู้เขียนอาจกำลังล้างข้อความตัวอย่างออกก่อน
      // แล้วค่อยพิมพ์ใหม่ทีหลัง การบังคับห้ามว่างจะกันจังหวะนั้นไว้ไม่ให้บันทึก
      return { ok: true, content: input.content, options: null }

    case 'image': {
      const url = input.content.trim()
      if (!url) return { ok: false, reason: 'ต้องกรอก URL ของภาพ' }
      return {
        ok: true,
        content: url,
        options: input.fullTop ? { placement: 'full_top' } : null,
      }
    }

    case 'progress_bar': {
      const counter = input.counter.trim()
      if (!counter) return { ok: false, reason: 'ต้องเลือกค่าสะสมที่จะแสดงความคืบหน้า' }
      const target = Number(input.target)
      if (!Number.isFinite(target) || target <= 0) {
        return { ok: false, reason: 'เป้าหมายของแถบความคืบหน้าต้องเป็นจำนวนมากกว่า 0' }
      }
      return { ok: true, content: null, options: { counter, target } }
    }

    case 'button': {
      const label = input.content.trim()
      if (!label) return { ok: false, reason: 'ต้องกรอกข้อความบนปุ่ม' }

      const option = BUTTON_ACTION_OPTIONS.find((o) => o.value === input.actionKind)
      // ปิดไว้ที่ตัวเรนเดอร์ (BR-40 · ดูเหตุผลที่ BUTTON_ACTION_OPTIONS) — ปฏิเสธที่นี่
      // ด้วย ไม่ใช่พึ่งว่าจอไม่มีตัวเลือกให้กด เหมือนที่ createCard ปฏิเสธ imagemap
      if (!option || !option.open) {
        return { ok: false, reason: 'ต้องเลือกปลายทางของปุ่มจากตัวเลือกที่เปิดใช้งานอยู่' }
      }

      const target = input.actionTarget.trim()
      if (!target) return { ok: false, reason: 'ต้องกรอกปลายทางของปุ่ม' }

      return {
        ok: true,
        content: label,
        options: { action: buildButtonAction(option.value as ButtonActionKind, target) },
      }
    }
  }
}
