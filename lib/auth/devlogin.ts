/**
 * A way in that skips Google, for tests and for a laptop with no OAuth client.
 *
 * It skips the identity provider and nothing else: the email still has to exist
 * in app_user and still has to be active. Skipping both would make this a back
 * door wearing a test fixture's name.
 *
 * Three locks, because one environment variable is one typo away from being set
 * in the wrong place. The value must be exactly "1" — accepting "true" or "yes"
 * widens the surface for no benefit, and a stray space should read as off.
 *
 * DEV_LOGIN_EVEN_IN_PRODUCTION is a fourth, separate lock that overrides the
 * other two production checks — for the narrow case of standing up a real
 * deployment before Google OAuth is wired to it, where there is otherwise no
 * door in at all. Named to be alarming on sight in an env var list, and it
 * does nothing on its own: ALLOW_DEV_LOGIN still has to be "1" too. Whoever
 * sets it should remove it the moment a real login path exists.
 */
export function devLoginAllowed(ctx: { nodeEnv: string | undefined }): boolean {
  if (process.env.ALLOW_DEV_LOGIN !== '1') return false
  if (process.env.DEV_LOGIN_EVEN_IN_PRODUCTION === '1') return true
  if (ctx.nodeEnv === 'production') return false
  if (process.env.VERCEL_ENV === 'production') return false
  return true
}
