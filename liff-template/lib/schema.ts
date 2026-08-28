import { z } from 'zod'

/**
 * Vendored copy of LineKit's lib/quiz/schema.ts, plus the TemplateConfig wrapper
 * (schemaVersion) this standalone project needs. This file intentionally does not
 * import anything from LineKit — it's a self-contained copy so this project can run
 * forever with zero runtime dependency on the system that generated it.
 */

export const QuizAxis = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(24),
  poles: z.tuple([z.string().min(1).max(24), z.string().min(1).max(24)]),
  imageUrl: z.string().url().optional(),
  // short/imageUrl/body are rendered by app/screens/PairResult.tsx, app/screens/Group.tsx, and
  // renderGroupInviteCard. labelEn/order are stored and validated but not rendered anywhere in
  // this template by design — there's no i18n switch for labelEn to serve, and no screen lists
  // or sorts a catalog of all axes for order to apply to. Revisit if either of those appear.
  labelEn: z.string().max(40).optional(),
  body: z.string().max(400).optional(),
  short: z.string().max(60).optional(),
  order: z.string().max(4).optional(),
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
  // ข้อความกำหนดเองตรงนี้ต้องตรงกับ LineKit/lib/quiz/schema.ts เสมอ (ไฟล์นี้เป็นสำเนา
  // vendored ของ schema เดียวกัน) — ช่วยให้ config ที่ export มาแล้วบูตไม่ผ่านบนเทมเพลตนี้
  // (เช่นแอดมินแก้ไฟล์ config มือ) ก็ยังได้ข้อความที่อ่านรู้เรื่องเหมือนตอนแก้ใน LineKit
  axes: z.array(QuizAxis).min(2, 'ต้องมีอย่างน้อย 2 แกน').max(6, 'มีแกนได้มากที่สุด 6 แกน'),
  questions: z.array(QuizQuestion).min(3, 'ต้องมีอย่างน้อย 3 คำถาม').max(10, 'มีคำถามได้มากที่สุด 10 ข้อ'),
  results: z.array(QuizResultRule).min(2, 'ต้องมีอย่างน้อย 2 ผลลัพธ์'),
  fallbackResultCode: z.string().min(1, 'ต้องเลือกผลลัพธ์สำรอง (fallbackResultCode)'),
  group: z.lazy(() => GroupConfig).optional(),
  replies: z.lazy(() => QuizReplies).optional(),
  templateCopy: z.lazy(() => TemplateCopy).optional(),
}).superRefine((cfg, ctx) => {
  const axisIds = new Set(cfg.axes.map((a) => a.id))
  if (axisIds.size !== cfg.axes.length) {
    ctx.addIssue({ code: 'custom', path: ['axes'], message: 'duplicate axis id' })
  }

  const questionIds = new Set(cfg.questions.map((q) => q.id))
  if (questionIds.size !== cfg.questions.length) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: 'duplicate question id' })
  }

  for (const [qi, q] of cfg.questions.entries()) {
    const optionIds = new Set(q.options.map((o) => o.id))
    if (optionIds.size !== q.options.length) {
      ctx.addIssue({ code: 'custom', path: ['questions', qi, 'options'], message: 'duplicate option id within this question' })
    }

    for (const [oi, opt] of q.options.entries()) {
      for (const scoredAxis of Object.keys(opt.scores)) {
        if (!axisIds.has(scoredAxis)) {
          ctx.addIssue({
            code: 'custom', path: ['questions', qi, 'options', oi, 'scores', scoredAxis],
            message: `option references axis "${scoredAxis}" which does not exist`,
          })
        }
      }
    }
  }

  const resultCodes = new Set(cfg.results.map((r) => r.code))
  if (resultCodes.size !== cfg.results.length) {
    ctx.addIssue({ code: 'custom', path: ['results'], message: 'duplicate result code' })
  }

  if (!resultCodes.has(cfg.fallbackResultCode)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackResultCode'], message: 'fallbackResultCode must reference an existing result' })
  }

  if (cfg.mode === 'duo') {
    for (const [ri, rule] of cfg.results.entries()) {
      if (!rule.pair) continue
      for (const axisId of rule.pair) {
        if (!axisIds.has(axisId)) {
          ctx.addIssue({
            code: 'custom', path: ['results', ri, 'pair'],
            message: `result "${rule.code}" references axis "${axisId}" which does not exist`,
          })
        }
      }
    }
  }

  if (cfg.templateCopy) {
    const tc = cfg.templateCopy
    if (cfg.mode === 'duo') {
      if (!tc.invite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'invite'], message: 'duo mode requires templateCopy.invite' })
      if (!tc.messages.duoInvite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoInvite'], message: 'duo mode requires templateCopy.messages.duoInvite' })
      if (!tc.messages.duoPartnerAnswered) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoPartnerAnswered'], message: 'duo mode requires templateCopy.messages.duoPartnerAnswered' })
      if (!tc.messages.duoPairResult) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoPairResult'], message: 'duo mode requires templateCopy.messages.duoPairResult' })
      if (!tc.messages.duoReminder) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'duoReminder'], message: 'duo mode requires templateCopy.messages.duoReminder' })
    }
    if (cfg.mode === 'solo' && !tc.messages.soloShare) {
      ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'soloShare'], message: 'solo mode requires templateCopy.messages.soloShare' })
    }
    if (cfg.group?.enabled) {
      if (!tc.messages.groupComplete) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupComplete'], message: 'group mode requires templateCopy.messages.groupComplete' })
      if (!tc.messages.groupUnlock) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupUnlock'], message: 'group mode requires templateCopy.messages.groupUnlock' })
      if (!tc.messages.groupReminder) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupReminder'], message: 'group mode requires templateCopy.messages.groupReminder' })
      if (!tc.messages.groupInvite) ctx.addIssue({ code: 'custom', path: ['templateCopy', 'messages', 'groupInvite'], message: 'group mode requires templateCopy.messages.groupInvite' })
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
    ctx.addIssue({ code: 'custom', path: ['maxMembers'], message: 'maxMembers must be >= minMembers' })
  }
  if (!cfg.archetypes.some((a) => a.code === cfg.fallbackArchetype)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackArchetype'], message: 'fallbackArchetype must reference an existing archetype' })
  }
  const tiers = [...new Set(cfg.archetypes.map((a) => a.minGroupSize))]
  for (const tier of tiers) {
    if (!cfg.archetypes.some((a) => a.minGroupSize === tier && a.fallback)) {
      ctx.addIssue({ code: 'custom', path: ['archetypes'], message: `min_group_size=${tier} has no fallback archetype` })
    }
  }
})
export type GroupConfig = z.infer<typeof GroupConfig>

export const QuizReplies = z.object({
  duoMatchNotifyCardId: z.string().uuid().optional(),
})
export type QuizReplies = z.infer<typeof QuizReplies>

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
    // must be an object shape (not string/array/number) — renderKeywordCustom returns this
    // verbatim as a FlexMessage.
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

/**
 * The export contract this template's code was written against (design doc §4.2). LineKit
 * stamps `{ schemaVersion: TEMPLATE_SCHEMA_VERSION, quiz: <QuizConfig> }` into
 * config/quiz.config.json when it assembles the export zip. lib/config.ts checks this field
 * explicitly and refuses to boot with a clear error on mismatch, rather than silently
 * misinterpreting a config shaped for a different version of this template's code.
 */
export const TEMPLATE_SCHEMA_VERSION = 1 as const

export const TemplateConfig = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  quiz: QuizConfig,
})
export type TemplateConfig = z.infer<typeof TemplateConfig>
