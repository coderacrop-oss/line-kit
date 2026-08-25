'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import { QuizConfig, type QuizAxis, type QuizOption, type QuizQuestion, type QuizResultRule } from '@/lib/quiz/schema'
import { saveQuizConfigAction } from './actions'
import { GroupConfigEditor } from './GroupConfigEditor'

/**
 * ฟอร์มเดียวที่ประกอบ mode/axes/questions/results ทั้งชุดไว้ใน client state ก่อนส่ง
 * เป็น JSON ก้อนเดียว — ไม่ใช่ flat FormData แบบฟอร์มอื่นในระบบ (ChannelForm,
 * LiffAppEditForm ฯลฯ) เพราะความลึกของโครงสร้าง (axes → questions → options →
 * scores ต่อแกน, results → pair) ทำให้ flat field ต้องมีชื่อช่องเป็นสิบๆ ชื่อที่
 * ประกอบ/แกะกลับด้วยมือ — ฝ่าฝืนธรรมเนียมนั้นตั้งใจ อย่า "แก้กลับ" ให้เป็น flat
 * fields · state ทั้งก้อนคือ QuizConfig ตรงๆ ผ่าน Zod schema เดียวกับที่ actions.ts
 * ใช้ตรวจตอนบันทึกจริง จึงพรีวิวปัญหาให้เห็นได้ก่อนกดบันทึกด้วยการ safeParse() ซ้ำ
 * ฝั่ง client โดยไม่ต้องเขียนกฎซ้ำสองที่
 *
 * shell ของการ submit/error ตามแบบ LiffAppEditForm.tsx (../../../../liff-apps/[id]/):
 * ห้าม `<form action={fn}>` ตรงๆ เพราะ Next.js เซ็นเซอร์ข้อความ error ของ Server
 * Action ทิ้งเสมอในโปรดักชัน ไม่ว่าจะเรียกผ่าน form action หรือเรียกตรงๆ ก็ตาม —
 * ทางเดียวที่ข้อความจริงไปถึงฝั่ง client คือ action คืน ActionResult แทนการ throw
 */

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

export const smallLabelStyle: CSSProperties = { ...labelStyle, fontSize: 10, fontWeight: 500 }

export const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

export const boxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 13,
  display: 'flex', flexDirection: 'column', gap: 9,
}

export const rowStyle: CSSProperties = { display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }

const numberStyle: CSSProperties = { fontFamily: 'var(--mono)', width: 64, textAlign: 'right' }

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

function BlockHead({ title, note }: { title: string; note: string }) {
  return (
    <div style={{
      padding: '13px 18px', borderBottom: '1px solid var(--rule)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={smallLabelStyle}>{note}</span>
    </div>
  )
}

const Block = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
)

/** ตัวช่วยแก้แถวในอาเรย์แบบไม่แก้ของเดิม · ใช้ซ้ำทั้งแกน/คำถาม/ตัวเลือก/ผลลัพธ์ */
export function replaceAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

function omitKey<T extends Record<string, number>>(obj: T, key: string): T {
  const next = { ...obj }
  delete next[key]
  return next
}

/**
 * รหัส/id ใหม่ที่ไม่ชนกับของที่มีอยู่จริงตอนนี้ · ไม่ใช้ `array.length + 1`
 *
 * เดิมใช้ `array.length + 1` ตรงๆ ซึ่งพังทันทีที่มีการลบแทรกมาก่อน: ตัวเลือกเหลือ
 * [o1, o2] → ลบ o1 → เหลือ [o2] (length 1) → กด "เพิ่มตัวเลือก" → คำนวณ id เป็น
 * o2 (length-1 + 1 = 2) → ชนกับตัวเลือกที่เหลืออยู่ทันที schema เดิมไม่ได้ตรวจ
 * ความซ้ำของ option id ภายในคำถาม/question id ข้ามคำถาม (ตรวจแค่ axis id กับ
 * result code) จึงผ่าน validation เงียบๆ แล้วไปพังตอนตอบจริง — lib/quiz/engine.ts
 * ใช้ `options.find(o => o.id === answer.optionId)` ซึ่งคืนตัวแรกที่ id ตรงกัน
 * เท่านั้น คำตอบของผู้เล่นที่เลือกตัวเลือกซ้ำ id จะถูกนับคะแนนเป็นอีกตัวเลือกหนึ่งไป
 * โดยไม่มี error ที่ไหนเลย
 *
 * แก้ด้วยการเช็คกับเซตของ id ที่มีอยู่จริง ณ ตอนนั้นเสมอ แทนการเดาจากความยาว
 * อาเรย์ — ปลอดภัยไม่ว่าประวัติการเพิ่ม/ลบจะเป็นอย่างไร เพราะไม่ได้พึ่งตัวนับที่
 * อาจไม่ตรงกับสถานะจริงหลังลบแทรก
 */
export function uniqueId(existing: Iterable<string>, prefix: string): string {
  const taken = new Set(existing)
  let n = taken.size + 1
  let id = `${prefix}${n}`
  while (taken.has(id)) {
    n += 1
    id = `${prefix}${n}`
  }
  return id
}

/** แถวหนึ่งแกน · id ใช้เป็นคีย์อ้างอิงจากทั้งคะแนนของตัวเลือกและ pair ของผลลัพธ์โหมดคู่ */
function AxisRow({ axis, index, canEdit, onChange, onRemove }: {
  axis: QuizAxis
  index: number
  canEdit: boolean
  onChange: (patch: Partial<QuizAxis>) => void
  onRemove: () => void
}) {
  return (
    <div style={boxStyle} data-axis={index}>
      <div style={rowStyle}>
        <Field id={`axis-id-${index}`} label="รหัสแกน" hint="ใช้อ้างในคะแนนของตัวเลือกและคู่ผลลัพธ์">
          <input
            value={axis.id} maxLength={30} disabled={!canEdit}
            onChange={(e) => onChange({ id: e.target.value })}
            style={{ fontFamily: 'var(--mono)', width: 120 }}
          />
        </Field>
        <Field id={`axis-label-${index}`} label="ชื่อแกน">
          <input
            value={axis.label} maxLength={24} disabled={!canEdit}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </Field>
        <Field id={`axis-pole0-${index}`} label="ขั้วซ้าย">
          <input
            value={axis.poles[0]} maxLength={24} disabled={!canEdit}
            onChange={(e) => onChange({ poles: [e.target.value, axis.poles[1]] })}
          />
        </Field>
        <Field id={`axis-pole1-${index}`} label="ขั้วขวา">
          <input
            value={axis.poles[1]} maxLength={24} disabled={!canEdit}
            onChange={(e) => onChange({ poles: [axis.poles[0], e.target.value] })}
          />
        </Field>
      </div>
      {canEdit && (
        <div>
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onRemove}>
            เอาแกนนี้ออก
          </Button>
        </div>
      )}
    </div>
  )
}

/** ตัวเลือกหนึ่งข้อของคำถามหนึ่งข้อ · คะแนนต่อแกนกรอกได้เท่ากับจำนวนแกนที่มีอยู่ตอนนี้ */
function OptionRow({ option, index, axes, canEdit, onChange, onRemove }: {
  option: QuizOption
  index: number
  axes: QuizAxis[]
  canEdit: boolean
  onChange: (patch: Partial<QuizOption>) => void
  onRemove: () => void
}) {
  return (
    <div style={{ ...boxStyle, padding: 10, background: 'var(--ground)' }} data-option={index}>
      <div style={rowStyle}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field id={`opt-label-${index}`} label="ข้อความตัวเลือก">
            <input
              value={option.label} maxLength={60} disabled={!canEdit}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </Field>
        </div>
        {canEdit && (
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onRemove}>
            เอาตัวเลือกนี้ออก
          </Button>
        )}
      </div>

      {axes.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {axes.map((axis) => (
            <Field key={axis.id} id={`opt-score-${index}-${axis.id}`} label={axis.label || axis.id || '(ยังไม่ตั้งชื่อแกน)'}>
              <input
                inputMode="numeric" pattern="-?[0-9]*"
                value={option.scores[axis.id] === undefined ? '' : String(option.scores[axis.id])}
                disabled={!canEdit}
                placeholder="0"
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  if (raw === '' || raw === '-') {
                    onChange({ scores: omitKey(option.scores, axis.id) })
                    return
                  }
                  const num = Number(raw)
                  if (Number.isNaN(num)) return
                  onChange({ scores: { ...option.scores, [axis.id]: num } })
                }}
                style={numberStyle}
              />
            </Field>
          ))}
        </div>
      )}
    </div>
  )
}

/** คำถามหนึ่งข้อ พร้อมตัวเลือกของมัน (2–6 ข้อ ตาม schema) */
function QuestionRow({ question, index, axes, canEdit, onChange, onRemove }: {
  question: QuizQuestion
  index: number
  axes: QuizAxis[]
  canEdit: boolean
  onChange: (patch: Partial<QuizQuestion>) => void
  onRemove: () => void
}) {
  const addOption = () => {
    const id = uniqueId(question.options.map((o) => o.id), 'o')
    onChange({ options: [...question.options, { id, label: '', scores: {} }] })
  }
  const updateOption = (oi: number, patch: Partial<QuizOption>) => {
    onChange({ options: replaceAt(question.options, oi, patch) })
  }
  const removeOption = (oi: number) => {
    onChange({ options: removeAt(question.options, oi) })
  }

  return (
    <div style={boxStyle} data-question={index}>
      <div style={rowStyle}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>ข้อ {index + 1}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field id={`q-text-${index}`} label="ข้อความคำถาม">
            <input
              value={question.text} maxLength={140} disabled={!canEdit}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </Field>
        </div>
        {canEdit && (
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onRemove}>
            เอาคำถามข้อนี้ออก
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12 }}>
        {question.options.map((option, oi) => (
          <OptionRow
            key={oi}
            option={option}
            index={oi}
            axes={axes}
            canEdit={canEdit}
            onChange={(patch) => updateOption(oi, patch)}
            onRemove={() => removeOption(oi)}
          />
        ))}
        {canEdit && question.options.length < 6 && (
          <div>
            <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={addOption}>
              ＋ เพิ่มตัวเลือก
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** ผลลัพธ์หนึ่งแบบ · pair ใช้เฉพาะโหมดคู่ (duo) — เลือกแกนได้จากรายการแกนปัจจุบัน */
function ResultRow({ result, index, axes, isDuo, canEdit, onChange, onRemove }: {
  result: QuizResultRule
  index: number
  axes: QuizAxis[]
  isDuo: boolean
  canEdit: boolean
  onChange: (patch: Partial<QuizResultRule>) => void
  onRemove: () => void
}) {
  const pair = result.pair ?? ['', '']

  /**
   * เขียน tuple ดิบกลับเสมอ ไม่ตัดสินใจ "ครบหรือยัง" ที่นี่
   *
   * เดิมยุบเป็น undefined ทันทีที่ฝั่งใดฝั่งหนึ่งยังว่าง — พังจริง: `pair` ที่อ่านมาคือ
   * ค่าที่ *ถูกยืนยันแล้ว* (result.pair) ไม่ใช่ค่าที่เพิ่งเลือกไปหมาดๆ ฉะนั้นเลือกฝั่งแรก
   * แล้ว onChange จะยุบเป็น undefined ทันที (เพราะอีกฝั่งยังว่าง) แล้วพอมาเลือกฝั่งที่
   * สอง โค้ดก็อ่าน pair จาก result.pair ที่เพิ่งถูกยุบเป็น undefined ไปแล้ว จึงเห็นอีก
   * ฝั่งเป็นค่าว่างอีกรอบ วนแบบนี้ทำให้ตั้ง pair ผ่านฟอร์มไม่ได้เลยสักครั้ง (จับได้จาก
   * เทสต์ QuizConfigForm.test.tsx ตอนรีวิว Task 11) แก้โดยเก็บ tuple ดิบ (มีช่องว่างได้)
   * ไว้ตรงๆ แล้วให้ sanitizeForSubmit() ที่ระดับบนสุดเป็นคนตัดสินตอนจะส่งจริงว่าฝั่งไหน
   * ว่างให้ถือว่ายังไม่ระบุทั้งคู่
   */
  const setPair = (pos: 0 | 1, value: string) => {
    const next: [string, string] = pos === 0 ? [value, pair[1]] : [pair[0], value]
    onChange({ pair: next })
  }

  return (
    <div style={boxStyle} data-result={index}>
      <div style={rowStyle}>
        <Field id={`res-code-${index}`} label="รหัสผลลัพธ์">
          <input
            value={result.code} maxLength={30} disabled={!canEdit}
            onChange={(e) => onChange({ code: e.target.value })}
            style={{ fontFamily: 'var(--mono)', width: 120 }}
          />
        </Field>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Field id={`res-title-${index}`} label="หัวข้อ">
            <input
              value={result.title} maxLength={120} disabled={!canEdit}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </Field>
        </div>
        {canEdit && (
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onRemove}>
            เอาผลลัพธ์นี้ออก
          </Button>
        )}
      </div>

      <Field id={`res-body-${index}`} label="เนื้อหา">
        <textarea
          value={result.body} maxLength={600} disabled={!canEdit}
          onChange={(e) => onChange({ body: e.target.value })}
          style={{ minHeight: 64, resize: 'vertical' }}
        />
      </Field>

      <Field id={`res-image-${index}`} label="รูปภาพ (ไม่บังคับ)" hint="ใส่ URL รูป ไม่ใส่ก็ได้">
        <input
          value={result.imageUrl ?? ''} disabled={!canEdit}
          onChange={(e) => onChange({ imageUrl: e.target.value.trim() === '' ? undefined : e.target.value })}
        />
      </Field>

      {isDuo && (
        <div style={rowStyle}>
          <Field id={`res-pair0-${index}`} label="คู่แกนที่ 1 (ไม่บังคับ)">
            <select value={pair[0]} disabled={!canEdit} onChange={(e) => setPair(0, e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {axes.map((axis) => <option key={axis.id} value={axis.id}>{axis.label || axis.id}</option>)}
            </select>
          </Field>
          <Field id={`res-pair1-${index}`} label="คู่แกนที่ 2">
            <select value={pair[1]} disabled={!canEdit} onChange={(e) => setPair(1, e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {axes.map((axis) => <option key={axis.id} value={axis.id}>{axis.label || axis.id}</option>)}
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}

/**
 * ก้อนที่จะ validate/ส่งจริง · ตัด pair ที่เลือกยังไม่ครบสองฝั่งทิ้งเป็น undefined
 *
 * ResultRow เก็บ tuple ดิบของสองช่อง select ไว้ตรงๆ (อาจมีฝั่งว่างระหว่างที่ผู้ใช้ยัง
 * เลือกไม่ครบ) เพราะ state ที่ยุบครึ่งๆ กลางคันทำให้ตั้ง pair ไม่ได้เลยสักครั้ง (ดูคอมเมนต์
 * ของ setPair) — ขอบเขตนี้เป็นจุดเดียวที่ตัดสินว่า "ครบหรือยัง" ก่อนเอาไปเทียบกับ schema
 * และก่อนเขียนลงช่อง hidden input จริง ใช้ทั้งสองที่ (validation พรีวิวกับตัวที่ส่งจริง)
 * เพื่อให้สิ่งที่พรีวิวตรงกับสิ่งที่บันทึกเป๊ะๆ
 */
function sanitizeForSubmit(draft: QuizConfig): QuizConfig {
  return {
    ...draft,
    results: draft.results.map((r) => {
      if (!r.pair) return r
      const [a, b] = r.pair
      return a && b ? r : { ...r, pair: undefined }
    }),
  }
}

export type QuizConfigFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  canEdit: boolean
}

export function QuizConfigForm({ campaignId, activityId, initial, canEdit }: QuizConfigFormProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<QuizConfig>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  const submitted = sanitizeForSubmit(draft)
  const validation = QuizConfig.safeParse(submitted)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)
    setBusy(true)
    try {
      const result = await saveQuizConfigAction(campaignId, activityId, formData)
      if (result.ok) {
        setSavedTick((n) => n + 1)
        router.refresh()
        setBusy(false)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  // ทุก add* คำนวณ id/code ใหม่จาก `d` ของ updater function เอง ไม่ใช่จาก `draft`
  // ตัวแปรนอก — กันพลาดกรณีมีการอัปเดตซ้อนกันในติ๊กเดียวกัน (React อาจ batch หลาย
  // setState) ให้ยึดสถานะล่าสุดจริงเสมอ ไม่ใช่ค่าที่ค้างมาจากตอน render ครั้งก่อน
  const addAxis = () => {
    setDraft((d) => {
      if (d.axes.length >= 6) return d
      const id = uniqueId(d.axes.map((a) => a.id), 'axis')
      return { ...d, axes: [...d.axes, { id, label: '', poles: ['', ''] }] }
    })
  }
  const updateAxis = (index: number, patch: Partial<QuizAxis>) => {
    setDraft((d) => ({ ...d, axes: replaceAt(d.axes, index, patch) }))
  }
  const removeAxis = (index: number) => {
    setDraft((d) => ({ ...d, axes: removeAt(d.axes, index) }))
  }

  const addQuestion = () => {
    setDraft((d) => {
      if (d.questions.length >= 10) return d
      const id = uniqueId(d.questions.map((q) => q.id), 'q')
      const o1 = uniqueId([], 'o')
      const o2 = uniqueId([o1], 'o')
      return {
        ...d,
        questions: [...d.questions, {
          id, text: '',
          options: [{ id: o1, label: '', scores: {} }, { id: o2, label: '', scores: {} }],
        }],
      }
    })
  }
  const updateQuestion = (index: number, patch: Partial<QuizQuestion>) => {
    setDraft((d) => ({ ...d, questions: replaceAt(d.questions, index, patch) }))
  }
  const removeQuestion = (index: number) => {
    setDraft((d) => ({ ...d, questions: removeAt(d.questions, index) }))
  }

  const addResult = () => {
    setDraft((d) => {
      const code = uniqueId(d.results.map((r) => r.code), 'R')
      return { ...d, results: [...d.results, { code, title: '', body: '' }] }
    })
  }
  const updateResult = (index: number, patch: Partial<QuizResultRule>) => {
    setDraft((d) => ({ ...d, results: replaceAt(d.results, index, patch) }))
  }
  const removeResult = (index: number) => {
    setDraft((d) => {
      const removedCode = d.results[index]?.code
      const results = removeAt(d.results, index)
      const fallbackResultCode = d.fallbackResultCode === removedCode
        ? (results[0]?.code ?? '')
        : d.fallbackResultCode
      return { ...d, results, fallbackResultCode }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ช่องเดียวที่ฟอร์มนี้ส่งจริง — JSON ของ QuizConfig ทั้งก้อน อ่านคอมเมนต์บนสุด
            ของไฟล์นี้ว่าทำไมถึงไม่ใช่ flat field แบบฟอร์มอื่นในระบบ */}
        <input type="hidden" name="config" value={JSON.stringify(submitted)} readOnly />

        <fieldset disabled={!canEdit || busy} style={fieldsetStyle}>
          <Panel style={{ padding: 18 }}>
            <Field id="quiz-mode" label="โหมด" hint="เดี่ยว = ตอบคนเดียวจบ · คู่ = รอจับคู่กับอีกคนก่อนตัดสินผล">
              <select
                value={draft.mode}
                onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as 'solo' | 'duo' }))}
              >
                <option value="solo">เดี่ยว · Solo</option>
                <option value="duo">คู่ · Duo</option>
              </select>
            </Field>
          </Panel>

          <Panel style={{ marginTop: 14 }}>
            <BlockHead title="แกน (Axes)" note={`ต้องมีอย่างน้อย 2 แกน อย่างมาก 6 แกน · ตอนนี้มี ${draft.axes.length}`} />
            <Block>
              {draft.axes.map((axis, index) => (
                <AxisRow
                  key={index}
                  axis={axis}
                  index={index}
                  canEdit={canEdit}
                  onChange={(patch) => updateAxis(index, patch)}
                  onRemove={() => removeAxis(index)}
                />
              ))}
              {canEdit && draft.axes.length < 6 && (
                <div>
                  <Button type="button" variant="ghost" onClick={addAxis}>＋ เพิ่มแกน</Button>
                </div>
              )}
            </Block>
          </Panel>

          <Panel style={{ marginTop: 14 }}>
            <BlockHead
              title="คำถาม (Questions)"
              note={`ต้องมีอย่างน้อย 3 ข้อ อย่างมาก 10 ข้อ · ตัวเลือกข้อละ 2–6 · ตอนนี้มี ${draft.questions.length}`}
            />
            <Block>
              {draft.questions.map((question, index) => (
                <QuestionRow
                  key={index}
                  question={question}
                  index={index}
                  axes={draft.axes}
                  canEdit={canEdit}
                  onChange={(patch) => updateQuestion(index, patch)}
                  onRemove={() => removeQuestion(index)}
                />
              ))}
              {canEdit && draft.questions.length < 10 && (
                <div>
                  <Button type="button" variant="ghost" onClick={addQuestion}>＋ เพิ่มคำถาม</Button>
                </div>
              )}
            </Block>
          </Panel>

          <Panel style={{ marginTop: 14 }}>
            <BlockHead title="ผลลัพธ์ (Results)" note={`ต้องมีอย่างน้อย 2 แบบ · ตอนนี้มี ${draft.results.length}`} />
            <Block>
              {draft.results.map((result, index) => {
                // catch-all (ไม่มี .pair) ที่ไม่ใช่แถวสุดท้าย ทำให้ทุกแถวหลังจากนี้ไม่มีวัน
                // ถูกใช้เลย — matchPair() (lib/quiz/engine.ts) เช็คเรียงจากบนลงล่างแล้วคืน
                // ทันทีที่เจอแถวไม่มี .pair โดยไม่มีอะไรบอกตอนบันทึกว่าแถวหลังจากนั้นตายแล้ว
                const submittedResult = submitted.results[index]
                const isDeadCatchAll = draft.mode === 'duo' && !submittedResult?.pair
                  && index < draft.results.length - 1

                return (
                  <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <ResultRow
                      result={result}
                      index={index}
                      axes={draft.axes}
                      isDuo={draft.mode === 'duo'}
                      canEdit={canEdit}
                      onChange={(patch) => updateResult(index, patch)}
                      onRemove={() => removeResult(index)}
                    />
                    {isDeadCatchAll && (
                      <Note tone="warn">
                        ผลลัพธ์นี้ไม่ได้ระบุคู่แกน (catch-all) แต่ไม่ใช่แถวสุดท้าย — เอนจิ้นจับคู่
                        แบบเจอก่อนใช้ก่อน ผลลัพธ์ที่อยู่ถัดจากนี้ลงไปจะไม่มีวันถูกใช้เลย
                        ย้ายแถวนี้ไปไว้ล่างสุดของรายการ
                      </Note>
                    )}
                  </div>
                )
              })}
              {canEdit && (
                <div>
                  <Button type="button" variant="ghost" onClick={addResult}>＋ เพิ่มผลลัพธ์</Button>
                </div>
              )}

              <Field
                id="fallback-result"
                label="ผลลัพธ์สำรอง (fallbackResultCode)"
                hint="ใช้เมื่อคำนวณคะแนนแล้วไม่มีผลลัพธ์ไหนตรงเป๊ะ — ต้องเป็นรหัสที่มีอยู่จริงในรายการข้างบน"
              >
                <select
                  value={draft.fallbackResultCode}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, fallbackResultCode: e.target.value }))}
                >
                  <option value="">— เลือก —</option>
                  {draft.results.map((r, i) => (
                    <option key={i} value={r.code}>{r.code || '(ยังไม่ตั้งรหัส)'}</option>
                  ))}
                </select>
              </Field>
            </Block>
          </Panel>

          <GroupConfigEditor
            group={draft.group}
            axes={draft.axes}
            canEdit={canEdit}
            onChange={(group) => setDraft((d) => ({ ...d, group }))}
          />

          {validation.success ? (
            <Note tone="ok">กรอกครบและถูกต้องตาม schema แล้ว — บันทึกได้</Note>
          ) : (
            <Note tone="warn">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังบันทึกไม่ได้ — มีข้อผิดพลาดดังนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {validation.error.issues.map((issue, i) => (
                  <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
                ))}
              </ul>
            </Note>
          )}

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {savedTick > 0 && !busy && <span style={noteStyle}>บันทึกล่าสุดแล้ว</span>}
              <Button type="submit" disabled={!validation.success}>บันทึกควิซ</Button>
            </div>
          )}
          {busy && <p style={noteStyle} aria-live="polite">กำลังบันทึก…</p>}
        </fieldset>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
