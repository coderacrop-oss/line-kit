import { notFound, redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { decodeOutcome } from '@/lib/assets/outcome'
import { assetStore } from '@/lib/assets/store'
import { listAssets } from '@/lib/db/assets'
import { loadCampaign } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { uploadAssets } from '../actions'

const modeCardStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '12px 14px', fontSize: 13, fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: 9, background: 'var(--panel)',
}

const dropZoneStyle: CSSProperties = {
  borderWidth: 2, borderStyle: 'dashed', borderColor: 'var(--rule)',
  borderRadius: 'var(--r-lg)', padding: '26px 20px', textAlign: 'center',
  background: 'var(--ground)',
}

export default async function UploadAssetPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const query = await searchParams

  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const canUpload = session.role === 'configurator' || session.role === 'content_editor'
  const assets = await listAssets(sql, campaign.id)
  const outcome = decodeOutcome(query)
  const libraryHref = `/campaigns/${campaign.id}/assets`

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 680, margin: '0 auto' }}>
      <a href={libraryHref} style={{ fontSize: 12, color: 'var(--ink-3)' }}>← คลังภาพ</a>

      <div style={{ marginTop: 10 }}>
        <PageHead
          code="M9-S02 · Upload"
          title="อัปโหลดภาพ"
          actions={canUpload ? null : <Badge tone="mute">ดูอย่างเดียว</Badge>}
        />
      </div>

      <Note tone="info" style={{ marginBottom: 16 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
          textTransform: 'uppercase', marginBottom: 7,
        }}>
          ข้อจำกัดไฟล์
        </div>
        · JPEG หรือ PNG เท่านั้น<br />
        · ไม่เกิน 1 MB ต่อไฟล์ — เข้มกว่าที่ LINE กำหนด เพื่อกันภาพในแชทแตก<br />
        · ภาพ Rich Menu ต้องเป็น 2500×1686 พอดี<br />
        · กว้าง 800–2500 px และสูงอย่างน้อย 250 px<br />
        · ขนาดภาพอ่านจากไบต์ในไฟล์จริง ไม่ใช่จากนามสกุล — ไฟล์ที่เปลี่ยนนามสกุลมาจะไม่ผ่าน
      </Note>

      {outcome !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {outcome.uploaded > 0 && (
            <Note tone="ok">
              อัปโหลดสำเร็จ {outcome.uploaded} ไฟล์ — <a href={libraryHref}>ดูในคลังภาพ</a>
            </Note>
          )}
          {outcome.rejected.length > 0 && (
            <Note tone="danger">
              <b>ไม่ผ่าน {outcome.rejected.length} ไฟล์</b>
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
                {outcome.rejected.map((item) => (
                  <li key={`${item.file}-${item.why}`} style={{ marginBottom: 4 }}>
                    <b style={{ wordBreak: 'break-all' }}>{item.file}</b> — {item.why}
                  </li>
                ))}
              </ul>
            </Note>
          )}
        </div>
      )}

      {!canUpload ? (
        <Note tone="warn">บัญชีนี้ดูคลังภาพได้อย่างเดียว — อัปโหลดต้องเป็นผู้ตั้งค่าแคมเปญหรือผู้ดูแลเนื้อหา</Note>
      ) : (
        <Panel style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form
            action={uploadAssets.bind(null, campaign.id)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
                textTransform: 'uppercase', color: 'var(--ink-3)',
              }}>
                โหมด
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={modeCardStyle}>
                  <input type="radio" name="mode" value="new" defaultChecked />
                  เพิ่มภาพใหม่
                </label>
                <label style={modeCardStyle}>
                  <input type="radio" name="mode" value="replace" disabled={assets.length === 0} />
                  แทนที่ภาพเดิม
                </label>
              </div>
            </div>

            <Field
              id="replace-target"
              label="ภาพเป้าหมายที่จะแทนที่"
              hint="ใช้กับโหมดที่สองเท่านั้น · เลือกได้ทีละภาพ และอัปโหลดทับได้ทีละไฟล์"
            >
              <select name="replace_id" defaultValue="">
                <option value="">— เลือกภาพเดิม —</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.fileName}</option>
                ))}
              </select>
            </Field>

            {/* BR-25 · เหตุผลที่จอนี้มีโหมดที่สองแยกออกมา ไม่ใช่ปุ่ม "แก้ภาพ" */}
            <Note tone="warn">
              อัปโหลดทับสร้างเป็นไฟล์ใหม่และ URL ใหม่ (BR-25) —
              <b> การ์ดที่ส่งเข้าแชทไปแล้วจะยังเป็นภาพเดิมตลอดไป</b>
              {' '}ภาพใหม่มีผลกับการ์ดที่ส่งครั้งถัดไป ไม่ใช่การเปลี่ยนย้อนหลัง
              · ไฟล์เดิมไม่ถูกลบ
            </Note>

            <div style={dropZoneStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10 }}>
                รับหลายไฟล์พร้อมกัน
              </div>
              <input
                type="file"
                name="files"
                multiple
                required
                accept="image/png,image/jpeg"
                aria-label="ไฟล์ภาพที่จะอัปโหลด"
                style={{ fontSize: 12 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button type="submit">อัปโหลด</Button>
            </div>

            <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              ถ้าบางไฟล์ไม่ผ่าน จะอัปโหลดไฟล์ที่ผ่านไปก่อนแล้วบอกว่าไฟล์ไหนไม่ผ่านเพราะอะไร — ไม่ล้มทั้งชุด
            </span>

            {/* คนที่ตั้งระบบต้องรู้ว่าไฟล์ไปนอนอยู่ไหน · ยังไม่มีที่เก็บบนคลาวด์ผูกไว้ */}
            <span style={{ fontSize: 11, color: STATUS_TONES.warn.fg, lineHeight: 1.6 }}>
              {assetStore().describe} — ยังไม่มีที่เก็บไฟล์บนคลาวด์ผูกไว้กับระบบนี้
              ถ้าเครื่องที่รันเขียนไฟล์ไม่ได้ การอัปโหลดจะล้มทั้งชุดและไม่มีแถวไหนถูกบันทึก
            </span>
          </form>
        </Panel>
      )}
    </main>
  )
}
