import { describe, expect, it } from 'vitest'
import type { QuizAxis, QuizResultRule } from '@/lib/quiz/schema'
import { computeDuoCoverage, computeSoloCombos, computeSoloCoverage } from './coverage'

const axes: QuizAxis[] = [
  { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
  { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
]

describe('computeDuoCoverage', () => {
  it('ยังไม่มีผลลัพธ์เลย — ทุกคู่ missing และไม่มี index ไหนถูกอ้างถึง', () => {
    const cov = computeDuoCoverage({ axes, results: [] })
    expect(cov.cells).toHaveLength(2)
    for (const row of cov.cells) for (const cell of row) expect(cell.kind).toBe('missing')
    expect(cov.gridIndices.size).toBe(0)
    expect(cov.extraIndices).toEqual([])
  })

  it('คู่ที่ตั้ง pair ตรงกับแกนจริง ขึ้นเป็น explicit ที่ cell ของตัวเอง และไม่ซ้ำใน extra', () => {
    const results: QuizResultRule[] = [{ code: 'R1', title: 't', body: 'b', pair: ['ei', 'sn'] }]
    const cov = computeDuoCoverage({ axes, results })
    // (ei,sn) และ (sn,ei) ต้องเป็น cell เดียวกัน (ไม่สนลำดับ)
    expect(cov.cells[0][1].kind).toBe('explicit')
    expect(cov.cells[0][1].resultIndex).toBe(0)
    expect(cov.cells[1][0].kind).toBe('explicit')
    expect(cov.cells[1][0].resultIndex).toBe(0)
    // เส้นทแยงมุม (คู่ตัวเอง) ยังไม่มีใครตั้ง — ต้องยัง missing
    expect(cov.cells[0][0].kind).toBe('missing')
    expect(cov.gridIndices).toEqual(new Set([0]))
    expect(cov.extraIndices).toEqual([])
  })

  it('เส้นทแยงมุม (แกนเดียวกันทั้งคู่) เป็นคู่ที่ถูกต้อง — ตั้งได้และขึ้น explicit', () => {
    const results: QuizResultRule[] = [{ code: 'R1', title: 't', body: 'b', pair: ['ei', 'ei'] }]
    const cov = computeDuoCoverage({ axes, results })
    expect(cov.cells[0][0].kind).toBe('explicit')
    expect(cov.cells[0][0].resultIndex).toBe(0)
  })

  it('catch-all (ไม่มี .pair) คลุมทุกคู่ที่เหลือ แต่ไม่ได้เป็นเจ้าของ cell ไหนเป็นของตัวเอง', () => {
    const results: QuizResultRule[] = [
      { code: 'R1', title: 't', body: 'b', pair: ['ei', 'sn'] },
      { code: 'FALLBACK', title: 't', body: 'b' }, // catch-all
    ]
    const cov = computeDuoCoverage({ axes, results })
    expect(cov.cells[0][1].kind).toBe('explicit')
    expect(cov.cells[0][0].kind).toBe('catchall')
    expect(cov.cells[0][0].resultIndex).toBe(1)
    expect(cov.cells[1][1].kind).toBe('catchall')
    // catch-all ไม่ใช่ gridIndex (ไม่ใช่เจ้าของ cell เดี่ยวๆ) แต่ต้องอยู่ใน extraIndices เพื่อให้ยังแก้ได้
    expect(cov.gridIndices.has(1)).toBe(false)
    expect(cov.extraIndices).toContain(1)
  })

  it('catch-all ตัวที่สอง (ตายแล้ว เพราะตัวแรกชนะเสมอ) อยู่ใน extraIndices ด้วย', () => {
    const results: QuizResultRule[] = [
      { code: 'A', title: 't', body: 'b' }, // catch-all ตัวแรก (ใช้ได้จริง)
      { code: 'B', title: 't', body: 'b' }, // catch-all ตัวสอง (ตายแล้ว)
    ]
    const cov = computeDuoCoverage({ axes, results })
    expect(cov.extraIndices.sort()).toEqual([0, 1])
    expect(cov.cells[0][0].resultIndex).toBe(0)
  })

  it('คู่ซ้ำกัน — ตัวที่สองตายแล้ว (engine ใช้ตัวแรกที่ประกาศเสมอ) จึงอยู่ใน extraIndices', () => {
    const results: QuizResultRule[] = [
      { code: 'A', title: 't', body: 'b', pair: ['ei', 'sn'] },
      { code: 'B', title: 't', body: 'b', pair: ['sn', 'ei'] }, // ซ้ำกับตัวบน (ไม่สนลำดับ)
    ]
    const cov = computeDuoCoverage({ axes, results })
    expect(cov.cells[0][1].resultIndex).toBe(0)
    expect(cov.gridIndices).toEqual(new Set([0]))
    expect(cov.extraIndices).toEqual([1])
  })

  it('pair อ้างแกนที่ไม่มีอยู่จริงแล้ว (เช่นแก้ id แกนทีหลัง) ไปอยู่ extraIndices ไม่ใช่หายไปเงียบๆ', () => {
    const results: QuizResultRule[] = [{ code: 'A', title: 't', body: 'b', pair: ['ei', 'gone'] }]
    const cov = computeDuoCoverage({ axes, results })
    expect(cov.gridIndices.size).toBe(0)
    expect(cov.extraIndices).toEqual([0])
  })

  it('ทุก index ของ results ปรากฏใน gridIndices หรือ extraIndices อย่างใดอย่างหนึ่งเท่านั้น ไม่ซ้ำไม่ขาด', () => {
    const results: QuizResultRule[] = [
      { code: 'A', title: 't', body: 'b', pair: ['ei', 'sn'] },
      { code: 'B', title: 't', body: 'b', pair: ['ei', 'ei'] },
      { code: 'C', title: 't', body: 'b' },
      { code: 'D', title: 't', body: 'b', pair: ['ei', 'sn'] }, // ซ้ำกับ index 0
    ]
    const cov = computeDuoCoverage({ axes, results })
    const seen = [...cov.gridIndices, ...cov.extraIndices].sort()
    expect(seen).toEqual([0, 1, 2, 3])
    expect(new Set(seen).size).toBe(4)
  })
})

describe('computeSoloCombos', () => {
  it('ไม่มีแกนเลย — ไม่มี combo', () => {
    expect(computeSoloCombos([])).toEqual([])
  })

  it('2 แกน — 4 combo (cartesian ของขั้วสองข้างต่อแกน) ตรงกับ dominantAxis() ของ engine', () => {
    const combos = computeSoloCombos(axes)
    expect(combos.map((c) => c.code).sort()).toEqual(['ES', 'EN', 'IS', 'IN'].sort())
  })

  it('3 แกน — 8 combo', () => {
    const three: QuizAxis[] = [...axes, { id: 'tf', label: 'T/F', poles: ['T', 'F'] }]
    expect(computeSoloCombos(three)).toHaveLength(8)
  })
})

describe('computeSoloCoverage', () => {
  it('รหัสตรงกับ combo ที่เป็นไปได้ — explicit ใน gridIndices', () => {
    const results: QuizResultRule[] = [{ code: 'ES', title: 't', body: 'b' }]
    const cov = computeSoloCoverage({ axes, results })
    const esCell = cov.cells.find((c) => c.code === 'ES')
    expect(esCell?.resultIndex).toBe(0)
    expect(cov.gridIndices).toEqual(new Set([0]))
    expect(cov.extraIndices).toEqual([])
  })

  it('เทียบรหัสแบบไม่สนตัวพิมพ์ใหญ่เล็ก — ตรงกับ dominantAxis()/matchResult() ของ engine', () => {
    const results: QuizResultRule[] = [{ code: 'es', title: 't', body: 'b' }]
    const cov = computeSoloCoverage({ axes, results })
    expect(cov.cells.find((c) => c.code === 'ES')?.resultIndex).toBe(0)
  })

  it('รหัสที่ไม่ตรงกับ combo ไหนเลย (เช่น fallback ที่ตั้งชื่อเอง) อยู่ใน extraIndices', () => {
    const results: QuizResultRule[] = [{ code: 'DEFAULT', title: 't', body: 'b' }]
    const cov = computeSoloCoverage({ axes, results })
    expect(cov.gridIndices.size).toBe(0)
    expect(cov.extraIndices).toEqual([0])
  })

  it('ยังไม่มี result เลย — ทุก combo เป็น missing (resultIndex null)', () => {
    const cov = computeSoloCoverage({ axes, results: [] })
    expect(cov.cells.every((c) => c.resultIndex === null)).toBe(true)
  })
})
