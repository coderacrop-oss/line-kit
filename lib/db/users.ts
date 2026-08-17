import type postgres from 'postgres'
import type { Role } from '../auth/session'

/** ชื่อบทบาทอย่างที่คนในทีมเรียกกัน · ถอดจาก ROLEN ของต้นแบบ */
export const ROLE_LABEL: Record<Role, string> = {
  configurator: 'ผู้ตั้งค่าแคมเปญ',
  content_editor: 'ผู้ดูแลเนื้อหา',
  reporter: 'ผู้ดูรายงาน',
}

/** เรียงจากทำได้มากไปหาทำได้น้อย · ตรงกับลำดับใน permMatrix ของต้นแบบ */
export const ROLE_ORDER: readonly Role[] = ['configurator', 'content_editor', 'reporter']

/**
 * สิทธิ์แต่ละบทบาททำอะไรได้ · ตารางที่อยู่ท้ายจอ
 *
 * The screen shows this because the role picker beside every row is three words
 * with no consequences attached. Somebody moving a colleague to 'ผู้ดูรายงาน'
 * should be able to read what they have just taken away without leaving the page.
 */
export const ROLE_PERMISSIONS: ReadonlyArray<{ role: Role; can: string }> = [
  { role: 'configurator', can: 'ตั้งค่าทุกอย่าง · ผูกบัญชี LINE · ส่งขึ้น · จัดการผู้ใช้' },
  { role: 'content_editor', can: 'แก้ข้อความและภาพในการ์ด · คลังภาพ · ทดลองเล่น' },
  { role: 'reporter', can: 'ดูอย่างเดียว · กดเล่นและแก้อะไรไม่ได้' },
]

export const isRole = (value: string): value is Role =>
  (ROLE_ORDER as readonly string[]).includes(value)

/**
 * วิธีหา LINE user id ของตัวเอง
 *
 * `test_line_uid` is how a card under construction gets sent to the phone of
 * the person building it, and it is the one field on this screen whose value
 * nobody can guess or look up from inside this system. A field with no
 * explanation beside it is a field that stays empty, so the instruction is part
 * of the screen rather than something to ask a colleague about.
 */
export const TEST_LINE_UID_HELP =
  'เปิด LINE Developers Console → เลือก Provider แล้วเลือก Channel ของ OA → แท็บ Basic settings ' +
  'แล้วเลื่อนลงไปที่ Your user ID — ค่าที่ขึ้นต้นด้วย U และยาว 33 ตัวคือของบัญชี LINE ที่ล็อกอิน ' +
  'Console อยู่ตอนนั้น ต้องเป็นบัญชีเดียวกับที่จะใช้รับการ์ดทดสอบ'

/** LINE user id ขึ้นต้นด้วย U ตามด้วยเลขฐานสิบหก 32 ตัว */
const LINE_UID_PATTERN = /^U[0-9a-f]{32}$/

/**
 * ค่าที่กรอกมาเป็น LINE user id ได้จริงไหม
 *
 * Checked because the failure it prevents is silent. A test card sent to a
 * malformed id is refused by LINE with an error nobody on this screen sees; the
 * person waits for a card on their phone that is never coming and concludes the
 * card itself is broken.
 */
export function validateTestLineUid(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  if (!LINE_UID_PATTERN.test(value)) {
    return 'LINE user id ขึ้นต้นด้วย U แล้วตามด้วยตัวเลขและ a-f อีก 32 ตัว — ค่าที่กรอกมาไม่ใช่รูปแบบนั้น'
  }
  return null
}

export type UserRow = {
  id: string
  email: string
  role: Role
  is_active: boolean
  test_line_uid: string | null
  last_login_at: Date | null
  has_signed_in: boolean
  invited_by_email: string | null
}

export type UserView = {
  id: string
  email: string
  role: Role
  roleLabel: string
  isActive: boolean
  isMe: boolean
  testLineUid: string | null
  statusLabel: string
  lastLoginText: string
  invitedByText: string
  /** เพิ่มอีเมลไว้แล้วแต่เจ้าตัวยังไม่เคยล็อกอินเข้ามา */
  neverSignedIn: boolean
  /** เหตุผลที่แถวนี้ถอนสิทธิ์หรือลดบทบาทไม่ได้ · null แปลว่าทำได้ */
  lockedReason: string | null
}

export const SELF_LOCK =
  'ถอนสิทธิ์หรือลดบทบาทตัวเองไม่ได้ — ป้องกันการล็อกตัวเองออกจากระบบ'

export const LAST_CONFIGURATOR_LOCK =
  'ถอนสิทธิ์หรือลดบทบาทผู้ตั้งค่าคนสุดท้ายไม่ได้ — จะไม่มีใครเพิ่มคนหรือคืนสิทธิ์ได้อีก'

/**
 * สองประตูที่ล็อกตัวเองไว้ไม่ให้ปิดจากข้างใน
 *
 * Both of these end in the same place: a system with nobody who can administer
 * it, which is not a state any screen in this application can climb back out
 * of. Recovering from it means somebody opening psql against production.
 *
 * They are separate rules because they catch different mistakes. The first is
 * the misclick — revoking the row with your own name on it. The second is the
 * reasonable-looking edit: two configurators, one leaves the team and is
 * revoked, and the remaining one is moved to a smaller role by somebody who did
 * not count first.
 *
 * The same reason blocks a demotion as blocks a revocation, because they have
 * the same effect. Moving the last configurator to 'ผู้ดูรายงาน' locks the
 * system exactly as thoroughly as deactivating them, and a rule that only
 * guarded the revoke button would be a rule with a second door beside it.
 */
export function lockReason(
  user: Pick<UserRow, 'id' | 'role' | 'is_active'>,
  viewerId: string,
  activeConfigurators: number,
): string | null {
  if (user.id === viewerId) return SELF_LOCK
  if (user.is_active && user.role === 'configurator' && activeConfigurators <= 1) {
    return LAST_CONFIGURATOR_LOCK
  }
  return null
}

/** จำนวนผู้ตั้งค่าที่ยังเข้าระบบได้จริง · ตัวเลขที่กฎข้างบนนับ */
export const countActiveConfigurators = (
  users: ReadonlyArray<Pick<UserRow, 'role' | 'is_active'>>,
): number => users.filter((user) => user.is_active && user.role === 'configurator').length

const DAY_MS = 86_400_000

/**
 * เข้าล่าสุดเมื่อไหร่ · คำถามคือ "คนนี้ยังใช้อยู่ไหม" ไม่ใช่ "กี่โมง"
 */
export function describeLastLogin(at: Date | null, now: Date): string {
  if (!at) return 'ยังไม่เคยเข้าระบบ'
  const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS)
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  if (days <= 30) return `${days} วันก่อน`
  return at.toISOString().slice(0, 10)
}

export function summarizeUser(row: UserRow, viewerId: string, activeConfigurators: number, now: Date): UserView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABEL[row.role],
    isActive: row.is_active,
    isMe: row.id === viewerId,
    testLineUid: row.test_line_uid,
    statusLabel: row.is_active ? 'ใช้งานได้' : 'ถูกถอนสิทธิ์',
    lastLoginText: describeLastLogin(row.last_login_at, now),
    invitedByText: row.invited_by_email ?? 'ตั้งไว้ตอนติดตั้งระบบ',
    neverSignedIn: !row.has_signed_in,
    lockedReason: lockReason(row, viewerId, activeConfigurators),
  }
}

export function summarizeUsers(rows: readonly UserRow[], viewerId: string, now: Date): UserView[] {
  const activeConfigurators = countActiveConfigurators(rows)
  return rows.map((row) => summarizeUser(row, viewerId, activeConfigurators, now))
}

/**
 * ทุกคนในทีม รวมคนที่ถูกถอนสิทธิ์ไปแล้ว
 *
 * A revoked row is not hidden. It is the answer to "why can this person not get
 * in", and it is the row somebody has to find in order to give access back.
 * Active first, because that is the list people come here to read.
 *
 * `google_sub` is read as a boolean rather than selected: it is an identifier
 * belonging to somebody's Google account, this screen has no use for the value,
 * and a column that is never fetched cannot be printed by a later edit.
 */
export async function listUsers(sql: postgres.Sql): Promise<UserRow[]> {
  return sql<UserRow[]>`
    SELECT u.id, u.email, u.role, u.is_active, u.test_line_uid, u.last_login_at,
           (u.google_sub IS NOT NULL) AS has_signed_in,
           (SELECT inviter.email FROM app_user inviter WHERE inviter.id = u.invited_by)
             AS invited_by_email
      FROM app_user u
     ORDER BY u.is_active DESC, u.email`
}
