import { describe, expect, it } from 'vitest'
import {
  INPUT_TYPES, RESOLVE_METHODS, WIZARD_CONTROLS, WIZARD_STORES, comboProblem, fieldsFor,
  inputConfigFields, inputTypeName, resolveMethodName,
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
 * นิยามชนิดต้องบอกด้วยว่าช่องนั้นวาดยังไงและเก็บไว้ที่ไหน ไม่ใช่แค่ชื่อ
 *
 * A key and a label are not enough to generate a form from. Without saying which
 * control draws the field and which column stores it, the screen would have to
 * decide both — and the only material it has to decide with is the input type,
 * which is the `switch` BR-87 exists to forbid. Carrying `control` and `store`
 * in the definition is what lets both the screen and the save action loop over
 * fieldsFor() and stay ignorant of what kind of activity they are looking at.
 */
describe('ช่องบอกวิธีวาดและที่เก็บของตัวเอง', () => {
  const everyField = INPUT_TYPES.flatMap((input) =>
    RESOLVE_METHODS.map((resolve) => ({ input, resolve, fields: fieldsFor(input, resolve) })))

  it('ทุกช่องของทุกคู่มี control ที่จอรู้จัก', () => {
    for (const { input, resolve, fields } of everyField) {
      for (const field of fields) {
        expect(WIZARD_CONTROLS, `${input} × ${resolve} · ${field.key}`).toContain(field.control)
      }
    }
  })

  it('ทุกช่องของทุกคู่มี store ที่บอกว่าค่าลงคอลัมน์ไหน', () => {
    for (const { input, resolve, fields } of everyField) {
      for (const field of fields) {
        expect(WIZARD_STORES, `${input} × ${resolve} · ${field.key}`).toContain(field.store)
      }
    }
  })

  it('ช่องเดียวกันใช้ control และ store เดิมเสมอ ไม่ว่าคู่ไหนถามมัน', () => {
    const seen = new Map<string, string>()
    for (const { input, resolve, fields } of everyField) {
      for (const field of fields) {
        const shape = `${field.control}/${field.store}/${field.block}`
        const before = seen.get(field.key)
        if (before) expect(shape, `${field.key} เปลี่ยนรูปตอน ${input} × ${resolve}`).toBe(before)
        seen.set(field.key, shape)
      }
    }
  })

  /**
   * ช่องของ input_config มาจากแกน 1 เท่านั้น
   *
   * The save action reads input_config out of the form by asking fieldsFor which
   * keys belong there. If a resolve method ever contributed one, changing only
   * the resolve method would silently change what the input configuration is
   * allowed to hold, which is the axis leaking into the wrong column.
   */
  it('วิธีตัดสินผลไม่มีสิทธิ์เพิ่มช่องลง input_config', () => {
    for (const input of INPUT_TYPES) {
      const keys = RESOLVE_METHODS.map((resolve) =>
        inputConfigFields(input, resolve).map((f) => f.key).join(','))
      expect(new Set(keys).size, input).toBe(1)
    }
  })

  it('ชนิดอินพุตที่ไม่รับอะไรเลย ไม่มีช่องใน input_config สักช่อง', () => {
    expect(inputConfigFields('none', 'weighted')).toEqual([])
  })

  it('เลือกหนึ่งช่องกับตอบคำถาม มีช่องที่ต้องเก็บลง input_config', () => {
    expect(inputConfigFields('pick_one', 'weighted').map((f) => f.key))
      .toEqual(['grid', 'slots', 'meaningful'])
    expect(inputConfigFields('quiz', 'weighted').map((f) => f.key)).toEqual(['questions'])
    expect(inputConfigFields('text', 'weighted').map((f) => f.key)).toEqual(['prompt'])
  })

  it('การ์ดสำรองไม่ถูกนับเป็นของ input_config — มันเป็นคอลัมน์ของตัวเอง', () => {
    const fallback = fieldsFor('none', 'quota').find((f) => f.key === 'fallback_card_id')
    expect(fallback?.store).toBe('column')
    expect(inputConfigFields('none', 'quota')).toEqual([])
  })

  it('ผลลัพธ์ น้ำหนัก และช่วงคะแนน เก็บอยู่กับ resolve_config ที่เดียวกัน', () => {
    const byKey = new Map(fieldsFor('quiz', 'score').map((f) => [f.key, f]))
    expect(byKey.get('outcomes')?.store).toBe('resolve_config')
    expect(byKey.get('score_bands')?.store).toBe('resolve_config')
    expect(fieldsFor('none', 'weighted').find((f) => f.key === 'weights')?.store)
      .toBe('resolve_config')
  })

  it('เงื่อนไขการเข้าเล่นเก็บที่คอลัมน์ของตัวเอง ไม่ปนกับ input_config', () => {
    const rules = fieldsFor('none', 'weighted').find((f) => f.key === 'entry_rules')
    expect(rules?.store).toBe('entry_rules')
    expect(rules?.block).toBe(1)
  })

  /** น้ำหนักกับช่วงคะแนนวาดเป็นคอลัมน์ในตารางผลลัพธ์ ไม่ใช่ช่องแยกของตัวเอง */
  it('น้ำหนักและช่วงคะแนนเป็นคอลัมน์ของแถวผลลัพธ์', () => {
    expect(fieldsFor('none', 'weighted').find((f) => f.key === 'weights')?.control)
      .toBe('outcome_weight')
    expect(fieldsFor('quiz', 'score').find((f) => f.key === 'score_bands')?.control)
      .toBe('outcome_band')
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
