# LIFF Template Export — Core Implementation Plan (Slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Slice-1 core described in `docs/superpowers/specs/2026-08-28-liff-template-export-design.md`:
an extended, versioned quiz-config schema (`templateCopy`), a standalone `liff-template/` Next.js
project (its own vendored pure engine + 12 message-template renderers + file-backed store + 12
screen components + a wired solo flow), and a LineKit-side export mechanism that assembles
`liff-template/` plus a stamped config into a downloadable zip.

**Architecture:** See design doc §3. `liff-template/` is a real, separate Next.js project tree living
at the LineKit repo root — never `npm install`ed inside this repo, never imported by LineKit code.
LineKit only reads its files off disk (`lib/liffExport/assemble.ts`) to build a zip. Its pure
directories (`lib/engine/`, `lib/render/`) are vendored copies of `lib/quiz/engine.ts` and
`lib/quiz/groupEngine.ts`, covered by the same purity guarantee as LineKit's own `lib/engine/`/
`lib/render/`/`lib/match/` (extend `lib/architecture.test.ts`'s `PURE_DIRS`).

**Tech Stack:** Next.js App Router, Zod, Vitest + `@testing-library/react`, `archiver` (new dep, added
to LineKit's own `package.json` only). Same repo conventions as the native quiz engine slices this
extends.

**Spec:** `docs/superpowers/specs/2026-08-28-liff-template-export-design.md` — every task below
implements one numbered section of it; read the relevant section before starting a task.

## Global Constraints

- `liff-template/lib/engine/quiz.ts` and `liff-template/lib/engine/group.ts` must be **behavior-identical**
  copies of `lib/quiz/engine.ts`/`lib/quiz/groupEngine.ts` — only the relative import path to `./schema`
  changes. Copy the existing `.test.ts` files the same way (change imports only) before writing a
  single new line of implementation, so any accidental behavior drift shows up as a failing test
  immediately.
- Every new pure file under `liff-template/lib/engine/` and `liff-template/lib/render/` must never
  import from `next/`, `@supabase/`, `postgres`, call `fetch(`, or read `process.env` — same rule as
  `lib/architecture.test.ts` already enforces for `lib/engine`/`lib/render`/`lib/match`. Task 9 adds
  both new directories to `PURE_DIRS`; write every other task's pure files as if that guard already
  existed.
- No visible campaign copy is ever hardcoded in a renderer or screen component — every string comes
  from `TemplateConfig`/`QuizConfig`/`GroupArchetype`/`QuizResultRule`/runtime props, except generic
  technical labels (`"Loading…"`, `"?"` placeholder, a single non-campaign-specific error fallback
  string). This is checked by hand in each task's test (assert the render output changes when the
  config string changes — a hardcoded string would make that assertion fail).
- Unit tests: co-located `*.test.ts`/`*.test.tsx`, run by `npx vitest run` (LineKit's root config
  already globs the whole repo — no separate vitest config needed for `liff-template/`).
- Component tests use `@testing-library/react` + jsdom, same pattern as
  `components/cards/Preview.test.tsx` — assert on rendered text content via `getByText`/`queryByText`,
  not snapshot-the-whole-tree.
- Before any task is considered done: `npx tsc --noEmit` and `npx vitest run` (full unit suite).
- Commit-per-task, `git add` only the files that task touched, conventional-commit style messages
  (`feat:`/`test:`/`docs:`), matching this repo's existing log style.
- Tasks 3–8 (schema extension is Task 1, scaffold is Task 2) are independent of each other once
  Task 1 + Task 2 land — they touch disjoint files and can be built in parallel by separate workers.
  Task 10 (screens) only needs the prop shapes from the design doc §7, not Tasks 3–6's actual code.
  Task 11 (page wiring) depends on Tasks 3, 4, 7, 8, 10. Task 12 (export mechanism) depends on Task 1
  + Task 2 only. Task 13 (admin UI + parity) depends on Task 1.

---

### Task 1: Extend `lib/quiz/schema.ts` — `templateCopy`

**Files:** Modify `lib/quiz/schema.ts`; extend `lib/quiz/schema.test.ts`.

**Interfaces:** Adds exports `RewardMilestone`, `TemplateMessagesCopy`, `TemplateCopy` (Zod schemas +
inferred types) and a new optional field `QuizAxis.imageUrl` and `QuizConfig.templateCopy`. Extends
`QuizConfig`'s `superRefine` with the mode/group-conditional-required rules from design doc §4.1.

- [ ] Add `imageUrl: z.string().url().optional()` to `QuizAxis`.
- [ ] Add `RewardMilestone`, `TemplateMessagesCopy`, `TemplateCopy` schemas exactly as drafted in
      design doc §4.1 (field names/limits verbatim).
- [ ] Add `templateCopy: TemplateCopy.optional()` to `QuizConfig`.
- [ ] Extend `QuizConfig`'s existing `superRefine` with: if `templateCopy` is set and
      `mode === 'duo'`, require `templateCopy.invite` and `templateCopy.messages.duoInvite` /
      `.duoPartnerAnswered` / `.duoPairResult`; if `mode === 'solo'`, require
      `templateCopy.messages.soloShare`; if `group?.enabled`, require `templateCopy.messages.groupComplete`
      / `.groupUnlock` / `.groupReminder` / `.groupInvite`. Emit one `ctx.addIssue` per missing field
      with a path under `['templateCopy', 'messages', ...]` so admin-side errors point at the exact
      control.
- [ ] Write failing tests first in `lib/quiz/schema.test.ts`: valid `templateCopy` for each mode
      accepted; missing mode-required message keys rejected with a path pointing at the right field;
      `templateCopy` entirely absent still valid (backward-compatible with existing activities);
      `QuizAxis.imageUrl` optional/validated-as-URL-when-present.
- [ ] Implement, run `npx vitest run lib/quiz/schema.test.ts` to green.
- [ ] Commit: `feat: add templateCopy (branding/message copy) to QuizConfig`.

---

### Task 2: Scaffold `liff-template/` static project files

**Files:** Create `liff-template/package.json`, `liff-template/tsconfig.json`,
`liff-template/next.config.ts`, `liff-template/.env.example`, `liff-template/README.md`,
`liff-template/config/quiz.config.sample.json`, `liff-template/.gitignore`.
Test: `lib/liffExport/scaffold.test.ts` (new, asserts the static files LineKit will later read exist
and are well-formed — this is the one place a "test" is really a repo-hygiene check, not TDD-first).

- [ ] `package.json`: name `liff-quiz-template`, scripts `dev`/`build`/`start`/`test`
      (`vitest run --exclude "**/*.integration.test.ts"`), deps `next`, `react`, `react-dom`, devDeps
      `typescript`, `vitest`, `@testing-library/react`, `jsdom`, `@types/node`, `@types/react`,
      `@types/react-dom`. No `@line/liff` yet at scaffold time — added in Task 8's `lib/liff/client.ts`
      task alongside its real usage.
- [ ] `.env.example`: `NEXT_PUBLIC_LIFF_ID=`, `LINE_CHANNEL_SECRET=`, `LINE_CHANNEL_ACCESS_TOKEN=`,
      with comments explaining each is required before a real deploy (never a source-code constant —
      design doc mistake-to-avoid #2).
- [ ] `README.md`: `npm install`/`npm run dev`, required env vars table, and the concrete LINE-side
      setup sequence (create Login channel + Messaging API channel → set LIFF endpoint URL → set
      webhook URL → Verify) per the top-level task's requirement.
- [ ] `config/quiz.config.sample.json`: a small valid 2-axis solo `TemplateConfig` (schemaVersion 1)
      used only when someone runs the template folder standalone for local development before ever
      exporting a real campaign — `lib/config.ts` (Task 3) reads `quiz.config.json` if present, else
      falls back to this sample, so `npm run dev` works out of the box even pre-export.
- [ ] `.gitignore`: `node_modules`, `.next`, `.data` (file-store data dir from Task 7).
- [ ] Write `lib/liffExport/scaffold.test.ts`: asserts each of the above files exists,
      `package.json`/`quiz.config.sample.json` parse as valid JSON, and `package.json` has all four
      required scripts.
- [ ] Add `liff-template/node_modules/**` and `liff-template/.next/**` to root `vitest.config.ts`'s
      `exclude` array (defensive — nothing is installed there yet, but prevents future accidental
      double-collection if someone runs `npm install` inside `liff-template/` to dev on it directly).
- [ ] Commit: `feat: scaffold liff-template/ static project files`.

---

### Task 3: `liff-template/lib/schema.ts` + `lib/config.ts`

**Files:** Create `liff-template/lib/schema.ts`, `liff-template/lib/schema.test.ts`,
`liff-template/lib/config.ts`, `liff-template/lib/config.test.ts`.

**Interfaces:**
- `TEMPLATE_SCHEMA_VERSION = 1`
- `TemplateConfig = z.object({ schemaVersion: z.literal(1), quiz: QuizConfig })` (re-declares the same
  `QuizConfig`/`QuizAxis`/.../`TemplateCopy` shapes from Task 1, vendored — not imported from LineKit)
- `loadTemplateConfig(raw: unknown): TemplateConfig` — throws a clear, exact-wording error (design
  doc §4.2) on `schemaVersion` mismatch, and a normal Zod validation error otherwise.

- [ ] Write failing tests: valid config parses; `schemaVersion: 2` (or missing) throws the exact
      mismatch message with found/expected versions interpolated; malformed `quiz` throws a Zod
      error (not the version-mismatch message — must distinguish the two failure modes).
- [ ] Implement `schema.ts` (copy Task 1's schema shapes verbatim into this file, plus the
      `TemplateConfig` wrapper) and `config.ts` (`loadTemplateConfig`, plus a small helper that reads
      `config/quiz.config.json` if it exists on disk else `config/quiz.config.sample.json`, then calls
      `loadTemplateConfig` — this file is allowed to use `fs`/`path`, unlike `lib/engine`/`lib/render`,
      since it's not in `PURE_DIRS`).
- [ ] Run `npx vitest run liff-template/lib/schema.test.ts liff-template/lib/config.test.ts` green.
- [ ] Commit: `feat: add liff-template config schema + versioned loader`.

---

### Task 4: `liff-template/lib/engine/quiz.ts` (vendored)

**Files:** Create `liff-template/lib/engine/quiz.ts`, `liff-template/lib/engine/quiz.test.ts`.

- [ ] Copy `lib/quiz/engine.ts` verbatim into `liff-template/lib/engine/quiz.ts`; change
      `import type { QuizConfig } from './schema'` to `from '../schema'`. No other line changes.
- [ ] Copy `lib/quiz/engine.test.ts` verbatim into `liff-template/lib/engine/quiz.test.ts`, updating
      only the import paths (`./engine` → `./quiz`, `./schema` → `../schema`).
- [ ] Run `npx vitest run liff-template/lib/engine/quiz.test.ts` — expect it to pass immediately
      (proves the vendored copy is behaviorally identical, since it's the same test suite).
- [ ] Commit: `feat: vendor lib/quiz/engine.ts into liff-template as lib/engine/quiz.ts`.

---

### Task 5: `liff-template/lib/engine/group.ts` (vendored)

**Files:** Create `liff-template/lib/engine/group.ts`, `liff-template/lib/engine/group.test.ts`.

- [ ] Same procedure as Task 4, vendoring `lib/quiz/groupEngine.ts` → `liff-template/lib/engine/group.ts`
      (import path `./schema` → `../schema`) and its test file (also updating the sibling engine
      import if the original test imports `strongestAxis` from `./engine`, now `./quiz`).
- [ ] Run tests green.
- [ ] Commit: `feat: vendor lib/quiz/groupEngine.ts into liff-template as lib/engine/group.ts`.

---

### Task 6: `liff-template/lib/render/messages.ts` — shared + solo renderers

**Files:** Create `liff-template/lib/render/messages.ts`, `liff-template/lib/render/types.ts` (the
`FlexMessage`-ish return type), `liff-template/lib/render/messages.test.ts`.

**Interfaces (this task's slice):** `renderFollowMessage`, `renderResultCard`, `renderKeywordText`,
`renderKeywordCard`, `renderKeywordCustom`, `renderSoloShareCard` — signatures per design doc §6 table.

- [ ] Write failing tests per function: feed a `TemplateConfig['quiz']` with distinctive marker
      strings in every relevant `templateCopy`/`results` field and assert each marker string appears
      in the exact right place of the returned object (catches both missing wiring and hardcoded
      defaults — a hardcoded default would show the marker missing).
- [ ] Implement each as a small pure function building a plain Flex-bubble-shaped object (model the
      general shape on `lib/render/flex.ts`'s `toFlexBubble`, but do not import it — no LineKit
      dependency). `renderKeywordCustom` returns `cfg.templateCopy.messages.keywordCard.customFlexJson`
      verbatim if present (this field is `z.unknown().optional()` — add it to `TemplateMessagesCopy`'s
      `keywordCard` shape in Task 1/3 if not already there; if you find it's missing when you reach
      this task, add it here and note it back-fills Task 1/3, since this task discovered the gap).
- [ ] Implement string interpolation helper `interpolate(template: string, vars: Record<string,
      string|number>): string` (simple `replaceAll('{key}', String(value))` per placeholder) shared by
      every `*Template` field.
- [ ] Run tests green.
- [ ] Commit: `feat: add shared + solo message-template renderers`.

---

### Task 7: `liff-template/lib/render/messages.ts` — duo renderers

**Files:** Extend `liff-template/lib/render/messages.ts`, `liff-template/lib/render/messages.test.ts`.

**Interfaces:** `renderDuoInviteCard`, `renderDuoPartnerAnsweredPush`, `renderDuoPairResultCard`,
`renderDuoReminderPush` per design doc §6.

- [ ] Same TDD procedure as Task 6, one describe block per function. `renderDuoInviteCard` must use
      `interpolate` to substitute `{axisName}` (looked up from `cfg.axes` by the runtime `myAxisId`)
      into `titleTemplate`.
- [ ] Commit: `feat: add duo message-template renderers`.

---

### Task 8: `liff-template/lib/render/messages.ts` — group renderers

**Files:** Extend `liff-template/lib/render/messages.ts`, `liff-template/lib/render/messages.test.ts`.

**Interfaces:** `renderGroupCompletePush`, `renderGroupUnlockPush`, `renderGroupReminderPush`,
`renderGroupInviteCard` per design doc §6. The last one renders one avatar-shaped slot per member up
to `maxMembers`, using each member's axis (look up `cfg.axes` by id) for present members and a
generic `"?"` placeholder for open slots — assert both cases in the test.

- [ ] Same TDD procedure as Task 6/7.
- [ ] Commit: `feat: add group message-template renderers`.

---

### Task 9: `liff-template/lib/store/` — file-backed `Store`

**Files:** Create `liff-template/lib/store/types.ts`, `liff-template/lib/store/fileStore.ts`,
`liff-template/lib/store/fileStore.test.ts`.

**Interfaces:** The `Store` interface from design doc §8, plus `createFileStore(dataDir?: string):
Store`.

- [ ] Write failing tests against a temp directory (use `node:fs/promises` `mkdtemp`): save+load
      answers round-trip; `createPair`/`getPair` round-trip; `createGroup`/`joinGroup`/`getGroup`
      round-trip and reflect all joined members; loading a store file that doesn't exist yet returns
      empty/`null` rather than throwing; two sequential writes (simulating two requests) don't clobber
      each other (serialize writes through an in-process queue/mutex — a simple `Promise` chain is
      enough, document the multi-instance caveat from design doc §13 in a comment).
- [ ] Implement `fileStore.ts` — read-modify-write the whole JSON file per call, guarded by an
      in-process write queue.
- [ ] Run tests green.
- [ ] Commit: `feat: add file-backed Store implementation for liff-template`.

---

### Task 10: `liff-template/app/screens/*.tsx` — 12 screens

**Files:** Create one file + one test per screen under `liff-template/app/screens/`: `Loading.tsx`,
`Intro.tsx`, `Invited.tsx`, `Question.tsx`, `Matching.tsx`, `Summary.tsx`, `PairResult.tsx`,
`Rewards.tsx`, `Group.tsx`, `ErrorScreen.tsx`, `FriendGate.tsx`, `OpenInLine.tsx` (+ matching
`.test.tsx` for each).

**Interfaces:** Props exactly per design doc §7 table. Plain HTML/flexbox styling only, no CSS
framework, no hardcoded campaign copy — every piece of visible text is a prop.

- [ ] For each screen: write the failing component test first (render with distinctive prop values,
      assert via `getByText` they appear; for `Matching`/`Group`/`PairResult`/`Summary` also assert
      conditional branches — e.g. `Matching` falls back to a generic placeholder box when
      `axisCardImageUrl*` is undefined, `Group` shows `"?"` for open member slots, `ErrorScreen` shows
      exactly the `title`/`body` props with no other text).
- [ ] Implement each screen as a small function component.
- [ ] Run `npx vitest run liff-template/app/screens` green.
- [ ] Commit: `feat: add the 12 LIFF template screens (presentational)`.

(This task is large — split into three commits if convenient: shared/simple screens
(`Loading`/`Intro`/`FriendGate`/`OpenInLine`/`ErrorScreen`/`Rewards`), quiz-flow screens
(`Question`/`Summary`), and duo/group screens (`Invited`/`Matching`/`PairResult`/`Group`) — each still
under this one task heading, just committed separately for reviewability.)

---

### Task 11: Wire the solo flow end-to-end + `lib/liff/client.ts` stub

**Files:** Create `liff-template/app/page.tsx`, `liff-template/app/layout.tsx`,
`liff-template/lib/liff/client.ts`, `liff-template/app/api/answer/route.ts`,
`liff-template/app/page.test.tsx`, `liff-template/lib/liff/client.test.ts`.

**Interfaces:** `lib/liff/client.ts` exports `isInClient()`, `getProfile(): Promise<{displayName:
string} | null>`, `isFriend(): Promise<boolean>` — solo-mode call sites treat these as always
`true`/a stub profile in dev (documented inline as the exact spot to swap in real `@line/liff` calls);
`app/api/answer/route.ts` — `POST`, body `{ answers: Answer[] }`, loads `config/quiz.config.json` via
`lib/config.ts`, runs `validateAnswers`/`resolveSolo` (or `resolvePair`/group equivalents when
`quiz.mode !== 'solo'`, reusing the same route for now — full duo/group route wiring is out of scope
for this task per design doc §2, this task's route only needs to fully work for `mode: 'solo'`) against
`lib/engine/quiz.ts`, returns the resolved result.

- [ ] Write a failing `app/page.test.tsx`: mounts `page.tsx` with a solo sample config (via test
      double for `lib/liff/client.ts`), walks through `Loading → Intro → Question (x N) → Summary →
      Rewards`, asserting the right screen/props at each step.
- [ ] Write a failing `app/api/answer/route.ts` test: POSTs answers, asserts the JSON response
      contains the correct `resultCode` for a known config+answer combination.
- [ ] Implement `page.tsx` as a `useState<Screen>` state machine per design doc §7.1, `lib/liff/client.ts`
      as the stub, and the API route.
- [ ] Run tests green.
- [ ] Commit: `feat: wire solo LIFF flow end-to-end in liff-template`.

---

### Task 12: `lib/architecture.test.ts` — cover `liff-template/lib/engine` + `liff-template/lib/render`

**Files:** Modify `lib/architecture.test.ts`.

- [ ] Add `'liff-template/lib/engine'` and `'liff-template/lib/render'` to `PURE_DIRS`.
- [ ] Run `npx vitest run lib/architecture.test.ts` — expect PASS (Tasks 4–8 were already written
      pure by construction; this task is the regression guard, not new production code).
- [ ] Commit: `test: extend architecture purity guard to liff-template engine/render`.

---

### Task 13: `lib/liffExport/` — assemble + zip

**Files:** Create `lib/liffExport/assemble.ts`, `lib/liffExport/assemble.test.ts`,
`lib/liffExport/zip.ts`, `lib/liffExport/zip.test.ts`. Modify `package.json` (add `archiver` +
`@types/archiver`).

**Interfaces:**
- `assembleTemplateFiles(config: QuizConfig): { path: string; content: Buffer }[]` — reads every file
  under `liff-template/` (skip `node_modules`, `.next`, `.data`), replaces
  `config/quiz.config.sample.json`'s content at path `config/quiz.config.json` with
  `JSON.stringify({ schemaVersion: 1, quiz: config }, null, 2)`, and drops the original
  `config/quiz.config.sample.json` entry from the output (the exported project ships only the real
  config, not the sample). Throws a plain `Error` listing missing `templateCopy` fields if
  `config.templateCopy` fails the mode-conditional rules from Task 1 (re-run `QuizConfig.safeParse`
  and surface the flattened issues).
- `zipFiles(files: { path: string; content: Buffer }[]): Readable` — wraps `archiver('zip')`.

- [ ] Write failing tests: `assembleTemplateFiles` with a fully-valid config produces a file list
      containing `package.json`, `config/quiz.config.json` (parseable, `schemaVersion: 1`, `quiz`
      equal to the input config) and no `config/quiz.config.sample.json`; an incomplete `templateCopy`
      throws with a message naming the missing field; `zipFiles` on a small fixed file list produces a
      buffer that (round-tripped through a zip-reading step in the test, e.g. `unzipper` or reading the
      `archiver` output back with the same library used to write, or simply asserting non-trivial byte
      length + zip magic bytes `PK\x03\x04`) is a valid zip.
- [ ] Implement both. Add `archiver`/`@types/archiver` to `package.json` dependencies.
- [ ] Run tests green.
- [ ] Commit: `feat: add liffExport assemble + zip pipeline`.

---

### Task 14: Admin UI — `TemplateCopyForm` + export route + parity test

**Files:** Create `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/template/page.tsx`,
`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/template/TemplateCopyForm.tsx` (+ `.test.tsx`),
`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/export/route.ts`,
`tests/quiz-export.integration.test.ts`.

**Interfaces:** `TemplateCopyForm` follows the exact same pattern as `RepliesForm.tsx` — single
client-side draft of the whole `QuizConfig`, submits via the existing `saveQuizConfigAction`, edits
only `templateCopy`. Every `TemplateCopy` leaf field gets one input tagged
`data-field="templateCopy.<path>"`. `export/route.ts` — `GET`, `requireRole('configurator')` +
`requireDraftCampaign`-style guard reused from `actions.ts` (export should be allowed regardless of
draft/live status — read-only, so only the role check applies), loads `activity.input_config`,
`QuizConfig.parse`s it, calls `assembleTemplateFiles` + `zipFiles` from Task 13, streams the response
with `Content-Disposition: attachment`.

- [ ] Write failing `TemplateCopyForm.test.tsx` including the parity test named in design doc §10:
      walk `TemplateCopy`'s Zod shape (via `._def.shape()` recursively) and assert a `data-field`
      element exists in the rendered form for every leaf path.
- [ ] Implement `TemplateCopyForm.tsx` + `page.tsx` (mirror `replies/page.tsx`'s data-loading shape).
- [ ] Write failing `tests/quiz-export.integration.test.ts`: seed a full valid quiz activity (solo,
      with `templateCopy`) through real DB tables (same seed pattern as `tests/quiz-groups.integration.test.ts`),
      hit the export route, assert response is a valid zip whose `config/quiz.config.json` entry
      parses via `liff-template/lib/schema.ts`'s `TemplateConfig` (import directly — this is the one
      place LineKit's tests are allowed to import from `liff-template/`, since it's asserting the
      contract between the two, not shipping a runtime dependency) and matches the seeded config.
- [ ] Implement `export/route.ts`.
- [ ] Run all new tests green.
- [ ] Commit: `feat: add TemplateCopy admin form + export zip endpoint`.

---

### Task 15: Whole-branch regression pass

**Files:** None (verification only).

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run` (full unit suite, all tasks' tests included)
- [ ] `npx vitest run tests/quiz-export.integration.test.ts` (needs local Postgres + `npm run db:reset`
      if schema changed — it hasn't in this slice, no new migration, so a normal `test:integration` run
      suffices)
- [ ] `npx next build` (LineKit's own build — confirms the new admin screens/routes compile; does
      **not** build `liff-template/`, which is intentionally never built inside this repo)
- [ ] Manually inspect one exported zip's file tree end-to-end against design doc §3's diagram
- [ ] No commit — this task is a checkpoint; if anything fails, fix forward with a new commit and
      re-run this task.
