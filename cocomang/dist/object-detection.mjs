export const OBJECT_DEFAULTS = Object.freeze({
  minCm: 20,
  maxCm: 60,
  toleranceCm: 2,
  sampleCount: 5,
  staleMs: 3000,
});

export const OBJECT_STABILITY_STATUSES = Object.freeze([
  'COLLECTING',
  'STABLE',
  'UNSTABLE',
  'NO_OBJECT',
  'INVALID',
  'DEVICE_OFFLINE',
]);

export const OBJECT_DETECTION_STATUSES = Object.freeze([
  'IN_RANGE',
  'TOO_CLOSE',
  'TOO_FAR',
  'INVALID',
  'WAITING',
  'OFFLINE',
]);

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));

export function normalizeObjectRange(input = {}) {
  const minCm = finite(input.minCm) && Number(input.minCm) >= 2 ? Number(input.minCm) : OBJECT_DEFAULTS.minCm;
  const maxCandidate = finite(input.maxCm) ? Number(input.maxCm) : OBJECT_DEFAULTS.maxCm;
  const maxCm = maxCandidate > minCm ? maxCandidate : OBJECT_DEFAULTS.maxCm;
  const toleranceCm = finite(input.toleranceCm) && Number(input.toleranceCm) > 0
    ? Number(input.toleranceCm)
    : OBJECT_DEFAULTS.toleranceCm;
  const sampleCount = Number.isInteger(Number(input.sampleCount)) && Number(input.sampleCount) >= 2 && Number(input.sampleCount) <= 10
    ? Number(input.sampleCount)
    : OBJECT_DEFAULTS.sampleCount;
  const staleMs = Number.isFinite(Number(input.staleMs)) && Number(input.staleMs) >= 500
    ? Number(input.staleMs)
    : OBJECT_DEFAULTS.staleMs;
  return { minCm, maxCm, toleranceCm, sampleCount, staleMs };
}

export function validateObjectRange(input = {}) {
  if (!finite(input.minCm) || Number(input.minCm) < 2) return 'Batas minimum harus minimal 2 cm.';
  if (!finite(input.maxCm) || Number(input.maxCm) > 400) return 'Batas maksimum harus maksimal 400 cm.';
  if (Number(input.maxCm) <= Number(input.minCm)) return 'Batas maksimum harus lebih besar dari batas minimum.';
  return null;
}

export function median(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function baseResult(settings, overrides = {}) {
  return {
    status: 'NO_OBJECT',
    detectionStatus: 'WAITING',
    reason: null,
    distanceCm: null,
    measuredDistanceCm: null,
    stabilityRangeCm: null,
    sampleCount: 0,
    sampleTarget: settings.sampleCount,
    distances: [],
    lastSequence: null,
    targetMinCm: settings.minCm,
    targetMaxCm: settings.maxCm,
    toleranceCm: settings.toleranceCm,
    staleMs: settings.staleMs,
    evaluatedAt: null,
    ...overrides,
  };
}

export function evaluateObjectDetection({
  connected = false,
  frame = null,
  lastFrameAt = 0,
  now = Date.now(),
  distances = [],
  lastSequence = null,
  range = {},
} = {}) {
  const settings = normalizeObjectRange(range);
  const previous = Array.isArray(distances) ? distances.map(Number).filter(Number.isFinite) : [];
  const base = baseResult(settings, {
    distances: previous.slice(-settings.sampleCount),
    lastSequence,
    evaluatedAt: now,
  });

  if (!connected) {
    return { ...base, status: 'DEVICE_OFFLINE', detectionStatus: 'OFFLINE', reason: 'DEVICE_DISCONNECTED', distances: [], lastSequence: null };
  }

  if (!frame) {
    return { ...base, status: 'NO_OBJECT', detectionStatus: 'WAITING', reason: 'WAITING_FOR_DATA', distances: [], lastSequence: null };
  }

  if (!lastFrameAt || now - lastFrameAt > settings.staleMs) {
    return { ...base, status: 'DEVICE_OFFLINE', detectionStatus: 'OFFLINE', reason: 'STALE_DATA', distances: [], lastSequence: null };
  }

  if (frame.status !== 'ok' || !finite(frame.distanceCm)) {
    return {
      ...base,
      status: 'INVALID',
      detectionStatus: 'INVALID',
      reason: frame.error || frame.reason || 'NO_ECHO_OR_INVALID_RANGE',
      lastSequence: Number.isInteger(frame.sequence) ? frame.sequence : lastSequence,
      distances: [],
    };
  }

  const distanceCm = round(frame.distanceCm);
  const sequence = Number.isInteger(frame.sequence) ? frame.sequence : null;
  const duplicate = sequence != null && sequence === lastSequence;
  const nextSequence = sequence ?? lastSequence;
  let buffer = previous.slice(-settings.sampleCount);

  if (!duplicate) {
    if (distanceCm < settings.minCm || distanceCm > settings.maxCm) buffer = [];
    else buffer = [...buffer, distanceCm].slice(-settings.sampleCount);
  }

  if (distanceCm < settings.minCm || distanceCm > settings.maxCm) {
    return {
      ...base,
      status: 'NO_OBJECT',
      detectionStatus: distanceCm < settings.minCm ? 'TOO_CLOSE' : 'TOO_FAR',
      reason: 'OUT_OF_TARGET_RANGE',
      distanceCm,
      measuredDistanceCm: distanceCm,
      distances: [],
      lastSequence: nextSequence,
    };
  }

  const stabilityRangeCm = buffer.length > 1 ? round(Math.max(...buffer) - Math.min(...buffer)) : 0;
  const measuredDistanceCm = round(median(buffer) ?? distanceCm);
  const shared = {
    ...base,
    detectionStatus: 'IN_RANGE',
    distanceCm,
    measuredDistanceCm,
    stabilityRangeCm,
    sampleCount: buffer.length,
    distances: buffer,
    lastSequence: nextSequence,
  };

  if (buffer.length < settings.sampleCount) {
    return { ...shared, status: 'COLLECTING', reason: 'COLLECTING_SAMPLES' };
  }
  if (stabilityRangeCm <= settings.toleranceCm) {
    return { ...shared, status: 'STABLE', reason: 'STABLE_RANGE' };
  }
  return { ...shared, status: 'UNSTABLE', reason: 'UNSTABLE_RANGE' };
}

export function objectError(measuredDistanceCm, actualDistanceCm) {
  if (!finite(measuredDistanceCm) || !finite(actualDistanceCm)) return null;
  return round(Number(measuredDistanceCm) - Number(actualDistanceCm));
}
