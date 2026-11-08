// Simulation repository. Replace this adapter with Firebase without changing domain rules.
// Keep the original storage namespace so the COCOMANG rebrand preserves existing visitors.
export const STORAGE_KEY = 'senandika-v1';
export const normalizeRfid = (value = '') => String(value).replace(/[\s:-]/g, '').toUpperCase();
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function validateVisitor(input, existingVisitors = [], excludeId = null) {
  const errors = {};
  if (!input || typeof input !== 'object') return { name: 'Data pengunjung belum diisi.' };
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 100) errors.name = 'Isi nama antara 2 dan 100 karakter.';
  const age = Number(input.age);
  if (input.age === '' || !Number.isInteger(age) || age < 1 || age > 120) errors.age = 'Usia harus berupa angka 1–120 tahun.';
  const weight = Number(input.weight);
  if (input.weight === '' || !Number.isFinite(weight) || weight < 5 || weight > 250) errors.weight = 'Berat badan harus antara 5 dan 250 kg.';
  if (!['Laki-laki', 'Perempuan'].includes(input.gender)) errors.gender = 'Pilih jenis kelamin.';
  const rfid = normalizeRfid(input.rfid);
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(rfid)) errors.rfid = 'UID RFID harus berisi 8, 14, atau 20 karakter heksadesimal.';
  else if (existingVisitors.some(visitor => visitor.id !== excludeId && normalizeRfid(visitor.rfid) === rfid)) errors.rfid = 'Kartu RFID ini sudah terdaftar pada pengunjung lain.';
  const phone = String(input.phone ?? '').trim();
  if (phone && !/^\+?[0-9][0-9\s()-]{7,19}$/.test(phone)) errors.phone = 'Masukkan nomor telepon yang valid, atau kosongkan.';
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000)) errors.notes = 'Catatan maksimal 1.000 karakter.';
  return errors;
}

export function evaluateAccess(visitor, ride) {
  if (!visitor) return { allowed: false, reason: 'Kartu RFID belum terdaftar.' };
  if (!ride) return { allowed: false, reason: 'Wahana tidak ditemukan.' };
  if (ride.status !== 'Buka') return { allowed: false, reason: 'Wahana sedang dalam perawatan.' };
  if (!finite(visitor.height) || visitor.height < 30 || visitor.height > 250 || !validDate(visitor.measuredAt)) return { allowed: false, reason: 'Tinggi badan belum diukur. Lakukan pengukuran terlebih dahulu.' };
  if (!finite(ride.minHeight) || ride.minHeight < 30 || ride.minHeight > 250) return { allowed: false, reason: 'Batas tinggi wahana belum valid.' };
  if (visitor.height < ride.minHeight) return { allowed: false, reason: `Tinggi ${visitor.height} cm belum memenuhi minimum ${ride.minHeight} cm.` };
  if (ride.maxWeight != null && (!finite(ride.maxWeight) || !finite(visitor.weight))) return { allowed: false, reason: 'Data batas berat atau berat badan belum valid.' };
  if (ride.maxWeight != null && visitor.weight > ride.maxWeight) return { allowed: false, reason: `Berat ${visitor.weight} kg melebihi batas ${ride.maxWeight} kg.` };
  return { allowed: true, reason: `Memenuhi syarat tinggi minimum ${ride.minHeight} cm${ride.maxWeight != null ? ` dan berat maksimal ${ride.maxWeight} kg` : ''}.` };
}

export function recordAccess(state, visitorId, rideId) {
  const visitor = state.visitors.find(item => item.id === visitorId);
  const ride = state.rides.find(item => item.id === rideId);
  if (!visitor || !ride) throw new Error('Pilih pengunjung dan wahana yang terdaftar.');
  const decision = evaluateAccess(visitor, ride);
  const entry = { id: uid('akses'), visitorId, visitorName: visitor.name, rideId, rideName: ride.name, ...decision, height: visitor.height, createdAt: new Date().toISOString() };
  state.logs.unshift(entry);
  return entry;
}

export function seedState() {
  const now = Date.now();
  const ago = minutes => new Date(now - minutes * 60000).toISOString();
  const examples = [
    ['Nadia Putri', 23, 'Perempuan', 52, 162, 'A1B2C301'],
    ['Raka Pratama', 12, 'Laki-laki', 36, 138, 'A1B2C302'],
    ['Alya Kirana', 8, 'Perempuan', 25, 118, 'A1B2C303'],
    ['Dimas Saputra', 28, 'Laki-laki', 73, 175, 'A1B2C304'],
    ['Sinta Maharani', 21, 'Perempuan', 49, 155, 'A1B2C305'],
    ['Bima Aditya', 10, 'Laki-laki', 31, 129, 'A1B2C306'],
    ['Laras Anindya', 19, 'Perempuan', 54, 160, 'A1B2C307'],
    ['Arga Mahendra', 15, 'Laki-laki', 48, null, 'A1B2C308'],
  ];
  const visitors = examples.map(([name, age, gender, weight, height, rfid], index) => ({ id: `visitor-${index + 1}`, name, age, gender, weight, phone: '', rfid, height, measuredAt: height == null ? null : ago(110 - index * 10), createdAt: ago(120 - index * 10), notes: 'Pengunjung fiktif untuk simulasi.', demo: true }));
  const rides = [
    { id: 'komidi', name: 'Komidi Senja', category: 'Keluarga', description: 'Putaran santai dengan kuda komidi warna-warni.', minHeight: 90, maxWeight: null, status: 'Buka' },
    { id: 'bianglala', name: 'Bianglala Langit', category: 'Keluarga', description: 'Melihat taman dari kabin bianglala.', minHeight: 100, maxWeight: null, status: 'Buka' },
    { id: 'bumper', name: 'Mobil Gembira', category: 'Petualangan', description: 'Lintasan mobil senggol untuk pengunjung muda.', minHeight: 110, maxWeight: null, status: 'Buka' },
    { id: 'arus', name: 'Arung Rimba', category: 'Petualangan', description: 'Menyusuri arus buatan dengan perahu bundar.', minHeight: 120, maxWeight: null, status: 'Buka' },
    { id: 'ayunan', name: 'Ayunan Awan', category: 'Tantangan', description: 'Kursi gantung yang berputar di atas taman.', minHeight: 130, maxWeight: 100, status: 'Perawatan' },
    { id: 'coaster', name: 'Lintasan Halilintar', category: 'Tantangan', description: 'Kereta cepat dengan tikungan dan turunan.', minHeight: 140, maxWeight: 110, status: 'Buka' },
  ];
  const state = { schemaVersion: 1, demo: true, visitors, rides, logs: [] };
  const pairs = [[0, 5], [1, 5], [2, 0], [3, 3], [5, 3]];
  state.logs = pairs.map(([v, r], index) => ({ id: `sample-log-${index + 1}`, visitorId: visitors[v].id, visitorName: visitors[v].name, rideId: rides[r].id, rideName: rides[r].name, ...evaluateAccess(visitors[v], rides[r]), height: visitors[v].height, createdAt: ago(5 + index * 7), demo: true }));
  return state;
}

function assertState(state) {
  const invalid = () => { throw new Error('Data simulasi tidak valid. Data tersimpan dipertahankan; pulihkan cadangan sebelum mencoba lagi.'); };
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.visitors) || !Array.isArray(state.rides) || !Array.isArray(state.logs)) invalid();
  const uniqueIds = rows => rows.every(row => row && typeof row.id === 'string' && row.id) && new Set(rows.map(row => row.id)).size === rows.length;
  if (![state.visitors, state.rides, state.logs].every(uniqueIds)) invalid();
  for (const visitor of state.visitors) {
    if (Object.keys(validateVisitor(visitor, state.visitors, visitor.id)).length || !validDate(visitor.createdAt)) invalid();
    if (visitor.height !== null && (!finite(visitor.height) || visitor.height < 30 || visitor.height > 250 || !validDate(visitor.measuredAt))) invalid();
    if (visitor.height === null && visitor.measuredAt !== null) invalid();
  }
  for (const ride of state.rides) {
    if (typeof ride.name !== 'string' || !ride.name.trim() || typeof ride.category !== 'string' || typeof ride.description !== 'string' || !finite(ride.minHeight) || ride.minHeight < 30 || ride.minHeight > 250 || (ride.maxWeight != null && (!finite(ride.maxWeight) || ride.maxWeight < 5 || ride.maxWeight > 250)) || !['Buka', 'Perawatan'].includes(ride.status)) invalid();
  }
  for (const entry of state.logs) {
    if (!['visitorId', 'visitorName', 'rideId', 'rideName', 'reason'].every(key => typeof entry[key] === 'string') || typeof entry.allowed !== 'boolean' || !validDate(entry.createdAt) || (entry.height !== null && (!finite(entry.height) || entry.height < 30 || entry.height > 250))) invalid();
  }
  return state;
}

export const repository = {
  load() {
    let raw;
    try { raw = globalThis.localStorage.getItem(STORAGE_KEY); }
    catch { throw new Error('Penyimpanan browser tidak tersedia. Izinkan penyimpanan lokal lalu muat ulang.'); }
    if (raw === null) {
      const initial = seedState();
      this.save(initial);
      return initial;
    }
    let state;
    try { state = JSON.parse(raw); }
    catch { throw new Error('Data simulasi tidak dapat dibaca. Data tersimpan dipertahankan agar bisa dipulihkan.'); }
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
  const escape = value => {
    let cell = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Spreadsheet formula injection can also be prefixed by whitespace/control characters.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [keys.map(escape).join(','), ...rows.map(row => keys.map(key => escape(row[key])).join(','))].join('\r\n');
}
