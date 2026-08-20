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

/**
 * ตรวจกรอบสี่เหลี่ยมหนึ่งกรอบว่าอยู่ในภาพไหม — ใช้ร่วมกันทั้งพื้นที่กด (TapArea)
 * และพื้นที่เล่นวิดีโอของริชวิดีโอ (lib/imagemap/video.ts) เพราะกฎเรื่องขอบเขต/
 * ขนาดขั้นต่ำเป็นกฎเดียวกันเป๊ะ — ส่งออกไว้แทนที่จะให้ video.ts ประดิษฐ์ชุดที่สอง
 */
export function validateRect(box: unknown, canvasHeight: number, label: string): string | null {
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

/**
 * true เมื่อ URI ปลอดภัยพอจะส่งให้ LINE — LINE เองบังคับ http/https เท่านั้น
 * ส่งออกไว้ให้ lib/imagemap/video.ts ใช้ตรวจลิงก์หลังเล่นจบของริชวิดีโอด้วย —
 * กฎเดียวกันเป๊ะกับลิงก์ของพื้นที่กดชนิด uri
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * `strict=false` (โหมดร่าง) ปล่อยให้ลิงก์/ข้อความว่างได้ — ระหว่างลากวาดพื้นที่
 * (autosave ทุกเจสเจอร์) คนตั้งค่าอาจยังพิมพ์ปลายทางไม่เสร็จ หรือเพิ่งสลับชนิดแอ็กชัน
 * มาแล้วยังไม่ทันพิมพ์อะไรเลย บังคับให้ครบตั้งแต่ตอนนั้นเท่ากับบันทึกร่างไม่ได้เลย
 * ทั้งที่กำลังลากอย่างอื่นอยู่ (เช่นแค่ขยับตำแหน่ง ไม่ได้แตะช่องนี้เลยด้วยซ้ำ) —
 * เจอบั๊กนี้จริงจากการทดสอบผ่านเบราว์เซอร์จริง (Playwright) ไม่ใช่แค่คาดเดา
 * `strict=true` (โหมดกด "ใช้") บังคับครบทุกอย่างตามที่ LINE ต้องการจริง
 */
function validateAction(raw: unknown, label: string, strict: boolean): string | TapAction {
  if (typeof raw !== 'object' || raw === null) return `${label}: ไม่ได้ระบุการกระทำ`
  const a = raw as Record<string, unknown>

  const rawLabel = a.label
  if (rawLabel !== undefined && rawLabel !== null) {
    if (typeof rawLabel !== 'string') return `${label}: ป้ายกำกับต้องเป็นข้อความ`
    if (rawLabel.length > MAX_LABEL_LENGTH) return `${label}: ป้ายกำกับยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร`
  }
  const labelValue = typeof rawLabel === 'string' && rawLabel.trim() !== '' ? rawLabel : undefined

  if (a.type === 'uri') {
    if (typeof a.linkUri !== 'string') return `${label}: ลิงก์ปลายทางต้องเป็นข้อความ`
    if (strict && a.linkUri.trim() === '') return `${label}: ยังไม่ได้ใส่ลิงก์ปลายทาง`
    if (a.linkUri.length > MAX_URI_LENGTH) return `${label}: ลิงก์ยาวเกิน ${MAX_URI_LENGTH} ตัวอักษร`
    if (a.linkUri.trim() !== '' && !isHttpUrl(a.linkUri)) return `${label}: ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://`
    return { type: 'uri', linkUri: a.linkUri, ...(labelValue ? { label: labelValue } : {}) }
  }

  if (a.type === 'message') {
    if (typeof a.text !== 'string') return `${label}: ข้อความที่จะส่งกลับต้องเป็นข้อความ`
    if (strict && a.text.trim() === '') return `${label}: ยังไม่ได้ใส่ข้อความที่จะส่งกลับ`
    if (a.text.length > MAX_TEXT_LENGTH) return `${label}: ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร`
    return { type: 'message', text: a.text, ...(labelValue ? { label: labelValue } : {}) }
  }

  return `${label}: ชนิดการกระทำไม่รู้จัก — รองรับแค่ลิงก์ (uri) กับข้อความ (message)`
}

function validateArea(raw: unknown, canvasHeight: number, index: number, strict: boolean): string | TapArea {
  const label = `พื้นที่ที่ ${index + 1}`
  if (typeof raw !== 'object' || raw === null) return `${label}: รูปร่างไม่ถูกต้อง`
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string' || r.id.length === 0) return `${label}: ไม่มี id`
  const boxError = validateRect(r, canvasHeight, label)
  if (boxError) return boxError
  const { id, x, y, width, height } = r as unknown as TapRect & { id: string }

  const action = validateAction(r.action, label, strict)
  if (typeof action === 'string') return action

  return { id, x, y, width, height, action }
}

export type TapAreasResult =
  | { ok: true; areas: TapArea[] }
  | { ok: false; reason: string }

function validateTapAreasImpl(raw: unknown, canvasHeight: number, strict: boolean): TapAreasResult {
  if (!Array.isArray(raw)) return { ok: false, reason: 'รายการพื้นที่กดไม่ถูกต้อง' }
  if (raw.length > MAX_AREAS) return { ok: false, reason: `เกินเพดาน ${MAX_AREAS} พื้นที่ต่อภาพ (เพดานของ LINE เอง)` }

  const areas: TapArea[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const result = validateArea(raw[i], canvasHeight, i, strict)
    if (typeof result === 'string') return { ok: false, reason: result }
    if (seenIds.has(result.id)) return { ok: false, reason: `id ของพื้นที่ซ้ำกัน: ${result.id}` }
    seenIds.add(result.id)
    areas.push(result)
  }

  return { ok: true, areas }
}

/**
 * ตรวจรูปร่างของพื้นที่กดทั้งชุดก่อนกด "ใช้" จริง — บังคับครบทุกอย่าง (ลิงก์/ข้อความ
 * ต้องไม่ว่าง) ตามที่ LINE ต้องการก่อนจะปั้นภาพและส่งได้จริง
 *
 * `canvasHeight` คือความสูงจริงของภาพเมื่อกว้าง 1040 (ผันตามสัดส่วนภาพต้นฉบับ) —
 * ต้องรู้ค่านี้ก่อนถึงจะเช็คได้ว่าพื้นที่หลุดขอบภาพด้านล่างหรือไม่ ด้านกว้างอ้างอิง
 * คงที่ที่ 1040 เสมอตามสัญญาของ LINE
 */
export function validateTapAreas(raw: unknown, canvasHeight: number): TapAreasResult {
  return validateTapAreasImpl(raw, canvasHeight, true)
}

/**
 * ตรวจรูปร่างของพื้นที่กดทั้งชุดตอนบันทึกร่าง (autosave ระหว่างลากวาด) — กฎเรื่อง
 * กรอบ/ประเภท/เพดานต่างๆ เหมือนกันทุกอย่างกับ validateTapAreas ยกเว้นข้อเดียว:
 * ลิงก์/ข้อความปล่อยว่างได้ชั่วคราว เพราะระหว่างลากยังไม่ต้องพิมพ์ปลายทางให้เสร็จ
 */
export function validateTapAreasDraft(raw: unknown, canvasHeight: number): TapAreasResult {
  return validateTapAreasImpl(raw, canvasHeight, false)
}

export type AltTextResult = { ok: true; altText: string } | { ok: false; reason: string }

/**
 * ข้อความสำรอง (altText) ระหว่างร่าง — ยังปล่อยว่างได้ เพราะระหว่างวาดพื้นที่กด
 * (autosave ทุกเจสเจอร์) คนตั้งค่ายังไม่ทันได้เขียนข้อความนี้เลยก็ได้ บังคับตอนนี้
 * เท่ากับบันทึกร่างไม่ได้เลยจนกว่าจะเขียนข้อความก่อน ซึ่งขวางทางลากวาดโดยไม่จำเป็น
 * — ด่านที่บังคับให้ต้องไม่ว่างจริงๆ อยู่ที่ validateAltText (เรียกตอนกด "ใช้" เท่านั้น)
 */
export function validateAltTextDraft(raw: unknown): AltTextResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'ข้อความสำรองต้องเป็นข้อความ' }
  if (raw.length > MAX_ALT_TEXT_LENGTH) {
    return { ok: false, reason: `ข้อความสำรองยาวเกิน ${MAX_ALT_TEXT_LENGTH} ตัวอักษร` }
  }
  return { ok: true, altText: raw }
}

/** ข้อความสำรอง (altText) ที่ LINE โชว์ตอนแจ้งเตือน — imagemap message บังคับให้มีเสมอ ห้ามว่าง (บังคับเฉพาะตอนกด "ใช้") */
export function validateAltText(raw: unknown): AltTextResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'ยังไม่ได้ใส่ข้อความสำรอง (alt text) — LINE บังคับให้ริชเมสเสจทุกใบมีข้อความนี้' }
  }
  if (raw.length > MAX_ALT_TEXT_LENGTH) {
    return { ok: false, reason: `ข้อความสำรองยาวเกิน ${MAX_ALT_TEXT_LENGTH} ตัวอักษร` }
  }
  return { ok: true, altText: raw }
}

/**
 * พื้นที่เล่นวิดีโอของริชวิดีโอ (imagemap_video) — สี่เหลี่ยมหนึ่งกรอบ พิกัดอ้างอิง
 * เดียวกับพื้นที่กด (กว้าง 1040) แต่ไม่ใช่พื้นที่กด (ไม่มี action) จึงไม่ผ่าน
 * validateTapAreas — ใช้ validateRect กฎเดียวกันตรงๆ ไม่ประดิษฐ์ชุดที่สอง
 *
 * `null` เป็นค่าที่ถูกต้อง — การ์ดที่ยังไม่เคยวางพื้นที่เล่นวิดีโอเลย (อัปโหลดวิดีโอ
 * แต่ยังไม่ได้ลากวางตำแหน่ง) ไม่ใช่ความผิดพลาด renderCard() ตกไปเป็นข้อความสำรองเอง
 * เมื่อพื้นที่นี้ยังไม่มี (BR-01) ไม่มีโหมด strict/draft แยกกันเหมือน TapArea เพราะ
 * ไม่มีสถานะกลางทางที่ต้อง "ปล่อยว่างชั่วคราว" — ค่าที่ส่งมามีแค่สองแบบ: ไม่มีเลย
 * (null) หรือมีและต้องถูกต้องตามกฎกรอบเดียวกันเสมอ
 */
export type VideoAreaResult = { ok: true; area: TapRect | null } | { ok: false; reason: string }

export function validateVideoArea(raw: unknown, canvasHeight: number): VideoAreaResult {
  if (raw === null || raw === undefined) return { ok: true, area: null }
  const label = 'พื้นที่เล่นวิดีโอ'
  const boxError = validateRect(raw, canvasHeight, label)
  if (boxError) return { ok: false, reason: boxError }
  const { x, y, width, height } = raw as TapRect
  return { ok: true, area: { x, y, width, height } }
}

/**
 * ลิงก์ที่โชว์หลังวิดีโอเล่นจบ (ImagemapExternalLink ของ LINE) — ต่างจากลิงก์ของ
 * พื้นที่กด (uri action) ตรงที่ "ไม่บังคับต้องมี" เลย (LINE ไม่ได้ประกาศ externalLink
 * ไว้ใน required ของ ImagemapVideo — ยืนยันจาก line/line-openapi:messaging-api.yml)
 * ปล่อยว่างได้เสมอทั้งร่างและตอนกด "ใช้" — ไม่มีโหมด strict เพราะไม่มีอะไรบังคับ
 * ให้ต้องกรอก มีแค่กฎว่าถ้ากรอกแล้วต้องเป็นลิงก์ http/https จริง
 */
export type VideoExternalLinkResult =
  | { ok: true; linkUri: string; label: string } | { ok: false; reason: string }

export function validateVideoExternalLink(rawUri: unknown, rawLabel: unknown): VideoExternalLinkResult {
  if (typeof rawUri !== 'string') return { ok: false, reason: 'ลิงก์หลังเล่นจบต้องเป็นข้อความ' }
  if (typeof rawLabel !== 'string') return { ok: false, reason: 'ป้ายกำกับลิงก์หลังเล่นจบต้องเป็นข้อความ' }
  if (rawUri.length > MAX_URI_LENGTH) return { ok: false, reason: `ลิงก์หลังเล่นจบยาวเกิน ${MAX_URI_LENGTH} ตัวอักษร` }
  if (rawLabel.length > MAX_LABEL_LENGTH) {
    return { ok: false, reason: `ป้ายกำกับลิงก์หลังเล่นจบยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร` }
  }
  if (rawUri.trim() !== '' && !isHttpUrl(rawUri)) {
    return { ok: false, reason: 'ลิงก์หลังเล่นจบต้องขึ้นต้นด้วย http:// หรือ https://' }
  }
  return { ok: true, linkUri: rawUri, label: rawLabel }
}
