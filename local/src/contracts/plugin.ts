import { z } from 'zod'
import { runtimeContext } from '../plugin/config'
export const PROTOCOL_VERSION = 3
export const SOCKET_PROTOCOL = 'codesk.local.ws'
export const runInput = z.object({ run_id: z.uuid() }).strict()
export const openInput = z.object({ run_id: z.uuid().optional() }).strict()
export const operationInput = runInput.extend({
  operation_id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
}).strict()
export const listInput = z.object({ limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional() }).strict()
export const errorCodes = z.enum(['RUN_NOT_FOUND', 'RUN_DELETED', 'OPERATION_CONFLICT',
  'INVALID_MESSAGE', 'VIEW_UNAVAILABLE', 'TUNNEL_UNAVAILABLE', 'RESOURCE_STALE', 'RUNTIME_UNAVAILABLE'])
export const stateEnvelope = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal('state'), runId: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export const errorMessage = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION), type: z.literal('error'),
  code: errorCodes, message: z.string().max(300) }).strict()
export const bootstrapSchema = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION), runId: z.uuid(),
  socketUrl: z.url().max(300), capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/), generation: z.uuid(),
}).strict().refine(value => {
  const runtime = runtimeContext(), url = new URL(value.socketUrl)
  return runtime && value.generation === runtime.generation && url.origin === runtime.socketOrigin
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === `/ws/${value.runId}`
})
export type StateMessage<T> = z.infer<typeof stateEnvelope> & { value: T }
export type ErrorMessage = z.infer<typeof errorMessage>
export type Bootstrap = z.infer<typeof bootstrapSchema>
