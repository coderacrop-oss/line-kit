export interface MatchingProps {
  axisCardImageUrlA?: string
  axisCardImageUrlB?: string
}

function AxisCard({ imageUrl }: { imageUrl?: string }) {
  if (!imageUrl) {
    return (
      <div
        style={{
          width: 120,
          height: 160,
          borderRadius: 12,
          border: '2px dashed #ccc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 24,
        }}
      >
        ?
      </div>
    )
  }
  return (
    <img
      src={imageUrl}
      alt="axis card"
      style={{ width: 120, height: 160, objectFit: 'cover', borderRadius: 12 }}
    />
  )
}

/**
 * Transitional "shuffling the two axis cards together" screen shown while a duo/group
 * result is being resolved. Each side's card image comes from `axes[].imageUrl`
 * (looked up by the caller from the resolved axis) — falls back to a generic
 * placeholder box (no campaign-specific default image) when that axis has no image
 * configured.
 */
export function Matching({ axisCardImageUrlA, axisCardImageUrlB }: MatchingProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        minHeight: '100vh',
      }}
    >
      <AxisCard imageUrl={axisCardImageUrlA} />
      <AxisCard imageUrl={axisCardImageUrlB} />
    </div>
  )
}
