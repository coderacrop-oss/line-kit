import type { FlexMessage } from '../flex/types'

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'

export function getChannelSecret(): string {
  return requireEnv('LINE_CHANNEL_SECRET')
}

export function getAccessToken(): string {
  return requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
}

/** Replies to a single event. Reply messages are free; push messages are not. */
export async function replyMessage(replyToken: string, message: FlexMessage): Promise<void> {
  const response = await fetch(REPLY_ENDPOINT, {
    method: 'POST',
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
