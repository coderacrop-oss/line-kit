/**
 * รูปร่างของพื้นที่กดบนริชเมสเสจหนึ่งใบ — สิ่งที่เก็บอยู่ใน `card.tap_areas`
 * (L2 §5.2 v0.18/v0.19 · BR-47) พิกัดทุกจุดอยู่ในพิกัดอ้างอิงกว้าง 1040 เสมอ ไม่ว่า
 * ไคลเอนต์ LINE จะโชว์ภาพขนาดไหนจริง (240/300/460/700/1040) — ตรงกับ ImagemapArea
 * ของ LINE เองที่ยืนยันจาก source ของ line-bot-sdk-nodejs
 * (lib/messaging-api/model/imagemapArea.ts)
 *
 * รองรับแค่สองชนิดแอ็กชัน — uri กับ message — ตรงกับที่เอกสารเขียนไว้ตรงตัวว่า
 * "รองรับแค่ข้อความและลิงก์ ไม่มี postback (BR-47)" · ชนิด clipboard ที่ LINE มีอยู่
 * ไม่ได้อยู่ในสโคปนี้
 */

export const IMAGEMAP_REFERENCE_WIDTH = 1040

/** พิกัดพื้นที่กด · หน่วยพิกเซลของพิกัดอ้างอิง 1040 กว้าง */
export type TapRect = { x: number; y: number; width: number; height: number }

export type UriTapAction = { type: 'uri'; linkUri: string; label?: string }
export type MessageTapAction = { type: 'message'; text: string; label?: string }
export type TapAction = UriTapAction | MessageTapAction

export type TapArea = TapRect & { id: string; action: TapAction }

/** เล็กกว่านี้ลากปรับต่อแทบไม่ได้แล้ว และแทบมองไม่เห็นบนภาพจริงอยู่ดี — ค่าเดียวกับ MIN_LAYER_SIZE ของ Rich Menu Compositor */
export const MIN_AREA_SIZE = 10
/** เพดานของ LINE เอง — imagemap message รับ actions ได้ไม่เกิน 50 รายการ */
export const MAX_AREAS = 50
export const MAX_LABEL_LENGTH = 50
export const MAX_URI_LENGTH = 1000
export const MAX_TEXT_LENGTH = 400
export const MAX_ALT_TEXT_LENGTH = 400

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function validateRect(box: unknown, canvasHeight: number, label: string): string | null {
  if (typeof box !== 'object' || box === null) return `${label}: รูปร่างไม่ถูกต้อง`
  const b = box as Record<string, unknown>
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!isFiniteNumber(b[key])) return `${label}: ${key} ต้องเป็นตัวเลข`
  }
  const { x, y, width, height } = b as TapRect
  if (width < MIN_AREA_SIZE || height < MIN_AREA_SIZE) {
    return `${label}: เล็กเกินไป — ต้องกว้างและสูงอย่างน้อย ${MIN_AREA_SIZE}px`
  }
  if (x < 0 || y < 0 || x + width > IMAGEMAP_REFERENCE_WIDTH || y + height > canvasHeight) {
    return `${label}: พื้นที่อยู่นอกขอบภาพ`
  }
  return null
}

/** true เมื่อ URI ปลอดภัยพอจะส่งให้ LINE — LINE เองบังคับ http/https เท่านั้น */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateAction(raw: unknown, label: string): string | TapAction {
  if (typeof raw !== 'object' || raw === null) return `${label}: ไม่ได้ระบุการกระทำ`
  const a = raw as Record<string, unknown>

  const rawLabel = a.label
  if (rawLabel !== undefined && rawLabel !== null) {
    if (typeof rawLabel !== 'string') return `${label}: ป้ายกำกับต้องเป็นข้อความ`
    if (rawLabel.length > MAX_LABEL_LENGTH) return `${label}: ป้ายกำกับยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร`
  }
  const labelValue = typeof rawLabel === 'string' && rawLabel.trim() !== '' ? rawLabel : undefined

  if (a.type === 'uri') {
    if (typeof a.linkUri !== 'string' || a.linkUri.trim() === '') return `${label}: ยังไม่ได้ใส่ลิงก์ปลายทาง`
    if (a.linkUri.length > MAX_URI_LENGTH) return `${label}: ลิงก์ยาวเกิน ${MAX_URI_LENGTH} ตัวอักษร`
    if (!isHttpUrl(a.linkUri)) return `${label}: ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://`
    return { type: 'uri', linkUri: a.linkUri, ...(labelValue ? { label: labelValue } : {}) }
  }

  if (a.type === 'message') {
    if (typeof a.text !== 'string' || a.text.trim() === '') return `${label}: ยังไม่ได้ใส่ข้อความที่จะส่งกลับ`
    if (a.text.length > MAX_TEXT_LENGTH) return `${label}: ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร`
    return { type: 'message', text: a.text, ...(labelValue ? { label: labelValue } : {}) }
  }

  return `${label}: ชนิดการกระทำไม่รู้จัก — รองรับแค่ลิงก์ (uri) กับข้อความ (message)`
}

function validateArea(raw: unknown, canvasHeight: number, index: number): string | TapArea {
  const label = `พื้นที่ที่ ${index + 1}`
  if (typeof raw !== 'object' || raw === null) return `${label}: รูปร่างไม่ถูกต้อง`
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string' || r.id.length === 0) return `${label}: ไม่มี id`
  const boxError = validateRect(r, canvasHeight, label)
  if (boxError) return boxError
  const { id, x, y, width, height } = r as unknown as TapRect & { id: string }

  const action = validateAction(r.action, label)
  if (typeof action === 'string') return action

  return { id, x, y, width, height, action }
}

export type TapAreasResult =
  | { ok: true; areas: TapArea[] }
  | { ok: false; reason: string }

/**
 * ตรวจรูปร่างของพื้นที่กดทั้งชุดที่ส่งมาจากฟอร์ม/ไคลเอนต์ ก่อนบันทึกลง `card.tap_areas`
 *
 * `canvasHeight` คือความสูงจริงของภาพเมื่อกว้าง 1040 (ผันตามสัดส่วนภาพต้นฉบับ) —
 * ต้องรู้ค่านี้ก่อนถึงจะเช็คได้ว่าพื้นที่หลุดขอบภาพด้านล่างหรือไม่ ด้านกว้างอ้างอิง
 * คงที่ที่ 1040 เสมอตามสัญญาของ LINE
 */
export function validateTapAreas(raw: unknown, canvasHeight: number): TapAreasResult {
  if (!Array.isArray(raw)) return { ok: false, reason: 'รายการพื้นที่กดไม่ถูกต้อง' }
  if (raw.length > MAX_AREAS) return { ok: false, reason: `เกินเพดาน ${MAX_AREAS} พื้นที่ต่อภาพ (เพดานของ LINE เอง)` }

  const areas: TapArea[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const result = validateArea(raw[i], canvasHeight, i)
    if (typeof result === 'string') return { ok: false, reason: result }
    if (seenIds.has(result.id)) return { ok: false, reason: `id ของพื้นที่ซ้ำกัน: ${result.id}` }
    seenIds.add(result.id)
    areas.push(result)
  }

  return { ok: true, areas }
}

export type AltTextResult = { ok: true; altText: string } | { ok: false; reason: string }

/** ข้อความสำรอง (altText) ที่ LINE โชว์ตอนแจ้งเตือน — imagemap message บังคับให้มีเสมอ ห้ามว่าง */
export function validateAltText(raw: unknown): AltTextResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'ยังไม่ได้ใส่ข้อความสำรอง (alt text) — LINE บังคับให้ริชเมสเสจทุกใบมีข้อความนี้' }
  }
  if (raw.length > MAX_ALT_TEXT_LENGTH) {
    return { ok: false, reason: `ข้อความสำรองยาวเกิน ${MAX_ALT_TEXT_LENGTH} ตัวอักษร` }
  }
  return { ok: true, altText: raw }
}
