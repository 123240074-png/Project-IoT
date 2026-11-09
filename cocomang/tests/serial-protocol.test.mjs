import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceLine } from '../dist/serial-protocol.mjs';

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
