import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RIDES, validateRideEligibility, createValidationRecord } from '../dist/ride-validator.mjs';

test('DEFAULT_RIDES contains valid predefined amusement park rides', () => {
  assert.equal(Array.isArray(DEFAULT_RIDES), true);
  assert.equal(DEFAULT_RIDES.length >= 4, true);
  const rollerCoaster = DEFAULT_RIDES.find(r => r.id === 'roller-coaster');
  assert.equal(rollerCoaster.minHeightCm, 140);
});

test('approves member when height is greater than or equal to minimum ride height', () => {
  const member = { rfidUid: '04:A1:B2:C3', name: 'Gian', heightCm: 165 };
  const ride = { id: 'roller-coaster', name: 'Roller Coaster', minHeightCm: 140 };
  
  const result = validateRideEligibility(member, ride);
  assert.equal(result.eligible, true);
  assert.equal(result.diffCm, 0);
  assert.match(result.reason, /Lolos syarat tinggi/);
});

test('rejects member when height is below minimum required height and calculates difference', () => {
  const member = { rfidUid: '04:A1:B2:C3', name: 'Adit', heightCm: 128.5 };
  const ride = { id: 'roller-coaster', name: 'Roller Coaster', minHeightCm: 140 };

  const result = validateRideEligibility(member, ride);
  assert.equal(result.eligible, false);
  assert.equal(result.diffCm, 11.5);
  assert.match(result.reason, /kurang 11.5 cm/);
});

test('handles ride with maximum height threshold (kiddie rides)', () => {
  const ride = { id: 'kiddie-ride', name: 'Bumper Car Anak', minHeightCm: 85, maxHeightCm: 120 };

  // Child within limits
  const childOk = { name: 'Budi', heightCm: 105 };
  const resOk = validateRideEligibility(childOk, ride);
  assert.equal(resOk.eligible, true);

  // Adult exceeding maximum limit
  const adult = { name: 'Dewasa', heightCm: 170 };
  const resTooTall = validateRideEligibility(adult, ride);
  assert.equal(resTooTall.eligible, false);
  assert.equal(resTooTall.diffCm, 50);
  assert.match(resTooTall.reason, /melebihi batas maksimal/);
});

test('rejects validation when member has no height record yet', () => {
  const unmeasuredMember = { rfidUid: '04:A1:B2:C3', name: 'Siti', heightCm: null };
  const ride = { id: 'bianglala', name: 'Bianglala', minHeightCm: 100 };

  const result = validateRideEligibility(unmeasuredMember, ride);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /belum melakukan pengukuran/i);
});

test('createValidationRecord produces well-formed validation log object', () => {
  const member = { rfidUid: '04:12:34:56', name: 'Rina', heightCm: 155 };
  const ride = { id: 'kora-kora', name: 'Kora-Kora', minHeightCm: 125 };
  const evalResult = validateRideEligibility(member, ride);

  const record = createValidationRecord({
    member,
    ride,
    evaluation: evalResult,
    readerId: 2,
    now: '2026-11-09T20:00:00.000Z',
  });

  assert.equal(record.rfidUid, '04:12:34:56');
  assert.equal(record.memberName, 'Rina');
  assert.equal(record.measuredHeightCm, 155);
  assert.equal(record.rideId, 'kora-kora');
  assert.equal(record.isEligible, true);
  assert.equal(record.readerId, 2);
  assert.equal(record.validatedAt, '2026-11-09T20:00:00.000Z');
});
