import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * liff-template/ เป็นโปรเจกต์ปลายทางที่จะถูก assemble เข้า zip export (Task 13/14) —
 * ไม่ได้ npm install/build ในรีโปนี้เลย เทสต์นี้จึงตรวจแค่ว่าไฟล์ static ที่จำเป็นมีอยู่จริง
 * และมีรูปแบบถูกต้อง (repo-hygiene check ไม่ใช่ TDD ของ logic)
 */
const ROOT = join(__dirname, '..', '..', 'liff-template')

describe('liff-template scaffold', () => {
  it('has the required top-level project files', () => {
    for (const file of ['package.json', 'tsconfig.json', 'next.config.ts', '.env.example', 'README.md', '.gitignore']) {
      expect(existsSync(join(ROOT, file)), `${file} should exist`).toBe(true)
    }
  })

  it('package.json is valid JSON with the required scripts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('liff-quiz-template')
    for (const script of ['dev', 'build', 'start', 'test', 'typecheck']) {
      expect(pkg.scripts[script], `scripts.${script} should exist`).toBeTruthy()
    }
  })

  it('config/quiz.config.sample.json is valid JSON with schemaVersion 1', () => {
    const sample = JSON.parse(readFileSync(join(ROOT, 'config', 'quiz.config.sample.json'), 'utf8'))
    expect(sample.schemaVersion).toBe(1)
    expect(sample.quiz.mode).toBe('solo')
  })

  it('README documents every required env var from .env.example', () => {
    const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    const varNames = [...envExample.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1])
    expect(varNames.length).toBeGreaterThan(0)
    for (const name of varNames) {
      expect(readme.includes(name), `README should mention ${name}`).toBe(true)
    }
  })
})
