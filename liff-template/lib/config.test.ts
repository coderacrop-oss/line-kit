import { describe, expect, it } from 'vitest'
import { TEMPLATE_SCHEMA_VERSION } from './schema'
import { loadTemplateConfig, readTemplateConfigFromDisk, SchemaVersionMismatchError } from './config'

const validQuiz = {
  mode: 'solo' as const,
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] as [string, string] },
  ],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
  ],
  results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  templateCopy: {
    brand: { name: 'Test' },
    intro: { title: 't', body: 'b', ctaLabel: 'c' },
    friendGate: { title: 't', body: 'b', ctaLabel: 'c' },
    openInLine: { title: 't', body: 'b' },
    rewards: { milestones: [] },
    messages: {
      resultCard: { eyebrow: 'e', ctaLabel: 'c' },
      keywordCard: { title: 't', body: 'b', ctaLabel: 'c' },
      soloShare: { badge: 'b', ctaLabel: 'c', secondaryCtaLabel: 'd' },
    },
  },
}

describe('loadTemplateConfig', () => {
  it('parses a valid config with the current schemaVersion', () => {
    const cfg = loadTemplateConfig({ schemaVersion: TEMPLATE_SCHEMA_VERSION, quiz: validQuiz })
    expect(cfg.quiz.mode).toBe('solo')
  })

  it('throws a SchemaVersionMismatchError with found/expected versions when schemaVersion does not match', () => {
    expect(() => loadTemplateConfig({ schemaVersion: 999, quiz: validQuiz }))
      .toThrow(SchemaVersionMismatchError)
    try {
      loadTemplateConfig({ schemaVersion: 999, quiz: validQuiz })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionMismatchError)
      const message = (err as Error).message
      expect(message).toContain('v999')
      expect(message).toContain(`v${TEMPLATE_SCHEMA_VERSION}`)
      expect(message).toContain('Re-export this campaign from LineKit')
    }
  })

  it('throws a normal (non-version) error when schemaVersion matches but quiz fails validation', () => {
    expect(() => loadTemplateConfig({ schemaVersion: TEMPLATE_SCHEMA_VERSION, quiz: { ...validQuiz, fallbackResultCode: 'NOPE' } }))
      .toThrow()
    try {
      loadTemplateConfig({ schemaVersion: TEMPLATE_SCHEMA_VERSION, quiz: { ...validQuiz, fallbackResultCode: 'NOPE' } })
      expect.unreachable()
    } catch (err) {
      expect(err).not.toBeInstanceOf(SchemaVersionMismatchError)
    }
  })

  it('throws SchemaVersionMismatchError (not a generic Zod error) when schemaVersion is missing entirely', () => {
    expect(() => loadTemplateConfig({ quiz: validQuiz })).toThrow(SchemaVersionMismatchError)
  })
})

describe('readTemplateConfigFromDisk', () => {
  it('falls back to config/quiz.config.sample.json and parses it successfully', () => {
    const cfg = readTemplateConfigFromDisk()
    expect(cfg.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(cfg.quiz.mode).toBe('solo')
  })
})
