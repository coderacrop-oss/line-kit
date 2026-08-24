import { redirect } from 'next/navigation'
import { Badge, Button, Field, Note, PageHead, Panel } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import { listChannels } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { listLiffApps } from '@/lib/db/liffApps'
import { createLiffAppAction } from './actions'
import { ApiKeyField } from './ApiKeyField'
import { LiffAppForm } from './LiffAppForm'

export default async function LiffAppsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const sql = db()
  const [apps, channels] = await Promise.all([listLiffApps(sql), listChannels(sql)])
  const canEdit = session.role === 'configurator'

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin={canEdit} />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 800, margin: '0 auto' }}>
      <PageHead
        code="LIFF"
        title="LIFF"
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <Note tone="info" style={{ marginBottom: 16 }}>
        แต่ละแถวคือ LIFF หนึ่งตัวที่ได้รับอนุญาตให้เก็บ/อ่านข้อมูลผ่าน LineKit — ดู
        <code> docs/superpowers/specs/2026-08-21-liff-platform-design.md</code> สำหรับวิธีที่ LIFF ฝั่งของคุณ
        ต้องเรียก API เหล่านี้
      </Note>

      {canEdit && (
        <Panel style={{ marginBottom: 16 }}>
          <Panel.Row>
            <LiffAppForm action={createLiffAppAction}>
              <Field label="ชื่อ LIFF (ตั้งเองให้ทีมเข้าใจ)">
                <input name="name" required placeholder="เช่น DewLIFF v2" />
              </Field>
              <Field label="LIFF ID" hint="จากแท็บ LIFF ของ LINE Login channel">
                <input name="liff_id" required style={{ fontFamily: 'var(--mono)' }} />
              </Field>
              <Field label="Channel ID ของ LINE Login channel" hint="คนละค่ากับ Channel ID ของ OA ด้านล่าง">
                <input name="line_login_channel_id" required style={{ fontFamily: 'var(--mono)' }} />
              </Field>
              <Field label="บัญชี LINE (OA) ที่ผูกด้วย">
                <select name="channel_id" required>
                  <option value="">— เลือกบัญชี —</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="API key" hint="ให้ backend ของ LIFF ใช้เรียกกลับมา — ไม่มีทางดูค่าเต็มได้อีกหลังบันทึก กด “สุ่ม” แล้วก็อปไปเก็บไว้ก่อนบันทึก">
                <ApiKeyField />
              </Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">+ ลงทะเบียน LIFF</Button>
              </div>
            </LiffAppForm>
          </Panel.Row>
        </Panel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {apps.map((app) => (
          <Panel key={app.id}>
            <Panel.Row>
              <a
                href={`/liff-apps/${app.id}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textDecoration: 'none', color: 'inherit', gap: 12,
                }}
              >
                <div>
                  <b>{app.name}</b>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{app.liffId}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>
                  กุญแจ: •••{app.apiKeyLast4}
                </div>
              </a>
            </Panel.Row>
          </Panel>
        ))}
      </div>
      </main>
    </div>
  )
}
