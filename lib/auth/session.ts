import { cookies } from 'next/headers'
import { db } from '../db/client'

export type Role = 'configurator' | 'content_editor' | 'reporter'
export type Session = { userId: string; email: string; role: Role }
export type AuthDenial = { reason: 'not_on_list' | 'revoked'; email: string }
export type UserRow = { id: string; email: string; role: Role; is_active: boolean }

/**
 * Signing in with Google is not the same as being allowed in (BR-23).
 *
 * Three outcomes rather than two, and the pure part is separated so all three
 * can be tested without a database or an identity provider. A revoked account
 * gets a different message from an unknown one: that person has been here
 * before and needs to know why they cannot get back in.
 *
 * The email in a denial comes from the stored row when there is one, so the
 * address shown is the one an administrator will actually find on the list.
 */
export function classify(row: UserRow | undefined, email: string): Session | AuthDenial {
  if (!row) return { reason: 'not_on_list', email }
  if (!row.is_active) return { reason: 'revoked', email: row.email }
  return { userId: row.id, email: row.email, role: row.role }
}

export async function resolveUser(email: string): Promise<Session | AuthDenial> {
  const [row] = await db()<UserRow[]>`
    SELECT id, email, role, is_active FROM app_user WHERE lower(email) = lower(${email})`
  return classify(row, email)
}

/**
 * Re-checked on every request rather than trusted from the cookie, so revoking
 * someone takes effect on their next click instead of when their session
 * happens to expire.
 */
export async function getSession(): Promise<Session | null> {
  const email = (await cookies()).get('fsb_email')?.value
  if (!email) return null
  const result = await resolveUser(email)
  return 'userId' in result ? result : null
}
