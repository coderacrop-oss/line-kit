import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeBytes } from '../assets/validate'
import type { Composition, ImageLayer, Layer, TextLayer } from './composition'
import { coverScale, OUTPUT_MAX_BYTES } from './fit'

/**
 * แปลงงานแต่งภาพหลายชั้นให้เป็นภาพเดียว — สิ่งที่เกิดขึ้นตอนกด "ใช้" บนจอ M4-S02
 * ทุกชั้นวาดเรียงจากล่างขึ้นบนตามลำดับในอาเรย์ (ดู lib/richmenu/composition.ts)
 * บนผืน canvas ขนาดจริงของเมนู (2500×1686 หรือ 2500×843) แล้วเข้ารหัสเป็น JPEG
 * ไฟล์เดียว — เส้นทางเดียวกับที่ lib/richmenu/fit.ts ใช้ตอนตัด/ย่อภาพเดี่ยวให้
 * พอดีผัง (ใช้ coverScale/OUTPUT_MAX_BYTES ร่วมกัน ไม่ประดิษฐ์กติกาความถูกต้องชุดที่สอง)
 */

const FONT_FAMILY = 'FlexSystemMenuFont'
const FONT_PATH = join(process.cwd(), 'assets/fonts/NotoSansThai-Variable.ttf')
let fontRegistered = false

/**
 * ลงทะเบียนฟอนต์ไทยครั้งเดียวต่อโปรเซส — เซิร์ฟเวอร์ (โดยเฉพาะ container บน
 * Vercel) ไม่มีฟอนต์ไทยติดเครื่องมาเป็นค่าเริ่มต้น ถ้าไม่ลงทะเบียนเอง ข้อความไทย
 * จะเรนเดอร์เป็นกล่องเปล่าเงียบๆ โดยที่หน้าจอแก้ไข (เบราว์เซอร์ ซึ่งมีฟอนต์ไทย
 * อยู่แล้ว) ไม่มีทางเห็นปัญหานี้เลย — ไฟล์เดียวครอบทั้งไทยและละติน/ตัวเลข พร้อม
 * น้ำหนักตัวอักษรแบบแปรผัน (variable font) จึงรองรับทั้งปกติและตัวหนาในไฟล์เดียว
 */
function ensureFontRegistered(): void {
  if (fontRegistered) return
  const bytes = readFileSync(FONT_PATH)
  GlobalFonts.register(bytes, FONT_FAMILY)
  fontRegistered = true
}

const QUALITY_STEPS = [85, 70, 55] as const

async function encodeWithQualityFallback(canvas: { encode: (f: 'jpeg', q: number) => Promise<Buffer> }): Promise<Uint8Array> {
  for (const quality of QUALITY_STEPS) {
    const buffer = await canvas.encode('jpeg', quality)
    if (buffer.byteLength <= OUTPUT_MAX_BYTES) return new Uint8Array(buffer)
  }
  throw new Error(
    `รวมภาพทุกชั้นเป็นไฟล์เดียวแล้ว ไฟล์ยังใหญ่เกินเพดาน ${describeBytes(OUTPUT_MAX_BYTES)} — ลดจำนวนภาพหรือใช้ภาพที่มีรายละเอียดน้อยกว่านี้`,
  )
}

/** จุดเริ่มวาดภาพภายในกล่องของชั้น ตามชนิดการครอบ (cover ตัดส่วนเกิน · contain ย่อให้พอดีไม่ตัด) */
function imageDrawRect(
  image: { width: number; height: number }, box: { x: number; y: number; width: number; height: number }, fit: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  const scale = fit === 'cover'
    ? coverScale(image, box)
    : Math.min(box.width / image.width, box.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}

async function drawImageLayer(
  ctx: SKRSContext2D, layer: ImageLayer, loadLayerImage: (assetId: string) => Promise<Uint8Array>,
): Promise<void> {
  const bytes = await loadLayerImage(layer.assetId)
  const image = await loadImage(bytes)
  const draw = imageDrawRect(image, layer, layer.fit)

  ctx.save()
  ctx.beginPath()
  ctx.rect(layer.x, layer.y, layer.width, layer.height)
  ctx.clip()
  ctx.drawImage(image, draw.x, draw.y, draw.width, draw.height)
  ctx.restore()
}

/**
 * ตัดข้อความเป็นหลายบรรทัดให้พอดีความกว้างกล่อง — ตัดทีละตัวอักษร ไม่ใช่ทีละคำ
 * เพราะภาษาไทยไม่มีช่องว่างคั่นคำ การตัดแบบอิงช่องว่างจะไม่ตัดบรรทัดยาวๆ ให้เลย
 */
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    const candidate = line + char
    if (line !== '' && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = char
    } else {
      line = candidate
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

function drawTextLayer(ctx: SKRSContext2D, layer: TextLayer): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(layer.x, layer.y, layer.width, layer.height)
  ctx.clip()

  ctx.font = `${layer.bold ? 'bold ' : ''}${layer.fontSize}px ${FONT_FAMILY}`
  ctx.fillStyle = layer.color
  ctx.textBaseline = 'top'
  ctx.textAlign = layer.align

  const anchorX = layer.align === 'left' ? layer.x : layer.align === 'right' ? layer.x + layer.width : layer.x + layer.width / 2
  const lineHeight = layer.fontSize * 1.4
  const lines = wrapText(ctx, layer.text, layer.width)
  lines.forEach((line, i) => ctx.fillText(line, anchorX, layer.y + i * lineHeight))

  ctx.restore()
}

async function drawLayer(
  ctx: SKRSContext2D, layer: Layer, loadLayerImage: (assetId: string) => Promise<Uint8Array>,
): Promise<void> {
  if (layer.type === 'image') return drawImageLayer(ctx, layer, loadLayerImage)
  return drawTextLayer(ctx, layer)
}

export type FlattenResult = { data: Uint8Array; mime: 'image/jpeg'; width: number; height: number }

/**
 * วาดพื้นหลังแล้วไล่วาดทุกชั้นจากล่างขึ้นบน คืนภาพ JPEG เดียวขนาดผืนของงานแต่งภาพนี้
 *
 * `loadLayerImage` รับเข้ามาจากผู้เรียกแทนที่จะผูกกับ assetStore()/ฐานข้อมูลตรงๆ
 * เพื่อให้ทดสอบได้ด้วยภาพจริงที่สร้างขึ้นในหน่วยความจำ (เหมือน lib/richmenu/fit.test.ts)
 * โดยไม่ต้องพึ่ง mock
 */
export async function flattenComposition(
  composition: Composition, loadLayerImage: (assetId: string) => Promise<Uint8Array>,
): Promise<FlattenResult> {
  ensureFontRegistered()

  const canvas = createCanvas(composition.canvasWidth, composition.canvasHeight)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = composition.background.color
  ctx.fillRect(0, 0, composition.canvasWidth, composition.canvasHeight)

  for (const layer of composition.layers) {
    await drawLayer(ctx, layer, loadLayerImage)
  }

  const data = await encodeWithQualityFallback(canvas)
  return { data, mime: 'image/jpeg', width: composition.canvasWidth, height: composition.canvasHeight }
}
