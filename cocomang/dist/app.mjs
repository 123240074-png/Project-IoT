import { repository, addVisitor, recordMeasurement, csvExport } from './data.mjs';
import { parseDeviceLine } from './serial-protocol.mjs';

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

function measurementPage() {
  return header('Pengukuran live', 'Instrumen membaca HC-SR04 dari atas kepala secara langsung. Petugas memilih pengunjung dan menyimpan satu pembacaan yang valid.')
    + heightMeasurementView();
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

function boot() {
  try {
    state = repository.load();
    route = navs.some(item => item[0] === route) ? route : 'ringkasan';
    render();
  } catch (error) {
    $('#app').innerHTML = `<main class="boot"><div><h1>Data belum dapat dibuka</h1><p>${escape(error.message)}</p></div></main>`;
  }
}

boot();
