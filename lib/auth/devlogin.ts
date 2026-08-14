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
 */
export function devLoginAllowed(ctx: { nodeEnv: string | undefined }): boolean {
  if (process.env.ALLOW_DEV_LOGIN !== '1') return false
  if (ctx.nodeEnv === 'production') return false
  if (process.env.VERCEL_ENV === 'production') return false
  return true
}
