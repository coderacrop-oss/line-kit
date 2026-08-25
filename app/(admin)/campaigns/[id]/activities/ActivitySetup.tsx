import type { CSSProperties, ReactNode } from 'react'
import { Badge, Button, Field, Note, Panel, STATUS_TONES } from '@/components/ui'
import {
  INPUT_TYPES, RESOLVE_METHODS, type WizardField,
  inputTypeName, isComboAllowed, resolveMethodName,
} from '@/lib/activities/wizard'
import {
  ENTRY_RULE_FIELDS, ENTRY_RULE_NAME, ENTRY_RULE_TYPES, PLAY_COUNT_OPS,
  type ActivityScreen, type EntryRuleConfig, type EntryRuleField, type EntryRuleType,
  type OutcomeConfig, activitySummary, fieldsForActivity,
} from '@/lib/db/activities'
import {
  removeEntryRule, removeOutcome, saveActivity, saveEffects, saveEntryRule, saveInputConfig,
  saveOutcome,
} from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const smallLabelStyle: CSSProperties = { ...labelStyle, fontSize: 10, fontWeight: 500 }

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

/**
 * ควิซบุคลิกภาพไม่มี resolve_method ให้ผสม (0014_quiz_engine.sql) และจอนี้ (M7-S02)
 * ไม่ใช่จอตั้งค่าของมัน (ดู ../[activityId]/quiz/page.tsx) — เสนอมันในช่องแกน 1 ที่
 * นี่จะทำให้แก้กิจกรรมชนิดอื่นให้กลายเป็นควิซได้จากจอที่ไม่มีทางเขียนมันให้ถูกกติกา
 * แล้ว saveActivity จะชน CHECK ของฐานข้อมูลแทน (Finding 2 ของรีวิวรอบสุดท้าย)
 */
const EDITABLE_INPUT_TYPES = INPUT_TYPES.filter((type) => type !== 'personality_quiz')

const readOnlyBoxStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 13,
  background: 'var(--panel-2)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: '9px 12px', color: 'var(--ink)',
}

const boxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 13,
  display: 'flex', flexDirection: 'column', gap: 9,
}

const numberStyle: CSSProperties = {
  fontFamily: 'var(--mono)', width: 84, textAlign: 'right',
}

const rowStyle: CSSProperties = {
  display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap',
}

/** ผังช่องที่ต้นแบบเสนอ · ค่าเป็นข้อความเพราะ input_config เก็บมันเป็นข้อความ */
const GRID_LAYOUTS = ['1x2', '1x3', '2x2', '2x3', '3x3']

/**
 * ฟอร์มจริงเมื่อแก้ได้ · กล่องเปล่าเมื่อดูอย่างเดียว
 *
 * A reporter gets the same controls, disabled and with no form around them, so
 * the screen reads the same for everyone and the hiding is not what enforces
 * anything — every action calls requireRole() on its own.
 */
function Writable({ action, children }: {
  action?: (formData: FormData) => Promise<void>
  children: ReactNode
}) {
  if (!action) return <div style={{ display: 'contents' }}>{children}</div>
  return <form action={action} style={{ display: 'contents' }}>{children}</form>
}

/** หัวของบล็อกหนึ่งใน M7-S02 · เลขบล็อก ชื่อ แล้วคำกำกับตัวเล็ก */
function BlockHead({ n, title, note }: { n: number; title: string; note: string }) {
  return (
    <div style={{
      padding: '13px 18px', borderBottom: '1px solid var(--rule)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500 }}>{n}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={smallLabelStyle}>{note}</span>
    </div>
  )
}

const Block = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
)

const asLines = (value: unknown): string =>
  Array.isArray(value) ? value.map((item) => String(item)).join('\n') : String(value ?? '')

/**
 * ตัวควบคุมหนึ่งตัวต่อ control ที่นิยามชนิดประกาศไว้ (BR-87)
 *
 * This is the whole of the screen's knowledge about block 2. It never asks what
 * kind of activity it is drawing — it asks the definition what fields to draw
 * and looks each one up by its control name. Adding an input type is a line in
 * lib/activities/wizard.ts; it is not a branch here.
 */
function configControl(field: WizardField, value: unknown, canEdit: boolean) {
  if (field.control === 'toggle') {
    return (
      <input
        type="checkbox"
        name={field.key}
        defaultChecked={value === true}
        disabled={!canEdit}
        style={{ width: 'auto' }}
      />
    )
  }

  if (field.control === 'lines') {
    return (
      <textarea
        name={field.key}
        defaultValue={asLines(value)}
        disabled={!canEdit}
        style={{ minHeight: 76, resize: 'vertical' }}
      />
    )
  }

  if (field.control === 'grid') {
    return (
      <select name={field.key} defaultValue={String(value ?? '')} disabled={!canEdit}>
        <option value="">— ยังไม่ได้เลือก —</option>
        {GRID_LAYOUTS.map((layout) => (
          <option key={layout} value={layout}>{layout}</option>
        ))}
      </select>
    )
  }

  return (
    <input name={field.key} defaultValue={String(value ?? '')} disabled={!canEdit} />
  )
}

/** ช่องหนึ่งช่องของเงื่อนไข · ชื่อของช่องคือคีย์ที่ engine อ่าน ไม่มีตารางแปลงชื่อ */
function RuleControl({ field, rule, screen, canEdit, id }: {
  field: EntryRuleField
  rule: EntryRuleConfig
  screen: ActivityScreen
  canEdit: boolean
  id: string
}) {
  const value = rule[field.key]

  const control = field.control === 'reward' ? (
    <select name={field.key} defaultValue={String(value ?? '')} disabled={!canEdit}>
      <option value="">— เลือกรางวัล —</option>
      {screen.rewardCodes.map((code) => <option key={code} value={code}>{code}</option>)}
    </select>
  ) : field.control === 'activity' ? (
    <select name={field.key} defaultValue={String(value ?? '')} disabled={!canEdit}>
      <option value="">— เลือกกิจกรรม —</option>
      {screen.siblings.map((one) => (
        <option key={one.id} value={one.code}>{one.name} · {one.code}</option>
      ))}
    </select>
  ) : field.control === 'op' ? (
    <select name={field.key} defaultValue={String(value ?? 'gte')} disabled={!canEdit}>
      {PLAY_COUNT_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
    </select>
  ) : field.control === 'number' ? (
    <input
      name={field.key}
      inputMode="numeric"
      pattern="[0-9]*"
      defaultValue={value === undefined ? '' : String(value)}
      disabled={!canEdit}
      style={numberStyle}
    />
  ) : (
    <input
      name={field.key}
      defaultValue={Array.isArray(value) ? value.join(',') : String(value ?? '')}
      disabled={!canEdit}
    />
  )

  return <Field id={id} label={field.label} hint={field.hint}>{control}</Field>
}

/**
 * ช่องเลือกการ์ดของแคมเปญนี้
 *
 * คืน element ตรงๆ ไม่ได้ห่อเป็นคอมโพเนนต์ เพราะ `Field` โคลนลูกของมันเพื่อยัด id
 * ที่ผูกกับ <label> เข้าไป — ลูกที่เป็นคอมโพเนนต์ของเราเองจะรับ id นั้นไว้เฉยๆ
 * แล้วป้ายกับช่องจะไม่ผูกกัน ซึ่งอ่านด้วยโปรแกรมอ่านหน้าจอไม่รู้เรื่อง
 */
function cardSelect(
  name: string, defaultValue: string, screen: ActivityScreen, canEdit: boolean, required = false,
) {
  return (
    <select name={name} defaultValue={defaultValue} disabled={!canEdit} required={required}>
      <option value="">— ยังไม่ได้เลือก —</option>
      {screen.cards.map((card) => (
        <option key={card.id} value={card.id}>{card.code}</option>
      ))}
    </select>
  )
}

/**
 * เงื่อนไขหนึ่งข้อ · ช่องที่ขึ้นตามชนิดที่บันทึกไว้ ไม่ใช่ตามชนิดที่ค้างอยู่ในช่องเลือก
 *
 * This screen has no client state, so the controls cannot change shape when the
 * type select changes — they follow the type in the database and catch up on
 * the next save, the same way the reward screen's value box does.
 */
function EntryRuleForm({ campaignId, activityId, index, rule, screen, canEdit }: {
  campaignId: string
  activityId: string
  index: number
  rule: EntryRuleConfig
  screen: ActivityScreen
  canEdit: boolean
}) {
  const type = rule.type as EntryRuleType
  const key = index < 0 ? 'new' : String(index)
  const missingCard = index >= 0 && !rule.cardId

  return (
    <div style={boxStyle} data-entry-rule={index < 0 ? undefined : index}>
      <Writable
        action={canEdit ? saveEntryRule.bind(null, campaignId, activityId, index) : undefined}
      >
        <div style={rowStyle}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
            {index < 0 ? '＋' : index + 1}
          </span>

          <div style={{ flex: 1, minWidth: 200 }}>
            <Field id={`rule-type-${key}`} label="ชนิดเงื่อนไข">
              <select name="type" defaultValue={type} disabled={!canEdit}>
                {ENTRY_RULE_TYPES.map((one) => (
                  <option key={one} value={one}>{ENTRY_RULE_NAME[one]}</option>
                ))}
              </select>
            </Field>
          </div>

          {(ENTRY_RULE_FIELDS[type] ?? []).map((field) => (
            <div key={field.key} style={{ flex: 1, minWidth: 160 }}>
              <RuleControl
                id={`rule-${field.key}-${key}`}
                field={field}
                rule={rule}
                screen={screen}
                canEdit={canEdit}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field
              id={`rule-card-${key}`}
              label="ถ้าไม่ผ่าน ตอบการ์ด"
              error={missingCard
                ? 'ทุกเงื่อนไขต้องมีการ์ดตอบ ไม่งั้นผู้เล่นกดแล้วเงียบ (BR-26)'
                : undefined}
            >
              {cardSelect('card_id', String(rule.cardId ?? ''), screen, canEdit)}
            </Field>
          </div>

          {canEdit && (
            <Button type="submit" variant="ghost">
              {index < 0 ? '＋ เพิ่มเงื่อนไข' : 'บันทึกเงื่อนไขข้อนี้'}
            </Button>
          )}
        </div>
      </Writable>

      {/* ฟอร์มลบอยู่ข้างนอก ไม่ได้ซ้อนอยู่ในฟอร์มบันทึก · ฟอร์มซ้อนกันไม่ใช่ HTML ที่ใช้ได้ */}
      {canEdit && index >= 0 && (
        <form action={removeEntryRule.bind(null, campaignId, activityId, index)}>
          <Button type="submit" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
            เอาเงื่อนไขข้อนี้ออก
          </Button>
        </form>
      )}
    </div>
  )
}

/**
 * ผลลัพธ์หนึ่งแถว · คอลัมน์ที่มีมาจากนิยามชนิด ไม่ใช่จากชนิดของกิจกรรม
 *
 * A weighted activity gets a weight box and a score activity gets a band pair
 * because fieldsFor() said so, not because this component asked which one it
 * was looking at.
 */
function OutcomeForm({ campaignId, activityId, index, outcome, fields, screen, canEdit }: {
  campaignId: string
  activityId: string
  index: number
  outcome: OutcomeConfig
  fields: WizardField[]
  screen: ActivityScreen
  canEdit: boolean
}) {
  const key = index < 0 ? 'new' : String(index)
  const showWeight = fields.some((field) => field.control === 'outcome_weight')
  const showBand = fields.some((field) => field.control === 'outcome_band')
  const missingCard = index >= 0 && !outcome.cardId

  return (
    <div style={boxStyle} data-outcome={index < 0 ? undefined : index}>
      <Writable
        action={canEdit ? saveOutcome.bind(null, campaignId, activityId, index) : undefined}
      >
        <div style={rowStyle}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
            {index < 0 ? '＋' : index + 1}
          </span>

          <div style={{ flex: 1, minWidth: 170 }}>
            <Field id={`out-label-${key}`} label="ป้ายที่ผู้ใช้เห็น">
              <input name="label" defaultValue={outcome.label ?? ''} disabled={!canEdit} />
            </Field>
          </div>

          {showWeight && (
            <Field id={`out-weight-${key}`} label="น้ำหนัก">
              <input
                name="weight"
                inputMode="numeric"
                pattern="[0-9]*"
                defaultValue={outcome.weight === undefined ? '' : String(outcome.weight)}
                disabled={!canEdit}
                style={numberStyle}
              />
            </Field>
          )}

          {showBand && (
            <>
              <Field id={`out-min-${key}`} label="ตอบถูกตั้งแต่">
                <input
                  name="score_min"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  defaultValue={outcome.scoreMin === undefined ? '' : String(outcome.scoreMin)}
                  disabled={!canEdit}
                  style={numberStyle}
                />
              </Field>
              <Field id={`out-max-${key}`} label="ถึง">
                <input
                  name="score_max"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  defaultValue={outcome.scoreMax === undefined ? '' : String(outcome.scoreMax)}
                  disabled={!canEdit}
                  style={numberStyle}
                />
              </Field>
            </>
          )}
        </div>

        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field
              id={`out-card-${key}`}
              label="การ์ดที่ตอบ (บังคับ)"
              error={missingCard ? 'ยังไม่ได้เลือกการ์ดที่ตอบ — ผู้เล่นกดแล้วเงียบ' : undefined}
            >
              {cardSelect('card_id', String(outcome.cardId ?? ''), screen, canEdit)}
            </Field>
          </div>

          <div style={{ flex: 1, minWidth: 180 }}>
            <Field
              id={`out-reward-${key}`}
              label="รางวัลที่แจก"
              hint="จำนวนคงเหลือมีเจ้าของที่เดียวคือรางวัล (BR-30) — ที่นี่ไม่มีช่องกรอกโควตาซ้ำ"
            >
              <select
                name="reward_code"
                defaultValue={outcome.rewardCode ?? ''}
                disabled={!canEdit}
              >
                <option value="">— ไม่แจกรางวัล —</option>
                {screen.rewardCodes.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </Field>
          </div>

          {canEdit && (
            <Button type="submit" variant="ghost">
              {index < 0 ? '＋ เพิ่มผลลัพธ์' : 'บันทึกผลลัพธ์แถวนี้'}
            </Button>
          )}
        </div>
      </Writable>

      {canEdit && index >= 0 && (
        <form action={removeOutcome.bind(null, campaignId, activityId, index)}>
          <Button type="submit" variant="ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
            เอาผลลัพธ์แถวนี้ออก
          </Button>
        </form>
      )}
    </div>
  )
}

/**
 * สวิตช์ทริกเกอร์ "ตอนแอดเป็นเพื่อน" · หนึ่งแคมเปญมีได้ตัวเดียว (BR-90)
 *
 * The partial unique index refuses the second one on its own, and saveActivity
 * refuses it earlier with a sentence. Neither is any use to the person standing
 * here, because what they need is the name of the activity holding the trigger
 * and a way to get to it — so that is what this draws, and the switch is closed
 * rather than left open to produce a refusal they cannot act on.
 */
function FollowTrigger({ campaignId, activityId, isFollow, holder, canEdit }: {
  campaignId: string
  activityId: string
  isFollow: boolean
  holder: { id: string; code: string; name: string } | null
  canEdit: boolean
}) {
  const heldByOther = holder !== null && holder.id !== activityId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
        <input
          type="checkbox"
          name="trigger"
          value="follow"
          defaultChecked={isFollow}
          disabled={!canEdit || heldByOther}
        />
        เริ่มเล่นตอนแอดเป็นเพื่อน
      </label>

      {heldByOther ? (
        <Note tone="warn">
          แคมเปญนี้มีกิจกรรมทักทายอยู่แล้ว — {' '}
          <a
            href={`/campaigns/${campaignId}/activities/${holder.id}`}
            style={{ textDecoration: 'underline' }}
          >
            {holder.name} ({holder.code})
          </a>
          {' '} ถืออยู่ (BR-90) · ปลดที่กิจกรรมนั้นก่อน แล้วค่อยกลับมาตั้งตัวนี้แทน
        </Note>
      ) : (
        <span style={noteStyle}>
          หนึ่งแคมเปญมีกิจกรรมทักทายได้ตัวเดียว (BR-90) — ตัวที่ถืออยู่คือตัวที่ผู้เล่นเจอทันทีที่แอด
        </span>
      )}
    </div>
  )
}

/**
 * ทั้งจอ M7-S02 นอกจากหัวเรื่อง
 *
 * แยกจาก page.tsx เพื่อให้วาดในเทสต์ได้จริง — จอนี้ถือกฎสามข้อที่ต้องพิสูจน์ด้วยการวาด
 * ไม่ใช่ด้วยการอ่านไฟล์ · BR-87 ที่ช่องทุกช่องมาจาก fieldsFor() · BR-31 ที่การ์ดสำรอง
 * อยู่ในฟอร์มเดียวกับช่องวิธีตัดสินผล · และ BR-90 ที่ต้องบอกว่าใครถือทริกเกอร์อยู่พร้อมลิงก์
 */
export function ActivitySetup({ campaignId, screen, followHolder, canEdit }: {
  campaignId: string
  screen: ActivityScreen
  followHolder: { id: string; code: string; name: string } | null
  canEdit: boolean
}) {
  const { activity } = screen
  const isLookup = activity.resolveMethod === 'lookup'
  const fields = fieldsForActivity(activity)

  const columnFields = fields.filter((field) => field.store === 'column')
  const configFields = fields.filter((field) => field.store === 'input_config')
  const blockOne = fields.find((field) => field.key === 'entry_rules')
  const blockThree = fields.find((field) => field.key === 'outcomes')
  const outcomeColumns = fields.filter(
    (field) => field.control === 'outcome_weight' || field.control === 'outcome_band',
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel style={{ padding: 18 }}>
        <Writable action={canEdit ? saveActivity.bind(null, campaignId, activity.id) : undefined}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="ชื่อกิจกรรม (บังคับ)">
                <input name="name" required maxLength={100} defaultValue={activity.name} disabled={!canEdit} />
              </Field>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>รหัสกิจกรรม</span>
                <div style={readOnlyBoxStyle}>{activity.code}</div>
                <span style={noteStyle}>
                  แก้ไม่ได้หลังสร้าง — รหัสนี้เดินทางอยู่ในปุ่มที่ส่งออกไปแล้ว lib/match/postback.ts
                  เขียนมันลงไปในทุกปุ่มเป็น a=&lt;code&gt; เปลี่ยนแล้วการ์ดที่ค้างอยู่ในแชตของคน
                  จะกลายเป็นปุ่มที่กดแล้วไม่เจออะไร
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="แกน 1 · รับอินพุตยังไง">
                <select name="input_type" defaultValue={activity.inputType} disabled={!canEdit}>
                  {EDITABLE_INPUT_TYPES.map((type) => (
                    <option key={type} value={type}>{inputTypeName(type)}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="แกน 2 · ตัดสินผลยังไง"
                hint="ตัวเลือกที่ผสมกับชนิดอินพุตปัจจุบันไม่ได้จะกดไม่ได้ (BR-36)"
              >
                <select
                  name="resolve_method"
                  defaultValue={isLookup ? 'weighted' : activity.resolveMethod}
                  disabled={!canEdit}
                >
                  {RESOLVE_METHODS.map((method) => (
                    <option
                      key={method}
                      value={method}
                      disabled={!isComboAllowed(activity.inputType, method)}
                    >
                      {resolveMethodName(method)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {isLookup && (
              <Note tone="warn">
                วิธีตัดสินผล &ldquo;ค้นจากตาราง&rdquo; ยังไม่รองรับในรอบนี้ — เลือกวิธีอื่นแล้วบันทึก
                ก่อน ช่องที่เหลือของกิจกรรมนี้จึงจะขึ้นมาให้ตั้ง
              </Note>
            )}

            {/* ช่องที่เก็บลงคอลัมน์ของตาราง อยู่ในฟอร์มเดียวกับสองแกน — การ์ดสำรองของ
                โควตาเป็นตัวเดียวในตอนนี้ และมันต้องมาพร้อมกับช่องวิธีตัดสินผล เพราะ
                saveActivity ปฏิเสธโควตาที่ไม่มีการ์ดสำรอง (BR-31) ถ้าสองช่องอยู่คนละ
                ฟอร์ม จะไม่มีทางเปลี่ยนมาเป็นโควตาได้เลยสักครั้ง */}
            {columnFields.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                {cardSelect(
                  field.key, String(activity.fallbackCardId ?? ''), screen, canEdit, field.required,
                )}
              </Field>
            ))}

            <FollowTrigger
              campaignId={campaignId}
              activityId={activity.id}
              isFollow={activity.isFollowEntry}
              holder={followHolder}
              canEdit={canEdit}
            />

            {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">บันทึกกิจกรรม</Button>
              </div>
            )}
          </div>
        </Writable>
      </Panel>

      {activity.isIncomplete ? (
        <Panel>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--rule)', fontSize: 13, fontWeight: 600 }}>
            ยังกรอกไม่ครบ — ทุกข้อข้างล่างนี้เป็นสิ่งที่ผู้เล่นจะเจอ ไม่ใช่คำบ่นของเครื่องมือ
          </div>
          {activity.problems.map((problem) => (
            <div
              key={problem}
              data-problem=""
              style={{
                padding: '11px 16px', borderBottom: '1px solid var(--rule)',
                fontSize: 12, lineHeight: 1.6, color: STATUS_TONES.warn.fg,
              }}
            >
              {problem}
            </div>
          ))}
        </Panel>
      ) : (
        <Note tone="ok">กรอกครบแล้ว — ทดลองเล่นหรือส่งขึ้นได้</Note>
      )}

      {blockOne && (
        <Panel>
          <BlockHead n={1} title={blockOne.label} note="Entry rules · ตรวจเรียงจากบนลงล่าง" />
          <Block>
            {activity.entryRules.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                ไม่มีเงื่อนไข — ผู้เล่นกดเล่นได้เสมอ
              </span>
            )}

            {activity.entryRules.map((rule, index) => (
              <EntryRuleForm
                key={index}
                campaignId={campaignId}
                activityId={activity.id}
                index={index}
                rule={rule}
                screen={screen}
                canEdit={canEdit}
              />
            ))}

            {canEdit && (
              <EntryRuleForm
                campaignId={campaignId}
                activityId={activity.id}
                index={-1}
                rule={{ type: ENTRY_RULE_TYPES[0] }}
                screen={screen}
                canEdit={canEdit}
              />
            )}

            <span style={noteStyle}>
              {blockOne.hint} · ช่องของแต่ละข้อขึ้นตามชนิดที่บันทึกไว้ ไม่ใช่ตามชนิดที่ค้างอยู่ในช่องเลือก
              — จอนี้ไม่มีสถานะฝั่งเบราว์เซอร์ เลือกชนิดแล้วกดบันทึกก่อน ช่องของชนิดนั้นจะขึ้นมาให้กรอก
            </span>
          </Block>
        </Panel>
      )}

      <Panel>
        <BlockHead n={2} title="ตัดสินผลยังไง" note={activity.comboName} />
        <Block>
          {configFields.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              กิจกรรมนี้ไม่รับอินพุตจากผู้เล่น — ผลลัพธ์กำหนดในบล็อก 3 โดยตรง
            </span>
          ) : (
            <Writable action={canEdit ? saveInputConfig.bind(null, campaignId, activity.id) : undefined}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {configFields.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    {configControl(field, activity.inputConfig[field.key], canEdit)}
                  </Field>
                ))}

                {/* จอที่สัญญาพฤติกรรมที่ยังไม่มีใครเขียน คือจอที่โกหกอย่างสุภาพ */}
                <Note tone="warn">
                  ค่าในบล็อกนี้ยังไม่มีอะไรอ่าน — lib/db/queries.ts ไม่ได้ดึงคอลัมน์ input_config
                  ขึ้นมาเลย และ lib/webhook/handle.ts ส่งให้ engine แค่ช่องที่ผู้เล่นกดมากับ postback
                  · ค่าที่ตั้งตรงนี้ถูกเก็บไว้รอทางนั้น ยังไม่ใช่กติกาที่มีผลกับผู้เล่นวันนี้
                </Note>

                {canEdit && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button type="submit" variant="ghost">บันทึกบล็อก 2</Button>
                  </div>
                )}
              </div>
            </Writable>
          )}
        </Block>
      </Panel>

      {blockThree && (
        <Panel>
          <BlockHead n={3} title={blockThree.label} note="Outcomes · ตารางผลลัพธ์" />
          <Block>
            {outcomeColumns.map((field) => (
              <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={labelStyle}>{field.label}</span>
                {field.hint && <span style={noteStyle}>{field.hint}</span>}
              </div>
            ))}

            {activity.outcomes.map((outcome, index) => (
              <OutcomeForm
                key={outcome.id}
                campaignId={campaignId}
                activityId={activity.id}
                index={index}
                outcome={outcome}
                fields={fields}
                screen={screen}
                canEdit={canEdit}
              />
            ))}

            {canEdit && (
              <OutcomeForm
                campaignId={campaignId}
                activityId={activity.id}
                index={-1}
                outcome={{ id: '' }}
                fields={fields}
                screen={screen}
                canEdit={canEdit}
              />
            )}

            <span style={noteStyle}>{blockThree.hint}</span>

            <div style={{ height: 1, background: 'var(--rule)' }} />

            {/* ผลที่ตามมาอยู่ที่กิจกรรม ไม่ได้อยู่ที่ผลลัพธ์ · planEffects() เดินรายการของ
                กิจกรรม แล้ว grant_reward ที่ไม่ระบุรางวัลจะรับรางวัลของผลลัพธ์ที่ออกมาเอง
                ช่องนี้จึงถามครั้งเดียวต่อกิจกรรม ไม่ใช่ถามซ้ำทุกแถว · และมันคือช่องที่จอ
                ค่าสะสมส่งคนมากรอก ไม่งั้นค่าสะสมนั้นจะไม่มีวันเพิ่ม */}
            <Writable action={canEdit ? saveEffects.bind(null, campaignId, activity.id) : undefined}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={labelStyle}>ค่าสะสมที่กิจกรรมนี้บวกให้เมื่อเล่นจบ</span>

                {screen.counterCodes.length === 0 ? (
                  <span style={noteStyle}>
                    ยังไม่มีค่าสะสมในแคมเปญนี้ — สร้างที่จอค่าสะสมก่อน แล้วกลับมากรอกจำนวนตรงนี้
                  </span>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {screen.counterCodes.map((code) => (
                        <Field
                          key={code}
                          id={`units-${code}`}
                          label={code}
                        >
                          <input
                            name={`units_${code}`}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            defaultValue={activity.counterUnits[code] ?? ''}
                            placeholder="ไม่บวก"
                            disabled={!canEdit}
                            style={numberStyle}
                          />
                        </Field>
                      ))}
                    </div>

                    <span style={noteStyle}>
                      เว้นว่าง = ไม่บวกค่าสะสมตัวนั้น · จำนวนนี้บวกให้ทุกครั้งที่เล่นจบ
                      ไม่ว่าผลลัพธ์จะออกมาเป็นอันไหน — ส่วนรางวัลผูกอยู่กับผลลัพธ์แต่ละแถวข้างบน
                    </span>

                    {canEdit && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button type="submit" variant="ghost">บันทึกค่าสะสมที่บวกให้</Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Writable>
          </Block>
        </Panel>
      )}

      <div style={{
        border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)',
        background: 'var(--ground)', padding: '15px 18px',
      }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>สรุปการตั้งค่าปัจจุบัน</div>
        <div style={{ fontSize: 13, lineHeight: 1.65 }}>{activitySummary(activity)}</div>
        {!canEdit && (
          <div style={{ marginTop: 8 }}><Badge tone="mute">ดูอย่างเดียว</Badge></div>
        )}
      </div>
    </div>
  )
}
