import { describeBytes, IMAGE_MAX_BYTES, IMAGE_MIME_TYPES } from '../assets/validate'
import { MENU_CANVAS } from './layouts'

/**
 * รูปร่างของงานแต่งภาพก่อนกด "ใช้" — ยังไม่ใช่ภาพเมนูจริง แค่คำอธิบายว่าจะวางอะไร
 * ตรงไหน ค่อยแปลงเป็นภาพเดียวตอนกด "ใช้" (lib/richmenu/compose.ts:flattenComposition)
 *
 * ลำดับในอาเรย์ `layers` คือลำดับชั้น (ล่างสุดอยู่ index 0) — ไม่มีฟิลด์ z แยก
 * ต่างหาก ด้วยเหตุผลเดียวกับที่ rich_menu.areas ไม่มีฟิลด์ลำดับแยกจากตำแหน่งใน
 * อาเรย์ (ดู lib/richmenu/areas.ts) — ที่เดียวที่บอกความจริง ไม่ต้องคอยเช็คว่าลำดับ
 * อาเรย์กับเลข z ตรงกันไหม
 */

export type LayerBase = { id: string; x: number; y: number; width: number; height: number }

export type ImageLayer = LayerBase & {
  type: 'image'
  /** อ้างถึงแถวใน asset — ต้องเป็นของแคมเปญเดียวกัน ตรวจที่ชั้น DB ไม่ใช่ที่นี่ (ไฟล์นี้ไม่แตะฐานข้อมูล) */
  assetId: string
  fit: 'cover' | 'contain'
}

export type TextLayer = LayerBase & {
  type: 'text'
  text: string
  fontSize: number
  /** hex หกหลักเสมอ เช่น #17756A — ไม่รับชื่อสี เพื่อให้ผลลัพธ์ตรงกันทั้งจอแก้ไขกับตอน flatten จริง */
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
}

export type Layer = ImageLayer | TextLayer

export type Background = { type: 'color'; color: string }

export type Composition = {
  canvasWidth: number
  canvasHeight: number
  background: Background
  layers: Layer[]
}

/** เพดานจำนวนชั้น — กันทั้งการใช้งานผิดปกติและเวลา flatten ที่ยืดยาวเกินจำเป็น */
export const MAX_LAYERS = 30
export const MAX_TEXT_LENGTH = 200
/** เล็กกว่านี้ลากปรับต่อแทบไม่ได้แล้ว และมองไม่เห็นบนภาพจริงอยู่ดี */
export const MIN_LAYER_SIZE = 10
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 400
/** ผืนภาพขยายออกไปได้กี่เท่าตัว — ต้นแบบของ LINE เองยอมให้ลากภาพยื่นเลยขอบผืนได้บ้าง ไม่ใช่ห้ามเด็ดขาด */
const OVERFLOW_FACTOR = 2

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

/** ค่าเริ่มต้นของงานแต่งภาพใหม่ — พื้นขาวล้วน ยังไม่มีชั้นไหนเลย */
export function emptyComposition(canvas: { width: number; height: number }): Composition {
  return { canvasWidth: canvas.width, canvasHeight: canvas.height, background: { type: 'color', color: '#FFFFFF' }, layers: [] }
}

export type ValidationResult =
  | { ok: true; composition: Composition }
  | { ok: false; reason: string }

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function validateBox(box: unknown, canvas: { width: number; height: number }, label: string): string | null {
  if (typeof box !== 'object' || box === null) return `${label}: รูปร่างไม่ถูกต้อง`
  const b = box as Record<string, unknown>
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!isFiniteNumber(b[key])) return `${label}: ${key} ต้องเป็นตัวเลข`
  }
  const { x, y, width, height } = b as { x: number; y: number; width: number; height: number }
  if (width < MIN_LAYER_SIZE || height < MIN_LAYER_SIZE) {
    return `${label}: เล็กเกินไป — ต้องกว้างและสูงอย่างน้อย ${MIN_LAYER_SIZE}px`
  }
  const minX = -canvas.width * OVERFLOW_FACTOR
  const maxX = canvas.width * (1 + OVERFLOW_FACTOR)
  const minY = -canvas.height * OVERFLOW_FACTOR
  const maxY = canvas.height * (1 + OVERFLOW_FACTOR)
  if (x < minX || x > maxX || y < minY || y > maxY) return `${label}: ตำแหน่งอยู่ไกลจากผืนภาพเกินไป`
  if (width > canvas.width * (1 + OVERFLOW_FACTOR) || height > canvas.height * (1 + OVERFLOW_FACTOR)) {
    return `${label}: ใหญ่เกินผืนภาพมากเกินไป`
  }
  return null
}

function validateLayer(raw: unknown, canvas: { width: number; height: number }, index: number): string | Layer {
  const label = `ชั้นที่ ${index + 1}`
  if (typeof raw !== 'object' || raw === null) return `${label}: รูปร่างไม่ถูกต้อง`
  const l = raw as Record<string, unknown>

  if (typeof l.id !== 'string' || l.id.length === 0) return `${label}: ไม่มี id`
  const boxError = validateBox(l, canvas, label)
  if (boxError) return boxError
  const { id, x, y, width, height } = l as unknown as LayerBase

  if (l.type === 'image') {
    if (typeof l.assetId !== 'string' || l.assetId.length === 0) return `${label}: ไม่ได้ระบุภาพ`
    if (l.fit !== 'cover' && l.fit !== 'contain') return `${label}: ชนิดการครอบภาพไม่ถูกต้อง`
    return { id, x, y, width, height, type: 'image', assetId: l.assetId, fit: l.fit }
  }

  if (l.type === 'text') {
    if (typeof l.text !== 'string' || l.text.trim().length === 0) return `${label}: ยังไม่มีข้อความ`
    if (l.text.length > MAX_TEXT_LENGTH) return `${label}: ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร`
    if (!isFiniteNumber(l.fontSize) || l.fontSize < MIN_FONT_SIZE || l.fontSize > MAX_FONT_SIZE) {
      return `${label}: ขนาดตัวอักษรต้องอยู่ระหว่าง ${MIN_FONT_SIZE} ถึง ${MAX_FONT_SIZE}`
    }
    if (!isValidHexColor(l.color)) return `${label}: สีต้องเป็นรหัส hex เช่น #17756A`
    if (l.align !== 'left' && l.align !== 'center' && l.align !== 'right') return `${label}: การจัดแนวข้อความไม่ถูกต้อง`
    if (typeof l.bold !== 'boolean') return `${label}: ค่าตัวหนาไม่ถูกต้อง`
    return {
      id, x, y, width, height, type: 'text',
      text: l.text, fontSize: l.fontSize, color: l.color, align: l.align, bold: l.bold,
    }
  }

  return `${label}: ชนิดชั้นไม่รู้จัก`
}

/**
 * ตรวจรูปร่างของงานแต่งภาพที่ส่งมาจากฟอร์ม/ไคลเอนต์ ก่อนบันทึกลงฐานข้อมูล
 *
 * ไม่ตรวจว่า assetId มีอยู่จริงและเป็นของแคมเปญเดียวกันหรือไม่ที่นี่ — ไฟล์นี้ไม่แตะ
 * ฐานข้อมูล ด่านนั้นอยู่ที่ actions.ts/lib/db/richmenu-composition.ts แทน
 */
export function validateComposition(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'รูปร่างข้อมูลไม่ถูกต้อง' }
  const c = raw as Record<string, unknown>

  const canvasMatch = Object.values(MENU_CANVAS)
    .find((size) => size.width === c.canvasWidth && size.height === c.canvasHeight)
  if (!canvasMatch) return { ok: false, reason: 'ขนาดผืนภาพไม่ตรงกับที่ระบบรองรับ' }
  const canvas = { width: c.canvasWidth as number, height: c.canvasHeight as number }

  if (typeof c.background !== 'object' || c.background === null) return { ok: false, reason: 'พื้นหลังไม่ถูกต้อง' }
  const bg = c.background as Record<string, unknown>
  if (bg.type !== 'color' || !isValidHexColor(bg.color)) return { ok: false, reason: 'สีพื้นหลังต้องเป็นรหัส hex เช่น #FFFFFF' }

  if (!Array.isArray(c.layers)) return { ok: false, reason: 'รายการชั้นไม่ถูกต้อง' }
  if (c.layers.length > MAX_LAYERS) return { ok: false, reason: `เกินเพดาน ${MAX_LAYERS} ชั้น` }

  const layers: Layer[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < c.layers.length; i++) {
    const result = validateLayer(c.layers[i], canvas, i)
    if (typeof result === 'string') return { ok: false, reason: result }
    if (seenIds.has(result.id)) return { ok: false, reason: `id ของชั้นซ้ำกัน: ${result.id}` }
    seenIds.add(result.id)
    layers.push(result)
  }

  return {
    ok: true,
    composition: {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      background: { type: 'color', color: bg.color },
      layers,
    },
  }
}

export type LayerImageVerdict = { ok: true } | { ok: false; reason: string }

/**
 * ตรวจไฟล์ก่อนกลายเป็นภาพของหนึ่งชั้น — คนละกติกากับ validateUpload() ของคลังภาพ
 * ทั่วไป (lib/assets/validate.ts) โดยตั้งใจ: validateUpload บังคับกว้างอย่างน้อย
 * 800px เพราะออกแบบมาสำหรับภาพที่เป็น "ทั้งภาพ" ขยายเต็มความกว้างแชท (เมนู/การ์ด)
 * — ภาพของหนึ่งชั้นในตัวจัดวางนี้ถูกวางในกล่องขนาดเท่าไหร่ก็ได้ที่ผู้ใช้ลากปรับเอง
 * เอง อาจเป็นไอคอนเล็กๆ โดยตั้งใจ เพดานกว้างขั้นต่ำ 800px จะปฏิเสธของที่ใช้งานได้
 * จริงออกไปเงียบๆ — คงไว้แค่ชนิดไฟล์กับเพดานขนาดไบต์ ซึ่งเป็นกติกาที่สมเหตุสมผล
 * ไม่ว่าไฟล์จะถูกใช้เป็นภาพทั้งใบหรือภาพของหนึ่งชั้นก็ตาม
 */
export function validateLayerImageUpload(
  file: { mime: string; bytes: number; width: number; height: number },
): LayerImageVerdict {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mime)) {
    return { ok: false, reason: `ไฟล์ชนิด ${file.mime} ใช้ไม่ได้ — รับเฉพาะภาพ JPEG หรือ PNG` }
  }
  if (file.bytes <= 0) return { ok: false, reason: 'ไฟล์ว่าง ไม่มีข้อมูลอยู่ข้างใน — อัปโหลดใหม่อีกครั้ง' }
  if (file.width <= 0 || file.height <= 0) {
    return { ok: false, reason: 'อ่านขนาดของภาพในไฟล์นี้ไม่ออก — ไฟล์อาจเสียหายหรือไม่ใช่ชนิดที่บอกไว้' }
  }
  if (file.bytes > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ ${describeBytes(file.bytes)} เกินเพดาน ${describeBytes(IMAGE_MAX_BYTES)} — บีบอัดก่อนแล้วลองใหม่`,
    }
  }
  return { ok: true }
}
