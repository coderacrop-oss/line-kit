import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATE_SCHEMA_VERSION, TemplateConfig } from './schema'

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
 * Reads config/quiz.config.json off disk (the file the export step stamps in), or falls back
 * to config/quiz.config.sample.json for local development of this template folder before it's
 * ever been exported from a real campaign. Not pure (touches fs) — deliberately outside
 * lib/engine/ and lib/render/, which must stay pure.
 */
export function readTemplateConfigFromDisk(configDir = join(__dirname, '..', 'config')): TemplateConfig {
  const realPath = join(configDir, 'quiz.config.json')
  const samplePath = join(configDir, 'quiz.config.sample.json')
  const path = existsSync(realPath) ? realPath : samplePath
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return loadTemplateConfig(raw)
}
