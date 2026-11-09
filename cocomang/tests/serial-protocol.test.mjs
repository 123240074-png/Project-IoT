import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceLine, parseRfidLine } from '../dist/serial-protocol.mjs';

const good = {
  type: 'measurement', device: 'smartheight-esp32', sequence: 1, status: 'ok',
  distanceCm: 45.2, heightCm: 174.8, referenceHeightCm: 220, offsetCm: 0,
  validSamples: 5, buzzerAlarm: false, calibrated: false,
};

test('ignores ordinary serial text and unrelated JSON', () => {
  assert.equal(parseDeviceLine('SMART HEIGHT START'), null);
  assert.equal(parseDeviceLine('{"type":"status","device":"smartheight-esp32"}'), null);
});

test('parses a valid ESP32 measurement JSON line', () => {
  const frame = parseDeviceLine(JSON.stringify(good));
  assert.equal(frame.status, 'ok');
  assert.equal(frame.heightCm, 174.8);
  assert.equal(frame.device, 'smartheight-esp32');
  assert.ok(frame.receivedAt);
});

test('marks malformed measurement fields as invalid instead of saving them', () => {
  const frame = parseDeviceLine(JSON.stringify({ ...good, heightCm: 500 }));
  assert.equal(frame.status, 'invalid');
  assert.match(frame.error, /tinggi/);
});

test('parses RFID detection serial lines from reader 1 and reader 2', () => {
  const line1 = '[RFID 1 - PENDAFTARAN] Kartu Terdeteksi! UID: 04:A1:B2:C3 (Panjang: 4 byte)';
  const parsed1 = parseRfidLine(line1);
  assert.notEqual(parsed1, null);
  assert.equal(parsed1.reader, 1);
  assert.equal(parsed1.label, 'PENDAFTARAN');
  assert.equal(parsed1.uid, '04:A1:B2:C3');

  const line2 = '[RFID 2 - AKSES WAHANA] Kartu Terdeteksi! UID: 5A:B6:C7:D8 (Panjang: 4 byte)';
  const parsed2 = parseRfidLine(line2);
  assert.notEqual(parsed2, null);
  assert.equal(parsed2.reader, 2);
  assert.equal(parsed2.label, 'AKSES WAHANA');
  assert.equal(parsed2.uid, '5A:B6:C7:D8');

  assert.equal(parseRfidLine('Random serial text'), null);
});
