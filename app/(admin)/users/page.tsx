import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Badge, Button, Field, Note, PageHead, Panel, STATUS_TONES } from '@/components/ui'
import { GlobalNav } from '@/components/layout/GlobalNav'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import {
  ROLE_LABEL, ROLE_ORDER, ROLE_PERMISSIONS, TEST_LINE_UID_HELP,
  listUsers, summarizeUsers, type UserView,
} from '@/lib/db/users'
import { addUser, saveTestLineUid, setUserActive, setUserRole } from './actions'

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const chipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase',
  color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)',
  padding: '2px 8px',
}

function RoleOptions() {
  return (
    <>
      {ROLE_ORDER.map((role) => (
        <option key={role} value={role}>{ROLE_LABEL[role]}</option>
      ))}
    </>
  )
}

/**
 * แถวหนึ่งคน · บทบาทเปลี่ยนได้ สิทธิ์ถอนได้ และบางแถวทำทั้งสองอย่างไม่ได้
 *
 * A locked row keeps both controls on screen and disables them, with the reason
 * written underneath rather than hidden in a tooltip. Removing the button would
 * leave somebody looking for a control that everybody else's row has and
 * concluding the screen is broken; a disabled control with a sentence beside it
 * answers the question it raises.
 *
 * Somebody who cannot manage users gets no controls at all rather than disabled
 * ones. The difference matters: a disabled control on a locked row says "not
 * this row", which is true and useful, while a control that would be refused on
 * every row for every person teaches the reader that the screen is broken rather
 * than that they are not an administrator. The role still shows, as text —
 * knowing who can do what is the reason a reporter opens this screen.
 */
function UserRowView({ user, canManage }: { user: UserView; canManage: boolean }) {
  const locked = user.lockedReason !== null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      opacity: user.isActive ? 1 : 0.55,
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {user.email}
          {user.isMe && <span style={chipStyle}>คุณ</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
          เข้าล่าสุด {user.lastLoginText} · เพิ่มโดย {user.invitedByText}
        </div>
        {user.neverSignedIn && (
          <div style={{ fontSize: 11, color: STATUS_TONES.warn.fg, marginTop: 3 }}>
            เพิ่มอีเมลแล้วแต่เจ้าตัวยังไม่เคยล็อกอิน
          </div>
        )}
        {locked && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.5 }}>
            {user.lockedReason}
          </div>
        )}
      </div>

      <Badge tone={user.isActive ? 'ok' : 'mute'}>{user.statusLabel}</Badge>

      {!canManage ? (
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{user.roleLabel}</span>
      ) : (
        <>
          <form action={setUserRole} style={{ display: 'flex', gap: 6 }}>
            <input type="hidden" name="id" value={user.id} />
            <select
              name="role"
              defaultValue={user.role}
              disabled={locked}
              aria-label={`บทบาทของ ${user.email}`}
              style={{
                border: '1px solid var(--rule)', borderRadius: 'var(--r)',
                padding: '7px 11px', fontSize: 12, background: 'var(--panel)', color: 'var(--ink)',
              }}
            >
              <RoleOptions />
            </select>
            <Button type="submit" variant="ghost" disabled={locked}>เปลี่ยนบทบาท</Button>
          </form>

          <form action={setUserActive}>
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="active" value={user.isActive ? 'false' : 'true'} />
            <Button type="submit" variant={user.isActive ? 'danger' : 'ghost'} disabled={locked}>
              {user.isActive ? 'ถอนสิทธิ์' : 'คืนสิทธิ์'}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}

export default async function UsersPage() {
  const session = await getSession()
  // ชั้น layout กันไว้อยู่แล้ว แต่ layout กับ page เรนเดอร์พร้อมกัน ไม่ใช่ทีละชั้น
  if (!session) redirect('/login')

  const rows = await listUsers(db())
  const users = summarizeUsers(rows, session.userId, new Date())
  const me = users.find((user) => user.isMe) ?? null
  const canManage = session.role === 'configurator'

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <GlobalNav isAdmin={canManage} />
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--page-y) var(--page-x)', maxWidth: 940, margin: '0 auto' }}>
      <PageHead
        code="M13-S02 · Internal users"
        title="ผู้ใช้ภายใน"
        actions={canManage ? null : <Badge tone="mute">ดูอย่างเดียว</Badge>}
      />

      {canManage && (
        <Panel style={{ marginBottom: 16 }}>
          <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={labelStyle}>เพิ่มผู้ใช้</div>
            <form
              action={addUser}
              style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="อีเมลของคนในทีม">
                  <input name="email" type="email" required placeholder="someone@example.com" />
                </Field>
              </div>
              <Field label="บทบาท">
                <select name="role" defaultValue="content_editor"><RoleOptions /></select>
              </Field>
              <Button type="submit">＋ เพิ่มผู้ใช้</Button>
            </form>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              เพิ่มอีเมลแล้วคนนั้นเข้าระบบได้ทันทีในครั้งถัดไป — ไม่มีอีเมลเชิญให้ต้องรอ
            </span>
          </Panel.Row>
        </Panel>
      )}

      <Panel>
        {users.map((user) => (
          <Panel.Row key={user.id} data-user-row style={{ padding: '14px 18px' }}>
            <UserRowView user={user} canManage={canManage} />
          </Panel.Row>
        ))}
      </Panel>

      {/* ถอนสิทธิ์ไม่ลบแถว · เขียนไว้บนจอเพราะคนที่กดต้องรู้ว่ามันไม่ใช่การลบ */}
      <Note tone="info" style={{ marginTop: 16 }}>
        <b>ถอนสิทธิ์แล้วแถวยังอยู่</b> — คนนั้นเข้าระบบไม่ได้ตั้งแต่คลิกถัดไป แต่ชื่อไม่ได้ถูกลบทิ้ง
        เพราะประวัติการส่งขึ้นบันทึกไว้ว่าใครส่งรุ่นไหนขึ้น และประวัติที่ชื่อคนหายไปตอบอะไรไม่ได้เลย
      </Note>

      {me && (
        <Panel style={{ marginTop: 16 }}>
          <Panel.Row style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={labelStyle}>LINE ของฉัน สำหรับรับการ์ดทดสอบ</div>
            <form
              action={saveTestLineUid}
              style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}
            >
              <div style={{ flex: 1, minWidth: 260 }}>
                <Field
                  label="LINE user id ของฉัน"
                  hint={TEST_LINE_UID_HELP}
                >
                  <input
                    name="test_line_uid"
                    defaultValue={me.testLineUid ?? ''}
                    placeholder="U0123456789abcdef0123456789abcdef"
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                </Field>
              </div>
              <Button type="submit">บันทึก</Button>
            </form>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              ตั้งได้เฉพาะของตัวเอง — การ์ดทดสอบจะถูกส่งเข้า LINE เครื่องนี้เท่านั้น
            </span>
          </Panel.Row>
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <Panel.Row>
          <div style={{ ...labelStyle, marginBottom: 10 }}>สิทธิ์แต่ละบทบาททำอะไรได้</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ROLE_PERMISSIONS.map((row) => (
              <div key={row.role} style={{ display: 'flex', gap: 14, fontSize: 12, lineHeight: 1.55 }}>
                <span style={{ width: 150, flexShrink: 0, fontWeight: 600 }}>{ROLE_LABEL[row.role]}</span>
                <span style={{ color: 'var(--ink-3)' }}>{row.can}</span>
              </div>
            ))}
          </div>
        </Panel.Row>
      </Panel>
      </main>
    </div>
  )
}
