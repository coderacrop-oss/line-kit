export interface GroupMemberSlot {
  participantId: string
  displayName: string
  axisLabel: string
}

export interface GroupArchetypeDisplay {
  title: string
  body: string
  imageUrl?: string
}

export interface GroupProps {
  members: GroupMemberSlot[]
  maxMembers: number
  archetype?: GroupArchetypeDisplay
  onInvite?: () => void
}

/**
 * Group lobby: one avatar-shaped slot per member up to `maxMembers`, mirroring
 * `renderGroupInviteCard`'s layout for the LINE push version of this same idea — a
 * present member shows `displayName`/`axisLabel`, an open slot shows a generic "?"
 * placeholder (never a campaign-specific default).
 */
export function Group({ members, maxMembers, archetype, onInvite }: GroupProps) {
  const openSlots = Math.max(0, maxMembers - members.length)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {archetype ? (
        <div>
          <h1>{archetype.title}</h1>
          <p>{archetype.body}</p>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {members.map((member) => (
          <div
            key={member.participantId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: 80,
              gap: 4,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#eee',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {member.displayName.charAt(0)}
            </div>
            <span>{member.displayName}</span>
            <span>{member.axisLabel}</span>
          </div>
        ))}

        {Array.from({ length: openSlots }).map((_, i) => (
          <div
            key={`open-${i}`}
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: '2px dashed #ccc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
            }}
          >
            ?
          </div>
        ))}
      </div>

      <button
        onClick={onInvite}
        aria-label="invite"
        style={{
          alignSelf: 'flex-start',
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1px solid #ddd',
          background: '#fff',
          fontSize: 20,
        }}
      >
        +
      </button>
    </div>
  )
}
