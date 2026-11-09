import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  createInitialState,
  addVisitor,
  addMember,
  deleteMember,
  recordMeasurement,
  repository,
  validateDeviceFrame,
  normalizeRfid,
  formatRfid,
  isValidRfid,
  validateMember,
} from '../dist/data.mjs';

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
  const visitor = addVisitor(state, { name: 'Member Uji', age: '18', notes: '' }, '2026-11-09T00:00:00.000Z');
  assert.equal(visitor.name, 'Member Uji');
  assert.equal(visitor.age, 18);
  assert.equal(visitor.heightCm, null);
  assert.equal('rfid' in visitor, false);
});

test('stores optional gender and weight without changing the schema version', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Member Uji', age: '27', gender: 'Perempuan', weightKg: '58.5' });
  assert.equal(visitor.gender, 'P');
  assert.equal(visitor.weightKg, 58.5);
  assert.equal(state.schemaVersion, 1);
  assert.throws(() => addVisitor(state, { name: 'Member Uji', weightKg: '400' }), /Berat badan/);
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
  const visitor = addVisitor(state, { name: 'Member Uji', age: '' });
  const entry = recordMeasurement(state, visitor.id, goodFrame, '2026-11-09T00:01:00.000Z');
  assert.equal(entry.heightCm, 171.5);
  assert.equal(entry.distanceCm, 48.5);
  assert.equal(visitor.heightCm, 171.5);
  assert.equal(state.measurements.length, 1);
  assert.equal(entry.calibrated, false);
});

test('rejects a bad frame, invalid visitor, or missing selected visitor', () => {
  const state = createInitialState();
  const visitor = addVisitor(state, { name: 'Member Uji' });
  assert.equal(validateDeviceFrame({ ...goodFrame, heightCm: 999 }) !== null, true);
  assert.throws(() => recordMeasurement(state, visitor.id, { ...goodFrame, status: 'invalid' }), /Sensor|pembacaan/);
  assert.throws(() => recordMeasurement(state, 'missing', goodFrame), /Pilih member/);
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

test('validates and formats 4-byte, 7-byte, and 10-byte RFID UIDs correctly', () => {
  assert.equal(isValidRfid('04:A1:B2:C3'), true);
  assert.equal(isValidRfid('04a1b2c3'), true);
  assert.equal(isValidRfid('04-A1-B2-C3-D4-E5-F6'), true);
  assert.equal(isValidRfid('04 A1 B2 C3 D4 E5 F6 A7 B8 C9'), true);
  assert.equal(isValidRfid('XYZ12345'), false);
  assert.equal(isValidRfid('04:A1'), false);
  assert.equal(formatRfid('04a1b2c3'), '04:A1:B2:C3');
  assert.equal(normalizeRfid('04:A1:B2:C3'), '04A1B2C3');
});

test('adds a member with valid RFID UID and links UID to measurement entry', () => {
  const state = createInitialState();
  const member = addMember(state, {
    name: 'Budi Santoso',
    rfidUid: '04:A1:B2:C3',
    age: '24',
    gender: 'L',
  });
  assert.equal(member.name, 'Budi Santoso');
  assert.equal(member.rfidUid, '04:A1:B2:C3');
  assert.equal(state.visitors.length, 1);

  const entry = recordMeasurement(state, member.id, goodFrame);
  assert.equal(entry.memberRfid, '04:A1:B2:C3');
  assert.equal(entry.visitorName, 'Budi Santoso');
});

test('prevents registering duplicate RFID card UID across members', () => {
  const state = createInitialState();
  addMember(state, { name: 'Member Pertama', rfidUid: '04:A1:B2:C3' });
  assert.throws(
    () => addMember(state, { name: 'Member Kedua', rfidUid: '04a1b2c3' }),
    /sudah digunakan/
  );
});

test('validates RFID input requirement on form registration', () => {
  const errEmpty = validateMember({ name: 'Member Uji', rfidUid: '' }, { requireRfid: true });
  assert.equal(errEmpty.rfidUid, 'UID kartu RFID wajib diisi.');

  const errInvalid = validateMember({ name: 'Member Uji', rfidUid: 'ZZ:99' }, { requireRfid: true });
  assert.match(errInvalid.rfidUid, /Format UID kartu RFID tidak valid/);
});

test('deleteMember removes member by id or rfidUid and prevents deleting unknown member', () => {
  const state = createInitialState();
  const m1 = addMember(state, { name: 'Member 1', rfidUid: '04:A1:B2:C3' });
  const m2 = addMember(state, { name: 'Member 2', rfidUid: '10:20:30:40' });
  assert.equal(state.visitors.length, 2);

  // Delete by id
  const removed1 = deleteMember(state, m1.id);
  assert.equal(removed1.name, 'Member 1');
  assert.equal(state.visitors.length, 1);

  // Delete by rfidUid
  const removed2 = deleteMember(state, '10:20:30:40');
  assert.equal(removed2.name, 'Member 2');
  assert.equal(state.visitors.length, 0);

  // Delete non-existent
  assert.throws(() => deleteMember(state, 'unknown-id'), /Member tidak ditemukan/);
});
