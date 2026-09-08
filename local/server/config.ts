import { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
export const settingsSchema = z.object({
  pluginName: z.string().max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  installationId: z.uuid(), dataDir: z.string().refine(isAbsolute),
  cloudflaredPath: z.string().refine(isAbsolute), nodePath: z.string().refine(isAbsolute),
}).strict()
export type Settings = z.infer<typeof settingsSchema>
export const readSettings = (path: string): Settings => settingsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700)
}
export function atomicJson(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, path)
}
export const metadataPath = (settings: Settings) => join(settings.dataDir, 'runtime.json')
export class AppError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
export function publicError(error: unknown) {
  return error instanceof AppError ? { code: error.code, message: error.message }
    : { code: 'RUNTIME_UNAVAILABLE', message: 'The local runtime could not complete this request. Run npm run diagnostics.' }
}
