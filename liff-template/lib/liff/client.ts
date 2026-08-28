/**
 * Thin wrapper around the LIFF SDK (`@line/liff`). Kept as its own tiny module so
 * every screen/route depends on this interface rather than the SDK directly — makes
 * it obvious where to plug in real calls, and lets the solo flow (this slice's fully
 * wired end-to-end path, see design doc §2/§7.1) run in local dev without a live LIFF
 * session.
 *
 * `getProfile`/`isFriend` are permissive dev stubs. Before deploying a duo/group flow
 * (which needs real LINE identity to know who's who across devices), replace their
 * bodies with:
 *   - getProfile(): `const liff = await import('@line/liff'); await liff.default.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! }); const p = await liff.default.getProfile(); return { displayName: p.displayName }`
 *   - isFriend(): LIFF has no direct "am I a friend" call — call your own backend,
 *     which calls LINE's Messaging API "Get friendship status" with the user's LIFF
 *     access token (`liff.getAccessToken()`), and return that result here.
 */

export function isInClient(): boolean {
  if (typeof window === 'undefined') return true
  return /line/i.test(window.navigator.userAgent)
}

export async function getProfile(): Promise<{ displayName: string } | null> {
  return { displayName: 'Guest' }
}

export async function isFriend(): Promise<boolean> {
  return true
}
