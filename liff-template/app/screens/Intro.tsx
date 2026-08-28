import type { TemplateCopy } from '../../lib/schema'

export interface IntroProps {
  brand: TemplateCopy['brand']
  intro: TemplateCopy['intro']
  onContinue?: () => void
}

/**
 * First screen a fresh visitor sees. Every visible string comes from
 * `templateCopy.brand`/`templateCopy.intro` — nothing is hardcoded.
 */
export function Intro({ brand, intro, onContinue }: IntroProps) {
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
      <p style={{ fontWeight: 600, letterSpacing: 0.5 }}>{brand.name}</p>
      <h1>{intro.title}</h1>
      <p>{intro.body}</p>
      <button
        onClick={onContinue}
        style={{
          backgroundColor: brand.primaryColor ?? '#1a73e8',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: 16,
        }}
      >
        {intro.ctaLabel}
      </button>
    </div>
  )
}
