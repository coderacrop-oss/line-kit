// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ActivityRow as Row, summarizeActivity } from '@/lib/db/activities'
import { ActivityRow } from './ActivityRow'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', () => ({
  db: () => { throw new Error('การวาดแถวต้องไม่แตะฐานข้อมูล') },
}))
vi.mock('@/lib/auth/require', () => ({ requireRole: vi.fn() }))

const row = (patch: Partial<Row> = {}): Row => ({
  id: 'act-1',
  code: 'draw',
  name: 'สุ่มรางวัล',
  input_type: 'none',
  resolve_method: 'weighted',
  input_config: {},
  resolve_config: { outcomes: [{ id: 'o1', cardId: 'card-1' }] },
  entry_rules: [],
  effects: [],
  fallback_card_id: null,
  trigger: 'manual',
  is_enabled: true,
  sort_order: 0,
  reached_by: ['คีย์เวิร์ด "เล่น"'],
  links: ['win'],
  ...patch,
})

const draw = (patch: Partial<Row> = {}, canEdit = true) => render(
  <ActivityRow campaignId="c1" activity={summarizeActivity(row(patch))} canEdit={canEdit} />,
)

describe('แถวหนึ่งของกิจกรรม · โครงจากต้นแบบ', () => {
  it('ชื่อกิจกรรมพาไปหน้าตั้งค่าของตัวมันเอง', () => {
    draw()
    expect(screen.getByRole('link', { name: 'สุ่มรางวัล' }).getAttribute('href'))
      .toBe('/campaigns/c1/activities/act-1')
  })

  /**
   * ควิซบุคลิกภาพไม่มีจอ M7-S02 ให้ตั้งค่า (resolve_method เป็น NULL ทำให้จอนั้น
   * throw — ดูคอมเมนต์ของ fieldsForActivity ใน lib/db/activities.ts) ทั้งชื่อและ
   * ปุ่ม "ตั้งค่า →" ต้องพาไปจอควิซของ Task 11 แทน ไม่ใช่จอเดิม
   */
  it('กิจกรรมควิซบุคลิกภาพพาไปจอควิซของ Task 11 ไม่ใช่จอ M7-S02 เดิม', () => {
    const { container } = draw({
      input_type: 'personality_quiz',
      resolve_method: null as unknown as Row['resolve_method'],
    })
    expect(screen.getByRole('link', { name: 'สุ่มรางวัล' }).getAttribute('href'))
      .toBe('/campaigns/c1/activities/act-1/quiz')
    const setup = within(container).getByText('ตั้งค่า →').closest('a')
    expect(setup?.getAttribute('href')).toBe('/campaigns/c1/activities/act-1/quiz')
  })

  it('แสดงรหัสกิจกรรมไว้ข้างชื่อ · เป็นสิ่งที่ปุ่มบนการ์ดอ้างถึง', () => {
    draw()
    expect(screen.getByText('draw')).toBeDefined()
  })

  it('บอกคู่แกนด้วยชื่อที่คนอ่านออก ไม่ใช่ค่าดิบจากคอลัมน์', () => {
    draw({ input_type: 'pick_one', resolve_method: 'quota', fallback_card_id: 'card-2' })
    expect(screen.getByText('ให้เลือกจากตาราง')).toBeDefined()
    expect(screen.getByText('สุ่มจนกว่าของจะหมด')).toBeDefined()
  })

  it('ประโยคสรุปเงื่อนไขอยู่ใต้ชื่อ', () => {
    draw({ entry_rules: [{ type: 'limit', cardId: 'card-1' }] })
    expect(screen.getByText('จำกัดจำนวนครั้งต่อรอบ')).toBeDefined()
  })

  it('ไม่มีเงื่อนไขก็ยังพูด ไม่ใช่ปล่อยบรรทัดว่าง', () => {
    draw()
    expect(screen.getByText('ไม่มีเงื่อนไข — ผู้เล่นกดเล่นได้เสมอ')).toBeDefined()
  })
})

/**
 * ป้ายสามอันของต้นแบบ ไม่ใช่ของประดับ
 *
 * "ไม่มีทางเข้าถึง" is the claim worth opening this screen for: no keyword, no
 * button and no follow trigger points at the activity, so it will never run no
 * matter how correct the rest of it is, and nothing else in the system says so.
 */
describe('ป้ายสถานะ', () => {
  it('กิจกรรมที่ไม่มีคีย์เวิร์ดหรือปุ่มพามา ติดป้ายว่าไม่มีทางเข้าถึง', () => {
    draw({ reached_by: [] })
    expect(screen.getByText('ไม่มีทางเข้าถึง')).toBeDefined()
  })

  it('มีทางเข้าแล้ว ไม่ติดป้ายนั้น', () => {
    draw()
    expect(screen.queryByText('ไม่มีทางเข้าถึง')).toBeNull()
  })

  it('กิจกรรมทักทายไม่ติดป้ายไม่มีทางเข้าถึง แม้ไม่มีคีย์เวิร์ดชี้มา', () => {
    draw({ trigger: 'follow', reached_by: [] })
    expect(screen.queryByText('ไม่มีทางเข้าถึง')).toBeNull()
    expect(screen.getByText('⌂ เข้าจากเมนูหลัก')).toBeDefined()
  })

  it('กิจกรรมที่ยังกรอกไม่ครบ ติดป้ายไว้', () => {
    draw({ resolve_config: { outcomes: [] } })
    expect(screen.getByText('ตั้งค่าไม่ครบ')).toBeDefined()
  })

  it('กิจกรรมที่ครบแล้ว ไม่ติดป้ายนั้น', () => {
    draw()
    expect(screen.queryByText('ตั้งค่าไม่ครบ')).toBeNull()
  })

  it('แถว "เข้าจาก" กับ "พาไป" แสดงทางเดินที่มีอยู่จริง', () => {
    draw()
    expect(screen.getByText('คีย์เวิร์ด "เล่น"')).toBeDefined()
    expect(screen.getByText('win')).toBeDefined()
  })

  it('ไม่มีทางเดิน ก็ไม่มีแถวเปล่าค้างไว้', () => {
    const { container } = draw({ reached_by: [], links: [] })
    expect(container.textContent).not.toContain('พาไป →')
    expect(container.textContent).not.toContain('เข้าจาก →')
  })
})

describe('สิ่งที่คนแก้ไม่ได้จะไม่เห็น', () => {
  it('ผู้ตั้งค่าเห็นสวิตช์เปิดปิดและปุ่มลบ', () => {
    const { container } = draw()
    expect(screen.getByRole('button', { name: 'เปิดอยู่' })).toBeDefined()
    expect(container.querySelectorAll('form').length).toBe(2)
  })

  it('สวิตช์บอกสถานะปัจจุบัน ไม่ใช่สิ่งที่จะเกิดขึ้นถ้ากด', () => {
    draw({ is_enabled: false })
    expect(screen.getByRole('button', { name: 'ปิดอยู่' })).toBeDefined()
  })

  it('คนที่แก้ไม่ได้ ไม่เห็นฟอร์มสักอัน', () => {
    const { container } = draw({}, false)
    expect(container.querySelectorAll('form').length).toBe(0)
  })

  it('คนที่แก้ไม่ได้ ยังเปิดเข้าไปดูได้', () => {
    const { container } = draw({}, false)
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toContain('/campaigns/c1/activities/act-1')
  })

  it('ปุ่มตั้งค่าพาไปที่เดียวกับชื่อ', () => {
    const { container } = draw()
    const setup = within(container).getByText('ตั้งค่า →').closest('a')
    expect(setup?.getAttribute('href')).toBe('/campaigns/c1/activities/act-1')
  })
})
