// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuizConfig } from '@/lib/quiz/schema'
import { QuizConfigForm } from './QuizConfigForm'

afterEach(cleanup)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const saveQuizConfigAction = vi.fn(async (_activityId: string, _formData: FormData) => ({ ok: true as const }))
// อ้าง saveQuizConfigAction ผ่านฟังก์ชันซ้อน ไม่ใช่ property shorthand ตรงๆ — vi.mock
// factory ถูก hoist ขึ้นไปบนสุดของไฟล์ อ้าง const ข้างนอกตรงๆ จะชน TDZ ("Cannot access
// before initialization") ห่อด้วยฟังก์ชันจึงเลื่อนการอ้างจริงไปจนกว่าจะถูกเรียกใช้ตอน
// component ทำงาน ซึ่ง const ข้างนอกถูก initialize ไปแล้วแน่นอน (เหมือน `refresh` ด้านบน
// ที่ปลอดภัยเพราะซ่อนอยู่หลัง `() => ({ refresh })` เหมือนกัน)
vi.mock('./actions', () => ({
  saveQuizConfigAction: (activityId: string, formData: FormData) => saveQuizConfigAction(activityId, formData),
}))

/** ก้อนที่ page.tsx ส่งมาให้กิจกรรมที่เพิ่งสร้าง — ยังไม่มี axes/questions/results เลย */
const emptyDraft: QuizConfig = {
  mode: 'solo', axes: [], questions: [], results: [], fallbackResultCode: '',
}

const draw = (initial: QuizConfig = emptyDraft, canEdit = true) =>
  render(<QuizConfigForm activityId="act-1" initial={initial} canEdit={canEdit} />)

/** อ่านสถานะปัจจุบันของฟอร์มจากช่องเดียวที่มันส่งจริง — ไม่เดาจากสิ่งที่วาดบนจอ */
function readConfig(container: HTMLElement): QuizConfig {
  const hidden = container.querySelector('input[name="config"]') as HTMLInputElement
  return JSON.parse(hidden.value) as QuizConfig
}

describe('id ของคำถาม/ตัวเลือกใหม่ ไม่ชนกับของที่เหลืออยู่ (แก้บั๊กจาก array.length)', () => {
  /**
   * บั๊กเดิม: option ใหม่คำนวณ id จาก `options.length + 1` — มีตัวเลือก [o1, o2] แล้ว
   * ลบ o1 เหลือ [o2] (length 1) กด "เพิ่มตัวเลือก" ได้ id เป็น o2 (1+1=2) ชนกับตัวที่
   * เหลืออยู่ทันที lib/quiz/engine.ts จับคู่คำตอบด้วย options.find(o => o.id === ...)
   * ซึ่งคืนตัวแรกที่ตรง — คำตอบของผู้เล่นจะถูกนับเป็นตัวเลือกอื่นที่ id ชนกันแทนแบบเงียบๆ
   * เทสต์นี้คือ repro เป๊ะๆ ของ "เพิ่ม → ลบ → เพิ่ม" ที่ทำให้เกิดบั๊ก
   */
  it('เพิ่มตัวเลือก → ลบตัวเลือกแรก → เพิ่มตัวเลือกใหม่อีกครั้ง ไม่ได้ id ที่ชนกับตัวที่เหลืออยู่', () => {
    const { container } = draw()

    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    // เริ่มด้วยตัวเลือกสองอัน (o1, o2) ตามค่าเริ่มต้นของคำถามใหม่
    expect(readConfig(container).questions[0].options).toHaveLength(2)
    const [firstId, secondId] = readConfig(container).questions[0].options.map((o) => o.id)
    expect(firstId).not.toBe(secondId)

    // ลบตัวเลือกแรก (o1) เหลือแค่ตัวที่สอง (o2)
    fireEvent.click(screen.getAllByText('เอาตัวเลือกนี้ออก')[0])
    expect(readConfig(container).questions[0].options.map((o) => o.id)).toEqual([secondId])

    // เพิ่มตัวเลือกใหม่อีกครั้ง — จุดที่บั๊กเดิมคำนวณ id ชนกับ secondId (length 1 + 1 = 2 = "o2")
    fireEvent.click(screen.getByText('＋ เพิ่มตัวเลือก'))
    const options = readConfig(container).questions[0].options
    expect(options).toHaveLength(2)
    const ids = options.map((o) => o.id)
    expect(new Set(ids).size).toBe(2) // ไม่มี id ซ้ำ
    expect(ids.filter((id) => id === secondId)).toHaveLength(1) // secondId ยังอยู่แค่ที่เดียว ไม่ถูกชน
  })

  /** เหตุผลเดียวกับตัวเลือก แต่ที่ตัวคำถามเอง — เพิ่ม 3 ข้อ ลบข้อแรก แล้วเพิ่มอีกข้อ */
  it('เพิ่มคำถาม → ลบคำถามแรก → เพิ่มคำถามใหม่อีกครั้ง ไม่ได้ id ที่ชนกับข้อที่เหลืออยู่', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    const idsBefore = readConfig(container).questions.map((q) => q.id)
    expect(new Set(idsBefore).size).toBe(2)

    fireEvent.click(screen.getAllByText('เอาคำถามข้อนี้ออก')[0])
    const survivingId = readConfig(container).questions[0].id
    expect(survivingId).toBe(idsBefore[1])

    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    const idsAfter = readConfig(container).questions.map((q) => q.id)
    expect(idsAfter).toHaveLength(2)
    expect(new Set(idsAfter).size).toBe(2)
  })

  /** ผลลัพธ์ก็เหมือนกัน — code ใหม่ต้องไม่ชนกับ code ที่ผู้ใช้ยังไม่ได้แก้ */
  it('เพิ่มผลลัพธ์ → ลบผลลัพธ์แรก → เพิ่มผลลัพธ์ใหม่อีกครั้ง ไม่ได้ code ที่ชนกัน', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const codesBefore = readConfig(container).results.map((r) => r.code)
    expect(new Set(codesBefore).size).toBe(2)

    fireEvent.click(screen.getAllByText('เอาผลลัพธ์นี้ออก')[0])
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const codesAfter = readConfig(container).results.map((r) => r.code)
    expect(codesAfter).toHaveLength(2)
    expect(new Set(codesAfter).size).toBe(2)
  })
})

describe('เพิ่ม/ลบแถวของสามส่วนหลัก อัปเดตสถานะฟอร์มจริง', () => {
  it('เพิ่มแกน อัปเดตทั้งจำนวนแถวที่วาดและ config ที่จะส่ง', () => {
    const { container } = draw()
    expect(container.querySelectorAll('[data-axis]')).toHaveLength(0)

    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    expect(container.querySelectorAll('[data-axis]')).toHaveLength(1)
    expect(readConfig(container).axes).toHaveLength(1)

    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    expect(container.querySelectorAll('[data-axis]')).toHaveLength(2)
    expect(readConfig(container).axes).toHaveLength(2)
  })

  it('ลบแกน เอาแถวที่ระบุออกจากทั้งจอและ config', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    const [first] = readConfig(container).axes

    fireEvent.click(within(container.querySelector('[data-axis="0"]') as HTMLElement)
      .getByText('เอาแกนนี้ออก'))

    expect(container.querySelectorAll('[data-axis]')).toHaveLength(1)
    const remaining = readConfig(container).axes
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).not.toBe(first.id)
  })

  it('เพิ่มคำถาม อัปเดตทั้งจำนวนแถวที่วาดและ config ที่จะส่ง', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    expect(container.querySelectorAll('[data-question]')).toHaveLength(1)
    expect(readConfig(container).questions).toHaveLength(1)
  })

  it('ลบคำถาม เอาข้อที่ระบุออกจากทั้งจอและ config', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    fireEvent.click(screen.getAllByText('เอาคำถามข้อนี้ออก')[0])
    expect(container.querySelectorAll('[data-question]')).toHaveLength(1)
    expect(readConfig(container).questions).toHaveLength(1)
  })

  it('เพิ่มผลลัพธ์ อัปเดตทั้งจำนวนแถวที่วาดและ config ที่จะส่ง', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    expect(container.querySelectorAll('[data-result]')).toHaveLength(1)
    expect(readConfig(container).results).toHaveLength(1)
  })

  it('ลบผลลัพธ์ เอาแถวที่ระบุออกจากทั้งจอและ config', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    fireEvent.click(screen.getAllByText('เอาผลลัพธ์นี้ออก')[0])
    expect(container.querySelectorAll('[data-result]')).toHaveLength(1)
    expect(readConfig(container).results).toHaveLength(1)
  })
})

/**
 * pair ของผลลัพธ์ในโหมดคู่ (duo) — เลือกครบสองข้างจึงนับ ยังไม่ครบถือว่ายังไม่ระบุ
 * (schema เก็บเป็น tuple สองช่องพร้อมกันหรือไม่มีเลย ไม่มี "ครึ่งเดียว")
 */
describe('คู่แกนของผลลัพธ์ (pair) ในโหมดคู่', () => {
  function setupDuoResult() {
    const view = draw()
    const { container } = view
    fireEvent.change(within(container).getByRole('combobox', { name: 'โหมด' }), { target: { value: 'duo' } })
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const axisIds = readConfig(container).axes.map((a) => a.id)
    return { container, axisIds }
  }

  it('เลือกครบทั้งสองข้าง — pair ถูกตั้งเป็น tuple ของสองแกนนั้น', () => {
    const { container, axisIds } = setupDuoResult()
    const resultBox = container.querySelector('[data-result="0"]') as HTMLElement
    const selects = within(resultBox).getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: axisIds[0] } })
    fireEvent.change(selects[1], { target: { value: axisIds[1] } })
    expect(readConfig(container).results[0].pair).toEqual([axisIds[0], axisIds[1]])
  })

  it('ตั้งครบแล้วเปลี่ยนข้างใดข้างหนึ่งกลับเป็น "ไม่ระบุ" — pair ทั้งคู่ถูกล้าง ไม่ใช่เหลือครึ่งเดียวค้างไว้', () => {
    const { container, axisIds } = setupDuoResult()
    const resultBox = container.querySelector('[data-result="0"]') as HTMLElement
    const selects = within(resultBox).getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: axisIds[0] } })
    fireEvent.change(selects[1], { target: { value: axisIds[1] } })
    expect(readConfig(container).results[0].pair).toBeDefined()

    fireEvent.change(selects[0], { target: { value: '' } })
    expect(readConfig(container).results[0].pair).toBeUndefined()
  })
})

/**
 * fallbackResultCode ต้องไม่ค้างชี้ผลลัพธ์ที่ถูกลบไปแล้ว — ไม่งั้น validation จะฟ้อง
 * ตลอดไปว่า "fallbackResultCode ต้องมีอยู่จริงใน results" ทั้งที่ผู้ใช้ไม่ได้แตะช่องนั้นเลย
 */
describe('fallbackResultCode รีเซ็ตเองเมื่อผลลัพธ์ที่เลือกไว้ถูกลบ', () => {
  it('ลบผลลัพธ์ที่เป็น fallback อยู่ — สลับไปที่ผลลัพธ์ที่เหลือตัวแรกแทน', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const [first, second] = readConfig(container).results

    fireEvent.change(document.getElementById('fallback-result') as HTMLSelectElement, {
      target: { value: first.code },
    })
    expect(readConfig(container).fallbackResultCode).toBe(first.code)

    fireEvent.click(screen.getAllByText('เอาผลลัพธ์นี้ออก')[0])
    expect(readConfig(container).fallbackResultCode).toBe(second.code)
  })

  it('ลบผลลัพธ์ตัวสุดท้ายที่เหลืออยู่ ซึ่งเป็น fallback ด้วย — เคลียร์เป็นค่าว่าง ไม่ใช่ค้าง code เดิม', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const [only] = readConfig(container).results

    fireEvent.change(document.getElementById('fallback-result') as HTMLSelectElement, {
      target: { value: only.code },
    })
    fireEvent.click(screen.getAllByText('เอาผลลัพธ์นี้ออก')[0])
    expect(readConfig(container).fallbackResultCode).toBe('')
  })

  it('ลบผลลัพธ์ที่ไม่ใช่ fallback — fallbackResultCode ไม่ถูกแตะ', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    fireEvent.click(screen.getByText('＋ เพิ่มผลลัพธ์'))
    const [first, second] = readConfig(container).results

    fireEvent.change(document.getElementById('fallback-result') as HTMLSelectElement, {
      target: { value: second.code },
    })
    fireEvent.click(screen.getAllByText('เอาผลลัพธ์นี้ออก')[0]) // ลบ first ซึ่งไม่ใช่ fallback
    expect(readConfig(container).fallbackResultCode).toBe(second.code)
  })
})
