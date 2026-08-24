import { z } from 'zod'

export const QuizAxis = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(24),
  poles: z.tuple([z.string().max(24), z.string().max(24)]),
})
export type QuizAxis = z.infer<typeof QuizAxis>

export const QuizOption = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  scores: z.record(z.string(), z.number().int().min(-5).max(5)),
})
export type QuizOption = z.infer<typeof QuizOption>

export const QuizQuestion = z.object({
  id: z.string().min(1).max(30),
  text: z.string().min(1).max(140),
  options: z.array(QuizOption).min(2).max(6),
})
export type QuizQuestion = z.infer<typeof QuizQuestion>

export const QuizResultRule = z.object({
  code: z.string().min(1).max(30),
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  imageUrl: z.string().url().optional(),
  pair: z.tuple([z.string(), z.string()]).optional(),
})
export type QuizResultRule = z.infer<typeof QuizResultRule>

export const QuizConfig = z.object({
  mode: z.enum(['solo', 'duo']),
  axes: z.array(QuizAxis).min(2).max(6),
  questions: z.array(QuizQuestion).min(3).max(10),
  results: z.array(QuizResultRule).min(2),
  fallbackResultCode: z.string().min(1),
}).superRefine((cfg, ctx) => {
  const axisIds = new Set(cfg.axes.map((a) => a.id))
  if (axisIds.size !== cfg.axes.length) {
    ctx.addIssue({ code: 'custom', path: ['axes'], message: 'axis id ซ้ำ' })
  }

  const questionIds = new Set(cfg.questions.map((q) => q.id))
  if (questionIds.size !== cfg.questions.length) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: 'question id ซ้ำ' })
  }

  /**
   * option id ต้องไม่ซ้ำกันภายในคำถามข้อเดียวกัน
   *
   * lib/quiz/engine.ts จับคู่คำตอบด้วย `options.find(o => o.id === answer.optionId)`
   * ซึ่งคืนตัวแรกที่ id ตรงกันเท่านั้น — option id ซ้ำที่หลุดผ่าน validation มาได้จะทำให้
   * คำตอบของผู้เล่นถูกนับคะแนนเป็นตัวเลือกอื่นที่ id ชนกันแทน โดยไม่มี error ที่ไหนฟ้อง
   * เลย ด่านนี้จึงกันไว้ตั้งแต่ตอนบันทึก ไม่ปล่อยให้ไปพังตอนเล่นจริง — เป็นด่านที่สองรอง
   * จากตัวสร้าง id ฝั่งจอ (QuizConfigForm.tsx) ที่กันไม่ให้ id ชนกันตั้งแต่ต้น เผื่อ config
   * มาจากทางอื่นที่ไม่ใช่จอนั้น (เช่น import/แก้ JSON มือ) ในอนาคต
   */
  for (const [qi, q] of cfg.questions.entries()) {
    const optionIds = new Set(q.options.map((o) => o.id))
    if (optionIds.size !== q.options.length) {
      ctx.addIssue({ code: 'custom', path: ['questions', qi, 'options'], message: 'option id ซ้ำภายในคำถามข้อนี้' })
    }

    for (const [oi, opt] of q.options.entries()) {
      for (const scoredAxis of Object.keys(opt.scores)) {
        if (!axisIds.has(scoredAxis)) {
          ctx.addIssue({
            code: 'custom', path: ['questions', qi, 'options', oi, 'scores', scoredAxis],
            message: `option นี้อ้างแกน "${scoredAxis}" ที่ไม่มีอยู่จริง`,
          })
        }
      }
    }
  }

  const resultCodes = new Set(cfg.results.map((r) => r.code))
  if (resultCodes.size !== cfg.results.length) {
    ctx.addIssue({ code: 'custom', path: ['results'], message: 'result code ซ้ำ' })
  }

  if (!resultCodes.has(cfg.fallbackResultCode)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackResultCode'], message: 'fallbackResultCode ต้องมีอยู่จริงใน results' })
  }

  if (cfg.mode === 'duo') {
    for (const [ri, rule] of cfg.results.entries()) {
      if (!rule.pair) continue
      for (const axisId of rule.pair) {
        if (!axisIds.has(axisId)) {
          ctx.addIssue({
            code: 'custom', path: ['results', ri, 'pair'],
            message: `result "${rule.code}" อ้างแกน "${axisId}" ที่ไม่มีอยู่จริง`,
          })
        }
      }
    }
  }
})
export type QuizConfig = z.infer<typeof QuizConfig>
