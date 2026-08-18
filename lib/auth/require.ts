import { getSession, type Role, type Session } from './session'

/**
 * Called at the top of every Server Action, not only where a screen hides a
 * button. A hidden button is a hint; the action is the door.
 */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession()
  if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน')
  if (roles.length > 0 && !roles.includes(session.role)) {
    throw new Error('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้')
  }
  return session
}
