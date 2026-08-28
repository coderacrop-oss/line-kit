import { z } from 'zod'

export const QuizAxis = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(24),
  // ทั้งสองขั้วต้องไม่ว่าง (deviation จากข้อความ plan เดิมที่ไม่ได้ระบุ .min ไว้) —
  // solo type-code (lib/quiz/engine.ts dominantAxis) เอาตัวอักษรตัวแรกของขั้วที่เลือก
  // มาต่อกันเป็นรหัส ขั้วว่างจะได้ตัวอักษรว่าง/ผิดรูปที่แทบไม่มีวันตรงกับ results[].code
  // ไหนเลย ผู้เล่นจะได้ fallbackResultCode เงียบๆ ทุกครั้งโดยไม่มี error ที่ไหนฟ้อง
  poles: z.tuple([z.string().min(1).max(24), z.string().min(1).max(24)]),
  // ภาพการ์ดของแกนนี้ ใช้โดยจอ Matching ของเทมเพลต LIFF export (docs/superpowers/specs/
  // 2026-08-28-liff-template-export-design.md §7) — ไม่ตั้งไว้ = จอแสดง placeholder ทั่วไป
  // ไม่ใช่ hardcode ภาพของแคมเปญใดแคมเปญหนึ่ง
  imageUrl: z.string().url().optional(),
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
  group: z.lazy(() => GroupConfig).optional(),
  replies: z.lazy(() => QuizReplies).optional(),
  // Branding/ข้อความสำหรับ LIFF template export (docs/superpowers/specs/
  // 2026-08-28-liff-template-export-design.md §4.1) — optional field เสริมตามแบบ group/replies
  // ที่ไม่ได้ตั้งไว้แปลว่ากิจกรรมนี้ยังไม่เคย export เป็นเทมเพลต
  templateCopy: z.lazy(() => TemplateCopy).optional(),
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

  /**
   * templateCopy เป็น optional ทั้งก้อน (กิจกรรมที่ยังไม่เคย export ก็ valid ปกติ) แต่ถ้าตั้งไว้
   * แล้ว ฟิลด์ข้อความบางตัวต้องมีค่าตาม mode/group ที่เปิดใช้งานจริง — ไม่งั้น export (Task 13/14)
   * จะได้เทมเพลตที่มีจอ/การ์ดบางใบไม่มีข้อความให้แสดง (docs/superpowers/specs/
   * 2026-08-28-liff-template-export-design.md §4.1). แต่ละกฎ addIssue path ชี้ตรงจุดที่ขาด
   * เพื่อให้ TemplateCopyForm ชี้ error ที่ควบคุมตรงนั้นได้ (ไม่ใช่แค่ "templateCopy ผิด" เฉยๆ)
   */
  if (cfg.templateCopy) {
    const tc = cfg.templateCopy
    if (cfg.mode === 'duo') {
      if (!tc.invite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'invite'], message: 'โหมด duo ต้องตั้งค่า templateCopy.invite' })
      if (!tc.messages.duoInvite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoInvite'], message: 'โหมด duo ต้องตั้งค่า templateCopy.messages.duoInvite' })
      if (!tc.messages.duoPartnerAnswered) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoPartnerAnswered'], message: 'โหมด duo ต้องตั้งค่า templateCopy.messages.duoPartnerAnswered' })
      if (!tc.messages.duoPairResult) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoPairResult'], message: 'โหมด duo ต้องตั้งค่า templateCopy.messages.duoPairResult' })
      if (!tc.messages.duoReminder) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoReminder'], message: 'โหมด duo ต้องตั้งค่า templateCopy.messages.duoReminder' })
    }
    if (cfg.mode === 'solo' && !tc.messages.soloShare) {
      ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'soloShare'], message: 'โหมด solo ต้องตั้งค่า templateCopy.messages.soloShare' })
    }
    if (cfg.group?.enabled) {
      if (!tc.messages.groupComplete) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupComplete'], message: 'เปิดผลลัพธ์กลุ่มแล้วต้องตั้งค่า templateCopy.messages.groupComplete' })
      if (!tc.messages.groupUnlock) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupUnlock'], message: 'เปิดผลลัพธ์กลุ่มแล้วต้องตั้งค่า templateCopy.messages.groupUnlock' })
      if (!tc.messages.groupReminder) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupReminder'], message: 'เปิดผลลัพธ์กลุ่มแล้วต้องตั้งค่า templateCopy.messages.groupReminder' })
      if (!tc.messages.groupInvite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupInvite'], message: 'เปิดผลลัพธ์กลุ่มแล้วต้องตั้งค่า templateCopy.messages.groupInvite' })
    }
  }
})
export type QuizConfig = z.infer<typeof QuizConfig>

export const GroupCondition = z.object({
  hasAxes: z.array(z.string().min(1)).min(1).optional(),
  hasMode: z.enum(['any', 'all']).default('any'),
  topAxes: z.array(z.string().min(1)).min(1).optional(),
  topN: z.number().int().min(1).max(5).default(1),
  isBalanced: z.boolean().optional(),
  dominantThreshold: z.number().min(0.3).max(0.9).default(0.5),
  minMembersWithAxis: z.number().int().min(1).optional(),
  maxDistinct: z.number().int().min(1).max(6).optional(),
})
export type GroupCondition = z.infer<typeof GroupCondition>

export const GroupArchetype = z.object({
  code: z.string().min(1).max(30),
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  imageUrl: z.string().url().optional(),
  minGroupSize: z.number().int().min(2).max(200).default(2),
  maxGroupSize: z.number().int().min(2).max(200).optional(),
  condition: GroupCondition.nullable().optional(),
  fallback: z.boolean().optional(),
})
export type GroupArchetype = z.infer<typeof GroupArchetype>

export const GroupConfig = z.object({
  enabled: z.boolean().default(false),
  minMembers: z.number().int().min(2).max(200).default(2),
  maxMembers: z.number().int().min(2).max(200).default(50),
  resultLocksAt: z.number().int().min(0).max(200).default(0),
  archetypes: z.array(GroupArchetype).min(1),
  fallbackArchetype: z.string().min(1),
}).superRefine((cfg, ctx) => {
  if (cfg.maxMembers < cfg.minMembers) {
    ctx.addIssue({ code: 'custom', path: ['maxMembers'], message: 'maxMembers ต้อง >= minMembers' })
  }
  if (!cfg.archetypes.some((a) => a.code === cfg.fallbackArchetype)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackArchetype'], message: 'fallbackArchetype ต้องมีอยู่จริงใน archetypes' })
  }
  const tiers = [...new Set(cfg.archetypes.map((a) => a.minGroupSize))]
  for (const tier of tiers) {
    if (!cfg.archetypes.some((a) => a.minGroupSize === tier && a.fallback)) {
      ctx.addIssue({ code: 'custom', path: ['archetypes'], message: `min_group_size=${tier} ไม่มี fallback` })
    }
  }
})
export type GroupConfig = z.infer<typeof GroupConfig>

export const QuizReplies = z.object({
  duoMatchNotifyCardId: z.string().uuid().optional(),  // การ์ดแจ้ง A ตอน B ตอบครบ
})
export type QuizReplies = z.infer<typeof QuizReplies>

/**
 * Branding/ข้อความสำหรับ LIFF template export (docs/superpowers/specs/
 * 2026-08-28-liff-template-export-design.md §4.1/§6/§7) — ทุกฟิลด์ที่จอ/การ์ดของเทมเพลตต้อง
 * แสดงข้อความมาจากที่นี่เท่านั้น (ยกเว้น label ทางเทคนิคล้วนๆ เช่น "Loading…") ห้ามมี
 * เนื้อหาแคมเปญ hardcode อยู่ในโค้ดเรนเดอร์/จอเลยแม้แต่ตัวเดียว (กันข้อผิดพลาดข้อ 1 ของ KimLIFF)
 */
export const RewardMilestone = z.object({
  key: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  icon: z.string().max(10).optional(),
  triggerCount: z.number().int().min(1),
})
export type RewardMilestone = z.infer<typeof RewardMilestone>

export const TemplateMessagesCopy = z.object({
  resultCard: z.object({ eyebrow: z.string().max(40), ctaLabel: z.string().min(1).max(30) }),
  keywordCard: z.object({
    title: z.string().min(1).max(80),
    body: z.string().max(300),
    ctaLabel: z.string().min(1).max(30),
    // escape hatch: Flex JSON ดิบที่แอดมินกรอกเองเต็มที่ — จุดเดียวที่ยอมรับเนื้อหาไม่มีชนิด
    // ตายตัวโดยเจตนา (ดู render layer §6 ข้อ 5 renderKeywordCustom) แต่อย่างน้อยต้องเป็น
    // object shape (ไม่ใช่ string/array/number) — renderKeywordCustom คืนค่านี้ตรงๆ เป็น
    // FlexMessage ดังนั้น string ที่ JSON.parse ล้มเหลวมาแล้ว (เก็บดิบไว้โดย
    // TemplateCopyForm.tsx เดิม) ต้องไม่ผ่าน schema มาถึงจุดนี้เลย (Finding 6 ของรีวิว)
    customFlexJson: z.record(z.string(), z.unknown()).optional(),
  }),
  soloShare: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30), secondaryCtaLabel: z.string().min(1).max(30) }).optional(),
  duoInvite: z.object({ titleTemplate: z.string().min(1).max(120), bodyTemplate: z.string().max(400), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoPartnerAnswered: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoPairResult: z.object({ badge: z.string().max(30), rankLineTemplate: z.string().max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoReminder: z.object({ badge: z.string().max(30), headlineTemplate: z.string().min(1).max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupComplete: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupUnlock: z.object({ headlineTemplate: z.string().min(1).max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupReminder: z.object({ badge: z.string().max(30), headlineTemplate: z.string().min(1).max(120), subText: z.string().max(200), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupInvite: z.object({
    headerCompleteTemplate: z.string().min(1).max(120), headerIncompleteTemplate: z.string().min(1).max(120),
    body: z.string().max(300), ctaLabel: z.string().min(1).max(30), secondaryCtaLabel: z.string().min(1).max(30),
  }).optional(),
})
export type TemplateMessagesCopy = z.infer<typeof TemplateMessagesCopy>

export const TemplateCopy = z.object({
  brand: z.object({
    name: z.string().min(1).max(40),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  intro: z.object({ title: z.string().min(1).max(80), body: z.string().max(400), ctaLabel: z.string().min(1).max(30) }),
  friendGate: z.object({ title: z.string().min(1).max(80), body: z.string().max(400), ctaLabel: z.string().min(1).max(30) }),
  openInLine: z.object({ title: z.string().min(1).max(80), body: z.string().max(400) }),
  invite: z.object({ shareTitle: z.string().min(1).max(80), shareBodyTemplate: z.string().max(300) }).optional(),
  rewards: z.object({ milestones: z.array(RewardMilestone).default([]) }),
  messages: TemplateMessagesCopy,
})
export type TemplateCopy = z.infer<typeof TemplateCopy>
