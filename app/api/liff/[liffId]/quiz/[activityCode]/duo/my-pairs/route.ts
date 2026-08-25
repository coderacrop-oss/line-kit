// app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { listQuizPairsForParticipant } from '@/lib/db/quizPairs'
import { strongestAxis } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

/**
 * ฝั่ง A (ผู้ชวน) ไม่เคยได้ผลลัพธ์เต็มกลับมาตอนแชร์ลิงก์ — เห็นแค่ shareUrl (§7 ขั้น A)
 * ทางเดียวที่ A เช็คผลย้อนหลังได้คือ endpoint นี้ ซึ่งเดิมคืนแค่ resultCode/title/asA/
 * createdAt ตามข้อความ plan Task 8 ตรงตัว — ขาด body/imageUrl/axis ทั้งที่ B ได้ครบจาก
 * POST .../duo/match แล้ว design spec เองก็ระบุไว้ชัดใน §1 (เกณฑ์ว่าสำเร็จ) ว่า "ได้
 * ผลลัพธ์รวมของทั้งคู่กลับมาทั้งสองฝั่ง" — แผนเองมีช่องโหว่ตรงนี้ นี่คือ deviation ที่
 * ตั้งใจจากข้อความ Task 8 (Finding 7 ของรีวิวรอบสุดท้าย) เพื่อให้เป้าหมายจริงของ spec
 * เป็นจริง ไม่ใช่การเบี่ยงเบนที่ไม่ได้ตั้งใจ
 */
export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const pairs = await listQuizPairsForParticipant(sql, activity.id, auth.participantId)
  const ruleByCode = new Map(activity.config.results.map((r) => [r.code, r]))

  return Response.json({
    pairs: pairs.map((p) => {
      const asA = p.participantA === auth.participantId
      // ทิศทางเดียวกับ duo/match/route.ts's isCallerSideB: scores.a คือของ A (inviter)
      // เสมอ scores.b คือของ B เสมอ — "ของฉัน"/"ของเพื่อน" ขึ้นกับว่าฉันคือฝั่งไหน
      const myScores = asA ? p.scores.a : p.scores.b
      const buddyScores = asA ? p.scores.b : p.scores.a
      const rule = ruleByCode.get(p.resultCode)

      return {
        resultCode: p.resultCode,
        title: rule?.title ?? p.resultCode,
        body: rule?.body ?? '',
        imageUrl: rule?.imageUrl,
        asA,
        axisMe: strongestAxis(activity.config, myScores),
        axisBuddy: strongestAxis(activity.config, buddyScores),
        createdAt: p.createdAt.toISOString(),
      }
    }),
  }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
