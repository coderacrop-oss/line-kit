import type { TemplateCopy } from '../../lib/schema'

export interface OpenInLineProps {
  openInLine: TemplateCopy['openInLine']
}

/**
 * Shown when lib/liff/client.ts's isInClient() reports the page was opened outside
 * the LINE app (e.g. a regular mobile/desktop browser) — there's nothing to do here
 * but tell the visitor to open the link from LINE instead, so no CTA/callback.
 */
export function OpenInLine({ openInLine }: OpenInLineProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>{openInLine.title}</h1>
      <p>{openInLine.body}</p>
    </div>
  )
}
