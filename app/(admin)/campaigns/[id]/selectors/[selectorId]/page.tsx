import { notFound, redirect } from 'next/navigation'
import type { CSSProperties, ReactElement } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import {
  describeCondition, loadSelector, MAX_OPTIONS, RETURN_NAME, SELECTOR_RETURNS, SELECTOR_SOURCES,
  type SelectorOptionRow, type SelectorScreen, SOURCE_KEY_HINT, SOURCE_NAME,
} from '@/lib/db/selectors'
import { deleteSelector, deleteSelectorOption, saveSelector, saveSelectorOption } from '../actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const readOnlyBoxStyle: CSSProperties = {
  fontSize: 13, background: 'var(--panel-2)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: '9px 12px', color: 'var(--ink)',
}

const optionRowStyle: CSSProperties = {
  display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap',
  borderTop: '1px solid var(--rule)', paddingTop: 10,
}

const ordinalStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', width: 16, paddingBottom: 10,
}

const condBoxStyle: CSSProperties = {
  ...readOnlyBoxStyle, fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'center', minWidth: 84,
}

const usedByLineStyle: CSSProperties = { fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 8 }

const previewItemStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 3,
}

const previewLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const sideHeadStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8,
}

/**
 * ช่องที่กรอก "สิ่งที่คืน" · หน้าตาตามชนิดที่ชุดนี้บันทึกไว้ว่าคืนอะไร
 *
 * A text set gets a box to write in; a card set and an asset set get the
 * campaign's own list, because result_value holds an id or a url and nobody
 * should be typing either of those by hand. The control follows the type in the
 * database rather than the one sitting in the select, since this screen keeps no
 * state in the browser and catches up on the next save.
 *
 * A stored value that has since left the list keeps an option of its own.
 * Without it the select would fall back to the empty choice, and the next save
 * would quietly wipe a value that is still being answered with.
 */
function ValueControl({ screen, name, value, label, id }: {
  screen: SelectorScreen
  name: string
  value: string
  label: string
  id: string
}): ReactElement {
  const { selector, cards, assets } = screen

  if (selector.returns === 'card') {
    const missing = value !== '' && !cards.some((card) => card.id === value)
    return (
      <Field label={label} id={id}>
        <select name={name} defaultValue={value} required>
          <option value="">— เลือกการ์ด —</option>
          {missing && <option value={value}>{value} (ไม่อยู่ในแคมเปญนี้แล้ว)</option>}
          {cards.map((card) => <option key={card.id} value={card.id}>{card.code}</option>)}
        </select>
      </Field>
    )
  }

  if (selector.returns === 'asset') {
    const missing = value !== '' && !assets.some((asset) => asset.url === value)
    return (
      <Field label={label} id={id}>
        <select name={name} defaultValue={value} required>
          <option value="">— เลือกภาพ —</option>
          {missing && <option value={value}>{value} (ไม่อยู่ในคลังภาพแล้ว)</option>}
          {assets.map((asset) => (
            <option key={asset.id} value={asset.url}>{asset.label}</option>
          ))}
        </select>
      </Field>
    )
  }

  return (
    <Field label={label} id={id}>
      <textarea name={name} defaultValue={value} required style={{ minHeight: 38 }} />
    </Field>
  )
}

/**
 * แถวหนึ่งของตารางจับคู่
 *
 * ผู้ดูแลเนื้อหาได้ช่องเดียว · เงื่อนไขคือใครเห็นแถวไหน ซึ่งเป็นทางเดินของแคมเปญ ไม่ใช่ถ้อยคำ
 * (Permission Matrix · L1 §2) · สิ่งที่กันจริงคือคำสั่งใน action ที่ไม่มีคอลัมน์นั้นอยู่
 * ช่องที่หายไปตรงนี้เป็นแค่การไม่เชิญให้พิมพ์ของที่จะถูกทิ้ง
 */
function OptionRow({ campaignId, screen, option, ordinal, canEditCondition, canDelete }: {
  campaignId: string
  screen: SelectorScreen
  option: SelectorOptionRow
  ordinal: number
  canEditCondition: boolean
  canDelete: boolean
}) {
  const condition = describeCondition(option)

  return (
    <div data-option-row={option.id} style={optionRowStyle}>
      <span style={ordinalStyle}>{ordinal}</span>

      <form
        action={saveSelectorOption.bind(null, campaignId, screen.selector.id, option.id)}
        style={{ display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap', flex: 1 }}
      >
        {canEditCondition ? (
          <Field label="เงื่อนไข" id={`cond-${option.id}`}>
            <input
              name="condition"
              required
              defaultValue={condition}
              maxLength={100}
              style={{ fontFamily: 'var(--mono)', width: 84, textAlign: 'center' }}
            />
          </Field>
        ) : (
          <span style={condBoxStyle}>{condition}</span>
        )}

        <span style={{ color: 'var(--ink-3)', paddingBottom: 9 }}>→</span>

        <div style={{ flex: 1, minWidth: 200 }}>
          <ValueControl
            screen={screen}
            name="result_value"
            value={option.result_value}
            label="สิ่งที่คืน"
            id={`value-${option.id}`}
          />
        </div>

        <Button type="submit" variant="ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
          บันทึกแถวนี้
        </Button>
      </form>

      {/* ฟอร์มลบอยู่ข้างนอกฟอร์มบันทึก · ฟอร์มซ้อนกันไม่ใช่ HTML ที่ใช้ได้ */}
      {canDelete && (
        <form action={deleteSelectorOption.bind(null, campaignId, screen.selector.id, option.id)}>
          <Button type="submit" variant="ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
            ลบแถวนี้
          </Button>
        </form>
      )}
    </div>
  )
}

/** แถวเดียวกันสำหรับคนที่แก้อะไรไม่ได้เลย · อ่านได้ครบ ไม่มีช่องให้พิมพ์ */
function ReadOnlyOptionRow({ option, ordinal }: { option: SelectorOptionRow; ordinal: number }) {
  return (
    <div data-option-row={option.id} style={optionRowStyle}>
      <span style={ordinalStyle}>{ordinal}</span>
      <span style={condBoxStyle}>{describeCondition(option)}</span>
      <span style={{ color: 'var(--ink-3)', paddingBottom: 9 }}>→</span>
      <span style={{ ...readOnlyBoxStyle, flex: 1, minWidth: 200 }}>{option.result_value}</span>
    </div>
  )
}

export default async function SelectorEditPage({ params }: {
  params: Promise<{ id: string; selectorId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, selectorId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const found = await loadSelector(sql, campaign.id, selectorId)
  if (!found) notFound()

  const { selector, options } = found
  const isConfigurator = session.role === 'configurator'
  const isContentEditor = session.role === 'content_editor'
  const canEditCopy = isConfigurator || isContentEditor

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/selectors`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← ชุดเนื้อหาทั้งหมด
      </a>

      <PageHead
        code="M3-S03 · Selector setup"
        title={selector.name}
        actions={!canEditCopy ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      {isContentEditor && (
        <Note tone="warn" style={{ marginBottom: 16, maxWidth: 640 }}>
          <b>โหมดผู้ดูแลเนื้อหา</b> — แก้ได้เฉพาะข้อความในตารางทางเลือก
          เปลี่ยนโครง (คืนอะไร · เลือกจากค่าไหน · เพิ่มลบแถว) ไม่ได้ เพราะกระทบทางเดินของแคมเปญ
        </Note>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        <Panel style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isConfigurator ? (
            <form
              action={saveSelector.bind(null, campaign.id, selector.id)}
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <Field label="ชื่อชุด (บังคับ)">
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={selector.name}
                  placeholder="เช่น คำทำนายประจำวัน"
                />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="คืนอะไร (บังคับ)">
                  <select name="returns" defaultValue={selector.returns}>
                    {SELECTOR_RETURNS.map((value) => (
                      <option key={value} value={value}>{RETURN_NAME[value]}</option>
                    ))}
                  </select>
                </Field>

                <Field label="เลือกจากค่าไหน (บังคับ)">
                  <select name="source_type" defaultValue={selector.sourceType}>
                    {SELECTOR_SOURCES.map((value) => (
                      <option key={value} value={value}>{SOURCE_NAME[value]}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {selector.optionCount > 0 && (
                <Note tone="warn">
                  เปลี่ยนสิ่งที่ชุดนี้คืนไม่ได้ — มีทางเลือกอยู่แล้ว {selector.optionCount} แถว
                  ค่าในตารางถูกเขียนไว้เป็นของชนิดเดิม และไม่มีอะไรบอกว่าแถวไหนเขียนมาแบบเก่า
                  · ลบทางเลือกออกก่อน หรือสร้างชุดใหม่
                </Note>
              )}

              {/* สองช่องเหนือคอลัมน์เดียว · source_key เก็บความยาวรอบให้สองชนิด และเก็บชื่อ
                  ของค่าที่จะอ่านให้อีกสามชนิด · ต้นแบบซ่อนช่องความยาวรอบไว้จนกว่าจะเลือก
                  ชนิดที่เป็นรอบ ซึ่งต้องมี state ฝั่ง client · จอนี้ไม่มี และถ้าวาดช่องเดียว
                  ตามชนิดที่บันทึกไว้ คนที่เปลี่ยนชนิดจะกดบันทึกแล้วโดนปฏิเสธโดยไม่มีช่องให้ตอบ */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14 }}>
                <Field label="ชื่อค่าที่จะอ่าน" hint={SOURCE_KEY_HINT[selector.sourceType]}>
                  <input
                    name="source_key"
                    maxLength={100}
                    defaultValue={selector.isCycle ? '' : (selector.sourceKey ?? '')}
                    placeholder="เช่น pet_type"
                  />
                </Field>

                <Field label="ความยาวรอบ (วัน)" hint="7 = รายสัปดาห์ · 30 = รายเดือน">
                  <input
                    name="cycle_days"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    defaultValue={selector.cycleDays ?? 7}
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                </Field>
              </div>

              <div style={{ height: 1, background: 'var(--rule)' }} />

              <ValueControl
                screen={found}
                name="fallback_value"
                value={selector.fallbackValue}
                label="ของสำรอง (บังคับ · BR-27)"
                id="fallback-value"
              />
              <span style={noteStyle}>
                บังคับเพราะถ้าค่าไม่ตรงทางไหนเลยแล้วไม่มีของสำรอง ผู้เล่นจะกดแล้วเงียบ
              </span>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">บันทึก</Button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>คืนอะไร · เลือกจากค่าไหน</span>
                <div style={readOnlyBoxStyle}>
                  คืน{selector.returnName} · ตาม{selector.sourceName}
                  {selector.cycleText === null ? '' : ` · ${selector.cycleText}`}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>ของสำรอง (บังคับ · BR-27)</span>
                <div style={readOnlyBoxStyle}>{selector.fallbackValue}</div>
              </div>
            </div>
          )}

          <div style={{ height: 1, background: 'var(--rule)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, flexWrap: 'wrap',
            }}>
              <span style={labelStyle}>ตารางทางเลือก</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                ใช้ไป {selector.countText}
              </span>
            </div>

            {selector.isNearFull && (
              <Note tone="warn">
                ใกล้เต็มเพดาน {MAX_OPTIONS} ทางเลือก (BR-27) — จำกัดไว้เพราะเกินกว่านี้คนตั้งค่าจะตรวจงานไม่ไหว
                ถ้าต้องการมากกว่านี้ให้แยกเป็นชุดที่สองแล้วให้คนละช่องของการ์ดใช้คนละชุด
              </Note>
            )}

            {options.map((option, index) => (
              canEditCopy ? (
                <OptionRow
                  key={option.id}
                  campaignId={campaign.id}
                  screen={found}
                  option={option}
                  ordinal={index + 1}
                  canEditCondition={isConfigurator}
                  canDelete={isConfigurator}
                />
              ) : (
                <ReadOnlyOptionRow key={option.id} option={option} ordinal={index + 1} />
              )
            ))}

            {options.length === 0 && (
              <span style={noteStyle}>
                ยังไม่มีทางเลือกสักแถว — ตอนนี้ชุดนี้คืนของสำรองให้ทุกคนเสมอ
              </span>
            )}

            <span style={noteStyle}>ช่องเงื่อนไข: {selector.condHint}</span>

            {selector.isFull && (
              <span style={{ fontSize: 11, color: STATUS_TONES.warn.fg }}>
                เต็ม {MAX_OPTIONS} ทางเลือกแล้ว — เพิ่มอีกไม่ได้ (BR-27)
              </span>
            )}

            {isConfigurator && !selector.isFull && (
              <form
                action={saveSelectorOption.bind(null, campaign.id, selector.id, '')}
                style={{ display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }}
              >
                <Field label="เงื่อนไขของแถวใหม่" id="cond-new">
                  <input
                    name="condition"
                    required
                    maxLength={100}
                    style={{ fontFamily: 'var(--mono)', width: 84, textAlign: 'center' }}
                  />
                </Field>

                <span style={{ color: 'var(--ink-3)', paddingBottom: 9 }}>→</span>

                <div style={{ flex: 1, minWidth: 200 }}>
                  <ValueControl
                    screen={found}
                    name="result_value"
                    value=""
                    label="สิ่งที่แถวใหม่คืน"
                    id="value-new"
                  />
                </div>

                <Button type="submit" variant="ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
                  ＋ เพิ่มทางเลือก
                </Button>
              </form>
            )}
          </div>

          {isConfigurator && (
            selector.canDelete ? (
              <form action={deleteSelector.bind(null, campaign.id, selector.id)}>
                <Button type="submit" variant="danger">ลบชุดเนื้อหา</Button>
              </form>
            ) : (
              <span style={noteStyle}>{selector.deleteBlockedWhy}</span>
            )
          )}
        </Panel>

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 76,
        }}>
          {/* ต้นแบบซ่อนรายการนี้ไว้หลังปุ่มสลับ ซึ่งต้องมี state ฝั่ง client · แสดงทั้งหมดแทน
              ด้วยเหตุผลเดียวกับที่จอค่าสะสมไม่มีลิงก์ "ดูเพิ่มเติม" */}
          <Panel data-preview-all="" style={{ padding: 16 }}>
            <div style={sideHeadStyle}>ดูตัวอย่างทุกแบบ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {options.map((option, index) => (
                <div key={option.id} style={previewItemStyle}>
                  <span style={previewLabelStyle}>
                    {index + 1} · {describeCondition(option)}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>{option.result_value}</span>
                </div>
              ))}

              {/* ของสำรองอยู่ท้ายรายการเพราะมันคือสิ่งที่ผู้เล่นได้เมื่อไม่ตรงแถวไหนเลย */}
              <div style={previewItemStyle}>
                <span style={previewLabelStyle}>ของสำรอง</span>
                <span style={{ fontSize: 12, lineHeight: 1.5 }}>{selector.fallbackValue}</span>
              </div>
            </div>
          </Panel>

          <Panel style={{ padding: 16 }}>
            <div style={sideHeadStyle}>ใครใช้ชุดนี้อยู่</div>
            {selector.isOrphan ? (
              <div style={{ fontSize: 12, color: STATUS_TONES.danger.fg, lineHeight: 1.6 }}>
                ยังไม่มีการ์ดหรือกิจกรรมไหนใช้ชุดนี้
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selector.usedBy.map((label) => (
                  <div key={label} style={usedByLineStyle}>
                    <span style={{ color: 'var(--ink-3)' }}>·</span>{label}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </main>
  )
}
