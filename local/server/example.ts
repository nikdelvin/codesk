import { initialValue, mutationInput } from '../src/example'
import { listInput, openInput, runInput, PROTOCOL_VERSION } from '../src/contracts/plugin'
import { Store, type Run } from './storage'
export const state = (run: Run) => ({ schemaVersion: PROTOCOL_VERSION, type: 'state' as const,
  runId: run.run_id, value: run.value, revision: run.revision })

// The relay and process lifecycle do not know the example's numeric value schema.
export class Sessions {
  store: Store
  publish: (runId: string, message: object) => void
  closeRun: (runId: string) => void
  constructor(store: Store, publish: Sessions['publish'], closeRun: Sessions['closeRun']) {
    this.store = store; this.publish = publish; this.closeRun = closeRun
  }
  open(input: unknown) { const { run_id } = openInput.parse(input); return run_id ? this.store.get(run_id) : this.store.open(initialValue) }
  get(input: unknown) { return this.store.get(runInput.parse(input).run_id) }
  list(input: unknown) { const { limit, cursor } = listInput.parse(input); return this.store.list(limit, cursor) }
  set(input: unknown) {
    const { run_id, value, operation_id } = mutationInput.parse(input)
    const receipt = this.store.set(run_id, value, operation_id)
    if (!receipt.duplicate) this.publish(run_id, state(this.store.get(run_id)))
    return receipt
  }
  delete(input: unknown) {
    const { run_id } = runInput.parse(input), result = this.store.delete(run_id)
    this.closeRun(run_id); return result
  }
}
