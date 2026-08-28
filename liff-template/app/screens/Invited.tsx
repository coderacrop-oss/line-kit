import type { TemplateCopy } from '../../lib/schema'

export interface InvitedGroupInfo {
  memberCount: number
  creatorName: string
  currentArchetypeTitle?: string
}

export interface InvitedProps {
  /** LINE display name of whoever opened this invite link — runtime, from LIFF profile. */
  inviterDisplayName: string
  /** Duo/group share copy from `templateCopy.invite`. */
  invite: NonNullable<TemplateCopy['invite']>
  /** Present only when this invite is for a group (vs. a 1:1 duo invite). */
  groupInfo?: InvitedGroupInfo
}

/** `{key}`-style placeholder substitution, same convention as the render layer's `interpolate`. */
function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value))
  }
  return out
}

/**
 * Landing screen for someone who opened a duo or group invite link. `invite.shareTitle`/
 * `shareBodyTemplate` come from `templateCopy.invite`; `inviterDisplayName` is runtime
 * data substituted into `{inviterName}` in the template.
 */
export function Invited({ inviterDisplayName, invite, groupInfo }: InvitedProps) {
  const body = interpolate(invite.shareBodyTemplate, { inviterName: inviterDisplayName })

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
      <h1>{invite.shareTitle}</h1>
      <p>{body}</p>

      {groupInfo ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p>{groupInfo.creatorName}</p>
          <p>{groupInfo.memberCount}</p>
          {groupInfo.currentArchetypeTitle ? <p>{groupInfo.currentArchetypeTitle}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
