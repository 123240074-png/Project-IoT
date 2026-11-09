import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_TESTS_STORAGE_KEY,
  appendObjectTest,
  createEmptyObjectTests,
  createObjectTestResult,
  loadObjectTests,
  objectTestsCsv,
  objectTestsCsvRows,
  saveObjectTests,
  validateObjectTest,
} from '../dist/object-tests.mjs';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const input = {
  targetDistanceCm: 40,
  actualDistanceCm: 39.8,
  measuredDistanceCm: 40.2,
  detectionStatus: 'IN_RANGE',
  stabilityStatus: 'STABLE',
  stabilityRangeCm: 0.7,
  sampleCount: 5,
  durationMs: 1800,
  targetMinCm: 20,
  targetMaxCm: 60,
  toleranceCm: 2,
  sequence: 12,
  calibrated: false,
};

test('creates a test result with error derived from measured minus actual distance', () => {
  const result = createObjectTestResult(input, '2026-11-09T10:00:00.000Z');
  assert.equal(result.errorCm, 0.4);
  assert.equal(result.measuredDistanceCm, 40.2);
  assert.equal(result.actualDistanceCm, 39.8);
  assert.equal(result.capturedAt, '2026-11-09T10:00:00.000Z');
  assert.match(result.id, /^object-test-/);
});

test('does not accept an actual distance outside 1-400 cm', () => {
  assert.equal(validateObjectTest({ ...input, actualDistanceCm: 0 }), 'Jarak aktual harus 1-400 cm.');
  assert.equal(validateObjectTest({ ...input, targetDistanceCm: 401 }), 'Jarak target harus 1-400 cm.');
});

test('allows an invalid echo snapshot without inventing a measured distance or error', () => {
  const result = createObjectTestResult({
    ...input,
    measuredDistanceCm: null,
    detectionStatus: 'INVALID',
    stabilityStatus: 'INVALID',
    stabilityRangeCm: null,
    sampleCount: 0,
  });
  assert.equal(result.measuredDistanceCm, null);
  assert.equal(result.errorCm, null);
});

test('loads an empty dataset when storage has no object test key', () => {
  const data = loadObjectTests(memoryStorage());
  assert.deepEqual(data, createEmptyObjectTests());
});

test('persists explicit test snapshots and keeps newest first', () => {
  const storage = memoryStorage();
  const first = appendObjectTest(createObjectTestResult(input, '2026-11-09T10:00:00.000Z'), storage);
  const second = appendObjectTest({
    ...input,
    targetDistanceCm: 50,
    actualDistanceCm: 49.9,
    measuredDistanceCm: 50.3,
  }, storage);
  assert.equal(first.results.length, 1);
  assert.equal(second.results.length, 2);
  assert.equal(second.results[0].targetDistanceCm, 50);
  const loaded = loadObjectTests(storage);
  assert.equal(loaded.results.length, 2);
  assert.equal(JSON.parse(storage.getItem(OBJECT_TESTS_STORAGE_KEY)).schemaVersion, 1);
});

test('rejects corrupted stored datasets', () => {
  const storage = memoryStorage();
  storage.setItem(OBJECT_TESTS_STORAGE_KEY, '{"schemaVersion":1,"results":[{"id":"broken"}]}');
  assert.throws(() => loadObjectTests(storage), /tidak valid/);
});

test('rejects duplicate ids when saving', () => {
  const row = createObjectTestResult(input);
  const data = { schemaVersion: 1, results: [row, row] };
  assert.throws(() => saveObjectTests(data, memoryStorage()), /duplikat/);
});

test('produces CSV rows and a BOM-prefixed CSV export', () => {
  const row = createObjectTestResult(input);
  const rows = objectTestsCsvRows([row]);
  assert.equal(rows[0]['Target (cm)'], 40);
  assert.equal(rows[0]['Error (cm)'], 0.4);
  const csv = objectTestsCsv([row]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /Target \(cm\)/);
  assert.match(csv, /"0\.4"/);
});
