import type { LineMessage } from '../render/card'

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'

export function getChannelSecret(): string {
  return requireEnv('LINE_CHANNEL_SECRET')
}

export function getAccessToken(): string {
  return requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
}

/**
 * Replies to a single event. Reply messages are free; push messages are not, so
 * this is the only way anything leaves the system.
 *
 * The timeout matters more than it looks: a reply token expires, and a request
 * left hanging turns into silence the player cannot distinguish from a broken
 * bot (BR-01).
 */
export async function replyMessage(replyToken: string, message: LineMessage): Promise<void> {
  const response = await fetch(REPLY_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages: [message] }),
  })

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`)
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
