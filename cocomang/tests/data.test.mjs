import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, seedState, repository, validateVisitor, evaluateAccess, recordAccess, csvExport, normalizeRfid } from '../dist/data.mjs';

let storage;
beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
});
test('initial state contains honest demo records and distinct ride limits', () => {
  const state = seedState();
  assert.equal(state.visitors.length, 8); assert.equal(state.rides.length, 6); assert.equal(state.logs.length, 5);
  assert.ok(state.visitors.every(visitor => visitor.demo));
  assert.equal(state.visitors.filter(visitor => visitor.height === null).length, 1);
  assert.equal(new Set(state.rides.map(ride => ride.minHeight)).size, 6);
});
test('visitor validates independent manual data and normalized UID uniqueness', () => {
  const state = seedState(); const visitor = state.visitors[0];
  assert.deepEqual(validateVisitor(visitor, state.visitors, visitor.id), {});
  assert.ok(validateVisitor({ ...visitor, rfid: 'a1:b2:c3:01' }, state.visitors).rfid);
  assert.equal(normalizeRfid('a1 b2-c3:01'), 'A1B2C301');
  assert.ok(validateVisitor({ ...visitor, age: 0, weight: 251, rfid: 'bad!', name: ' ' }).age);
  assert.ok(validateVisitor({ ...visitor, weight: '' }).weight);
  assert.ok(validateVisitor({ ...visitor, phone: 'not-a-phone' }).phone);
});
test('RFID validates 4-byte, 7-byte and 10-byte identifiers', () => {
  const visitor = seedState().visitors[0];
  for (const rfid of ['ABCDEF01', 'ABCDEF01234567', 'ABCDEF0123456789ABCD']) assert.equal(validateVisitor({ ...visitor, rfid }).rfid, undefined);
  assert.ok(validateVisitor({ ...visitor, rfid: 'ABCDEF0123' }).rfid);
});
test('minimum height is inclusive and one tenth below is denied', () => {
  const { visitors, rides } = seedState();
  const ride = rides[5];
  assert.equal(evaluateAccess({ ...visitors[0], height: 140 }, ride).allowed, true);
  assert.equal(evaluateAccess({ ...visitors[0], height: 139.9 }, ride).allowed, false);
});
test('missing measurement, unknown member and maintenance reject access', () => {
  const { visitors, rides } = seedState();
  assert.equal(evaluateAccess(visitors[7], rides[0]).allowed, false);
  assert.equal(evaluateAccess(null, rides[0]).allowed, false);
  assert.equal(evaluateAccess(visitors[0], rides[4]).allowed, false);
  assert.equal(evaluateAccess({ ...visitors[0], measuredAt: null }, rides[0]).allowed, false);
});
test('weight applies only when the ride has configured a limit', () => {
  const { visitors, rides } = seedState();
  assert.equal(evaluateAccess({ ...visitors[0], weight: 120 }, rides[0]).allowed, true);
  assert.equal(evaluateAccess({ ...visitors[0], weight: 110 }, rides[5]).allowed, true);
  assert.equal(evaluateAccess({ ...visitors[0], weight: 110.1 }, rides[5]).allowed, false);
});
test('access recording captures a decision snapshot and rejects unknown IDs', () => {
  const state = seedState();
  const entry = recordAccess(state, 'visitor-2', 'coaster');
  assert.equal(state.logs.length, 6); assert.equal(state.logs[0], entry); assert.equal(entry.allowed, false);
  state.visitors[1].height = 160;
  assert.equal(entry.height, 138); assert.equal(entry.allowed, false);
  assert.throws(() => recordAccess(state, 'missing', 'coaster'));
});
test('repository seeds once and persists updated visitor data', () => {
  const state = repository.load();
  state.visitors[0].weight = 55;
  repository.save(state);
  assert.equal(repository.load().visitors[0].weight, 55);
  assert.equal(repository.load().visitors[0].createdAt, state.visitors[0].createdAt);
});
test('corrupt JSON is reported and never overwritten', () => {
  storage.set(STORAGE_KEY, '{broken');
  assert.throws(() => repository.load(), /tidak dapat dibaca/);
  assert.equal(storage.get(STORAGE_KEY), '{broken');
});
test('unknown schema and malformed records are rejected without overwrite', () => {
  const state = seedState(); state.schemaVersion = 2;
  storage.set(STORAGE_KEY, JSON.stringify(state));
  assert.throws(() => repository.load(), /tidak valid/);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).schemaVersion, 2);
  state.schemaVersion = 1; state.visitors[0].height = 999;
  assert.throws(() => repository.save(state), /tidak valid/);
});
test('unavailable and exhausted storage have actionable errors', () => {
  globalThis.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.throws(() => repository.load(), /tidak tersedia/);
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => repository.save(seedState()), /belum tersimpan/);
});
test('CSV quotes multiline values and neutralizes spreadsheet formulas', () => {
  const csv = csvExport([{ name: '=SUM(1,1)', notes: 'line 1\n"line 2"', age: 12 }, { name: ' \t@bad', notes: 'normal', age: 21 }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=SUM(1,1)"'));
  assert.ok(csv.includes('"\' \t@bad"'));
  assert.ok(csv.includes('"line 1\n""line 2"""'));
  assert.equal(csvExport([]), '\uFEFF');
});
