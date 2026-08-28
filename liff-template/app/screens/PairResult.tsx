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
        <AxisChip axis={axisA} />
        <AxisChip axis={axisB} />
      </div>
    </div>
  )
}

/**
 * One participant's axis identity within a pair result — short chip label preferred over the
 * full label (QuizAxis.short exists precisely for compact spots like this one), an optional
 * portrait next to it, and an optional short blurb underneath. All three are omitted cleanly
 * when unset — this is supplementary detail, not required content, so there's no placeholder
 * treatment here the way there is for the main result image above.
 */
function AxisChip({ axis }: { axis: QuizAxis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {axis.imageUrl ? (
        <img
          src={axis.imageUrl}
          alt={axis.short ?? axis.label}
          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : null}
      <span>{axis.short ?? axis.label}</span>
      {axis.body ? <span style={{ fontSize: '0.85em', color: '#666' }}>{axis.body}</span> : null}
    </div>
  )
}
