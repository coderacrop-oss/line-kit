import { describe, expect, it } from 'vitest'
import {
  INPUT_TYPES, RESOLVE_METHODS, comboProblem, fieldsFor, inputTypeName, resolveMethodName,
} from './wizard'

describe('fieldsFor', () => {
  it('pick_one ถามผังช่องและรายการตัวเลือก', () => {
    const keys = fieldsFor('pick_one', 'weighted').map((f) => f.key)
    expect(keys).toContain('grid')
    expect(keys).toContain('outcomes')
  })

  it('none ไม่ถามเรื่องอินพุตเลย', () => {
    expect(fieldsFor('none', 'weighted').map((f) => f.key)).not.toContain('grid')
  })

  it('score ถามช่วงคะแนน · weighted ถามน้ำหนัก', () => {
    expect(fieldsFor('quiz', 'score').map((f) => f.key)).toContain('score_bands')
    expect(fieldsFor('pick_one', 'weighted').map((f) => f.key)).toContain('weights')
  })

  it('quota บังคับถามการ์ดสำรอง (BR-31)', () => {
    const fallback = fieldsFor('none', 'quota').find((f) => f.key === 'fallback_card_id')
    expect(fallback?.required).toBe(true)
  })

  it('คู่ผสมทุกคู่คืนรายการช่อง ไม่มีคู่ไหนคืนว่าง', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        expect(fieldsFor(input, resolve).length, `${input} × ${resolve}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * BR-87 มีค่าก็ต่อเมื่อฟอร์มมาจากนิยามชนิดจริงๆ
   *
   * The test above passes just as well if fieldsFor returns the same constant
   * list for all sixteen pairs, which is a generated form in name only. These
   * two ask that the axes actually reach the output: every input type and every
   * resolve method has to change the form somewhere, or it is not deriving
   * anything from that axis.
   */
  it('ทุกชนิดอินพุตทำให้ฟอร์มต่างจากชนิดอื่นอย่างน้อยหนึ่งคู่', () => {
    for (const input of INPUT_TYPES) {
      const mine = fieldsFor(input, 'weighted').map((f) => f.key).join(',')
      const others = INPUT_TYPES.filter((other) => other !== input)
        .map((other) => fieldsFor(other, 'weighted').map((f) => f.key).join(','))
      expect(others, `${input} ถามเหมือนชนิดอื่นทุกตัว`).not.toContain(mine)
    }
  })

  it('ทุกวิธีตัดสินผลทำให้ฟอร์มต่างจากวิธีอื่น', () => {
    for (const resolve of RESOLVE_METHODS) {
      const mine = fieldsFor('pick_one', resolve).map((f) => f.key).join(',')
      const others = RESOLVE_METHODS.filter((other) => other !== resolve)
        .map((other) => fieldsFor('pick_one', other).map((f) => f.key).join(','))
      expect(others, `${resolve} ถามเหมือนวิธีอื่นทุกตัว`).not.toContain(mine)
    }
  })

  it('ทุกคู่ถามผลลัพธ์เสมอ — กิจกรรมที่ไม่ตอบอะไรเลยไม่มีความหมาย', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        expect(fieldsFor(input, resolve).map((f) => f.key), `${input} × ${resolve}`)
          .toContain('outcomes')
      }
    }
  })

  it('ไม่มีคู่ไหนถามช่องเดียวกันสองครั้ง', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        const keys = fieldsFor(input, resolve).map((f) => f.key)
        expect(new Set(keys).size, `${input} × ${resolve} ถามซ้ำ`).toBe(keys.length)
      }
    }
  })

  it('ทุกช่องมีป้ายที่คนอ่านออก ไม่ใช่คีย์เปล่าๆ', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        for (const field of fieldsFor(input, resolve)) {
          expect(field.label.length, `${input} × ${resolve} · ${field.key}`).toBeGreaterThan(0)
          expect(field.label).not.toBe(field.key)
        }
      }
    }
  })

  it('การ์ดสำรองถูกถามเฉพาะตอน quota — ที่อื่นไม่มีของให้หมด', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        const asked = fieldsFor(input, resolve).some((f) => f.key === 'fallback_card_id')
        expect(asked, `${input} × ${resolve}`).toBe(resolve === 'quota')
      }
    }
  })
})

/**
 * BR-36 · คู่ที่ผสมกันไม่ได้ ถอดมาจาก lib/engine/resolve.ts ตรงๆ
 *
 * resolve('fixed', …) looks the outcome up by input.pickedId and resolve('score', …)
 * bands on input.score. An activity that collects neither hands the engine an
 * empty input, the find returns nothing, and the player gets no card at all —
 * so the screen refuses the pair rather than letting it be saved and discovered
 * by a player.
 */
describe('comboProblem', () => {
  it('fixed ต้องมีอินพุตที่เลือกได้ ไม่งั้นไม่มี pickedId ให้ค้น', () => {
    expect(comboProblem('none', 'fixed')).toBeTruthy()
    expect(comboProblem('text', 'fixed')).toBeTruthy()
    expect(comboProblem('pick_one', 'fixed')).toBeNull()
  })

  it('score ต้องมาจากควิซ ไม่งั้นไม่มีคะแนนให้เทียบช่วง', () => {
    expect(comboProblem('none', 'score')).toBeTruthy()
    expect(comboProblem('pick_one', 'score')).toBeTruthy()
    expect(comboProblem('quiz', 'score')).toBeNull()
  })

  it('weighted กับ quota ใช้ได้กับทุกชนิดอินพุต', () => {
    for (const input of INPUT_TYPES) {
      expect(comboProblem(input, 'weighted'), input).toBeNull()
      expect(comboProblem(input, 'quota'), input).toBeNull()
    }
  })

  it('ทุกเหตุผลที่ปฏิเสธบอกว่าทำไม ไม่ใช่แค่บอกว่าไม่ได้', () => {
    for (const input of INPUT_TYPES) {
      for (const resolve of RESOLVE_METHODS) {
        const problem = comboProblem(input, resolve)
        if (problem !== null) expect(problem.length, `${input} × ${resolve}`).toBeGreaterThan(20)
      }
    }
  })

  it('ยังเหลือคู่ที่ใช้ได้สำหรับทุกชนิดอินพุต — ไม่มีชนิดไหนถูกปิดตาย', () => {
    for (const input of INPUT_TYPES) {
      const usable = RESOLVE_METHODS.filter((resolve) => comboProblem(input, resolve) === null)
      expect(usable.length, input).toBeGreaterThan(0)
    }
  })
})

describe('ชื่อที่คนอ่าน', () => {
  it('ทุกชนิดอินพุตและทุกวิธีตัดสินผลมีชื่อไทย และไม่ซ้ำกัน', () => {
    const inputs = INPUT_TYPES.map(inputTypeName)
    const resolves = RESOLVE_METHODS.map(resolveMethodName)
    expect(new Set(inputs).size).toBe(INPUT_TYPES.length)
    expect(new Set(resolves).size).toBe(RESOLVE_METHODS.length)
    for (const name of [...inputs, ...resolves]) expect(name.length).toBeGreaterThan(0)
  })

  /** ชุดนี้ต้องตรงกับ CHECK ของคอลัมน์ ไม่งั้นจอเสนอค่าที่ตารางไม่รับ */
  it('ชุดค่าตรงกับ CHECK ใน 0001_init.sql', () => {
    expect([...INPUT_TYPES]).toEqual(['none', 'pick_one', 'quiz', 'text'])
    // lookup อยู่ใน CHECK แต่ยังไม่อยู่ในสไลซ์นี้ · จอไม่เสนอให้เลือก
    expect([...RESOLVE_METHODS]).toEqual(['fixed', 'weighted', 'quota', 'score'])
  })
})
