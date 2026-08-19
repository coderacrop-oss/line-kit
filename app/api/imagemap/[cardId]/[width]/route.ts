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
 *
 * ตั้ง preferredRegion ซ้ำตรงนี้ด้วยแม้ root layout (app/layout.tsx) ตั้งไว้ทั้งแอป
 * แล้ว — Route Handler ไม่ได้อยู่ใต้ต้นไม้ของ layout เหมือนหน้าเว็บทั่วไป เหตุผล
 * เดียวกับที่ app/api/line/webhook/route.ts ตั้งไว้ซ้ำ: เส้นทางนี้ถูกยิงสดจาก
 * เซิร์ฟเวอร์ของ LINE ทุกครั้งที่แสดงข้อความ อยู่ใกล้ทั้ง Supabase (ap-southeast-1)
 * และผู้เล่นในเอเชียเหมือนกัน
 */
export const preferredRegion = 'sin1'

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
