/**
 * ด่านตรวจก่อนส่งขึ้น LINE · ขั้นที่ 1 และ 2 ของ §4.4
 *
 * ทุกอย่างในไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูลและไม่รู้จัก Next
 * ตัวโหลดอยู่ที่ `lib/db/publish.ts` และตัวเขียนอยู่ที่ Server Action ของจอ
 *
 * เหตุผลที่ตัวตรวจไม่ได้อยู่ในตัว action — ด่านนี้ต้องถูกเรียกสองที่: ตอนวาดจอเพื่อ
 * ให้คนเห็นว่าติดอะไรก่อนกด และตอนกดจริงเพื่อไม่ให้ฟอร์มที่แต่งเองข้ามด่านไปได้
 * ถ้าตัวตรวจอยู่ในตัว action จอจะต้องมีสำเนาของกฎเป็นของตัวเอง แล้ววันหนึ่งสองฝั่ง
 * จะไม่ตรงกัน · ที่แย่กว่าคือฝั่งที่ผ่อนกว่าจะเป็นฝั่งที่ยิงของขึ้น LINE จริง
 */

/** โฟลเดอร์ของจอทุกจอที่อยู่ใต้แคมเปญหนึ่งตัว · `where` วัดจากตรงนี้ */
export const CAMPAIGN_ROOT = 'app/(admin)/campaigns/[id]'

/**
 * คำที่ต้องพิมพ์ให้ตรงก่อนส่งขึ้นบัญชีจริงของลูกค้า (BR-18)
 *
 * อยู่ที่นี่ไม่ใช่ที่ไฟล์ Server Action เพราะไฟล์ `'use server'` ส่งออกได้เฉพาะ
 * ฟังก์ชัน async · และเพราะกฎข้อนี้เป็นของด่านตรวจ ทั้งจอและตัว action จึงอ่าน
 * คำเดียวกันจากที่เดียวกัน แทนที่จะพิมพ์สตริงเดียวกันไว้คนละไฟล์
 */
export const CONFIRM_WORD = 'ยืนยัน'

/** ช่องว่างหน้าหลังไม่ควรทำให้คนที่พิมพ์ถูกแล้วต้องพิมพ์ใหม่ */
export const isConfirmed = (raw: string | null | undefined): boolean =>
  (raw ?? '').trim() === CONFIRM_WORD

/**
 * ปัญหาหนึ่งข้อ · `where` คือสิ่งที่ทำให้ลิสต์นี้กดได้ ไม่ใช่แค่อ่านได้
 *
 * `where` เป็นทางเดินแบบเดียวกับ `NavItem.path` ของแถบเมนูซ้าย — ไม่ขึ้นต้นด้วย /
 * คือจอที่อยู่ในแคมเปญนี้ · ขึ้นต้นด้วย / คือจอที่ไม่ได้เป็นของแคมเปญไหน เช่นบัญชี
 * LINE ที่ใช้ร่วมกันหลายแคมเปญ · เก็บเป็นทางเดินไม่ใช่ URL เต็ม เพราะ validate
 * ไม่จำเป็นต้องรู้รหัสแคมเปญเพื่อจะบอกว่ากิจกรรมไหนกรอกไม่ครบ และการบังคับให้รู้
 * จะทำให้ตัวตรวจต้องรับพารามิเตอร์ที่กฎไม่ได้ใช้
 */
export type Problem = { code: string; message: string; where: string }

export type CheckTone = 'ok' | 'warn' | 'blocked'

/**
 * หนึ่งแถวของ "ผลตรวจความครบถ้วน" บนจอ
 *
 * จอต้องแสดงข้อที่ผ่านด้วย ไม่ใช่แสดงเฉพาะข้อที่พัง — ลิสต์ที่ว่างเปล่าตอนทุกอย่าง
 * เรียบร้อยไม่ได้บอกว่าตรวจอะไรไปบ้าง และคนที่กำลังจะส่งของขึ้นบัญชีจริงของลูกค้า
 * อยากเห็นรายการที่ตรวจ ไม่ใช่ความเงียบ · `validateForPublish` จึงเป็นตัวกรองของ
 * รายการนี้ ไม่ใช่ตัวตรวจคนละตัว
 */
export type Check = { code: string; label: string; detail?: string; tone: CheckTone; where?: string }

export type PublishCard = {
  id: string
  code: string
  /** BR-37 · การ์ดที่ยังเป็นข้อความตัวอย่างของเทมเพลต */
  hasSampleText?: boolean
  /** จำนวนบล็อกในการ์ด · 0 คือการ์ดที่ส่งออกไปแล้วไม่มีอะไรอยู่ข้างใน */
  blocks?: number
}

export type PublishOutcome = { id?: string; cardId?: string | null }

export type PublishEntryRule = { type?: string; cardId?: string | null }

export type PublishActivity = {
  id: string
  code: string
  name?: string
  inputType?: string
  /**
   * ชนิดเป็น `string` ไม่ใช่ union โดยตั้งใจ — เทสต์ที่แผนเขียนไว้สร้าง config เป็น
   * object literal ที่ไม่มีชนิดกำกับ ค่าตรงนี้จึงถูกอ่านเป็น string ตั้งแต่ต้นทาง
   */
  resolveMethod: string
  fallbackCardId: string | null
  entryRules: readonly PublishEntryRule[]
  outcomes: readonly PublishOutcome[]
  isEnabled?: boolean
  trigger?: string
  /** ทุกทางที่พาผู้เล่นมาถึงกิจกรรมนี้ · ว่างและไม่ใช่กิจกรรมทักทาย = ไม่มีทางเข้าถึง */
  reachedBy?: readonly string[]
  /** รหัสค่าสะสมที่กิจกรรมนี้บวกให้เมื่อเล่นจบ */
  counterCodes?: readonly string[]
}

export type PublishKeywordRule = {
  id: string
  keyword?: string
  targetActivityId: string | null
  targetCardId: string | null
}

export type PublishReward = {
  id: string
  code: string
  rewardType?: string
  /** จำนวนสิทธิ์ที่จะออกไปโดยไม่มีรหัสอยู่ข้างใน ถ้าแจกจนสุดโควตา */
  codeShortfall?: number
}

export type PublishCounter = { code: string; name?: string }

export type PublishConfig = {
  cards: readonly PublishCard[]
  activities: readonly PublishActivity[]
  keywordRules: readonly PublishKeywordRule[]
  counters?: readonly PublishCounter[]
  rewards?: readonly PublishReward[]
  /** ชั้นของบัญชีปลายทาง · production คือบัญชีที่ผู้ร่วมสนุกจริงมองเห็น */
  channelType: string
  /** BR-18 · คนกดพิมพ์คำยืนยันมาแล้วหรือยัง */
  confirmed: boolean
  /** BR-39 · การ์ดตั้งต้นของบัญชีปลายทาง */
  defaultCardId?: string | null
}

/**
 * รหัสของ §7 · สามตัวที่ด่านนี้ใช้
 *
 * ERR-001 กับ ERR-034 ถูกกำหนดมาจากแผนของ Task 17 และเทสต์ในแผนบังคับไว้ตรงตัว
 * ⚠️ ไม่ตรงกับตาราง §7.1 ของ L2 v0.32 ซึ่งให้ ERR-041 กับ "ยังมีข้อความตัวอย่าง
 * จากเทมเพลต" และให้ ERR-034 กับ "คู่ผสมของแกนไม่ถูกต้อง" · ตาราง §7.1 เองแจก
 * ERR-040 · ERR-041 · ERR-042 ซ้ำอย่างละสองความหมายอยู่แล้ว จึงยึดตามแผนซึ่ง
 * มีเทสต์กำกับ แล้วบันทึกความไม่ตรงไว้ตรงนี้แทนที่จะเงียบ
 *
 * ERR-020 "ไม่พบรายการที่ต้องการ" ใช้กับทุกการอ้างถึงแถวที่ไม่มีอยู่จริง — ผลลัพธ์
 * เงื่อนไข การ์ดสำรอง และคีย์เวิร์ด ใช้รหัสเดียวกันเพราะเป็นความผิดพลาดชนิดเดียวกัน
 * สิ่งที่แยกแต่ละแถวออกจากกันคือ `message` กับ `where` ไม่ใช่ตัวเลข
 */
const ERR = {
  /** กรอกข้อมูลไม่ครบ — รวมถึงช่องยืนยันของ BR-18 ที่ยังว่างอยู่ */
  incomplete: 'ERR-001',
  /** ไม่พบรายการที่ต้องการ อาจถูกลบไปแล้ว */
  missing: 'ERR-020',
  /** BR-37 · ยังมีข้อความตัวอย่างจากเทมเพลต */
  sampleText: 'ERR-034',
} as const

/** ปลายทางของปุ่ม "ไปแก้ →" ทุกอัน · เขียนไว้ที่เดียวจะได้ไม่มีสตริงลอย */
export const WHERE = {
  cards: 'cards',
  activities: 'activities',
  activity: (id: string) => `activities/${id}`,
  keywords: 'keywords',
  counters: 'counters',
  rewards: 'rewards',
  channels: '/channels',
  /** จอนี้เอง · ช่องยืนยันอยู่ล่างสุด จึงพาไปที่จุดยึดไม่ใช่หัวจอ */
  confirm: 'publish#confirm',
  /** จอนี้เอง · ตั้งการ์ดตั้งต้นของบัญชีที่กำลังเลือกอยู่ในแผงขวา (BR-39) */
  defaultCard: 'publish#default-card',
} as const

/**
 * ทางเดินของ `where` กลายเป็น URL จริง
 *
 * แยกจาก validate เพราะรหัสแคมเปญเป็นของจอ ไม่ใช่ของกฎ · ตัวเดียวกับที่แถบเมนู
 * ซ้ายใช้ตัดสินว่าทางไหนอยู่ในแคมเปญและทางไหนไม่อยู่
 */
export function whereHref(campaignId: string, where: string): string {
  return where.startsWith('/') ? where : `/campaigns/${campaignId}/${where}`
}

const isEnabled = (activity: PublishActivity) => activity.isEnabled !== false

/**
 * ทุกด่านของ §4.4 ขั้น 1 และ 2 · เรียงตามลำดับที่คนอ่านจอจากบนลงล่าง
 *
 * ข้อที่ผ่านถูกใส่ลงรายการด้วย เพราะจอต้องบอกว่าตรวจอะไรไปบ้าง ไม่ใช่บอกเฉพาะ
 * สิ่งที่พัง · ที่บล็อกกับที่เตือนแยกกันชัด: คำเตือนคือของที่ทำงานได้แต่คงไม่ได้ตั้งใจ
 * (ค่าสะสมที่ไม่มีใครบวกให้) ส่วนตัวบล็อกคือของที่ผู้เล่นจะเจอความเงียบ
 *
 * ⚠️ ด่าน BR-37 อ่าน `card.has_sample_text` ซึ่ง **ยังไม่มีโค้ดไหนในระบบเขียนค่า
 * ลงไป** — จอ M3-S02 ที่เป็นเจ้าของคอลัมน์นี้ยังไม่ถูกสร้าง (Task 12) · แปลว่าด่านนี้
 * จะไม่มีวันติดจนกว่า Task 12 จะมาเขียนค่า และการที่มันเขียวอยู่ตอนนี้ไม่ได้แปลว่า
 * ไม่มีการ์ดที่ยังเป็นข้อความตัวอย่าง แต่แปลว่ายังไม่มีใครบอกระบบว่าใบไหนเป็น
 */
export function checkPublish(config: PublishConfig): Check[] {
  const checks: Check[] = []
  const cards = config.cards ?? []
  const activities = (config.activities ?? []).filter(isEnabled)
  const keywordRules = config.keywordRules ?? []
  const cardIds = new Set(cards.map((card) => card.id))
  const activityIds = new Set((config.activities ?? []).map((activity) => activity.id))

  // ── การ์ด ───────────────────────────────────────────────────────────────
  if (cards.length === 0) {
    checks.push({
      code: ERR.incomplete,
      label: 'แคมเปญนี้ยังไม่มีการ์ดสักใบ',
      detail: 'ทุกคำตอบที่ผู้เล่นได้รับเป็นการ์ด — ไม่มีการ์ดแปลว่าไม่มีอะไรตอบกลับไปเลย',
      tone: 'blocked',
      where: WHERE.cards,
    })
  } else {
    checks.push({
      code: ERR.incomplete,
      label: 'มีการ์ดให้ตอบผู้เล่นแล้ว',
      detail: `${cards.length} ใบ`,
      tone: 'ok',
      where: WHERE.cards,
    })
  }

  const sampleCards = cards.filter((card) => card.hasSampleText === true)
  for (const card of sampleCards) {
    checks.push({
      code: ERR.sampleText,
      label: `การ์ด "${card.code}" ยังเป็นข้อความตัวอย่างจากเทมเพลต (BR-37)`,
      detail: 'ข้อความของเทมเพลตที่หลุดขึ้นบัญชีจริงอ่านเป็นความไม่ใส่ใจ ไม่ใช่เป็นบั๊ก',
      tone: 'blocked',
      where: WHERE.cards,
    })
  }
  if (cards.length > 0 && sampleCards.length === 0) {
    checks.push({
      code: ERR.sampleText,
      label: 'ไม่มีการ์ดใบไหนเหลือข้อความตัวอย่างจากเทมเพลต (BR-37)',
      // ประโยคนี้เป็นความจริงเท่าที่คอลัมน์รู้ · จอเป็นคนบอกว่าคอลัมน์ยังไม่มีใครเขียน
      detail: 'ตรวจจากค่าที่การ์ดแต่ละใบบันทึกไว้',
      tone: 'ok',
      where: WHERE.cards,
    })
  }

  for (const card of cards) {
    if ((card.blocks ?? 1) > 0) continue
    checks.push({
      code: ERR.incomplete,
      label: `การ์ด "${card.code}" ยังไม่มีบล็อกสักอัน`,
      detail: 'การ์ดเปล่าถูกส่งออกไปเป็นข้อความว่าง ซึ่งผู้เล่นแยกไม่ออกจากบอทที่พัง',
      tone: 'blocked',
      where: WHERE.cards,
    })
  }

  // ── กิจกรรม ─────────────────────────────────────────────────────────────
  if (activities.length === 0) {
    checks.push({
      code: ERR.incomplete,
      label: 'ยังไม่มีกิจกรรมที่เปิดใช้อยู่สักตัว',
      detail: 'กิจกรรมที่ปิดอยู่ไม่ถูกโหลดตอนส่งขึ้น — แคมเปญจะไม่มีอะไรให้เล่น',
      tone: 'blocked',
      where: WHERE.activities,
    })
  } else {
    checks.push({
      code: ERR.incomplete,
      label: 'มีกิจกรรมที่เปิดใช้อยู่',
      detail: `${activities.length} จาก ${(config.activities ?? []).length} กิจกรรม`,
      tone: 'ok',
      where: WHERE.activities,
    })
  }

  for (const activity of activities) {
    const at = WHERE.activity(activity.id)
    const named = activity.name ? `${activity.name} (${activity.code})` : activity.code
    const outcomes = activity.outcomes ?? []
    const entryRules = activity.entryRules ?? []

    if (outcomes.length === 0) {
      checks.push({
        code: ERR.incomplete,
        label: `"${named}" ยังไม่มีผลลัพธ์สักอัน`,
        detail: 'กิจกรรมที่ไม่ตอบอะไรเลยคือปุ่มที่กดแล้วเงียบ',
        tone: 'blocked',
        where: at,
      })
    }

    outcomes.forEach((outcome, index) => {
      if (!outcome.cardId) {
        checks.push({
          code: ERR.incomplete,
          label: `"${named}" · ผลลัพธ์ที่ ${index + 1} ยังไม่ได้เลือกการ์ดที่ตอบ`,
          detail: 'ผู้เล่นที่ได้ผลลัพธ์นี้จะกดแล้วเงียบ',
          tone: 'blocked',
          where: at,
        })
      } else if (!cardIds.has(outcome.cardId)) {
        checks.push({
          code: ERR.missing,
          label: `"${named}" · ผลลัพธ์ที่ ${index + 1} ชี้ไปการ์ดที่ไม่มีอยู่แล้ว`,
          detail: 'การ์ดถูกลบไปหลังจากตั้งผลลัพธ์นี้ไว้ — เลือกใบใหม่ก่อนส่งขึ้น',
          tone: 'blocked',
          where: at,
        })
      }
    })

    // BR-26 · ทุกเงื่อนไขต้องมีการ์ดตอบเมื่อไม่ผ่าน
    entryRules.forEach((rule, index) => {
      if (!rule.cardId) {
        checks.push({
          code: ERR.incomplete,
          label: `"${named}" · เงื่อนไขที่ ${index + 1} ยังไม่มีการ์ดตอบเมื่อไม่ผ่าน (BR-26)`,
          detail: 'ผู้เล่นที่ติดเงื่อนไขนี้จะไม่ได้รับอะไรเลย และไม่มีอะไรบอกเขาว่าทำไม',
          tone: 'blocked',
          where: at,
        })
      } else if (!cardIds.has(rule.cardId)) {
        checks.push({
          code: ERR.missing,
          label: `"${named}" · เงื่อนไขที่ ${index + 1} ชี้ไปการ์ดที่ไม่มีอยู่แล้ว`,
          detail: 'การ์ดที่ตอบเมื่อไม่ผ่านถูกลบไปแล้ว — เลือกใบใหม่ก่อนส่งขึ้น',
          tone: 'blocked',
          where: at,
        })
      }
    })

    // BR-31 · โควตาหมดแล้วยังมีคนกดเล่น คนนั้นต้องได้อะไรสักอย่าง
    if (activity.resolveMethod === 'quota' && !activity.fallbackCardId) {
      checks.push({
        code: ERR.incomplete,
        label: `"${named}" ตัดสินผลแบบโควตา แต่ยังไม่มีการ์ดสำรองเมื่อของหมด (BR-31)`,
        detail: 'ของหมดแล้วยังมีคนกดเล่น คนนั้นจะไม่ได้รับอะไรเลย',
        tone: 'blocked',
        where: at,
      })
    }

    if (activity.fallbackCardId && !cardIds.has(activity.fallbackCardId)) {
      checks.push({
        code: ERR.missing,
        label: `"${named}" · การ์ดสำรองชี้ไปการ์ดที่ไม่มีอยู่แล้ว`,
        detail: 'การ์ดสำรองถูกลบไปแล้ว — เลือกใบใหม่ก่อนส่งขึ้น',
        tone: 'blocked',
        where: at,
      })
    }

    /*
     * ไม่บล็อก · กิจกรรมที่ไม่มีทางเข้าถึงยังส่งขึ้นได้ แค่จะไม่มีใครได้เล่น
     *
     * คีย์เวิร์ดที่ชี้มาถูกอ่านจาก config ตรงนี้เอง ไม่ได้รอให้ตัวโหลดบอก — สอง
     * รายการนี้อยู่ในก้อนเดียวกันแล้ว การให้ฝั่งฐานข้อมูลเป็นคนสรุปจะทำให้เกิด
     * ความจริงสองชุดที่เถียงกันได้ · `reachedBy` เติมเฉพาะทางเข้าที่ config นี้
     * มองไม่เห็นเอง คือปุ่มบนการ์ดที่แนบรหัสกิจกรรมไปกับ postback
     */
    const reached = (activity.reachedBy ?? []).length > 0
      || keywordRules.some((rule) => rule.targetActivityId === activity.id)
    if (activity.trigger !== 'follow' && !reached) {
      checks.push({
        code: ERR.incomplete,
        label: `"${named}" ไม่มีทางเข้าถึง (คำเตือน ไม่บล็อกการส่งขึ้น)`,
        detail: 'ไม่มีคีย์เวิร์ดหรือปุ่มไหนพามา และไม่ได้ตั้งเป็นกิจกรรมทักทาย',
        tone: 'warn',
        where: at,
      })
    }
  }

  // ── คีย์เวิร์ดและทางเข้า ─────────────────────────────────────────────────
  for (const rule of keywordRules) {
    const named = rule.keyword ? `"${rule.keyword}"` : `ที่ ${keywordRules.indexOf(rule) + 1}`

    if (!rule.targetActivityId && !rule.targetCardId) {
      checks.push({
        code: ERR.incomplete,
        label: `คีย์เวิร์ด ${named} ยังไม่ได้เลือกปลายทาง`,
        detail: 'คีย์เวิร์ดที่ไม่พาไปไหนคือคำที่ผู้เล่นพิมพ์แล้วไม่มีอะไรเกิดขึ้น',
        tone: 'blocked',
        where: WHERE.keywords,
      })
      continue
    }

    if (rule.targetActivityId && !activityIds.has(rule.targetActivityId)) {
      checks.push({
        code: ERR.missing,
        label: `คีย์เวิร์ด ${named} ชี้ไปกิจกรรมที่ไม่มีอยู่แล้ว`,
        detail: 'กิจกรรมถูกลบไปหลังจากตั้งคีย์เวิร์ดนี้ไว้',
        tone: 'blocked',
        where: WHERE.keywords,
      })
    }

    if (rule.targetCardId && !cardIds.has(rule.targetCardId)) {
      checks.push({
        code: ERR.missing,
        label: `คีย์เวิร์ด ${named} ชี้ไปการ์ดที่ไม่มีอยู่แล้ว`,
        detail: 'การ์ดถูกลบไปหลังจากตั้งคีย์เวิร์ดนี้ไว้',
        tone: 'blocked',
        where: WHERE.keywords,
      })
    }
  }

  const hasFollowEntry = activities.some((activity) => activity.trigger === 'follow')
  if (keywordRules.length === 0 && !hasFollowEntry) {
    checks.push({
      code: ERR.incomplete,
      label: 'แคมเปญนี้ยังไม่มีทางเข้าสักทาง',
      detail: 'ไม่มีคีย์เวิร์ดและไม่มีกิจกรรมทักทาย — ส่งขึ้นไปแล้วก็ไม่มีใครเริ่มเล่นได้',
      tone: 'blocked',
      where: WHERE.keywords,
    })
  } else {
    checks.push({
      code: ERR.incomplete,
      label: 'มีทางให้ผู้เล่นเริ่มเล่นได้',
      detail: hasFollowEntry
        ? `คีย์เวิร์ด ${keywordRules.length} คำ · และกิจกรรมทักทายตอนแอดเป็นเพื่อน`
        : `คีย์เวิร์ด ${keywordRules.length} คำ`,
      tone: 'ok',
      where: WHERE.keywords,
    })
  }

  // ── รางวัลชนิดรหัสจากคลัง ───────────────────────────────────────────────
  for (const reward of config.rewards ?? []) {
    if (reward.rewardType !== 'code') continue
    if ((reward.codeShortfall ?? 0) <= 0) continue
    checks.push({
      code: ERR.incomplete,
      label: `รางวัล "${reward.code}" มีโควตามากกว่ารหัสที่มีในคลัง`,
      detail: `จะมีสิทธิ์ ${reward.codeShortfall} ใบที่ออกไปโดยไม่มีรหัสอยู่ข้างใน`
        + ' และผู้ถือจะไม่มีอะไรให้ไปขึ้นรางวัล',
      tone: 'blocked',
      where: WHERE.rewards,
    })
  }

  // ── ค่าสะสมที่ไม่มีใครบวกให้ · เตือน ไม่บล็อก ────────────────────────────
  const written = new Set(activities.flatMap((activity) => activity.counterCodes ?? []))
  for (const counter of config.counters ?? []) {
    if (written.has(counter.code)) continue
    checks.push({
      code: ERR.incomplete,
      label: `ค่าสะสม "${counter.name ?? counter.code}" ไม่มีกิจกรรมไหนเขียนค่าเข้ามา`,
      detail: 'ค่านี้จะไม่มีวันเพิ่ม — จุดปลดล็อกที่ผูกไว้กับมันจะไม่ทำงาน',
      tone: 'warn',
      where: WHERE.counters,
    })
  }

  // ── BR-39 · ผู้เล่นพิมพ์อะไรลอยๆ ต้องมีการ์ดตอบ ─────────────────────────
  if (activities.some((activity) => activity.inputType === 'text')) {
    const has = Boolean(config.defaultCardId)
    checks.push({
      code: ERR.incomplete,
      label: has
        ? 'ตั้งการ์ดตั้งต้นเมื่อผู้เล่นพิมพ์ลอยๆ ไว้แล้ว (BR-39)'
        : 'ยังไม่ได้ตั้งการ์ดตั้งต้นเมื่อผู้เล่นพิมพ์ลอยๆ (BR-39)',
      detail: 'บังคับเพราะแคมเปญนี้มีกิจกรรมที่รับข้อความ — คำที่ไม่ตรงกติกาจะไม่มีอะไรตอบ',
      tone: has ? 'ok' : 'blocked',
      where: WHERE.defaultCard,
    })
  }

  // ── BR-18 · บัญชีจริงของลูกค้าต้องยืนยันซ้ำ ──────────────────────────────
  if (config.channelType === 'production') {
    checks.push({
      code: ERR.incomplete,
      label: config.confirmed
        ? 'ยืนยันการส่งขึ้นบัญชีจริงของลูกค้าแล้ว (BR-18)'
        : 'ยังไม่ได้ยืนยันการส่งขึ้นบัญชีจริงของลูกค้า (BR-18)',
      detail: 'ข้อความที่ส่งเข้า LINE แล้วลบหรือเรียกคืนไม่ได้ — พิมพ์คำยืนยันที่กล่องด้านล่างก่อน',
      tone: config.confirmed ? 'ok' : 'blocked',
      where: WHERE.confirm,
    })
  }

  return checks
}

/**
 * ทุกอย่างที่ทำให้แคมเปญนี้ยังส่งขึ้นไม่ได้ · ว่างคือส่งได้
 *
 * เป็นตัวกรองของ `checkPublish` ไม่ใช่ตัวตรวจคนละตัว — กฎเดียวกันจะได้ไม่มีวัน
 * ตอบต่างกันระหว่างสิ่งที่จอวาดกับสิ่งที่ปุ่มยอมให้กด
 */
export function validateForPublish(config: PublishConfig): Problem[] {
  return checkPublish(config)
    .filter((check) => check.tone === 'blocked')
    .map((check) => ({
      code: check.code,
      message: check.detail ? `${check.label} — ${check.detail}` : check.label,
      // ทุกข้อที่บล็อกมีปลายทางเสมอ · ข้อที่ไม่มีที่ให้ไปแก้ไม่ควรถูกทำให้บล็อก
      where: check.where ?? WHERE.cards,
    }))
}
