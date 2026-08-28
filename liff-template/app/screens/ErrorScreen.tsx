export interface ErrorScreenProps {
  title: string
  body: string
}

/**
 * Generic error display. `title`/`body` are computed by whichever route/screen
 * caught the error (design doc §4.1) — this component itself never binds to
 * `templateCopy` and never hardcodes any campaign-specific copy. The one fallback
 * string the design doc allows ("Something went wrong") lives in the calling code
 * that decides what `title`/`body` to pass in, not here.
 */
export function ErrorScreen({ title, body }: ErrorScreenProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 8,
        padding: 24,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  )
}
