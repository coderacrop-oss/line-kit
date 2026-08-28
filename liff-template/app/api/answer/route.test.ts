import { describe, expect, it } from 'vitest'
import { POST } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/answer', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * ใช้ config/quiz.config.sample.json ตรงๆ (schemaVersion 1, mode solo, axes ei/sn,
 * poles ["Extrovert","Introvert"] / ["Sensing","Intuition"]) — dominantAxis เอาตัวอักษร
 * แรกของขั้วที่คะแนน >= 0 มาต่อกัน ตอบ q1=a, q2=a, q3=b:
 * ei = 2+1-1=2 (>=0 -> "Extrovert" -> 'E'), sn = -1+1+1=1 (>=0 -> "Sensing" -> 'S')
 * -> type code "ES" ตรงกับ results[0].code เป๊ะ (ไม่ตก fallback)
 */
describe('POST /api/answer', () => {
  it('resolves a solo result from a full set of answers', async () => {
    const res = await POST(req({
      answers: [
        { questionId: 'q1', optionId: 'a' },
        { questionId: 'q2', optionId: 'a' },
        { questionId: 'q3', optionId: 'b' },
      ],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resultCode).toBe('ES')
    expect(body.usedFallback).toBe(false)
    expect(body.scores).toEqual({ ei: 2, sn: 1 })
  })

  it('returns 400 with the validation error when an answer is missing', async () => {
    const res = await POST(req({ answers: [{ questionId: 'q1', optionId: 'a' }] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })

  it('returns 400 when answers is missing entirely', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })
})
