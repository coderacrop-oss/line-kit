/**
 * The five answers that live in code rather than config, because they are used
 * exactly when config can no longer be trusted (§7.2).
 */
export const FALLBACK = {
  /** ERR-100 · the tapped card belongs to a campaign that is no longer live */
  campaignOver: 'กิจกรรมนี้จบไปแล้ว ขอบคุณที่ร่วมสนุก',
  /** ERR-101 · a button from a quiz round that has since ended */
  quizOver: 'ชุดคำถามนี้จบไปแล้ว',
  /** ERR-102 · every outcome ran out and no fallback card was configured */
  nothingLeft: 'ของรางวัลหมดแล้ว ขอบคุณที่ร่วมสนุก',
  /** ERR-103 · a card issued for a different day */
  cardExpired: 'การ์ดนี้หมดอายุแล้ว',
  /** ERR-104 · the engine or the renderer failed */
  systemDown: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่',
} as const
