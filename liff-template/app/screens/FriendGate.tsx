import type { TemplateCopy } from '../../lib/schema'

export interface FriendGateProps {
  friendGate: TemplateCopy['friendGate']
  onContinue?: () => void
}

/**
 * Shown when the visitor has opened the LIFF app but hasn't added the official
 * account as a LINE friend yet (checked via lib/liff/client.ts's isFriend()).
 * All copy comes from `templateCopy.friendGate`.
 */
export function FriendGate({ friendGate, onContinue }: FriendGateProps) {
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
      <h1>{friendGate.title}</h1>
      <p>{friendGate.body}</p>
      <button
        onClick={onContinue}
        style={{
          backgroundColor: '#06c755',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: 16,
        }}
      >
        {friendGate.ctaLabel}
      </button>
    </div>
  )
}
