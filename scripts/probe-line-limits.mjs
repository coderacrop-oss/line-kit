#!/usr/bin/env node
/**
 * Measures the LINE limits that FLEX_AD_L1 OI-03 has been blocked on since v0.1:
 * how long a reply token actually stays usable, and how large a Flex payload can
 * get before LINE rejects it.
 *
 * Runs as a local webhook receiver rather than on Vercel on purpose. The reply
 * token probe has to hold a request open for up to two minutes, which no
 * serverless timeout allows.
 *
 *   node scripts/probe-line-limits.mjs
 *
 * Then expose port 8787 and point a *test* channel's webhook at it:
 *   cloudflared tunnel --url http://localhost:8787
 *
 * Talk to the OA to drive it:
 *   t 30      reply after waiting 30s   → is the token still good?
 *   flex      binary-search the Flex size ceiling (needs PROBE_ALLOW_PUSH=1)
 *   help      list commands
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFile } from 'node:fs/promises'

const PORT = Number(process.env.PROBE_PORT ?? 8787)
const SECRET = process.env.LINE_CHANNEL_SECRET
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const ALLOW_PUSH = process.env.PROBE_ALLOW_PUSH === '1'
const LOG = 'docs/probes/oi-03-raw.jsonl'

const REPLY = 'https://api.line.me/v2/bot/message/reply'
const PUSH = 'https://api.line.me/v2/bot/message/push'

/** Delays worth trying, in seconds. Each one burns a token, so tap once per rung. */
const LADDER = [5, 15, 30, 45, 60, 90, 120, 180]

if (!SECRET || !TOKEN) {
  console.error('Missing LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN.')
  console.error('Use a test channel. Never point this at a customer OA.')
  process.exit(1)
}

// ── signature (mirrors lib/line/verify.ts) ──────────────────────────────
function verify(rawBody, signature) {
  if (!signature) return false
  const expected = Buffer.from(
    createHmac('sha256', SECRET).update(rawBody, 'utf8').digest('base64'),
  )
  const received = Buffer.from(signature)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

// ── LINE calls ──────────────────────────────────────────────────────────
async function callLine(url, payload) {
  const started = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  })
  const text = res.ok ? '' : await res.text()
  return { ok: res.ok, status: res.status, body: text, ms: Date.now() - started }
}

const textMessage = (text) => ({ type: 'text', text })

/** A Flex bubble padded until its JSON is at least `bytes` long. */
function flexOfSize(bytes) {
  const contents = []
  const bubble = () => ({
    type: 'flex',
    altText: `probe ${bytes}`,
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents } },
  })
  // One text component is ~90 bytes serialised; grow until we cross the target.
  while (JSON.stringify(bubble()).length < bytes) {
    contents.push({ type: 'text', text: 'x'.repeat(60), wrap: true })
  }
  return bubble()
}

async function record(row) {
  const line = JSON.stringify({ ...row, at: new Date().toISOString() })
  console.log(line)
  try {
    await appendFile(LOG, line + '\n')
  } catch {
    // docs/probes may not exist yet — stdout is still the record of truth.
  }
}

// ── probe 1 · how long does a reply token live ──────────────────────────
async function probeReplyToken(replyToken, seconds) {
  console.log(`  waiting ${seconds}s before replying…`)
  await new Promise((r) => setTimeout(r, seconds * 1000))

  const res = await callLine(REPLY, {
    replyToken,
    messages: [textMessage(`token survived ${seconds}s`)],
  })

  await record({
    probe: 'reply_token',
    delaySeconds: seconds,
    tokenStillValid: res.ok,
    status: res.status,
    error: res.body.slice(0, 300),
  })

  console.log(
    res.ok
      ? `  ✅ ${seconds}s — token STILL VALID`
      : `  ❌ ${seconds}s — token DEAD (${res.status}) ${res.body.slice(0, 160)}`,
  )
}

// ── probe 2 · how big can a Flex message be ────────────────────────────
async function probeFlexSize(userId) {
  if (!ALLOW_PUSH) {
    console.log('  skipped: set PROBE_ALLOW_PUSH=1 to allow push messages (they cost quota)')
    return
  }

  let lo = 1_000 // known good
  let hi = 200_000 // expected to fail
  let lastGood = 0
  let lastError = ''

  console.log('  binary-searching the Flex size ceiling…')
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2)
    const message = flexOfSize(mid)
    const actual = JSON.stringify(message).length
    const res = await callLine(PUSH, { to: userId, messages: [message] })

    console.log(`    ${actual} bytes → ${res.ok ? 'ok' : `${res.status}`}`)
    if (res.ok) {
      lastGood = actual
      lo = mid
    } else {
      lastError = res.body.slice(0, 200)
      hi = mid
    }
    await new Promise((r) => setTimeout(r, 400)) // stay polite
  }

  await record({ probe: 'flex_size', maxAcceptedBytes: lastGood, firstRejection: lastError })
  console.log(`  ✅ largest Flex accepted: ~${lastGood} bytes`)
  console.log(`     first rejection said: ${lastError}`)
}

// ── dispatch ────────────────────────────────────────────────────────────
async function handleEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') return
  const said = event.message.text.trim().toLowerCase()
  const replyToken = event.replyToken
  const userId = event.source?.userId

  const ladderHint = LADDER.map((s) => `t ${s}`).join(' · ')

  if (said === 'help' || said === '?') {
    await callLine(REPLY, {
      replyToken,
      messages: [textMessage(`probes:\n${ladderHint}\nflex\n\nresults land in ${LOG}`)],
    })
    return
  }

  const ladderMatch = said.match(/^t\s+(\d+)$/)
  if (ladderMatch) {
    const seconds = Number(ladderMatch[1])
    console.log(`\n▸ reply-token probe: ${seconds}s`)
    await probeReplyToken(replyToken, seconds)
    return
  }

  if (said === 'flex') {
    console.log('\n▸ flex-size probe')
    // Answer first so the tester sees something, then probe with push.
    await callLine(REPLY, { replyToken, messages: [textMessage('probing Flex size, watch the terminal')] })
    if (userId) await probeFlexSize(userId)
    else console.log('  no userId on this event — cannot push')
    return
  }

  await callLine(REPLY, {
    replyToken,
    messages: [textMessage(`unknown probe. try:\n${ladderHint}\nflex`)],
  })
}

createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200).end('probe up')
    return
  }

  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    if (!verify(raw, req.headers['x-line-signature'])) {
      console.error('✗ bad signature — is LINE_CHANNEL_SECRET the right channel?')
      res.writeHead(401).end('invalid signature')
      return
    }

    // Answer LINE immediately. The probes deliberately outlive this response,
    // which is exactly why this runs locally and not on a serverless host.
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')

    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return
    }
    for (const event of body.events ?? []) {
      handleEvent(event).catch((error) => console.error('probe failed', error))
    }
  })
}).listen(PORT, () => {
  console.log(`probe listening on :${PORT}`)
  console.log(`push probes ${ALLOW_PUSH ? 'ENABLED' : 'disabled (set PROBE_ALLOW_PUSH=1)'}`)
  console.log('\nexpose the port, point a TEST channel at it, then say "help" in the chat.')
  console.log(`ladder: ${LADDER.map((s) => `t ${s}`).join('  ')}\n`)
})
