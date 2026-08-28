import type { QuizAxis, QuizResultRule } from '../../lib/schema'

export interface PairResultProps {
  result: QuizResultRule
  axisA: QuizAxis
  axisB: QuizAxis
  /** This pair's rank among all pairs so far, if the caller has computed one. */
  rank?: number
}

/**
 * Full result screen for one duo/group pairing. `result` is the resolved
 * `QuizResultRule` (title/body/imageUrl come straight from it); `axisA`/`axisB` are
 * the two participants' resolved axes. `rank` is shown as a plain "#N" badge — a
 * structural/technical label, not campaign copy — and omitted entirely when absent.
 */
export function PairResult({ result, axisA, axisB, rank }: PairResultProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {rank !== undefined ? <span>#{rank}</span> : null}

      {result.imageUrl ? (
        <img
          src={result.imageUrl}
          alt={result.title}
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

      <h1>{result.title}</h1>
      <p>{result.body}</p>

      <div style={{ display: 'flex', gap: 16 }}>
        <span>{axisA.label}</span>
        <span>{axisB.label}</span>
      </div>
    </div>
  )
}
