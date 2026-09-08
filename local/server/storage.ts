import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from './config'
export type Run = { run_id: string; value: number; revision: number; created_at: number; updated_at: number }
type Receipt = { run_id: string; value: number; revision: number }
const cursorSchema = z.object({ time: z.number().int().nonnegative(), id: z.uuid() }).strict()

// Synchronous transactions in one owning process cannot yield between reading
// a revision and committing its value and idempotency receipt.
export class Store {
  db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
      if (version > 1) throw new AppError('RUNTIME_UNAVAILABLE', 'This database requires a newer CoDesk Local version. No data was changed.')
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      if (version === 0) this.transaction(() => {
        this.db.exec(`CREATE TABLE runs (
          run_id TEXT PRIMARY KEY, value INTEGER NOT NULL, revision INTEGER NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE INDEX runs_recent ON runs(updated_at DESC, run_id DESC);
          CREATE TABLE operations (
          run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
          operation_id TEXT NOT NULL, value INTEGER NOT NULL, revision INTEGER NOT NULL,
          PRIMARY KEY(run_id, operation_id)); PRAGMA user_version=1;`)
      })
    } catch (error) { this.db.close(); throw error }
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  get(runId: string): Run {
    const row = this.db.prepare('SELECT * FROM runs WHERE run_id=?').get(runId)
    if (!row) throw new AppError('RUN_NOT_FOUND', 'This run does not exist. Use list_runs or explicitly open a new run.')
    return row as Run
  }
  open(initialValue: number): Run {
    const id = randomUUID(), now = Date.now()
    this.db.prepare('INSERT INTO runs VALUES (?, ?, 0, ?, ?)').run(id, initialValue, now, now)
    return this.get(id)
  }
  set(runId: string, value: number, operationId: string): Receipt & { duplicate: boolean } {
    return this.transaction(() => {
      const run = this.get(runId)
      const previous = this.db.prepare('SELECT run_id, value, revision FROM operations WHERE run_id=? AND operation_id=?')
        .get(runId, operationId) as Receipt | undefined
      if (previous) {
        if (previous.value !== value) throw new AppError('OPERATION_CONFLICT', 'This operation ID was already used with another value.')
        return { ...previous, duplicate: true }
      }
      if (run.revision >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_MESSAGE', 'The revision limit was reached. Open a new run.')
      const receipt = { run_id: runId, value, revision: run.revision + 1 }
      this.db.prepare('UPDATE runs SET value=?, revision=?, updated_at=? WHERE run_id=?')
        .run(value, receipt.revision, Math.max(Date.now(), run.updated_at + 1), runId)
      this.db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?)').run(runId, operationId, value, receipt.revision)
      return { ...receipt, duplicate: false }
    })
  }
  list(limit: number, cursor?: string) {
    let after: z.infer<typeof cursorSchema> | undefined
    if (cursor) {
      try { after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString())) }
      catch { throw new AppError('INVALID_MESSAGE', 'Invalid list cursor. Start again without a cursor.') }
    }
    const rows = (after
      ? this.db.prepare('SELECT * FROM runs WHERE (updated_at, run_id) < (?, ?) ORDER BY updated_at DESC, run_id DESC LIMIT ?')
        .all(after.time, after.id, limit + 1)
      : this.db.prepare('SELECT * FROM runs ORDER BY updated_at DESC, run_id DESC LIMIT ?').all(limit + 1)) as Run[]
    const runs = rows.slice(0, limit), last = runs.at(-1)
    return { runs, next_cursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ time: last.updated_at, id: last.run_id })).toString('base64url') : null }
  }
  delete(runId: string) {
    this.db.prepare('DELETE FROM runs WHERE run_id=?').run(runId)
    return { run_id: runId, deleted: true }
  }
  close() { this.db.close() }
}
