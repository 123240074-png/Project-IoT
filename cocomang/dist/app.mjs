import { repository, addVisitor, recordMeasurement, csvExport } from './data.mjs';
import { parseDeviceLine } from './serial-protocol.mjs';
import { OBJECT_DEFAULTS, evaluateObjectDetection, objectError, validateObjectRange } from './object-detection.mjs';
import { OBJECT_TESTS_STORAGE_KEY, appendObjectTest, createEmptyObjectTests, createObjectTestResult, loadObjectTests, objectTestsCsv } from './object-tests.mjs';
import {
  OBJECT_DIRECTIONS,
  DEFAULT_OBJECT_DIRECTION,
  DEFAULT_OBJECT_POSITION_MODE,
  normalizeObjectDirection,
  objectDirectionMeta,
  normalizeObjectPositionMode,
  renderObjectSvg,
} from './object-direction.mjs';

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
}[name] || '<circle cx="12" cy="12" r="9"/>');
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`;
const fmt = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
const fmtSigned = value => `${Number(value) >= 0 ? '+' : ''}${fmt(value)}`;
const when = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Jakarta' }) : '—';
const todayKey = date => new Date(date).toLocaleDateString('en-CA', { timeZone:'Asia/Jakarta' });
const navs = [['ringkasan','Ringkasan'],['pengunjung','Pengunjung'],['pengukuran','Pengukuran Live'],['riwayat','Riwayat Ukur']];

let state;
let route = location.hash.slice(1) || 'ringkasan';
let selectedVisitorId = '';
let serialSession = null;
let latestFrame = null;
let lastFrameAt = 0;
let lastSavedSequence = null;
let toastTimer;
let historyFrom = '';
let historyTo = '';
let historySearch = '';
let historyStatus = 'all';
let historyCalibration = 'all';
let historySort = 'newest';
let measurementMode = 'height';
let objectSettings = { minCm: OBJECT_DEFAULTS.minCm, maxCm: OBJECT_DEFAULTS.maxCm, toleranceCm: OBJECT_DEFAULTS.toleranceCm, sampleCount: OBJECT_DEFAULTS.sampleCount };
let objectDistances = [];
let objectLastSequence = null;
let objectTestStartedAt = 0;
let objectResult = null;
let objectRecorded = false;
let objectTargetCm = '';
let objectActualCm = '';
let objectDirection = DEFAULT_OBJECT_DIRECTION;
let objectPositionMode = DEFAULT_OBJECT_POSITION_MODE;
let objectTests = createEmptyObjectTests();
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
  if (!selectedVisitorId) return { ready:false, label:'Pilih pengunjung', tone:'waiting' };
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
  const measuredVisitors = state.visitors.filter(visitor => visitor.heightCm != null && visitor.measuredAt).length;
  const unmeasuredVisitors = state.visitors.length - measuredVisitors;
  const measuredToday = state.measurements.filter(item => todayKey(item.capturedAt) === todayKey(new Date())).length;
  const latest = state.measurements[0];
  const previous = state.measurements.slice(1, 5);
  const connection = connectionInfo();
  const latestPanel = latest
    ? `<div class="latest-primary">
        <span class="latest-label">Hasil tersimpan terbaru</span>
        <div class="latest-value">${fmt(latest.heightCm)}<small>cm</small></div>
        <span class="latest-name">${escape(latest.visitorName)}</span>
        <span class="latest-time">${when(latest.capturedAt)} WIB · jarak ${fmt(latest.distanceCm)} cm</span>
      </div>
      ${previous.length ? `<ul class="latest-list" aria-label="Pengukuran sebelumnya">${previous.map(row => `<li class="latest-row"><div><span class="latest-row-name">${escape(row.visitorName)}</span><span class="latest-row-time">${when(row.capturedAt)}</span></div><span class="latest-row-value">${fmt(row.heightCm)} cm</span></li>`).join('')}</ul>` : ''}`
    : `<div class="empty"><strong>Belum ada hasil tersimpan.</strong>Hubungkan ESP32, pilih pengunjung, lalu simpan pembacaan pertama dari pos pengukuran.<br><a class="text-button" href="#pengukuran">Buka pos pengukuran</a></div>`;
  return header('Ringkasan pos pengukuran', 'Status perangkat, registrasi pengunjung, dan hasil pengukuran terakhir dalam satu tampilan operasional.', `<a class="btn primary" href="#pengukuran">${svg('cable')} Buka pengukuran live</a>`)
    + `<section class="summary-strip" aria-label="Ringkasan operasional">
        ${summaryCell('Pengunjung', state.visitors.length, 'orang', `${measuredVisitors} sudah diukur`)}
        ${summaryCell('Sudah diukur', measuredVisitors, 'orang', 'Memiliki hasil sensor')}
        ${summaryCell('Belum diukur', unmeasuredVisitors, 'orang', 'Menunggu pos ukur')}
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
          <div class="panel-actions"><a class="btn" href="#pengunjung">Kelola pengunjung</a></div>
        </section>
      </div>`;
}

function genderText(value) {
  if (value === 'L') return 'Laki-laki';
  if (value === 'P') return 'Perempuan';
  if (value === 'Lainnya') return 'Lainnya';
  return '—';
}

function visitorTable() {
  if (!state.visitors.length) return '<div class="empty"><strong>Belum ada pengunjung terdaftar.</strong>Catat identitas manual sebelum menyimpan hasil pengukuran.<br><button class="text-button" data-action="add-visitor">Tambah pengunjung pertama</button></div>';
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="registry-table"><caption class="sr-only">Buku registrasi pengunjung</caption><thead><tr><th>No.</th><th>Nama</th><th>Usia</th><th>Jenis kelamin</th><th class="numeric">Berat badan</th><th class="numeric">Tinggi badan</th><th>Status pengukuran</th><th>Waktu pengukuran</th></tr></thead><tbody>${state.visitors.map((visitor, index) => {
    const measured = visitor.heightCm != null && Boolean(visitor.measuredAt);
    return `<tr><td class="numeric row-index">${index + 1}</td><td><strong class="visitor-name">${escape(visitor.name)}</strong>${visitor.notes ? `<span class="row-note visitor-notes">${escape(visitor.notes)}</span>` : ''}</td><td class="numeric">${visitor.age ?? '—'}</td><td>${genderText(visitor.gender)}</td><td class="numeric">${visitor.weightKg == null ? '—' : `${fmt(visitor.weightKg)} kg`}</td><td class="numeric"><strong>${visitor.heightCm == null ? '—' : `${fmt(visitor.heightCm)} cm`}</strong>${measured ? '<span class="row-note">Dari sensor</span>' : ''}</td><td><span class="status ${measured ? 'good' : 'waiting'}">${measured ? 'Sudah diukur' : 'Belum diukur'}</span></td><td>${visitor.measuredAt ? when(visitor.measuredAt) : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function visitorsPage() {
  const measured = state.visitors.filter(visitor => visitor.heightCm != null && visitor.measuredAt).length;
  const unmeasured = state.visitors.length - measured;
  return header('Buku registrasi pengunjung', 'Identitas dicatat manual. Tinggi badan hanya berasal dari pembacaan sensor, bukan input operator.', `<button class="btn primary" data-action="add-visitor">${svg('plus')} Tambah pengunjung</button>`)
    + `<section class="panel"><div class="panel-header"><div><h2>Pengunjung terdaftar <span class="count">${state.visitors.length}</span></h2><p>${measured} sudah diukur · ${unmeasured} belum diukur · data tersimpan lokal di peramban ini.</p></div></div>${visitorTable()}</section>`;
}

function visitorOptions() {
  return state.visitors.map(visitor => `<option value="${escape(visitor.id)}" ${visitor.id === selectedVisitorId ? 'selected' : ''}>${escape(visitor.name)}${visitor.age ? ` · ${visitor.age} th` : ''}</option>`).join('');
}

function measurementModeBar() {
  const objectMode = measurementMode === 'object';
  return `<div class="measurement-mode-bar">
    <div class="mode-tabs" role="group" aria-label="Mode pengukuran live">
      <button type="button" class="mode-tab" data-action="measurement-mode" data-mode="height" aria-pressed="${objectMode ? 'false' : 'true'}">Pengukuran tinggi</button>
      <button type="button" class="mode-tab" data-action="measurement-mode" data-mode="object" aria-pressed="${objectMode ? 'true' : 'false'}">Deteksi objek</button>
    </div>
    <p class="mode-note">${objectMode ? 'Pengujian objek universal dengan HC-SR04 (6 arah pengujian manual) dan tidak menambah riwayat pengunjung.' : 'Mode pengukuran tinggi tetap menjadi alur penyimpanan pengunjung.'}</p>
  </div>`;
}

function objectDetectionText(code) {
  return ({
    IN_RANGE: 'Dalam rentang target',
    TOO_CLOSE: 'Terlalu dekat',
    TOO_FAR: 'Terlalu jauh',
    INVALID: 'Echo tidak valid',
    WAITING: 'Menunggu data',
    OFFLINE: 'Perangkat offline',
  })[code] || 'Menunggu data';
}

function objectStatusView(result, started) {
  const detection = objectDetectionText(result?.detectionStatus);
  const detectionTone = ({
    IN_RANGE: 'good',
    TOO_CLOSE: 'alarm',
    TOO_FAR: 'waiting',
    INVALID: 'alarm',
    WAITING: 'waiting',
    OFFLINE: 'alarm',
  })[result?.detectionStatus] || 'waiting';
  const common = { detection, detectionTone };
  if (!serialSession) {
    return { ...common, stability:'DEVICE_OFFLINE', tone:'alarm', note:'Hubungkan ESP32 untuk mulai menerima echo sensor.' };
  }
  if (result?.status === 'DEVICE_OFFLINE') {
    return { ...common, stability:'DEVICE_OFFLINE', tone:'alarm', note:'Data sensor tidak diperbarui lebih dari 3 detik. Buffer pengujian dikosongkan.' };
  }
  if (!started) {
    if (result?.status === 'INVALID') {
      return { ...common, stability:'INVALID', tone:'alarm', note:'Echo tidak valid. Periksa posisi sensor dan objek, lalu mulai pengujian.' };
    }
    if (result?.detectionStatus === 'TOO_CLOSE' || result?.detectionStatus === 'TOO_FAR') {
      return { ...common, stability:'NO_OBJECT', tone:'waiting', note:`Pratinjau berada di luar rentang ${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm. Tekan Mulai pengujian untuk mencoba.` };
    }
    if (!result || result.detectionStatus === 'WAITING') {
      return { ...common, stability:'NO_OBJECT', tone:'waiting', note:'Menunggu baris data dari ESP32. Tekan Mulai pengujian setelah echo terbaca.' };
    }
    return { ...common, stability:'SIAP DIMULAI', tone:'waiting', note:'Echo valid terdeteksi. Tekan Mulai pengujian untuk mengumpulkan 5 sampel.' };
  }
  if (result?.status === 'INVALID') {
    return { ...common, stability:'INVALID', tone:'alarm', note:'Echo tidak valid. Buffer pengujian dikosongkan; tunggu pembacaan valid berikutnya.' };
  }
  if (result?.status === 'NO_OBJECT' && result.detectionStatus === 'WAITING') {
    return { ...common, stability:'NO_OBJECT', tone:'waiting', note:'Menunggu baris data dari ESP32 sebelum mengambil sampel baru.' };
  }
  if (result?.status === 'NO_OBJECT') {
    return { ...common, stability:'NO_OBJECT', tone: result.detectionStatus === 'TOO_CLOSE' ? 'alarm' : 'waiting', note:`Objek di luar rentang ${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm. Buffer dikosongkan.` };
  }
  if (result?.status === 'STABLE') {
    return { ...common, stability:'STABLE', tone:'good', note:`Rentang ${fmt(result.stabilityRangeCm)} cm dalam toleransi ${fmt(result.toleranceCm)} cm.` };
  }
  if (result?.status === 'UNSTABLE') {
    return { ...common, stability:'UNSTABLE', tone:'waiting', note:`Rentang ${fmt(result.stabilityRangeCm)} cm melebihi toleransi ${fmt(result.toleranceCm)} cm. Ulangi pengujian.` };
  }
  if (result?.status === 'COLLECTING') {
    return { ...common, stability:'COLLECTING', tone:'waiting', note:`${result.sampleCount}/${result.sampleTarget} sampel. Pertahankan posisi objek tetap diam di area target.` };
  }
  return { ...common, stability:'NO_OBJECT', tone:'waiting', note:'Menunggu data sensor.' };
}

function directionSelector() {
  const meta = objectDirectionMeta(objectDirection);
  const cards = OBJECT_DIRECTIONS.map(dir => {
    const isActive = dir.code === objectDirection;
    return `<button type="button" class="direction-card ${isActive ? 'is-active' : ''}" data-action="object-direction" data-direction="${dir.code}" aria-pressed="${isActive}">
      <div class="direction-card-top"><span class="direction-arrow">${dir.arrow}</span><span class="direction-axis-badge">${dir.axisCode}</span></div>
      <span class="direction-title">${dir.label}</span>
      <span class="direction-code">${dir.code}</span>
      <span class="direction-hint">${dir.hint}</span>
    </button>`;
  }).join('');
  return `<div class="direction-selector-wrapper">
    <div class="direction-header">
      <span class="direction-kicker">Arah Pengujian Sensor</span>
      <p class="direction-status-text">Arah aktif: <strong>${meta.label} (${meta.axisCode})</strong> &mdash; ${meta.waveDirection}</p>
    </div>
    <div class="direction-grid" role="group" aria-label="Pilihan arah pengujian sensor">${cards}</div>
    <div class="object-hardware-warning">
      <span class="warning-badge">${svg('info')} HARDWARE</span>
      <p class="warning-message">Orientasi fisik sensor HC-SR04 <strong>harus disesuaikan secara manual</strong> oleh operator. Satu sensor hanya mengukur jarak 1D sepanjang arah pancaran. Enam pilihan arah adalah konfigurasi pengujian, bukan enam sensor simultan.</p>
    </div>
  </div>`;
}

function objectVisualization() {
  const vizState = !serialSession ? 'offline' : 'idle';
  const liveD = latestFrame?.status === 'ok' ? latestFrame.distanceCm : null;
  const svgContent = renderObjectSvg({
    direction: objectDirection,
    liveDistanceCm: liveD,
    targetDistanceCm: Number(objectTargetCm) || null,
    minCm: objectSettings.minCm,
    maxCm: objectSettings.maxCm,
    positionMode: objectPositionMode,
    state: vizState,
  });
  return `<div class="object-visual">
    <div class="object-viz" id="object-viz" data-state="${vizState}" data-direction="${objectDirection}">
      ${svgContent}
    </div>
    <p class="object-viz-caption"><span>Objek target universal. Bukan computer vision. HC-SR04 hanya mengukur jarak 1D.</span><strong id="object-viz-state">${vizState.toUpperCase()}</strong></p>
  </div>`;
}

function objectControlPanel() {
  const started = Boolean(objectTestStartedAt);
  const capture = objectCaptureState();
  const presets = [30, 40, 50, 60].map(value => `<button type="button" class="preset-btn ${String(Number(objectTargetCm)) === String(value) ? 'is-active' : ''}" data-action="object-preset" data-cm="${value}">${value} cm</button>`).join('');
  return `<section class="panel object-control-panel">
    <div class="panel-header"><div><p class="eyebrow">Kontrol pengujian</p><h2>Snapshot hasil objek</h2><p>Isi jarak aktual dari meteran; error dihitung dari selisih jarak sensor.</p></div></div>
    <div class="object-control-body">
      <div class="field">
        <label for="object-target">Jarak target pengujian (cm)</label>
        <input id="object-target" type="number" min="1" max="400" step="0.1" inputmode="decimal" placeholder="30, 40, 50, atau 60" value="${escape(objectTargetCm)}">
        <div class="object-presets" aria-label="Pilihan jarak target">${presets}</div>
      </div>
      <div class="field object-actual-desktop">
        <label for="object-actual">Jarak aktual dari meteran (cm) <span class="req">*</span></label>
        <input id="object-actual" type="number" min="1" max="400" step="0.1" inputmode="decimal" placeholder="Hasil ukur meteran" value="${escape(objectActualCm)}">
        <p class="field-help">Jangan mengisi angka dari sensor. Jarak aktual wajib diukur manual.</p>
      </div>
      <div class="field-row object-range-fields">
        <div class="field"><label for="object-min">Batas minimum (cm)</label><input id="object-min" type="number" min="2" max="399" step="0.1" value="${objectSettings.minCm}"></div>
        <div class="field"><label for="object-max">Batas maksimum (cm)</label><input id="object-max" type="number" min="3" max="400" step="0.1" value="${objectSettings.maxCm}"></div>
      </div>
      <p class="field-help">Stabilitas memakai 5 sampel valid berturut-turut dengan toleransi ${fmt(objectSettings.toleranceCm)} cm.</p>
      <div class="capture-readout object-summary" aria-label="Ringkasan pengujian objek">
        <div class="capture-row"><span>Jarak target</span><strong id="object-target-summary">- cm</strong></div>
        <div class="capture-row"><span>Jarak aktual meteran</span><strong id="object-actual-summary">- cm</strong></div>
        <div class="capture-row"><span>Error (terukur - aktual)</span><strong id="object-error">- cm</strong></div>
        <div class="capture-row"><span>Durasi pengujian</span><strong id="object-duration">-</strong></div>
      </div>
      <div class="object-actions">
        <button class="btn primary" id="object-start" data-action="object-start" ${!serialSession || started ? 'disabled' : ''}>Mulai pengujian</button>
        <button class="btn" id="object-repeat" data-action="object-repeat" ${!serialSession || !started ? 'disabled' : ''}>Ulangi pengujian</button>
        <button class="btn" id="object-reset" data-action="object-reset" ${!started && !objectTargetCm && !objectActualCm ? 'disabled' : ''}>Reset pengujian</button>
      </div>
      <button class="btn primary full object-record" data-action="object-record" id="object-record" ${capture.ready ? '' : 'disabled'}>${svg('check')} Catat hasil pengujian</button>
      <p class="object-capture-state" id="object-capture-state">${capture.label}</p>
      <details class="object-technical">
        <summary>Lihat detail teknis</summary>
        <dl class="object-tech-grid">
          <div><dt>Urutan frame</dt><dd id="object-tech-sequence">-</dd></div>
          <div><dt>Status frame</dt><dd id="object-tech-frame">-</dd></div>
          <div><dt>Buffer sampel</dt><dd id="object-tech-buffer">-</dd></div>
          <div><dt>Rentang target</dt><dd id="object-tech-range">${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm</dd></div>
          <div><dt>Toleransi</dt><dd id="object-tech-tolerance">${fmt(objectSettings.toleranceCm)} cm</dd></div>
          <div><dt>Umur data</dt><dd id="object-tech-age">-</dd></div>
        </dl>
        <p class="field-help">Buffer tidak disimpan per frame. Hanya snapshot yang dicatat operator yang masuk dataset.</p>
      </details>
    </div>
  </section>`;
}

function objectDataset() {
  if (!objectTests.results.length) {
    return '<div class="empty"><strong>Belum ada hasil pengujian objek.</strong>Mulai pengujian, isi jarak aktual dari meteran, lalu catat snapshot hasil.<br><span class="small">Dataset ini terpisah dari riwayat pengunjung.</span></div>';
  }
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="object-result-table"><caption class="sr-only">Dataset pengujian deteksi objek</caption><thead><tr><th>Waktu</th><th>Arah</th><th class="numeric">Target</th><th class="numeric">Aktual</th><th class="numeric">Terukur</th><th class="numeric">Error</th><th>Deteksi</th><th>Kestabilan</th><th class="numeric">Rentang</th><th class="numeric">Sampel</th></tr></thead><tbody>${objectTests.results.map(row => `<tr><td><span class="cell-strong">${when(row.capturedAt)}</span><span class="row-note">WIB</span></td><td>${row.direction || 'DOWN'}</td><td class="numeric">${fmt(row.targetDistanceCm)} cm</td><td class="numeric">${fmt(row.actualDistanceCm)} cm</td><td class="numeric">${row.measuredDistanceCm == null ? '-' : `${fmt(row.measuredDistanceCm)} cm`}</td><td class="numeric">${row.errorCm == null ? '-' : `${fmtSigned(row.errorCm)} cm`}</td><td>${objectDetectionText(row.detectionStatus)}<span class="row-note">${row.detectionStatus}</span></td><td><span class="status ${row.stabilityStatus === 'STABLE' ? 'good' : row.stabilityStatus === 'INVALID' || row.stabilityStatus === 'DEVICE_OFFLINE' ? 'alarm' : 'waiting'}">${row.stabilityStatus}</span></td><td class="numeric">${row.stabilityRangeCm == null ? '-' : `${fmt(row.stabilityRangeCm)} cm`}</td><td class="numeric">${row.sampleCount}/5</td></tr>`).join('')}</tbody></table></div>`;
}

function objectGuidePanel() {
  const meta = objectDirectionMeta(objectDirection);
  return `<section class="panel guide-panel">
    <div class="panel-header"><div><p class="eyebrow">Panduan pengujian</p><h2>Deteksi Objek Universal</h2></div><span class="guide-formula">5 sampel · toleransi ${fmt(objectSettings.toleranceCm)} cm</span></div>
    <dl class="guide-grid">
      <div class="guide-item"><dt>Posisi objek</dt><dd>Tempatkan objek datar (kubus, balok, atau bidang rata) pada sumbu ${meta.axisCode} di dalam rentang target ${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm.</dd></div>
      <div class="guide-item"><dt>Orientasi sensor</dt><dd>Arahkan sensor HC-SR04 secara manual ke arah ${meta.label} (${meta.code}). Enam arah pengujian adalah pilihan konfigurasi, bukan enam sensor.</dd></div>
      <div class="guide-item"><dt>Kestabilan</dt><dd>Tahan posisi objek tanpa gerakan. Buffer direset setelah echo invalid atau objek keluar rentang.</dd></div>
      <div class="guide-item"><dt>Jarak aktual</dt><dd>Ukur target dengan meteran dan masukkan manual. Error = jarak terukur sensor − jarak aktual.</dd></div>
      <div class="guide-item"><dt>Batas perangkat</dt><dd>HC-SR04 hanya mengukur jarak 1D sepanjang arah pancaran. Tidak ada kamera, pengenalan objek, atau pelacakan koordinat 3D.</dd></div>
      <div class="guide-item"><dt>Bukan multi-sensor</dt><dd>Untuk mengukur enam arah secara bersamaan, diperlukan beberapa sensor atau mekanisme pengarah. Satu HC-SR04 mengukur satu arah per pengujian.</dd></div>
    </dl>
    <div class="object-limit-note"><strong>Bukan computer vision.</strong> Visualisasi kubus hanya representasi posisi target. Sistem tidak mengetahui bentuk, identitas, atau posisi lateral objek.</div>
  </section>`;
}

function objectMeasurementView() {
  const started = Boolean(objectTestStartedAt);
  const status = objectStatusView(objectResult, started);
  const sampleCount = started ? objectResult?.sampleCount ?? 0 : 0;
  const pips = Array.from({ length: OBJECT_DEFAULTS.sampleCount }, (_, index) => `<span class="object-sample-pip ${index < sampleCount ? 'filled' : ''}"></span>`).join('');
  const dirMeta = objectDirectionMeta(objectDirection);
  return `${directionSelector()}
  <div class="measurement-layout object-measurement-layout">
    <section class="panel instrument-panel object-instrument">
      <div class="panel-header"><div><p class="instrument-kicker">Mode pengujian objek · ${dirMeta.label} (${dirMeta.axisCode})</p><h2>Deteksi Objek Universal &mdash; HC-SR04</h2><p>Echo ultrasonik · arah ${dirMeta.label} · target ${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm · ${OBJECT_DEFAULTS.sampleCount} sampel</p></div>${statusPill()}</div>
      <div class="device-controls"><button class="btn primary" id="connect-device" data-action="connect" ${serialSession ? 'disabled' : ''}>${svg('cable')} Hubungkan ESP32</button><button class="btn" id="disconnect-device" data-action="disconnect" ${serialSession ? '' : 'disabled'}>Putuskan</button></div>
      <p class="device-note" id="serial-help">Tutup Serial Monitor Arduino IDE sebelum menghubungkan perangkat. Objek diuji tanpa menyimpan data pengunjung.</p>
      ${objectVisualization()}
      <div class="object-actual-mobile">
        <div class="field">
          <label for="object-actual-mobile">Jarak aktual dari meteran (cm) <span class="req">*</span></label>
          <input id="object-actual-mobile" type="number" min="1" max="400" step="0.1" inputmode="decimal" placeholder="Hasil ukur meteran" value="${escape(objectActualCm)}">
          <p class="field-help">Jangan mengisi angka dari sensor. Jarak aktual wajib diukur manual.</p>
        </div>
      </div>
      <div class="object-live-grid">
        <div class="object-live-primary">
          <span class="instrument-label">Jarak objek dari sensor (${dirMeta.axisCode})</span>
          <div class="object-distance"><strong id="object-distance">-</strong><small>cm</small></div>
          <span class="reading-meta" id="object-last">Menunggu koneksi perangkat</span>
        </div>
        <div class="object-live-state">
          <span class="instrument-label">Status kestabilan</span>
          <strong class="object-status-value ${status.tone}" id="object-stability-status">${status.stability}</strong>
          <p class="object-status-note" id="object-status-note">${status.note}</p>
          <div class="object-sample-pips" id="object-sample-pips" aria-label="Sampel stabil terkumpul">${pips}</div>
        </div>
      </div>
      <dl class="object-metrics">
        <div><dt>Status deteksi</dt><dd><span class="status ${status.detectionTone}" id="object-detection-status">${status.detection}</span></dd></div>
        <div><dt>Rentang stabilitas</dt><dd id="object-range">-</dd></div>
        <div><dt>Sampel</dt><dd id="object-samples">0/${OBJECT_DEFAULTS.sampleCount}</dd></div>
        <div><dt>Rentang target</dt><dd id="object-target-range">${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm</dd></div>
        <div><dt>Arah pengujian</dt><dd id="object-direction-status">${dirMeta.label} (${dirMeta.axisCode})</dd></div>
      </dl>
    </section>
    ${objectControlPanel()}
  </div>
  ${objectGuidePanel()}
  <section class="panel object-dataset-panel">
    <div class="panel-header"><div><p class="eyebrow">Dataset kalibrasi</p><h2>Hasil pengujian objek <span class="count" id="object-dataset-count">${objectTests.results.length}</span></h2><p>Snapshot eksplisit, terpisah dari riwayat pengunjung.</p></div><button class="btn" data-action="export-object-csv">${svg('download')} Ekspor CSV</button></div>
    <div id="object-dataset-region">${objectDataset()}</div>
  </section>`;
}

function objectCaptureState() {
  if (!objectTestStartedAt) return { ready:false, label:'Mulai pengujian terlebih dahulu.' };
  if (objectRecorded) return { ready:false, label:'Hasil pengujian ini sudah dicatat.' };
  if (!serialSession) return { ready:false, label:'ESP32 belum terhubung.' };
  if (!latestFrame) return { ready:false, label:'Menunggu data sensor.' };
  if (!lastFrameAt || Date.now() - lastFrameAt > 3000) return { ready:false, label:'Data sensor sudah kedaluwarsa.' };
  if (!Number.isFinite(Number(objectTargetCm)) || Number(objectTargetCm) < 1 || Number(objectTargetCm) > 400) return { ready:false, label:'Isi jarak target pengujian.' };
  if (!Number.isFinite(Number(objectActualCm)) || Number(objectActualCm) < 1 || Number(objectActualCm) > 400) return { ready:false, label:'Isi jarak aktual dari meteran.' };
  if (objectResult?.status === 'COLLECTING' && !objectResult.sampleCount) return { ready:false, label:'Menunggu sampel pertama setelah pengujian dimulai.' };
  return { ready:true, label:'Snapshot siap dicatat.' };
}

function objectFrameAgeText() {
  if (!serialSession) return 'Perangkat terputus';
  if (!lastFrameAt) return latestFrame?.status === 'invalid' ? 'Frame tidak valid diterima' : 'Menunggu data sensor';
  const age = Math.max(0, Math.round((Date.now() - lastFrameAt) / 1000));
  const relative = age === 0 ? 'baru saja' : age < 60 ? `${age} detik lalu` : `${Math.round(age / 60)} menit lalu`;
  return latestFrame?.status === 'invalid' ? `Frame tidak valid ${relative}` : `Frame terakhir ${relative}`;
}

function objectDurationText() {
  if (!objectTestStartedAt) return '-';
  const seconds = Math.max(0, (Date.now() - objectTestStartedAt) / 1000);
  return `${seconds.toFixed(1)} dtk`;
}

function updateObjectVisual(result) {
  const viz = $('#object-viz');
  if (!viz) return;
  const started = Boolean(objectTestStartedAt);
  const vizState = !serialSession || result?.status === 'DEVICE_OFFLINE'
    ? 'offline'
    : result?.status === 'INVALID'
      ? 'invalid'
      : result?.detectionStatus === 'TOO_CLOSE'
        ? 'too-close'
        : result?.detectionStatus === 'TOO_FAR'
          ? 'too-far'
          : !started
            ? 'idle'
            : result?.status === 'STABLE'
              ? 'stable'
              : result?.status === 'UNSTABLE'
                ? 'unstable'
                : 'collecting';
  const distance = Number.isFinite(Number(result?.distanceCm)) ? Number(result.distanceCm) : null;
  const liveD = result?.distanceCm ?? null;
  const svgContent = renderObjectSvg({
    direction: objectDirection,
    liveDistanceCm: liveD,
    targetDistanceCm: Number(objectTargetCm) || null,
    minCm: objectSettings.minCm,
    maxCm: objectSettings.maxCm,
    positionMode: objectPositionMode,
    state: vizState,
  });
  viz.innerHTML = svgContent;
  viz.dataset.state = vizState;
  viz.dataset.direction = objectDirection;
  const vizStateEl = $('#object-viz-state');
  if (vizStateEl) vizStateEl.textContent = vizState.toUpperCase().replace('-', '_');
  const dirMeta = objectDirectionMeta(objectDirection);
  setText('object-direction-status', `${dirMeta.label} (${dirMeta.axisCode})`);
  $$('.direction-card').forEach(card => {
    const isActive = card.dataset.direction === objectDirection;
    card.classList.toggle('is-active', isActive);
    card.setAttribute('aria-pressed', String(isActive));
  });
}

function updateObjectUI() {
  if (measurementMode !== 'object' || route !== 'pengukuran') return;
  const now = Date.now();
  const started = Boolean(objectTestStartedAt);
  const evaluation = evaluateObjectDetection({
    connected: Boolean(serialSession),
    frame: latestFrame,
    lastFrameAt,
    now,
    distances: started ? objectDistances : [],
    lastSequence: started ? objectLastSequence : latestFrame?.sequence ?? null,
    range: objectSettings,
  });
  if (started) {
    objectDistances = evaluation.distances;
    objectLastSequence = evaluation.lastSequence;
    objectResult = evaluation;
  } else {
    objectResult = { ...evaluation, status:'NO_OBJECT', sampleCount:0, distances:[], stabilityRangeCm:null, measuredDistanceCm:evaluation.distanceCm };
  }
  const status = objectStatusView(objectResult, started);
  const measured = Number.isFinite(Number(objectResult?.measuredDistanceCm)) ? Number(objectResult.measuredDistanceCm) : null;
  const actual = Number(objectActualCm);
  const error = Number.isFinite(actual) && actual >= 1 ? objectError(measured, actual) : null;
  setText('object-distance', objectResult?.distanceCm == null ? '-' : fmt(objectResult.distanceCm));
  setText('object-last', objectFrameAgeText());
  setText('object-status-note', status.note);
  setText('object-range', objectResult?.stabilityRangeCm == null ? '-' : `${fmt(objectResult.stabilityRangeCm)} cm`);
  setText('object-samples', `${started ? objectResult?.sampleCount ?? 0 : 0}/${OBJECT_DEFAULTS.sampleCount}`);
  setText('object-target-range', `${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm`);
  setText('object-target-summary', Number.isFinite(Number(objectTargetCm)) && Number(objectTargetCm) > 0 ? `${fmt(objectTargetCm)} cm` : '- cm');
  setText('object-actual-summary', Number.isFinite(actual) && actual > 0 ? `${fmt(actual)} cm` : '- cm');
  setText('object-error', error == null ? '- cm' : `${fmtSigned(error)} cm`);
  setText('object-duration', objectDurationText());
  setText('object-tech-sequence', latestFrame?.sequence == null ? '-' : String(latestFrame.sequence));
  setText('object-tech-frame', latestFrame ? `${latestFrame.status}${latestFrame.error ? ` · ${latestFrame.error}` : ''}` : '-');
  setText('object-tech-buffer', started && objectDistances.length ? objectDistances.map(value => fmt(value)).join(' · ') : '-');
  setText('object-tech-range', `${fmt(objectSettings.minCm)}-${fmt(objectSettings.maxCm)} cm`);
  setText('object-tech-tolerance', `${fmt(objectSettings.toleranceCm)} cm`);
  setText('object-tech-age', objectFrameAgeText());
  const stability = $('#object-stability-status');
  if (stability) {
    stability.textContent = status.stability;
    stability.className = `object-status-value ${status.tone}`;
  }
  const detection = $('#object-detection-status');
  if (detection) {
    detection.textContent = status.detection;
    detection.className = `status ${status.detectionTone}`;
  }
  $$('#object-sample-pips .object-sample-pip').forEach((pip, index) => {
    pip.classList.toggle('filled', index < (started ? objectResult?.sampleCount ?? 0 : 0));
  });
  const record = $('#object-record');
  const capture = objectCaptureState();
  if (record) record.disabled = !capture.ready;
  setText('object-capture-state', capture.label);
  const start = $('#object-start');
  if (start) start.disabled = !serialSession || started;
  const repeat = $('#object-repeat');
  if (repeat) repeat.disabled = !serialSession || !started;
  const reset = $('#object-reset');
  if (reset) reset.disabled = !started && !objectTargetCm && !objectActualCm;
  $$('.preset-btn').forEach(button => {
    button.classList.toggle('is-active', String(Number(objectTargetCm)) === button.dataset.cm);
  });
  updateObjectVisual(objectResult);
}

function measurementPage() {
  const objectMode = measurementMode === 'object';
  return header('Pengukuran live', objectMode ? 'Deteksi objek universal dengan HC-SR04: enam arah pengujian manual, objek geometris universal. Snapshot disimpan sebagai dataset kalibrasi.' : 'Instrument membaca HC-SR04 secara langsung. Petugas memilih pengunjung dan menyimpan satu pembacaan yang valid.')
    + measurementModeBar()
    + (objectMode ? objectMeasurementView() : heightMeasurementView());
}

function heightMeasurementView() {
  const readiness = captureState();
  return `<div class="measurement-layout">
      <section class="panel instrument-panel device-panel">
        <div class="panel-header"><div><p class="instrument-kicker">Kolom instrumen · Perangkat fisik</p><h2>ESP32 · HC-SR04</h2><p>Web Serial · 115200 baud · JSON per baris</p></div>${statusPill()}</div>
        <div class="device-controls"><button class="btn primary" id="connect-device" data-action="connect" ${serialSession ? 'disabled' : ''}>${svg('cable')} Hubungkan ESP32</button><button class="btn" id="disconnect-device" data-action="disconnect" ${serialSession ? '' : 'disabled'}>Putuskan</button></div>
        <p class="device-note" id="serial-help">Tutup Serial Monitor Arduino IDE sebelum menghubungkan perangkat. Gunakan Chrome atau Edge desktop melalui localhost atau HTTPS.</p>
        ${liveReadout('measure')}
      </section>
      <section class="panel capture-panel">
        <div class="panel-header"><div><p class="eyebrow">Pencatatan hasil</p><h2>Simpan pengukuran</h2><p>Pilih pengunjung, lalu simpan pembacaan live yang sedang tampil.</p></div></div>
        <div class="capture-body">
          <div class="field"><label for="measurement-visitor">Pengunjung <span class="req">*</span></label><select id="measurement-visitor"><option value="">Pilih pengunjung</option>${visitorOptions()}</select><p class="field-help">${state.visitors.length ? 'Identitas manual di menu Pengunjung.' : 'Belum ada pengunjung terdaftar.'} <button type="button" class="text-button inline" data-action="add-visitor">+ Tambah baru</button></p></div>
          <div class="capture-readout" aria-label="Data hasil pembacaan">
            <div class="capture-row"><span>Hasil tinggi dari ESP32</span><strong id="capture-height">— cm</strong></div>
            <div class="capture-row"><span>Jarak sensor</span><strong id="capture-distance">— cm</strong></div>
            <div class="capture-row"><span>Status validitas</span><strong class="capture-validity ${readiness.tone}" id="capture-validity">${readiness.label}</strong></div>
          </div>
          <button class="btn primary full" data-action="save-reading" id="save-reading" ${readiness.ready ? '' : 'disabled'}>${svg('check')} Simpan hasil live</button>
        </div>
      </section>
    </div>
    <section class="panel guide-panel">
      <div class="panel-header"><div><p class="eyebrow">Panduan operasional</p><h2>Pemasangan dan pembacaan</h2></div><span class="guide-formula">tinggi = Href − (jarak + offset)</span></div>
      <dl class="guide-grid">
        <div class="guide-item"><dt>Orientasi sensor</dt><dd>HC-SR04 menghadap lurus ke bawah di atas area pengunjung.</dd></div>
        <div class="guide-item"><dt>Rumus tinggi</dt><dd><code>tinggi = tinggi referensi − (jarak + offset)</code></dd></div>
        <div class="guide-item"><dt>Tinggi referensi</dt><dd>Ukur dari lantai ke permukaan depan transduser setelah perangkat terpasang.</dd></div>
        <div class="guide-item"><dt>Offset kalibrasi</dt><dd>Diisi dari pengujian fisik dengan alat ukur pembanding. Offset 0 bukan berarti terkalibrasi.</dd></div>
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
    if (term && !item.visitorName.toLowerCase().includes(term)) return false;
    if (historyStatus === 'normal' && item.buzzerAlarm) return false;
    if (historyStatus === 'alarm' && !item.buzzerAlarm) return false;
    if (historyCalibration === 'confirmed' && !item.calibrated) return false;
    if (historyCalibration === 'unconfirmed' && item.calibrated) return false;
    return true;
  });
  return sortMeasurements(rows);
}

function measurementLedger(rows) {
  if (!state.measurements.length) return '<div class="empty"><strong>Belum ada hasil pengukuran.</strong>Hubungkan ESP32 melalui pos pengukuran, pilih pengunjung, lalu simpan pembacaan pertama.<br><a class="text-button" href="#pengukuran">Buka pengukuran</a></div>';
  if (!rows.length) return '<div class="empty"><strong>Tidak ada data yang cocok.</strong>Ubah rentang tanggal atau filter, lalu coba lagi.<br><button class="text-button" data-action="clear-filter">Reset semua filter</button></div>';
  return `<p class="table-scroll-note">Geser tabel ke samping untuk melihat kolom lainnya.</p><div class="table-scroll"><table class="ledger-table"><caption class="sr-only">Ledger pengukuran tinggi badan</caption><thead><tr><th>Tanggal dan waktu</th><th>Nama pengunjung</th><th class="numeric">Tinggi badan</th><th class="numeric">Jarak sensor</th><th>Status pengukuran</th><th>Status kalibrasi</th></tr></thead><tbody>${rows.map(row => `<tr><td><span class="cell-strong">${when(row.capturedAt)}</span><span class="row-note">WIB</span></td><td><span class="cell-strong">${escape(row.visitorName)}</span></td><td class="numeric"><strong>${fmt(row.heightCm)} cm</strong><span class="row-note">Href ${fmt(row.referenceHeightCm)} · offset ${fmtSigned(row.offsetCm)}</span></td><td class="numeric">${fmt(row.distanceCm)} cm<span class="row-note">${row.validSamples}/5 sampel valid</span></td><td><span class="status good">Valid</span><span class="row-note">${row.buzzerAlarm ? 'Ambang buzzer aktif' : 'Buzzer normal'}</span></td><td><span class="status ${row.calibrated ? 'good' : 'waiting'}">${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function historyMeta(rows) {
  const total = state.measurements.length;
  return rows.length === total ? `Menampilkan seluruh ${total} data tersimpan.` : `Menampilkan ${rows.length} dari ${total} data tersimpan.`;
}

function historyToolbar() {
  const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  return `<div class="history-toolbar" aria-label="Filter riwayat pengukuran">
    <label class="tool-field search"><span>Cari nama</span><input id="history-search" type="search" placeholder="Nama pengunjung" autocomplete="off" value="${escape(historySearch)}"></label>
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
        <div class="panel-header"><div><h2>Data pengukuran <span class="count" id="history-count">${rows.length}</span></h2><p>Rekaman hanya bertambah saat operator menekan Simpan hasil live.</p></div><a class="text-button" href="#pengukuran">Buka pengukuran</a></div>
        ${historyToolbar()}
        <div class="history-meta"><span id="history-result-meta">${historyMeta(rows)}</span><span>Waktu WIB · data lokal</span></div>
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
        <div class="desk-identity"><span>Meja Pengujian</span><strong>Sensor Tinggi Badan</strong></div>
        <div class="operator"><span class="mode-label">ESP32 · USB Serial · 115200</span>${statusPill()}<button class="icon-button" data-action="help" aria-label="Panduan koneksi perangkat">${svg('info')}</button></div>
      </div>
      <nav class="nav-list" aria-label="Navigasi utama">${navs.map(([id, label], index) => `<a class="nav-link ${route === id ? 'active' : ''}" href="#${id}" ${route === id ? 'aria-current="page"' : ''}><span class="nav-number">0${index + 1}</span><span>${label}</span></a>`).join('')}</nav>
    </header>
    <div class="workspace"><div class="topbar"><span class="breadcrumb">Pos pengukuran <span>/</span> <strong>${current}</strong></span><span class="date-label">${new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Jakarta' })}</span></div>
      <main id="main" tabindex="-1">${route === 'ringkasan' ? dashboardPage() : route === 'pengunjung' ? visitorsPage() : route === 'pengukuran' ? measurementPage() : historyPage()}
        <footer class="workspace-footer"><div><strong>COCOMANG</strong><span>Smart Height Measurement System · data tersimpan lokal pada peramban ini.</span></div><button class="link-plain" data-action="help">Petunjuk perangkat dan batas integrasi</button></footer>
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
  updateObjectUI();
}

function processSerialLine(line) {
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
    objectDistances = [];
    objectLastSequence = null;
    objectResult = null;
    updateConnectionUI();
    toast('ESP32 terhubung. Menunggu baris data JSON dari firmware…');

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

function visitorForm() {
  openModal('Tambah pengunjung', 'Identitas manual untuk mengaitkan hasil ukur. Tinggi badan tidak diisi manual.', `<form id="visitor-form" class="form-grid" novalidate>
    <div id="form-error" role="alert"></div>
    <div class="field"><label for="visitor-name">Nama lengkap <span class="req">*</span></label><input id="visitor-name" name="name" required minlength="2" maxlength="100" autocomplete="name" placeholder="Nama pengunjung"></div>
    <div class="field-row">
      <div class="field"><label for="visitor-age">Usia (tahun)</label><input id="visitor-age" name="age" type="number" min="1" max="120" step="1" placeholder="18"></div>
      <div class="field"><label for="visitor-gender">Jenis kelamin</label><select id="visitor-gender" name="gender"><option value="">Belum diisi</option><option value="L">Laki-laki</option><option value="P">Perempuan</option><option value="Lainnya">Lainnya</option></select></div>
      <div class="field"><label for="visitor-weight">Berat badan (kg)</label><input id="visitor-weight" name="weightKg" type="number" min="1" max="300" step="0.1" placeholder="60"></div>
    </div>
    <div class="field"><label for="visitor-notes">Catatan</label><textarea id="visitor-notes" name="notes" rows="3" maxlength="500" placeholder="Catatan pengukuran (opsional)"></textarea></div>
    <p class="form-note">Tinggi badan akan diisi dari pembacaan sensor pada pos pengukuran. Tidak ada pembaca kartu identitas pada tahap ini.</p>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Batal</button><button class="btn primary" type="submit">Simpan pengunjung</button></div>
  </form>`);
  $('#visitor-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      let visitor;
      commit(next => { visitor = addVisitor(next, data); });
      selectedVisitorId = visitor.id;
      modal.close();
      render();
      if (route !== 'pengukuran') location.hash = 'pengukuran';
      toast(`Pengunjung ${visitor.name} ditambahkan.`);
    } catch (error) {
      $('#form-error').innerHTML = `<p class="error-banner">${escape(error.message)}</p>`;
    }
  });
}

function renderObjectDataset() {
  const region = $('#object-dataset-region');
  if (region) region.innerHTML = objectDataset();
  setText('object-dataset-count', String(objectTests.results.length));
}

function startObjectTest(repeat = false) {
  if (!serialSession) {
    toast('Hubungkan ESP32 sebelum memulai pengujian objek.', true);
    return;
  }
  objectTestStartedAt = Date.now();
  objectDistances = [];
  objectLastSequence = latestFrame?.sequence ?? null;
  objectRecorded = false;
  objectResult = null;
  if (!repeat) {
    objectActualCm = '';
    for (const id of ['object-actual', 'object-actual-mobile']) {
      const actual = document.getElementById(id);
      if (actual) actual.value = '';
    }
  }
  updateObjectUI();
  toast(repeat ? 'Pengujian objek diulang. Buffer sampel dimulai dari awal.' : 'Pengujian objek dimulai. Arahkan objek ke sensor.');
}

function resetObjectTest() {
  objectTestStartedAt = 0;
  objectDistances = [];
  objectLastSequence = null;
  objectRecorded = false;
  objectResult = null;
  objectTargetCm = '';
  objectActualCm = '';
  const target = $('#object-target');
  if (target) target.value = '';
  for (const id of ['object-actual', 'object-actual-mobile']) {
    const actual = document.getElementById(id);
    if (actual) actual.value = '';
  }
  updateObjectUI();
  toast('Pengujian objek direset.');
}

function recordObjectTest() {
  const capture = objectCaptureState();
  if (!capture.ready) throw new Error(capture.label);
  if (!objectResult) throw new Error('Belum ada hasil pengujian untuk dicatat.');
  const latestValid = latestFrame?.status === 'ok' ? latestFrame : null;
  const record = createObjectTestResult({
    targetDistanceCm: Number(objectTargetCm),
    actualDistanceCm: Number(objectActualCm),
    measuredDistanceCm: objectResult.measuredDistanceCm,
    detectionStatus: objectResult.detectionStatus,
    stabilityStatus: objectResult.status,
    stabilityRangeCm: objectResult.stabilityRangeCm,
    sampleCount: objectResult.sampleCount,
    durationMs: Date.now() - objectTestStartedAt,
    targetMinCm: objectSettings.minCm,
    targetMaxCm: objectSettings.maxCm,
    toleranceCm: objectSettings.toleranceCm,
    sequence: latestValid?.sequence ?? null,
    calibrated: latestValid ? Boolean(latestValid.calibrated) : null,
    direction: objectDirection,
  });
  objectTests = appendObjectTest(record);
  objectRecorded = true;
  renderObjectDataset();
  updateObjectUI();
  toast(record.errorCm == null ? 'Snapshot pengujian objek dicatat.' : `Snapshot dicatat; error ${fmtSigned(record.errorCm)} cm.`);
}

function exportObjectTestsCsv() {
  if (!objectTests.results.length) {
    toast('Belum ada hasil pengujian objek untuk diekspor.', true);
    return;
  }
  download('cocomang-dataset-deteksi-objek.csv', objectTestsCsv(objectTests.results), 'text/csv;charset=utf-8');
}

function applyObjectRangeSettings() {
  const minCm = Number($('#object-min')?.value);
  const maxCm = Number($('#object-max')?.value);
  const issue = validateObjectRange({ minCm, maxCm });
  if (issue) {
    const minInput = $('#object-min');
    const maxInput = $('#object-max');
    if (minInput) minInput.value = String(objectSettings.minCm);
    if (maxInput) maxInput.value = String(objectSettings.maxCm);
    toast(`${issue} Pengaturan sebelumnya tetap dipakai.`, true);
    return;
  }
  if (minCm === objectSettings.minCm && maxCm === objectSettings.maxCm) return;
  objectSettings = { ...objectSettings, minCm, maxCm };
  objectDistances = [];
  objectLastSequence = latestFrame?.sequence ?? null;
  objectRecorded = false;
  if (objectTestStartedAt) objectTestStartedAt = Date.now();
  updateObjectUI();
}

function saveLiveReading() {
  if (!serialSession) throw new Error('ESP32 belum terhubung.');
  if (!latestFrame || latestFrame.status !== 'ok') throw new Error('Belum ada pembacaan live yang valid dari ESP32.');
  if (!lastFrameAt || Date.now() - lastFrameAt > 3000) throw new Error('Data sensor sudah kedaluwarsa. Tunggu pembacaan live berikutnya.');
  if (!selectedVisitorId) throw new Error('Pilih pengunjung terlebih dahulu.');
  if (latestFrame.sequence != null && latestFrame.sequence === lastSavedSequence) throw new Error('Pembacaan ini sudah disimpan. Tunggu data live berikutnya.');
  let entry;
  commit(next => { entry = recordMeasurement(next, selectedVisitorId, latestFrame); });
  lastSavedSequence = latestFrame.sequence;
  toast(`Hasil ${fmt(entry.heightCm)} cm tersimpan untuk ${entry.visitorName}.`);
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
    'Waktu WIB': when(row.capturedAt), 'Pengunjung': row.visitorName,
    'Tinggi (cm)': row.heightCm, 'Jarak sensor (cm)': row.distanceCm,
    'Tinggi referensi (cm)': row.referenceHeightCm, 'Offset (cm)': row.offsetCm,
    'Sampel valid': `${row.validSamples}/5`, 'Status pengukuran': row.buzzerAlarm ? 'Ambang buzzer aktif' : 'Normal',
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
  const body = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escape(when(row.capturedAt))}</td><td>${escape(row.visitorName)}</td><td>${fmt(row.heightCm)}</td><td>${fmt(row.distanceCm)}</td><td>${row.buzzerAlarm ? 'Ambang &lt; 100 cm' : 'Normal'}</td><td>${row.calibrated ? 'Terkalibrasi' : 'Belum terkalibrasi'}</td></tr>`).join('');
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Pengukuran COCOMANG</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#243c32;margin:0}h1{font-family:Georgia,serif;font-size:22px;font-weight:600;margin:2px 0 4px}p{color:#59675d;line-height:1.5;margin:0}.brandline{display:flex;align-items:baseline;gap:10px;border-top:3px solid #254b3e;padding-top:12px}.brandline strong{font-size:16px;letter-spacing:.08em}.brandline span{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#59675d}.meta{border-bottom:1px solid #b9c1ad;padding-bottom:12px;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.summary div{border:1px solid #cbd3c5;padding:9px 10px}.summary span{display:block;color:#59675d;font-size:8px;text-transform:uppercase;letter-spacing:.06em}.summary strong{display:block;font-size:17px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #cbd3c5;padding:7px 6px;text-align:left;font-size:9px}th{background:#eef0e7;font-size:8px;text-transform:uppercase;letter-spacing:.05em}td:nth-child(1),td:nth-child(4),td:nth-child(5){font-variant-numeric:tabular-nums}.foot{margin-top:18px;font-size:9px;color:#657064;border-top:1px solid #cbd3c5;padding-top:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><div class="brandline"><strong>COCOMANG</strong><span>Smart Height Measurement System</span></div><div class="meta"><h1>Laporan Pengukuran Tinggi Badan</h1><p>${escape(filters)}<br>Dicetak ${escape(when(new Date().toISOString()))} WIB · sumber data: ESP32 / HC-SR04 melalui Web Serial</p></div><div class="summary"><div><span>Total pengukuran</span><strong>${rows.length}</strong></div><div><span>Rata-rata tinggi</span><strong>${fmt(average)} cm</strong></div><div><span>Rentang tinggi</span><strong>${fmt(min)}–${fmt(max)} cm</strong></div><div><span>Terkalibrasi</span><strong>${calibratedCount}/${rows.length}</strong></div></div><table><thead><tr><th>No.</th><th>Waktu</th><th>Pengunjung</th><th>Tinggi (cm)</th><th>Jarak (cm)</th><th>Status</th><th>Kalibrasi</th></tr></thead><tbody>${body}</tbody></table><p class="foot">Laporan dibuat dari data pengukuran yang tersimpan pada peramban ini. Hasil merupakan estimasi prototipe dan bukan sertifikat alat ukur kesehatan.</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
  printWindow.document.close();
}

function showHelp() {
  openModal('Petunjuk perangkat', 'Koneksi, kalibrasi, dan batas integrasi COCOMANG SmartHeight.', `<ul class="help-list">
    <li>Gunakan Chrome atau Edge versi desktop.</li>
    <li>Buka aplikasi melalui <strong>http://localhost:8000</strong> atau HTTPS. Jangan membuka file HTML langsung.</li>
    <li>Tutup Serial Monitor Arduino IDE sebelum menekan Hubungkan ESP32.</li>
    <li>Pilih COM port ESP32 pada dialog browser. Baud rate firmware 115200.</li>
    <li>HC-SR04 dipasang menghadap ke bawah. Firmware menghitung <code>tinggi = Href − (jarak + offset)</code>.</li>
    <li>Buzzer pada GPIO 27 dikendalikan firmware saat tinggi di bawah 100 cm. Website hanya menampilkan statusnya.</li>
    <li>Data hanya disimpan saat petugas menekan Simpan hasil live. Data tersimpan di peramban ini, bukan cloud.</li>
    </ul><div class="notice">Pembacaan adalah estimasi prototipe. Verifikasi reference height, offset, dan posisi sensor secara fisik sebelum menyimpulkan akurasi.</div><div class="modal-actions"><button class="btn primary" data-action="close-modal">Mengerti</button></div>`);
}

function bindPage() {
  $('#measurement-visitor')?.addEventListener('change', event => {
    selectedVisitorId = event.target.value;
    updateConnectionUI();
  });
  $('#history-from')?.addEventListener('change', event => { historyFrom = event.target.value; renderHistoryTable(); });
  $('#history-to')?.addEventListener('change', event => { historyTo = event.target.value; renderHistoryTable(); });
  $('#history-search')?.addEventListener('input', event => { historySearch = event.target.value; renderHistoryTable(); });
  $('#history-status')?.addEventListener('change', event => { historyStatus = event.target.value; renderHistoryTable(); });
  $('#history-calibration')?.addEventListener('change', event => { historyCalibration = event.target.value; renderHistoryTable(); });
  $('#history-sort')?.addEventListener('change', event => { historySort = event.target.value; renderHistoryTable(); });
  $('#object-target')?.addEventListener('input', event => { objectTargetCm = event.target.value; updateObjectUI(); });
  for (const id of ['object-actual', 'object-actual-mobile']) {
    document.getElementById(id)?.addEventListener('input', event => {
      objectActualCm = event.target.value;
      for (const otherId of ['object-actual', 'object-actual-mobile']) {
        const other = document.getElementById(otherId);
        if (other && other.value !== objectActualCm) other.value = objectActualCm;
      }
      updateObjectUI();
    });
  }
  $('#object-min')?.addEventListener('change', applyObjectRangeSettings);
  $('#object-max')?.addEventListener('change', applyObjectRangeSettings);
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'add-visitor') visitorForm();
  else if (action === 'connect') void connectDevice();
  else if (action === 'disconnect') void disconnectDevice();
  else if (action === 'save-reading') {
    try { saveLiveReading(); } catch (error) { toast(error.message, true); }
  }
  else if (action === 'export-csv') exportMeasurementsCsv();
  else if (action === 'print-pdf') printPdfReport();
  else if (action === 'clear-filter') { historyFrom = ''; historyTo = ''; historySearch = ''; historyStatus = 'all'; historyCalibration = 'all'; historySort = 'newest'; render(); }
  else if (action === 'measurement-mode' && (button.dataset.mode === 'height' || button.dataset.mode === 'object')) {
    if (measurementMode !== button.dataset.mode) {
      objectDistances = [];
      objectLastSequence = latestFrame?.sequence ?? null;
      objectResult = null;
      if (objectTestStartedAt) objectTestStartedAt = Date.now();
      measurementMode = button.dataset.mode;
      render();
    }
  }
  else if (action === 'object-preset') {
    objectTargetCm = button.dataset.cm || '';
    const target = $('#object-target');
    if (target) target.value = objectTargetCm;
    updateObjectUI();
  }
  else if (action === 'object-direction') {
    const newDir = normalizeObjectDirection(button.dataset.direction);
    if (newDir !== objectDirection) {
      objectDirection = newDir;
      objectDistances = [];
      objectLastSequence = latestFrame?.sequence ?? null;
      objectResult = null;
      objectRecorded = false;
      if (objectTestStartedAt) objectTestStartedAt = Date.now();
      render();
      toast(`Arah pengujian: ${objectDirectionMeta(objectDirection).label} (${objectDirectionMeta(objectDirection).axisCode}). Sesuaikan orientasi fisik sensor secara manual.`);
    }
  }
  else if (action === 'object-start') startObjectTest(false);
  else if (action === 'object-repeat') startObjectTest(true);
  else if (action === 'object-reset') resetObjectTest();
  else if (action === 'object-record') {
    try { recordObjectTest(); } catch (error) { toast(error.message, true); }
  }
  else if (action === 'export-object-csv') exportObjectTestsCsv();
  else if (action === 'help') showHelp();
  else if (action === 'close-modal') modal.close();
});

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  $('#main')?.focus();
});

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  route = navs.some(item => item[0] === next) ? next : 'ringkasan';
  if (measurementMode === 'object') {
    objectDistances = [];
    objectLastSequence = latestFrame?.sequence ?? null;
    objectResult = null;
    if (objectTestStartedAt) objectTestStartedAt = Date.now();
  }
  if (state) render();
});

window.addEventListener('storage', event => {
  if (event.key === 'cocomang-live-v1' && state) {
    try { state = repository.load(); render(); toast('Data pengukuran diperbarui dari tab lain.'); }
    catch (error) { toast(error.message, true); }
  }
  if (event.key === OBJECT_TESTS_STORAGE_KEY) {
    try {
      objectTests = loadObjectTests();
      if (route === 'pengukuran' && measurementMode === 'object') {
        renderObjectDataset();
        updateObjectUI();
      }
      toast('Dataset pengujian objek diperbarui dari tab lain.');
    } catch (error) { toast(error.message, true); }
  }
});

setInterval(() => {
  if (serialSession) updateConnectionUI();
}, 1000);

function boot() {
  try {
    state = repository.load();
    let objectLoadError = '';
    try { objectTests = loadObjectTests(); }
    catch (error) {
      objectTests = createEmptyObjectTests();
      objectLoadError = error.message;
    }
    route = navs.some(item => item[0] === route) ? route : 'ringkasan';
    render();
    if (objectLoadError) toast(objectLoadError, true);
  } catch (error) {
    $('#app').innerHTML = `<main class="boot"><div><h1>Data belum dapat dibuka</h1><p>${escape(error.message)}</p></div></main>`;
  }
}

boot();
