'use client'

import { Button, Field, Note, Panel } from '@/components/ui'
import type { GroupArchetype, GroupCondition, GroupConfig, QuizAxis } from '@/lib/quiz/schema'
import { boxStyle, noteStyle, removeAt, replaceAt, rowStyle, smallLabelStyle, uniqueId } from './QuizConfigForm'

const DEFAULT_GROUP: GroupConfig = {
  enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
  archetypes: [{ code: 'default', title: 'Archetype 1', body: '', minGroupSize: 2, fallback: true }],
  fallbackArchetype: 'default',
}

function ConditionEditor({ condition, index, canEdit, onChange }: {
  condition: GroupCondition | null | undefined
  index: number
  canEdit: boolean
  onChange: (condition: GroupCondition | undefined) => void
}) {
  const cond = condition ?? { hasMode: 'any' as const, topN: 1, dominantThreshold: 0.5 }
  const patch = (p: Partial<GroupCondition>) => onChange({ ...cond, ...p })

  return (
    <div style={{ ...boxStyle, background: 'var(--panel-2, transparent)' }}>
      <span style={smallLabelStyle}>เงื่อนไของค์ประกอบกลุ่ม (ไม่ตั้งข้อไหนเลย = ไม่กรองข้อนั้น)</span>
      <div style={rowStyle}>
        <Field id={`cond-has-axes-${index}`} label="มีแกน (คั่นด้วย ,)" hint="เว้นว่าง = ไม่เช็ค">
          <input
            value={(cond.hasAxes ?? []).join(',')} disabled={!canEdit}
            onChange={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              patch({ hasAxes: list.length > 0 ? list : undefined })
            }}
            style={{ fontFamily: 'var(--mono)', width: 140 }}
          />
        </Field>
        <Field id={`cond-has-mode-${index}`} label="แบบ">
          <select value={cond.hasMode} disabled={!canEdit} onChange={(e) => patch({ hasMode: e.target.value as 'any' | 'all' })}>
            <option value="any">มีสักคน (any)</option>
            <option value="all">ต้องมีครบ (all)</option>
          </select>
        </Field>
        <Field id={`cond-min-members-with-axis-${index}`} label="อย่างน้อยกี่คนในแกนนั้น" hint="มีความหมายเมื่อ 'มีแกน' ระบุแกนเดียว">
          <input
            type="number" min={1} disabled={!canEdit}
            value={cond.minMembersWithAxis ?? ''}
            onChange={(e) => patch({ minMembersWithAxis: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
      </div>
      <div style={rowStyle}>
        <Field id={`cond-top-axes-${index}`} label="อยู่ใน top-N แกน (คั่นด้วย ,)" hint="เว้นว่าง = ไม่เช็ค">
          <input
            value={(cond.topAxes ?? []).join(',')} disabled={!canEdit}
            onChange={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              patch({ topAxes: list.length > 0 ? list : undefined })
            }}
            style={{ fontFamily: 'var(--mono)', width: 140 }}
          />
        </Field>
        <Field id={`cond-top-n-${index}`} label="N">
          <input
            type="number" min={1} max={5} disabled={!canEdit} value={cond.topN}
            onChange={(e) => patch({ topN: Number(e.target.value) })}
            style={{ width: 56, textAlign: 'right' }}
          />
        </Field>
      </div>
      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox" checked={cond.isBalanced ?? false} disabled={!canEdit}
            onChange={(e) => patch({ isBalanced: e.target.checked || undefined })}
          />
          ไม่มีแกนไหนครองเกิน threshold (สมดุล)
        </label>
        <Field id={`cond-threshold-${index}`} label="threshold">
          <input
            type="number" min={0.3} max={0.9} step={0.05} disabled={!canEdit} value={cond.dominantThreshold}
            onChange={(e) => patch({ dominantThreshold: Number(e.target.value) })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <Field id={`cond-max-distinct-${index}`} label="จำกัดจำนวนแกนต่างกัน" hint="เว้นว่าง = ไม่จำกัด">
          <input
            type="number" min={1} max={6} disabled={!canEdit}
            value={cond.maxDistinct ?? ''}
            onChange={(e) => patch({ maxDistinct: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 56, textAlign: 'right' }}
          />
        </Field>
      </div>
    </div>
  )
}

function ArchetypeRow({ archetype, index, canEdit, onChange, onRemove }: {
  archetype: GroupArchetype
  index: number
  canEdit: boolean
  onChange: (patch: Partial<GroupArchetype>) => void
  onRemove: () => void
}) {
  const isDeadNonFallback = !archetype.fallback && !archetype.condition

  return (
    <div style={boxStyle} data-archetype={index}>
      <div style={rowStyle}>
        <Field id={`arch-code-${index}`} label="รหัส">
          <input
            value={archetype.code} maxLength={30} disabled={!canEdit}
            onChange={(e) => onChange({ code: e.target.value })}
            style={{ fontFamily: 'var(--mono)', width: 120 }}
          />
        </Field>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Field id={`arch-title-${index}`} label="หัวข้อ">
            <input
              value={archetype.title} maxLength={120} disabled={!canEdit}
              onChange={(e) => onChange({ title: e.target.value })}
              style={{ width: '100%' }}
            />
          </Field>
        </div>
        <Field id={`arch-min-size-${index}`} label="ขนาดกลุ่มขั้นต่ำ">
          <input
            type="number" min={2} max={200} disabled={!canEdit} value={archetype.minGroupSize}
            onChange={(e) => onChange({ minGroupSize: Number(e.target.value) })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <Field id={`arch-max-size-${index}`} label="ขนาดกลุ่มสูงสุด" hint="เว้นว่าง = ไม่จำกัด">
          <input
            type="number" min={2} max={200} disabled={!canEdit}
            value={archetype.maxGroupSize ?? ''}
            onChange={(e) => onChange({ maxGroupSize: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox" checked={archetype.fallback ?? false} disabled={!canEdit}
            onChange={(e) => onChange({ fallback: e.target.checked })}
          />
          fallback
        </label>
        {canEdit && <Button type="button" variant="ghost" onClick={onRemove}>ลบ</Button>}
      </div>

      <Field id={`arch-body-${index}`} label="เนื้อหา">
        <textarea
          value={archetype.body} maxLength={600} disabled={!canEdit} rows={2}
          onChange={(e) => onChange({ body: e.target.value })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field id={`arch-image-url-${index}`} label="รูปภาพ (ไม่บังคับ)" hint="ใส่ URL รูป ไม่ใส่ก็ได้">
        <input
          value={archetype.imageUrl ?? ''} disabled={!canEdit}
          onChange={(e) => onChange({ imageUrl: e.target.value.trim() === '' ? undefined : e.target.value })}
        />
      </Field>

      {!archetype.fallback && (
        <ConditionEditor
          condition={archetype.condition}
          index={index}
          canEdit={canEdit}
          onChange={(condition) => onChange({ condition: condition ?? null })}
        />
      )}

      {isDeadNonFallback && (
        <Note tone="warn">
          archetype นี้ไม่ใช่ fallback แต่ไม่มีเงื่อนไขตั้งไว้เลย — จะไม่มีวันถูกใช้ (ไม่มีเงื่อนไขก็ไม่มีวันตรง)
        </Note>
      )}
    </div>
  )
}

export type GroupConfigEditorProps = {
  group: GroupConfig | undefined
  axes: QuizAxis[]
  canEdit: boolean
  onChange: (group: GroupConfig | undefined) => void
}

export function GroupConfigEditor({ group, axes: _axes, canEdit, onChange }: GroupConfigEditorProps) {
  if (!group) {
    return (
      <Panel style={{ marginTop: 14, padding: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            id="group-enabled" type="checkbox" checked={false} disabled={!canEdit}
            onChange={(e) => onChange(e.target.checked ? DEFAULT_GROUP : undefined)}
          />
          เปิดใช้งานผลลัพธ์กลุ่ม
        </label>
      </Panel>
    )
  }

  const addArchetype = () => {
    const code = uniqueId(group.archetypes.map((a) => a.code), 'archetype')
    onChange({ ...group, archetypes: [...group.archetypes, { code, title: '', body: '', minGroupSize: 2, fallback: false }] })
  }
  const updateArchetype = (index: number, patch: Partial<GroupArchetype>) => {
    onChange({ ...group, archetypes: replaceAt(group.archetypes, index, patch) })
  }
  const removeArchetype = (index: number) => {
    const removedCode = group.archetypes[index]?.code
    const archetypes = removeAt(group.archetypes, index)
    const fallbackArchetype = group.fallbackArchetype === removedCode
      ? (archetypes[0]?.code ?? '')
      : group.fallbackArchetype
    onChange({ ...group, archetypes, fallbackArchetype })
  }

  return (
    <Panel style={{ marginTop: 14 }}>
      <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--rule)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            id="group-enabled" type="checkbox" checked={group.enabled} disabled={!canEdit}
            onChange={(e) => onChange({ ...group, enabled: e.target.checked })}
          />
          เปิดใช้งานผลลัพธ์กลุ่ม
        </label>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={rowStyle}>
          <Field id="group-min-members" label="จำนวนสมาชิกขั้นต่ำ">
            <input
              type="number" min={2} max={200} disabled={!canEdit} value={group.minMembers}
              onChange={(e) => onChange({ ...group, minMembers: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
          <Field id="group-max-members" label="จำนวนสมาชิกสูงสุด">
            <input
              type="number" min={2} max={200} disabled={!canEdit} value={group.maxMembers}
              onChange={(e) => onChange({ ...group, maxMembers: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
          <Field id="group-result-locks-at" label="ล็อกผลเมื่อครบกี่คน" hint="0 = ไม่ล็อก">
            <input
              type="number" min={0} max={200} disabled={!canEdit} value={group.resultLocksAt}
              onChange={(e) => onChange({ ...group, resultLocksAt: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
        </div>

        <span style={smallLabelStyle}>Archetype (ผลลัพธ์ตามองค์ประกอบกลุ่ม) · ตอนนี้มี {group.archetypes.length}</span>
        {group.archetypes.map((archetype, index) => (
          <ArchetypeRow
            key={index}
            archetype={archetype}
            index={index}
            canEdit={canEdit}
            onChange={(patch) => updateArchetype(index, patch)}
            onRemove={() => removeArchetype(index)}
          />
        ))}
        {canEdit && (
          <div>
            <Button type="button" variant="ghost" onClick={addArchetype}>＋ เพิ่ม archetype</Button>
          </div>
        )}

        <Field id="group-fallback-archetype" label="Fallback archetype หลัก" hint="ต้องเป็นรหัสที่มีอยู่จริงในรายการข้างบน">
          <select
            value={group.fallbackArchetype} disabled={!canEdit}
            onChange={(e) => onChange({ ...group, fallbackArchetype: e.target.value })}
          >
            <option value="">— เลือก —</option>
            {group.archetypes.map((a, i) => (
              <option key={i} value={a.code}>{a.code || '(ยังไม่ตั้งรหัส)'}</option>
            ))}
          </select>
        </Field>
        <span style={noteStyle}>ตัวเลือกแกนที่มีอยู่: {_axes.map((a) => a.id).join(', ') || '(ยังไม่มีแกน)'}</span>
      </div>
    </Panel>
  )
}
