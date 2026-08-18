/** Sentinel period for activities limited once per campaign rather than per day. */
const WHOLE_CAMPAIGN = 'ALL'

/**
 * The key that "once per day" is counted against.
 *
 * A campaign can shorten its day so a seven-day streak can be demoed in
 * minutes. When the day is shorter than 24h the date alone no longer separates
 * plays, so the slot inside the day is appended.
 *
 * A day length of zero means the limit spans the whole campaign, so every play
 * lands in the same period.
 */
export function periodKey(at: Date, tz: string, dayLengthSec: number): string {
  if (dayLengthSec <= 0) return WHOLE_CAMPAIGN

  // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

  if (dayLengthSec >= 86_400) return date

  const slot = Math.floor(Math.floor(at.getTime() / 1000) / dayLengthSec)
  return `${date}#${slot}`
}
