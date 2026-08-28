/**
 * One past pairing/group-result entry shown in the summary history list — e.g. "you
 * matched with X" or "your group hit archetype Y" on an earlier visit. Not part of
 * the vendored QuizConfig schema (it's derived/runtime data assembled by the caller
 * from stored pair/group records), so it's declared locally here.
 */
export interface PairOrGroupSummary {
  id: string
  label: string
  imageUrl?: string
}

export interface SummaryProps {
  resultTitle: string
  resultBody: string
  resultImageUrl?: string
  history: PairOrGroupSummary[]
}

/**
 * Shown once a result is resolved (solo/duo/group all land here). `resultTitle`/
 * `resultBody`/`resultImageUrl` come from the resolved `QuizResultRule` (via
 * `lib/engine/quiz.ts`'s resolveSolo/resolvePair) — never hardcoded. Falls back to a
 * generic placeholder box (no campaign text) when no result image is set, same
 * convention as Matching's axis-card placeholder.
 */
export function Summary({ resultTitle, resultBody, resultImageUrl, history }: SummaryProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {resultImageUrl ? (
        <img
          src={resultImageUrl}
          alt={resultTitle}
          style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 12 }}
        />
      ) : (
        <div
          data-testid="result-image-placeholder"
          style={{
            width: 200,
            height: 200,
            borderRadius: 12,
            border: '2px dashed #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#999',
          }}
        >
          ?
        </div>
      )}
      <h1>{resultTitle}</h1>
      <p>{resultBody}</p>

      {history.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {history.map((entry) => (
            <div
              key={entry.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #eee', borderRadius: 8, padding: '8px 12px' }}
            >
              {entry.imageUrl ? (
                <img src={entry.imageUrl} alt={entry.label} style={{ width: 32, height: 32, borderRadius: '50%' }} />
              ) : null}
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
