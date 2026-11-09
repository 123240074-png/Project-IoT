import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceLine, parseRfidLine } from '../dist/serial-protocol.mjs';
import { DEFAULT_WOKWI_CONFIG } from '../dist/wokwi-service.mjs';

test('Wokwi config defines standard MQTT topics and public broker', () => {
  assert.equal(DEFAULT_WOKWI_CONFIG.topicTelemetry, 'cocomang/smartheight/telemetry');
  assert.equal(DEFAULT_WOKWI_CONFIG.topicRfid, 'cocomang/smartheight/rfid');
  assert.equal(DEFAULT_WOKWI_CONFIG.topicCommand, 'cocomang/smartheight/command');
  assert.match(DEFAULT_WOKWI_CONFIG.brokerUrl, /^wss?:\/\//);
});

test('parses measurement telemetry emitted from Wokwi firmware', () => {
  const wokwiPayload = '{"type":"measurement","device":"smartheight-esp32","sequence":1,"status":"ok","distanceCm":50.0,"heightCm":170.0,"referenceHeightCm":220.0,"offsetCm":0.0,"validSamples":5,"buzzerAlarm":false,"calibrated":false}';
  const frame = parseDeviceLine(wokwiPayload);

  assert.notEqual(frame, null);
  assert.equal(frame.status, 'ok');
  assert.equal(frame.heightCm, 170.0);
  assert.equal(frame.distanceCm, 50.0);
  assert.equal(frame.referenceHeightCm, 220.0);
  assert.ok(frame.receivedAt);
});

test('parses out-of-range measurement telemetry from Wokwi firmware', () => {
  const invalidWokwiPayload = '{"type":"measurement","device":"smartheight-esp32","sequence":2,"status":"invalid","error":"Di luar rentang pantulan","distanceCm":0.0,"heightCm":0.0,"referenceHeightCm":220.0,"offsetCm":0.0,"validSamples":0,"buzzerAlarm":true,"calibrated":false}';
  const frame = parseDeviceLine(invalidWokwiPayload);

  assert.notEqual(frame, null);
  assert.equal(frame.status, 'invalid');
  assert.equal(frame.sequence, 2);
  assert.match(frame.error, /Di luar rentang pantulan/);
});

test('parses RFID Reader 1 (Pendaftaran) event from Wokwi firmware', () => {
  const rfid1Line = '[RFID 1 - PENDAFTARAN] Kartu Terdeteksi! UID: 04:A1:B2:C3 (Panjang: 4 byte)';
  const event = parseRfidLine(rfid1Line);

  assert.notEqual(event, null);
  assert.equal(event.reader, 1);
  assert.equal(event.label, 'PENDAFTARAN');
  assert.equal(event.uid, '04:A1:B2:C3');
});

test('parses RFID Reader 2 (Akses Wahana) event from Wokwi firmware', () => {
  const rfid2Line = '[RFID 2 - AKSES WAHANA] Kartu Terdeteksi! UID: 5A:B6:C7:D8 (Panjang: 4 byte)';
  const event = parseRfidLine(rfid2Line);

  assert.notEqual(event, null);
  assert.equal(event.reader, 2);
  assert.equal(event.label, 'AKSES WAHANA');
  assert.equal(event.uid, '5A:B6:C7:D8');
});
