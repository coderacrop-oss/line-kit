// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuizConfig } from '@/lib/quiz/schema'
import { QuizConfigForm } from './QuizConfigForm'

afterEach(cleanup)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const saveQuizConfigAction = vi.fn(
  async (_campaignId: string, _activityId: string, _formData: FormData) => ({ ok: true as const }),
)
// อ้าง saveQuizConfigAction ผ่านฟังก์ชันซ้อน ไม่ใช่ property shorthand ตรงๆ — vi.mock
// factory ถูก hoist ขึ้นไปบนสุดของไฟล์ อ้าง const ข้างนอกตรงๆ จะชน TDZ ("Cannot access
// before initialization") ห่อด้วยฟังก์ชันจึงเลื่อนการอ้างจริงไปจนกว่าจะถูกเรียกใช้ตอน
// component ทำงาน ซึ่ง const ข้างนอกถูก initialize ไปแล้วแน่นอน (เหมือน `refresh` ด้านบน
// ที่ปลอดภัยเพราะซ่อนอยู่หลัง `() => ({ refresh })` เหมือนกัน)
vi.mock('./actions', () => ({
  saveQuizConfigAction: (campaignId: string, activityId: string, formData: FormData) =>
    saveQuizConfigAction(campaignId, activityId, formData),
}))

/** ก้อนที่ page.tsx ส่งมาให้กิจกรรมที่เพิ่งสร้าง — ยังไม่มี axes/questions/results เลย */
const emptyDraft: QuizConfig = {
  mode: 'solo', axes: [], questions: [], results: [], fallbackResultCode: '',
}

const draw = (initial: QuizConfig = emptyDraft, canEdit = true) =>
  render(<QuizConfigForm campaignId="camp-1" activityId="act-1" initial={initial} canEdit={canEdit} />)

/** อ่านสถานะปัจจุบันของฟอร์มจากช่องเดียวที่มันส่งจริง — ไม่เดาจากสิ่งที่วาดบนจอ */
function readConfig(container: HTMLElement): QuizConfig {
  const hidden = container.querySelector('input[name="config"]') as HTMLInputElement
  return JSON.parse(hidden.value) as QuizConfig
}

describe('id ของคำถาม/ตัวเลือกใหม่ ไม่ชนกับของที่เหลืออยู่ (แก้บั๊กจาก array.length)', () => {
  /**
   * บั๊กเดิม: option ใหม่คำนวณ id จาก `options.length + 1` — มีตัวเลือก [o1, o2] แล้ว
   * ลบ o1 เหลือ [o2] (length 1) กด "เพิ่มตัวเลือก" ได้ id เป็น o2 (1+1=2) ชนกับตัวที่
   * เหลืออยู่ทันที ผู้ให้คะแนนจับคู่คำตอบด้วย options.find(o => o.id === ...) ซึ่งคืนตัวแรก
   * ที่ตรง — คำตอบของผู้เล่นจะถูกนับเป็นตัวเลือกอื่นที่ id ชนกันแทนแบบเงียบๆ
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

/**
 * ขยายแถวแกนที่ระบุ (คลิกปุ่มยุบ/ขยายของมัน) — ใช้เฉพาะตอนแกนยังไม่ถูกขยายมาก่อน เช่น
 * แกนที่มากับ `initial` ตอนโหลดหน้า เพราะ addAxis() เปิดแกนใหม่ให้อัตโนมัติอยู่แล้ว
 * (ดูคอมเมนต์ "แกนใหม่เปิดให้แก้ทันที" ใน QuizConfigForm.tsx) — เรียกซ้ำกับแกนที่เปิดอยู่
 * แล้วจะกลายเป็นการปิดมันแทน
 */
function expandAxis(container: HTMLElement, index: number): void {
  const toggle = container.querySelector(`[data-axis="${index}"] button[aria-expanded]`) as HTMLElement
  fireEvent.click(toggle)
}

describe('ฟิลด์เสริมของแกน (labelEn/body/short/imageUrl/order) — ปุ่ม toggle ระดับทั้งลิสต์', () => {
  it('ปุ่ม "+ EN Title" เป็น toggle ระดับทั้งลิสต์ — มีผลไม่ว่าจะไปเปิดดูแกนไหนก็ตาม ไม่ใช่แค่แกนที่เปิดอยู่ตอนกด', () => {
    // จอนี้ขยายได้ทีละแกน (accordion) — เทสต์นี้จึงพิสูจน์ "global" ด้วยการสลับไปเปิดแกนที่สอง
    // แล้วเห็นช่อง EN Title โดยไม่ต้องกดปุ่มซ้ำ แทนที่จะเช็คว่าทั้งคู่โชว์พร้อมกัน (เป็นไปไม่ได้
    // ในจอนี้เพราะเปิดได้ทีละแถว)
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มแกน')) // แกน 0 — เปิดอัตโนมัติ
    fireEvent.click(screen.getByText('＋ เพิ่มแกน')) // แกน 1 — เปิดอัตโนมัติ แกน 0 ถูกยุบกลับ

    expect(screen.queryByLabelText('EN Title')).toBeNull()
    fireEvent.click(screen.getByText('+ EN Title'))
    expect(screen.getByLabelText('EN Title')).toBeDefined() // เห็นทันทีที่แกน 1 ซึ่งเปิดอยู่ตอนนี้

    // สลับไปเปิดแกน 0 แทน — ไม่ต้องกดปุ่ม toggle ซ้ำ ก็ยังเห็นช่อง EN Title เหมือนกัน
    expandAxis(container, 1) // ปิดแกน 1
    expandAxis(container, 0) // เปิดแกน 0
    expect(screen.getByLabelText('EN Title')).toBeDefined()
  })

  it('พิมพ์ค่าใน EN Title แล้วปิดปุ่ม toggle — ช่องหายไปแต่ค่าที่กรอกไว้ยังอยู่ใน config ที่จะส่ง', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มแกน')) // แกนใหม่เปิดอยู่แล้วอัตโนมัติ
    fireEvent.click(screen.getByText('+ EN Title'))

    fireEvent.change(screen.getByLabelText('EN Title'), { target: { value: 'THE THINKER' } })
    expect(readConfig(container).axes[0].labelEn).toBe('THE THINKER')

    // ปิด toggle — ช่องกรอกหายไปจากจอ
    fireEvent.click(screen.getByText('✓ EN Title'))
    expect(screen.queryByLabelText('EN Title')).toBeNull()
    // แต่ค่าที่กรอกไว้ก่อนหน้ายังอยู่ใน config ที่จะส่งจริง ไม่ได้ถูกลบทิ้ง
    expect(readConfig(container).axes[0].labelEn).toBe('THE THINKER')

    // เปิดใหม่ — ค่าเดิมยังอยู่ในช่องกรอก ไม่ได้หายไปตอนซ่อน
    fireEvent.click(screen.getByText('+ EN Title'))
    expect((screen.getByLabelText('EN Title') as HTMLInputElement).value).toBe('THE THINKER')
  })

  it('โหลด config ที่มีแกนซึ่งตั้ง short ไว้ก่อนแล้ว — ปุ่ม Short เปิดอยู่เองตั้งแต่โหลดหน้า ไม่ต้องกดเอง', () => {
    const initial: QuizConfig = {
      mode: 'solo', fallbackResultCode: '',
      axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'], short: 'นักคิด' }],
      questions: [], results: [],
    }
    const { container } = draw(initial)
    // แกนนี้มากับ initial ไม่ใช่แกนที่เพิ่งกด addAxis — ยังไม่ถูกขยาย ต้องเปิดเอง
    expandAxis(container, 0)
    expect((screen.getByLabelText('Short') as HTMLInputElement).value).toBe('นักคิด')
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

/**
 * แถบข้าง (sidebar) — ภาพรวม + สถานะ validate ต้องสดตาม draft เสมอ ไม่ต้องกดปุ่มตรวจ
 * (docs/superpowers/specs/2026-08-28-quiz-config-ux-redesign-design.md หลักการข้อ 2/6)
 */
describe('แถบข้าง — ภาพรวมและสถานะ validate สดตาม draft', () => {
  const validSoloDraft: QuizConfig = {
    mode: 'solo',
    axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }],
    questions: [
      { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
      { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { sn: 1 } }, { id: 'b', label: 'B', scores: { sn: -1 } }] },
      { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    ],
    results: [{ code: 'ES', title: 't', body: 'b' }, { code: 'IN', title: 't', body: 'b' }],
    fallbackResultCode: 'ES',
  }

  it('นับจำนวนแกน/คำถาม/ผลลัพธ์ตรงกับ draft', () => {
    draw(validSoloDraft)
    expect(screen.getByText('2 แกน')).toBeDefined()
    expect(screen.getByText('3 คำถาม')).toBeDefined()
    expect(screen.getByText('2 ผลลัพธ์')).toBeDefined()
  })

  it('config ที่ยังไม่ครบ (safeParse ล้มเหลว) — สถานะบอก "ขาด N อย่าง"', () => {
    draw() // emptyDraft
    expect(screen.getByText(/^✕ ขาด \d+ อย่าง$/)).toBeDefined()
  })

  it('config ที่ครบและถูกต้องตาม schema — สถานะบอกพร้อมใช้', () => {
    draw(validSoloDraft)
    expect(screen.getByText('✓ พร้อมใช้ — บันทึกได้')).toBeDefined()
  })
})

/**
 * ScoreDial — คะแนนต่อแกนต่อตัวเลือกเป็นปุ่มคลิก ไม่ใช่ number input ดิบ (หลักการข้อ 3)
 */
describe('ScoreDial — คลิกตั้งคะแนนของตัวเลือก', () => {
  it('คลิกปุ่ม +2 ของแกนหนึ่ง อัปเดตคะแนนตัวเลือกนั้นให้เป็น 2', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    const axisId = readConfig(container).axes[0].id

    // คำถามใหม่มีสองตัวเลือกเริ่มต้น ทั้งคู่มี dial ของแกนเดียวกัน (ป้ายเดียวกัน) — เอาอันแรก
    // ซึ่งคือ dial ของตัวเลือกแรก
    const [dial] = screen.getAllByRole('group', { name: `คะแนนของแกน ${axisId}` })
    fireEvent.click(within(dial).getByRole('button', { name: 'ตั้งคะแนนเป็น +2' }))

    const option = readConfig(container).questions[0].options[0]
    expect(option.scores[axisId]).toBe(2)
  })

  it('ไม่มีการกรอกตัวเลข — ไม่มี number input ดิบเหลืออยู่ในฟอร์มเลย', () => {
    const { container } = draw()
    fireEvent.click(screen.getByText('＋ เพิ่มแกน'))
    fireEvent.click(screen.getByText('＋ เพิ่มคำถาม'))
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0)
  })
})

/**
 * กริดผลลัพธ์โหมด duo — คลิก cell ว่างสร้างผลลัพธ์พร้อม pair เติมไว้ให้แล้ว ไม่ใช่ปุ่ม
 * "+ เพิ่มผลลัพธ์" ตัวเดียวที่ต้องมาเลือก pair เองทีหลัง (หลักการข้อ 4)
 */
describe('กริดผลลัพธ์ (โหมด duo)', () => {
  const duoDraft: QuizConfig = {
    mode: 'duo',
    axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }],
    questions: [], results: [], fallbackResultCode: '',
  }

  it('คลิก cell ว่างของคู่แกนหนึ่ง สร้างผลลัพธ์ใหม่ที่ pair ตรงกับคู่ที่คลิก', () => {
    const { container } = draw(duoDraft)
    // คู่ (E/I × S/N) ไม่สนลำดับ จึงมีสอง cell ที่ label เดียวกัน (มุมสะท้อนกันของเมทริกซ์) —
    // คลิกอันแรกก็พอ ทั้งคู่ชี้ pair เดียวกัน
    fireEvent.click(screen.getAllByRole('button', { name: 'คู่ E/I × S/N' })[0])
    const results = readConfig(container).results
    expect(results).toHaveLength(1)
    expect(new Set(results[0].pair)).toEqual(new Set(['ei', 'sn']))
  })

  it('คลิก cell เส้นทแยงมุม (แกนคู่กับตัวเอง) ก็สร้างผลลัพธ์ได้ — เป็นคู่ที่ถูกต้องตาม engine', () => {
    const { container } = draw(duoDraft)
    fireEvent.click(screen.getByRole('button', { name: 'คู่ E/I × E/I' }))
    const results = readConfig(container).results
    expect(results).toHaveLength(1)
    expect(results[0].pair).toEqual(['ei', 'ei'])
  })
})

/**
 * checklist ผลลัพธ์โหมด solo — คลิกช่องรหัสที่ยังไม่มี สร้างผลลัพธ์ด้วยรหัสนั้นตรงๆ
 */
describe('checklist ผลลัพธ์ (โหมด solo)', () => {
  const soloDraft: QuizConfig = {
    mode: 'solo',
    axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
    questions: [], results: [], fallbackResultCode: '',
  }

  it('คลิกรหัสที่ยังไม่มี (เช่น "E") สร้างผลลัพธ์ใหม่ด้วยรหัสนั้น', () => {
    const { container } = draw(soloDraft)
    fireEvent.click(screen.getByRole('button', { name: 'รหัส E' }))
    const results = readConfig(container).results
    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('E')
  })
})

/**
 * โหมด "ลองเล่น" (Play) — เป็น stub บอกตรงๆ ว่ายังไม่พร้อมใช้งาน ไม่ใช่ตัวจำลองจริง (บอก
 * ไว้ชัดเจนในรายงานเช่นกัน — ดู design note §5)
 */
describe('โหมด ลองเล่น (Play) — ยังเป็น stub', () => {
  it('สลับไปโหมดลองเล่น ซ่อนฟอร์มตั้งค่า และบอกตรงๆ ว่ายังไม่พร้อมใช้งาน', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: '▶ ลองเล่น' }))
    expect(screen.getByText('ยังไม่พร้อมใช้งานในรอบนี้')).toBeDefined()
    expect(screen.queryByText('＋ เพิ่มแกน')).toBeNull()
  })

  it('สลับกลับไปตั้งค่า ฟอร์มกลับมาเหมือนเดิม', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: '▶ ลองเล่น' }))
    fireEvent.click(screen.getByRole('button', { name: '📐 ตั้งค่า' }))
    expect(screen.getByText('＋ เพิ่มแกน')).toBeDefined()
  })
})

/**
 * "⚙️ ตั้งค่าเพิ่มเติม" (GroupConfigEditor) ต้องถูกยุบไว้เป็นค่าเริ่มต้น — เป็นของที่แก้ไม่บ่อย
 * (หลักการข้อ 5)
 */
describe('ตั้งค่าเพิ่มเติม (group config) — ยุบไว้เป็นค่าเริ่มต้น', () => {
  it('รายละเอียด details ปิดอยู่ตอนเปิดจอครั้งแรก', () => {
    const { container } = draw()
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
  })
})
