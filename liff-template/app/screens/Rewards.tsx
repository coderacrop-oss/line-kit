import type { RewardMilestone } from '../../lib/schema'

export interface RewardsProps {
  milestones: RewardMilestone[]
  claimed: string[]
}

/**
 * Milestone/reward tracker shown after a result (solo/duo/group all share this
 * screen). `milestones` come straight from `templateCopy.rewards.milestones`;
 * `claimed` is runtime state (which milestone keys this participant has hit).
 * "Claimed"/"Locked" are generic technical status labels, not campaign copy.
 */
export function Rewards({ milestones, claimed }: RewardsProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {milestones.map((m) => {
        const isClaimed = claimed.includes(m.key)
        return (
          <div
            key={m.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: isClaimed ? 1 : 0.5,
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            {m.icon ? <span>{m.icon}</span> : null}
            <span style={{ flex: 1 }}>{m.label}</span>
            <span>{isClaimed ? 'Claimed' : 'Locked'}</span>
          </div>
        )
      })}
    </div>
  )
}
