import { z } from 'zod';
import { SOCKET_ORIGIN } from '../plugin/config';

export const PROTOCOL_VERSION = 2;
// Replace this example value schema when introducing your own application state.
export const stateValue = z.number().int().min(-999).max(999);
export const runInput = z.object({ run_id: z.uuid() }).strict();
export const mutationInput = runInput.extend({ value: stateValue,
  operation_id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();
export const errorCodes = z.enum(['RUN_EXPIRED', 'OPERATION_LIMIT', 'OPERATION_CONFLICT',
  'INVALID_MESSAGE', 'VIEW_UNAVAILABLE']);
export const stateMessage = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal('state'), runId: z.uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), value: stateValue,
}).strict();
export const errorMessage = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION), type: z.literal('error'),
  code: errorCodes, message: z.string().max(160),
}).strict();
export const socketMessage = z.union([stateMessage, errorMessage]);
export const bootstrapSchema = z.object({ schemaVersion: z.literal(PROTOCOL_VERSION), runId: z.uuid(),
  socketUrl: z.url().max(300), capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
}).strict().refine(value => {
  const url = new URL(value.socketUrl);
  return url.origin === SOCKET_ORIGIN && !url.username && !url.password && !url.search && !url.hash
    && url.pathname === `/ws/${value.runId}`;
});
export type StateMessage = z.infer<typeof stateMessage>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newCapability() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
