export type LineEvent =
  | {
      type: 'message'
      replyToken: string
      message: { type: string; text?: string }
      source?: { type: 'user' | 'group' | 'room' }
    }
  | { type: 'postback'; replyToken: string; postback: { data: string } }
  | { type: 'follow'; replyToken: string }
  | { type: 'unfollow' | 'join' | 'leave' | 'unsend' | 'memberJoined' | 'memberLeft' }

export interface LineWebhookBody {
  destination?: string
  events?: LineEvent[]
}
