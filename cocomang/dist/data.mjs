export const STORAGE_KEY = 'cocomang-live-v1';
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const GENDERS = ['L', 'P', 'Lainnya'];
const normalizeGender = value => {
  const text = String(value ?? '').trim();
  if (text === 'Laki-laki') return 'L';
  if (text === 'Perempuan') return 'P';
  return text;
};

export function normalizeRfid(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[:\s-]/g, '').toUpperCase();
}

export function formatRfid(value) {
  const clean = normalizeRfid(value);
  if (!clean) return '';
  return clean.match(/.{1,2}/g)?.join(':') ?? clean;
}

export function isValidRfid(value) {
  if (typeof value !== 'string') return false;
  const clean = normalizeRfid(value);
  // Standard RFID card UID lengths: 4-byte (8 hex), 7-byte (14 hex), 10-byte (20 hex)
  return /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(clean);
}

export function createInitialState() {
  return { schemaVersion: 1, visitors: [], measurements: [] };
}

export function validateMember(input, options = {}) {
  const errors = {};
  if (!input || typeof input !== 'object') return { name: 'Data member belum diisi.' };
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 100) {
    errors.name = 'Nama harus berisi 2–100 karakter.';
  }
  if (input.age !== '' && input.age != null) {
    const age = Number(input.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) errors.age = 'Usia harus berupa bilangan bulat 1–120 tahun.';
  }
  if (input.gender !== '' && input.gender != null && !GENDERS.includes(normalizeGender(input.gender))) {
    errors.gender = 'Jenis kelamin tidak valid.';
  }
  if (input.weightKg !== '' && input.weightKg != null) {
    const weight = Number(input.weightKg);
    if (!Number.isFinite(weight) || weight < 1 || weight > 300) errors.weightKg = 'Berat badan harus 1–300 kg.';
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 500)) {
    errors.notes = 'Catatan maksimal 500 karakter.';
  }

  const rfid = input.rfidUid ?? input.rfid;
  if (options.requireRfid) {
    if (rfid == null || String(rfid).trim() === '') {
      errors.rfidUid = 'UID kartu RFID wajib diisi.';
    } else if (!isValidRfid(String(rfid))) {
      errors.rfidUid = 'Format UID kartu RFID tidak valid. Masukkan 4, 7, atau 10 byte heksadesimal (contoh: 04:A1:B2:C3).';
    }
  } else if (rfid != null && String(rfid).trim() !== '') {
    if (!isValidRfid(String(rfid))) {
      errors.rfidUid = 'Format UID kartu RFID tidak valid. Masukkan 4, 7, atau 10 byte heksadesimal (contoh: 04:A1:B2:C3).';
    }
  }

  return errors;
}

export const validateVisitor = validateMember;

export function addMember(state, input, now = new Date().toISOString()) {
  const rfidRaw = input?.rfidUid ?? input?.rfid;
  const isFormRegistration = Boolean(input && typeof input === 'object' && ('rfidUid' in input || input.requireRfid));
  const errors = validateMember(input, { requireRfid: isFormRegistration });
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);

  if (rfidRaw && String(rfidRaw).trim() !== '' && state?.visitors?.length) {
    const clean = normalizeRfid(String(rfidRaw));
    const duplicate = state.visitors.find(m => m.rfidUid && normalizeRfid(m.rfidUid) === clean);
    if (duplicate) {
      throw new Error(`UID kartu RFID ${formatRfid(clean)} sudah digunakan oleh member ${duplicate.name}.`);
    }
  }

  const member = {
    id: makeId('member'),
    name: input.name.trim(),
    rfidUid: rfidRaw && String(rfidRaw).trim() !== '' ? formatRfid(String(rfidRaw)) : null,
    age: input.age === '' || input.age == null ? null : Number(input.age),
    gender: input.gender === '' || input.gender == null ? null : normalizeGender(input.gender),
    weightKg: input.weightKg === '' || input.weightKg == null ? null : Number(input.weightKg),
    notes: String(input.notes ?? '').trim(),
    heightCm: null,
    measuredAt: null,
    createdAt: now,
  };
  state.visitors.unshift(member);
  return member;
}

export const addVisitor = addMember;

export function deleteMember(state, identifier) {
  if (!state || !Array.isArray(state.visitors)) throw new Error('State tidak valid.');
  const idStr = String(identifier ?? '').trim();
  const cleanRfid = normalizeRfid(idStr);

  const index = state.visitors.findIndex(m => m.id === idStr || (m.rfidUid && normalizeRfid(m.rfidUid) === cleanRfid));
  if (index === -1) throw new Error('Member tidak ditemukan.');

  const [removed] = state.visitors.splice(index, 1);
  return removed;
}

export const deleteVisitor = deleteMember;

export function validateDeviceFrame(frame) {
  if (!frame || typeof frame !== 'object') return 'Pesan perangkat tidak valid.';
  if (frame.device !== 'smartheight-esp32') return 'Identitas perangkat tidak dikenali.';
  if (frame.type !== 'measurement') return 'Jenis pesan perangkat tidak didukung.';
  if (frame.status !== 'ok') return typeof frame.error === 'string' ? frame.error : 'Sensor tidak menghasilkan pembacaan valid.';
  if (!isFiniteNumber(frame.distanceCm) || frame.distanceCm < 2 || frame.distanceCm > 400) return 'Jarak sensor di luar rentang valid.';
  if (!isFiniteNumber(frame.heightCm) || frame.heightCm < 0 || frame.heightCm > 250) return 'Estimasi tinggi di luar rentang valid.';
  if (!isFiniteNumber(frame.referenceHeightCm) || frame.referenceHeightCm < 50 || frame.referenceHeightCm > 400) return 'Tinggi referensi perangkat tidak valid.';
  if (!isFiniteNumber(frame.offsetCm) || frame.offsetCm < -20 || frame.offsetCm > 20) return 'Offset kalibrasi perangkat tidak valid.';
  if (!Number.isInteger(frame.validSamples) || frame.validSamples < 3 || frame.validSamples > 5) return 'Jumlah sampel valid perangkat tidak sesuai.';
  if (typeof frame.buzzerAlarm !== 'boolean') return 'Status buzzer tidak valid.';
  if (typeof frame.calibrated !== 'boolean') return 'Status kalibrasi tidak tersedia.';
  return null;
}

export function recordMeasurement(state, visitorId, frame, now = new Date().toISOString()) {
  const issue = validateDeviceFrame(frame);
  if (issue) throw new Error(issue);
  const visitor = state.visitors.find(item => item.id === visitorId);
  if (!visitor) throw new Error('Pilih member sebelum menyimpan hasil.');

  const entry = {
    id: makeId('measurement'),
    visitorId: visitor.id,
    visitorName: visitor.name,
    memberRfid: visitor.rfidUid ?? null,
    distanceCm: Number(frame.distanceCm),
    heightCm: Number(frame.heightCm),
    referenceHeightCm: Number(frame.referenceHeightCm),
    offsetCm: Number(frame.offsetCm),
    validSamples: Number(frame.validSamples),
    buzzerAlarm: Boolean(frame.buzzerAlarm),
    calibrated: Boolean(frame.calibrated),
    device: frame.device,
    sequence: Number.isInteger(frame.sequence) ? frame.sequence : null,
    capturedAt: now,
  };

  visitor.heightCm = entry.heightCm;
  visitor.measuredAt = now;
  state.measurements.unshift(entry);
  return entry;
}

function assertState(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.visitors) || !Array.isArray(state.measurements)) {
    throw new Error('Data COCOMANG Live tidak valid. Data yang tersimpan tidak diubah.');
  }
  const unique = rows => rows.every(row => row && typeof row.id === 'string' && row.id) && new Set(rows.map(row => row.id)).size === rows.length;
  if (!unique(state.visitors) || !unique(state.measurements)) throw new Error('ID data duplikat. Data yang tersimpan tidak diubah.');
  for (const visitor of state.visitors) {
    if (Object.keys(validateMember(visitor)).length || !validDate(visitor.createdAt)) throw new Error('Data member tidak valid.');
    if (visitor.rfidUid != null && !isValidRfid(visitor.rfidUid)) throw new Error('UID kartu RFID member tidak valid.');
    if (visitor.heightCm !== null && (!isFiniteNumber(visitor.heightCm) || visitor.heightCm < 0 || visitor.heightCm > 250 || !validDate(visitor.measuredAt))) {
      throw new Error('Tinggi member tidak valid.');
    }
  }
  for (const entry of state.measurements) {
    if (typeof entry.visitorName !== 'string' || !entry.visitorName || !validDate(entry.capturedAt)) throw new Error('Riwayat pengukuran tidak valid.');
    if (![entry.distanceCm, entry.heightCm, entry.referenceHeightCm, entry.offsetCm].every(isFiniteNumber)) throw new Error('Nilai pengukuran tidak valid.');
    if (entry.distanceCm < 2 || entry.distanceCm > 400 || entry.heightCm < 0 || entry.heightCm > 250) throw new Error('Rentang pengukuran tidak valid.');
    if (!Number.isInteger(entry.validSamples) || entry.validSamples < 3 || entry.validSamples > 5 || typeof entry.buzzerAlarm !== 'boolean' || typeof entry.calibrated !== 'boolean') {
      throw new Error('Metadata pengukuran tidak valid.');
    }
  }
  return state;
}

export const repository = {
  load() {
    let raw;
    try { raw = globalThis.localStorage.getItem(STORAGE_KEY); }
    catch { throw new Error('Penyimpanan browser tidak tersedia. Izinkan penyimpanan lokal lalu muat ulang.'); }
    if (raw === null) {
      const initial = createInitialState();
      this.save(initial);
      return initial;
    }
    let state;
    try { state = JSON.parse(raw); }
    catch { throw new Error('Data pengukuran tidak dapat dibaca. Data lama dipertahankan agar dapat dipulihkan.'); }
    return assertState(state);
  },
  save(state) {
    assertState(state);
    try { globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { throw new Error('Data belum tersimpan. Penyimpanan browser penuh atau tidak diizinkan.'); }
    return state;
  },
};

export function csvExport(rows) {
  if (!Array.isArray(rows) || !rows.length) return '\uFEFF';
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n');
}
