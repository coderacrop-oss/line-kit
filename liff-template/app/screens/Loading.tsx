/**
 * Generic loading spinner shown while lib/liff/client.ts's isInClient()/getProfile()/
 * isFriend() checks are in flight, and while the app/api/answer route resolves a
 * result. Nothing here is campaign copy — "Loading…" is the one generic technical
 * label the design doc allows outside of `templateCopy`.
 */
export function Loading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 16,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        data-testid="loading-spinner"
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '4px solid #e0e0e0',
          borderTopColor: '#333',
        }}
      />
      <p>Loading…</p>
    </div>
  )
}
