import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import landmarks from './design/landmarks.json'

/**
 * จอที่สร้างแล้วต้องมีข้อความของต้นแบบอยู่ครบ
 *
 * "Follow docs/design/flex-builder-prototype.html" was an instruction an agent
 * could quietly not follow, and one did. This turns it into something that
 * fails a build: every screen names the strings it must contain, and drifting
 * away from them takes deleting a line from tests/design/landmarks.json, which
 * is a visible act rather than an omission.
 *
 * It reads source text rather than rendering. Half of these strings live inside
 * a branch that needs a database, a role and a campaign in the right state to
 * appear, and a harness that could only see the default branch would let the
 * other half be deleted without a word. Reading the file catches a deletion no
 * matter which branch it was hiding in.
 */

type Screen = {
  label: string
  source: string
  origin: 'prototype' | 'local'
  originNote?: string
  landmarks: string[]
  rejected: Record<string, string>
}

const screens = Object.entries(landmarks.screens as Record<string, Screen>)

// ต้นฉบับ .tsx ขึ้นบรรทัดใหม่ตรงไหนก็ได้ · ยุบช่องว่างก่อนเทียบ จะได้วัดคำที่เขียน
// ไม่ใช่วัดว่าบรรทัดยาวเท่าไหร่ตอน format
const flatten = (text: string) => text.replace(/\s+/g, ' ')

describe('จอที่สร้างแล้วยังตรงกับต้นแบบ', () => {
  it.each(screens)('%s', (code, screen) => {
    expect(existsSync(screen.source), `${code} ไม่มีไฟล์ ${screen.source}`).toBe(true)

    const source = flatten(readFileSync(screen.source, 'utf8'))

    // เก็บที่ขาดให้ครบก่อนแล้วค่อยฟ้องทีเดียว · ฟ้องตัวแรกแล้วหยุด แปลว่าต้องรัน
    // เทสต์นี้ซ้ำอีกสิบรอบกว่าจะเห็นว่าจริงๆ แล้วขาดอะไรบ้าง
    const missing = screen.landmarks.filter((mark) => !source.includes(flatten(mark)))

    expect(missing, `${code} · ${screen.label} · ${screen.source}`).toEqual([])
  })
})

describe('ตัวไฟล์ landmark เอง', () => {
  it('ทุกจอมีต้นทางบอกว่าถอดมาจากไหน', () => {
    for (const [code, screen] of screens) {
      expect(['prototype', 'local'], code).toContain(screen.origin)
      // จอที่ต้นแบบไม่มีต้องเขียนไว้ว่าเอาอะไรมาเป็นเกณฑ์แทน ไม่งั้นคนอ่านทีหลัง
      // จะนึกว่ามันก็ถอดมาจากต้นแบบเหมือนกัน
      if (screen.origin === 'local') {
        expect(screen.originNote?.length ?? 0, `${code} ขาด originNote`).toBeGreaterThan(20)
      }
    }
  })

  it('ทุกจอมี landmark อย่างน้อยหนึ่งอัน และไม่มีอันซ้ำ', () => {
    for (const [code, screen] of screens) {
      expect(screen.landmarks.length, code).toBeGreaterThan(0)
      expect(new Set(screen.landmarks).size, `${code} มี landmark ซ้ำ`).toBe(screen.landmarks.length)
    }
  })

  it('ข้อความที่ตัดออกต้องมีเหตุผลกำกับทุกอัน', () => {
    // ที่ทิ้งของไว้ในนี้ได้โดยไม่ต้องบอกเหตุผล คือที่ที่ landmark ไปตายเงียบๆ
    for (const [code, screen] of screens) {
      for (const [text, reason] of Object.entries(screen.rejected)) {
        expect(reason.length, `${code} · ตัด "${text}" ออกโดยไม่บอกเหตุผล`).toBeGreaterThan(20)
      }
    }
  })

  it('ทุกจอที่มีอยู่ในโค้ดต้องมีรายการของตัวเอง', () => {
    // จอใหม่ที่ไม่มี landmark คือรูที่ทำให้เทสต์นี้เงียบไปทีละจอ · การลบจอออกจาก
    // landmarks.json เพื่อให้เทสต์ผ่านก็มาโผล่ตรงนี้เหมือนกัน
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name))
        else if (entry.name === 'page.tsx') pages.push(join(dir, entry.name))
      }
    }
    walk('app')

    const known = new Set([
      ...screens.map(([, screen]) => screen.source),
      ...Object.keys(landmarks._exempt),
    ])
    expect(pages.filter((page) => !known.has(page))).toEqual([])
  })

  it('ข้อความที่ตัดออกแล้วห้ามอยู่ในรายการที่บังคับพร้อมกัน', () => {
    for (const [code, screen] of screens) {
      for (const text of Object.keys(screen.rejected)) {
        expect(screen.landmarks, `${code} · "${text}" อยู่ทั้งสองฝั่ง`).not.toContain(text)
      }
    }
  })
})
