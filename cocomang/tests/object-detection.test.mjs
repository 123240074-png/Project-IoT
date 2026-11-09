import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_DEFAULTS,
  evaluateObjectDetection,
  median,
  normalizeObjectRange,
  objectError,
  validateObjectRange,
} from '../dist/object-detection.mjs';

const now = Date.parse('2026-11-09T10:00:00.000Z');

const measurement = (distanceCm, sequence, overrides = {}) => ({
  type: 'measurement',
  device: 'smartheight-esp32',
  status: 'ok',
  sequence,
  distanceCm,
  heightCm: 220 - distanceCm,
  referenceHeightCm: 220,
  offsetCm: 0,
  validSamples: 3,
  buzzerAlarm: false,
  calibrated: false,
  ...overrides,
});

const invalid = (sequence, error = 'NO_ECHO_OR_INVALID_RANGE') => ({
  type: 'measurement',
  device: 'smartheight-esp32',
  status: 'invalid',
  sequence,
  error,
});

function feed(distances, range = {}) {
  let result;
  distances.forEach((distanceCm, index) => {
    result = evaluateObjectDetection({
      connected: true,
      frame: measurement(distanceCm, index + 1),
      lastFrameAt: now,
      now,
      distances: result?.distances || [],
      lastSequence: result?.lastSequence ?? null,
      range,
    });
  });
  return result;
}

test('defaults match a 20-60 cm target, 2 cm tolerance, five samples', () => {
  assert.deepEqual(OBJECT_DEFAULTS, { minCm: 20, maxCm: 60, toleranceCm: 2, sampleCount: 5, staleMs: 3000 });
});

test('reports DEVICE_OFFLINE when the serial connection is closed', () => {
  const result = evaluateObjectDetection({ connected: false, frame: measurement(40, 1), lastFrameAt: now, now });
  assert.equal(result.status, 'DEVICE_OFFLINE');
  assert.equal(result.detectionStatus, 'OFFLINE');
  assert.deepEqual(result.distances, []);
});

test('reports DEVICE_OFFLINE for stale frames and clears the buffer', () => {
  const result = evaluateObjectDetection({
    connected: true,
    frame: measurement(40, 5),
    lastFrameAt: now - 3001,
    now,
    distances: [39.8, 40, 40.1],
    lastSequence: 4,
  });
  assert.equal(result.status, 'DEVICE_OFFLINE');
  assert.equal(result.reason, 'STALE_DATA');
  assert.equal(result.sampleCount, 0);
});

test('reports INVALID and resets the buffer when the ESP32 sends no echo', () => {
  const result = evaluateObjectDetection({
    connected: true,
    frame: invalid(7),
    lastFrameAt: now,
    now,
    distances: [39.8, 40, 40.1],
    lastSequence: 6,
  });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.detectionStatus, 'INVALID');
  assert.equal(result.reason, 'NO_ECHO_OR_INVALID_RANGE');
  assert.equal(result.sampleCount, 0);
});

test('reports NO_OBJECT for an object closer than the target range', () => {
  const result = feed([14]);
  assert.equal(result.status, 'NO_OBJECT');
  assert.equal(result.detectionStatus, 'TOO_CLOSE');
  assert.equal(result.sampleCount, 0);
  assert.equal(result.distanceCm, 14);
});

test('reports NO_OBJECT for an object beyond the target range', () => {
  const result = feed([72]);
  assert.equal(result.status, 'NO_OBJECT');
  assert.equal(result.detectionStatus, 'TOO_FAR');
  assert.equal(result.sampleCount, 0);
});

test('reports COLLECTING until five valid in-range frames are available', () => {
  const result = feed([40, 40.4, 39.8, 40.1]);
  assert.equal(result.status, 'COLLECTING');
  assert.equal(result.sampleCount, 4);
  assert.match(result.reason, /COLLECTING/);
});

test('reports STABLE for five readings within two centimetres', () => {
  const result = feed([40, 40.5, 39.8, 40.2, 40.1]);
  assert.equal(result.status, 'STABLE');
  assert.equal(result.detectionStatus, 'IN_RANGE');
  assert.equal(result.sampleCount, 5);
  assert.equal(result.stabilityRangeCm, 0.7);
  assert.equal(result.measuredDistanceCm, 40.1);
});

test('reports UNSTABLE when five readings exceed the stability tolerance', () => {
  const result = feed([35, 40, 45, 50, 55]);
  assert.equal(result.status, 'UNSTABLE');
  assert.equal(result.sampleCount, 5);
  assert.equal(result.stabilityRangeCm, 20);
});

test('does not count the same frame twice', () => {
  const first = evaluateObjectDetection({
    connected: true,
    frame: measurement(40, 1),
    lastFrameAt: now,
    now,
  });
  const second = evaluateObjectDetection({
    connected: true,
    frame: measurement(40, 1),
    lastFrameAt: now,
    now,
    distances: first.distances,
    lastSequence: first.lastSequence,
  });
  assert.equal(first.sampleCount, 1);
  assert.equal(second.sampleCount, 1);
});

test('clears collected samples after a valid frame falls outside the range', () => {
  let result = feed([39.9, 40, 40.1]);
  result = evaluateObjectDetection({
    connected: true,
    frame: measurement(75, 4),
    lastFrameAt: now,
    now,
    distances: result.distances,
    lastSequence: result.lastSequence,
  });
  assert.equal(result.detectionStatus, 'TOO_FAR');
  assert.deepEqual(result.distances, []);
  const next = evaluateObjectDetection({
    connected: true,
    frame: measurement(40, 5),
    lastFrameAt: now,
    now,
    distances: result.distances,
    lastSequence: result.lastSequence,
  });
  assert.equal(next.status, 'COLLECTING');
  assert.equal(next.sampleCount, 1);
});

test('supports a configurable target range', () => {
  const result = feed([45, 45.4, 45.2, 44.9, 45.1], { minCm: 40, maxCm: 50, toleranceCm: 1 });
  assert.equal(result.status, 'STABLE');
  assert.equal(result.targetMinCm, 40);
  assert.equal(result.targetMaxCm, 50);
});

test('calculates signed error from sensor and measured actual distance', () => {
  assert.equal(objectError(40.2, 40), 0.2);
  assert.equal(objectError(39.4, 40), -0.6);
  assert.equal(objectError(null, 40), null);
  assert.equal(objectError(40, null), null);
});

test('returns the median for stable readings', () => {
  assert.equal(median([40, 40.5, 39.8]), 40);
  assert.equal(median([39.8, 40, 40.1, 40.4]), 40.05);
});

test('normalizes and validates target settings', () => {
  assert.deepEqual(normalizeObjectRange({ minCm: '30', maxCm: '70' }), {
    minCm: 30,
    maxCm: 70,
    toleranceCm: 2,
    sampleCount: 5,
    staleMs: 3000,
  });
  assert.equal(validateObjectRange({ minCm: 60, maxCm: 30 }), 'Batas maksimum harus lebih besar dari batas minimum.');
  assert.equal(validateObjectRange({ minCm: 20, maxCm: 60 }), null);
});
