import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRfid, evaluateRideEligibility } from '../dist/kiosk-service.mjs';

test('sanitizeRfid formats raw hex or colon-delimited RFID properly', () => {
  assert.equal(sanitizeRfid('04a1b2c3'), '04:A1:B2:C3');
  assert.equal(sanitizeRfid('04:A1:B2:C3'), '04:A1:B2:C3');
  assert.equal(sanitizeRfid('  04 a1 b2 c3 '), '04:A1:B2:C3');
  assert.equal(sanitizeRfid(''), '');
});

test('evaluateRideEligibility correctly checks height thresholds', () => {
  const rollerCoaster = { id: 'roller-coaster', name: 'Roller Coaster', min_height_cm: 140, max_height_cm: null };
  const bumperCar = { id: 'bumper-car', name: 'Bumper Car Anak', min_height_cm: 85, max_height_cm: 125 };

  // 1. Tinggi cukup untuk Roller Coaster
  const r1 = evaluateRideEligibility(145, rollerCoaster);
  assert.equal(r1.eligible, true);
  assert.equal(r1.diffCm, 0);

  // 2. Tinggi kurang untuk Roller Coaster
  const r2 = evaluateRideEligibility(135.5, rollerCoaster);
  assert.equal(r2.eligible, false);
  assert.equal(r2.diffCm, 4.5);

  // 3. Melebihi batas maksimal untuk wahana anak
  const r3 = evaluateRideEligibility(130, bumperCar);
  assert.equal(r3.eligible, false);
  assert.equal(r3.diffCm, 5);

  // 4. Belum ada pengukuran tinggi (0 atau null)
  const r4 = evaluateRideEligibility(null, rollerCoaster);
  assert.equal(r4.eligible, false);
});
