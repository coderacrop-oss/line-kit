import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return []
    return [path]
  })
}

function localImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const [, spec] of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), spec)
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      try {
        if (statSync(candidate).isFile()) { found.push(candidate); break }
      } catch { /* not this one */ }
    }
  }
  return found
}

/**
 * No module may sit in a cycle with another.
 *
 * A cycle is the shape that makes two files impossible to reason about or test
 * apart, and it also breaks at runtime in ways that depend on which file was
 * imported first — a failure that moves when you look at it.
 */
describe('ไม่มีโมดูลไหนอ้างวนกลับมาหากัน', () => {
  const files = walk(join(ROOT, 'lib'))
  const graph = new Map(files.map((f) => [f, localImports(f)]))

  it(`มีไฟล์ให้ตรวจจริง (${files.length} ไฟล์)`, () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('ไม่มีวงจร', () => {
    const state = new Map<string, 'visiting' | 'done'>()
    const cycles: string[] = []

    const visit = (file: string, trail: string[]) => {
      if (state.get(file) === 'done') return
      if (state.get(file) === 'visiting') {
        const from = trail.indexOf(file)
        cycles.push([...trail.slice(from), file].map((f) => relative(ROOT, f)).join(' → '))
        return
      }
      state.set(file, 'visiting')
      for (const next of graph.get(file) ?? []) visit(next, [...trail, file])
      state.set(file, 'done')
    }

    for (const file of files) visit(file, [])
    expect(cycles).toEqual([])
  })

  it('ทุกไฟล์ import ได้เดี่ยวๆ โดยไม่ต้องมีใครมาก่อน', async () => {
    for (const file of files) {
      // db/ กับ line/client ต้องมี env จึงทดสอบแค่ว่า import ได้ ไม่ได้เรียกใช้
      await expect(import(file)).resolves.toBeDefined()
    }
  })
})
