# LIFF Quiz — exported template

This is a standalone Next.js project generated from a LineKit personality-quiz campaign. It has no
runtime dependency on LineKit at all — it's a self-contained app with its own copy of the scoring
engine, message renderers, and screens, configured entirely by `config/quiz.config.json`.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

If `config/quiz.config.json` doesn't exist yet (e.g. you're developing this template folder directly
rather than from an export), the app falls back to `config/quiz.config.sample.json` so `npm run dev`
still works out of the box.

## Required environment variables

| Variable | What it is | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_LIFF_ID` | The LIFF app's ID | LINE Developers Console → your channel → LIFF tab |
| `LINE_CHANNEL_SECRET` | Messaging API channel secret | LINE Developers Console → Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived channel access token | LINE Developers Console → Messaging API tab → Issue |
| `DATABASE_URL` *(optional)* | Standard Postgres connection string for duo/group mode's cross-device state | See "Setting up Postgres for duo/group mode" below |

Never commit real values — `.env.local` is gitignored. Leave `DATABASE_URL` unset to use the
local file-store default for quick local testing without a real database.

## Connecting a real LINE Login + Messaging API channel

1. Create a LINE Official Account at the [LINE Official Account Manager](https://manager.line.biz/)
   (free) if you don't have one for this campaign yet.
2. In the [LINE Developers Console](https://developers.line.biz/console/), create a provider, then a
   **Messaging API channel** linked to that OA.
3. In that channel's **LIFF** tab, add a LIFF app:
   - Endpoint URL: `https://<your-deployment>/` (root of this app)
   - Size: Full
   - Scopes: `profile`, `openid`
   Copy the resulting LIFF ID into `NEXT_PUBLIC_LIFF_ID`.
4. In **Basic settings**, copy the **Channel secret** into `LINE_CHANNEL_SECRET`.
5. In **Messaging API**, issue a **Channel access token (long-lived)** into
   `LINE_CHANNEL_ACCESS_TOKEN`.
6. Still in **Messaging API**, set the **Webhook URL** to `https://<your-deployment>/api/webhook`
   (only needed if you use the push-notification cards — see below), click **Verify**, then enable
   **Use webhook**. Turn off "Auto-reply messages" and "Greeting messages" so LINE's own bot doesn't
   answer on top of this app.
7. Deploy (e.g. to Vercel), set the three env vars above as the deployment's environment variables,
   then repeat steps 3/6 pointing at the real deployment URL instead of localhost.

## Setting up Postgres for duo/group mode

Solo mode never touches a database — it resolves in a single request. Duo and group modes need
state that survives across devices/requests (waiting for a partner to answer, waiting for a group
to fill up), so they go through `lib/store/`'s `Store` interface. Two implementations exist:

- `lib/store/fileStore.ts` — a JSON file on disk. Zero setup, but only correct for a single,
  long-running instance (a serverless/Vercel deployment invokes your code across many ephemeral
  instances with no shared, persistent filesystem, so duo/group state would silently go missing).
- `lib/store/postgresStore.ts` — a real Postgres-backed store, safe across any number of instances
  or processes. **This is what you want for any real deployment that uses duo or group mode.**

`lib/store/index.ts`'s `getStore()` picks between them automatically based on whether
`DATABASE_URL` is set — nothing else in the app needs to change either way.

**1. Get a Postgres connection string.** Any standard Postgres works — Vercel Postgres, Neon,
self-hosted, whatever your team already has. As one concrete option, Supabase (whose Postgres this
template's authoring ecosystem already assumes elsewhere) gives you one from your project dashboard:
**Project Settings → Database → Connection string** (use the "URI" tab). It looks like
`postgresql://postgres.<ref>:<password>@<host>:5432/postgres`.

**2. Run the schema once** against that database:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

This creates the tables `postgresStore.ts` expects (`quiz_answers`, `quiz_pairs`, `quiz_groups`,
`quiz_group_members`) — every statement is guarded with `IF NOT EXISTS`, so re-running it is safe.

**3. Set `DATABASE_URL`** (in `.env.local` for local dev, or as an environment variable on your
deployment platform) to that same connection string. That's it — `getStore()` switches over
automatically.

## What's included vs. what you may need to extend

- **Included and fully wired:** config schema + versioned loader, the scoring/matching engine (solo
  type-code, duo pairing, group archetypes), all 12 message-template renderers, all 12 screens, a
  `Store` interface with two implementations — a file-backed store (`lib/store/fileStore.ts`, the
  local-dev default, fine for a single-instance deployment) and a Postgres-backed store
  (`lib/store/postgresStore.ts`, used automatically once `DATABASE_URL` is set — see above; safe
  across concurrent requests and multiple instances, including serverless) — and a fully wired solo
  quiz flow.
- **Wired for solo, stubbed for duo/group:** `lib/liff/client.ts` — the LIFF SDK integration
  (`liff.init`, `liff.getProfile`, friend-gate check) has clear comments marking where to plug in real
  calls for duo/group's cross-device flows.
- **Not included:** a scheduler for time-based reminder pushes (partner hasn't matched after N hours,
  group still incomplete) — these are exposed as plain API routes you can point an external cron
  service at (e.g. a Vercel Cron job or GitHub Actions schedule hitting the route on a timer); hero
  image compositing for the duo full-pair-result card (`heroImageUrl` is accepted as an already-computed
  URL — generating it is a separate image-processing step you provide).

## Testing

```bash
npm test               # unit tests — no database needed
npm run db:reset       # local Postgres only: (re)creates liff_template_test + runs db/schema.sql
npm run test:integration  # postgresStore.ts against a real Postgres (TEST_DATABASE_URL, defaults to liff_template_test)
npm run test:all       # everything
npm run typecheck
npm run build
```

| Layer | Tests | Needs a database |
|---|---|---|
| unit | engine, render, screens, `fileStore.ts` | ❌ |
| integration (`**/*.integration.test.ts`) | `postgresStore.ts`, including concurrent-request safety | ✅ |

## Project layout

```
lib/schema.ts       config schema (schemaVersion + quiz config shape)
lib/config.ts       loads + validates config/quiz.config.json at boot
lib/engine/         pure scoring/matching logic (quiz.ts, group.ts)
lib/render/         pure Flex-message-template builders (messages.ts)
lib/store/          persistence — types.ts interface, fileStore.ts (default) + postgresStore.ts
                    (used once DATABASE_URL is set) impls, index.ts factory (getStore())
lib/liff/           thin @line/liff wrapper
db/schema.sql       Postgres schema for postgresStore.ts (see "Setting up Postgres" above)
app/screens/        the 12 screens
app/page.tsx        screen routing / state machine
app/api/            local API routes (answer submission, etc.)
```
