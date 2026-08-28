/**
 * Loose LINE-Flex-message-shaped return type for liff-template/lib/render/messages.ts's pure
 * renderers. Modeled on LineKit's own lib/render/flex.ts (plain-object Flex bubble builder) but
 * deliberately not the full LINE Messaging API SDK type — just enough structure for these pure
 * functions (and their tests) to build/assert against predictably. Two of the twelve renderers
 * (renderKeywordText, and renderKeywordCustom's escape hatch) return shapes that aren't a Flex
 * bubble at all, hence the union.
 */

export type FlexComponent = Record<string, unknown>

export type FlexBubble = {
  type: 'bubble'
  hero?: FlexComponent
  body?: FlexComponent
  footer?: FlexComponent
}

export type FlexCarousel = {
  type: 'carousel'
  contents: FlexBubble[]
}

export type FlexMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: FlexBubble | FlexCarousel }
  // Escape hatch (renderKeywordCustom): admin-authored raw Flex JSON, passed through verbatim —
  // shape is not under this template's control, hence unknown rather than FlexBubble/FlexCarousel.
  | { type: 'flex'; altText?: string; contents: unknown }
