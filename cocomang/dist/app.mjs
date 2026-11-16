import { repository, addMember, addVisitor, deleteMember, deleteVisitor, recordMeasurement, csvExport, normalizeRfid, formatRfid } from './data.mjs';
import { DEFAULT_RIDES, validateRideEligibility, createValidationRecord } from './ride-validator.mjs';
import {
  getMqttConfig,
  saveMqttConfig,
  connectMqtt,
  disconnectMqtt,
  getConnectionState,
  getDeviceStatus,
  onMqttConnection,
  onTelemetry,
  onRfidReader1,
  onDeviceStatusChange,
  sendBuzzerCommand,
} from './mqtt-service.mjs';
import {
  loadEnvConfig,
  getSupabaseConfig,
  saveSupabaseConfig,
  isConfigured as isSupabaseConfigured,
  testConnection as testSupabaseConnection,
  fetchMembers as fetchSupabaseMembers,
  upsertMember as upsertSupabaseMember,
  updateMemberHeight as updateSupabaseMemberHeight,
  deleteMemberFromSupabase,
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
  mqtt:'<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
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
  return Boolean(lastFrameAt && Date.now() - lastFrameAt <= 3000);
}

function mqttBrokerPill() {
  const conn = getConnectionState();
  const cfg = getMqttConfig();
  const labels = {
    connected: 'Broker Online',
    connecting: 'Menghubungkan…',
    disconnected: 'Broker Terputus',
    error: 'Broker Error',
  };
  const tone = conn === 'connected' ? 'connected' : conn === 'connecting' ? 'offline' : 'unconfigured';
  return `<button type="button" class="cloud-pill ${tone}" data-action="open-mqtt-settings" title="Broker MQTT: ${cfg.host}:${cfg.port} (${cfg.topicPrefix}). Klik untuk ubah pengaturan."><i></i><span>${labels[conn] || 'MQTT'}</span></button>`;
}

function statusPill() {
  const conn = getConnectionState();
  const live = isLive();
  if (conn !== 'connected') {
    return `<button type="button" class="pill offline" data-action="open-mqtt-settings" title="Broker MQTT terputus. Klik untuk memeriksa pengaturan koneksi."><i></i><span>Offline</span></button>`;
  }
  if (!live) {
    return `<button type="button" class="pill waiting" data-action="reconnect-mqtt" title="Broker terhubung, menunggu telemetri dari ESP32."><i></i><span>Menunggu data</span></button>`;
  }
  return `<button type="button" class="pill online" data-action="open-mqtt-settings" title="Telemetri live diterima via MQTT. Klik untuk opsi koneksi."><i></i><span>Data live diterima</span></button>`;
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
  const conn = getConnectionState();
  if (conn !== 'connected') return { label:'Terputus', tone:'offline' };
  if (!isLive()) return { label:'Siaga', tone:'waiting' };
  return { label:'Live (MQTT)', tone:'online' };
}

function sensorInfo() {
  const conn = getConnectionState();
  if (conn !== 'connected') return { label:'Tidak aktif', tone:'waiting' };
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
  return { label:'Normal', tone:'good', note:'Estimasi tinggi 100 cm atau lebih; buzzer normal.' };
}

function frameAgeText() {
  if (!lastFrameAt) {
    if (latestFrame?.status === 'invalid') return 'Pembacaan tidak valid diterima';
    return getConnectionState() === 'connected' ? 'Menunggu baris data dari ESP32' : 'Menunggu koneksi broker';
  }
  const age = Math.max(0, Math.round((Date.now() - lastFrameAt) / 1000));
  const relative = age === 0 ? 'baru saja' : age < 60 ? `${age} detik lalu` : `${Math.round(age / 60)} menit lalu`;
  return latestFrame?.status === 'invalid' ? `Pembacaan tidak valid · ${relative}` : `Pembacaan terakhir ${relative}`;
}

function captureState() {
  const frame = frameNow();
  if (getConnectionState() !== 'connected') return { ready:false, label:'Broker MQTT belum terhubung', tone:'waiting' };
  if (!isLive()) return { ready:false, label:'Menunggu telemetri ESP32', tone:'waiting' };
  if (latestFrame?.status === 'invalid') return { ready:false, label:'Pembacaan tidak valid', tone:'alarm' };
  if (!frame) return { ready:false, label:'Menunggu data valid', tone:'waiting' };
  if (!selectedVisitorId) return { ready:false, label:'Pilih member', tone:'waiting' };
  if (frame.sequence != null && frame.sequence === lastSavedSequence) return { ready:false, label:'Pembacaan ini sudah disimpan', tone:'good' };
  return { ready:true, label:'Siap disimpan ke profil member', tone:'good' };
}

function summaryCell(label, value, unit, note) {
  return `<div class="summary-cell"><span class="summary-label">${escape(label)}</span><div class="summary-metric"><span class="summary-value">${escape(String(value))}</span>${unit ? `<span class="summary-unit">${escape(unit)}</span>` : ''}</div><span class="summary-note">${escape(note)}</span></div>`;
}

function liveReadout(prefix = 'live') {
  const frame = frameNow();
  const conn = getConnectionState();
  const link = { label: conn === 'connected' ? 'Terhubung' : 'Terputus', tone: conn === 'connected' ? 'good' : 'waiting' };
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
    : `<div class="empty"><strong>Belum ada hasil tersimpan.</strong>Koneksi MQTT aktif, pilih member, lalu simpan pembacaan pertama dari pos pengukuran.<br><a class="text-button" href="#pengukuran">Buka pos pengukuran</a></div>`;
  return header('Ringkasan pos pengukuran', 'Status perangkat, registrasi member, dan hasil pengukuran terakhir dalam satu tampilan operasional.', `<a class="btn primary" href="#pengukuran">${svg('mqtt')} Buka pengukuran live</a>`)
    + `<section class="summary-strip" aria-label="Ringkasan operasional">
        ${summaryCell('Member', state.visitors.length, 'orang', `${measuredMembers} sudah diukur`)}
        ${summaryCell('Sudah diukur', measuredMembers, 'orang', 'Memiliki hasil sensor')}
        ${summaryCell('Belum diukur', unmeasuredMembers, 'orang', 'Menunggu pos ukur')}
        ${summaryCell('Hasil tersimpan', state.measurements.length, 'data', `${measuredToday} hari ini · WIB`)}
        <div class="summary-cell" id="device-connection-metric"><span class="summary-label">Koneksi perangkat</span><span class="summary-value summary-status ${connection.tone}" id="device-connection-value">${connection.label}</span><span class="summary-note">ESP32 · MQTT over Wi-Fi</span></div>
      </section>
      <div class="summary-grid">
        <section class="panel instrument-panel summary-instrument">
          <div class="panel-header"><div><p class="instrument-kicker">Peralatan pengukuran</p><h2>ESP32 · HC-SR04</h2><p>Pembacaan nirkabel melalui MQTT Cloud</p></div>${statusPill()}</div>
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
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="registry-table"><caption class="sr-only">Buku registrasi member</caption><thead><tr><th>No.</th><th>UID Kartu RFID</th><th>Nama</th><th>Usia</th><th>Jenis kelamin</th><th class="numeric">Berat badan</th><th class="numeric">Tinggi badan</th><th>Status pengukuran</th><th>Waktu pengukuran</th><th>Aksi</th></tr></thead><tbody>${state.visitors.map((member, index) => {
    const measured = member.heightCm != null && Boolean(member.measuredAt);
    return `<tr><td class="numeric row-index">${index + 1}</td><td><code class="rfid-badge">${escape(member.rfidUid || '—')}</code></td><td><strong class="visitor-name member-name">${escape(member.name)}</strong>${member.notes ? `<span class="row-note visitor-notes">${escape(member.notes)}</span>` : ''}</td><td class="numeric">${member.age ?? '—'}</td><td>${genderText(member.gender)}</td><td class="numeric">${member.weightKg == null ? '—' : `${fmt(member.weightKg)} kg`}</td><td class="numeric"><strong>${member.heightCm == null ? '—' : `${fmt(member.heightCm)} cm`}</strong>${measured ? '<span class="row-note">Dari sensor</span>' : ''}</td><td><span class="status ${measured ? 'good' : 'waiting'}">${measured ? 'Sudah diukur' : 'Belum diukur'}</span></td><td>${member.measuredAt ? when(member.measuredAt) : '—'}</td><td><button class="icon-button delete-member-btn" data-action="delete-member" data-id="${escape(member.id)}" data-name="${escape(member.name)}" data-rfid="${escape(member.rfidUid || '')}" title="Hapus member ${escape(member.name)}" aria-label="Hapus member">${svg('close')}</button></td></tr>`;
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
        <div class="panel-header"><div><p class="instrument-kicker">Kolom instrumen · Perangkat fisik</p><h2>ESP32 · HC-SR04 · Dual RFID</h2><p>MQTT Cloud · Dual MFRC522</p></div>${statusPill()}</div>
        <div class="device-controls">
          <button class="btn primary" id="mqtt-settings" data-action="open-mqtt-settings">${svg('settings')} Pengaturan Broker</button>
          <button class="btn" id="reconnect-mqtt" data-action="reconnect-mqtt">Sambung Ulang</button>
        </div>
        <p class="device-note" id="mqtt-help">ESP32 mengirim data sensor secara nirkabel melalui Wi-Fi. Dashboard terhubung via Secure WebSockets (WSS).</p>
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
  if (!state.measurements.length) return '<div class="empty"><strong>Belum ada hasil pengukuran.</strong>Koneksi MQTT aktif melalui pos pengukuran, pilih member, lalu simpan pembacaan pertama.<br><a class="text-button" href="#pengukuran">Buka pengukuran</a></div>';
  if (!rows.length) return '<div class="empty"><strong>Tidak ada data yang cocok.</strong>Ubah rentang tanggal atau filter, lalu coba lagi.<br><button class="text-button" data-action="clear-filter">Reset semua filter</button></div>';
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="ledger-table"><caption class="sr-only">Ledger pengukuran tinggi badan member</caption><thead><tr><th>Tanggal dan waktu</th><th>Nama member</th><th class="numeric">Tinggi badan</th><th class="numeric">Jarak sensor</th><th>Status pengukuran</th><th>Status kalibrasi</th></tr></thead><tbody>${rows.map(row => `<tr><td><span class="cell-strong">${when(row.capturedAt)}</span><span class="row-note">WIB</span></td><td><span class="cell-strong member-name">${escape(row.visitorName)}</span>${row.memberRfid ? `<span class="row-note"><code class="rfid-badge">${escape(row.memberRfid)}</code></span>` : ''}</td><td class="numeric"><strong>${fmt(row.heightCm)} cm</strong><span class="row-note">Href ${fmt(row.referenceHeightCm)} · offset ${fmtSigned(row.offsetCm)}</span></td><td class="numeric">${fmt(row.distanceCm)} cm<span class="row-note">${row.validSamples}/5 sampel valid</span></td><td><span class="status good">Valid</span><span class="row-note">${row.buzzerAlarm ? 'Ambang buzzer aktif' : 'Buzzer normal'}</span></td><td><span class="status ${row.calibrated ? 'good' : 'waiting'}">${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function historyMeta(rows) {
  const total = state.measurements.length;
  return rows.length === total ? `Menampilkan seluruh ${total} data tersimpan.` : `Menampilkan ${rows.length} dari ${total} data tersimpan.`;
}

function historyPage() {
  const rows = filteredMeasurements();
  return header('Ledger riwayat pengukuran', 'Audit menyeluruh pembacaan sensor ultrasonik, UID kartu RFID, dan catatan kalibrasi perangkat.', `<button class="btn" data-action="export-csv">${svg('download')} Ekspor CSV</button><button class="btn" data-action="print-pdf">${svg('printer')} Cetak laporan</button>`)
    + `<section class="panel"><div class="panel-header"><div><h2>Data pengukuran tersimpan <span class="count" id="history-count">${rows.length}</span></h2><p id="history-result-meta">${historyMeta(rows)}</p></div><button class="text-button" data-action="clear-filter">Reset filter</button></div>
        <div class="filter-strip" aria-label="Filter ledger pengukuran">
          <div class="field"><label for="history-search">Pencarian member atau UID</label><input id="history-search" value="${escape(historySearch)}" placeholder="Cari nama atau UID kartu RFID…"></div>
          <div class="field-row">
            <div class="field"><label for="history-from">Dari tanggal</label><input id="history-from" type="date" value="${escape(historyFrom)}"></div>
            <div class="field"><label for="history-to">Sampai tanggal</label><input id="history-to" type="date" value="${escape(historyTo)}"></div>
            <div class="field"><label for="history-status">Ambang tinggi</label><select id="history-status"><option value="all" ${historyStatus === 'all' ? 'selected' : ''}>Semua pembacaan</option><option value="normal" ${historyStatus === 'normal' ? 'selected' : ''}>Normal (≥ 100 cm)</option><option value="alarm" ${historyStatus === 'alarm' ? 'selected' : ''}>Ambang batas (&lt; 100 cm)</option></select></div>
            <div class="field"><label for="history-calibration">Status kalibrasi</label><select id="history-calibration"><option value="all" ${historyCalibration === 'all' ? 'selected' : ''}>Semua status</option><option value="confirmed" ${historyCalibration === 'confirmed' ? 'selected' : ''}>Terkalibrasi</option><option value="unconfirmed" ${historyCalibration === 'unconfirmed' ? 'selected' : ''}>Belum terkalibrasi</option></select></div>
            <div class="field"><label for="history-sort">Urutan tampilan</label><select id="history-sort"><option value="newest" ${historySort === 'newest' ? 'selected' : ''}>Terbaru lebih dulu</option><option value="oldest" ${historySort === 'oldest' ? 'selected' : ''}>Terlama lebih dulu</option><option value="name" ${historySort === 'name' ? 'selected' : ''}>Nama member (A–Z)</option><option value="height-desc" ${historySort === 'height-desc' ? 'selected' : ''}>Tinggi badan tertinggi</option><option value="height-asc" ${historySort === 'height-asc' ? 'selected' : ''}>Tinggi badan terendah</option></select></div>
          </div>
        </div>
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

function header(title, subtitle, actions = '') {
  return `<section class="view-header"><div class="view-intro"><p class="eyebrow">Pos pengukuran fisik</p><h1>${escape(title)}</h1><p class="view-subtitle">${escape(subtitle)}</p></div>${actions ? `<div class="view-actions">${actions}</div>` : ''}</section>`;
}

function render() {
  const current = navs.find(item => item[0] === route)?.[1] || 'Ringkasan';
  document.title = `${current} | COCOMANG`;
  $('#app').innerHTML = `<div class="app-shell">
    <header class="masthead">
      <div class="masthead-inner">
        <a class="brand" href="#ringkasan"><span class="brand-name">COCOMANG</span><span class="brand-caption">Smart Height Measurement System</span></a>
        <div class="desk-identity"><span>Pos Ukur & Wahana</span><strong>ESP32 Dual RFID</strong></div>
        <div class="operator"><span class="mode-label">MQTT Cloud</span>${mqttBrokerPill()}${statusPill()}${cloudPill()}<button class="icon-button" data-action="help" aria-label="Panduan sistem">${svg('info')}</button></div>
      </div>
      <nav class="nav-list" aria-label="Navigasi utama">${navs.map(([id, label], index) => `<a class="nav-link ${route === id ? 'active' : ''}" href="#${id}" ${route === id ? 'aria-current="page"' : ''}><span class="nav-number">0${index + 1}</span><span>${label}</span></a>`).join('')}<a class="nav-link nav-link-wahana" href="./kiosk.html" style="margin-left: auto; color: var(--green); font-weight: 600;" title="Buka Loket Wahana (Kiosk Mandiri RFID 2)"><span>Buka Loket Wahana (Kiosk) →</span></a></nav>
    </header>
    <div class="workspace"><div class="topbar"><span class="breadcrumb">Pos pengukuran <span>/</span> <strong>${current}</strong></span><span class="date-label">${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Jakarta' })}</span></div>
      <main id="main" tabindex="-1">${route === 'ringkasan' ? dashboardPage() : (route === 'member' || route === 'pengunjung') ? membersPage() : route === 'pengukuran' ? measurementPage() : historyPage()}
        <footer class="workspace-footer"><div><strong>COCOMANG</strong><span>Smart Height Measurement System · ${supabaseStatus === 'connected' ? 'Terhubung ke Supabase Cloud' : 'Mode Penyimpanan Lokal'}.</span></div><button class="link-plain" data-action="help">Petunjuk perangkat & batas integrasi</button></footer>
      </main></div></div>`;
  bindPage();
  updateConnectionUI();
}

function updateConnectionUI() {
  const conn = getConnectionState();
  const live = isLive();
  const stateText = conn !== 'connected' ? 'Offline' : live ? 'Data live diterima' : 'Menunggu data';
  $$('.pill').forEach(element => {
    element.className = `pill ${conn !== 'connected' ? 'offline' : live ? 'online' : 'waiting'}`;
    element.innerHTML = `<i></i><span>${stateText}</span>`;
    element.title = conn !== 'connected'
      ? 'Broker MQTT terputus. Klik untuk membuka pengaturan broker.'
      : live
        ? 'Data live diterima via MQTT. Klik untuk opsi koneksi.'
        : 'Broker terhubung, menunggu data dari ESP32.';
    if (element.tagName === 'BUTTON') {
      element.dataset.action = 'open-mqtt-settings';
    }
  });

  const connection = connectionInfo();
  const connectionMetric = $('#device-connection-value');
  if (connectionMetric) {
    if (connectionMetric.textContent !== connection.label) connectionMetric.textContent = connection.label;
    const className = `summary-value summary-status ${connection.tone}`;
    if (connectionMetric.className !== className) connectionMetric.className = className;
  }

  const frame = frameNow();
  const link = { label: conn === 'connected' ? 'Terhubung' : 'Terputus', tone: conn === 'connected' ? 'good' : 'waiting' };
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
    await sendBuzzerCommand('b'); // Bip 1x normal
    toast(`[VALIDASI] ${member.name} LOLOS masuk wahana ${ride.name}!`);
  } else {
    await sendBuzzerCommand('n'); // Bip 3x peringatan
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
    if (supabaseStatus === 'connected') {
      await recordSupabaseValidation(record);
    }
  } catch (err) {
    console.warn('Gagal mencatat log validasi ke Supabase:', err);
  }
}

function handleRfidEventReader1(rfidEvent) {
  if (!rfidEvent?.uid) return;
  lastScannedRfid = rfidEvent.uid;
  const rfidInput = document.getElementById('member-rfid');
  if (rfidInput) {
    rfidInput.value = rfidEvent.uid;
    rfidInput.focus();
    toast(`Kartu RFID terdeteksi dari Reader 1 (Pendaftaran): ${rfidEvent.uid}`);
    return;
  }

  const matchedMember = state.visitors.find(m => m.rfidUid && normalizeRfid(m.rfidUid) === normalizeRfid(rfidEvent.uid));
  if (matchedMember) {
    selectedVisitorId = matchedMember.id;
    const select = document.getElementById('measurement-visitor');
    if (select) select.value = matchedMember.id;
    updateConnectionUI();
    toast(`Member ${matchedMember.name} (${matchedMember.rfidUid}) terpilih via Reader 1 (Pendaftaran).`);
  } else {
    toast(`Kartu RFID ${rfidEvent.uid} terdeteksi di Reader 1. Membuka formulir pendaftaran member…`);
    memberForm(rfidEvent.uid);
  }
}

function openModal(title, subtitle, content) {
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${escape(title)}</h2><p>${escape(subtitle)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Tutup">${svg('close')}</button></div><div class="modal-content">${content}</div>`;
  if (!modal.open) modal.showModal();
}

function openMqttModal() {
  const cfg = getMqttConfig();
  const conn = getConnectionState();
  const labels = {
    connected: '<span class="status good">🟢 Terhubung ke Broker Cloud</span>',
    connecting: '<span class="status waiting">🟡 Sedang Menghubungkan…</span>',
    disconnected: '<span class="status">⚪ Terputus</span>',
    error: '<span class="status alarm">🔴 Gagal Terhubung</span>',
  };

  openModal('Pengaturan MQTT Cloud Broker', 'Konfigurasi broker MQTT over WebSockets untuk komunikasi nirkabel dengan ESP32.', `<form id="mqtt-form" class="form-grid">
    <div class="db-settings-status">Status Broker: ${labels[conn] || labels.disconnected}</div>
    <div id="mqtt-form-error" role="alert"></div>
    <div class="field">
      <label for="mqtt-host">Broker Host (WebSocket) <span class="req">*</span></label>
      <input id="mqtt-host" name="host" required placeholder="broker.emqx.io" value="${escape(cfg.host)}">
      <p class="field-help">Default: <code>broker.emqx.io</code> (atau cluster HiveMQ Cloud Anda).</p>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="mqtt-port">Port WebSocket <span class="req">*</span></label>
        <input id="mqtt-port" name="port" type="number" required placeholder="8084" value="${cfg.port}">
      </div>
      <div class="field">
        <label for="mqtt-protocol">Protokol</label>
        <select id="mqtt-protocol" name="protocol">
          <option value="wss" ${cfg.protocol === 'wss' ? 'selected' : ''}>WSS (Secure WebSocket)</option>
          <option value="ws" ${cfg.protocol === 'ws' ? 'selected' : ''}>WS (Plain WebSocket)</option>
        </select>
      </div>
      <div class="field">
        <label for="mqtt-path">WebSocket Path</label>
        <input id="mqtt-path" name="path" placeholder="/mqtt" value="${escape(cfg.path)}">
      </div>
    </div>
    <div class="field">
      <label for="mqtt-prefix">Topic Prefix <span class="req">*</span></label>
      <input id="mqtt-prefix" name="topicPrefix" required placeholder="cocomang" value="${escape(cfg.topicPrefix)}">
      <p class="field-help">Harus sama dengan <code>MQTT_TOPIC_PREFIX</code> pada firmware ESP32 (contoh: <code>cocomang</code>).</p>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="mqtt-user">Username (opsional)</label>
        <input id="mqtt-user" name="username" placeholder="Kosongkan jika anonymous" value="${escape(cfg.username || '')}">
      </div>
      <div class="field">
        <label for="mqtt-pass">Password (opsional)</label>
        <input id="mqtt-pass" name="password" type="password" placeholder="Password broker" value="${escape(cfg.password || '')}">
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="close-modal">Batal</button>
      <button class="btn primary" type="submit">Simpan & Sambungkan</button>
    </div>
  </form>`);

  $('#mqtt-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.port = Number(data.port) || 8084;
    saveMqttConfig(data);
    modal.close();
    toast('Menghubungkan ke broker MQTT…');
    connectMqtt(data);
  });
}

function memberForm(prefillRfid = '') {
  const initialRfid = prefillRfid || lastScannedRfid || '';
  openModal('Tambah member baru', 'Registrasi kartu fisik RFID dan identitas member. Tinggi badan diukur otomatis dari sensor.', `<form id="member-form" class="form-grid" novalidate>
    <div id="form-error" role="alert"></div>
    <div class="field">
      <label for="member-rfid">UID Kartu RFID <span class="req">*</span></label>
      <input id="member-rfid" name="rfidUid" required autocomplete="off" spellcheck="false" placeholder="Contoh: 04:A1:B2:C3 atau 04A1B2C3" value="${escape(initialRfid)}">
      <p class="field-help">Dekatkan kartu ke <strong>Reader 1 (Pendaftaran)</strong> untuk auto-fill atau ketik manual.</p>
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
  $('#member-form')?.addEventListener('submit', async event => {
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
    ${cfg.fromEnv ? '<div class="notice" style="margin-bottom:12px;"><strong>Konfigurasi Otomatis:</strong> Kredensial saat ini dimuat langsung dari file <code>.env</code>.</div>' : ''}
    <div id="db-form-error" role="alert"></div>
    <div class="field">
      <label for="sb-url">Supabase Project URL <span class="req">*</span></label>
      <input id="sb-url" type="url" placeholder="https://xyzcompany.supabase.co" value="${escape(cfg.url)}">
      <p class="field-help">Dapat dilihat di Dashboard Supabase → Project Settings → API.</p>
    </div>
    <div class="field">
      <label for="sb-key">Supabase Anon Public API Key <span class="req">*</span></label>
      <input id="sb-key" type="password" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." value="${escape(cfg.anonKey)}">
      <p class="field-help">Gunakan <code>anon</code> / <code>public</code> key yang aman untuk browser.</p>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="close-modal">Batal</button>
      <button class="btn" id="btn-test-db">Uji Koneksi</button>
      <button class="btn primary" id="btn-save-db">Simpan Konfigurasi</button>
    </div>
    ${supabaseStatus === 'connected' ? '<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;"><button type="button" class="btn tiny" id="btn-sync-local" style="width:100%;">Sinkronkan Seluruh Data Lokal ke Cloud</button></div>' : ''}
  </div>`);

  $('#btn-test-db')?.addEventListener('click', async () => {
    const url = $('#sb-url').value.trim();
    const key = $('#sb-key').value.trim();
    const errBox = $('#db-form-error');
    errBox.innerHTML = '<p class="notice">Menguji koneksi ke Supabase…</p>';
    const res = await testSupabaseConnection(url, key);
    if (res.success) {
      errBox.innerHTML = '<p class="status good" style="padding:8px 12px;border-radius:4px;">Koneksi berhasil! Database PostgreSQL siap digunakan.</p>';
    } else {
      errBox.innerHTML = `<p class="error-banner">${escape(res.error)}</p>`;
    }
  });

  $('#btn-save-db')?.addEventListener('click', async () => {
    const url = $('#sb-url').value.trim();
    const key = $('#sb-key').value.trim();
    if (!url || !key) {
      $('#db-form-error').innerHTML = '<p class="error-banner">URL dan Anon Key wajib diisi.</p>';
      return;
    }
    saveSupabaseConfig({ url, anonKey: key });
    toast('Konfigurasi database disimpan.');
    modal.close();

    const test = await testSupabaseConnection(url, key);
    supabaseStatus = test.success ? 'connected' : 'offline';
    if (test.success) {
      toast('Berhasil terhubung ke Supabase Cloud!');
      await initCloudData();
    }
    render();
  });

  $('#btn-sync-local')?.addEventListener('click', async () => {
    const btn = $('#btn-sync-local');
    btn.disabled = true;
    btn.textContent = 'Menyinkronkan…';
    const result = await syncLocalMembersToSupabase(state.visitors);
    btn.disabled = false;
    btn.textContent = 'Sinkronkan Seluruh Data Lokal ke Cloud';
    if (result.success) {
      toast(`Sinkronisasi berhasil: ${result.count} member terunggah.`);
      modal.close();
    } else {
      $('#db-form-error').innerHTML = `<p class="error-banner">${escape(result.error)}</p>`;
    }
  });
}

function saveLiveReading() {
  const readiness = captureState();
  if (!readiness.ready) throw new Error(readiness.label);
  const frame = frameNow();
  if (!frame) throw new Error('Data frame belum valid.');
  const member = state.visitors.find(m => m.id === selectedVisitorId);
  if (!member) throw new Error('Pilih member terlebih dahulu.');

  let entry;
  commit(next => {
    entry = recordMeasurement(next, {
      visitorId: member.id,
      visitorName: member.name,
      memberRfid: member.rfidUid || '',
      distanceCm: frame.distanceCm,
      heightCm: frame.heightCm,
      sequence: frame.sequence,
      buzzerAlarm: frame.buzzerAlarm,
      calibrated: frame.calibrated,
    });
  });

  lastSavedSequence = frame.sequence;
  updateConnectionUI();
  toast(`Tinggi ${member.name} (${fmt(frame.heightCm)} cm) berhasil disimpan.`);

  // Sinkronkan perubahan tinggi member ke Supabase Cloud
  if (supabaseStatus === 'connected' && member.rfidUid) {
    void updateSupabaseMemberHeight(member.rfidUid, frame.heightCm, entry.capturedAt);
  }
}

function exportMeasurementsCsv() {
  const csv = csvExport(state.measurements);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cocomang-pengukuran-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a);
  toast('Berkas CSV berhasil diunduh.');
}

function printPdfReport() {
  const rows = filteredMeasurements();
  if (!rows.length) {
    toast('Tidak ada data riwayat yang dapat dicetak.', true);
    return;
  }
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('Gagal membuka jendela cetak. Periksa setelan pop-up browser.', true);
    return;
  }
  const average = rows.reduce((acc, row) => acc + row.heightCm, 0) / rows.length;
  const min = Math.min(...rows.map(row => row.heightCm));
  const max = Math.max(...rows.map(row => row.heightCm));
  const calibratedCount = rows.filter(row => row.calibrated).length;
  const filters = [
    historySearch ? `pencarian: "${historySearch}"` : '',
    historyStatus !== 'all' ? `ambang: ${historyStatus}` : '',
    historyCalibration !== 'all' ? `kalibrasi: ${historyCalibration}` : '',
  ].filter(Boolean).join(' · ') || 'Semua data riwayat';

  const body = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escape(when(row.capturedAt))}</td><td>${escape(row.visitorName)}</td><td><code class="rfid-badge">${escape(row.memberRfid || '—')}</code></td><td>${fmt(row.heightCm)}</td><td>${fmt(row.distanceCm)}</td><td>${row.buzzerAlarm ? 'Ambang &lt; 100 cm' : 'Normal'}</td><td>${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</td></tr>`).join('');
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Pengukuran COCOMANG</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#243c32;margin:0}h1{font-family:Georgia,serif;font-size:22px;font-weight:600;margin:2px 0 4px}p{color:#59675d;line-height:1.5;margin:0}.brandline{display:flex;align-items:baseline;gap:10px;border-top:3px solid #254b3e;padding-top:12px}.brandline strong{font-size:16px;letter-spacing:.08em}.brandline span{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#59675d}.meta{border-bottom:1px solid #b9c1ad;padding-bottom:12px;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.summary div{border:1px solid #cbd3c5;padding:9px 10px}.summary span{display:block;color:#59675d;font-size:8px;text-transform:uppercase;letter-spacing:.06em}.summary strong{display:block;font-size:17px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #cbd3c5;padding:7px 6px;text-align:left;font-size:9px}th{background:#eef0e7;font-size:8px;text-transform:uppercase;letter-spacing:.05em}td:nth-child(1),td:nth-child(5),td:nth-child(6){font-variant-numeric:tabular-nums}.rfid-badge{display:inline-block;padding:1px 5px;font-family:monospace;font-size:8.5px;background:#eef0e7;border:1px solid #cbd3c5;border-radius:3px}.foot{margin-top:18px;font-size:9px;color:#657064;border-top:1px solid #cbd3c5;padding-top:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><div class="brandline"><strong>COCOMANG</strong><span>Smart Height Measurement System</span></div><div class="meta"><h1>Laporan Pengukuran Tinggi Badan Member</h1><p>${escape(filters)}<br>Dicetak ${escape(when(new Date().toISOString()))} WIB · sumber data: ESP32 / HC-SR04 melalui MQTT Cloud</p></div><div class="summary"><div><span>Total pengukuran</span><strong>${rows.length}</strong></div><div><span>Rata-rata tinggi</span><strong>${fmt(average)} cm</strong></div><div><span>Rentang tinggi</span><strong>${fmt(min)}–${fmt(max)} cm</strong></div><div><span>Terkalibrasi</span><strong>${calibratedCount}/${rows.length}</strong></div></div><table><thead><tr><th>No.</th><th>Waktu</th><th>Member</th><th>UID RFID</th><th>Tinggi (cm)</th><th>Jarak (cm)</th><th>Status</th><th>Kalibrasi</th></tr></thead><tbody>${body}</tbody></table><p class="foot">Laporan dibuat dari data pengukuran yang tersimpan pada peramban ini. Hasil merupakan estimasi prototipe.</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
  printWindow.document.close();
}

function showHelp() {
  openModal('Petunjuk Sistem & MQTT Cloud', 'Komunikasi nirkabel, Dual RFID, dan integrasi cloud COCOMANG.', `<ul class="help-list">
    <li><strong>Komunikasi MQTT Nirkabel:</strong> ESP32 terhubung ke Wi-Fi dan mengirim telemetri ke Cloud Broker (default: <code>broker.emqx.io</code> via WSS).</li>
    <li><strong>Dual RFID:</strong> Reader 1 untuk pendaftaran member di pos ukur, Reader 2 untuk validasi akses di loket wahana.</li>
    <li><strong>Buzzer Dua Arah:</strong> Menghasilkan 1x bip saat lolos syarat wahana, dan 3x bip saat syarat tidak terpenuhi via perintah MQTT.</li>
    <li><strong>Multi-Device:</strong> Pos pendaftaran dan Loket Wahana (Kiosk) dapat dibuka di perangkat berbeda secara bersamaan melalui internet.</li>
    <li><strong>Supabase PostgreSQL:</strong> Kredensial cloud database menyinkronkan data member antar-perangkat secara instan.</li>
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
  else if (action === 'delete-member') {
    const id = button.dataset.id;
    const name = button.dataset.name || 'Member';
    const rfid = button.dataset.rfid;
    if (!confirm(`Hapus member "${name}"${rfid ? ` (${rfid})` : ''}?\nData member akan dihapus secara permanen dari sistem.`)) return;

    try {
      commit(next => { deleteMember(next, id); });
      if (selectedVisitorId === id) selectedVisitorId = '';
      if (rfid && supabaseStatus === 'connected') {
        void deleteMemberFromSupabase(rfid);
      }
      render();
      toast(`Member "${name}" berhasil dihapus.`);
    } catch (err) {
      toast(err.message, true);
    }
  }
  else if (action === 'open-mqtt-settings') openMqttModal();
  else if (action === 'reconnect-mqtt') {
    toast('Menghubungkan ulang ke broker MQTT…');
    void connectMqtt();
  }
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
  else if (action === 'clear-filter') { historyFrom = ''; historyTo = ''; historySearch = ''; historyStatus = 'all'; historyCalibration = 'all'; historySort = 'newest'; renderHistoryTable(); }
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
  updateConnectionUI();
}, 1000);

async function initCloudData() {
  if (!isSupabaseConfigured()) return;
  try {
    const rides = await fetchSupabaseRides();
    if (rides?.length) activeRides = rides;

    const remoteMembers = await fetchSupabaseMembers();
    if (remoteMembers?.length) {
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

function initMqtt() {
  onMqttConnection(() => {
    updateConnectionUI();
  });
  onDeviceStatusChange(() => {
    updateConnectionUI();
  });
  onTelemetry(frame => {
    latestFrame = frame;
    lastFrameAt = Date.now();
    updateConnectionUI();
  });
  onRfidReader1(rfidEvent => {
    handleRfidEventReader1(rfidEvent);
  });

  void connectMqtt();
}

async function boot() {
  try {
    state = repository.load();
    route = normalizeRoute(location.hash);

    await loadEnvConfig();

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
    initMqtt();
  } catch (error) {
    $('#app').innerHTML = `<main class="boot"><div><h1>Data belum dapat dibuka</h1><p>${escape(error.message)}</p></div></main>`;
  }
}

boot();
