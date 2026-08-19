import { MAX_LENGTH } from '../match/postback'

/**
 * ปุ่มบน Rich Menu ที่ชี้ไปกิจกรรมหรือการ์ด — payload คนละรูปแบบกับปุ่มบนการ์ด
 * (`lib/match/postback.ts`) โดยตั้งใจ
 *
 * ปุ่มบนการ์ดมีคีย์ `d` (period key ของวันที่การ์ดถูกออก) เพื่อจับ "แตะการ์ดเก่าข้ามวัน"
 * — แต่เมนูแขวนอยู่ในแชทถาวร ไม่ได้ "ออก" ในวันใดวันหนึ่งเหมือนการ์ด จึงไม่มี `d` ที่มี
 * ความหมายจริงให้ใส่ การยัด `d` ปลอมๆ เข้าไปเพื่อให้ผ่าน `decodePostback` จะพาความหมาย
 * "การ์ดหมดอายุ" ไปใช้ผิดที่ (ดู lib/webhook/handle.ts และ lib/richmenu/areas.ts สำหรับ
 * ที่มาของบั๊กเดิม: ปุ่มเมนูสร้าง query string เองโดยไม่ผ่าน encoder ตัวไหนเลย ทำให้
 * decodePostback ปฏิเสธเสมอ ตอบ "ระบบขัดข้อง" ทุกครั้งที่กด)
 *
 * คีย์ `rm=1` เป็นตัวบอกชนิดที่ทำให้สอง decoder แยกจากกันเด็ดขาด:
 *  - ปุ่มบนการ์ดไม่มีคีย์ `rm` เลย → `decodeRichMenuPostback` ปฏิเสธเสมอ
 *  - ปุ่มเมนูไม่มีคีย์ `d`/`r`/`p` และมีคีย์ `rm` ที่ `decodePostback` ไม่รู้จัก → ปฏิเสธเสมอ
 * จึง fall through ไปมาระหว่างสอง decoder ได้อย่างปลอดภัย ไม่มีทางที่ payload หนึ่งจะ
 * ถูกทั้งสองฝั่งรับพร้อมกัน หรือถูกทั้งสองฝั่งปฏิเสธพร้อมกัน
 */
export type RichMenuPostback = {
  /** รหัสแคมเปญ — เมนูที่แขวนไว้ก่อนแคมเปญถูกแทนที่ยังอยู่ในแชทของผู้เล่นได้ */
  c: string
  /** รหัสกิจกรรม — ใส่เมื่อช่องนี้ชี้ไปกิจกรรม (ห้ามใส่พร้อม card) */
  a?: string
  /** id ของการ์ด — ใส่เมื่อช่องนี้ชี้ไปการ์ด (ห้ามใส่พร้อม a) */
  card?: string
}

const KEYS = ['rm', 'c', 'a', 'card'] as const

export function encodeRichMenuPostback(p: RichMenuPostback): string {
  if ((p.a === undefined) === (p.card === undefined)) {
    throw new Error('rich menu postback ต้องมี a หรือ card อย่างใดอย่างหนึ่งเท่านั้น ไม่ใช่ทั้งคู่หรือไม่มีเลย')
  }

  const parts = ['rm=1', `c=${encodeURIComponent(p.c)}`]
  if (p.a !== undefined) parts.push(`a=${encodeURIComponent(p.a)}`)
  if (p.card !== undefined) parts.push(`card=${encodeURIComponent(p.card)}`)
  const encoded = parts.join('&')

  // เช็คตอนสร้างปุ่ม ไม่ใช่ตอนส่งขึ้น LINE — ปุ่มยาวเกินที่ส่งไปแล้วจะเงียบไม่มีคำอธิบาย
  if (encoded.length > MAX_LENGTH) {
    throw new Error(
      `rich menu postback is ${encoded.length} characters, over LINE's limit of ${MAX_LENGTH}`,
    )
  }
  return encoded
}

export function decodeRichMenuPostback(raw: string): RichMenuPostback | null {
  if (!raw) return null

  const out: Record<string, string> = {}
  for (const pair of raw.split('&')) {
    const index = pair.indexOf('=')
    if (index < 1) return null
    const key = pair.slice(0, index)
    if (!(KEYS as readonly string[]).includes(key)) return null
    out[key] = decodeURIComponent(pair.slice(index + 1))
  }

  // rm=1 คือลายเซ็นของรูปแบบนี้ — ไม่มีมันแปลว่านี่ไม่ใช่ปุ่มเมนู (อาจเป็นปุ่มบนการ์ด)
  if (out.rm !== '1') return null
  if (!out.c) return null
  // ต้องมี a หรือ card อย่างใดอย่างหนึ่งเท่านั้น — สองอย่างพร้อมกันหรือไม่มีเลยไม่ใช่ payload ที่เรารู้จัก
  if ((out.a === undefined) === (out.card === undefined)) return null

  const result: RichMenuPostback = { c: out.c }
  if (out.a !== undefined) result.a = out.a
  if (out.card !== undefined) result.card = out.card
  return result
}
