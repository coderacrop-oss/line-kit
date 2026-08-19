import { type LayoutKey, layoutRects, type Rect } from './layouts'
import { encodeRichMenuPostback } from './postback'

/**
 * ปลายทางของช่องบนเมนู — สี่ชนิดที่จอ M4-S01 เปิดให้เลือกจริง (ต้นแบบ)
 *
 * L2 §5.3 (v0.30) นิยาม `rich_menu.areas[].action` ไว้ 6 แบบทั้งหมด: postback ·
 * richmenu_switch · postback+เปิดคีย์บอร์ด · datetimepicker · message · uri/clipboard
 * ต้นแบบของจอนี้ (flex-builder-prototype.html บรรทัด 1976-1998) เปิดให้เลือกแค่
 * "ไปกิจกรรม / ไปการ์ด / ไปเมนูอีกชุด / ไปลิงก์" — เป็นกลุ่มย่อยที่ตรงกับสิ่งที่
 * แคมเปญหนึ่งต้องใช้จริง ไม่ใช่ทุกความสามารถของ LINE · ยึดต้นแบบตามกติกา "ต้นแบบ
 * ชนะเมื่อหน้าตาขัดกัน" — 'activity' และ 'card' ต่างก็คือ action ชนิด postback
 * ของ LINE ('menu' คือ richmenu_switch · 'url' คือ uri) ดู toLineArea() ข้างล่าง
 */
export const AREA_KINDS = ['none', 'activity', 'card', 'menu', 'url'] as const
export type AreaKind = (typeof AREA_KINDS)[number]

export const asAreaKind = (raw: string | null | undefined): AreaKind =>
  (AREA_KINDS as readonly string[]).includes(raw ?? '') ? (raw as AreaKind) : 'none'

export type RichMenuArea = Rect & { kind: AreaKind; target: string | null }

/**
 * สร้างชุดช่องใหม่ตามผังที่เลือก · เก็บ kind/target ของเดิมไว้ตามตำแหน่ง (index)
 * เท่าที่ยังมีช่องเหลืออยู่ ช่องที่เกินมาใหม่เริ่มที่ "ไม่ชี้ไปไหน"
 *
 * ผู้ตั้งค่าที่กรอกไปครึ่งทางแล้วเปลี่ยนใจเรื่องผัง ไม่ควรต้องกรอกใหม่ทั้งหมด — แต่
 * ก็ไม่มีทางเดารู้ได้ว่าช่องที่ตำแหน่งเปลี่ยนไปควรจับคู่กับอะไร ตำแหน่งเดิมจึงเป็น
 * กติกาเดียวที่คาดเดาได้และทดสอบได้
 */
export function buildAreas(key: LayoutKey, existing: readonly RichMenuArea[] = []): RichMenuArea[] {
  return layoutRects(key).map((rect, index) => {
    const prior = existing[index]
    return { ...rect, kind: prior?.kind ?? 'none', target: prior?.target ?? null }
  })
}

/** จำนวนช่องที่ "ไม่ชี้ไปไหน" — ป้าย "N ช่องไม่ชี้ไปไหน" กับด่านบล็อกตอน publish ใช้ตัวนี้ตัวเดียวกัน */
export function countEmpty(areas: readonly RichMenuArea[]): number {
  return areas.filter((area) => area.kind === 'none').length
}

/** แก้ปลายทางของช่องหนึ่งช่อง · เปลี่ยนชนิดแล้วต้องล้าง target เดิมทิ้งเสมอ ปลายทางของ 'menu'/'url' ไม่ใช่รูปแบบเดียวกับ id ของกิจกรรม/การ์ด */
export function setAreaTarget(
  areas: readonly RichMenuArea[], index: number, kind: AreaKind, target: string | null,
): RichMenuArea[] {
  return areas.map((area, i) => (i === index ? { ...area, kind, target: kind === 'none' ? null : target } : area))
}

export type LineArea = {
  bounds: { x: number; y: number; width: number; height: number }
  action: Record<string, unknown>
}

export type AreaLineContext = {
  /** alias ของเมนูปลายทาง เมื่อ kind === 'menu' · target เก็บ id ของเมนู ไม่ใช่ alias */
  aliasByMenuId: Record<string, string>
  /** รหัสกิจกรรม เมื่อ kind === 'activity' · target เก็บ id ของกิจกรรม ไม่ใช่รหัส */
  activityCodeById: Record<string, string>
  /** รหัสแคมเปญ · ใส่ลง postback เดียวกับปุ่มบนการ์ด (BR-33 · BR-77) */
  campaignCode: string
}

/**
 * ช่องหนึ่งช่องกลายเป็น action ที่ส่งให้ LINE จริง · เรียกได้เฉพาะช่องที่ไม่ใช่
 * 'none' — `validateForPublish` เป็นด่านที่บล็อกช่องว่างไปแล้วก่อนจะมาถึงตรงนี้
 * ช่องว่างที่หลุดมาถึงนี่คือบั๊กของด่านตรวจ ไม่ใช่กรณีที่ควรเงียบแล้วข้ามไป
 *
 * 'activity' และ 'card' ใช้ action ชนิด postback เหมือนปุ่มบนการ์ด (BR-33 · BR-77)
 * แต่คนละรูปแบบ payload กัน: `lib/match/postback.ts` (`decodePostback`) ต้องการคีย์
 * `d` (period key ของวันที่การ์ดถูกออก) เสมอ เพื่อจับ "แตะการ์ดเก่าข้ามวัน" — ส่วนเมนู
 * แขวนอยู่ในแชทถาวร ไม่ได้ "ออก" ในวันใดวันหนึ่งเหมือนการ์ด จึงไม่มี `d` ที่มีความหมาย
 * จริงให้ใส่ ใช้ `lib/richmenu/postback.ts` (`encodeRichMenuPostback`) แทน — คนละ
 * รูปแบบ แยก decoder กันชัดเจนที่ `lib/webhook/handle.ts` ดูที่มาและกติกาการแยกทั้งหมด
 * ที่ `lib/richmenu/postback.ts`
 */
export function toLineArea(area: RichMenuArea, ctx: AreaLineContext): LineArea {
  const bounds = { x: area.x, y: area.y, width: area.width, height: area.height }

  if (area.kind === 'none' || !area.target) {
    throw new Error('ช่องที่ไม่ชี้ไปไหนส่งขึ้น LINE ไม่ได้ — ต้องผ่าน validateForPublish ก่อนเสมอ')
  }

  switch (area.kind) {
    case 'activity': {
      const code = ctx.activityCodeById[area.target]
      const data = encodeRichMenuPostback({ c: ctx.campaignCode, a: code ?? area.target })
      return { bounds, action: { type: 'postback', data } }
    }
    case 'card': {
      const data = encodeRichMenuPostback({ c: ctx.campaignCode, card: area.target })
      return { bounds, action: { type: 'postback', data } }
    }
    case 'menu': {
      const alias = ctx.aliasByMenuId[area.target]
      if (!alias) throw new Error(`ไม่พบ alias ของเมนูปลายทาง ${area.target}`)
      return { bounds, action: { type: 'richmenuswitch', richMenuAliasId: alias, data: 'richmenu-switch' } }
    }
    case 'url':
      return { bounds, action: { type: 'uri', uri: area.target } }
  }
}
