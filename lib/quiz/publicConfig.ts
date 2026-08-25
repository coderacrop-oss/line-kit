import type { QuizConfig } from './schema'

export type PublicQuizConfig = {
  mode: 'solo' | 'duo'
  axes: { id: string; label: string }[]
  questions: { id: string; text: string; options: { id: string; label: string }[] }[]
}

export function toPublicQuizConfig(cfg: QuizConfig): PublicQuizConfig {
  return {
    mode: cfg.mode,
    axes: cfg.axes.map((a) => ({ id: a.id, label: a.label })),
    questions: cfg.questions.map((q) => ({
      id: q.id, text: q.text,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  }
}
