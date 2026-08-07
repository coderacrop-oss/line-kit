export interface FlexAction {
  type: 'postback'
  label: string
  data: string
  displayText?: string
}

export interface FlexText {
  type: 'text'
  text: string
  size?: string
  weight?: 'regular' | 'bold'
  color?: string
  align?: 'start' | 'center' | 'end'
  wrap?: boolean
  margin?: string
  flex?: number
}

export interface FlexButton {
  type: 'button'
  action: FlexAction
  style?: 'primary' | 'secondary' | 'link'
  color?: string
  height?: 'sm' | 'md'
}

export interface FlexSeparator {
  type: 'separator'
  margin?: string
  color?: string
}

export interface FlexBox {
  type: 'box'
  layout: 'vertical' | 'horizontal'
  contents: FlexComponent[]
  spacing?: string
  margin?: string
  paddingAll?: string
  paddingTop?: string
  paddingBottom?: string
  backgroundColor?: string
  cornerRadius?: string
  borderColor?: string
  borderWidth?: string
  justifyContent?: 'center' | 'flex-start' | 'flex-end'
  alignItems?: 'center' | 'flex-start' | 'flex-end'
  height?: string
  flex?: number
  action?: FlexAction
}

export type FlexComponent = FlexBox | FlexText | FlexButton | FlexSeparator

export interface FlexBubble {
  type: 'bubble'
  size?: 'nano' | 'micro' | 'kilo' | 'mega' | 'giga'
  header?: FlexBox
  body?: FlexBox
  footer?: FlexBox
}

export interface FlexMessage {
  type: 'flex'
  altText: string
  contents: FlexBubble
}
