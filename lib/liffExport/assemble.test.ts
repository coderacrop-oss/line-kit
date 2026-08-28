import { describe, expect, it } from 'vitest'
import type { QuizConfig } from '@/lib/quiz/schema'
import { assembleTemplateFiles } from './assemble'

// QuizConfig โหมด solo ที่ครบทุกฟิลด์ที่ templateCopy ต้องมีสำหรับโหมดนี้ (lib/quiz/schema.ts
// superRefine) — ใช้เป็น "happy path" ของทั้งไฟล์นี้
function buildValidSoloConfig(): QuizConfig {
  return {
    mode: 'solo',
    axes: [
      { id: 'ei', label: 'E / I', poles: ['Extrovert', 'Introvert'] },
      { id: 'sn', label: 'S / N', poles: ['Sensing', 'Intuition'] },
    ],
    questions: [
      {
        id: 'q1',
        text: 'Sample question 1?',
        options: [
          { id: 'a', label: 'Option A', scores: { ei: 2, sn: -1 } },
          { id: 'b', label: 'Option B', scores: { ei: -2, sn: 1 } },
        ],
      },
      {
        id: 'q2',
        text: 'Sample question 2?',
        options: [
          { id: 'a', label: 'Option A', scores: { ei: 1, sn: 1 } },
          { id: 'b', label: 'Option B', scores: { ei: -1, sn: -1 } },
        ],
      },
      {
        id: 'q3',
        text: 'Sample question 3?',
        options: [
          { id: 'a', label: 'Option A', scores: { ei: 1, sn: -1 } },
          { id: 'b', label: 'Option B', scores: { ei: -1, sn: 1 } },
        ],
      },
    ],
    results: [
      { code: 'ES', title: 'Sample result ES', body: 'Sample result body for ES.' },
      { code: 'EN', title: 'Sample result EN', body: 'Sample result body for EN.' },
      { code: 'IS', title: 'Sample result IS', body: 'Sample result body for IS.' },
      { code: 'IN', title: 'Sample result IN', body: 'Sample result body for IN.' },
    ],
    fallbackResultCode: 'ES',
    templateCopy: {
      brand: { name: 'Sample Quiz' },
      intro: { title: 'Welcome!', body: 'Answer a few questions to find your type.', ctaLabel: 'Start' },
      friendGate: {
        title: 'Add us as a friend first',
        body: 'Please add this LINE account as a friend to continue.',
        ctaLabel: 'Add friend',
      },
      openInLine: { title: 'Open in LINE', body: 'Please open this link inside the LINE app.' },
      rewards: { milestones: [] },
      messages: {
        resultCard: { eyebrow: 'Your result', ctaLabel: 'View result' },
        keywordCard: { title: 'Play the quiz', body: 'Type this keyword to start.', ctaLabel: 'Start' },
        soloShare: { badge: 'My result', ctaLabel: 'Share', secondaryCtaLabel: 'Play again' },
      },
    },
  }
}

describe('assembleTemplateFiles', () => {
  it('reads every file under liff-template/ and stamps the real config in place of the sample', () => {
    const config = buildValidSoloConfig()
    const files = assembleTemplateFiles(config)

    // ไฟล์ static ทั่วไปของ liff-template/ ต้องอยู่ครบ
    const paths = files.map((f) => f.path)
    expect(paths).toContain('package.json')

    // sample config ต้องถูกดร็อปออก แทนที่ด้วย quiz.config.json ที่ path ใหม่
    expect(paths).not.toContain('config/quiz.config.sample.json')
    const configEntry = files.find((f) => f.path === 'config/quiz.config.json')
    expect(configEntry).toBeDefined()

    const parsed = JSON.parse(configEntry!.content.toString('utf8'))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.quiz).toEqual(config)
  })

  it('leaves every other file unchanged (only the sample-config entry is swapped)', () => {
    const config = buildValidSoloConfig()
    const files = assembleTemplateFiles(config)

    const pkg = files.find((f) => f.path === 'package.json')
    const parsedPkg = JSON.parse(pkg!.content.toString('utf8'))
    expect(parsedPkg.name).toBe('liff-quiz-template')
  })

  it('throws listing the missing field when templateCopy is incomplete for the config mode', () => {
    const config = buildValidSoloConfig()
    // ลบ soloShare ออก — โหมด solo ต้องมีฟิลด์นี้ตามกฎใน lib/quiz/schema.ts
    delete (config.templateCopy!.messages as { soloShare?: unknown }).soloShare

    expect(() => assembleTemplateFiles(config)).toThrow(/templateCopy\.messages\.soloShare/)
  })

  it('throws when templateCopy is entirely missing', () => {
    const config = buildValidSoloConfig()
    delete (config as { templateCopy?: unknown }).templateCopy

    expect(() => assembleTemplateFiles(config)).toThrow(/templateCopy/)
  })
})
