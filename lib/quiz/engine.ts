import type { QuizConfig } from './schema'

export type Answer = { questionId: string; optionId: string }

export function scoreAnswers(cfg: QuizConfig, answers: Answer[]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const axis of cfg.axes) scores[axis.id] = 0

  for (const answer of answers) {
    const question = cfg.questions.find((q) => q.id === answer.questionId)
    const option = question?.options.find((o) => o.id === answer.optionId)
    if (!option) continue
    for (const [axisId, delta] of Object.entries(option.scores)) {
      scores[axisId] = (scores[axisId] ?? 0) + delta
    }
  }
  return scores
}

/** ตามลำดับที่ประกาศแกนใน config เสมอ · v >= 0 เอนไปขั้วแรก (tiebreak ตายตัว) */
export function dominantAxis(cfg: QuizConfig, scores: Record<string, number>): string {
  return cfg.axes
    .map((axis) => {
      const v = scores[axis.id] ?? 0
      const pole = v >= 0 ? axis.poles[0] : axis.poles[1]
      return pole.charAt(0).toUpperCase()
    })
    .join('')
}

/** แกนที่ "เด่นที่สุด" แกนเดียวของคนคนนี้ — ใช้จับคู่ผลลัพธ์ duo เท่านั้น */
export function strongestAxis(cfg: QuizConfig, scores: Record<string, number>): string {
  let best = cfg.axes[0].id
  let bestAbs = Math.abs(scores[best] ?? 0)
  for (const axis of cfg.axes.slice(1)) {
    const abs = Math.abs(scores[axis.id] ?? 0)
    if (abs > bestAbs) {
      best = axis.id
      bestAbs = abs
    }
  }
  return best
}

export function validateAnswers(cfg: QuizConfig, answers: Answer[]): string | null {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]))
  for (const question of cfg.questions) {
    const given = byQuestion.get(question.id)
    if (!given) return `ยังไม่ได้ตอบคำถาม "${question.text}"`
    if (!question.options.some((o) => o.id === given.optionId)) {
      return `ตัวเลือกที่ส่งมาไม่ตรงกับคำถาม "${question.text}"`
    }
  }
  return null
}

function matchResult(
  cfg: QuizConfig, typeCode: string,
): { resultCode: string; usedFallback: boolean } {
  const hit = cfg.results.find((r) => r.code.toUpperCase() === typeCode.toUpperCase())
  return hit ? { resultCode: hit.code, usedFallback: false } : { resultCode: cfg.fallbackResultCode, usedFallback: true }
}

export function resolveSolo(
  cfg: QuizConfig, answers: Answer[],
): { resultCode: string; scores: Record<string, number>; usedFallback: boolean } {
  const scores = scoreAnswers(cfg, answers)
  const typeCode = dominantAxis(cfg, scores)
  return { ...matchResult(cfg, typeCode), scores }
}

function matchPair(
  cfg: QuizConfig, axisA: string, axisB: string,
): { resultCode: string; usedFallback: boolean } {
  for (const rule of cfg.results) {
    if (!rule.pair) {
      // Catch-all: no pair field means matches unconditionally, first one wins
      return { resultCode: rule.code, usedFallback: false }
    }
    // Compare rule.pair (axis IDs) against [axisA, axisB] case-insensitively, unordered
    const [x, y] = rule.pair
    const matches = (x.toLowerCase() === axisA.toLowerCase() && y.toLowerCase() === axisB.toLowerCase()) ||
                   (x.toLowerCase() === axisB.toLowerCase() && y.toLowerCase() === axisA.toLowerCase())
    if (matches) return { resultCode: rule.code, usedFallback: false }
  }
  return { resultCode: cfg.fallbackResultCode, usedFallback: true }
}

export function resolvePair(
  cfg: QuizConfig, answersA: Answer[], answersB: Answer[],
): {
  resultCode: string; scoresA: Record<string, number>; scoresB: Record<string, number>
  combined: Record<string, number>; axisA: string; axisB: string; usedFallback: boolean
} {
  const scoresA = scoreAnswers(cfg, answersA)
  const scoresB = scoreAnswers(cfg, answersB)
  const axisA = strongestAxis(cfg, scoresA)
  const axisB = strongestAxis(cfg, scoresB)

  const combined: Record<string, number> = {}
  for (const axis of cfg.axes) combined[axis.id] = (scoresA[axis.id] ?? 0) + (scoresB[axis.id] ?? 0)

  const { resultCode, usedFallback } = matchPair(cfg, axisA, axisB)
  return { resultCode, scoresA, scoresB, combined, axisA, axisB, usedFallback }
}
