import { groupBlocks, type CardBlock } from './groups'
import { toFlexBubble, toFlexCarousel, type Theme } from './flex'
import { toPlainText } from './text'
import type { TapArea } from '../imagemap/regions'
import type { PlayerState } from '../state'

/**
 * ริชเมสเสจ (imagemap) ของการ์ดหนึ่งใบ อย่างที่ renderCard ต้องใช้ — ผู้เรียกโหลด
 * และประกอบ `baseUrl` เต็มเสร็จแล้วก่อนส่งเข้ามาที่นี่ (ตัวแปรตั้งค่าของระบบต่อด้วย
 * `/api/imagemap/{cardId}` — ดู lib/imagemap/url.ts) ไม่ใช่ให้ renderCard อ่านค่าตั้ง
 * ค่าของเครื่องเอง — renderCard เป็นฟังก์ชันบริสุทธิ์ตามเจตนาเดิมของไฟล์นี้ (ไม่แตะ
 * DB ไม่แตะตัวแปรของเครื่อง) และคนละที่ที่ประกอบ baseUrl แล้วลืมปิด "/" ท้ายให้ตรง
 * กันทุกครั้ง คือบั๊กที่เงียบที่สุดเท่าที่จะมีได้ในเส้นทางนี้
 */
/** วิดีโอที่เล่นทับภาพฐานของริชวิดีโอ (renderAs === 'imagemap_video' เท่านั้น) */
export type RenderableImagemapVideo = {
  url: string
  previewUrl: string
  area: { x: number; y: number; width: number; height: number }
  /** ลิงก์ที่โชว์หลังเล่นจบ — ไม่บังคับ (LINE เองไม่ได้บังคับ externalLink ของ ImagemapVideo) */
  externalLink?: { linkUri: string; label?: string }
}

export type RenderableImagemap = {
  baseUrl: string
  altText: string
  baseSize: { width: number; height: number }
  actions: TapArea[]
  /** เฉพาะ renderAs === 'imagemap_video' ที่ครบทั้งวิดีโอ · ภาพตัวอย่าง · พื้นที่เล่นแล้ว */
  video?: RenderableImagemapVideo
}

export type RenderableCard = {
  code: string
  renderAs: 'flex_bubble' | 'flex_carousel' | 'imagemap' | 'imagemap_video' | 'text'
  blocks: CardBlock[]
  /** children of a carousel, in swipe order */
  children?: RenderableCard[]
  /** เฉพาะ renderAs === 'imagemap'/'imagemap_video' ที่เคยกด "ใช้" สำเร็จแล้วอย่างน้อยหนึ่งครั้ง (ภาพฐาน) — undefined ทำให้ตกไปเป็นข้อความสำรอง (BR-01) */
  imagemap?: RenderableImagemap
}

export type LineImagemapAction =
  | { type: 'uri'; area: { x: number; y: number; width: number; height: number }; linkUri: string; label?: string }
  | { type: 'message'; area: { x: number; y: number; width: number; height: number }; text: string; label?: string }

export type LineImagemapVideo = {
  originalContentUrl: string
  previewImageUrl: string
  area: { x: number; y: number; width: number; height: number }
  externalLink?: { linkUri: string; label?: string }
}

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: object }
  | {
      type: 'imagemap'
      baseUrl: string
      altText: string
      baseSize: { width: number; height: number }
      actions: LineImagemapAction[]
      /** มีเฉพาะการ์ดริชวิดีโอที่วิดีโอพร้อมส่งจริงแล้ว — ไม่มีคีย์นี้เลยสำหรับริชเมสเสจภาพล้วน */
      video?: LineImagemapVideo
    }

/** Alt text is what a notification shows, so it must read as a sentence. */
function altTextFor(card: RenderableCard, state: PlayerState): string {
  const flat = toPlainText(groupBlocks(card.blocks, state), state)
  return flat.split('\n')[0].slice(0, 400)
}

/** พื้นที่กดหนึ่งจุดในรูปแบบของ store (lib/imagemap/regions.ts) → รูปแบบที่ LINE รับจริง */
function toLineImagemapAction(area: TapArea): LineImagemapAction {
  const rect = { x: area.x, y: area.y, width: area.width, height: area.height }
  const label = area.action.label ? { label: area.action.label } : {}
  if (area.action.type === 'uri') {
    return { type: 'uri', area: rect, linkUri: area.action.linkUri, ...label }
  }
  return { type: 'message', area: rect, text: area.action.text, ...label }
}

/** วิดีโอของริชวิดีโอในรูปแบบของ store → รูปแบบที่ LINE รับจริง (ImagemapVideo) */
function toLineImagemapVideo(video: RenderableImagemapVideo): LineImagemapVideo {
  const area = { x: video.area.x, y: video.area.y, width: video.area.width, height: video.area.height }
  return {
    originalContentUrl: video.url,
    previewImageUrl: video.previewUrl,
    area,
    ...(video.externalLink ? { externalLink: video.externalLink } : {}),
  }
}

/**
 * One card plus one player's state becomes one LINE message.
 *
 * Shapes not yet supported fall back to plain text rather than throwing. A
 * config that asks for a rich message before the renderer exists still answers
 * the player — silence is the one outcome BR-01 rules out.
 */
export function renderCard(
  card: RenderableCard,
  state: PlayerState,
  theme: Theme,
): LineMessage {
  if (card.renderAs === 'text') {
    return { type: 'text', text: toPlainText(groupBlocks(card.blocks, state), state) }
  }

  if (card.renderAs === 'imagemap' || card.renderAs === 'imagemap_video') {
    if (!card.imagemap) {
      // ยังไม่เคยกด "ใช้" ในตัวแก้ไข (ไม่มีภาพ 5 ขนาดให้ LINE ดึงเลย) — ตอบข้อความ
      // แทนที่จะส่ง imagemap message ที่พังกลางทาง เพราะ baseUrl ที่ไม่มีอะไรให้ดึง
      // จะทำให้ LINE แสดงกล่องภาพแตกในแชทของผู้เล่นจริง ซึ่งแย่กว่าข้อความเปล่า
      return { type: 'text', text: 'ริชเมสเสจใบนี้ยังไม่พร้อมส่ง — ยังไม่เคยกด "ใช้" ในตัวแก้ไขเลย' }
    }

    // ริชวิดีโอ (imagemap_video) ต้องมีทั้งวิดีโอ · ภาพตัวอย่าง · พื้นที่เล่นด้วย —
    // มีแค่ภาพฐานอย่างเดียว (เหมือนริชเมสเสจธรรมดา) ยังไม่ใช่ของที่คนตั้งค่าตั้งใจ
    // ส่งออกไป — ตอบข้อความสำรองเช่นกัน (BR-01) แทนที่จะส่งภาพเต็มใบไม่มีวิดีโอทั้ง
    // ที่เลือกชนิด "ริชวิดีโอ" ไว้
    if (card.renderAs === 'imagemap_video' && !card.imagemap.video) {
      return { type: 'text', text: 'ริชวิดีโอใบนี้ยังไม่พร้อมส่ง — อัปโหลดวิดีโอ ภาพตัวอย่าง และวางพื้นที่เล่นให้ครบก่อน' }
    }

    const video = card.renderAs === 'imagemap_video' && card.imagemap.video
      ? toLineImagemapVideo(card.imagemap.video) : undefined

    return {
      type: 'imagemap',
      baseUrl: card.imagemap.baseUrl,
      altText: card.imagemap.altText,
      baseSize: card.imagemap.baseSize,
      actions: card.imagemap.actions.map(toLineImagemapAction),
      ...(video ? { video } : {}),
    }
  }

  if (card.renderAs === 'flex_carousel') {
    const children = card.children ?? []
    const bubbles = (children.length > 0 ? children : [card]).map((child) =>
      toFlexBubble(groupBlocks(child.blocks, state), state, theme),
    )
    return { type: 'flex', altText: altTextFor(card, state), contents: toFlexCarousel(bubbles) }
  }

  return {
    type: 'flex',
    altText: altTextFor(card, state),
    contents: toFlexBubble(groupBlocks(card.blocks, state), state, theme),
  }
}
