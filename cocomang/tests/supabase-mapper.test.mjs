import test from 'node:test';
import assert from 'node:assert/strict';
import { memberToDb, dbToMember } from '../dist/supabase-service.mjs';

test('memberToDb correctly maps camelCase frontend model to snake_case DB columns', () => {
  const localMember = {
    rfidUid: '04:A1:B2:C3',
    name: 'Gian Abi Firdaus',
    age: 20,
    gender: 'L',
    weightKg: 62.5,
    heightCm: 172.4,
    notes: 'Member VIP',
    measuredAt: '2026-11-09T20:00:00.000Z',
    createdAt: '2026-11-09T19:00:00.000Z',
  };

  const dbRow = memberToDb(localMember);
  assert.equal(dbRow.rfid_uid, '04:A1:B2:C3');
  assert.equal(dbRow.name, 'Gian Abi Firdaus');
  assert.equal(dbRow.age, 20);
  assert.equal(dbRow.gender, 'L');
  assert.equal(dbRow.weight_kg, 62.5);
  assert.equal(dbRow.height_cm, 172.4);
  assert.equal(dbRow.notes, 'Member VIP');
  assert.equal(dbRow.last_measured_at, '2026-11-09T20:00:00.000Z');
  assert.equal(dbRow.created_at, '2026-11-09T19:00:00.000Z');
});

test('dbToMember correctly maps snake_case DB columns back to frontend model', () => {
  const dbRow = {
    rfid_uid: '10:20:30:40',
    name: 'Aditya Pratama',
    age: 21,
    gender: 'L',
    weight_kg: '70.2',
    height_cm: '168.0',
    notes: 'Reguler',
    last_measured_at: '2026-11-09T21:00:00.000Z',
    created_at: '2026-11-09T18:00:00.000Z',
  };

  const member = dbToMember(dbRow);
  assert.equal(member.rfidUid, '10:20:30:40');
  assert.equal(member.name, 'Aditya Pratama');
  assert.equal(member.age, 21);
  assert.equal(member.weightKg, 70.2);
  assert.equal(member.heightCm, 168.0);
  assert.equal(member.measuredAt, '2026-11-09T21:00:00.000Z');
  assert.equal(member.createdAt, '2026-11-09T18:00:00.000Z');
});
