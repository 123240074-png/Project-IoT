import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MQTT_CONFIG,
  getMqttTopics,
  parseTelemetryMessage,
  parseRfidMessage,
  buildBuzzerPayload,
  buildMeasurePayload,
} from '../dist/mqtt-protocol.mjs';

const sampleTelemetry = {
  type: 'measurement',
  device: 'smartheight-esp32',
  sequence: 42,
  status: 'ok',
  distanceCm: 45.2,
  heightCm: 174.8,
  referenceHeightCm: 220,
  offsetCm: 0,
  validSamples: 5,
  buzzerAlarm: false,
  calibrated: false,
};

test('generates correct hierarchical MQTT topics', () => {
  const topics = getMqttTopics('cocomang');
  assert.equal(topics.telemetry, 'cocomang/telemetry');
  assert.equal(topics.rfidReader1, 'cocomang/rfid/reader1');
  assert.equal(topics.rfidReader2, 'cocomang/rfid/reader2');
  assert.equal(topics.buzzerCmd, 'cocomang/cmd/buzzer');
  assert.equal(topics.measureCmd, 'cocomang/cmd/measure');
  assert.equal(topics.deviceStatus, 'cocomang/status');

  const defaultTopics = getMqttTopics();
  assert.equal(defaultTopics.telemetry, 'cocomang/telemetry');
});

test('parses valid telemetry JSON payload', () => {
  const parsed = parseTelemetryMessage(JSON.stringify(sampleTelemetry));
  assert.notEqual(parsed, null);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.heightCm, 174.8);
  assert.equal(parsed.sequence, 42);
  assert.ok(parsed.receivedAt);
});

test('rejects non-measurement or malformed telemetry payload', () => {
  assert.equal(parseTelemetryMessage(''), null);
  assert.equal(parseTelemetryMessage('Hello MQTT'), null);
  assert.equal(parseTelemetryMessage('{"type":"unknown"}'), null);

  const invalid = parseTelemetryMessage(JSON.stringify({ ...sampleTelemetry, heightCm: 400 }));
  assert.equal(invalid.status, 'invalid');
  assert.match(invalid.error, /tinggi/);
});

test('parses RFID Reader 1 JSON payload', () => {
  const payload = JSON.stringify({
    reader: 1,
    uid: '04:A1:B2:C3',
    bytes: 4,
  });
  const parsed = parseRfidMessage(payload);
  assert.notEqual(parsed, null);
  assert.equal(parsed.reader, 1);
  assert.equal(parsed.uid, '04:A1:B2:C3');
  assert.equal(parsed.bytes, 4);
  assert.equal(parsed.label, 'PENDAFTARAN');
});

test('parses RFID Reader 2 JSON payload', () => {
  const payload = JSON.stringify({
    reader: 2,
    uid: '5A:B6:C7:D8',
    bytes: 4,
  });
  const parsed = parseRfidMessage(payload, 2);
  assert.notEqual(parsed, null);
  assert.equal(parsed.reader, 2);
  assert.equal(parsed.uid, '5A:B6:C7:D8');
  assert.equal(parsed.bytes, 4);
  assert.equal(parsed.label, 'AKSES WAHANA');
});

test('parses raw string UID as fallback in parseRfidMessage', () => {
  const parsed = parseRfidMessage('04a1b2c3', 1);
  assert.notEqual(parsed, null);
  assert.equal(parsed.uid, '04:A1:B2:C3');
  assert.equal(parsed.reader, 1);
});

test('validates buzzer command payload builder', () => {
  assert.equal(buildBuzzerPayload('b'), 'b');
  assert.equal(buildBuzzerPayload('B'), 'b');
  assert.equal(buildBuzzerPayload('n'), 'n');
  assert.equal(buildBuzzerPayload('N'), 'n');
  assert.equal(buildBuzzerPayload('x'), null);
  assert.equal(buildBuzzerPayload(''), null);
});

test('validates measure command payload builder and calibrated 20-sample telemetry', () => {
  assert.equal(buildMeasurePayload(), 'start');
  assert.equal(buildMeasurePayload('start'), 'start');
  assert.equal(buildMeasurePayload('measure'), 'start');
  assert.equal(buildMeasurePayload('Y'), 'start');
  assert.equal(buildMeasurePayload('invalid'), null);

  const calibratedPayload = JSON.stringify({
    ...sampleTelemetry,
    referenceHeightCm: 200,
    offsetCm: 10,
    validSamples: 20,
    calibrated: true,
  });
  const parsed = parseTelemetryMessage(calibratedPayload);
  assert.notEqual(parsed, null);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.calibrated, true);
  assert.equal(parsed.validSamples, 20);
  assert.equal(parsed.offsetCm, 10);
});
