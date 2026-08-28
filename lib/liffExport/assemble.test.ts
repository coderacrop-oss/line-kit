import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuizConfig } from '@/lib/quiz/schema'
import { TEMPLATE_SCHEMA_VERSION } from '@/liff-template/lib/schema'
import { __resetStaticFileCacheForTests, assembleTemplateFiles } from './assemble'

const TEMPLATE_ROOT = path.resolve(process.cwd(), 'liff-template')

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

beforeEach(() => { __resetStaticFileCacheForTests() })
afterEach(() => {
  vi.restoreAllMocks()
  __resetStaticFileCacheForTests()
})

describe('assembleTemplateFiles', () => {
  it('reads every file under liff-template/ and stamps the real config in place of the sample', async () => {
    const config = buildValidSoloConfig()
    const files = await assembleTemplateFiles(config)

    // ไฟล์ static ทั่วไปของ liff-template/ ต้องอยู่ครบ
    const paths = files.map((f) => f.path)
    expect(paths).toContain('package.json')

    // sample config ต้องถูกดร็อปออก แทนที่ด้วย quiz.config.json ที่ path ใหม่
    expect(paths).not.toContain('config/quiz.config.sample.json')
    const configEntry = files.find((f) => f.path === 'config/quiz.config.json')
    expect(configEntry).toBeDefined()

    const parsed = JSON.parse(configEntry!.content.toString('utf8'))
    // Finding 9: schemaVersion ต้องมาจาก TEMPLATE_SCHEMA_VERSION ตัวเดียวกับที่
    // liff-template/lib/schema.ts ใช้ ไม่ใช่ literal 1 แยกกันคนละที่ที่บังเอิญตรงกันวันนี้
    expect(parsed.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(parsed.quiz).toEqual(config)
  })

  it('leaves every other file unchanged (only the sample-config entry is swapped)', async () => {
    const config = buildValidSoloConfig()
    const files = await assembleTemplateFiles(config)

    const pkg = files.find((f) => f.path === 'package.json')
    const parsedPkg = JSON.parse(pkg!.content.toString('utf8'))
    expect(parsedPkg.name).toBe('liff-quiz-template')
  })

  it('throws listing the missing field when templateCopy is incomplete for the config mode', async () => {
    const config = buildValidSoloConfig()
    // ลบ soloShare ออก — โหมด solo ต้องมีฟิลด์นี้ตามกฎใน lib/quiz/schema.ts
    delete (config.templateCopy!.messages as { soloShare?: unknown }).soloShare

    await expect(assembleTemplateFiles(config)).rejects.toThrow(/templateCopy\.messages\.soloShare/)
  })

  it('throws when templateCopy is entirely missing', async () => {
    const config = buildValidSoloConfig()
    delete (config as { templateCopy?: unknown }).templateCopy

    await expect(assembleTemplateFiles(config)).rejects.toThrow(/templateCopy/)
  })

  /**
   * Finding 2 — liff-template/.env.local ตาม .gitignore ของโปรเจกต์นั้นเก็บ
   * LINE_CHANNEL_SECRET/ACCESS_TOKEN จริงของเครื่องที่ dev เทมเพลตนี้เอง ถ้าไฟล์นี้ดันมีอยู่
   * จริงบนเครื่องที่รัน export (เช่นแอดมิน dev เทมเพลตนี้เองด้วย) ต้องไม่หลุดติด zip ไปด้วย
   */
  it('never bundles dotfiles like .env.local even when one exists in the template source tree', async () => {
    const dotfilePath = path.join(TEMPLATE_ROOT, '.env.local')
    await fs.writeFile(dotfilePath, 'LINE_CHANNEL_SECRET=super-secret\nLINE_CHANNEL_ACCESS_TOKEN=super-secret-token\n')
    try {
      __resetStaticFileCacheForTests() // เพิ่งเขียนไฟล์ใหม่ — บังคับให้เดินดิสก์ใหม่แน่ๆ
      const config = buildValidSoloConfig()
      const files = await assembleTemplateFiles(config)
      const paths = files.map((f) => f.path)
      expect(paths).not.toContain('.env.local')
      expect(paths.some((p) => p.split('/').some((seg) => seg.startsWith('.')))).toBe(false)
    } finally {
      await fs.rm(dotfilePath, { force: true })
      __resetStaticFileCacheForTests()
    }
  })

  /**
   * Finding 10 — liff-template/ เป็นไฟล์ static ที่ไม่เปลี่ยนระหว่างที่ process รันอยู่
   * ไม่ควรเดินดิสก์ใหม่ทุก export request เลย เรียกซ้ำสองครั้งต้องอ่านดิสก์แค่ครั้งเดียว
   * (readdir/readFile จาก node:fs/promises) แล้วผลลัพธ์ยังถูกต้องเหมือนเดิม
   */
  it('caches the walked file list/contents after the first read, and reuses it on later calls', async () => {
    const readdirSpy = vi.spyOn(fs, 'readdir')
    const readFileSpy = vi.spyOn(fs, 'readFile')

    const config = buildValidSoloConfig()
    const first = await assembleTemplateFiles(config)
    expect(readdirSpy).toHaveBeenCalled()
    expect(readFileSpy).toHaveBeenCalled()

    const callsAfterFirst = readdirSpy.mock.calls.length
    const readCallsAfterFirst = readFileSpy.mock.calls.length

    const second = await assembleTemplateFiles(config)

    expect(readdirSpy.mock.calls.length).toBe(callsAfterFirst)
    expect(readFileSpy.mock.calls.length).toBe(readCallsAfterFirst)

    // ผลลัพธ์ยังถูกต้องเหมือนเดิมทั้งสองรอบ
    const firstPaths = first.map((f) => f.path).sort()
    const secondPaths = second.map((f) => f.path).sort()
    expect(secondPaths).toEqual(firstPaths)
    const pkg = second.find((f) => f.path === 'package.json')
    expect(JSON.parse(pkg!.content.toString('utf8')).name).toBe('liff-quiz-template')
  })
})
