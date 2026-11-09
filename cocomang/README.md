# COCOMANG SmartHeight — Live USB Serial & Cloud Sync

Pos sistem pengukuran tinggi badan otomatis dan validasi akses wahana rekreasi berbasis **ESP32 DevKit V1 + Dual RFID MFRC522 (VSPI & HSPI) + Sensor Ultrasonik HC-SR04 + Buzzer Pasif**, terhubung langsung ke dashboard browser melalui **Web Serial API (115200 baud)** serta disinkronkan ke database cloud **Supabase (PostgreSQL & Realtime)**.

---

## 📋 Ikhtisar & Arsitektur Progres 2

Proyek ini merupakan evolusi komprehensif dari prototipe pengukuran tunggal menjadi sistem pos terpadu tempat rekreasi/taman bermain:
- **Pendaftaran Member (RFID 1 - VSPI)**: Membaca kartu RFID baru, mengisi otomatis form registrasi UID (mendukung 4-byte, 7-byte, dan 10-byte UID), menyimpan profil member ke penyimpanan lokal (*local-first*) dan cloud database Supabase.
- **Pengukuran Tinggi Badan Real-Time (HC-SR04)**: Sensor ultrasonik *overhead* mengukur jarak ke puncak kepala pengunjung, mengonversi jarak ke tinggi badan aktual secara non-blocking, dan memungkinkan operator menyimpan hasil pengukuran langsung ke profil member.
- **Validasi Akses Gerbang Wahana (RFID 2 - HSPI)**: Pengunjung men-tap kartu di pintu wahana. Dashboard mencocokkan tinggi badan pengunjung dengan aturan batas tinggi wahana (misal: Roller Coaster min 140 cm, Kora-Kora min 125 cm, Bianglala min 100 cm, Bumper Car Anak 85–125 cm).
- **Audio Feedback Dua Arah**: Dashboard mengirimkan sinyal perintah kembali ke ESP32 melalui USB Serial (`'b'` untuk 1 bip sukses jika lolos kriteria, `'n'` untuk 3 bip peringatan jika ditolak).
- **Arsitektur Local-First**: Pos ukur dapat berjalan 100% tanpa internet menggunakan memori `localStorage` browser. Ketika terhubung ke Supabase, data disinkronkan otomatis secara real-time via WebSocket antar-perangkat.

---

## 🔌 Rangkaian & Wiring Hardware

### Skema Pin ESP32 DevKit V1 (30-Pin)

| Modul / Komponen | Pin Modul | Pin ESP32 | Deskripsi / Catatan |
|---|---|---|---|
| **RFID Reader 1**<br>*(Pendaftaran Member)* | SCK | GPIO 18 | Bus VSPI Hardware |
| | MISO | GPIO 19 | Bus VSPI Hardware |
| | MOSI | GPIO 23 | Bus VSPI Hardware |
| | SDA / SS | GPIO 5 | Chip Select RFID 1 |
| | RST | GPIO 22 | Hardware Reset RFID 1 |
| | 3.3V | 3V3 | Sumber daya 3.3V |
| | GND | GND | Ground |
| **RFID Reader 2**<br>*(Akses Masuk Wahana)* | SCK | GPIO 14 | Bus HSPI Hardware |
| | MISO | GPIO 32 | Bus HSPI (*remapped* dari GPIO 12 untuk mencegah gagal boot) |
| | MOSI | GPIO 13 | Bus HSPI Hardware |
| | SDA / SS | GPIO 4 | Chip Select RFID 2 |
| | RST | GPIO 21 | Hardware Reset RFID 2 |
| | 3.3V | 3V3 | Sumber daya 3.3V |
| | GND | GND | Ground |
| **HC-SR04**<br>*(Sensor Ultrasonik)* | VCC | VIN / 5V | Sumber daya 5V |
| | TRIG | GPIO 25 | Output trigger pulsa 10 µs |
| | ECHO | GPIO 26 | Input echo via *voltage divider* (1 kΩ seri + 2 kΩ ke GND -> ~3.33V) |
| | GND | GND | Ground |
| **Buzzer Pasif** | SIGNAL / (+) | GPIO 27 | Output modulasi nada PWM (2.000 Hz) |
| | GND / (-) | GND | Ground |

> [!IMPORTANT]
> **Proteksi Pin ECHO & RST:**
> 1. Pin ECHO HC-SR04 mengeluarkan sinyal logika 5V. Wajib menggunakan pembagi tegangan (*voltage divider*) 1 kΩ / 2 kΩ agar tegangan masuk ke GPIO 26 aman pada rentang 3.3V.
> 2. Pada Progres 2, pin GPIO 21 dan 22 difungsikan sebagai pin Reset terpisah untuk RFID Reader 1 dan RFID Reader 2, sehingga LCD I2C tidak lagi digunakan pada firmware ini. Tampilan live dialihkan sepenuhnya ke Web Dashboard.

---

## 💻 Firmware ESP32 (`smartheight_progres2_dual_rfid.ino`)

Firmware menggunakan driver native register MFRC522 berbasis SPIClass independen untuk VSPI dan HSPI, menjamin kedua reader RFID dapat beroperasi simultan tanpa konflik SPI bus.

### Parameter Sistem Utama

Buka [`firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino`](./firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino):

```cpp
static const float REFERENCE_HEIGHT_CM = 220.0f; // Jarak sensor ke lantai (sesuaikan instalasi)
static const uint32_t ULTRASONIC_INTERVAL_MS = 500; // Interval sampling ultrasonik (500 ms)
static const uint32_t RFID_POLL_INTERVAL_MS   = 100; // Polling kartu RFID (100 ms)
static const uint32_t RFID_COOLDOWN_MS        = 1500; // Cooldown anti-spam kartu (1.5 detik)
```

### Perintah Serial Interaktif (Dua Arah)

Baud rate: **115200 bps**. Dashboard atau operator dapat mengirimkan karakter ASCII tunggal ke ESP32:
- `'b'` atau `'B'`: Membunyikan 1 bip pendek (200 ms) — digunakan untuk konfirmasi tap sukses / akses wahana disetujui.
- `'n'` atau `'N'`: Membunyikan 3 bip peringatan (100 ms aktif, 100 ms jeda) — digunakan untuk peringatan akses wahana ditolak.
- `'r'` atau `'R'`: Memeriksa dan mencetak status versi firmware chip kedua modul MFRC522.
- `'u'` atau `'U'`: Memaksa pembacaan manual (*trigger*) sensor jarak HC-SR04.

### Format Keluaran Serial Telemetri

1. **Telemetri Pengukuran Ultrasonik (JSON format)**:
   ```json
   {"type":"measurement","device":"smartheight-esp32","sequence":14,"status":"ok","distanceCm":45.20,"heightCm":174.80,"referenceHeightCm":220.00,"offsetCm":0.00,"validSamples":5,"buzzerAlarm":false,"calibrated":false,"uptimeMs":15320}
   ```
2. **Log Event Tap RFID Reader 1 (Pendaftaran)**:
   ```text
   [RFID 1 - PENDAFTARAN] Kartu Terdeteksi! UID: 04:A1:B2:C3:D4 (Panjang: 5 byte)
   ```
3. **Log Event Tap RFID Reader 2 (Akses Wahana)**:
   ```text
   [RFID 2 - AKSES WAHANA] Kartu Terdeteksi! UID: 04:A1:B2:C3:D4 (Panjang: 5 byte)
   ```

---

## 🌐 Web Dashboard (`dist/`)

Aplikasi dashboard dibangun menggunakan arsitektur modern **Vanilla ES Modules** tanpa *bundler* atau *build step* rumit.

### Modul Arsitektur Frontend:
- [`dist/app.mjs`](./dist/app.mjs): *Application controller*, penanganan siklus hidup Web Serial API, perutean tab navigasi (Ringkasan, Pengunjung & Member, Pengukuran Live, Validasi Wahana, Riwayat), dan render antarmuka.
- [`dist/data.mjs`](./dist/data.mjs): Skema validasi data member (nama, usia, gender, berat badan, RFID UID 4/7/10-byte), pencegahan duplikasi UID kartu, penghapusan member (`deleteMember`), dan abstraksi `localStorage`.
- [`dist/serial-protocol.mjs`](./dist/serial-protocol.mjs): Parser data serial aman untuk frame JSON telemetri dan deteksi event regular expression tap RFID.
- [`dist/ride-validator.mjs`](./dist/ride-validator.mjs): Logika verifikasi kelayakan pengunjung wahana berdasarkan data tinggi badan terhadap batas minimal/maksimal wahana permainan.
- [`dist/supabase-service.mjs`](./dist/supabase-service.mjs): Integrasi database cloud Supabase PostgreSQL, pembacaan otomatis konfigurasi `.env`, dan sinkronisasi real-time channel.

---

## 🗄️ Konfigurasi Database Supabase Cloud

Sistem mendukung sinkronisasi cloud real-time ke Supabase:

1. **Deploy Skema SQL**:
   Salin isi file [`supabase/schema.sql`](./supabase/schema.sql) dan jalankan pada **SQL Editor** di konsol Supabase Anda untuk membuat tabel:
   - `members`: Menyimpan UID kartu RFID, nama, usia, jenis kelamin, berat, dan tinggi badan terkini.
   - `rides`: Daftar wahana permainan beserta batasan tinggi minimum & maksimum.
   - `ride_validations`: Log riwayat akses pengunjung ke wahana beserta status kelayakannya.
2. **Konfigurasi Kredensial via `.env`**:
   Salin template ke `dist/.env`:
   ```powershell
   Copy-Item dist/.env.example dist/.env
   ```
   Buka `dist/.env` lalu isi:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-anon-public-key-here
   ```
   Saat server dijalankan, dashboard otomatis membaca kredensial ini dan menghubungkan status cloud.
*(Panduan lengkap silakan baca [`docs/PANDUAN-SUPABASE.md`](./docs/PANDUAN-SUPABASE.md)).*

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Unggah Firmware
- Buka `firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino` pada Arduino IDE.
- Pilih board `ESP32 Dev Module`, lalu klik **Upload**.

### 2. Jalankan Server Web Lokal
Buka terminal/PowerShell di dalam folder `cocomang`:
```powershell
py -m http.server 8000 --directory dist
```
Buka browser **Google Chrome** atau **Microsoft Edge** pada URL:
```text
http://localhost:8000
```
> [!NOTE]
> Jangan membuka file melalui protokol `file://`. Web Serial API dan fitur keamanan browser hanya aktif pada *secure origin* (`http://localhost` atau HTTPS).

### 3. Hubungkan ke Perangkat ESP32
1. Tutup **Serial Monitor** di Arduino IDE (agar port COM tidak terkunci).
2. Di dashboard COCOMANG, klik tombol **Hubungkan ESP32**.
3. Pilih port COM perangkat ESP32 Anda pada popup browser dan izinkan akses.
4. Status akan berubah menjadi **🟢 ESP32 Terhubung (115200 baud)**.

### 4. Alur Operasional Pos:
- **Pendaftaran Member**: Tempelkan kartu RFID pada Reader 1. Dialog pendaftaran akan terbuka otomatis dengan UID terisi. Masukkan data identitas pengunjung dan klik simpan.
- **Pengukuran Tinggi**: Pengunjung berdiri di bawah sensor ultrasonik. Nilai live akan tampil pada dashboard. Klik tombol simpan untuk menyematkan tinggi ke profil pengunjung.
- **Validasi Wahana**: Buka tab wahana permainan, lalu minta pengunjung men-tap kartu pada Reader 2. Sistem akan memvalidasi tinggi badan pengunjung dan membunyikan buzzer ESP32 sesuai hasil kelayakan.

---

## 🧪 Pengujian Otomatis (*Automated Testing*)

Proyek ini dilengkapi dengan 24 unit test tanpa dependensi eksternal:

```powershell
npm test
```

Verifikasi sintaks modul JavaScript:
```powershell
npm run check
```

Cakupan pengujian mencakup:
- Parser protokol serial (`tests/serial-protocol.test.mjs`)
- Model data member & manajemen storage (`tests/data.test.mjs`)
- Logika batas kelayakan wahana permainan (`tests/ride-validation.test.mjs`)
- Pemetaan data Supabase model <-> database (`tests/supabase-mapper.test.mjs`)

---

## 📚 Dokumen Terkait

- [`DESIGN.md`](./DESIGN.md) — Prinsip desain sistem, filosofi antarmuka, dan arsitektur komunikasi.
- [`QA.md`](./QA.md) — Rencana jaminan mutu dan verifikasi fungsional perangkat.
- [`docs/PANDUAN-SUPABASE.md`](./docs/PANDUAN-SUPABASE.md) — Panduan integrasi Supabase dan arsitektur data cloud.
- [`docs/PANDUAN-PENGUJIAN-LIVE.md`](./docs/PANDUAN-PENGUJIAN-LIVE.md) — Prosedur operasional standar pengujian fisik dan kalibrasi sensor.
