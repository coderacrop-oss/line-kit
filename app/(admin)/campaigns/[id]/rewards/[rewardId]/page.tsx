import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import {
  loadReward, REWARD_TYPES, REWARD_TYPE_NAME, type RewardCodeRow, type RewardScreen,
} from '@/lib/db/rewards'
import { deleteReward, deleteRewardCode, importRewardCodes, saveReward } from '../actions'

const readOnlyBoxStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 13,
  background: 'var(--panel-2)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: '9px 12px', color: 'var(--ink)',
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const statLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const statValueStyle: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 500 }

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const codeRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontFamily: 'var(--mono)', fontSize: 11,
  borderTop: '1px solid var(--rule)', padding: '5px 0',
}

const IMAGE_DATALIST = 'reward-value-images'

/**
 * ช่องค่าของรางวัล · หน้าตาตามชนิดที่บันทึกไว้ ไม่ใช่ตามชนิดที่เลือกค้างอยู่ในช่อง
 *
 * A link is a text box, an image is this campaign's list of images, and a text
 * reward is a textarea. This screen has no client state, so the control cannot
 * change shape when the type select changes — it follows the type in the
 * database and catches up on the next save.
 *
 * A code reward has no value of its own: its values live one per row in
 * reward_code. The box drawn for it is the one you would need to fill in on the
 * way out of that type, since saveReward demands a value for the other three,
 * and without it changing รหัสจากคลัง into ข้อความ would be a refusal with
 * nowhere on the screen to answer it.
 */
function ValueField({ screen }: { screen: RewardScreen }) {
  const { reward, images } = screen

  if (reward.rewardType === 'link') {
    return (
      <Field label="ลิงก์รางวัล (ต้องเป็น https)">
        <input
          name="value"
          defaultValue={reward.value ?? ''}
          placeholder="https://…"
          style={{ fontFamily: 'var(--mono)' }}
        />
      </Field>
    )
  }

  if (reward.rewardType === 'text') {
    return (
      <Field label="ข้อความรางวัล">
        <textarea name="value" defaultValue={reward.value ?? ''} style={{ minHeight: 66 }} />
      </Field>
    )
  }

  if (reward.rewardType === 'image') {
    // ภาพที่ถูกเอาออกจากคลังไปแล้วยังต้องมีตัวเลือกของตัวเอง · ไม่งั้น select จะ
    // ตกไปที่ "— เลือกภาพ —" เงียบๆ แล้วการกดบันทึกครั้งถัดไปจะลบค่าที่ยังใช้อยู่ทิ้ง
    const missing = reward.value !== null && !images.some((image) => image.url === reward.value)

    return (
      <Field
        label="ภาพรางวัล (เลือกจากคลังภาพ)"
        hint={images.length === 0 ? 'แคมเปญนี้ยังไม่มีภาพในคลัง — อัปโหลดที่จอคลังภาพก่อน' : undefined}
      >
        <select name="value" defaultValue={reward.value ?? ''}>
          <option value="">— เลือกภาพ —</option>
          {missing && (
            <option value={reward.value as string}>
              {reward.value} · ไม่มีภาพนี้อยู่ในคลังแล้ว
            </option>
          )}
          {images.map((image) => (
            <option key={image.id} value={image.url}>{image.label}</option>
          ))}
        </select>
      </Field>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{
        border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 13, ...noteStyle,
      }}>
        ชนิด &ldquo;รหัสจากคลัง&rdquo; ไม่มีช่องค่าของรางวัล — ค่าอยู่ในคลังรหัสทางขวา
      </div>
      <Field
        label="ค่าของรางวัล (ใช้เมื่อเปลี่ยนไปเป็นชนิดอื่น)"
        hint="ชนิดรหัสจากคลังไม่อ่านช่องนี้เลย · มีไว้ให้กรอกในการบันทึกครั้งเดียวกับที่เปลี่ยนชนิด เพราะอีกสามชนิดต้องมีค่าเสมอ · ภาพเลือกได้จากรายการที่ผูกไว้กับช่องนี้"
      >
        <input name="value" list={IMAGE_DATALIST} defaultValue="" style={{ fontFamily: 'var(--mono)' }} />
      </Field>
      <datalist id={IMAGE_DATALIST}>
        {images.map((image) => <option key={image.id} value={image.url}>{image.label}</option>)}
      </datalist>
    </div>
  )
}

/**
 * คลังรหัส · หนึ่งแถวคือหนึ่งรหัสที่ยังไม่มีเจ้าของ หรือมีแล้ว
 *
 * The delete buttons sit in their own forms rather than inside the save form,
 * because nesting forms is not HTML a browser will honour, and because removing
 * a code is not part of saving the reward.
 */
function CodeVault({ campaignId, screen, canEdit }: {
  campaignId: string
  screen: RewardScreen
  canEdit: boolean
}) {
  const { reward, codes } = screen
  const stock = reward.codeStock ?? { total: 0, issued: 0, left: 0 }

  return (
    <Panel style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
      <span style={labelStyle}>คลังรหัส</span>

      <div style={{ display: 'flex', gap: 14 }}>
        <div>
          <div style={statValueStyle}>{stock.total}</div>
          <span style={statLabelStyle}>ทั้งหมด</span>
        </div>
        <div>
          <div style={statValueStyle}>{stock.issued}</div>
          <span style={statLabelStyle}>จ่ายแล้ว</span>
        </div>
        <div>
          <div style={statValueStyle}>{stock.left}</div>
          <span style={statLabelStyle}>เหลือ</span>
        </div>
      </div>

      {canEdit && (
        <form
          action={importRewardCodes.bind(null, campaignId, reward.id)}
          style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
        >
          <textarea
            name="codes"
            required
            placeholder={'วางรหัส หนึ่งรหัสต่อบรรทัด\nMELO-A1B2\nMELO-C3D4'}
            style={{
              width: '100%', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
              padding: '9px 12px', fontSize: 12, fontFamily: 'var(--mono)',
              background: 'var(--panel)', color: 'var(--ink)',
              minHeight: 80, resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <Button type="submit" variant="ghost" style={{ padding: 9, fontSize: 12 }}>นำเข้ารหัส</Button>
        </form>
      )}

      <span style={noteStyle}>
        ตรวจรหัสซ้ำในไฟล์และซ้ำกับที่มีอยู่ก่อนนำเข้า · มีแถวผิดจะไม่นำเข้าเลยสักแถว
      </span>

      {codes.length > 0 && (
        <div>
          {codes.map((code: RewardCodeRow) => (
            <div key={code.id} style={codeRowStyle}>
              <span style={{ color: code.assigned_at ? 'var(--ink-3)' : 'var(--ink)' }}>
                {code.code_value}
              </span>
              {code.assigned_at
                ? <Badge tone="mute">จ่ายแล้ว</Badge>
                : canEdit && (
                    <form
                      action={deleteRewardCode.bind(null, campaignId, reward.id, code.id)}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Button type="submit" variant="ghost" style={{ padding: '2px 8px', fontSize: 10 }}>
                        เอาออก
                      </Button>
                    </form>
                  )}
            </div>
          ))}
        </div>
      )}

      {stock.total > codes.length && (
        <span style={noteStyle}>
          แสดง {codes.length} แถวแรกจาก {stock.total} · ที่เหลืออ่านได้จากตาราง reward_code
        </span>
      )}
    </Panel>
  )
}

export default async function RewardEditPage({ params }: {
  params: Promise<{ id: string; rewardId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, rewardId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const screen = await loadReward(sql, campaign.id, rewardId)
  if (!screen) notFound()

  const { reward } = screen
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 900, margin: '0 auto' }}>
      <a href={`/campaigns/${campaign.id}/rewards`} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        ← รางวัลทั้งหมด
      </a>

      <PageHead
        code="M7-S04 · Reward setup"
        title={reward.code}
        actions={
          <>
            <Badge tone="mute">{reward.typeName}</Badge>
            {!canEdit && <Badge tone="mute">ดูอย่างเดียว</Badge>}
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <Panel style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form
            action={saveReward.bind(null, campaign.id, reward.id)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={labelStyle}>รหัสรางวัล (บังคับ · ใช้ในตัวแปร)</span>
              <div style={readOnlyBoxStyle}>{reward.code}</div>
              <span style={noteStyle}>
                แก้ไม่ได้หลังสร้าง — ผลลัพธ์ของกิจกรรมและจุดปลดล็อกอ้างรางวัลด้วยรหัสนี้เป็นข้อความใน
                JSONB ไม่ใช่ด้วย id และไม่มี foreign key ตามหลัง เปลี่ยนแล้วที่อ้างอยู่จะชี้ไปที่ไม่มีอยู่
                โดยไม่มี error ที่ไหนบอก
              </span>
            </div>

            <Field label="ชนิดรางวัล (บังคับ)">
              <select name="reward_type" defaultValue={reward.rewardType} disabled={!reward.canChangeType}>
                {REWARD_TYPES.map((type) => (
                  <option key={type} value={type}>{REWARD_TYPE_NAME[type]}</option>
                ))}
              </select>
            </Field>

            {reward.typeLockedWhy && <Note tone="warn">{reward.typeLockedWhy}</Note>}

            {/* ช่องชนิดที่ถูกปิดไม่ส่งค่าอะไรมาเลย · saveReward ต้องได้ชนิดเสมอ ไม่งั้น
                การกดบันทึกจะกลายเป็น "ต้องเลือกชนิดรางวัล" ทั้งที่รางวัลมีชนิดอยู่แล้ว */}
            {!reward.canChangeType && (
              <input type="hidden" name="reward_type" value={reward.rewardType} />
            )}

            <ValueField screen={screen} />

            {reward.valueMissingText && <Note tone="warn">{reward.valueMissingText}</Note>}

            <Field
              label="โควตา (เว้นว่าง = ไม่จำกัด)"
              hint="ลดต่ำกว่าจำนวนที่แจกไปแล้วไม่ได้ — ตารางกันไว้ด้วย CHECK (quota IS NULL OR issued_count <= quota) และจอนี้ปฏิเสธก่อนพร้อมตัวเลขจริง"
            >
              <input
                name="quota"
                inputMode="numeric"
                pattern="[0-9]*"
                defaultValue={reward.quota ?? ''}
                placeholder="ไม่จำกัด"
                style={{ fontFamily: 'var(--mono)', width: 160 }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="อายุสิทธิ์ (วัน)">
                <input
                  name="valid_days"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  defaultValue={reward.validDays ?? ''}
                  placeholder="ไม่หมดอายุ"
                  style={{ fontFamily: 'var(--mono)' }}
                />
              </Field>

              <Field label="ใช้ได้กี่ครั้งต่อคน">
                <input
                  name="use_limit"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  defaultValue={reward.useLimit ?? ''}
                  placeholder="ไม่จำกัด"
                  style={{ fontFamily: 'var(--mono)' }}
                />
              </Field>
            </div>

            {reward.isCoupon && (
              <Note tone={reward.couponGapText ? 'warn' : 'info'}>
                {reward.couponGapText
                  ?? 'รางวัลนี้มีคูปองผูกอยู่ — อายุสิทธิ์และจำนวนครั้งจึงเว้นว่างไม่ได้ (BR-55)'}
              </Note>
            )}

            {/* กติกาที่จอนี้มีไว้ปกป้อง · ปิดช่องเฉยๆ ไม่พอ ต้องบอกว่าทำไมถึงปิด */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={labelStyle}>แจกไปแล้ว (อ่านอย่างเดียว)</span>
              <div style={readOnlyBoxStyle}>{reward.issuedCount}</div>
              <span style={noteStyle}>
                ตัวเลขนี้ไม่มีช่องให้พิมพ์ และไม่ใช่เพราะยังทำไม่เสร็จ — เจ้าของมันคือธุรกรรมที่ออกสิทธิ์
                ซึ่งบวกมันขึ้นในคำสั่งเดียวกับที่เพิ่มแถวใน entitlement · พิมพ์ทับได้เมื่อไหร่ ตัวเลขนี้จะ
                ต่างจากจำนวนสิทธิ์ที่มีอยู่จริง และไม่มีอะไรในระบบนี้เทียบสองอย่างนั้น อาการแรกที่จะเห็นคือ
                ลูกค้าพบว่าแจกของออกไปมากกว่าที่มี
              </span>
            </div>

            {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">บันทึก</Button>
              </div>
            )}
          </form>

          <span style={noteStyle}>ไม่มีการบันทึกอัตโนมัติ — โควตากระทบการแจกจริง</span>

          <div style={{ height: 1, background: 'var(--rule)' }} />

          {canEdit && (
            reward.canDelete ? (
              <form action={deleteReward.bind(null, campaign.id, reward.id)}>
                <Button type="submit" variant="danger">ลบรางวัล</Button>
              </form>
            ) : (
              <span style={noteStyle}>{reward.deleteBlockedWhy}</span>
            )
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reward.rewardType === 'code' && (
            <CodeVault campaignId={campaign.id} screen={screen} canEdit={canEdit} />
          )}

          {reward.codeShortfallText && <Note tone="warn">{reward.codeShortfallText}</Note>}

          <Panel style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>ใครแจกรางวัลนี้</span>

            {reward.isOrphan ? (
              <div style={{ fontSize: 12, color: STATUS_TONES.danger.fg, lineHeight: 1.6 }}>
                ไม่มีกิจกรรมหรือจุดปลดล็อกไหนชี้มา — รางวัลนี้ไม่มีทางถูกแจก
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {reward.usedBy.map((label) => (
                  <div key={label} style={{ fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 8 }}>
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
