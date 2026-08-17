import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note } from '@/components/ui'
import {
  BLOCK_TYPE_NAME, BUTTON_ACTION_OPTIONS, SHOW_WHEN_FIELDS, SHOW_WHEN_NAME, SHOW_WHEN_OPS,
  SHOW_WHEN_TYPES, readButtonAction, supportsContentSource,
} from '@/lib/cards/blocks'
import type { CardSelectorOption } from '@/lib/db/cardEditor'
import type { BlockType, CardBlock } from '@/lib/render/groups'
import type { Condition } from '@/lib/state'
import {
  addShowWhenCondition, removeShowWhenCondition, saveBlockContent,
} from '@/app/(admin)/campaigns/[id]/cards/[cardId]/actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const rowStyle: CSSProperties = { display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }

const chipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase',
  border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)', padding: '3px 9px',
  color: 'var(--ink-3)', width: 'fit-content',
}

const conditionBoxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 10,
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12,
}

/** ป้ายกลางของคีย์ที่ใช้ร่วมกันข้ามชนิดเงื่อนไข — ดูเหตุผลที่ใช้ในฟอร์มเพิ่มเงื่อนไขข้างล่าง */
const NEUTRAL_FIELD_LABEL: Record<string, string> = {
  activityCode: 'กิจกรรมที่เกี่ยวข้อง (ตามชนิดที่เลือกด้านบน)',
  key: 'ชื่อค่าประจำตัว',
}

function describeCondition(condition: Condition): string {
  switch (condition.type) {
    case 'has_attribute':
      return condition.value === undefined
        ? `มีค่าประจำตัว "${condition.key}"`
        : `ค่าประจำตัว "${condition.key}" เท่ากับ "${condition.value}"`
    case 'not_has_attribute':
      return `ไม่มีค่าประจำตัว "${condition.key}"`
    case 'has_entitlement':
      return `ถือสิทธิ์รางวัล "${condition.rewardCode}"`
    case 'activity_completed':
      return `เล่น "${condition.activityCode}" จบแล้ว`
    case 'activity_not_completed':
      return `ยังไม่เล่น "${condition.activityCode}"`
    case 'activity_play_count': {
      const op = condition.op === 'lt' ? 'ยังไม่ถึง' : 'ครบแล้วอย่างน้อย'
      return `เล่น "${condition.activityCode}" ${op} ${condition.count} ครั้ง`
    }
  }
}

/**
 * ส่วนที่ 2 · สวิตช์ตามสถานะ (คงที่ / เลือกจากชุดเนื้อหา) — ใช้โค้ดเดียวกันทุกชนิด
 *
 * ต้นแบบวาดสวิตช์นี้ให้สลับ `content` คงที่กับ `selector_id` ที่อ่านจากสถานะผู้เล่น
 * แต่เส้นทางที่ส่งข้อความจริง (`lib/db/queries.ts` → `lib/render/`) ไม่เคยเลือก
 * คอลัมน์ `selector_id` ขึ้นมาเลยสักที่ — บันทึกไปก็จะกลายเป็นข้อความว่างเปล่าตอน
 * ส่งจริง (`content` เป็น null และ `substitute(null ?? '', state)` คือสตริงว่าง)
 * เพื่อไม่ให้เอดิเตอร์นี้เปิดทางให้สร้างบล็อกที่ผู้เล่นไม่เห็นอะไรเลย โหมด "เลือกจาก
 * ชุดเนื้อหา" จึงปิดไว้พร้อมเหตุผล เหมือนที่ SEND_TYPE_OPTIONS ปิด imagemap
 */
function ContentSourceNote({ selectorCount }: { selectorCount: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ ...chipStyle, borderColor: 'var(--ink)', color: 'var(--ink)' }}>คงที่</span>
        <span style={chipStyle} title="ยังใช้งานจริงไม่ได้">🔒 เลือกจากชุดเนื้อหา</span>
      </div>
      <span style={noteStyle}>
        โหมด &ldquo;เลือกจากชุดเนื้อหา&rdquo; ยังใช้งานจริงไม่ได้ — เส้นทางที่ส่งข้อความเข้า LINE จริง
        (lib/db/queries.ts) ยังไม่อ่านคอลัมน์ selector_id เลย บันทึกไปก็จะกลายเป็นข้อความว่างเปล่า
        {selectorCount > 0 && ` แม้แคมเปญนี้จะมีชุดเนื้อหาอยู่แล้ว ${selectorCount} ชุดก็ตาม`}
        {' '}· ใช้ค่าคงที่ไปก่อน
      </span>
    </div>
  )
}

function OwnValueFields({ block, canEdit }: { block: CardBlock; canEdit: boolean }) {
  if (block.blockType === 'divider' || block.blockType === 'spacer') {
    return (
      <span style={noteStyle}>
        {BLOCK_TYPE_NAME[block.blockType]} ไม่มีค่าให้ตั้ง — ใช้แบ่งช่องว่างระหว่างบล็อกอื่นบนการ์ดเท่านั้น
      </span>
    )
  }

  if (block.blockType === 'image') {
    const fullTop = block.options?.placement === 'full_top'
    return (
      <>
        <Field label="URL ภาพ (บังคับ)" hint="ก็อป URL จากคลังภาพของแคมเปญนี้มาวาง">
          <input name="content" defaultValue={block.content ?? ''} disabled={!canEdit} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <input type="checkbox" name="full_top" defaultChecked={fullTop} disabled={!canEdit} />
          ใช้เป็นภาพหัวการ์ดแบบเต็มความกว้าง (มีผลเมื่อเป็นบล็อกแรกสุดของการ์ดเท่านั้น)
        </label>
      </>
    )
  }

  if (block.blockType === 'progress_bar') {
    const options = (block.options ?? {}) as { counter?: string; target?: number }
    return (
      <div style={rowStyle}>
        <Field label="ค่าสะสมที่จะแสดง (บังคับ)">
          <input
            name="counter" defaultValue={options.counter ?? ''} disabled={!canEdit}
            placeholder="รหัสค่าสะสม เช่น checkin_days"
          />
        </Field>
        <Field label="เป้าหมาย (บังคับ · > 0)" hint="ควรตรงกับเป้าที่ตั้งไว้ที่จอค่าสะสม">
          <input
            name="target" inputMode="numeric" pattern="[0-9]*"
            defaultValue={options.target ?? ''} disabled={!canEdit}
            style={{ fontFamily: 'var(--mono)', width: 120 }}
          />
        </Field>
      </div>
    )
  }

  if (block.blockType === 'button') {
    const { kind, target } = readButtonAction(block.options?.action as Record<string, unknown> | undefined)
    return (
      <>
        <Field label="ข้อความบนปุ่ม (บังคับ)">
          <input name="content" defaultValue={block.content ?? ''} disabled={!canEdit} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>ปลายทาง</span>
          <span title="ปลายทางของปุ่มต้องคงที่เสมอ ห้ามผูกกับชุดเนื้อหา (BR-40)">🔒</span>
        </div>
        <div style={rowStyle}>
          <Field label="ชนิดปลายทาง (บังคับ)">
            <select name="action_kind" defaultValue={kind ?? ''} disabled={!canEdit}>
              <option value="">— ยังไม่ได้เลือก —</option>
              {BUTTON_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} disabled={!option.open}>
                  {option.open ? option.name : `${option.name} (ยังใช้ไม่ได้)`}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="ปลายทาง (บังคับ)"
            hint={
              kind === 'uri' ? 'https://...'
                : 'คำที่พิมพ์แล้วตรงกับคีย์เวิร์ดที่ตั้งไว้ในแคมเปญนี้'
            }
          >
            <input name="action_target" defaultValue={target} disabled={!canEdit} />
          </Field>
        </div>
        <span style={noteStyle}>
          ปลายทางต้องเป็นค่าคงที่เสมอ (BR-40) — ถ้าปลายทางเปลี่ยนตามสถานะผู้เล่นได้ จะเกิดเส้นทางที่ไม่มีใคร
          มองเห็นภาพรวม ซึ่งเป็นสิ่งที่ตัดออกจากระบบนี้ไปแล้ว · &ldquo;ไปกิจกรรมอื่น (postback)&rdquo; ปิดไว้
          เพราะตัวเรนเดอร์ยังไม่ฉีดวันที่ของวันนี้ให้ปุ่ม กดแล้วจะเจอ &ldquo;การ์ดนี้หมดอายุแล้ว&rdquo; เสมอ
        </span>
      </>
    )
  }

  // title · body · caption
  const multiline = block.blockType === 'body'
  return (
    <Field label={`${BLOCK_TYPE_NAME[block.blockType]} (${block.blockType})`}>
      {multiline ? (
        <textarea
          name="content" defaultValue={block.content ?? ''} disabled={!canEdit}
          style={{ minHeight: 76, resize: 'vertical' }}
        />
      ) : (
        <input name="content" defaultValue={block.content ?? ''} disabled={!canEdit} />
      )}
    </Field>
  )
}

/** ส่วนที่ 3 · เงื่อนไขการแสดง — ใช้โค้ดเดียวกันทุกชนิด ไม่ว่าบล็อกจะเป็นแบบไหน */
function ShowWhenEditor({ campaignId, cardId, block, screen, canEdit }: {
  campaignId: string
  cardId: string
  block: CardBlock
  screen: { activities: Array<{ id: string; code: string; name: string }>; rewardCodes: string[] }
  canEdit: boolean
}) {
  const conditions = block.showWhen ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={labelStyle}>เงื่อนไขการแสดง (ต้องผ่านทุกข้อ)</span>

      {conditions.length === 0 && (
        <span style={noteStyle}>ไม่มีเงื่อนไข — แสดงเสมอเมื่อไม่ถูกเงื่อนไขอื่นในสามส่วนแรกซ่อนไว้</span>
      )}

      {conditions.map((condition, index) => (
        <div key={index} style={conditionBoxStyle}>
          <span>{describeCondition(condition)}</span>
          {canEdit && (
            <form action={removeShowWhenCondition.bind(null, campaignId, cardId, block.id, index)}>
              <Button type="submit" variant="ghost" style={{ padding: '4px 10px', fontSize: 11 }}>
                เอาเงื่อนไขนี้ออก
              </Button>
            </form>
          )}
        </div>
      ))}

      {canEdit && (
        <form
          action={addShowWhenCondition.bind(null, campaignId, cardId, block.id)}
          style={{ ...conditionBoxStyle, borderStyle: 'dashed' }}
        >
          <div style={rowStyle}>
            <Field id={`swtype-${block.id}`} label="ชนิดเงื่อนไข">
              <select name="type" defaultValue={SHOW_WHEN_TYPES[0]}>
                {SHOW_WHEN_TYPES.map((type) => (
                  <option key={type} value={type}>{SHOW_WHEN_NAME[type]}</option>
                ))}
              </select>
            </Field>
            {/*
              * ช่องของทุกชนิดแสดงพร้อมกันหมด ไม่ใช่เฉพาะชนิดที่เลือกอยู่ — ต่างจาก
              * EntryRuleForm ของจอกิจกรรม (ActivitySetup.tsx) ที่โชว์เฉพาะช่องของ
              * ชนิดแรกจนกว่าจะบันทึกแล้วโหลดใหม่ ซึ่งทำให้เพิ่มเงื่อนไขชนิดอื่นไม่ได้
              * ในครั้งเดียว — ที่นี่ deduplicate คีย์ที่ใช้ร่วมกันข้ามชนิด (activityCode)
              * แล้วตั้งป้ายเป็นคำกลาง เพราะ "กิจกรรมที่ต้องเล่นจบแล้ว" จะผิดความหมายทันที
              * ถ้าคนเลือกชนิด "ต้องยังไม่เล่น" แทน — ผู้ใช้เลือกชนิดจาก select ข้างบน
              * ก่อน แล้วช่องที่ตรงชนิดนั้นจะถูกใช้จริงตอนกดเพิ่ม ที่เหลือถูกเพิกเฉย
              */}
            {SHOW_WHEN_TYPES.flatMap((type) => SHOW_WHEN_FIELDS[type])
              .filter((field, i, all) => all.findIndex((f) => f.key === field.key) === i)
              .map((field) => (
                <Field
                  key={field.key} id={`sw-${field.key}-${block.id}`}
                  label={NEUTRAL_FIELD_LABEL[field.key] ?? field.label}
                  hint={field.hint}>
                  {field.control === 'reward' ? (
                    <select name={field.key} defaultValue="">
                      <option value="">— เลือกรางวัล —</option>
                      {screen.rewardCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                    </select>
                  ) : field.control === 'activity' ? (
                    <select name={field.key} defaultValue="">
                      <option value="">— เลือกกิจกรรม —</option>
                      {screen.activities.map((a) => (
                        <option key={a.id} value={a.code}>{a.name} · {a.code}</option>
                      ))}
                    </select>
                  ) : field.control === 'op' ? (
                    <select name={field.key} defaultValue="gte">
                      {SHOW_WHEN_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                  ) : field.control === 'number' ? (
                    <input name={field.key} inputMode="numeric" pattern="[0-9]*" style={{ width: 100 }} />
                  ) : (
                    <input name={field.key} />
                  )}
                </Field>
              ))}
          </div>
          <Button type="submit" variant="ghost" style={{ alignSelf: 'flex-start' }}>
            ＋ เพิ่มเงื่อนไข
          </Button>
        </form>
      )}
    </div>
  )
}

export type BlockFormProps = {
  campaignId: string
  cardId: string
  block: CardBlock
  canEdit: boolean
  selectorCount: number
  screen: { activities: Array<{ id: string; code: string; name: string }>; rewardCodes: string[] }
}

/**
 * ฟอร์มตั้งค่าบล็อกหนึ่งอัน · สามส่วนเสมอ — ค่าของตัวเอง (ต่างกันตามชนิด) ·
 * สวิตช์ตามสถานะ (โค้ดเดียวกันทุกชนิด) · เงื่อนไขการแสดง (โค้ดเดียวกันทุกชนิด)
 *
 * ฟอร์มบันทึก "ค่าของตัวเอง" อยู่นอกฟอร์มเงื่อนไข ไม่ซ้อนกัน — ฟอร์มซ้อนกันไม่ใช่
 * HTML ที่ใช้ได้ เหมือนที่จอกิจกรรมกับจอค่าสะสมทำ
 */
export function BlockForm({ campaignId, cardId, block, canEdit, selectorCount, screen }: BlockFormProps) {
  const showContentSwitch = supportsContentSource(block.blockType as BlockType)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 10px' }}>
      {!canEdit && <Badge tone="mute">ดูอย่างเดียว — บล็อกนี้แก้ได้เฉพาะผู้ตั้งค่า</Badge>}

      <form
        action={saveBlockContent.bind(null, campaignId, cardId, block.id)}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <OwnValueFields block={block} canEdit={canEdit} />
        {canEdit && <Button type="submit" variant="ghost" style={{ alignSelf: 'flex-start' }}>บันทึกบล็อกนี้</Button>}
      </form>

      {showContentSwitch && (
        <>
          <div style={{ height: 1, background: 'var(--rule)' }} />
          <ContentSourceNote selectorCount={selectorCount} />
        </>
      )}

      <div style={{ height: 1, background: 'var(--rule)' }} />
      <ShowWhenEditor
        campaignId={campaignId} cardId={cardId} block={block} screen={screen}
        canEdit={canEdit}
      />

      {canEdit && (
        <Note tone="warn" style={{ fontSize: 11 }}>
          ลบบล็อกนี้ได้จากรายการด้านบน — การลบไล่ลำดับบล็อกที่เหลือใหม่ให้อัตโนมัติ (BR-92)
        </Note>
      )}
    </div>
  )
}
