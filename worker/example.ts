import { initialValue, mutationInput, type ExampleValue } from '../src/example';
import { PROTOCOL_VERSION, type StateMessage } from '../src/contracts/plugin';
import { WebSocketRelay, expired } from './realtime';

type Receipt = { run_id: string; value: ExampleValue; revision: number };
type SavedRun = { schemaVersion: number; runId: string; value: ExampleValue; revision: number;
  capabilityHash: string; expiresAt: number; operations: Map<string, Receipt> };
const state = (run: SavedRun): StateMessage<ExampleValue> => ({ schemaVersion: PROTOCOL_VERSION, type: 'state',
  runId: run.runId, value: run.value, revision: run.revision });
const summary = (run: SavedRun) => ({ run_id: run.runId, value: run.value, revision: run.revision,
  expiresAt: new Date(run.expiresAt).toISOString() });

// Application behavior and short-lived storage; the relay knows nothing about the value schema.
export class ExampleSession extends WebSocketRelay {
  private async read(runId: string) {
    const run = await this.ctx.storage.get<SavedRun>('run');
    return run?.schemaVersion === PROTOCOL_VERSION && run.runId === runId && run.expiresAt > Date.now() ? run : undefined;
  }
  protected async getSnapshot(runId: string) {
    const run = await this.read(runId);
    return run ? { capabilityHash: run.capabilityHash, message: state(run) } : undefined;
  }
  async open(runId: string, capabilityHash: string) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('run')) throw new Error('Run already initialized');
      const run: SavedRun = { schemaVersion: PROTOCOL_VERSION, runId, value: initialValue, revision: 0,
        capabilityHash, expiresAt: Date.now() + 60 * 60 * 1000, operations: new Map() };
      await this.ctx.storage.put('run', run);
      await this.ctx.storage.setAlarm(run.expiresAt);
      return summary(run);
    });
  }
  async set(input: unknown) {
    const parsed = mutationInput.safeParse(input);
    if (!parsed.success) return { error: { code: 'INVALID_MESSAGE', message: 'Invalid state mutation.' } };
    const { run_id, value, operation_id } = parsed.data;
    return this.ctx.blockConcurrencyWhile(async () => {
      const run = await this.read(run_id);
      if (!run) return expired();
      const previous = run.operations.get(operation_id);
      if (previous) return previous.value === value ? { ...previous, duplicate: true }
        : { error: { code: 'OPERATION_CONFLICT', message: 'This operation ID was already used with another value.' } };
      if (run.operations.size >= 256) return { error: { code: 'OPERATION_LIMIT', message: 'This session reached 256 mutations. Explicitly reopen the plugin.' } };
      const receipt = { run_id, value, revision: run.revision + 1 };
      run.value = value;
      run.revision = receipt.revision;
      run.operations.set(operation_id, receipt);
      await this.ctx.storage.put('run', run);
      this.broadcast(state(run));
      return { ...receipt, duplicate: false };
    });
  }
  async inspect(runId: string) {
    const run = await this.read(runId);
    return run ? summary(run) : expired();
  }
}
