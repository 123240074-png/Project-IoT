# Project IoT — COCOMANG SmartHeight (Wokwi Simulation & Cloud Sync Edition)

Sistem IoT Pengukuran Tinggi Badan & Validasi Kelayakan Akses Wahana Rekreasi berbasis **ESP32 DevKit V1 + Dual RFID MFRC522 (VSPI & HSPI) + Sensor Ultrasonik HC-SR04 + Buzzer Pasif** yang disimulasikan secara nirkabel melalui **Wokwi Simulator (WiFi + MQTT over WebSocket)**, terhubung ke web dashboard modern (*zero Web Serial dependency*), serta terintegrasi dengan database cloud **Supabase (PostgreSQL & Realtime)**.

---

## 🌟 Fitur Utama Sistem

1. **Simulasi Nirkabel Wokwi (MQTT over WebSocket)**:
   - Mikrokontroler ESP32 di simulator Wokwi terhubung ke internet via `Wokwi-GUEST` WiFi dan mempublikasikan data telemetri ke public broker HiveMQ (`broker.hivemq.com:1883`).
   - Dashboard web berlangganan data secara nirkabel via WebSocket aman (`wss://broker.hivemq.com:8884/mqtt`), **meniadakan ketergantungan pada Web Serial API / kabel fisik USB**. Dashboard dapat dibuka dari peramban dan perangkat apa pun (Chrome, Edge, Firefox, Safari, smartphone, tablet).
2. **Dual RFID RC522 Reader (Dual Hardware SPI Bus)**:
   - **Reader 1 (VSPI)**: Pos Pendaftaran Member & deteksi instan kartu RFID pengunjung (mendukung UID 4-byte, 7-byte, dan 10-byte).
   - **Reader 2 (HSPI)**: Pos Gerbang Masuk Wahana (*Gate Access Validation*) untuk memeriksa kelayakan fisik pengunjung.
3. **Pengukuran Tinggi Badan Real-Time & Kalibrasi Jarak**:
   - Sensor ultrasonik HC-SR04 *overhead* mengukur jarak ke puncak kepala pengunjung secara berkala (500 ms).
   - Estimasi tinggi badan dihitung secara otomatis (`REFERENCE_HEIGHT_CM - distanceCm`) dan dapat disimpan secara permanen ke profil member.
4. **Validasi Kelayakan Akses Wahana (*Ride Validator*)**:
   - Pengecekan otomatis saat kartu ditap pada Reader 2 terhadap batas tinggi minimal/maksimal katalog wahana (*Roller Coaster Halilintar*, *Kora-Kora Perahu Ayun*, *Bianglala Pemandangan*, *Arena Bumper Car Anak*).
   - Indikator visual real-time (banner hijau Lolos / merah Ditolak) beserta kalkulasi selisih tinggi badan.
5. **Acoustic Feedback Dua Arah via MQTT Command**:
   - Dashboard mengirimkan perintah serial/MQTT interaktif ke ESP32:
     - `'b'`: Bip 1x pendek (200 ms) saat akses wahana disetujui / kartu terbaca normal.
     - `'n'`: Bip 3x peringatan (100 ms on/off) saat akses wahana ditolak karena tinggi badan tidak memenuhi syarat.
     - `'u'`: Pemicu baca manual jarak ultrasonik.
     - `'r'`: Cek status versi firmware chip MFRC522.
6. **Arsitektur Local-First & Integrasi Supabase Cloud**:
   - Pos ukur beroperasi 100% *offline-ready* menggunakan `localStorage` peramban lokal.
   - Sinkronisasi instan ke Supabase PostgreSQL dan WebSocket Realtime untuk update multi-layar tanpa refresh.
   - Deteksi kredensial otomatis melalui loader file `.env` di `cocomang/dist/.env`.
7. **Riwayat, Filter & Pelaporan**:
   - Filter data berdasarkan rentang tanggal, pencarian nama member, status buzzer, dan kelayakan wahana.
   - Ekspor data tabel ke CSV dan pencetakan laporan siap *Save as PDF*.
8. **Automated Unit Testing**:
   - Dilengkapi **29 automated unit tests** lulus (`node --test`), memverifikasi transport MQTT Wokwi, validasi frame JSON serial, model data member, aturan kelayakan wahana, dan data mapper Supabase.

---

## 📂 Struktur Direktori Proyek

```text
Project-IoT/
├── index.html                                   # Root redirector menuju /cocomang/dist/
├── README.md                                    # Dokumentasi overview repositori (Wokwi & Supabase Edition)
└── cocomang/
    ├── .env.example                             # Template kredensial Supabase tingkat folder cocomang
    ├── DESIGN.md                                # Dokumen arsitektur & spesifikasi desain sistem
    ├── QA.md                                    # Checklist QA & rencana verifikasi perangkat
    ├── package.json                             # Skrip npm test (29 automated tests) dan syntax check
    ├── README.md                                # Dokumentasi teknis & panduan lengkap COCOMANG
    ├── dist/                                    # Aplikasi Web Dashboard (Vanilla ES Modules)
    │   ├── .env.example                         # Template konfigurasi .env untuk dashboard web
    │   ├── app.mjs                              # Controller utama antarmuka & state machine
    │   ├── data.mjs                             # Model data, validasi member, dan local storage repository
    │   ├── index.html                           # Entry point HTML dashboard
    │   ├── ride-validator.mjs                   # Aturan batas tinggi & logika validasi wahana
    │   ├── serial-protocol.mjs                  # Parser telemetri JSON ESP32 & log tap RFID
    │   ├── style.css                            # Styling tema visual modern staff-desk
    │   ├── supabase-service.mjs                 # Layanan integrasi database cloud Supabase & Realtime
    │   └── wokwi-service.mjs                    # Transport service MQTT over WebSocket untuk Wokwi
    ├── docs/                                    # Dokumentasi pengujian & panduan integrasi
    │   ├── PANDUAN-PENGUJIAN-LIVE.md            # SOP pengujian physical layer & kalibrasi sensor
    │   └── PANDUAN-SUPABASE.md                  # Panduan setup Supabase, DDL SQL, dan alur pengujian
    ├── firmware/                                # Firmware mikrokontroler ESP32
    │   ├── smartheight_progres2_dual_rfid/      # Firmware fisik ESP32 via USB Serial (Hardware Real)
    │   │   ├── diagram.json
    │   │   └── smartheight_progres2_dual_rfid.ino
    │   └── smartheight_wokwi/                   # Firmware simulasi nirkabel Wokwi (WiFi + MQTT)
    │       ├── diagram.json                     # Sirkuit simulasi Wokwi lengkap (Dual MFRC522 + HC-SR04 + Buzzer)
    │       ├── libraries.txt                    # Dependensi library Wokwi (PubSubClient)
    │       ├── README.md                        # Panduan cepat simulasi Wokwi
    │       ├── smartheight_wokwi.ino            # Sketch Arduino simulasi Wokwi
    │       └── wokwi.toml                       # Konfigurasi simulasi Wokwi CLI / VS Code
    ├── supabase/
    │   └── schema.sql                           # Skema DDL PostgreSQL (tabel members, rides, ride_validations)
    └── tests/                                   # Automated test suite (Node.js test runner)
        ├── data.test.mjs                        # Model data & local storage repository
        ├── ride-validation.test.mjs             # Logika kelayakan batas tinggi wahana
        ├── serial-protocol.test.mjs             # Parsing telemetri JSON & event RFID
        ├── supabase-mapper.test.mjs             # Pemetaan data frontend <-> Supabase DB
        └── wokwi-transport.test.mjs             # Konfigurasi MQTT & parser telemetri Wokwi (5 tests)
```

---

## 🔌 Rangkaian & Wiring Pin ESP32 (Wokwi & Hardware)

| Komponen | Pin Modul | Pin ESP32 | Keterangan Sirkuit |
|---|---|---|---|
| **RFID 1 (Pendaftaran)** | SCK | GPIO 18 | Bus VSPI Hardware |
| | MISO | GPIO 19 | Bus VSPI Hardware |
| | MOSI | GPIO 23 | Bus VSPI Hardware |
| | SDA (SS) | GPIO 5 | Chip Select RFID 1 |
| | RST | GPIO 22 | Reset RFID 1 |
| | 3.3V & GND | 3V3 & GND | Daya 3.3V & Ground |
| **RFID 2 (Akses Wahana)** | SCK | GPIO 14 | Bus HSPI Hardware |
| | MISO | GPIO 32 | Bus HSPI (*remapped* dari GPIO 12 untuk mencegah gagal boot) |
| | MOSI | GPIO 13 | Bus HSPI Hardware |
| | SDA (SS) | GPIO 4 | Chip Select RFID 2 |
| | RST | GPIO 21 | Reset RFID 2 |
| | 3.3V & GND | 3V3 & GND | Daya 3.3V & Ground |
| **HC-SR04 (Ultrasonik)** | VCC | 5V / VIN | Sumber tegangan 5V |
| | TRIG | GPIO 25 | Output trigger sensor |
| | ECHO | GPIO 26 | Input echo via *voltage divider* (R1=1kΩ seri, R2=2kΩ ke GND) |
| | GND | GND | Ground |
| **Buzzer Pasif** | SIGNAL / (+) | GPIO 27 | Sinyal nada PWM 2.000 Hz |
| | GND / (-) | GND | Ground |

---

## 🚀 Panduan Memulai Cepat

### 1. Menjalankan Simulasi Wokwi
1. Buka [https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32) (atau gunakan ekstensi Wokwi di VS Code).
2. Salin isi [`cocomang/firmware/smartheight_wokwi/diagram.json`](./cocomang/firmware/smartheight_wokwi/diagram.json) ke tab diagram Wokwi.
3. Salin kode [`cocomang/firmware/smartheight_wokwi/smartheight_wokwi.ino`](./cocomang/firmware/smartheight_wokwi/smartheight_wokwi.ino) ke tab sketch.
4. Tambahkan library `PubSubClient` di tab Library Manager Wokwi.
5. Klik **Start Simulation**. ESP32 akan otomatis tersambung ke `Wokwi-GUEST` WiFi dan broker HiveMQ.

### 2. Menjalankan Web Dashboard
1. Buka terminal pada root proyek atau folder `cocomang`:
   ```powershell
   py -m http.server 8000
   ```
2. Buka peramban di `http://localhost:8000` (otomatis dialihkan ke dashboard `/cocomang/dist/`).
3. Klik tombol **Hubungkan Wokwi**. Indikator status akan berubah menjadi **`🟢 Wokwi Terhubung`**.
4. Ubah slider jarak HC-SR04 atau dekatkan kartu ke modul RFID di simulator Wokwi; dashboard akan menerima data secara instan!

### 3. Konfigurasi Supabase Cloud (Opsional)
1. Salin template `.env.example` ke `cocomang/dist/.env`:
   ```powershell
   Copy-Item cocomang/dist/.env.example cocomang/dist/.env
   ```
2. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` sesuai proyek Supabase kamu.
3. Eksekusi skrip [`cocomang/supabase/schema.sql`](./cocomang/supabase/schema.sql) pada SQL Editor Supabase.
4. Saat dashboard dimuat, status di header langsung menampilkan **`🟢 Cloud Terhubung`**.

### 4. Menjalankan Automated Tests
```powershell
cd cocomang
npm test
npm run check
```
Hasil: **29 unit test lulus**.
