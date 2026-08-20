import { createHash } from 'node:crypto'
import { assetStore } from '@/lib/assets/store'
import { isImagemapWidth } from '@/lib/imagemap/sizes'
import { resolveImagemapVariantAsset } from '@/lib/db/card-imagemap'
import { db } from '@/lib/db/client'

/**
 * เสิร์ฟภาพหนึ่งขนาดของริชเมสเสจให้ LINE — LINE เรียกที่นี่เอง (ไม่ใช่ผู้เล่นหรือ
 * เบราว์เซอร์แอดมิน) ทุกครั้งที่ต้องแสดงการ์ดริชเมสเสจใบนี้ ตามที่ `baseUrl` ใน
 * ImagemapMessage บอกไว้ (`{baseUrl}/{width}` — ไม่มีนามสกุลไฟล์ ไม่มี query string
 * แนบมาด้วยเลย ยืนยันจาก source ของ line-bot-sdk-nodejs) เร็วเท่าที่ทำได้จึงเป็น
 * ข้อกำหนดจริง ไม่ใช่ทางเลือก — ภาพทั้งห้าขนาดถูกปั้นไว้ล่วงหน้าแล้วตอนกด "ใช้"
 * (lib/imagemap/sizes.ts) เส้นทางนี้แค่หา asset ที่ตรงแล้วสตรีมไบต์กลับ ไม่มีการ
 * ประมวลผลภาพสดที่นี่เลย
 */

/**
 * แคชได้แต่ไม่ตลอดกาล — URL นี้คงที่ตาม cardId เดียว (LINE ไม่มีทางแนบเวอร์ชันหรือ
 * query string มาด้วยเอง) แต่เนื้อหาข้างในเปลี่ยนได้ทุกครั้งที่กด "ใช้" ใหม่ในตัวแก้ไข
 * — ถ้าตั้ง immutable ไว้ แคชกลาง (CDN/proxy) ที่เก็บภาพเก่าไว้จะไม่มีวันรู้ว่ามีของ
 * ใหม่มาแทนแล้ว ผู้เล่นเห็นภาพเก่าตลอดไปทั้งที่แก้แล้ว จึงตั้งอายุแคชสั้นพอที่จะ
 * เห็นของใหม่ได้ในเวลาที่สมเหตุสมผล แต่ยาวพอที่การเรียกซ้ำถี่ๆ ของ LINE จะไม่ต้อง
 * ยิงมาถึงเซิร์ฟเวอร์เราทุกครั้ง — ETag ผูกกับ storage_path ของไฟล์จริง (เปลี่ยนทุก
 * ครั้งที่กด "ใช้" ใหม่ เพราะไม่เคยเขียนทับไฟล์เดิม — BR-25) ทำให้ตรวจสอบด้วย
 * conditional GET ได้แม่นยำระหว่างนั้น
 */
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=60'

const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png' }

/** card_id เป็นคอลัมน์ UUID จริง — ค่าที่รูปร่างไม่ใช่ UUID เลยต้องกันไว้ตั้งแต่ก่อนยิง SQL */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cardId: string; width: string }> },
): Promise<Response> {
  const { cardId, width: rawWidth } = await params

  // ต้องเป็นเลขจำนวนเต็มล้วนหนึ่งในห้าค่านี้เป๊ะๆ — ปฏิเสธอย่างอื่นทั้งหมดด้วย 404
  // เดียวกับกรณี "ไม่พบไฟล์" เพราะจากมุมของผู้ที่เรียกมา (LINE เอง) มันคือสิ่งเดียวกัน
  if (!/^\d+$/.test(rawWidth)) return new Response('not found', { status: 404 })
  const width = Number(rawWidth)
  if (!isImagemapWidth(width)) return new Response('not found', { status: 404 })

  // cardId ที่รูปร่างไม่ใช่ UUID เลย (พิมพ์มั่ว/URL แต่งเอง) ต้องได้ 404 สะอาดๆ
  // เหมือนกัน ไม่ใช่ 500 ดิบจาก Postgres — เจอจริงตอนทดสอบมือกับเซิร์ฟเวอร์จริง
  // (ทุกเทสต์อัตโนมัติของไฟล์นี้ mock resolveImagemapVariantAsset ไว้ จึงไม่เคยยิง
  // SQL จริงที่จะเจอ "invalid input syntax for type uuid" เข้าเลยสักที)
  if (!UUID_PATTERN.test(cardId)) return new Response('not found', { status: 404 })

  const resolved = await resolveImagemapVariantAsset(db(), cardId, width)
  if (!resolved) return new Response('not found', { status: 404 })

  const mime = MIME_TO_EXT[resolved.mimeType] ? resolved.mimeType : 'application/octet-stream'
  const etag = `"${createHash('sha1').update(resolved.storagePath).digest('hex')}"`

  const bytes = await assetStore().get(resolved.storagePath)
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
    },
  })
}
