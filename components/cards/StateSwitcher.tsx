'use client'

import { useState, type CSSProperties } from 'react'
import type { PlayerState } from '@/lib/state'

/**
 * สวิตช์สถานะผู้เล่นจำลอง สำหรับตัวอย่างการ์ดของ M3-S02 (Task 14)
 *
 * `Condition` (lib/state.ts) อ้างถึงสถานะได้ห้าแบบ — has_attribute/not_has_attribute
 * (attributes) · has_entitlement (entitlements) · activity_completed/not_completed
 * (completed) · activity_play_count (playCounts) — และ `PlayerState` เองยังมี counters
 * ที่ progress_bar block กับตัวแปร {{counter.x}} อ่านตรงๆ แม้ไม่มี Condition ชนิดไหน
 * อ้างถึงมันก็ตาม สวิตช์นี้จึงครอบทั้งห้ามิติของ Condition บวก counters รวมเป็นหกส่วน
 * ไม่ใช่แค่ entitlement ตัวเดียวตามเทสต์ตัวอย่างในแผน
 *
 * เป็น controlled component ล้วน — ไม่ถือ state เอง รับ `state` ปัจจุบันมาวาด แล้ว
 * เรียก `onChange` ด้วย state ก้อนใหม่ทั้งก้อนทุกครั้งที่มีการแก้ไข ผู้เรียก (PreviewPanel)
 * เป็นคนถือ state จริงและส่งต่อให้ Preview วาดผล — ที่นี่ไม่รู้จัก renderCard/groupBlocks
 * เลยด้วยซ้ำ เพราะหน้าที่ของมันคือแก้ไข state ไม่ใช่ตัดสินใจว่าอะไรควรแสดง
 */

export type StateSwitcherProps = {
  state: PlayerState
  onChange: (next: PlayerState) => void
  /** รหัสรางวัลที่มีอยู่จริงในแคมเปญนี้ · ใช้เป็นตัวเลือกที่ติ๊กได้ทันทีของ entitlements */
  rewardCodes: string[]
  /** กิจกรรมที่มีอยู่จริงในแคมเปญนี้ · ใช้เป็นตัวเลือกของ completed */
  activities: Array<{ code: string; name: string }>
  /** รหัสค่าสะสมที่มีอยู่จริง · เป็นแค่คำแนะนำ (datalist) เพราะ progress_bar อ่านค่าคีย์ใดก็ได้ */
  counterCodes: string[]
}

const box: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
}

const label: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const sectionHead: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--rule-2)',
}

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' }

const smallInput: CSSProperties = {
  flex: 1, border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)',
  padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', minWidth: 0,
}

const numberInput: CSSProperties = { ...smallInput, flex: '0 0 80px', fontFamily: 'var(--mono)' }

const removeButton: CSSProperties = {
  border: '1px solid var(--rule)', background: 'var(--panel)', borderRadius: 'var(--r-sm)',
  width: 24, height: 24, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12, flexShrink: 0,
}

const addButton: CSSProperties = {
  border: '1px dashed var(--rule)', background: 'var(--panel)', borderRadius: 'var(--r-sm)',
  padding: '5px 10px', fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer',
  fontFamily: 'inherit', width: 'fit-content',
}

const chipLabel: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
  border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)', padding: '3px 10px',
  cursor: 'pointer', userSelect: 'none',
}

/** ลบคีย์หนึ่งตัวออกจาก record ไม่ใช่ตั้งเป็น undefined — ตัวหลังจะทำให้ Object.keys เห็นคีย์นั้นค้างอยู่ */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (from === to) return record
  const next = without(record, from)
  next[to] = record[from]
  return next
}

/** แถวคีย์/ค่า (ข้อความ) — ใช้กับ attributes */
function TextRecordSection({
  title, dataSection, dataAddAttr, keyLabel, valueLabel, record, onChange,
}: {
  title: string
  dataSection: string
  dataAddAttr: string
  keyLabel: string
  valueLabel: string
  record: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const [draftCount, setDraftCount] = useState(0)
  const entries = Object.entries(record)

  return (
    <div style={section} data-section={dataSection}>
      <span style={sectionHead}>{title}</span>
      {entries.length === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>ยังไม่มี</span>}
      {entries.map(([key, value]) => (
        <div key={key} style={row} data-attr-row={key}>
          <input
            name="key" aria-label={keyLabel} style={smallInput} value={key}
            onChange={(event) => onChange(renameKey(record, key, event.target.value))}
          />
          <input
            name="value" aria-label={valueLabel} style={smallInput} value={value}
            onChange={(event) => onChange({ ...record, [key]: event.target.value })}
          />
          <button
            type="button" aria-label={`ลบ ${key}`} data-remove-row style={removeButton}
            onClick={() => onChange(without(record, key))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button" style={addButton} {...{ [dataAddAttr]: true }}
        onClick={() => {
          let candidate = String(draftCount)
          while (candidate in record) candidate = `k${Math.random().toString(36).slice(2, 6)}`
          setDraftCount((n) => n + 1)
          onChange({ ...record, [candidate]: '' })
        }}
      >
        + เพิ่ม
      </button>
    </div>
  )
}

/** แถวคีย์/ค่า (ตัวเลข) — ใช้กับ counters และ playCounts */
function NumberRecordSection({
  title, dataSection, dataRowAttr, dataAddAttr, keyLabel, valueLabel, keyHint, record, onChange,
}: {
  title: string
  dataSection: string
  dataRowAttr: 'data-counter-row' | 'data-playcount-row'
  dataAddAttr: 'data-add-counter' | 'data-add-playcount'
  keyLabel: string
  valueLabel: string
  keyHint?: string[]
  record: Record<string, number>
  onChange: (next: Record<string, number>) => void
}) {
  const [draftCount, setDraftCount] = useState(0)
  const entries = Object.entries(record)
  const listId = `${dataSection}-suggestions`

  return (
    <div style={section} data-section={dataSection}>
      <span style={sectionHead}>{title}</span>
      {keyHint && keyHint.length > 0 && (
        <datalist id={listId}>
          {keyHint.map((code) => <option key={code} value={code} />)}
        </datalist>
      )}
      {entries.length === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>ยังไม่มี</span>}
      {entries.map(([key, value]) => (
        <div key={key} style={row} {...{ [dataRowAttr]: key }}>
          <input
            name="key" aria-label={keyLabel} style={smallInput} value={key} list={listId}
            onChange={(event) => onChange(renameKey(record, key, event.target.value))}
          />
          <input
            name="value" aria-label={valueLabel} style={numberInput} value={value}
            inputMode="numeric" pattern="-?[0-9]*"
            onChange={(event) => {
              const parsed = Number(event.target.value)
              onChange({ ...record, [key]: Number.isFinite(parsed) ? parsed : 0 })
            }}
          />
          <button
            type="button" aria-label={`ลบ ${key}`} data-remove-row style={removeButton}
            onClick={() => onChange(without(record, key))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button" style={addButton} {...{ [dataAddAttr]: true }}
        onClick={() => {
          let candidate = String(draftCount)
          while (candidate in record) candidate = `k${Math.random().toString(36).slice(2, 6)}`
          setDraftCount((n) => n + 1)
          onChange({ ...record, [candidate]: 0 })
        }}
      >
        + เพิ่ม
      </button>
    </div>
  )
}

/** รายการที่ติ๊กได้ (checkbox chips) จากรายการที่รู้จัก + ช่องเพิ่มรหัสเอง — ใช้กับ entitlements และ completed */
function ToggleListSection({
  title, dataSection, dataToggleName, dataAddInput, dataAddButton, known, values, onChange,
}: {
  title: string
  dataSection: string
  /** ชื่อ attribute คงที่ · ค่าของมันคือรหัสที่ปุ่มนั้นสลับ เช่น data-entitlement-toggle="gold" */
  dataToggleName: string
  dataAddInput: string
  dataAddButton: string
  known: Array<{ code: string; label: string }>
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function toggle(code: string) {
    onChange(values.includes(code) ? values.filter((v) => v !== code) : [...values, code])
  }

  function addCustom() {
    const code = draft.trim()
    if (code === '' || values.includes(code)) return
    onChange([...values, code])
    setDraft('')
  }

  // รหัสที่ถืออยู่แต่ไม่อยู่ในรายการที่รู้จัก (เช่นพิมพ์เองมาก่อนหน้า) ต้องยังเห็นเป็น chip ติ๊กอยู่ ไม่งั้นกดถอนไม่ได้
  const extra = values.filter((v) => !known.some((k) => k.code === v))

  return (
    <div style={section} data-section={dataSection}>
      <span style={sectionHead}>{title}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[...known, ...extra.map((code) => ({ code, label: code }))].map(({ code, label: text }) => {
          const on = values.includes(code)
          return (
            <label
              key={code}
              style={{
                ...chipLabel,
                borderColor: on ? 'var(--ink)' : 'var(--rule)',
                background: on ? 'var(--panel-2)' : 'var(--panel)',
              }}
            >
              <input
                type="checkbox" checked={on} {...{ [dataToggleName]: code }}
                onChange={() => toggle(code)}
                style={{ margin: 0 }}
              />
              {text}
            </label>
          )
        })}
      </div>
      <div style={row}>
        <input
          style={smallInput} value={draft} placeholder="รหัสอื่นที่ไม่อยู่ในรายการ"
          {...{ [dataAddInput]: true }}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" style={addButton} {...{ [dataAddButton]: true }} onClick={addCustom}>
          + เพิ่ม
        </button>
      </div>
    </div>
  )
}

export function StateSwitcher({ state, onChange, rewardCodes, activities, counterCodes }: StateSwitcherProps) {
  return (
    <div data-state-switcher style={box}>
      <span style={label}>สถานะผู้เล่นจำลอง</span>

      <TextRecordSection
        title="ข้อมูลประจำตัว (attributes)"
        dataSection="attributes"
        dataAddAttr="data-add-attribute"
        keyLabel="ชื่อค่าประจำตัว"
        valueLabel="ค่า"
        record={state.attributes}
        onChange={(attributes) => onChange({ ...state, attributes })}
      />

      <NumberRecordSection
        title="ค่าสะสม (counters)"
        dataSection="counters"
        dataRowAttr="data-counter-row"
        dataAddAttr="data-add-counter"
        keyLabel="รหัสค่าสะสม"
        valueLabel="จำนวน"
        keyHint={counterCodes}
        record={state.counters}
        onChange={(counters) => onChange({ ...state, counters })}
      />

      <ToggleListSection
        title="สิทธิ์รางวัลที่ถืออยู่ (entitlements)"
        dataSection="entitlements"
        dataToggleName="data-entitlement-toggle"
        dataAddInput="data-add-entitlement-input"
        dataAddButton="data-add-entitlement"
        known={rewardCodes.map((code) => ({ code, label: code }))}
        values={state.entitlements}
        onChange={(entitlements) => onChange({ ...state, entitlements })}
      />

      <ToggleListSection
        title="กิจกรรมที่เล่นจบแล้ว (completed)"
        dataSection="completed"
        dataToggleName="data-completed-toggle"
        dataAddInput="data-add-completed-input"
        dataAddButton="data-add-completed"
        known={activities.map((a) => ({ code: a.code, label: `${a.name} · ${a.code}` }))}
        values={state.completed}
        onChange={(completed) => onChange({ ...state, completed })}
      />

      <NumberRecordSection
        title="จำนวนครั้งที่เล่นแล้ว (play counts)"
        dataSection="play-counts"
        dataRowAttr="data-playcount-row"
        dataAddAttr="data-add-playcount"
        keyLabel="รหัสกิจกรรม"
        valueLabel="จำนวนครั้ง"
        keyHint={activities.map((a) => a.code)}
        record={state.playCounts}
        onChange={(playCounts) => onChange({ ...state, playCounts })}
      />
    </div>
  )
}
