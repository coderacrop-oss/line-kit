import { readTemplateConfigFromDisk } from '../../../lib/config'
import { resolveSolo, validateAnswers } from '../../../lib/engine/quiz'
import type { Answer } from '../../../lib/engine/quiz'

/**
 * Solo-mode answer submission (design doc §2 — this slice wires solo fully
 * end-to-end; duo/group answer/pair/group routes are a Phase 2 follow-on that plug
 * into `lib/store/`'s Store interface once a real cross-device deployment needs
 * them). Reads config/quiz.config.json off disk (or the sample, if not yet
 * exported), validates the answers against it, and resolves a result — no
 * persistence needed since solo has nothing to wait for.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { answers?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const answers = Array.isArray(body?.answers) ? (body.answers as Answer[]) : []
  const { quiz } = readTemplateConfigFromDisk()

  if (quiz.mode !== 'solo') {
    return Response.json(
      { error: 'This route only resolves mode: "solo" in this slice — duo/group routes are a follow-on (see README).' },
      { status: 400 },
    )
  }

  const validationError = validateAnswers(quiz, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 })
  }

  const result = resolveSolo(quiz, answers)
  return Response.json(result)
}
