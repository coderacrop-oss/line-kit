import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATE_SCHEMA_VERSION, TemplateConfig } from './schema'
import sampleConfig from '../config/quiz.config.sample.json'

/**
 * Thrown when config/quiz.config.json's schemaVersion doesn't match what this template's
 * code was written against — distinct from a normal Zod validation error so callers (and the
 * message itself) can tell "wrong shape entirely" apart from "this specific field is invalid".
 */
export class SchemaVersionMismatchError extends Error {
  constructor(found: unknown) {
    super(
      `LIFF template config schemaVersion mismatch: config file is v${JSON.stringify(found)}, ` +
      `this template code expects v${TEMPLATE_SCHEMA_VERSION}.\n` +
      `Re-export this campaign from LineKit, or update this template's code to match.`,
    )
    this.name = 'SchemaVersionMismatchError'
  }
}

/**
 * Validates a raw parsed-JSON value against TemplateConfig. Checks schemaVersion first and
 * throws SchemaVersionMismatchError specifically on mismatch (design doc §4.2) — deliberately
 * does not attempt to auto-migrate, only to fail loudly and clearly.
 */
export function loadTemplateConfig(raw: unknown): TemplateConfig {
  const found = raw && typeof raw === 'object' && 'schemaVersion' in raw
    ? (raw as { schemaVersion: unknown }).schemaVersion
    : undefined
  if (found !== TEMPLATE_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(found)
  }
  return TemplateConfig.parse(raw)
}

/**
 * Reads config/quiz.config.json off disk (the file the export step stamps in) if present, or
 * falls back to config/quiz.config.sample.json for local development of this template folder
 * before it's ever been exported from a real campaign.
 *
 * The real config is read from disk via `configDir` (defaults to `process.cwd()`-relative,
 * correct for an actually-deployed instance of this standalone app, where the process runs
 * with this project as its cwd) because it's genuinely dynamic per-deployment content that
 * doesn't exist at build time. The sample config is a static `import` instead of a disk read —
 * it needs to resolve correctly regardless of where the process's cwd happens to be (e.g. when
 * this repo's own root-level test runner collects and runs this file's tests from the monorepo
 * root, not from this project's own root), and bundlers resolve `import`/`require` of JSON
 * relative to *this source file* at build time, which a runtime `__dirname`/`cwd()`-based path
 * cannot do once Next.js relocates the compiled file under `.next/server/...`.
 *
 * Not pure (touches fs for the real-config path) — deliberately outside lib/engine/ and
 * lib/render/, which must stay pure.
 */
export function readTemplateConfigFromDisk(configDir = join(process.cwd(), 'config')): TemplateConfig {
  const realPath = join(configDir, 'quiz.config.json')
  const raw = existsSync(realPath) ? JSON.parse(readFileSync(realPath, 'utf8')) : sampleConfig
  return loadTemplateConfig(raw)
}
