'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, ErrorModal, Field, Note, Panel, STATUS_TONES } from '@/components/ui'
import { QuizConfig, type QuizAxis, type QuizOption, type QuizQuestion, type QuizResultRule } from '@/lib/quiz/schema'
import { saveQuizConfigAction } from './actions'
import { GroupConfigEditor } from './GroupConfigEditor'
import {
  computeDuoCoverage, computeSoloCombos, computeSoloCoverage,
  type CoverageKind, type DuoCell, type DuoCoverage, type SoloCell, type SoloCoverage,
} from './coverage'

/**
 * Config Playground สำหรับควิซบุคลิกภาพ — ตั้งค่าตามลำดับขั้นตอน (แกน → คำถาม → ผลลัพธ์)
 * ไม่ใช่ tab แยกกัน พร้อมแถบข้างที่โชว์ภาพรวม + เมทริกซ์ผลลัพธ์ + สถานะ validate สดตลอด
 * เวลา (docs/superpowers/specs/2026-08-28-quiz-config-ux-redesign-design.md) — อ้างอิง
 * pattern จาก `~/Desktop/Codera/KimLIFF` (อ่านเป็น reference เท่านั้น ไม่มีการแก้โค้ดที่นั่น)
 *
 * ข้อมูล/validation/action ที่เรียกเหมือนเดิมทุกตัวอักษร — ที่เปลี่ยนคือวิธีนำทางไปแก้ค่า
 * เดิมก้อนเดียวกัน ไม่ใช่ก้อนข้อมูลใหม่ ยังคงเป็นฟอร์มเดียวที่ประกอบ mode/axes/questions/
 * results ทั้งชุดไว้ใน client state ก่อนส่งเป็น JSON ก้อนเดียว (เหตุผลเดิม: ความลึกของ
 * โครงสร้างทำให้ flat FormData ต้องมีชื่อช่องเป็นสิบๆ ชื่อที่ประกอบ/แกะกลับด้วยมือ) — state
 * ทั้งก้อนคือ QuizConfig ตรงๆ ผ่าน Zod schema เดียวกับที่ actions.ts ใช้ตรวจตอนบันทึกจริง
 *
 * shell ของการ submit/error ตามแบบ LiffAppEditForm.tsx (../../../../liff-apps/[id]/):
 * ห้าม `<form action={fn}>` ตรงๆ เพราะ Next.js เซ็นเซอร์ข้อความ error ของ Server Action ทิ้ง
 * เสมอในโปรดักชัน — ทางเดียวที่ข้อความจริงไปถึงฝั่ง client คือ action คืน ActionResult
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

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, display: 'contents' }

const chipRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 14px', border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)',
  background: 'var(--panel)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
}

/** สีต่อสถานะของช่องในเมทริกซ์/checklist ผลลัพธ์ — มาจาก STATUS_TONES เสมอ ไม่คิดสีเอง */
const CELL_TONE: Record<CoverageKind, { bg: string; border: string; fg: string }> = {
  explicit: { bg: STATUS_TONES.ok.bg, border: STATUS_TONES.ok.border, fg: STATUS_TONES.ok.fg },
  catchall: { bg: STATUS_TONES.info.bg, border: STATUS_TONES.info.border, fg: STATUS_TONES.info.fg },
  missing: { bg: 'var(--panel)', border: 'var(--rule)', fg: 'var(--ink-3)' },
}

function BlockHead({ n, title, note }: { n?: number; title: string; note: string }) {
  return (
    <div style={{
      padding: '13px 18px', borderBottom: '1px solid var(--rule)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      {n !== undefined && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%', background: 'var(--ink)', color: 'var(--panel)',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {n}
        </span>
      )}
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

/**
 * รหัส/id ใหม่ที่ไม่ชนกับของที่มีอยู่จริงตอนนี้ · ไม่ใช้ `array.length + 1`
 *
 * เดิมใช้ `array.length + 1` ตรงๆ ซึ่งพังทันทีที่มีการลบแทรกมาก่อน — แก้ด้วยการเช็คกับเซต
 * ของ id ที่มีอยู่จริง ณ ตอนนั้นเสมอ แทนการเดาจากความยาวอาเรย์ ดู QuizConfigForm.test.tsx
 * สำหรับ repro ของบั๊กเดิม
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

const SCORE_MIN = -5
const SCORE_MAX = 5
const scoreCells = (): number[] => {
  const out: number[] = []
  for (let n = SCORE_MIN; n <= SCORE_MAX; n += 1) out.push(n)
  return out
}

/**
 * แถบคะแนนแบบคลิก — แทนที่ number input เดิม (หลักการข้อ 3 ของ redesign: "คะแนนต้อง
 * เป็นภาพให้คลิก ไม่ใช่ number input ดิบ") ช่วง -5..+5 ตรงกับขอบเขตจริงของ
 * `QuizOption.scores` (lib/quiz/schema.ts) — ไม่ใช่ช่วงแคบแบบตัวอย่างในสเปกอ้างอิง
 */
function ScoreDial({ axisLabel, poles, value, disabled, onChange }: {
  axisLabel: string
  poles: readonly [string, string]
  value: number
  disabled: boolean
  onChange: (next: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10, color: 'var(--ink-3)' }}>
        <span>{poles[0] || '(ขั้วซ้าย)'}</span>
        <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)', fontWeight: 600 }}>
          {value > 0 ? `+${value}` : value}
        </span>
        <span>{poles[1] || '(ขั้วขวา)'}</span>
      </div>
      <div role="group" aria-label={`คะแนนของแกน ${axisLabel}`} style={{ display: 'flex', gap: 3 }}>
        {scoreCells().map((n) => {
          const filled = value >= 0 ? (n >= 0 && n <= value) : (n <= 0 && n >= value)
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={value === n}
              aria-label={`ตั้งคะแนนเป็น ${n > 0 ? '+' : ''}${n}`}
              title={`${n > 0 ? '+' : ''}${n}`}
              onClick={() => onChange(n)}
              style={{
                width: 14, height: 14, borderRadius: '50%', padding: 0, cursor: disabled ? 'default' : 'pointer',
                background: filled ? 'var(--ink)' : 'var(--panel-2)',
                border: n === 0 ? '1px solid var(--rule-2)' : '1px solid transparent',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** แถวหนึ่งแกน — แสดงเป็น chip ที่ยุบ/ขยายได้ ปุ่มลบอยู่บนแถบ chip เสมอ (ไม่ต้องขยายก่อนถึงจะลบได้) */
function AxisRow({ axis, index, canEdit, expanded, onToggle, onChange, onRemove }: {
  axis: QuizAxis
  index: number
  canEdit: boolean
  expanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<QuizAxis>) => void
  onRemove: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-axis={index}>
      <div style={chipRowStyle}>
        <button type="button" onClick={onToggle} aria-expanded={expanded} style={chipStyle}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)' }}>{index + 1}</span>
          <span style={{ fontWeight: 600 }}>{axis.label || axis.id || '(ยังไม่ตั้งชื่อแกน)'}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {axis.poles[0] || '?'} ↔ {axis.poles[1] || '?'}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>{expanded ? '▾' : '▸'}</span>
        </button>
        {canEdit && (
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onRemove}>
            เอาแกนนี้ออก
          </Button>
        )}
      </div>

      {expanded && (
        <div style={boxStyle}>
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
        </div>
      )}
    </div>
  )
}

/** ตัวเลือกหนึ่งข้อของคำถามหนึ่งข้อ · คะแนนต่อแกนเป็น ScoreDial แทน number input */
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
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {axes.map((axis) => (
            <ScoreDial
              key={axis.id}
              axisLabel={axis.label || axis.id}
              poles={axis.poles}
              value={option.scores[axis.id] ?? 0}
              disabled={!canEdit}
              onChange={(n) => onChange({ scores: { ...option.scores, [axis.id]: n } })}
            />
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

function LegendSwatch({ tone, label }: { tone: { bg: string; border: string }; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: 3,
        background: tone.bg, border: `1px solid ${tone.border}`,
      }} />
      <span>{label}</span>
    </div>
  )
}

/** เมทริกซ์ผลลัพธ์แบบเต็ม คลิกได้ — ใช้ใน STEP 3 ของโหมด duo */
function DuoMatrix({ coverage, results, canEdit, onCellClick }: {
  coverage: DuoCoverage
  results: QuizResultRule[]
  canEdit: boolean
  onCellClick: (axisA: string, axisB: string, cell: DuoCell) => void
}) {
  const { axes, cells } = coverage
  if (axes.length === 0) {
    return <Note tone="info">ยังไม่มีแกน — เพิ่มแกนใน STEP 1 ก่อนตั้งผลลัพธ์เป็นคู่</Note>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 6px' }} />
            {axes.map((axis) => (
              <th key={axis.id} style={{ padding: '4px 6px', fontSize: 10, color: 'var(--ink-3)' }} title={axis.label || axis.id}>
                {(axis.label || axis.id).slice(0, 4)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axes.map((rowAxis, i) => (
            <tr key={rowAxis.id}>
              <th style={{ padding: '4px 6px', fontSize: 10, color: 'var(--ink-3)', textAlign: 'right' }} title={rowAxis.label || rowAxis.id}>
                {(rowAxis.label || rowAxis.id).slice(0, 4)}
              </th>
              {axes.map((colAxis, j) => {
                const cell = cells[i][j]
                const tone = CELL_TONE[cell.kind]
                const result = cell.resultIndex !== null ? results[cell.resultIndex] : null
                return (
                  <td key={colAxis.id} style={{ padding: 2 }}>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onCellClick(rowAxis.id, colAxis.id, cell)}
                      aria-label={`คู่ ${rowAxis.label || rowAxis.id} × ${colAxis.label || colAxis.id}`}
                      title={result
                        ? `${result.code} — ${result.title || '(ยังไม่ตั้งหัวข้อ)'}${cell.kind === 'catchall' ? ' (catch-all)' : ''}`
                        : 'ยังไม่ได้ตั้ง — คลิกเพื่อสร้าง'}
                      style={{
                        width: 46, height: 32, fontSize: 10, fontWeight: 600,
                        background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg,
                        borderRadius: 'var(--r-sm)', cursor: canEdit ? 'pointer' : 'default',
                      }}
                    >
                      {cell.kind === 'missing' ? '＋' : (result?.code.slice(0, 5) || '✓')}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, color: 'var(--ink-3)' }}>
        <LegendSwatch tone={CELL_TONE.explicit} label="มีผลลัพธ์เฉพาะคู่นี้" />
        <LegendSwatch tone={CELL_TONE.catchall} label="ถูกคลุมด้วย catch-all" />
        <LegendSwatch tone={CELL_TONE.missing} label="ยังไม่มี — ตกไป fallback" />
      </div>
    </div>
  )
}

/** เมทริกซ์ย่อแบบอ่านอย่างเดียว — ใช้ในแถบข้าง (สดตลอดเวลาโดยไม่ต้องกดตรวจ) */
function MiniMatrix({ coverage }: { coverage: DuoCoverage }) {
  const { axes, cells } = coverage
  if (axes.length === 0) return <span style={noteStyle}>ยังไม่มีแกน</span>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {axes.map((rowAxis, i) => (
            <tr key={rowAxis.id}>
              {axes.map((colAxis, j) => {
                const cell = cells[i][j]
                const tone = CELL_TONE[cell.kind]
                return (
                  <td key={colAxis.id} style={{ padding: 1 }}>
                    <span
                      title={`${rowAxis.label || rowAxis.id} × ${colAxis.label || colAxis.id}`}
                      style={{
                        display: 'inline-block', width: 13, height: 13, borderRadius: 3,
                        background: tone.bg, border: `1px solid ${tone.border}`,
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** checklist ของรหัสที่เป็นไปได้ (โหมด solo) — คลิกช่องเพื่อสร้าง/เปิดแก้ผลลัพธ์นั้น */
function SoloChecklist({ coverage, results, canEdit, onCellClick }: {
  coverage: SoloCoverage
  results: QuizResultRule[]
  canEdit: boolean
  onCellClick: (code: string, cell: SoloCell) => void
}) {
  if (coverage.cells.length === 0) {
    return <Note tone="info">ยังไม่มีแกน — เพิ่มแกนใน STEP 1 ก่อนตั้งผลลัพธ์</Note>
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {coverage.cells.map((cell, i) => {
          const result = cell.resultIndex !== null ? results[cell.resultIndex] : null
          const tone = result ? CELL_TONE.explicit : CELL_TONE.missing
          return (
            <button
              // ใช้ index ไม่ใช่ cell.code — แกนที่ยังไม่ตั้งขั้ว (poles ว่าง) ทำให้หลาย combo
              // คำนวณรหัสซ้ำกันได้ (charAt('') ทุกขั้ว = '?' เหมือนกันหมด) ต้องยังกดแยกแต่ละ
              // ช่องได้แม้รหัสจะซ้ำกันชั่วคราวระหว่างยังไม่ได้ตั้งชื่อขั้ว
              key={i}
              type="button"
              disabled={!canEdit}
              onClick={() => onCellClick(cell.code, cell)}
              aria-label={`รหัส ${cell.code}`}
              title={cell.parts.join(' · ')}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '8px 12px', minWidth: 58,
                background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg,
                borderRadius: 'var(--r)', cursor: canEdit ? 'pointer' : 'default', fontSize: 11,
              }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{cell.code}</span>
              <span>{result ? '✅' : '＋'}</span>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, color: 'var(--ink-3)' }}>
        <LegendSwatch tone={CELL_TONE.explicit} label="✅ มีผลลัพธ์ตรงรหัสนี้" />
        <LegendSwatch tone={CELL_TONE.missing} label="＋ ยังไม่มี — ตกไป fallback" />
      </div>
    </div>
  )
}

/** เมทริกซ์ย่อของ solo — ใช้ในแถบข้าง */
function MiniChecklist({ coverage }: { coverage: SoloCoverage }) {
  if (coverage.cells.length === 0) return <span style={noteStyle}>ยังไม่มีแกน</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {coverage.cells.map((cell, i) => {
        const tone = cell.resultIndex !== null ? CELL_TONE.explicit : CELL_TONE.missing
        return (
          <span
            key={i}
            title={cell.code}
            style={{
              fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 3,
              background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg,
            }}
          >
            {cell.code}
          </span>
        )
      })}
    </div>
  )
}

/**
 * ตัวแก้ผลลัพธ์หนึ่งแถว — ใช้ทั้งเป็น "รายละเอียด" ที่เปิดจากกริด (มี onClose) และเป็นแถวใน
 * รายการ "ผลลัพธ์อื่น" ที่แสดงตลอด (ไม่ส่ง onClose) เนื้อฟิลด์เหมือน ResultRow เดิมทุก
 * ตัวอักษร — pair เก็บ tuple ดิบตรงๆ (มีช่องว่างได้ระหว่างเลือกยังไม่ครบ) แล้วให้
 * sanitizeForSubmit() ระดับบนสุดตัดสินตอนจะส่งจริงว่าฝั่งไหนว่างให้ถือว่ายังไม่ระบุทั้งคู่
 * (เหตุผลเต็ม: comment เดิมของ setPair ในไฟล์นี้ก่อนรีดีไซน์ — ยังคงพฤติกรรมเดิมเป๊ะ)
 */
function ResultDetailEditor({ result, index, axes, isDuo, canEdit, onChange, onRemove, onClose }: {
  result: QuizResultRule
  index: number
  axes: QuizAxis[]
  isDuo: boolean
  canEdit: boolean
  onChange: (patch: Partial<QuizResultRule>) => void
  onRemove: () => void
  onClose?: () => void
}) {
  const pair = result.pair ?? ['', '']

  const setPair = (pos: 0 | 1, value: string) => {
    const next: [string, string] = pos === 0 ? [value, pair[1]] : [pair[0], value]
    onChange({ pair: next })
  }

  return (
    <div id={`result-${index}`} style={{ ...boxStyle, background: 'var(--ground)' }} data-result={index}>
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
        {onClose && (
          <Button type="button" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={onClose}>
            ปิด
          </Button>
        )}
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

function reasonForExtra(index: number, draft: QuizConfig): string {
  const r = draft.results[index]
  if (draft.mode === 'duo') {
    if (!r.pair) return 'ผลลัพธ์สำรอง (catch-all) — คลุมทุกคู่ที่กริดด้านบนยังไม่ได้ระบุไว้เฉพาะ'
    const validAxis = new Set(draft.axes.map((a) => a.id))
    const [a, b] = r.pair
    if (!a || !b || !validAxis.has(a) || !validAxis.has(b)) {
      return 'อ้างแกนที่ไม่มีอยู่จริงแล้ว (อาจเพราะแก้รหัสแกนภายหลัง) — แก้คู่แกนใหม่หรือลบทิ้ง'
    }
    return 'คู่แกนซ้ำกับผลลัพธ์อื่นที่ประกาศไว้ก่อนแล้ว — เอนจิ้นใช้ตัวแรกที่ประกาศเสมอ ตัวนี้จึงไม่มีวันถูกใช้'
  }
  const combos = new Set(computeSoloCombos(draft.axes).map((c) => c.code))
  if (!combos.has(r.code.toUpperCase())) {
    return 'รหัสนี้ไม่ตรงกับ combo ที่เป็นไปได้ของชุดแกนตอนนี้ — ยังใช้เป็นผลลัพธ์ปกติได้ (เช่นตั้งเป็น fallback) แต่จะไม่ถูกจับคู่อัตโนมัติจากคะแนน'
  }
  return 'รหัสซ้ำกับผลลัพธ์อื่นที่ประกาศไว้ก่อนแล้ว — เอนจิ้นใช้ตัวแรกที่ประกาศเสมอ ตัวนี้จึงไม่มีวันถูกใช้'
}

/** โหมด "ลองเล่น" — ยังไม่ได้สร้างตัวจำลองจริงในสไลซ์นี้ บอกตรงๆ แทนที่จะเงียบไปเฉยๆ */
function PlayModeStub({ mode }: { mode: 'solo' | 'duo' }) {
  return (
    <Panel style={{ padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <Badge tone="info">ยังไม่พร้อมใช้งานในรอบนี้</Badge>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          ตัวจำลองที่เล่นควิซจริงในกรอบมือถือ พร้อมแผงคะแนนสดข้าง ๆ ยังไม่ได้สร้างในสไลซ์นี้ — ตอนนี้ตรวจว่า
          คะแนน/ผลลัพธ์ถูกไหมได้จากแถบ &ldquo;ภาพรวม&rdquo; ทางซ้ายของโหมด &ldquo;ตั้งค่า&rdquo; แทน
          (เมทริกซ์ผลลัพธ์และสถานะ validate อัปเดตสดตามที่แก้จริงอยู่แล้ว)
        </p>
        <span style={noteStyle}>
          โหมดปัจจุบัน: {mode === 'duo' ? 'คู่ · Duo — ต้องรอจับคู่กับอีกคนก่อนเห็นผล' : 'เดี่ยว · Solo — ตอบจบเห็นผลทันที'}
        </span>
      </div>
    </Panel>
  )
}

function Sidebar({ draft, validation, duoCoverage, soloCoverage }: {
  draft: QuizConfig
  validation: ReturnType<typeof QuizConfig.safeParse>
  duoCoverage: DuoCoverage
  soloCoverage: SoloCoverage
}) {
  return (
    <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>ภาพรวม</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
          <span>{draft.axes.length} แกน</span>
          <span>{draft.questions.length} คำถาม</span>
          <span>{draft.results.length} ผลลัพธ์</span>
        </div>
      </Panel>

      <Panel style={{ padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
          เมทริกซ์ผลลัพธ์ {draft.mode === 'duo' ? '(คู่แกน)' : '(รหัสที่เป็นไปได้)'}
        </div>
        {draft.mode === 'duo' ? <MiniMatrix coverage={duoCoverage} /> : <MiniChecklist coverage={soloCoverage} />}
      </Panel>

      <Panel style={{ padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>สถานะ</div>
        {validation.success ? (
          <Note tone="ok">✓ พร้อมใช้ — บันทึกได้</Note>
        ) : (
          <Note tone="warn">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>✕ ขาด {validation.error.issues.length} อย่าง</div>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflow: 'auto' }}>
              {validation.error.issues.map((issue, i) => (
                <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
              ))}
            </ul>
          </Note>
        )}
      </Panel>
    </div>
  )
}

/**
 * ก้อนที่จะ validate/ส่งจริง · ตัด pair ที่เลือกยังไม่ครบสองฝั่งทิ้งเป็น undefined
 *
 * ResultDetailEditor เก็บ tuple ดิบของสองช่อง select ไว้ตรงๆ (อาจมีฝั่งว่างระหว่างที่ผู้ใช้
 * ยังเลือกไม่ครบ) เพราะ state ที่ยุบครึ่งๆ กลางคันทำให้ตั้ง pair ไม่ได้เลยสักครั้ง — ขอบเขตนี้
 * เป็นจุดเดียวที่ตัดสินว่า "ครบหรือยัง" ก่อนเอาไปเทียบกับ schema และก่อนเขียนลงช่อง hidden
 * input จริง ใช้ทั้งสองที่ (validation พรีวิวกับตัวที่ส่งจริง) เพื่อให้สิ่งที่พรีวิวตรงกับสิ่งที่
 * บันทึกเป๊ะๆ
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
  const [viewMode, setViewMode] = useState<'setup' | 'play'>('setup')
  const [expandedAxis, setExpandedAxis] = useState<number | null>(null)
  const [selectedResultCode, setSelectedResultCode] = useState<string | null>(null)

  const submitted = sanitizeForSubmit(draft)
  const validation = QuizConfig.safeParse(submitted)
  const duoCoverage = computeDuoCoverage(draft)
  const soloCoverage = computeSoloCoverage(draft)

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

  // ทุก add* คำนวณ id/code ใหม่จาก `d` ของ updater function เอง ไม่ใช่จาก `draft` ตัวแปรนอก
  // — กันพลาดกรณีมีการอัปเดตซ้อนกันในติ๊กเดียวกัน (React อาจ batch หลาย setState)
  const addAxis = () => {
    setDraft((d) => {
      if (d.axes.length >= 6) return d
      const id = uniqueId(d.axes.map((a) => a.id), 'axis')
      return { ...d, axes: [...d.axes, { id, label: '', poles: ['', ''] }] }
    })
    setExpandedAxis(draft.axes.length) // แกนใหม่เปิดให้แก้ทันที
  }
  const updateAxis = (index: number, patch: Partial<QuizAxis>) => {
    setDraft((d) => ({ ...d, axes: replaceAt(d.axes, index, patch) }))
  }
  const removeAxis = (index: number) => {
    setDraft((d) => ({ ...d, axes: removeAt(d.axes, index) }))
    setExpandedAxis((current) => (current === index ? null : current))
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

  const updateResult = (index: number, patch: Partial<QuizResultRule>) => {
    setDraft((d) => ({ ...d, results: replaceAt(d.results, index, patch) }))
  }
  const removeResult = (index: number) => {
    const removedCode = draft.results[index]?.code
    setDraft((d) => {
      const results = removeAt(d.results, index)
      const fallbackResultCode = d.fallbackResultCode === d.results[index]?.code
        ? (results[0]?.code ?? '')
        : d.fallbackResultCode
      return { ...d, results, fallbackResultCode }
    })
    setSelectedResultCode((current) => (current === removedCode ? null : current))
  }
  /** ปุ่มทั่วไปที่ไม่ผูกกับกริด/checklist เลย — ของเดิมที่เคยชื่อ addResult() */
  const addBlankResult = () => {
    const code = uniqueId(draft.results.map((r) => r.code), 'R')
    setDraft((d) => ({ ...d, results: [...d.results, { code, title: '', body: '' }] }))
    setSelectedResultCode(code)
  }
  /** คลิก cell ว่างของกริด duo — สร้างผลลัพธ์ใหม่พร้อม pair เติมไว้แล้วเปิดแก้ทันที */
  const addPairResult = (axisA: string, axisB: string) => {
    const code = uniqueId(draft.results.map((r) => r.code), 'R')
    setDraft((d) => ({ ...d, results: [...d.results, { code, title: '', body: '', pair: [axisA, axisB] }] }))
    setSelectedResultCode(code)
  }
  /** คลิกช่องว่างของ checklist solo — สร้างผลลัพธ์ใหม่โดยใช้ typeCode ที่คาดหวังเป็นรหัสตรงๆ */
  const addCodeResult = (code: string) => {
    setDraft((d) => ({ ...d, results: [...d.results, { code, title: '', body: '' }] }))
    setSelectedResultCode(code)
  }

  const selectedResultIndex = selectedResultCode !== null
    ? draft.results.findIndex((r) => r.code === selectedResultCode)
    : -1

  const scrollToResult = (index: number) => {
    document.getElementById(`result-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleDuoCellClick = (axisA: string, axisB: string, cell: DuoCell) => {
    if (cell.resultIndex !== null) {
      setSelectedResultCode(draft.results[cell.resultIndex].code)
      if (cell.kind === 'catchall') scrollToResult(cell.resultIndex)
      return
    }
    addPairResult(axisA, axisB)
  }

  const handleSoloCellClick = (code: string, cell: SoloCell) => {
    if (cell.resultIndex !== null) {
      setSelectedResultCode(draft.results[cell.resultIndex].code)
      return
    }
    addCodeResult(code)
  }

  const extraIndices = draft.mode === 'duo' ? duoCoverage.extraIndices : soloCoverage.extraIndices
  // ทุกผลลัพธ์ที่ยังต้องแสดง "รายละเอียด" อยู่ล่างกริด — ทั้งที่ไม่ได้อยู่ในกริด (catch-all/
  // ซ้ำ/อ้างแกนที่หายไป) และตัวที่กำลังเปิดแก้อยู่ผ่านการคลิกกริด/ปุ่มเพิ่ม เรียงตาม index
  // เดิมเสมอ (ไม่แยกเป็นสองก้อนคนละตำแหน่ง) — สำคัญเพราะ React คงตัวโหนด DOM ของ key เดิม
  // ไว้ข้ามการ re-render ได้ ถ้าผลลัพธ์ที่กำลังแก้ pair อยู่ (ยังไม่ครบ → ครบ → ไม่ครบอีก)
  // ถูกจัดเป็นคนละก้อนตามสถานะ ณ ขณะนั้น แถวของมันจะถูก unmount/remount กลางคันจนช่อง select
  // ที่ผู้ใช้กำลังโต้ตอบอยู่หายไปจาก DOM (ดูคอมเมนต์ resultDetailKeys ด้านล่างของไฟล์)
  const resultDetailKeys = Array.from(
    new Set([...extraIndices, ...(selectedResultIndex !== -1 ? [selectedResultIndex] : [])]),
  ).sort((a, b) => a - b)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setViewMode('setup')}
          aria-pressed={viewMode === 'setup'}
          style={{
            ...chipStyle, borderRadius: 'var(--r)',
            background: viewMode === 'setup' ? 'var(--ink)' : 'var(--panel)',
            color: viewMode === 'setup' ? 'var(--panel)' : 'var(--ink)',
          }}
        >
          📐 ตั้งค่า
        </button>
        <button
          type="button"
          onClick={() => setViewMode('play')}
          aria-pressed={viewMode === 'play'}
          style={{
            ...chipStyle, borderRadius: 'var(--r)',
            background: viewMode === 'play' ? 'var(--ink)' : 'var(--panel)',
            color: viewMode === 'play' ? 'var(--panel)' : 'var(--ink)',
          }}
        >
          ▶ ลองเล่น
        </button>
      </div>

      {viewMode === 'play' ? (
        <PlayModeStub mode={draft.mode} />
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* ช่องเดียวที่ฟอร์มนี้ส่งจริง — JSON ของ QuizConfig ทั้งก้อน */}
          <input type="hidden" name="config" value={JSON.stringify(submitted)} readOnly />

          <fieldset disabled={!canEdit || busy} style={fieldsetStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start' }}>
              <aside style={{ minWidth: 0 }}>
                <Sidebar draft={draft} validation={validation} duoCoverage={duoCoverage} soloCoverage={soloCoverage} />
              </aside>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
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

                <Panel>
                  <BlockHead n={1} title="ตั้งแกนบุคลิก (Axes)" note={`อย่างน้อย 2 แกน อย่างมาก 6 แกน · ตอนนี้มี ${draft.axes.length}`} />
                  <Block>
                    {draft.axes.map((axis, index) => (
                      <AxisRow
                        key={index}
                        axis={axis}
                        index={index}
                        canEdit={canEdit}
                        expanded={expandedAxis === index}
                        onToggle={() => setExpandedAxis((current) => (current === index ? null : index))}
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

                <Panel>
                  <BlockHead
                    n={2}
                    title="เขียนคำถาม (Questions)"
                    note={`อย่างน้อย 3 ข้อ อย่างมาก 10 ข้อ · ตัวเลือกข้อละ 2–6 · ตอนนี้มี ${draft.questions.length}`}
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

                <Panel>
                  <BlockHead n={3} title="ตั้งผลลัพธ์ (Results)" note={`อย่างน้อย 2 แบบ · ตอนนี้มี ${draft.results.length}`} />
                  <Block>
                    {draft.mode === 'duo' ? (
                      <DuoMatrix coverage={duoCoverage} results={draft.results} canEdit={canEdit} onCellClick={handleDuoCellClick} />
                    ) : (
                      <SoloChecklist coverage={soloCoverage} results={draft.results} canEdit={canEdit} onCellClick={handleSoloCellClick} />
                    )}

                    {resultDetailKeys.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {extraIndices.length > 0 && (
                          <span style={smallLabelStyle}>ผลลัพธ์อื่นที่ไม่ได้อยู่ในกริดข้างบน ({extraIndices.length})</span>
                        )}
                        {resultDetailKeys.map((index) => {
                          const isExtra = extraIndices.includes(index)
                          const isSelected = index === selectedResultIndex
                          return (
                            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {isExtra && <Note tone="warn">{reasonForExtra(index, draft)}</Note>}
                              <ResultDetailEditor
                                result={draft.results[index]}
                                index={index}
                                axes={draft.axes}
                                isDuo={draft.mode === 'duo'}
                                canEdit={canEdit}
                                onChange={(patch) => updateResult(index, patch)}
                                onRemove={() => removeResult(index)}
                                onClose={isSelected ? () => setSelectedResultCode(null) : undefined}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {canEdit && (
                      <div>
                        <Button type="button" variant="ghost" onClick={addBlankResult}>＋ เพิ่มผลลัพธ์</Button>
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

                <details>
                  <summary style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, padding: '10px 4px',
                  }}>
                    ⚙️ ตั้งค่าเพิ่มเติม
                    <span style={noteStyle}>(กลุ่ม/duo เท่านั้น — ส่วนใหญ่ไม่ต้องแตะ)</span>
                  </summary>
                  <GroupConfigEditor
                    group={draft.group}
                    axes={draft.axes}
                    canEdit={canEdit}
                    onChange={(group) => setDraft((d) => ({ ...d, group }))}
                  />
                </details>

                {canEdit && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                    {savedTick > 0 && !busy && <span style={noteStyle}>บันทึกล่าสุดแล้ว</span>}
                    <Button type="submit" disabled={!validation.success}>บันทึกควิซ</Button>
                  </div>
                )}
                {busy && <p style={noteStyle} aria-live="polite">กำลังบันทึก…</p>}
              </div>
            </div>
          </fieldset>
        </form>
      )}

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
