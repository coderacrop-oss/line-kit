import type { EffectSpec } from '../engine/effects'
import type { EntryRule } from '../engine/entry'
import type { Outcome, ResolveMethod } from '../engine/resolve'
import type { RenderableCard } from '../render/card'
import type { Theme } from '../render/flex'
import type { KeywordRule } from '../match/keyword'
import type { PlayerState } from '../state'

export type ActivityConfig = {
  id: string
  code: string
  inputType: 'none' | 'pick_one' | 'quiz' | 'text'
  resolveMethod: ResolveMethod
  outcomes: Outcome[]
  entryRules: EntryRule[]
  effectSpec: EffectSpec[]
  fallbackCardId: string | null
  trigger: 'manual' | 'follow'
}

export type LiveCampaign = {
  campaignId: string
  code: string
  timezone: string
  dayLengthSec: number
  startAt: Date
  endAt: Date
  theme: Theme
  configVersionId: string
  keywordRules: KeywordRule[]
  /** keyword rule id → where it points */
  keywordTargets: Record<string, { activityId?: string; cardId?: string }>
  activities: ActivityConfig[]
  /** card id → card, and code → card, both pointing at the same objects */
  cardsById: Record<string, RenderableCard>
  defaultCardId: string | null
  greetingCardId: string | null
  greetingEnabled: boolean
  /**
   * LINE-side id ของเมนูตัวเข้า (BR-78) — null ถ้าแคมเปญนี้ไม่ได้ใช้ Rich Menu เลย
   * หรือยังไม่เคย publish เมนูตัวเข้า มาจาก rich_menu.line_rich_menu_id ของแถวที่
   * is_entry=true จึงเป็นส่วนหนึ่งของ config ที่ publish แต่ละครั้งสแนปช็อตไว้แล้ว
   * (เหมือน activity/card) — ไม่ต้องคิวรีแยกทุกครั้งที่มีคนพิมพ์คีย์เวิร์ด
   */
  entryRichMenuLineId: string | null
}

export type PlayOutcome =
  | { kind: 'played'; outcomeId: string; cardId: string }
  | { kind: 'replayed'; outcomeId: string; cardId: string }
  | { kind: 'exhausted' }

/**
 * Everything the webhook needs from the outside world, named as intentions
 * rather than as queries.
 *
 * The handler takes this as an argument, which is why the whole branch tree can
 * be tested without a database: a test passes a fake, the route passes the real
 * one, and neither knows about the other.
 */
export type Ports = {
  findLiveCampaign(lineChannelId: string): Promise<LiveCampaign | null>
  ensureParticipant(lineChannelId: string, lineUid: string): Promise<string>
  loadPlayerState(participantId: string, campaignId: string): Promise<PlayerState>
  playsThisPeriod(participantId: string, activityId: string, periodKey: string): Promise<number>
  play(args: {
    participantId: string
    activity: ActivityConfig
    campaignId: string
    periodKey: string
    configVersionId: string
    ranked: Outcome[]
  }): Promise<PlayOutcome>
  logEvent(args: {
    participantId: string
    activityId: string | null
    configVersionId: string
    eventType: string
    postbackData: string | null
    result: unknown
    durationMs: number
  }): Promise<void>
  /** เคยผูกเมนูตัวเข้าให้ผู้เล่นคนนี้ไปแล้วหรือยัง — เช็คก่อนทุกครั้งกันยิง LINE API ซ้ำทุกข้อความ */
  hasRichMenuLinked(participantId: string): Promise<boolean>
  /**
   * บันทึกว่าผูกเมนูตัวเข้าให้ผู้เล่นคนนี้แล้ว — เรียกหลังยิง linkRichMenu ไปหา LINE
   * สำเร็จจริงเท่านั้น (ที่ route.ts) ไม่ใช่ก่อนยิง เพื่อให้ข้อความถัดไปยังลองผูกใหม่
   * ได้ถ้าครั้งนี้ล้ม
   */
  markRichMenuLinked(participantId: string): Promise<void>
}
