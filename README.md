# Project IoT — COCOMANG SmartHeight

Sistem IoT Pengukuran Tinggi Badan & Validasi Akses Wahana Rekreasi berbasis **ESP32 DevKit V1 + Dual RFID MFRC522 (VSPI & HSPI) + Sensor Ultrasonik HC-SR04 + Buzzer Pasif** yang terhubung langsung ke dashboard browser melalui **Web Serial API (115200 baud)** serta terintegrasi dengan database cloud **Supabase (PostgreSQL & Realtime)**.

---

## 🌟 Fitur Utama Sistem

1. **Dual RFID RC522 Reader (Dual SPI Bus)**:
   - **Reader 1 (VSPI)**: Pendaftaran member baru & pembacaan UID kartu pengunjung secara otomatis.
   - **Reader 2 (HSPI)**: Validasi akses masuk wahana permainan (*gate access validation*).
2. **Pengukuran Tinggi Badan Real-Time**:
   - Pembacaan sensor ultrasonik HC-SR04 *overhead* dengan perhitungan estimasi tinggi badan presisi (`REFERENCE_HEIGHT_CM - distance`).
   - Alur penyimpanan eksplisit ke profil member yang sedang diukur.
3. **Validasi Kelayakan Akses Wahana (*Ride Validator*)**:
   - Pengecekan otomatis saat kartu ditap pada Reader 2 terhadap batas tinggi minimal/maksimal wahana (misal: *Roller Coaster*, *Kora-Kora*, *Bianglala*, dan *Bumper Car Anak*).
   - Indikator visual real-time (banner Lolos / Ditolak) beserta perhitungan selisih tinggi.
4. **Interaksi Serial Dua Arah & Audio Feedback**:
   - Dashboard dapat memicu buzzer ESP32 secara serial: `'b'` untuk 1 bip konfirmasi (akses lolos) dan `'n'` untuk 3 bip peringatan (akses ditolak).
   - Perintah diagnosa `'r'` (cek status chip RFID) dan `'u'` (trigger ultrasonik manual).
5. **Arsitektur Local-First & Integrasi Supabase Cloud**:
   - Beroperasi 100% *offline-ready* menggunakan `localStorage` browser tanpa hambatan.
   - Sinkronisasi otomatis ke Supabase PostgreSQL dan WebSocket Realtime untuk kolaborasi multi-layar/multi-pos.
   - Deteksi kredensial otomatis melalui konfigurasi `.env`.
6. **Riwayat, Filter & Pelaporan**:
   - Filter data berdasarkan rentang tanggal, pencarian nama, status buzzer, dan kelayakan wahana.
   - Ekspor data langsung ke CSV dan pembuatan laporan cetak siap *Save as PDF*.
7. **Automated Unit Testing**:
   - Dilengkapi 24 unit test otomatis (*zero external testing library*, menggunakan native Node.js test runner) yang memverifikasi parser serial, validasi data member, aturan wahana, dan mapper database.

---

## 📂 Struktur Direktori Proyek

Seluruh kode sumber proyek berada pada folder [`cocomang/`](./cocomang/):

```text
Project-IoT/
├── README.md                                    # Dokumentasi overview repositori
└── cocomang/
    ├── .env.example                             # Template kredensial Supabase tingkat folder cocomang
    ├── DESIGN.md                                # Dokumen arsitektur & spesifikasi desain
    ├── QA.md                                    # Checklist jaminan kualitas & pengujian
    ├── package.json                             # Skrip npm test dan check (24 automated tests)
    ├── README.md                                # Dokumentasi teknis & panduan lengkap COCOMANG
    ├── dist/                                    # Aplikasi Web Dashboard (Vanilla ES Modules)
    │   ├── .env.example                         # Template konfigurasi .env untuk dashboard web
    │   ├── app.mjs                              # Controller utama UI dashboard & state management
    │   ├── data.mjs                             # Model data, validasi member, dan local repository
    │   ├── index.html                           # Entry point HTML dashboard
    │   ├── ride-validator.mjs                   # Aturan batas tinggi & logika validasi wahana
    │   ├── serial-protocol.mjs                  # Parser telemetri JSON ESP32 & log tap RFID
    │   ├── style.css                            # Styling modern staff-desk visual theme
    │   └── supabase-service.mjs                 # Layanan integrasi database cloud Supabase & Realtime
    ├── docs/                                    # Dokumentasi pengujian & panduan integrasi
    │   ├── PANDUAN-PENGUJIAN-LIVE.md            # SOP pengujian physical layer & kalibrasi sensor
    │   └── PANDUAN-SUPABASE.md                  # Panduan setup Supabase, DDL SQL, dan alur pengujian
    ├── firmware/                                # Firmware mikrokontroler ESP32
    │   └── smartheight_progres2_dual_rfid/
    │       ├── diagram.json                     # Konfigurasi simulasi sirkuit Wokwi
    │       └── smartheight_progres2_dual_rfid.ino # Firmware ESP32 Dual SPI MFRC522 + HC-SR04 + Buzzer
    ├── supabase/
    │   └── schema.sql                           # Skema DDL PostgreSQL (tabel members, rides, ride_validations)
    └── tests/                                   # Automated test suite (Node.js test runner)
        ├── data.test.mjs                        # Pengujian model data & local storage repository
        ├── ride-validation.test.mjs             # Pengujian logika kelayakan batas tinggi wahana
        ├── serial-protocol.test.mjs             # Pengujian parsing frame serial JSON & RFID
        └── supabase-mapper.test.mjs             # Pengujian data mapper frontend <-> Supabase DB
```

---

## 🔌 Konfigurasi Pin Hardware (ESP32 DevKit V1)

| Perangkat / Modul | Pin Modul | Pin ESP32 | Keterangan |
|---|---|---|---|
| **RFID 1 (Pendaftaran)** | SCK | GPIO 18 | Bus VSPI |
| | MISO | GPIO 19 | Bus VSPI |
| | MOSI | GPIO 23 | Bus VSPI |
| | SDA (SS) | GPIO 5 | Chip Select RFID 1 |
| | RST | GPIO 22 | Reset RFID 1 |
| | 3.3V & GND | 3V3 & GND | Sumber daya 3.3V |
| **RFID 2 (Akses Wahana)** | SCK | GPIO 14 | Bus HSPI |
| | MISO | GPIO 32 | Bus HSPI (*remapped* dari GPIO 12 untuk kestabilan boot) |
| | MOSI | GPIO 13 | Bus HSPI |
| | SDA (SS) | GPIO 4 | Chip Select RFID 2 |
| | RST | GPIO 21 | Reset RFID 2 |
| | 3.3V & GND | 3V3 & GND | Sumber daya 3.3V |
| **HC-SR04 (Ultrasonik)** | VCC | VIN / 5V | Sumber daya 5V |
| | TRIG | GPIO 25 | Output trigger pulsa |
| | ECHO | GPIO 26 | Input echo melalui pembagi tegangan (R1=1kΩ seri, R2=2kΩ ke GND) |
| | GND | GND | Ground bersama |
| **Buzzer Pasif** | (+) / Signal | GPIO 27 | Sinyal frekuensi 2.000 Hz |
| | (-) | GND | Ground |

---

## 🚀 Panduan Memulai Cepat

### 1. Unggah Firmware ke ESP32
1. Buka file [`cocomang/firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino`](./cocomang/firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino) menggunakan **Arduino IDE**.
2. Pilih board **ESP32 Dev Module**.
3. Sesuaikan konstanta instalasi fisik jika diperlukan (`REFERENCE_HEIGHT_CM`, default: `220.0f`).
4. Unggah (*upload*) sketch ke ESP32.

### 2. Konfigurasi Database Supabase (Opsional tapi Direkomendasikan)
1. Salin template `.env.example` ke `cocomang/dist/.env`:
   ```powershell
   Copy-Item cocomang/dist/.env.example cocomang/dist/.env
   ```
2. Buka `cocomang/dist/.env` lalu isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari proyek Supabase Anda.
3. Jalankan skrip DDL SQL [`cocomang/supabase/schema.sql`](./cocomang/supabase/schema.sql) di **SQL Editor** Supabase.
*(Detail lengkap tersedia pada [`cocomang/docs/PANDUAN-SUPABASE.md`](./cocomang/docs/PANDUAN-SUPABASE.md)).*

### 3. Jalankan Dashboard Web Lokal
1. Masuk ke direktori `cocomang`:
   ```powershell
   cd cocomang
   ```
2. Jalankan server lokal Python:
   ```powershell
   py -m http.server 8000 --directory dist
   ```
3. Buka browser Chromium (**Google Chrome** atau **Microsoft Edge**) di:
   ```text
   http://localhost:8000
   ```
4. Klik tombol **Hubungkan ESP32**, pilih port serial ESP32 pada baud 115200.

### 4. Menjalankan Automated Tests
Pastikan Node.js (v18+) terpasang di sistem:
```powershell
cd cocomang
npm test
npm run check
```
Hasil: **24 unit test passing**.
