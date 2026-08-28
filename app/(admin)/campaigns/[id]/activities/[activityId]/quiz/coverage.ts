import type { QuizAxis, QuizConfig } from '@/lib/quiz/schema'

/**
 * คำนวณ "เมทริกซ์ผลลัพธ์" ของโหมด duo/solo — ใช้ทั้งเมทริกซ์ย่อในแถบข้าง (สรุป ✅/⚠️)
 * และกริด/checklist ที่คลิกแก้ได้ในขั้นตอนผลลัพธ์ ดึงมาจาก `draft` ตัวเดียวกันเสมอ จึง
 * "สด" โดยอัตโนมัติ ไม่ต้องมีปุ่ม "ตรวจสอบ" แยก (หลักการข้อ 6 ของ redesign)
 *
 * เป็น pure function ล้วนๆ (ไม่แตะ state/DOM) เพื่อให้เทสต์ตรงๆ ได้โดยไม่ต้อง render —
 * ดู coverage.test.ts
 */

export type CoverageKind = 'explicit' | 'catchall' | 'missing'

export type DuoCell = {
  axisA: string
  axisB: string
  kind: CoverageKind
  /** index ใน cfg.results ที่ควรแสดงชื่อ/รหัสในช่องนี้ — null เมื่อ kind === 'missing' */
  resultIndex: number | null
}

export type DuoCoverage = {
  axes: QuizAxis[]
  /** cells[i][j] ตรงกับ axes[i] × axes[j] — เป็นตารางเต็ม (ไม่ใช่แค่สามเหลี่ยมบน) เพราะคู่ไม่สนลำดับ
   *  (i,j) กับ (j,i) จึงมีค่าเดียวกันเสมอ — ตรงกับภาพเมทริกซ์ของสเปกอ้างอิงที่วาดเป็นตารางเต็ม */
  cells: DuoCell[][]
  /** index ของผลลัพธ์ที่กริดอ้างถึงเป็น "เจ้าของ cell" ของมันเองแล้ว (explicit) — ปรากฏครั้งเดียว */
  gridIndices: Set<number>
  /** ทุก index ที่ไม่ได้เป็นเจ้าของ cell ของตัวเอง: catch-all ทุกตัว (ตัวแรกที่ใช้ได้จริงและตัวที่ตายแล้ว
   *  ซ้ำกัน) คู่ที่ซ้ำกับ cell ที่มีคนจับไปแล้ว (ตายแล้ว — engine ใช้ตัวแรกที่ประกาศเสมอ) และคู่ที่อ้างแกนที่
   *  ไม่มีอยู่จริงแล้ว (เช่นแก้ id แกนทีหลัง) — extraIndices ∪ gridIndices ครอบทุก index พอดี ไม่ซ้ำไม่ขาด */
  extraIndices: number[]
}

const pairKey = (a: string, b: string): string => [a.toLowerCase(), b.toLowerCase()].sort().join('::')

export function computeDuoCoverage(cfg: Pick<QuizConfig, 'axes' | 'results'>): DuoCoverage {
  const axes = cfg.axes
  const axisIds = new Set(axes.map((a) => a.id))

  const assignedByKey = new Map<string, number>()
  let firstCatchAll: number | null = null
  const extraIndices: number[] = []

  cfg.results.forEach((r, i) => {
    if (!r.pair) {
      if (firstCatchAll === null) firstCatchAll = i
      else extraIndices.push(i)
      return
    }
    const [a, b] = r.pair
    if (!a || !b || !axisIds.has(a) || !axisIds.has(b)) {
      extraIndices.push(i)
      return
    }
    const key = pairKey(a, b)
    if (assignedByKey.has(key)) {
      extraIndices.push(i)
    } else {
      assignedByKey.set(key, i)
    }
  })

  if (firstCatchAll !== null) extraIndices.push(firstCatchAll)

  const cells: DuoCell[][] = axes.map((axisRow) =>
    axes.map((axisCol): DuoCell => {
      const key = pairKey(axisRow.id, axisCol.id)
      const explicitIndex = assignedByKey.get(key)
      if (explicitIndex !== undefined) {
        return { axisA: axisRow.id, axisB: axisCol.id, kind: 'explicit', resultIndex: explicitIndex }
      }
      if (firstCatchAll !== null) {
        return { axisA: axisRow.id, axisB: axisCol.id, kind: 'catchall', resultIndex: firstCatchAll }
      }
      return { axisA: axisRow.id, axisB: axisCol.id, kind: 'missing', resultIndex: null }
    }),
  )

  return { axes, cells, gridIndices: new Set(assignedByKey.values()), extraIndices }
}

export type SoloCombo = {
  /** typeCode ที่ผู้ให้คะแนนจะคำนวณได้จริงเมื่อผู้เล่นเอียงไปทางนี้ครบทุกแกน */
  code: string
  /** ชื่อขั้วที่เลือกต่อแกน ตามลำดับแกน — ใช้แสดงคำอธิบายใต้รหัส */
  parts: string[]
}

/**
 * รหัส type-code ที่เป็นไปได้ทั้งหมดของโหมด solo — cartesian product ของอักษรตัวแรกของขั้วสอง
 * ข้างต่อแกน ตามลำดับแกนที่ประกาศไว้ ตรงกับที่ dominantAxis() ต่ออักษรจริงตอนคำนวณผล (§4.1 ของ
 * design note) — 2^(จำนวนแกน) รายการ (2..6 แกนตาม schema ⇒ 4..64 รายการ)
 */
export function computeSoloCombos(axes: QuizAxis[]): SoloCombo[] {
  if (axes.length === 0) return []
  let combos: SoloCombo[] = [{ code: '', parts: [] }]
  for (const axis of axes) {
    const next: SoloCombo[] = []
    for (const combo of combos) {
      for (const pole of axis.poles) {
        const letter = (pole.charAt(0) || '?').toUpperCase()
        next.push({ code: combo.code + letter, parts: [...combo.parts, pole || '(ยังไม่ตั้งขั้ว)'] })
      }
    }
    combos = next
  }
  return combos
}

export type SoloCell = SoloCombo & { resultIndex: number | null }

export type SoloCoverage = {
  cells: SoloCell[]
  gridIndices: Set<number>
  /** ผลลัพธ์ที่รหัสไม่ตรงกับ combo ที่เป็นไปได้ตอนนี้เลย (ซ้ำกับ combo ที่มีคนจับไปแล้ว หรือรหัสที่ไม่ตรง
   *  กับชุดแกนปัจจุบันอีกต่อไป) — ยังเป็นผลลัพธ์ที่ใช้งานได้จริงเสมอ (เช่นเป็น fallbackResultCode) จึงต้อง
   *  ยังแก้ไข/ลบได้ ไม่ใช่หายไปจากจอเฉยๆ */
  extraIndices: number[]
}

export function computeSoloCoverage(cfg: Pick<QuizConfig, 'axes' | 'results'>): SoloCoverage {
  const combos = computeSoloCombos(cfg.axes)
  const comboCodes = new Set(combos.map((c) => c.code.toUpperCase()))
  const assignedByCode = new Map<string, number>()
  const extraIndices: number[] = []

  cfg.results.forEach((r, i) => {
    const code = r.code.toUpperCase()
    if (!code || !comboCodes.has(code) || assignedByCode.has(code)) {
      extraIndices.push(i)
    } else {
      assignedByCode.set(code, i)
    }
  })

  const cells: SoloCell[] = combos.map((combo) => ({
    ...combo,
    resultIndex: assignedByCode.get(combo.code.toUpperCase()) ?? null,
  }))

  return { cells, gridIndices: new Set(assignedByCode.values()), extraIndices }
}
