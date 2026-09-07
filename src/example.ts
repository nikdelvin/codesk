import { z } from 'zod';
import { errorMessage, operationInput, stateEnvelope } from './contracts/plugin';

// Replace this module when introducing your own application state.
export const initialValue = 0;
export const stateValue = z.number().int().min(-999).max(999);
export const mutationInput = operationInput.extend({ value: stateValue });
export const stateMessage = stateEnvelope.extend({ value: stateValue });
export const socketMessage = z.union([stateMessage, errorMessage]);
export type ExampleValue = z.infer<typeof stateValue>;
