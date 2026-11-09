import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, createInitialState, addVisitor, recordMeasurement, repository, validateDeviceFrame } from '../dist/data.mjs';

let storage;
beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }});
});

const goodFrame = {
  type: 'measurement', device: 'smartheight-esp32', sequence: 7, status: 'ok',
  distanceCm: 48.5, heightCm: 171.5, referenceHeightCm: 220, offsetCm: 0,
  validSamples: 5, buzzerAlarm: false, calibrated: false,
};

test('starts with empty real-data collections, not demo visitors', () => {
  const state = createInitialState();
  assert.equal(state.visitors.length, 0);
  assert.equal(state.measurements.length, 0);
  assert.equal(state.schemaVersion, 1);
});

test('adds a manual visitor without RFID', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Pengunjung Uji', age: '18', notes: '' }, '2026-11-09T00:00:00.000Z');
  assert.equal(visitor.name, 'Pengunjung Uji');
  assert.equal(visitor.age, 18);
  assert.equal(visitor.heightCm, null);
  assert.equal('rfid' in visitor, false);
});

test('stores optional gender and weight without changing the schema version', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Pengunjung Uji', age: '27', gender: 'Perempuan', weightKg: '58.5' });
  assert.equal(visitor.gender, 'P');
  assert.equal(visitor.weightKg, 58.5);
  assert.equal(state.schemaVersion, 1);
  assert.throws(() => addVisitor(state, { name: 'Pengunjung Uji', weightKg: '400' }), /Berat badan/);
});

test('loads legacy visitors that have no gender or weight fields', () => {
  storage.set(STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    visitors: [{
      id: 'visitor-legacy', name: 'Data Lama', age: null, notes: '',
      heightCm: null, measuredAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    }],
    measurements: [],
  }));
  const loaded = repository.load();
  assert.equal(loaded.visitors[0].name, 'Data Lama');
  assert.equal(loaded.visitors[0].gender, undefined);
});

test('stores only validated live readings and updates selected visitor', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Pengunjung Uji', age: '' });
  const entry = recordMeasurement(state, visitor.id, goodFrame, '2026-11-09T00:01:00.000Z');
  assert.equal(entry.heightCm, 171.5);
  assert.equal(entry.distanceCm, 48.5);
  assert.equal(visitor.heightCm, 171.5);
  assert.equal(state.measurements.length, 1);
  assert.equal(entry.calibrated, false);
});

test('rejects a bad frame, invalid visitor, or missing selected visitor', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Pengunjung Uji' });
  assert.equal(validateDeviceFrame({ ...goodFrame, heightCm: 999 }) !== null, true);
  assert.throws(() => recordMeasurement(state, visitor.id, { ...goodFrame, status: 'invalid' }), /Sensor|pembacaan/);
  assert.throws(() => recordMeasurement(state, 'missing', goodFrame), /Pilih pengunjung/);
  assert.throws(() => addVisitor(state, { name: 'A' }), /Nama harus/);
});

test('repository persists state under the live namespace', () => {
  const state = repository.load();
  const visitor = addVisitor(state, { name: 'Uji Simpan' });
  recordMeasurement(state, visitor.id, goodFrame);
  repository.save(state);
  const loaded = repository.load();
  assert.equal(loaded.measurements.length, 1);
  assert.equal(loaded.visitors[0].heightCm, 171.5);
  assert.ok(storage.has(STORAGE_KEY));
});
