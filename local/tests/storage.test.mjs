import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, Sessions } from '../dist/library.mjs';
import { temporary } from './helpers.mjs';

test('SQLite persists state and receipts; retries conflict and deletion cascades', t => {
  const path = join(temporary(t), 'state.sqlite');
  let store = new Store(path), run = store.open(0);
  const first = store.set(run.run_id, 5, 'first');
  for (let i = 0; i < 300; i++) store.set(run.run_id, i, `change_${i}`);
  store.close(); store = new Store(path); t.after(() => store.close());
  assert.equal(store.get(run.run_id).revision, 301);
  assert.deepEqual(store.set(run.run_id, 5, 'first'), { ...first, duplicate: true });
  assert.throws(() => store.set(run.run_id, 6, 'first'), { code: 'OPERATION_CONFLICT' });
  assert.equal(store.get(run.run_id).value, 299);
  store.delete(run.run_id); store.delete(run.run_id);
  assert.throws(() => store.get(run.run_id), { code: 'RUN_NOT_FOUND' });
  assert.equal(store.db.prepare('SELECT count(*) as n FROM operations').get().n, 0);
});
test('failed receipt write rolls back state, and publishes only after commit', t => {
  const store = new Store(join(temporary(t), 'state.sqlite')); t.after(() => store.close());
  const observed = [], sessions = new Sessions(store, (id, frame) => {
    assert.equal(store.get(id).revision, frame.revision);
    assert.equal(store.db.prepare('SELECT count(*) as n FROM operations WHERE run_id=?').get(id).n, frame.revision);
    observed.push(frame);
  }, () => {});
  const run = sessions.open({});
  store.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.throws(() => sessions.set({ run_id: run.run_id, value: 5, operation_id: 'failure' }));
  assert.equal(store.get(run.run_id).revision, 0); assert.equal(observed.length, 0);
  store.db.exec('DROP TRIGGER fail_receipt');
  sessions.set({ run_id: run.run_id, value: 5, operation_id: 'success' });
  sessions.set({ run_id: run.run_id, value: 5, operation_id: 'success' });
  assert.equal(observed.length, 1);
  for (const value of [-1000, 1000, 1.1, '2']) assert.throws(() => sessions.set({ run_id: run.run_id, value, operation_id: 'bad' }));
});
test('pagination is bounded and deterministic, including equal timestamps', t => {
  const store = new Store(join(temporary(t), 'state.sqlite')); t.after(() => store.close());
  for (let i = 0; i < 7; i++) store.open(i);
  store.db.exec('UPDATE runs SET updated_at=1');
  const ids = []; let cursor;
  do { const page = store.list(2, cursor); ids.push(...page.runs.map(r => r.run_id)); cursor = page.next_cursor; } while (cursor);
  assert.equal(new Set(ids).size, 7); assert.deepEqual(ids, [...ids].sort().reverse());
  assert.throws(() => store.list(2, 'bad'), { code: 'INVALID_MESSAGE' });
});
test('newer schema and failed migrations preserve existing data', t => {
  const path = join(temporary(t), 'state.sqlite');
  let db = new DatabaseSync(path); db.exec('CREATE TABLE runs(value); INSERT INTO runs VALUES (42); PRAGMA user_version=99;'); db.close();
  assert.throws(() => new Store(path), /newer CoDesk/);
  db = new DatabaseSync(path); assert.equal(db.prepare('SELECT value FROM runs').get().value, 42);
  db.exec('PRAGMA user_version=0;'); db.close();
  assert.throws(() => new Store(path), /already exists/);
  db = new DatabaseSync(path); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare('SELECT value FROM runs').get().value, 42);
  assert.equal(db.prepare("SELECT count(*) as n FROM sqlite_master WHERE name='operations'").get().n, 0);
});
