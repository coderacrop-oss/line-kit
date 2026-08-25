import { describe, expect, it } from 'vitest'
import { GroupConfig, QuizConfig } from './schema'

const validConfig = {
  mode: 'solo' as const,
  axes: [
    { id: 'ei', label: 'E/I', poles: ['Extrovert', 'Introvert'] as [string, string] },
    { id: 'sn', label: 'S/N', poles: ['Sensing', 'Intuition'] as [string, string] },
  ],
  questions: [
    {
      id: 'q1', text: 'คำถามข้อ 1',
      options: [
        { id: 'q1_a', label: 'ตัวเลือก A', scores: { ei: 2, sn: -1 } },
        { id: 'q1_b', label: 'ตัวเลือก B', scores: { ei: -2, sn: 1 } },
      ],
    },
    {
      id: 'q2', text: 'คำถามข้อ 2',
      options: [
        { id: 'q2_a', label: 'ตัวเลือก A', scores: { ei: 1, sn: 1 } },
        { id: 'q2_b', label: 'ตัวเลือก B', scores: { ei: -1, sn: -1 } },
      ],
    },
    {
      id: 'q3', text: 'คำถามข้อ 3',
      options: [
        { id: 'q3_a', label: 'ตัวเลือก A', scores: { ei: 1, sn: -1 } },
        { id: 'q3_b', label: 'ตัวเลือก B', scores: { ei: -1, sn: 1 } },
      ],
    },
  ],
  results: [
    { code: 'ES', title: 'ผลลัพธ์ ES', body: 'รายละเอียด' },
    { code: 'EN', title: 'ผลลัพธ์ EN', body: 'รายละเอียด' },
    { code: 'IS', title: 'ผลลัพธ์ IS', body: 'รายละเอียด' },
    { code: 'IN', title: 'ผลลัพธ์ IN', body: 'รายละเอียด' },
  ],
  fallbackResultCode: 'ES',
}

describe('QuizConfig', () => {
  it('accepts a valid config', () => {
    expect(QuizConfig.safeParse(validConfig).success).toBe(true)
  })

  it('rejects duplicate axis ids', () => {
    const cfg = { ...validConfig, axes: [validConfig.axes[0], validConfig.axes[0]] }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects an option that scores an axis id that does not exist', () => {
    const cfg = {
      ...validConfig,
      questions: [{
        id: 'q1', text: 'x',
        options: [
          { id: 'a', label: 'A', scores: { nope: 1 } },
          { id: 'b', label: 'B', scores: { ei: 1 } },
        ],
      }],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects a fallbackResultCode that has no matching result', () => {
    const cfg = { ...validConfig, fallbackResultCode: 'ZZ' }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects duplicate result codes', () => {
    const cfg = { ...validConfig, results: [validConfig.results[0], validConfig.results[0]] }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  /**
   * ด่านที่สองกัน id ชนกันแบบเงียบๆ — ตัวสร้าง id ฝั่งจอ (QuizConfigForm.tsx) กันไว้
   * ชั้นหนึ่งแล้ว แต่ config ที่มาจากทางอื่น (เช่น import/แก้ JSON มือในอนาคต) ต้องถูก
   * กันที่นี่ด้วย — คำถาม/ตัวเลือกที่ id ซ้ำกันจะทำให้ lib/quiz/engine.ts จับคู่คำตอบผิด
   * ตัวแบบเงียบๆ (options.find คืนตัวแรกที่ id ตรงเท่านั้น)
   */
  it('rejects duplicate question ids', () => {
    const cfg = {
      ...validConfig,
      questions: [validConfig.questions[0], validConfig.questions[0], validConfig.questions[2]],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects duplicate option ids within the same question', () => {
    const cfg = {
      ...validConfig,
      questions: [
        {
          id: 'q1', text: 'x',
          options: [
            { id: 'dup', label: 'A', scores: { ei: 1 } },
            { id: 'dup', label: 'B', scores: { ei: -1 } },
          ],
        },
        validConfig.questions[1],
        validConfig.questions[2],
      ],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('accepts option ids that repeat across different questions (uniqueness is per-question only)', () => {
    // 'a'/'b' ซ้ำกันได้ระหว่างคำถามคนละข้อ — engine หาคำตอบด้วย (questionId, optionId)
    // คู่กัน ไม่ใช่ optionId เดี่ยวๆ ข้ามคำถาม
    const cfg = {
      ...validConfig,
      questions: validConfig.questions.map((q, i) => ({
        ...q,
        options: [
          { id: 'a', label: `Q${i} A`, scores: { ei: 1 } },
          { id: 'b', label: `Q${i} B`, scores: { ei: -1 } },
        ],
      })),
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })

  it('duo mode: rejects a non-catch-all result rule whose pair references an axis id that does not exist', () => {
    const cfg = {
      ...validConfig, mode: 'duo' as const,
      results: [
        { code: 'X', title: 't', body: 'b', pair: ['ei', 'nope'] as [string, string] },
        ...validConfig.results,
      ],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('duo mode: accepts a result rule with no pair (catch-all)', () => {
    const cfg = { ...validConfig, mode: 'duo' as const }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })

  /**
   * ขั้วว่างผ่าน validation เดิมได้ (schema เก่าไม่มี .min บนสมาชิกของ tuple) แล้วไป
   * พังเงียบๆ ตอนเล่นจริง — dominantAxis เอาตัวอักษรตัวแรกของขั้วที่เลือกมาต่อกัน
   * ขั้วว่างจึงทำให้ type code ผิดรูป แทบไม่มีวันตรงกับ results[].code ไหนเลย
   * ผู้เล่นได้ fallbackResultCode ทุกครั้งโดยไม่มี error ที่ไหนบอก
   */
  it('rejects an axis whose pole label is blank', () => {
    const cfg = {
      ...validConfig,
      axes: [{ ...validConfig.axes[0], poles: ['', 'Introvert'] as [string, string] }, validConfig.axes[1]],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects an axis whose second pole label is blank', () => {
    const cfg = {
      ...validConfig,
      axes: [validConfig.axes[0], { ...validConfig.axes[1], poles: ['Sensing', ''] as [string, string] }],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })
})

describe('GroupConfig', () => {
  const validGroupConfig = {
    enabled: true,
    minMembers: 2,
    maxMembers: 10,
    resultLocksAt: 0,
    archetypes: [
      { code: 'balanced', title: 'สมดุล', body: 'ทุกแกนพอๆ กัน', minGroupSize: 2, condition: { isBalanced: true }, fallback: false },
      { code: 'mixed', title: 'ปนกัน', body: 'fallback', minGroupSize: 2, fallback: true },
    ],
    fallbackArchetype: 'mixed',
  }

  it('accepts a valid group config', () => {
    expect(GroupConfig.safeParse(validGroupConfig).success).toBe(true)
  })

  it('rejects when fallbackArchetype has no matching archetype code', () => {
    const cfg = { ...validGroupConfig, fallbackArchetype: 'nope' }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects when a min_group_size tier has no fallback archetype', () => {
    const cfg = {
      ...validGroupConfig,
      archetypes: [
        { code: 'small', title: 't', body: 'b', minGroupSize: 2, fallback: false, condition: { isBalanced: true } },
        { code: 'big', title: 't', body: 'b', minGroupSize: 5, fallback: true },
      ],
      fallbackArchetype: 'big',
    }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects maxMembers < minMembers', () => {
    const cfg = { ...validGroupConfig, minMembers: 10, maxMembers: 5 }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('accepts a full GroupCondition with every field set', () => {
    const cfg = {
      ...validGroupConfig,
      archetypes: [
        {
          code: 'full', title: 't', body: 'b', minGroupSize: 2, maxGroupSize: 20, fallback: false,
          condition: {
            hasAxes: ['ei'], hasMode: 'all' as const, topAxes: ['ei', 'sn'], topN: 2,
            isBalanced: true, dominantThreshold: 0.6, minMembersWithAxis: 2, maxDistinct: 3,
          },
        },
        { code: 'mixed', title: 'ปนกัน', body: 'fallback', minGroupSize: 2, fallback: true },
      ],
    }
    expect(GroupConfig.safeParse(cfg).success).toBe(true)
  })

  it('QuizConfig.group is optional — a config with no group field is still valid', () => {
    const cfg = {
      mode: 'solo' as const,
      axes: [
        { id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] },
        { id: 'sn', label: 'S/N', poles: ['S', 'N'] as [string, string] },
      ],
      questions: [
        { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
      ],
      results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
      fallbackResultCode: 'E',
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })

  it('QuizConfig accepts group alongside duo mode', () => {
    const cfg = {
      mode: 'duo' as const,
      axes: [
        { id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] },
        { id: 'sn', label: 'S/N', poles: ['S', 'N'] as [string, string] },
      ],
      questions: [
        { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
      ],
      results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
      fallbackResultCode: 'E',
      group: validGroupConfig,
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })
})
