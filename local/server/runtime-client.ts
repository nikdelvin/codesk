import { readFileSync, openSync, closeSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { AppError, metadataPath, privateDirectory, readSettings, type Settings } from './config'
import type { RuntimeDescriptor, RuntimeStatus } from './daemon'

const descriptorSchema = z.object({ installationId: z.uuid(), runtimeId: z.uuid(), buildHash: z.string().regex(/^[a-f0-9]{64}$/),
  controlUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
export function readDescriptor(settings: Settings): RuntimeDescriptor | null {
  try {
    const descriptor = descriptorSchema.parse(JSON.parse(readFileSync(metadataPath(settings), 'utf8')))
    return descriptor.installationId === settings.installationId ? descriptor : null
  } catch { return null }
}
export async function inspectRuntime(settings: Settings): Promise<{ descriptor: RuntimeDescriptor; status: RuntimeStatus } | null> {
  const descriptor = readDescriptor(settings)
  if (!descriptor) return null
  try {
    const response = await fetch(`${descriptor.controlUrl}/status`, {
      headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1500), redirect: 'error',
    })
    if (!response.ok) return null
    const status = await response.json() as RuntimeStatus
    if (status.runtimeId !== descriptor.runtimeId || status.installationId !== settings.installationId
      || status.buildHash !== descriptor.buildHash) return null
    return { descriptor, status }
  } catch { return null }
}
export async function request<T = unknown>(descriptor: RuntimeDescriptor, action: string, input: unknown = {}): Promise<T> {
  try {
    const response = await fetch(`${descriptor.controlUrl}/rpc`, { method: 'POST',
      headers: { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(47000), redirect: 'error' })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new AppError(result.error?.code ?? 'RUNTIME_UNAVAILABLE',
      result.error?.message ?? 'The local runtime refused the request.')
    return result.result as T
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('RUNTIME_UNAVAILABLE', 'The local runtime disconnected. Start a fresh task and resume the saved run.')
  }
}
export async function ensureRuntime(settingsPath: string, options: { directory?: string; entryPath?: string; startupMs?: number } = {}) {
  const settings = readSettings(settingsPath), directory = options.directory ?? import.meta.dirname
  const expectedBuild = JSON.parse(readFileSync(join(directory, 'build.json'), 'utf8')).buildHash
  const existing = await inspectRuntime(settings)
  if (existing) {
    if (existing.status.buildHash !== expectedBuild) throw new AppError('RUNTIME_UNAVAILABLE',
      'An older local build is running. Run npm run runtime:restart, then start a fresh task.')
    if (existing.status.phase !== 'stopping') return existing
  }
  privateDirectory(settings.dataDir)
  const logPath = join(settings.dataDir, 'runtime.log')
  try { if (statSync(logPath).size > 1024 * 1024) renameSync(logPath, `${logPath}.1`) } catch { /* No log to rotate. */ }
  const log = openSync(logPath, 'a', 0o600)
  let child
  try {
    child = spawn(settings.nodePath, [options.entryPath ?? join(directory, 'daemon.mjs'), '--serve', settingsPath], {
      detached: true, stdio: ['ignore', 'ignore', log], windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: '', NODE_TLS_REJECT_UNAUTHORIZED: '1' },
    })
  } finally { closeSync(log) }
  let startupError = false
  child.on('error', () => { startupError = true }); child.unref()
  const deadline = Date.now() + (options.startupMs ?? 10000)
  while (Date.now() < deadline && !startupError) {
    const running = await inspectRuntime(settings)
    if (running && running.status.phase !== 'stopping') {
      if (running.status.buildHash !== expectedBuild) throw new AppError('RUNTIME_UNAVAILABLE', 'Another build is running. Run npm run runtime:restart.')
      return running
    }
    await delay(75)
  }
  throw new AppError('RUNTIME_UNAVAILABLE', 'The local runtime could not start. Run npm run diagnostics; existing data was preserved.')
}
export async function connectRuntime(settingsPath: string, options: Parameters<typeof ensureRuntime>[1] = {}) {
  const running = await ensureRuntime(settingsPath, options), listeners = new Set<(status: RuntimeStatus) => void>()
  const ws = new WebSocket(`${running.descriptor.controlUrl.replace('http:', 'ws:')}/clients`, {
    headers: { Authorization: `Bearer ${running.descriptor.token}` }, handshakeTimeout: 3000,
  })
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.on('error', () => ws.terminate())
  ws.on('message', bytes => {
    try {
      const status = JSON.parse(bytes.toString()) as RuntimeStatus
      if (status.runtimeId === running.descriptor.runtimeId) {
        running.status = status
        for (const listener of listeners) listener(status)
      }
    } catch { /* Ignore malformed diagnostic notifications. */ }
  })
  return { ...running, ws, onStatus: (listener: (status: RuntimeStatus) => void) => listeners.add(listener),
    call: <T = unknown>(action: string, input: unknown = {}) => request<T>(running.descriptor, action, input),
    close: () => new Promise<void>(resolve => {
      if (ws.readyState === WebSocket.CLOSED) { resolve(); return }
      const timer = setTimeout(() => ws.terminate(), 1000).unref()
      ws.once('close', () => { clearTimeout(timer); resolve() }); ws.close()
    }),
  }
}
