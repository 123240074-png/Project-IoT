import { csvExport } from './data.mjs';
import { OBJECT_DETECTION_STATUSES, OBJECT_STABILITY_STATUSES, objectError } from './object-detection.mjs';
import { OBJECT_DIRECTION_CODES, normalizeObjectDirection } from './object-direction.mjs';

export const OBJECT_TESTS_STORAGE_KEY = 'cocomang-object-tests-v1';
const SCHEMA_VERSION = 1;
const MAX_RESULTS = 500;

const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const makeId = () => `object-test-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function createEmptyObjectTests() {
  return { schemaVersion: SCHEMA_VERSION, results: [] };
}

export function validateObjectTest(input) {
  if (!input || typeof input !== 'object') return 'Hasil pengujian tidak valid.';
  if (!finite(input.targetDistanceCm) || Number(input.targetDistanceCm) < 1 || Number(input.targetDistanceCm) > 400) {
    return 'Jarak target harus 1-400 cm.';
  }
  if (!finite(input.actualDistanceCm) || Number(input.actualDistanceCm) < 1 || Number(input.actualDistanceCm) > 400) {
    return 'Jarak aktual harus 1-400 cm.';
  }
  if (!finite(input.targetMinCm) || !finite(input.targetMaxCm) || Number(input.targetMaxCm) <= Number(input.targetMinCm)) {
    return 'Rentang target pengujian tidak valid.';
  }
  if (!finite(input.toleranceCm) || Number(input.toleranceCm) <= 0) return 'Toleransi stabilitas tidak valid.';
  if (!OBJECT_DETECTION_STATUSES.includes(input.detectionStatus)) return 'Status deteksi tidak dikenal.';
  if (!OBJECT_STABILITY_STATUSES.includes(input.stabilityStatus)) return 'Status kestabilan tidak dikenal.';
  if (!Number.isInteger(Number(input.sampleCount)) || Number(input.sampleCount) < 0 || Number(input.sampleCount) > 10) {
    return 'Jumlah sampel tidak valid.';
  }
  if (input.measuredDistanceCm != null && (!finite(input.measuredDistanceCm) || Number(input.measuredDistanceCm) < 0 || Number(input.measuredDistanceCm) > 400)) {
    return 'Jarak terukur tidak valid.';
  }
  if (input.stabilityRangeCm != null && (!finite(input.stabilityRangeCm) || Number(input.stabilityRangeCm) < 0)) {
    return 'Rentang stabilitas tidak valid.';
  }
  if (input.durationMs != null && (!finite(input.durationMs) || Number(input.durationMs) < 0)) {
    return 'Durasi pengujian tidak valid.';
  }
  if (input.direction != null && !OBJECT_DIRECTION_CODES.includes(String(input.direction).trim().toUpperCase())) {
    return 'Arah pengujian tidak dikenal.';
  }
  return null;
}

export function createObjectTestResult(input, now = new Date().toISOString()) {
  const issue = validateObjectTest(input);
  if (issue) throw new Error(issue);
  const measuredDistanceCm = input.measuredDistanceCm == null ? null : round(input.measuredDistanceCm);
  return {
    id: makeId(),
    capturedAt: now,
    targetDistanceCm: round(input.targetDistanceCm),
    actualDistanceCm: round(input.actualDistanceCm),
    measuredDistanceCm,
    errorCm: objectError(measuredDistanceCm, input.actualDistanceCm),
    detectionStatus: input.detectionStatus,
    stabilityStatus: input.stabilityStatus,
    stabilityRangeCm: input.stabilityRangeCm == null ? null : round(input.stabilityRangeCm),
    sampleCount: Number(input.sampleCount),
    durationMs: input.durationMs == null ? null : Math.round(Number(input.durationMs)),
    targetMinCm: round(input.targetMinCm),
    targetMaxCm: round(input.targetMaxCm),
    toleranceCm: round(input.toleranceCm),
    sequence: Number.isInteger(input.sequence) ? input.sequence : null,
    calibrated: typeof input.calibrated === 'boolean' ? input.calibrated : null,
    direction: normalizeObjectDirection(input.direction),
  };
}

function assertObjectTests(data) {
  if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.results)) {
    throw new Error('Dataset pengujian objek tidak valid.');
  }
  if (new Set(data.results.map(row => row?.id)).size !== data.results.length) {
    throw new Error('ID dataset pengujian objek duplikat.');
  }
  for (const row of data.results) {
    if (typeof row?.id !== 'string' || !row.id || !validDate(row.capturedAt)) throw new Error('Baris dataset pengujian objek tidak valid.');
    const issue = validateObjectTest(row);
    if (issue) throw new Error(issue);
    if (row.errorCm != null && !finite(row.errorCm)) throw new Error('Nilai error pengujian tidak valid.');
  }
  return data;
}

export function loadObjectTests(storage = globalThis.localStorage) {
  let raw;
  try { raw = storage.getItem(OBJECT_TESTS_STORAGE_KEY); }
  catch { throw new Error('Penyimpanan dataset pengujian tidak tersedia.'); }
  if (raw == null) return createEmptyObjectTests();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('Dataset pengujian objek tidak dapat dibaca.'); }
  return assertObjectTests(data);
}

export function saveObjectTests(data, storage = globalThis.localStorage) {
  assertObjectTests(data);
  try { storage.setItem(OBJECT_TESTS_STORAGE_KEY, JSON.stringify(data)); }
  catch { throw new Error('Dataset pengujian belum tersimpan. Penyimpanan browser penuh atau tidak diizinkan.'); }
  return data;
}

export function appendObjectTest(input, storage = globalThis.localStorage) {
  const data = loadObjectTests(storage);
  const row = input?.id && input?.capturedAt ? input : createObjectTestResult(input);
  data.results = [row, ...data.results].slice(0, MAX_RESULTS);
  return saveObjectTests(data, storage);
}

const when = value => new Date(value).toLocaleString('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export function objectTestsCsvRows(results) {
  return results.map(row => ({
    'Waktu WIB': when(row.capturedAt),
    'Arah pengujian': row.direction || 'DOWN',
    'Target (cm)': row.targetDistanceCm,
    'Aktual (cm)': row.actualDistanceCm,
    'Terukur (cm)': row.measuredDistanceCm ?? '',
    'Error (cm)': row.errorCm ?? '',
    'Status deteksi': row.detectionStatus,
    'Status kestabilan': row.stabilityStatus,
    'Rentang stabilitas (cm)': row.stabilityRangeCm ?? '',
    'Sampel': `${row.sampleCount}/5`,
    'Durasi (ms)': row.durationMs ?? '',
    'Target minimum (cm)': row.targetMinCm,
    'Target maksimum (cm)': row.targetMaxCm,
    'Toleransi (cm)': row.toleranceCm,
    'Urutan frame': row.sequence ?? '',
    'Kalibrasi': row.calibrated == null ? '' : row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi',
  }));
}

export function objectTestsCsv(results) {
  return csvExport(objectTestsCsvRows(results));
}
