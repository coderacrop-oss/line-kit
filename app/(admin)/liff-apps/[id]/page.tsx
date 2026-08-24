import { notFound, redirect } from 'next/navigation'
import { Badge, Button, Field, Note, PageHead, Panel } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import { listChannels, maskedKey } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { loadLiffApp } from '@/lib/db/liffApps'
import { ApiKeyField } from '../ApiKeyField'
import { deleteLiffAppAction, updateLiffAppAction } from './actions'
import { DeleteLiffAppButton } from './DeleteLiffAppButton'
import { LiffAppEditForm } from './LiffAppEditForm'

export default async function EditLiffAppPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const sql = db()
  const [liffApp, channels] = await Promise.all([loadLiffApp(sql, id), listChannels(sql)])
  if (!liffApp) notFound()

  const canEdit = session.role === 'configurator'

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin={canEdit} />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 800, margin: '0 auto' }}>
      <a href="/liff-apps" style={{ fontSize: 12, color: 'var(--ink-3)' }}>← LIFF ทั้งหมด</a>

      <PageHead
        code="LIFF"
        title={`แก้ ${liffApp.name}`}
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <Panel style={{ marginBottom: 16 }}>
        <Panel.Row>
          <LiffAppEditForm liffAppId={id} action={updateLiffAppAction}>
            <Field label="ชื่อ LIFF (ตั้งเองให้ทีมเข้าใจ)">
              <input name="name" defaultValue={liffApp.name} required disabled={!canEdit} />
            </Field>
            <Field label="LIFF ID" hint="จากแท็บ LIFF ของ LINE Login channel">
              <input
                name="liff_id" defaultValue={liffApp.liffId} required disabled={!canEdit}
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>
            <Field label="Channel ID ของ LINE Login channel" hint="คนละค่ากับ Channel ID ของ OA ด้านล่าง">
              <input
                name="line_login_channel_id" defaultValue={liffApp.lineLoginChannelId} required disabled={!canEdit}
                style={{ fontFamily: 'var(--mono)' }}
              />
            </Field>
            <Field label="บัญชี LINE (OA) ที่ผูกด้วย">
              <select name="channel_id" defaultValue={liffApp.channelId} required disabled={!canEdit}>
                <option value="">— เลือกบัญชี —</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>

            <Note tone="info">
              กุญแจที่ผูกไว้ตอนนี้: <b>{maskedKey(liffApp.apiKeyLast4)}</b> —
              เว้นช่องข้างล่างว่างไว้ถ้ายังใช้กุญแจเดิม · ไม่มีทางไหนดูค่าเต็มได้อีก ทั้งก่อนและหลังกดแก้
            </Note>

            <Field label="API key ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)">
              <ApiKeyField required={false} />
            </Field>

            {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <Button type="submit">บันทึก</Button>
              </div>
            )}
          </LiffAppEditForm>
        </Panel.Row>
      </Panel>

      {canEdit && (
        <Panel>
          <Panel.Row style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              ลบแล้วกู้คืนไม่ได้ — ข้อมูล session ทั้งหมดที่ backend ของ LIFF นี้เคยเขียนไว้จะหายไปด้วย
            </div>
            <DeleteLiffAppButton name={liffApp.name} action={deleteLiffAppAction.bind(null, id)} />
          </Panel.Row>
        </Panel>
      )}
      </main>
    </div>
  )
}
