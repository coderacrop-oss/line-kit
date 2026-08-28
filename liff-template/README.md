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

Never commit real values — `.env.local` is gitignored.

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

## What's included vs. what you may need to extend

- **Included and fully wired:** config schema + versioned loader, the scoring/matching engine (solo
  type-code, duo pairing, group archetypes), all 12 message-template renderers, all 12 screens, a
  file-backed store (`lib/store/fileStore.ts` — fine for a single-instance deployment; swap in your
  own `Store` implementation for anything higher-scale), and a fully wired solo quiz flow.
- **Wired for solo, stubbed for duo/group:** `lib/liff/client.ts` — the LIFF SDK integration
  (`liff.init`, `liff.getProfile`, friend-gate check) has clear comments marking where to plug in real
  calls for duo/group's cross-device flows.
- **Not included:** a scheduler for time-based reminder pushes (partner hasn't matched after N hours,
  group still incomplete) — these are exposed as plain API routes you can point an external cron
  service at (e.g. a Vercel Cron job or GitHub Actions schedule hitting the route on a timer); hero
  image compositing for the duo full-pair-result card (`heroImageUrl` is accepted as an already-computed
  URL — generating it is a separate image-processing step you provide).

## Project layout

```
lib/schema.ts       config schema (schemaVersion + quiz config shape)
lib/config.ts       loads + validates config/quiz.config.json at boot
lib/engine/         pure scoring/matching logic (quiz.ts, group.ts)
lib/render/         pure Flex-message-template builders (messages.ts)
lib/store/          persistence (types.ts interface + fileStore.ts default impl)
lib/liff/           thin @line/liff wrapper
app/screens/        the 12 screens
app/page.tsx        screen routing / state machine
app/api/            local API routes (answer submission, etc.)
```
