/**
 * ฟอร์มของกิจกรรมสร้างจากนิยามชนิด ไม่ใช่เขียนแยกทีละกิจกรรม (BR-87)
 *
 * A campaign's activities differ along two axes and nothing else: how the
 * player puts something in, and how the answer is decided. Everything the setup
 * screen asks follows from that pair, so the pair is the only thing this file
 * switches on — never on a campaign, a template code, or an activity id.
 *
 * That is the whole point of the rule. The moment one activity needs a form
 * written by hand, adding the next kind of activity stops being configuration
 * and becomes a deploy, and AC-01 — a non-developer builds a campaign without
 * touching code — stops holding. A test walks all sixteen pairs and asserts
 * none of them comes back empty, which is the cheap standing version of that
 * guarantee.
 */

/**
 * ตรงกับ CHECK (input_type IN (…)) ใน 0001_init.sql + 0014_quiz_engine.sql
 *
 * personality_quiz เข้ามาใน CHECK จาก 0014_quiz_engine.sql (Task 1) พร้อมกับกฎที่
 * บังคับว่า resolve_method ต้องเป็น NULL เฉพาะชนิดนี้เท่านั้น — ไม่ใช่แค่ "ผสมกับ
 * resolve_method บางอันไม่ได้" แบบที่ comboProblem() ด้านล่างปฏิเสธสี่ชนิดที่เหลือ
 * แต่คือไม่มี resolve_method ให้ผสมด้วยเลยสักตัว ด้วยเหตุนี้ personality_quiz จึง
 * ไม่ปรากฏใน BY_INPUT/comboProblem ด้านล่าง — จอที่เรียก fieldsFor()/isComboAllowed()
 * ต้องกันมันออกไปเองก่อนเรียก (ดู CreateActivityAxes.tsx)
 */
export const INPUT_TYPES = ['none', 'pick_one', 'quiz', 'text', 'personality_quiz'] as const
export type InputType = (typeof INPUT_TYPES)[number]

/**
 * ตรงกับ CHECK (resolve_method IN (…)) ยกเว้น lookup ที่ยังไม่อยู่ในสไลซ์นี้
 *
 * The column accepts 'lookup' and the engine has no branch for it, so offering
 * it here would let somebody save an activity that resolves to nothing. It is
 * left out of the screen rather than added to the engine, because adding the
 * branch is its own slice of work with its own tests.
 */
export const RESOLVE_METHODS = ['fixed', 'weighted', 'quota', 'score'] as const
export type ResolveMethod = (typeof RESOLVE_METHODS)[number]

const INPUT_TYPE_NAME: Record<InputType, string> = {
  none: 'กดปุ่มเดียวจบ',
  pick_one: 'ให้เลือกจากตาราง',
  quiz: 'ตอบคำถาม',
  text: 'พิมพ์ข้อความ',
  personality_quiz: 'ควิซบุคลิกภาพ',
}

const RESOLVE_METHOD_NAME: Record<ResolveMethod, string> = {
  fixed: 'ได้ตามที่กด',
  weighted: 'สุ่มตามโอกาสที่ตั้งไว้',
  quota: 'สุ่มจนกว่าของจะหมด',
  score: 'ตัดสินจากคะแนนที่ตอบถูก',
}

export const inputTypeName = (type: InputType): string => INPUT_TYPE_NAME[type]
export const resolveMethodName = (method: ResolveMethod): string => RESOLVE_METHOD_NAME[method]

export const asInputType = (raw: string | undefined | null): InputType | null =>
  (INPUT_TYPES as readonly string[]).includes(raw ?? '') ? (raw as InputType) : null

export const asResolveMethod = (raw: string | undefined | null): ResolveMethod | null =>
  (RESOLVE_METHODS as readonly string[]).includes(raw ?? '') ? (raw as ResolveMethod) : null

export type WizardFieldKey =
  | 'entry_rules' | 'grid' | 'slots' | 'meaningful' | 'questions' | 'prompt'
  | 'weights' | 'score_bands' | 'fallback_card_id' | 'outcomes'

/** บล็อกของ M7-S02 ที่ช่องนี้อยู่ · 1 เล่นได้เมื่อไหร่ · 2 ตัดสินผลยังไง · 3 แล้วเกิดอะไรต่อ */
export type WizardBlock = 1 | 2 | 3

/**
 * ตัวควบคุมที่จอวาดให้ช่องนี้ · จอมีตัวละหนึ่งแบบ ไม่มีตัวที่เขียนเผื่อกิจกรรมใดกิจกรรมหนึ่ง
 *
 * The screen keeps one renderer per entry here and looks it up by name. That is
 * the difference between a generated form and a hand-written one: the screen
 * never asks what kind of activity it is drawing, only what the definition said
 * to draw, so a new pair of axes is a new line in this file rather than a new
 * branch in a page.
 */
export const WIZARD_CONTROLS = [
  'entry_rules', 'grid', 'lines', 'toggle', 'text', 'card',
  'outcomes', 'outcome_weight', 'outcome_band',
] as const
export type WizardControl = (typeof WIZARD_CONTROLS)[number]

/**
 * ค่าของช่องนี้ไปลงที่ไหนในตาราง activity
 *
 * Written down rather than inferred because the save actions read the form by
 * walking these fields. An action that guessed the destination from the input
 * type would be the same switch BR-87 forbids, moved from the screen to the
 * write path where it is harder to see.
 */
export const WIZARD_STORES = ['input_config', 'resolve_config', 'entry_rules', 'column'] as const
export type WizardStore = (typeof WIZARD_STORES)[number]

export type WizardField = {
  key: WizardFieldKey
  label: string
  hint?: string
  required: boolean
  block: WizardBlock
  control: WizardControl
  store: WizardStore
}

/** ช่องที่ทุกกิจกรรมมีเหมือนกัน ไม่ว่าจะผสมแกนไหน */
const ENTRY_RULES: WizardField = {
  key: 'entry_rules',
  label: 'เล่นได้เมื่อไหร่',
  hint: 'ตรวจเรียงจากบนลงล่าง · ไม่มีเงื่อนไข = ผู้เล่นกดเล่นได้เสมอ',
  required: false,
  block: 1,
  control: 'entry_rules',
  store: 'entry_rules',
}

const OUTCOMES: WizardField = {
  key: 'outcomes',
  label: 'แล้วเกิดอะไรต่อ',
  hint: 'ทุกผลลัพธ์ต้องมีการ์ดที่ตอบ ไม่งั้นผู้เล่นกดแล้วเงียบ',
  required: true,
  block: 3,
  control: 'outcomes',
  store: 'resolve_config',
}

/**
 * ช่องที่มาจากแกน 1 · ชนิดอินพุตบอกว่าต้องถามอะไรเกี่ยวกับสิ่งที่ผู้เล่นส่งเข้ามา
 *
 * personality_quiz ไม่มีแถวในนี้โดยตั้งใจ — คีย์ครบแค่สี่ชนิดที่มี resolve_method จริง
 * เพิ่ม 'personality_quiz: []' เข้ามาจะดูเหมือนบอกว่ามันก็เป็นอีกคู่หนึ่งของแกน 1 กับ
 * แกน 2 เหมือนสี่ชนิดแรก ทั้งที่มันไม่มีแกน 2 ให้ผสมด้วยเลย
 */
const BY_INPUT: Record<Exclude<InputType, 'personality_quiz'>, WizardField[]> = {
  none: [],
  pick_one: [
    {
      key: 'grid',
      label: 'ผังช่อง · Layout',
      required: true,
      block: 2,
      control: 'grid',
      store: 'input_config',
    },
    {
      key: 'slots',
      label: 'ป้ายบนแต่ละช่อง · Slots',
      hint: 'บรรทัดละหนึ่งช่อง · ลำดับของบรรทัดคือลำดับที่ผู้เล่นเห็น',
      required: true,
      block: 2,
      control: 'lines',
      store: 'input_config',
    },
    {
      key: 'meaningful',
      label: 'ตัวเลือกมีความหมาย',
      hint: 'เปิด = ช่องที่กดตรงกับผลลัพธ์ลำดับเดียวกัน · ปิด = กดช่องไหนก็ตัดสินด้วยวิธีในแกน 2',
      required: false,
      block: 2,
      control: 'toggle',
      store: 'input_config',
    },
  ],
  quiz: [
    {
      key: 'questions',
      label: 'ชุดคำถาม · Questions',
      hint: 'ติ๊ก ✓ ที่ตัวเลือกเพื่อกำหนดคำตอบที่ถูก · ตัวเลือกได้ 2–4 ข้อ',
      required: true,
      block: 2,
      control: 'lines',
      store: 'input_config',
    },
  ],
  text: [
    {
      key: 'prompt',
      label: 'ข้อความชวนให้พิมพ์',
      hint: 'ผู้เล่นเห็นข้อความนี้ก่อนพิมพ์คำตอบ — ไม่มีข้อความ ผู้เล่นไม่รู้ว่าต้องพิมพ์อะไร',
      required: true,
      block: 2,
      control: 'text',
      store: 'input_config',
    },
  ],
}

/** ช่องที่มาจากแกน 2 · วิธีตัดสินผลบอกว่าผลลัพธ์แต่ละแถวต้องกรอกอะไรเพิ่ม */
const BY_RESOLVE: Record<ResolveMethod, WizardField[]> = {
  fixed: [],
  weighted: [
    {
      key: 'weights',
      label: 'น้ำหนักของแต่ละผลลัพธ์',
      hint: 'กรอกเป็นค่าดิบ — ระบบคำนวณเปอร์เซ็นต์ให้ ไม่ต้องไล่แก้ให้รวมกันได้ 100',
      required: true,
      block: 3,
      control: 'outcome_weight',
      store: 'resolve_config',
    },
  ],
  quota: [
    {
      key: 'weights',
      label: 'น้ำหนักของแต่ละผลลัพธ์',
      hint: 'จำนวนจำกัดอยู่ที่รางวัล ไม่ใช่ที่ผลลัพธ์ (BR-30)',
      required: true,
      block: 3,
      control: 'outcome_weight',
      store: 'resolve_config',
    },
    {
      key: 'fallback_card_id',
      label: 'การ์ดสำรองเมื่อของหมด · Required (BR-31)',
      hint: 'ของหมดแล้วยังมีคนกดเล่น — ไม่มีการ์ดสำรอง คนนั้นจะไม่ได้รับอะไรเลย',
      required: true,
      block: 2,
      control: 'card',
      store: 'column',
    },
  ],
  score: [
    {
      key: 'score_bands',
      label: 'ช่วงคะแนนของแต่ละผลลัพธ์',
      hint: 'ตอบถูกกี่ข้อถึงได้ผลลัพธ์นี้ · ช่วงนับรวมปลายทั้งสองข้าง',
      required: true,
      block: 3,
      control: 'outcome_band',
      store: 'resolve_config',
    },
  ],
}

/**
 * ช่องทั้งหมดที่ฟอร์มต้องถาม เมื่อผสมแกน 1 กับแกน 2 คู่นี้
 *
 * Returns the fields for every pair, including the ones comboProblem refuses.
 * The two answer different questions: this one says what the form looks like,
 * and that one says whether the pair may be saved. Folding them together would
 * mean an invalid pair rendered as a blank screen with no way to see what was
 * wrong or to change it back.
 */
export function fieldsFor(input: InputType, resolve: ResolveMethod): WizardField[] {
  // personality_quiz ไม่ควรเดินมาถึงฟังก์ชันนี้เลย (หน้าจอกันไว้ก่อนเรียกแล้ว — ดูคอมเมนต์
  // ของ BY_INPUT ด้านบน) เงื่อนไขนี้จึงมีไว้กันพังทางชนิดข้อมูลของ BY_INPUT[input] เท่านั้น
  // ไม่ใช่นิยามว่าเมื่อเรียกจริงแล้วจะได้ฟอร์มแบบไหน
  const byInput = input === 'personality_quiz' ? [] : BY_INPUT[input]
  return [ENTRY_RULES, ...byInput, ...BY_RESOLVE[resolve], OUTCOMES]
}

/**
 * ช่องที่ค่าไปลง input_config · ทั้งจอและ action อ่านฟอร์มจากรายการนี้
 *
 * The save action uses this to decide which form keys it is willing to write,
 * so an activity that does not ask for slots cannot be made to store slots by
 * anyone who edits the request. That is a filter derived from the type
 * definition rather than a list repeated in the action.
 */
export const inputConfigFields = (input: InputType, resolve: ResolveMethod): WizardField[] =>
  fieldsFor(input, resolve).filter((field) => field.store === 'input_config')

/**
 * คู่ที่ผสมกันไม่ได้ พร้อมเหตุผล (BR-36)
 *
 * Both refusals are read off lib/engine/resolve.ts rather than invented here.
 * 'fixed' finds the outcome whose id equals input.pickedId, and 'score' finds
 * the band containing input.score; an activity that collects neither leaves the
 * engine with nothing to match, the find returns undefined, and resolve() comes
 * back with an empty list. The player gets no card. Refusing the pair here is
 * the only place that failure is cheap to see.
 */
export function comboProblem(input: InputType, resolve: ResolveMethod): string | null {
  if (resolve === 'fixed' && input !== 'pick_one') {
    return 'ได้ตามที่กดต้องมีช่องให้เลือก — ใช้ได้กับอินพุตแบบ "ให้เลือกจากตาราง" เท่านั้น'
      + ' ไม่งั้นไม่มีสิ่งที่ผู้เล่นเลือกให้จับคู่กับผลลัพธ์ และผู้เล่นจะไม่ได้การ์ดเลย'
  }
  if (resolve === 'score' && input !== 'quiz') {
    return 'ตัดสินจากคะแนนที่ตอบถูก ต้องมีคะแนนมาจากไหนสักที่ — ใช้ได้กับอินพุตแบบ "ตอบคำถาม" เท่านั้น'
      + ' อินพุตแบบอื่นไม่ได้ให้คะแนนไว้เทียบกับช่วง ผลลัพธ์จึงไม่มีทางเข้าช่วงไหนได้'
  }
  return null
}

/** คู่ที่บันทึกได้จริงทั้งหมด · จอใช้รายการนี้ตัดสินว่าตัวเลือกไหนกดไม่ได้ */
export const isComboAllowed = (input: InputType, resolve: ResolveMethod): boolean =>
  comboProblem(input, resolve) === null
