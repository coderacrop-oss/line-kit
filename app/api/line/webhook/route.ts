import { getChannelSecret } from '@/lib/line/client'
import { verifySignature } from '@/lib/line/verify'

/**
 * The single entry point from LINE.
 *
 * Two things happen here and nowhere else: the signature is checked, and LINE
 * gets its 200 before any work starts. LINE retries a non-200, and a retry
 * after a reward has been granted would grant it twice.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text()

  if (!verifySignature(raw, request.headers.get('x-line-signature'), getChannelSecret())) {
    return new Response('invalid signature', { status: 401 })
  }

  return Response.json({ ok: true })
}
