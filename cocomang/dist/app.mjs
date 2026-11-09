import { repository, addMember, addVisitor, recordMeasurement, csvExport, normalizeRfid, formatRfid } from './data.mjs';
import { parseDeviceLine, parseRfidLine } from './serial-protocol.mjs';
import { DEFAULT_RIDES, validateRideEligibility, createValidationRecord } from './ride-validator.mjs';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  isConfigured as isSupabaseConfigured,
  testConnection as testSupabaseConnection,
  fetchMembers as fetchSupabaseMembers,
  upsertMember as upsertSupabaseMember,
  updateMemberHeight as updateSupabaseMemberHeight,
  fetchRides as fetchSupabaseRides,
  recordValidation as recordSupabaseValidation,
  syncLocalMembersToSupabase,
  subscribeToRealtime,
} from './supabase-service.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const icon = name => ({
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  cable:'<path d="M8 4v6m8-6v6M5 10h14v4a7 7 0 0 1-14 0v-4Zm7 11v-3"/>',
  printer:'<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  alert:'<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
}[name] || '<circle cx="12" cy="12" r="9"/>');
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`;
const fmt = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
const fmtSigned = value => `${Number(value) >= 0 ? '+' : ''}${fmt(value)}`;
const when = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Jakarta' }) : '—';
const todayKey = date => new Date(date).toLocaleDateString('en-CA', { timeZone:'Asia/Jakarta' });
const navs = [
  ['ringkasan', 'Ringkasan'],
  ['member', 'Member'],
  ['pengukuran', 'Pengukuran Live'],
  ['riwayat', 'Riwayat Ukur'],
];

function normalizeRoute(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (raw === 'pengunjung') return 'member';
  return navs.some(item => item[0] === raw) ? raw : 'ringkasan';
}

let state;
let route = normalizeRoute(location.hash);
let selectedVisitorId = '';
let serialSession = null;
let latestFrame = null;
let lastFrameAt = 0;
let lastSavedSequence = null;
let lastScannedRfid = '';
let toastTimer;
let historyFrom = '';
let historyTo = '';
let historySearch = '';
let historyStatus = 'all';
let historyCalibration = 'all';
let historySort = 'newest';

// Supabase & Wahana State
let supabaseStatus = isSupabaseConfigured() ? 'offline' : 'unconfigured';
let activeRides = DEFAULT_RIDES;
let selectedRideId = 'roller-coaster';
let lastValidation = null;

const modal = $('#modal');

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = error ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.className = '', 5000);
}

function commit(mutator) {
  const latest = repository.load();
  if (JSON.stringify(latest) !== JSON.stringify(state)) {
    throw new Error('Data berubah di tab lain. Muat ulang halaman sebelum menyimpan agar perubahan tidak tertimpa.');
  }
  const next = structuredClone(state);
  mutator(next);
  repository.save(next);
  state = next;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element && element.textContent !== text) element.textContent = text;
}

function setHtml(id, html) {
  const element = document.getElementById(id);
  if (element && element.innerHTML !== html) element.innerHTML = html;
}

function setDeviceStatus(id, label, tone, note = '') {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.textContent !== label) element.textContent = label;
  const className = `device-status ${tone}`;
  if (element.className !== className) element.className = className;
  if (note) element.title = note;
}

function setStatus(id, label, tone, note = '') {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.textContent !== label) element.textContent = label;
  const className = `status ${tone}`;
  if (element.className !== className) element.className = className;
  if (note) element.title = note;
}

function frameNow() {
  return latestFrame?.status === 'ok' ? latestFrame : null;
}

function isLive() {
  return Boolean(serialSession && lastFrameAt && Date.now() - lastFrameAt <= 3000);
}

function statusPill() {
  if (!serialSession) return '<span class="pill offline"><i></i>ESP32 terputus</span>';
  if (!isLive()) return '<span class="pill waiting"><i></i>Menunggu data</span>';
  return '<span class="pill online"><i></i>Data live diterima</span>';
}

function cloudPill() {
  const labels = {
    connected: 'Cloud Terhubung',
    offline: 'Mode Lokal',
    unconfigured: 'Setel Supabase',
  };
  return `<button class="cloud-pill ${supabaseStatus}" data-action="open-db-settings" title="Pengaturan Database Supabase"><i></i>${labels[supabaseStatus] || 'Supabase'}</button>`;
}

function connectionInfo() {
  if (!serialSession) return { label:'Terputus', tone:'offline' };
  if (!isLive()) return { label:'Siaga', tone:'waiting' };
  return { label:'Live', tone:'online' };
}

function sensorInfo() {
  if (!serialSession) return { label:'Tidak aktif', tone:'waiting' };
  if (!lastFrameAt) return { label:'Menunggu echo', tone:'waiting' };
  if (Date.now() - lastFrameAt > 3000) return { label:'Data kedaluwarsa', tone:'waiting' };
  if (latestFrame?.status === 'invalid') return { label:'Echo tidak valid', tone:'alarm' };
  return { label:'Echo valid', tone:'good' };
}

function calibrationInfo(frame) {
  if (!frame) return { label:'Belum ada status', tone:'waiting', note:'Menunggu pembacaan perangkat.' };
  if (frame.calibrated) return { label:'Terkalibrasi', tone:'good', note:'Offset kalibrasi telah dikonfirmasi firmware.' };
  if (frame.offsetCm !== 0) return { label:'Kalibrasi awal', tone:'waiting', note:`Offset ${fmtSigned(frame.offsetCm)} cm sudah diisi, tetapi belum dikonfirmasi firmware.` };
  return { label:'Belum dikalibrasi', tone:'waiting', note:'Offset masih 0.0 cm; lakukan kalibrasi fisik sebelum menandai selesai.' };
}

function buzzerInfo(frame) {
  if (!frame) return { label:'Pembacaan tidak valid', tone:'waiting', note:'Buzzer tidak aktif tanpa pembacaan valid.' };
  if (frame.buzzerAlarm) return { label:'Alarm aktif', tone:'alarm', note:'Estimasi tinggi di bawah 100 cm; buzzer dikendalikan firmware ESP32.' };
  return { label:'Normal', tone:'good', note:'Estimasi tinggi 100 cm atau lebih; buzzer mati.' };
}

function frameAgeText() {
  if (!lastFrameAt) {
    if (latestFrame?.status === 'invalid') return 'Pembacaan tidak valid diterima';
    return serialSession ? 'Menunggu baris data dari ESP32' : 'Menunggu koneksi perangkat';
  }
  const age = Math.max(0, Math.round((Date.now() - lastFrameAt) / 1000));
  const relative = age === 0 ? 'baru saja' : age < 60 ? `${age} detik lalu` : `${Math.round(age / 60)} menit lalu`;
  return latestFrame?.status === 'invalid' ? `Pembacaan tidak valid · ${relative}` : `Pembacaan terakhir ${relative}`;
}

function captureState() {
  const frame = frameNow();
  if (!serialSession) return { ready:false, label:'ESP32 belum terhubung', tone:'waiting' };
  if (latestFrame?.status === 'invalid') return { ready:false, label:'Pembacaan tidak valid', tone:'alarm' };
  if (!frame) return { ready:false, label:'Menunggu data valid', tone:'waiting' };
  if (!lastFrameAt || Date.now() - lastFrameAt > 3000) return { ready:false, label:'Data sensor kedaluwarsa', tone:'waiting' };
  if (!selectedVisitorId) return { ready:false, label:'Pilih member', tone:'waiting' };
  if (frame.sequence != null && frame.sequence === lastSavedSequence) return { ready:false, label:'Pembacaan ini sudah disimpan', tone:'good' };
  return { ready:true, label:'Siap disimpan', tone:'good' };
}

function header(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">COCOMANG · POS PENGUKURAN</p><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function summaryCell(label, value, unit, note) {
  return `<div class="summary-cell"><span class="summary-label">${label}</span><span class="summary-value">${value}<span class="unit">${unit}</span></span><span class="summary-note">${note}</span></div>`;
}

function liveReadout(prefix = 'live') {
  const frame = frameNow();
  const link = { label: serialSession ? 'Terhubung' : 'Terputus', tone: serialSession ? 'good' : 'waiting' };
  const sensor = sensorInfo();
  const calibration = calibrationInfo(frame);
  const buzzer = buzzerInfo(frame);
  const initialHeight = frame ? `${fmt(frame.heightCm)}<small>cm</small>` : '<span class="reading-empty">— cm</span>';
  const initialRaw = frame ? `${fmt(frame.distanceCm - frame.offsetCm)} cm` : '— cm';
  const initialDistance = frame ? `${fmt(frame.distanceCm)} cm` : '— cm';
  const initialReference = frame ? `${fmt(frame.referenceHeightCm)} cm` : '— cm';
  const initialOffset = frame ? `${fmtSigned(frame.offsetCm)} cm` : '— cm';
  const initialSamples = frame ? `${frame.validSamples}/5` : '—';
  return `<div class="live-readout" id="${prefix}-readout">
    <div class="live-primary">
      <div class="live-reading">
        <span class="instrument-label">Estimasi tinggi badan</span>
        <div class="reading-value"><strong id="${prefix}-height">${initialHeight}</strong></div>
        <span class="reading-meta" id="${prefix}-last">${frameAgeText()}</span>
      </div>
      <div class="live-device">
        <div class="device-line"><span>ESP32</span><strong class="device-status ${link.tone}" id="${prefix}-device-status">${link.label}</strong></div>
        <div class="device-line"><span>HC-SR04</span><strong class="device-status ${sensor.tone}" id="${prefix}-sensor-status">${sensor.label}</strong></div>
        <div class="device-line"><span>Buzzer</span><strong class="device-status ${buzzer.tone}" id="${prefix}-alarm" title="${escape(buzzer.note)}">${buzzer.label}</strong></div>
      </div>
    </div>
    <dl class="instrument-grid">
      <div><dt>Jarak mentah (turunan)</dt><dd id="${prefix}-raw-distance">${initialRaw}</dd></div>
      <div><dt>Jarak terkoreksi</dt><dd id="${prefix}-distance">${initialDistance}</dd></div>
      <div><dt>Tinggi referensi</dt><dd id="${prefix}-reference">${initialReference}</dd></div>
      <div><dt>Offset kalibrasi</dt><dd id="${prefix}-offset">${initialOffset}</dd></div>
      <div><dt>Sampel valid</dt><dd id="${prefix}-samples">${initialSamples}</dd></div>
      <div><dt>Status kalibrasi</dt><dd><span class="status ${calibration.tone}" id="${prefix}-calibration" title="${escape(calibration.note)}">${calibration.label}</span></dd></div>
    </dl>
  </div>`;
}

function dashboardPage() {
  const measuredMembers = state.visitors.filter(member => member.heightCm != null && member.measuredAt).length;
  const unmeasuredMembers = state.visitors.length - measuredMembers;
  const measuredToday = state.measurements.filter(item => todayKey(item.capturedAt) === todayKey(new Date())).length;
  const latest = state.measurements[0];
  const previous = state.measurements.slice(1, 5);
  const connection = connectionInfo();
  const latestPanel = latest
    ? `<div class="latest-primary">
        <span class="latest-label">Hasil tersimpan terbaru</span>
        <div class="latest-value">${fmt(latest.heightCm)}<small>cm</small></div>
        <span class="latest-name">${escape(latest.visitorName)}${latest.memberRfid ? ` <code class="rfid-badge">${escape(latest.memberRfid)}</code>` : ''}</span>
        <span class="latest-time">${when(latest.capturedAt)} WIB · jarak ${fmt(latest.distanceCm)} cm</span>
      </div>
      ${previous.length ? `<ul class="latest-list" aria-label="Pengukuran sebelumnya">${previous.map(row => `<li class="latest-row"><div><span class="latest-row-name">${escape(row.visitorName)}</span><span class="latest-row-time">${when(row.capturedAt)}</span></div><span class="latest-row-value">${fmt(row.heightCm)} cm</span></li>`).join('')}</ul>` : ''}`
    : `<div class="empty"><strong>Belum ada hasil tersimpan.</strong>Hubungkan ESP32, pilih member, lalu simpan pembacaan pertama dari pos pengukuran.<br><a class="text-button" href="#pengukuran">Buka pos pengukuran</a></div>`;
  return header('Ringkasan pos pengukuran', 'Status perangkat, registrasi member, dan hasil pengukuran terakhir dalam satu tampilan operasional.', `<a class="btn primary" href="#pengukuran">${svg('cable')} Buka pengukuran live</a>`)
    + `<section class="summary-strip" aria-label="Ringkasan operasional">
        ${summaryCell('Member', state.visitors.length, 'orang', `${measuredMembers} sudah diukur`)}
        ${summaryCell('Sudah diukur', measuredMembers, 'orang', 'Memiliki hasil sensor')}
        ${summaryCell('Belum diukur', unmeasuredMembers, 'orang', 'Menunggu pos ukur')}
        ${summaryCell('Hasil tersimpan', state.measurements.length, 'data', `${measuredToday} hari ini · WIB`)}
        <div class="summary-cell" id="device-connection-metric"><span class="summary-label">Koneksi perangkat</span><span class="summary-value summary-status ${connection.tone}" id="device-connection-value">${connection.label}</span><span class="summary-note">ESP32 · USB Serial 115200</span></div>
      </section>
      <div class="summary-grid">
        <section class="panel instrument-panel summary-instrument">
          <div class="panel-header"><div><p class="instrument-kicker">Peralatan pengukuran</p><h2>ESP32 · HC-SR04</h2><p>Pembacaan fisik melalui USB Serial · 115200 baud</p></div>${statusPill()}</div>
          ${liveReadout('dash')}
        </section>
        <section class="panel latest-panel">
          <div class="panel-header"><div><p class="eyebrow">Ledger pengukuran</p><h2>Pengukuran terakhir</h2></div><a class="text-button" href="#riwayat">Riwayat lengkap</a></div>
          ${latestPanel}
          <div class="panel-actions"><a class="btn" href="#member">Kelola member</a></div>
        </section>
      </div>`;
}

function genderText(value) {
  if (value === 'L') return 'Laki-laki';
  if (value === 'P') return 'Perempuan';
  if (value === 'Lainnya') return 'Lainnya';
  return '—';
}

function memberTable() {
  if (!state.visitors.length) return '<div class="empty"><strong>Belum ada member terdaftar.</strong>Catat identitas kartu RFID dan data member sebelum menyimpan hasil pengukuran.<br><button class="text-button" data-action="add-member">Tambah member pertama</button></div>';
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="registry-table"><caption class="sr-only">Buku registrasi member</caption><thead><tr><th>No.</th><th>UID Kartu RFID</th><th>Nama</th><th>Usia</th><th>Jenis kelamin</th><th class="numeric">Berat badan</th><th class="numeric">Tinggi badan</th><th>Status pengukuran</th><th>Waktu pengukuran</th></tr></thead><tbody>${state.visitors.map((member, index) => {
    const measured = member.heightCm != null && Boolean(member.measuredAt);
    return `<tr><td class="numeric row-index">${index + 1}</td><td><code class="rfid-badge">${escape(member.rfidUid || '—')}</code></td><td><strong class="visitor-name member-name">${escape(member.name)}</strong>${member.notes ? `<span class="row-note visitor-notes">${escape(member.notes)}</span>` : ''}</td><td class="numeric">${member.age ?? '—'}</td><td>${genderText(member.gender)}</td><td class="numeric">${member.weightKg == null ? '—' : `${fmt(member.weightKg)} kg`}</td><td class="numeric"><strong>${member.heightCm == null ? '—' : `${fmt(member.heightCm)} cm`}</strong>${measured ? '<span class="row-note">Dari sensor</span>' : ''}</td><td><span class="status ${measured ? 'good' : 'waiting'}">${measured ? 'Sudah diukur' : 'Belum diukur'}</span></td><td>${member.measuredAt ? when(member.measuredAt) : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function membersPage() {
  const measured = state.visitors.filter(member => member.heightCm != null && member.measuredAt).length;
  const unmeasured = state.visitors.length - measured;
  return header('Buku registrasi member', 'Identitas kartu RFID dan data member dicatat saat registrasi. Tinggi badan diukur via sensor HC-SR04.', `<button class="btn primary" data-action="add-member">${svg('plus')} Tambah member</button>`)
    + `<section class="panel"><div class="panel-header"><div><h2>Member terdaftar <span class="count">${state.visitors.length}</span></h2><p>${measured} sudah diukur · ${unmeasured} belum diukur · ${supabaseStatus === 'connected' ? 'tersinkronisasi ke Supabase Cloud' : 'tersimpan lokal di peramban ini'}.</p></div></div>${memberTable()}</section>`;
}

function memberOptions() {
  return state.visitors.map(member => `<option value="${escape(member.id)}" ${member.id === selectedVisitorId ? 'selected' : ''}>${escape(member.name)}${member.rfidUid ? ` [${escape(member.rfidUid)}]` : ''}${member.age ? ` · ${member.age} th` : ''}${member.heightCm != null ? ` (${fmt(member.heightCm)} cm)` : ''}</option>`).join('');
}

function rideOptions() {
  return activeRides.map(ride => {
    const maxInfo = ride.maxHeightCm ? `, Max: ${ride.maxHeightCm} cm` : '';
    return `<option value="${escape(ride.id)}" ${ride.id === selectedRideId ? 'selected' : ''}>${escape(ride.name)} (Min: ${ride.minHeightCm} cm${maxInfo})</option>`;
  }).join('');
}

function validationBannerView() {
  if (!lastValidation) {
    return `<div class="validation-banner">
      <span class="validation-badge"><span class="status waiting">Siaga Validasi</span></span>
      <p class="validation-detail">Pilih wahana dan tap kartu member pada <strong>Reader 2 (Akses Wahana)</strong> atau klik Uji Validasi.</p>
    </div>`;
  }
  const { member, ride, evaluation, timestamp } = lastValidation;
  const isOk = evaluation.eligible;
  return `<div class="validation-banner ${isOk ? 'eligible' : 'rejected'}">
    <div class="validation-badge ${isOk ? 'eligible' : 'rejected'}">
      ${svg(isOk ? 'check' : 'alert')} ${isOk ? 'LOLOS AKSES WAHANA' : 'AKSES DITOLAK'}
    </div>
    <div class="validation-detail">
      <strong>${escape(member.name)}</strong> (${escape(member.rfidUid || 'UID: —')}) · Tinggi: <strong>${fmt(evaluation.height)} cm</strong>
      <br>Wahana: <strong>${escape(ride.name)}</strong> (Batas min: ${ride.minHeightCm} cm)
      <br><small>${escape(evaluation.reason)}</small>
    </div>
    <span class="validation-meta">${when(timestamp)} WIB · Sinyal buzzer: ${isOk ? 'Bip normal' : 'Peringatan 3x'}</span>
  </div>`;
}

function measurementPage() {
  return header('Pengukuran live & validasi wahana', 'Instrumen membaca HC-SR04 dari atas kepala. Reader 1 untuk pendaftaran, Reader 2 untuk validasi batas tinggi wahana.')
    + heightMeasurementView();
}

function heightMeasurementView() {
  const readiness = captureState();
  return `<div class="measurement-layout">
      <section class="panel instrument-panel device-panel">
        <div class="panel-header"><div><p class="instrument-kicker">Kolom instrumen · Perangkat fisik</p><h2>ESP32 · HC-SR04 · Dual RFID</h2><p>Web Serial · 115200 baud · Dual MFRC522</p></div>${statusPill()}</div>
        <div class="device-controls"><button class="btn primary" id="connect-device" data-action="connect" ${serialSession ? 'disabled' : ''}>${svg('cable')} Hubungkan ESP32</button><button class="btn" id="disconnect-device" data-action="disconnect" ${serialSession ? '' : 'disabled'}>Putuskan</button></div>
        <p class="device-note" id="serial-help">Tutup Serial Monitor Arduino IDE sebelum menghubungkan perangkat. Gunakan Chrome atau Edge desktop melalui localhost atau HTTPS.</p>
        ${liveReadout('measure')}
      </section>
      <section class="panel capture-panel">
        <div class="panel-header"><div><p class="eyebrow">Pencatatan & Validasi</p><h2>Pengukuran & Akses Wahana</h2><p>Pilih member, simpan tinggi live, dan validasi syarat wahana.</p></div></div>
        <div class="capture-body">
          <div class="field"><label for="measurement-visitor">Member Terpilih <span class="req">*</span></label><select id="measurement-visitor"><option value="">Pilih member</option>${memberOptions()}</select><p class="field-help">${state.visitors.length ? 'Pilih member atau dekatkan kartu ke Reader 1 / Reader 2.' : 'Belum ada member terdaftar.'} <button type="button" class="text-button inline" data-action="add-member">+ Tambah member baru</button></p></div>
          <div class="capture-readout" aria-label="Data hasil pembacaan">
            <div class="capture-row"><span>Hasil tinggi dari ESP32</span><strong id="capture-height">— cm</strong></div>
            <div class="capture-row"><span>Jarak sensor</span><strong id="capture-distance">— cm</strong></div>
            <div class="capture-row"><span>Status validitas</span><strong class="capture-validity ${readiness.tone}" id="capture-validity">${readiness.label}</strong></div>
          </div>
          <button class="btn primary full" data-action="save-reading" id="save-reading" ${readiness.ready ? '' : 'disabled'}>${svg('check')} Simpan hasil ukur ke profil member</button>

          <div class="ride-validation-section">
            <div class="field">
              <label for="ride-selector">Wahana Permainan Tujuan</label>
              <select id="ride-selector">${rideOptions()}</select>
              <p class="field-help">Tap kartu di <strong>Reader 2</strong> untuk verifikasi instan atau klik tombol di bawah.</p>
            </div>
            <button class="btn full" data-action="manual-validate" id="btn-manual-validate">${svg('database')} Uji Validasi Akses Wahana</button>
            <div id="validation-banner-region">${validationBannerView()}</div>
          </div>
        </div>
      </section>
    </div>
    <section class="panel guide-panel">
      <div class="panel-header"><div><p class="eyebrow">Panduan operasional</p><h2>Dual RFID & Logika Wahana</h2></div><span class="guide-formula">tinggi = Href − (jarak + offset)</span></div>
      <dl class="guide-grid">
        <div class="guide-item"><dt>Reader 1 (VSPI)</dt><dd>Pos Pendaftaran: Kartu baru yang di-tap langsung membuka form registrasi member.</dd></div>
        <div class="guide-item"><dt>Reader 2 (HSPI)</dt><dd>Pos Akses Wahana: Kartu yang di-tap langsung divalidasi dengan batas tinggi wahana terpilih.</dd></div>
        <div class="guide-item"><dt>Sinyal Buzzer ESP32</dt><dd>ESP32 membunyikan 1x bip normal jika lolos, atau 3x bip peringatan jika tinggi kurang.</dd></div>
        <div class="guide-item"><dt>Database Supabase</dt><dd>Data member dan log kelayakan wahana tersimpan di PostgreSQL cloud secara real-time.</dd></div>
      </dl>
    </section>`;
}

function sortMeasurements(rows) {
  const sorted = [...rows];
  switch (historySort) {
    case 'oldest': return sorted.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
    case 'name': return sorted.sort((a, b) => a.visitorName.localeCompare(b.visitorName, 'id', { sensitivity:'base' }));
    case 'height-desc': return sorted.sort((a, b) => b.heightCm - a.heightCm);
    case 'height-asc': return sorted.sort((a, b) => a.heightCm - b.heightCm);
    default: return sorted.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  }
}

function filteredMeasurements() {
  const term = historySearch.trim().toLowerCase();
  const rows = state.measurements.filter(item => {
    const day = todayKey(item.capturedAt);
    if (historyFrom && day < historyFrom) return false;
    if (historyTo && day > historyTo) return false;
    if (term && !item.visitorName.toLowerCase().includes(term) && !(item.memberRfid && item.memberRfid.toLowerCase().includes(term))) return false;
    if (historyStatus === 'normal' && item.buzzerAlarm) return false;
    if (historyStatus === 'alarm' && !item.buzzerAlarm) return false;
    if (historyCalibration === 'confirmed' && !item.calibrated) return false;
    if (historyCalibration === 'unconfirmed' && item.calibrated) return false;
    return true;
  });
  return sortMeasurements(rows);
}

function measurementLedger(rows) {
  if (!state.measurements.length) return '<div class="empty"><strong>Belum ada hasil pengukuran.</strong>Hubungkan ESP32 melalui pos pengukuran, pilih member, lalu simpan pembacaan pertama.<br><a class="text-button" href="#pengukuran">Buka pengukuran</a></div>';
  if (!rows.length) return '<div class="empty"><strong>Tidak ada data yang cocok.</strong>Ubah rentang tanggal atau filter, lalu coba lagi.<br><button class="text-button" data-action="clear-filter">Reset semua filter</button></div>';
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="ledger-table"><caption class="sr-only">Ledger pengukuran tinggi badan member</caption><thead><tr><th>Tanggal dan waktu</th><th>Nama member</th><th class="numeric">Tinggi badan</th><th class="numeric">Jarak sensor</th><th>Status pengukuran</th><th>Status kalibrasi</th></tr></thead><tbody>${rows.map(row => `<tr><td><span class="cell-strong">${when(row.capturedAt)}</span><span class="row-note">WIB</span></td><td><span class="cell-strong member-name">${escape(row.visitorName)}</span>${row.memberRfid ? `<span class="row-note"><code class="rfid-badge">${escape(row.memberRfid)}</code></span>` : ''}</td><td class="numeric"><strong>${fmt(row.heightCm)} cm</strong><span class="row-note">Href ${fmt(row.referenceHeightCm)} · offset ${fmtSigned(row.offsetCm)}</span></td><td class="numeric">${fmt(row.distanceCm)} cm<span class="row-note">${row.validSamples}/5 sampel valid</span></td><td><span class="status good">Valid</span><span class="row-note">${row.buzzerAlarm ? 'Ambang buzzer aktif' : 'Buzzer normal'}</span></td><td><span class="status ${row.calibrated ? 'good' : 'waiting'}">${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function historyMeta(rows) {
  const total = state.measurements.length;
  return rows.length === total ? `Menampilkan seluruh ${total} data tersimpan.` : `Menampilkan ${rows.length} dari ${total} data tersimpan.`;
}

function historyToolbar() {
  const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  return `<div class="history-toolbar" aria-label="Filter riwayat pengukuran">
    <label class="tool-field search"><span>Cari nama / UID</span><input id="history-search" type="search" placeholder="Cari nama atau UID RFID" autocomplete="off" value="${escape(historySearch)}"></label>
    <label class="tool-field"><span>Dari</span><input id="history-from" type="date" value="${escape(historyFrom)}"></label>
    <label class="tool-field"><span>Sampai</span><input id="history-to" type="date" value="${escape(historyTo)}"></label>
    <label class="tool-field"><span>Status</span><select id="history-status">${option('all', 'Semua status', historyStatus)}${option('normal', 'Normal', historyStatus)}${option('alarm', 'Ambang buzzer', historyStatus)}</select></label>
    <label class="tool-field"><span>Kalibrasi</span><select id="history-calibration">${option('all', 'Semua kalibrasi', historyCalibration)}${option('confirmed', 'Terkalibrasi', historyCalibration)}${option('unconfirmed', 'Belum terkalibrasi', historyCalibration)}</select></label>
    <label class="tool-field"><span>Urutkan</span><select id="history-sort">${option('newest', 'Terbaru', historySort)}${option('oldest', 'Terlama', historySort)}${option('name', 'Nama A–Z', historySort)}${option('height-desc', 'Tinggi tertinggi', historySort)}${option('height-asc', 'Tinggi terendah', historySort)}</select></label>
    <button class="btn filter-reset" data-action="clear-filter">Reset</button>
  </div>`;
}

function historyPage() {
  const rows = filteredMeasurements();
  const exportActions = `<button class="btn" data-action="export-csv">${svg('download')} Ekspor CSV</button><button class="btn primary" data-action="print-pdf">${svg('printer')} Cetak / Simpan PDF</button>`;
  return header('Riwayat pengukuran', 'Ledger hasil aktual yang disimpan dari ESP32. Pencarian, filter, ekspor, dan cetak mengikuti data tersimpan.', exportActions)
    + `<section class="panel">
        <div class="panel-header"><div><h2>Data pengukuran <span class="count" id="history-count">${rows.length}</span></h2><p>Rekaman bertambah saat operator menekan Simpan hasil ukur.</p></div><a class="text-button" href="#pengukuran">Buka pengukuran</a></div>
        ${historyToolbar()}
        <div class="history-meta"><span id="history-result-meta">${historyMeta(rows)}</span><span>Waktu WIB · ${supabaseStatus === 'connected' ? 'Cloud & Lokal' : 'data lokal'}</span></div>
        <div id="history-table-region">${measurementLedger(rows)}</div>
      </section>`;
}

function renderHistoryTable() {
  const rows = filteredMeasurements();
  const region = $('#history-table-region');
  if (region) region.innerHTML = measurementLedger(rows);
  const count = $('#history-count');
  if (count) count.textContent = String(rows.length);
  const meta = $('#history-result-meta');
  if (meta) meta.textContent = historyMeta(rows);
}

function render() {
  const current = navs.find(item => item[0] === route)?.[1] || 'Ringkasan';
  document.title = `${current} | COCOMANG`;
  $('#app').innerHTML = `<div class="app-shell">
    <header class="masthead">
      <div class="masthead-inner">
        <a class="brand" href="#ringkasan"><span class="brand-name">COCOMANG</span><span class="brand-caption">Smart Height Measurement System</span></a>
        <div class="desk-identity"><span>Pos Ukur & Wahana</span><strong>ESP32 Dual RFID</strong></div>
        <div class="operator"><span class="mode-label">Serial 115200</span>${statusPill()}${cloudPill()}<button class="icon-button" data-action="help" aria-label="Panduan koneksi perangkat">${svg('info')}</button></div>
      </div>
      <nav class="nav-list" aria-label="Navigasi utama">${navs.map(([id, label], index) => `<a class="nav-link ${route === id ? 'active' : ''}" href="#${id}" ${route === id ? 'aria-current="page"' : ''}><span class="nav-number">0${index + 1}</span><span>${label}</span></a>`).join('')}</nav>
    </header>
    <div class="workspace"><div class="topbar"><span class="breadcrumb">Pos pengukuran <span>/</span> <strong>${current}</strong></span><span class="date-label">${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Jakarta' })}</span></div>
      <main id="main" tabindex="-1">${route === 'ringkasan' ? dashboardPage() : (route === 'member' || route === 'pengunjung') ? membersPage() : route === 'pengukuran' ? measurementPage() : historyPage()}
        <footer class="workspace-footer"><div><strong>COCOMANG</strong><span>Smart Height Measurement System · ${supabaseStatus === 'connected' ? 'Terhubung ke Supabase Cloud' : 'Mode Penyimpanan Lokal'}.</span></div><button class="link-plain" data-action="help">Petunjuk perangkat & batas integrasi</button></footer>
      </main></div></div>`;
  bindPage();
  updateConnectionUI();
}

function updateConnectionUI() {
  const connected = Boolean(serialSession);
  const live = isLive();
  const stateText = !connected ? 'ESP32 terputus' : live ? 'Data live diterima' : 'Menunggu data';
  $$('.pill').forEach(element => {
    element.className = `pill ${!connected ? 'offline' : live ? 'online' : 'waiting'}`;
    element.innerHTML = `<i></i>${stateText}`;
  });
  const connect = $('#connect-device');
  const disconnect = $('#disconnect-device');
  if (connect) connect.disabled = connected;
  if (disconnect) disconnect.disabled = !connected;
  const connection = connectionInfo();
  const connectionMetric = $('#device-connection-value');
  if (connectionMetric) {
    if (connectionMetric.textContent !== connection.label) connectionMetric.textContent = connection.label;
    const className = `summary-value summary-status ${connection.tone}`;
    if (connectionMetric.className !== className) connectionMetric.className = className;
  }

  const frame = frameNow();
  const link = { label: connected ? 'Terhubung' : 'Terputus', tone: connected ? 'good' : 'waiting' };
  const sensor = sensorInfo();
  const calibration = calibrationInfo(frame);
  const buzzer = buzzerInfo(frame);
  const ageText = frameAgeText();
  for (const prefix of ['dash', 'measure']) {
    if (!document.getElementById(`${prefix}-height`)) continue;
    setHtml(`${prefix}-height`, frame ? `${fmt(frame.heightCm)}<small>cm</small>` : '<span class="reading-empty">— cm</span>');
    setText(`${prefix}-raw-distance`, frame ? `${fmt(frame.distanceCm - frame.offsetCm)} cm` : '— cm');
    setText(`${prefix}-distance`, frame ? `${fmt(frame.distanceCm)} cm` : '— cm');
    setText(`${prefix}-reference`, frame ? `${fmt(frame.referenceHeightCm)} cm` : '— cm');
    setText(`${prefix}-offset`, frame ? `${fmtSigned(frame.offsetCm)} cm` : '— cm');
    setText(`${prefix}-samples`, frame ? `${frame.validSamples}/5` : '—');
    setText(`${prefix}-last`, ageText);
    setDeviceStatus(`${prefix}-device-status`, link.label, link.tone);
    setDeviceStatus(`${prefix}-sensor-status`, sensor.label, sensor.tone);
    setDeviceStatus(`${prefix}-alarm`, buzzer.label, buzzer.tone, buzzer.note);
    setStatus(`${prefix}-calibration`, calibration.label, calibration.tone, calibration.note);
  }

  const readiness = captureState();
  const save = $('#save-reading');
  if (save) save.disabled = !readiness.ready;
  setText('capture-height', frame ? `${fmt(frame.heightCm)} cm` : '— cm');
  setText('capture-distance', frame ? `${fmt(frame.distanceCm)} cm` : '— cm');
  const validity = $('#capture-validity');
  if (validity) {
    if (validity.textContent !== readiness.label) validity.textContent = readiness.label;
    const className = `capture-validity ${readiness.tone}`;
    if (validity.className !== className) validity.className = className;
  }
}

async function sendSerialCommand(cmd) {
  if (!serialSession?.port?.writable) return;
  try {
    const writer = serialSession.port.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(cmd + '\n'));
    writer.releaseLock();
  } catch (err) {
    console.warn('Gagal mengirim perintah serial ke ESP32:', err);
  }
}

async function handleRideValidation(member, readerId = 2) {
  const ride = activeRides.find(r => r.id === selectedRideId) || activeRides[0];
  if (!ride) return;

  const currentHeight = frameNow()?.heightCm ?? member.heightCm;
  const evaluation = validateRideEligibility(member, ride, currentHeight);

  lastValidation = {
    member,
    ride,
    evaluation,
    timestamp: new Date().toISOString(),
  };

  const bannerRegion = $('#validation-banner-region');
  if (bannerRegion) {
    bannerRegion.innerHTML = validationBannerView();
  }

  if (evaluation.eligible) {
    await sendSerialCommand('b'); // Bip 1x normal
    toast(`[VALIDASI] ${member.name} LOLOS masuk wahana ${ride.name}!`);
  } else {
    await sendSerialCommand('n'); // Bip 3x peringatan
    toast(`[VALIDASI] ${member.name} DITOLAK: ${evaluation.reason}`, true);
  }

  // Rekam ke Supabase
  try {
    const record = createValidationRecord({
      member,
      ride,
      evaluation,
      readerId,
      now: lastValidation.timestamp,
    });
    await recordSupabaseValidation(record);
  } catch (err) {
    console.warn('Gagal mencatat log validasi ke Supabase:', err);
  }
}

function processSerialLine(line) {
  const rfidEvent = parseRfidLine(line);
  if (rfidEvent) {
    lastScannedRfid = rfidEvent.uid;
    const rfidInput = document.getElementById('member-rfid');
    if (rfidInput) {
      rfidInput.value = rfidEvent.uid;
      rfidInput.focus();
      toast(`Kartu RFID terdeteksi dari reader ${rfidEvent.reader} (${rfidEvent.label}): ${rfidEvent.uid}`);
      return;
    }

    const matchedMember = state.visitors.find(m => m.rfidUid && normalizeRfid(m.rfidUid) === normalizeRfid(rfidEvent.uid));

    // Jika di-tap di Reader 2 (Akses Masuk Wahana)
    if (rfidEvent.reader === 2) {
      if (matchedMember) {
        selectedVisitorId = matchedMember.id;
        const select = document.getElementById('measurement-visitor');
        if (select) select.value = matchedMember.id;
        updateConnectionUI();
        void handleRideValidation(matchedMember, 2);
      } else {
        void sendSerialCommand('n');
        toast(`Kartu RFID ${rfidEvent.uid} di Reader Akses belum terdaftar sebagai member.`, true);
      }
      return;
    }

    // Jika di-tap di Reader 1 (Pendaftaran Member)
    if (matchedMember) {
      selectedVisitorId = matchedMember.id;
      const select = document.getElementById('measurement-visitor');
      if (select) select.value = matchedMember.id;
      updateConnectionUI();
      toast(`Member ${matchedMember.name} (${matchedMember.rfidUid}) terpilih via Reader Pendaftaran.`);
    } else {
      toast(`Kartu RFID ${rfidEvent.uid} baru terdeteksi. Membuka formulir pendaftaran member…`);
      memberForm(rfidEvent.uid);
    }
    return;
  }

  const frame = parseDeviceLine(line);
  if (!frame) return;
  latestFrame = frame;
  lastFrameAt = Date.now();
  updateConnectionUI();
}

async function connectDevice() {
  if (!('serial' in navigator)) {
    toast('Web Serial tidak tersedia. Gunakan Chrome atau Edge desktop melalui localhost atau HTTPS.', true);
    return;
  }
  if (serialSession) return;
  let port;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    const session = { port, reader: null, cancelled: false };
    serialSession = session;
    latestFrame = null;
    lastFrameAt = 0;
    lastSavedSequence = null;
    updateConnectionUI();
    toast('ESP32 terhubung. Menunggu data live dari firmware…');

    const reader = port.readable.getReader();
    session.reader = reader;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!session.cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
          buffer = buffer.slice(newlineIndex + 1);
          processSerialLine(line);
        }
        if (buffer.length > 4096) buffer = buffer.slice(-2048);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  } catch (error) {
    const message = error?.name === 'NotFoundError' ? 'Pemilihan port dibatalkan.' : error?.message || 'Tidak dapat membuka port serial.';
    if (error?.name !== 'NotFoundError') toast(`${message} Pastikan Serial Monitor ditutup dan port tidak dipakai aplikasi lain.`, true);
  } finally {
    if (serialSession?.port === port) {
      serialSession = null;
      try { if (port?.readable) await port.close(); } catch {}
      updateConnectionUI();
      if (port) toast('Koneksi ESP32 terputus.');
    }
  }
}

async function disconnectDevice() {
  const session = serialSession;
  if (!session) return;
  session.cancelled = true;
  try { await session.reader?.cancel(); } catch {}
  try { if (session.port?.readable) await session.port.close(); } catch {}
}

function openModal(title, subtitle, content) {
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${escape(title)}</h2><p>${escape(subtitle)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Tutup">${svg('close')}</button></div><div class="modal-content">${content}</div>`;
  if (!modal.open) modal.showModal();
}

function memberForm(prefillRfid = '') {
  const initialRfid = prefillRfid || lastScannedRfid || '';
  openModal('Tambah member baru', 'Registrasi kartu fisik RFID dan identitas member. Tinggi badan diukur otomatis dari sensor.', `<form id="member-form" class="form-grid" novalidate>
    <div id="form-error" role="alert"></div>
    <div class="field">
      <label for="member-rfid">UID Kartu RFID <span class="req">*</span></label>
      <input id="member-rfid" name="rfidUid" required autocomplete="off" spellcheck="false" placeholder="Contoh: 04:A1:B2:C3 atau 04A1B2C3" value="${escape(initialRfid)}">
      <p class="field-help">${serialSession ? 'Dekatkan kartu ke Reader 1 (Pendaftaran) atau masukkan kode UID.' : 'Format 4, 7, atau 10 byte heksadesimal (contoh: 04:A1:B2:C3).'}</p>
    </div>
    <div class="field"><label for="member-name">Nama lengkap <span class="req">*</span></label><input id="member-name" name="name" required minlength="2" maxlength="100" autocomplete="name" placeholder="Nama member"></div>
    <div class="field-row">
      <div class="field"><label for="member-age">Usia (tahun)</label><input id="member-age" name="age" type="number" min="1" max="120" step="1" placeholder="18"></div>
      <div class="field"><label for="member-gender">Jenis kelamin</label><select id="member-gender" name="gender"><option value="">Belum diisi</option><option value="L">Laki-laki</option><option value="P">Perempuan</option><option value="Lainnya">Lainnya</option></select></div>
      <div class="field"><label for="member-weight">Berat badan (kg)</label><input id="member-weight" name="weightKg" type="number" min="1" max="300" step="0.1" placeholder="60"></div>
    </div>
    <div class="field"><label for="member-notes">Catatan</label><textarea id="member-notes" name="notes" rows="3" maxlength="500" placeholder="Catatan member (opsional)"></textarea></div>
    <p class="form-note">Kartu RFID berfungsi sebagai tiket akses member. Tinggi badan akan diukur melalui sensor ultrasonik pada pos ukur.</p>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Batal</button><button class="btn primary" type="submit">Simpan member</button></div>
  </form>`);
  $('#member-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      let member;
      commit(next => { member = addMember(next, data); });
      selectedVisitorId = member.id;
      modal.close();
      render();
      if (route !== 'pengukuran') location.hash = 'pengukuran';
      toast(`Member ${member.name} (${member.rfidUid}) tersimpan.`);

      // Sinkronkan ke Supabase jika aktif
      if (supabaseStatus === 'connected') {
        const synced = await upsertSupabaseMember(member);
        if (synced) toast(`Member ${member.name} tersimpan ke Supabase Cloud.`);
      }
    } catch (error) {
      $('#form-error').innerHTML = `<p class="error-banner">${escape(error.message)}</p>`;
    }
  });
}

async function openSupabaseModal() {
  const cfg = getSupabaseConfig();
  const statusLabels = {
    connected: '<span class="status good">🟢 Terhubung ke Supabase Cloud</span>',
    offline: '<span class="status waiting">🟡 Mode Lokal (Kredensial tersimpan)</span>',
    unconfigured: '<span class="status">⚪ Belum Dikonfigurasi</span>',
  };

  openModal('Pengaturan Database Supabase', 'Konfigurasi PostgreSQL Cloud untuk sinkronisasi multi-device & data wahana.', `<div class="form-grid">
    <div class="db-settings-status" id="db-status-box">Status saat ini: ${statusLabels[supabaseStatus] || statusLabels.unconfigured}</div>
    <div id="db-form-error" role="alert"></div>
    <div class="field">
      <label for="sb-url">Supabase Project URL <span class="req">*</span></label>
      <input id="sb-url" type="url" placeholder="https://xyzcompany.supabase.co" value="${escape(cfg.url)}">
      <p class="field-help">Dapat dilihat di Dashboard Supabase → Project Settings → API.</p>
    </div>
    <div class="field">
      <label for="sb-key">Supabase Anon Public Key <span class="req">*</span></label>
      <input id="sb-key" type="password" placeholder="eyJhbGciOiJIUzI1NiIsIn..." value="${escape(cfg.anonKey)}">
      <p class="field-help">Kunci publik anonim (aman digunakan di browser client).</p>
    </div>
    <div class="modal-actions" style="margin-top:10px;">
      <button type="button" class="btn" id="btn-test-db">Tes Koneksi</button>
      <button type="button" class="btn" id="btn-sync-local">Sinkronkan Data Lokal ke Cloud</button>
      <button type="button" class="btn primary" id="btn-save-db">Simpan Pengaturan</button>
    </div>
    <div class="db-quick-guide">
      <strong>Catatan Setup:</strong> Pastikan tabel <code>members</code>, <code>rides</code>, dan <code>ride_validations</code> sudah dibuat menggunakan file <code>cocomang/supabase/schema.sql</code> di Supabase SQL Editor.
    </div>
  </div>`);

  $('#btn-test-db')?.addEventListener('click', async () => {
    const url = $('#sb-url').value.trim();
    const key = $('#sb-key').value.trim();
    if (!url || !key) {
      $('#db-form-error').innerHTML = '<p class="error-banner">Masukkan Project URL dan Anon Key terlebih dahulu.</p>';
      return;
    }
    $('#db-status-box').innerHTML = 'Menguji koneksi ke Supabase…';
    const result = await testSupabaseConnection(url, key);
    if (result.success) {
      $('#db-form-error').innerHTML = '';
      $('#db-status-box').innerHTML = '<span class="status good">🟢 Sukses: Terhubung ke database Supabase!</span>';
    } else {
      $('#db-form-error').innerHTML = `<p class="error-banner">${escape(result.message)}</p>`;
      $('#db-status-box').innerHTML = '<span class="status alarm">🔴 Gagal menghubungi Supabase</span>';
    }
  });

  $('#btn-save-db')?.addEventListener('click', async () => {
    const url = $('#sb-url').value.trim();
    const key = $('#sb-key').value.trim();
    saveSupabaseConfig({ url, anonKey: key });
    if (url && key) {
      const test = await testSupabaseConnection(url, key);
      supabaseStatus = test.success ? 'connected' : 'offline';
      if (test.success) {
        await initCloudData();
      }
    } else {
      supabaseStatus = 'unconfigured';
    }
    modal.close();
    render();
    toast(supabaseStatus === 'connected' ? 'Pengaturan Supabase disimpan & terhubung!' : 'Pengaturan disimpan (Mode Lokal).');
  });

  $('#btn-sync-local')?.addEventListener('click', async () => {
    if (supabaseStatus !== 'connected') {
      toast('Hubungkan Supabase terlebih dahulu sebelum sinkronisasi.', true);
      return;
    }
    const res = await syncLocalMembersToSupabase(state.visitors);
    if (res.synced > 0) {
      toast(`${res.synced} data member berhasil diunggah ke Supabase!`);
    } else {
      toast('Tidak ada data baru untuk disinkronkan.');
    }
  });
}

async function saveLiveReading() {
  if (!serialSession) throw new Error('ESP32 belum terhubung.');
  if (!latestFrame || latestFrame.status !== 'ok') throw new Error('Belum ada pembacaan live yang valid dari ESP32.');
  if (!lastFrameAt || Date.now() - lastFrameAt > 3000) throw new Error('Data sensor sudah kedaluwarsa. Tunggu pembacaan live berikutnya.');
  if (!selectedVisitorId) throw new Error('Pilih member terlebih dahulu.');
  if (latestFrame.sequence != null && latestFrame.sequence === lastSavedSequence) throw new Error('Pembacaan ini sudah disimpan. Tunggu data live berikutnya.');
  let entry;
  commit(next => { entry = recordMeasurement(next, selectedVisitorId, latestFrame); });
  lastSavedSequence = latestFrame.sequence;
  toast(`Hasil ${fmt(entry.heightCm)} cm tersimpan untuk ${entry.visitorName}.`);

  // Update tinggi member di Supabase
  const member = state.visitors.find(m => m.id === selectedVisitorId);
  if (member?.rfidUid && supabaseStatus === 'connected') {
    void updateSupabaseMemberHeight(member.rfidUid, entry.heightCm, entry.capturedAt);
  }

  render();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportMeasurementsCsv() {
  const rows = filteredMeasurements();
  if (!rows.length) {
    toast('Tidak ada data untuk diekspor pada filter saat ini.', true);
    return;
  }
  const data = rows.map(row => ({
    'Waktu WIB': when(row.capturedAt),
    'Member': row.visitorName,
    'UID RFID': row.memberRfid || '—',
    'Tinggi (cm)': row.heightCm,
    'Jarak sensor (cm)': row.distanceCm,
    'Tinggi referensi (cm)': row.referenceHeightCm,
    'Offset (cm)': row.offsetCm,
    'Sampel valid': `${row.validSamples}/5`,
    'Status pengukuran': row.buzzerAlarm ? 'Ambang buzzer aktif' : 'Normal',
    'Kalibrasi': row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi',
  }));
  download('cocomang-riwayat-pengukuran.csv', csvExport(data), 'text/csv;charset=utf-8');
}

function printPdfReport() {
  const rows = filteredMeasurements();
  if (!rows.length) {
    toast('Belum ada data pengukuran pada filter yang dipilih.', true);
    return;
  }
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('Jendela laporan diblokir. Izinkan pop-up untuk membuat PDF.', true);
    return;
  }
  const values = rows.map(row => row.heightCm);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const calibratedCount = rows.filter(row => row.calibrated).length;
  const filters = [
    historyFrom || historyTo ? `Periode ${historyFrom || 'awal data'} — ${historyTo || 'terbaru'}` : 'Seluruh data tersimpan',
    historySearch ? `Nama memuat “${historySearch}”` : '',
    historyStatus !== 'all' ? `Status ${historyStatus === 'alarm' ? 'ambang buzzer aktif' : 'normal'}` : '',
    historyCalibration !== 'all' ? `Kalibrasi ${historyCalibration === 'confirmed' ? 'terkalibrasi' : 'belum terkalibrasi'}` : '',
  ].filter(Boolean).join(' · ');
  const body = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escape(when(row.capturedAt))}</td><td>${escape(row.visitorName)}</td><td><code class="rfid-badge">${escape(row.memberRfid || '—')}</code></td><td>${fmt(row.heightCm)}</td><td>${fmt(row.distanceCm)}</td><td>${row.buzzerAlarm ? 'Ambang &lt; 100 cm' : 'Normal'}</td><td>${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</td></tr>`).join('');
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Pengukuran COCOMANG</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#243c32;margin:0}h1{font-family:Georgia,serif;font-size:22px;font-weight:600;margin:2px 0 4px}p{color:#59675d;line-height:1.5;margin:0}.brandline{display:flex;align-items:baseline;gap:10px;border-top:3px solid #254b3e;padding-top:12px}.brandline strong{font-size:16px;letter-spacing:.08em}.brandline span{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#59675d}.meta{border-bottom:1px solid #b9c1ad;padding-bottom:12px;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.summary div{border:1px solid #cbd3c5;padding:9px 10px}.summary span{display:block;color:#59675d;font-size:8px;text-transform:uppercase;letter-spacing:.06em}.summary strong{display:block;font-size:17px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #cbd3c5;padding:7px 6px;text-align:left;font-size:9px}th{background:#eef0e7;font-size:8px;text-transform:uppercase;letter-spacing:.05em}td:nth-child(1),td:nth-child(5),td:nth-child(6){font-variant-numeric:tabular-nums}.rfid-badge{display:inline-block;padding:1px 5px;font-family:monospace;font-size:8.5px;background:#eef0e7;border:1px solid #cbd3c5;border-radius:3px}.foot{margin-top:18px;font-size:9px;color:#657064;border-top:1px solid #cbd3c5;padding-top:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><div class="brandline"><strong>COCOMANG</strong><span>Smart Height Measurement System</span></div><div class="meta"><h1>Laporan Pengukuran Tinggi Badan Member</h1><p>${escape(filters)}<br>Dicetak ${escape(when(new Date().toISOString()))} WIB · sumber data: ESP32 / HC-SR04 melalui Web Serial</p></div><div class="summary"><div><span>Total pengukuran</span><strong>${rows.length}</strong></div><div><span>Rata-rata tinggi</span><strong>${fmt(average)} cm</strong></div><div><span>Rentang tinggi</span><strong>${fmt(min)}–${fmt(max)} cm</strong></div><div><span>Terkalibrasi</span><strong>${calibratedCount}/${rows.length}</strong></div></div><table><thead><tr><th>No.</th><th>Waktu</th><th>Member</th><th>UID RFID</th><th>Tinggi (cm)</th><th>Jarak (cm)</th><th>Status</th><th>Kalibrasi</th></tr></thead><tbody>${body}</tbody></table><p class="foot">Laporan dibuat dari data pengukuran yang tersimpan pada peramban ini. Hasil merupakan estimasi prototipe dan bukan sertifikat alat ukur kesehatan.</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
  printWindow.document.close();
}

function showHelp() {
  openModal('Petunjuk perangkat & Supabase', 'Koneksi, Dual RFID, dan integrasi cloud COCOMANG.', `<ul class="help-list">
    <li>Gunakan Chrome atau Edge versi desktop melalui <strong>http://localhost:8000</strong> atau HTTPS.</li>
    <li>Tutup Serial Monitor Arduino IDE sebelum menekan Hubungkan ESP32. Baud rate 115200.</li>
    <li><strong>Dual RFID:</strong> Reader 1 untuk pendaftaran member baru, Reader 2 untuk validasi akses wahana.</li>
    <li><strong>Buzzer Pasif:</strong> Menghasilkan 1x bip saat lolos syarat wahana, dan 3x bip saat tinggi badan kurang.</li>
    <li><strong>Supabase PostgreSQL:</strong> Klik tombol status Supabase di header untuk mengisi URL & Anon Key.</li>
    <li>Data tetap aman tersimpan lokal di browser meskipun tidak ada koneksi internet.</li>
    </ul><div class="modal-actions"><button class="btn primary" data-action="close-modal">Mengerti</button></div>`);
}

function bindPage() {
  $('#measurement-visitor')?.addEventListener('change', event => {
    selectedVisitorId = event.target.value;
    updateConnectionUI();
  });
  $('#ride-selector')?.addEventListener('change', event => {
    selectedRideId = event.target.value;
  });
  $('#history-from')?.addEventListener('change', event => { historyFrom = event.target.value; renderHistoryTable(); });
  $('#history-to')?.addEventListener('change', event => { historyTo = event.target.value; renderHistoryTable(); });
  $('#history-search')?.addEventListener('input', event => { historySearch = event.target.value; renderHistoryTable(); });
  $('#history-status')?.addEventListener('change', event => { historyStatus = event.target.value; renderHistoryTable(); });
  $('#history-calibration')?.addEventListener('change', event => { historyCalibration = event.target.value; renderHistoryTable(); });
  $('#history-sort')?.addEventListener('change', event => { historySort = event.target.value; renderHistoryTable(); });
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'add-member' || action === 'add-visitor') memberForm();
  else if (action === 'connect') void connectDevice();
  else if (action === 'disconnect') void disconnectDevice();
  else if (action === 'save-reading') {
    try { void saveLiveReading(); } catch (error) { toast(error.message, true); }
  }
  else if (action === 'manual-validate') {
    const member = state.visitors.find(m => m.id === selectedVisitorId);
    if (!member) {
      toast('Pilih member terlebih dahulu untuk divalidasi.', true);
      return;
    }
    void handleRideValidation(member, 2);
  }
  else if (action === 'open-db-settings') void openSupabaseModal();
  else if (action === 'export-csv') exportMeasurementsCsv();
  else if (action === 'print-pdf') printPdfReport();
  else if (action === 'clear-filter') { historyFrom = ''; historyTo = ''; historySearch = ''; historyStatus = 'all'; historyCalibration = 'all'; historySort = 'newest'; render(); }
  else if (action === 'help') showHelp();
  else if (action === 'close-modal') modal.close();
});

document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  $('#main')?.focus();
});

window.addEventListener('hashchange', () => {
  route = normalizeRoute(location.hash);
  if (state) render();
});

window.addEventListener('storage', event => {
  if (event.key === 'cocomang-live-v1' && state) {
    try { state = repository.load(); render(); toast('Data pengukuran diperbarui dari tab lain.'); }
    catch (error) { toast(error.message, true); }
  }
});

setInterval(() => {
  if (serialSession) updateConnectionUI();
}, 1000);

async function initCloudData() {
  if (!isSupabaseConfigured()) return;
  try {
    const rides = await fetchSupabaseRides();
    if (rides?.length) activeRides = rides;

    const remoteMembers = await fetchSupabaseMembers();
    if (remoteMembers?.length) {
      // Sinkronkan remote member ke local repository jika belum ada
      commit(next => {
        for (const rm of remoteMembers) {
          if (!next.visitors.some(local => local.rfidUid && normalizeRfid(local.rfidUid) === normalizeRfid(rm.rfidUid))) {
            next.visitors.push(rm);
          }
        }
      });
    }

    void subscribeToRealtime({
      onMemberChange: () => {
        toast('Data member diperbarui dari Supabase Realtime.');
        void fetchSupabaseMembers().then(updated => {
          if (updated?.length) {
            commit(next => {
              for (const rm of updated) {
                const idx = next.visitors.findIndex(local => local.rfidUid && normalizeRfid(local.rfidUid) === normalizeRfid(rm.rfidUid));
                if (idx >= 0) next.visitors[idx] = rm;
                else next.visitors.push(rm);
              }
            });
            render();
          }
        });
      },
      onValidationChange: payload => {
        if (payload?.new) {
          const val = payload.new;
          toast(`[Realtime Wahana] ${val.member_name}: ${val.is_eligible ? 'Lolos' : 'Ditolak'} (${val.ride_name})`);
        }
      },
    });
  } catch (err) {
    console.warn('initCloudData error:', err);
  }
}

async function boot() {
  try {
    state = repository.load();
    route = normalizeRoute(location.hash);

    if (isSupabaseConfigured()) {
      const cfg = getSupabaseConfig();
      const test = await testSupabaseConnection(cfg.url, cfg.anonKey);
      supabaseStatus = test.success ? 'connected' : 'offline';
      if (test.success) {
        await initCloudData();
      }
    } else {
      supabaseStatus = 'unconfigured';
    }

    render();
  } catch (error) {
    $('#app').innerHTML = `<main class="boot"><div><h1>Data belum dapat dibuka</h1><p>${escape(error.message)}</p></div></main>`;
  }
}

boot();
