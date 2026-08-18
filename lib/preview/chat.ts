import type { LineMessage } from '../render/card'
import type { PreviewSnapshot } from './sim'

/**
 * แกะสิ่งที่ renderer ส่งออกไป ให้จอแชทวาดได้
 *
 * This reads the renderer's output rather than the card's blocks, and the
 * difference is the whole point of BR-91. Reading blocks would give the
 * simulator a second opinion about what a card looks like, and the two would
 * disagree the first time either changed — the player would be shown a card
 * nobody ever sends. Reading the message means the simulator can only draw what
 * LINE would have received.
 *
 * Nothing here decides anything. It renames the fields of a flex bubble into
 * the handful of shapes the chat panel knows how to draw, and anything it does
 * not recognise comes out named rather than dropped, because a block that
 * silently disappears in the preview is a block the author will not fix.
 */

export type ChatPart =
  | { kind: 'title'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'divider' }
  | { kind: 'space' }
  /** ทั้งการ์ดไม่เหลืออะไรให้แสดง เพราะบล็อกถูกซ่อนหมด */
  | { kind: 'empty' }
  | { kind: 'unknown'; name: string }

export type ChatButton = { label: string; postback: string | null; uri: string | null }

export type ChatCard = { hero: string | null; parts: ChatPart[]; buttons: ChatButton[] }

export type ChatBubble =
  | { kind: 'text'; text: string }
  | { kind: 'card'; altText: string; card: ChatCard }
  | { kind: 'carousel'; altText: string; cards: ChatCard[] }

/**
 * สิ่งที่ Server Action ส่งกลับมาให้จอหลังผู้เล่นจำลองแตะอะไรสักอย่าง
 *
 * The reply and the state travel together on purpose. Sent apart, the chat and
 * the state panel would be answers to two different moments, and the panel
 * would be one play behind whatever the card beside it is showing.
 */
export type PreviewReply = { bubble: ChatBubble | null; snapshot: PreviewSnapshot }

type Node = Record<string, unknown>

const asNode = (value: unknown): Node => (value && typeof value === 'object' ? value as Node : {})
const asNodes = (value: unknown): Node[] => (Array.isArray(value) ? value.map(asNode) : [])
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** ความกว้างของแท่งในของจริงเป็นสตริงอย่าง "25%" · จอจำลองอยากได้ตัวเลข */
function percentOf(box: Node): number {
  const inner = asNodes(box.contents)[0]
  const width = asText(inner?.width)
  const value = Number(width.replace('%', ''))
  return Number.isFinite(value) ? value : 0
}

function partOf(node: Node): ChatPart {
  const type = asText(node.type)

  if (type === 'text') {
    const text = asText(node.text)
    return node.weight === 'bold' ? { kind: 'title', text } : { kind: 'text', text }
  }
  if (type === 'image') return { kind: 'image', url: asText(node.url) }
  if (type === 'separator') return { kind: 'divider' }
  if (type === 'filler') return { kind: 'empty' }

  if (type === 'box') {
    // แท่งความคืบหน้ามีกล่องซ้อนอยู่ข้างใน ส่วนตัวเว้นวรรคเป็นกล่องเปล่า
    return asNodes(node.contents).length > 0
      ? { kind: 'progress', percent: percentOf(node) }
      : { kind: 'space' }
  }

  return { kind: 'unknown', name: type }
}

function buttonOf(node: Node): ChatButton {
  const action = asNode(node.action)
  const data = asText(action.data)
  const uri = asText(action.uri)
  return {
    label: asText(action.label),
    postback: action.type === 'postback' && data !== '' ? data : null,
    uri: action.type === 'uri' && uri !== '' ? uri : null,
  }
}

function cardOf(bubble: Node): ChatCard {
  const hero = asNode(bubble.hero)
  const rows = [
    ...asNodes(asNode(bubble.body).contents),
    ...asNodes(asNode(bubble.footer).contents),
  ]

  return {
    hero: asText(hero.type) === 'image' ? asText(hero.url) : null,
    parts: rows.filter((r) => r.type !== 'button').map(partOf),
    buttons: rows.filter((r) => r.type === 'button').map(buttonOf),
  }
}

export function toChatBubble(message: LineMessage): ChatBubble {
  if (message.type === 'text') return { kind: 'text', text: message.text }

  const contents = asNode(message.contents)
  if (contents.type === 'carousel') {
    return {
      kind: 'carousel',
      altText: message.altText,
      cards: asNodes(contents.contents).map(cardOf),
    }
  }

  return { kind: 'card', altText: message.altText, card: cardOf(contents) }
}
