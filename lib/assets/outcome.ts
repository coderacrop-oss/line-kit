/**
 * ผลของการอัปโหลดชุดหนึ่ง เดินทางจาก action กลับมาถึงจอ
 *
 * A batch does not fail as a batch. The prototype says so out loud — the files
 * that passed are uploaded and the ones that did not are named with a reason —
 * and that is the behaviour a person with five images and one 2 MB export needs.
 * So an action that threw on the first bad file would be the wrong shape: a
 * thrown error is one message for the whole submission and it loses the four
 * files that were already written.
 *
 * The report travels in the query string because these screens are Server
 * Components with no client state to hold it. That makes it a value anybody can
 * type, so decoding treats it as hostile: never throws, caps how much of it is
 * believed, and drops anything shaped wrong rather than rendering it.
 */
export type Rejection = { file: string; why: string }
export type UploadOutcome = { uploaded: number; rejected: Rejection[] }

/** พอที่จะเห็นว่าอะไรพลาดบ้าง โดยที่ URL ยังไม่ยาวจนเซิร์ฟเวอร์ตัดทิ้ง */
export const MAX_REPORTED = 20
export const MAX_TEXT = 200

const clamp = (text: string) => text.slice(0, MAX_TEXT)

export function encodeOutcome(outcome: UploadOutcome): string {
  const params = new URLSearchParams()
  params.set('uploaded', String(Math.max(0, Math.trunc(outcome.uploaded))))
  if (outcome.rejected.length > 0) {
    const pairs = outcome.rejected
      .slice(0, MAX_REPORTED)
      .map((item) => [clamp(item.file), clamp(item.why)])
    params.set('rejected', JSON.stringify(pairs))
  }
  return params.toString()
}

const asRejection = (raw: unknown): Rejection | null => {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string' || typeof raw[1] !== 'string') return null
  return { file: clamp(raw[0]), why: clamp(raw[1]) }
}

/**
 * อ่านผลกลับมาจาก query string · คืน null เมื่อไม่มีผลของการอัปโหลดอยู่ในนั้น
 *
 * null and "zero uploads, nothing rejected" are different things: the first is
 * somebody opening the upload screen, the second is somebody who just submitted
 * an empty form. Only the second gets told anything.
 */
export function decodeOutcome(
  params: { uploaded?: string | string[]; rejected?: string | string[] },
): UploadOutcome | null {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

  const uploadedRaw = first(params.uploaded)
  const rejectedRaw = first(params.rejected)
  if (uploadedRaw === undefined && rejectedRaw === undefined) return null

  const uploaded = Number(uploadedRaw)
  const rejected: Rejection[] = []

  if (rejectedRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rejectedRaw)
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(0, MAX_REPORTED)) {
          const rejection = asRejection(item)
          if (rejection) rejected.push(rejection)
        }
      }
    } catch {
      // ค่าที่พังคือค่าที่ไม่ได้มาจากที่นี่ · รายงานว่าไม่มีอะไรถูกปฏิเสธ ดีกว่ารายงานขยะ
    }
  }

  return {
    uploaded: Number.isFinite(uploaded) && uploaded > 0 ? Math.trunc(uploaded) : 0,
    rejected,
  }
}
