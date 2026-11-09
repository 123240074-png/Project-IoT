# Project IoT — COCOMANG SmartHeight

Proyek IoT Pengukuran Tinggi Badan & Deteksi Objek Universal berbasis **ESP32 DevKit V1 + HC-SR04 + Buzzer Pasif + LCD I2C** yang terhubung langsung ke dashboard browser via Web Serial API (115200 baud).

## 📂 Struktur Direktori

Seluruh kode sumber proyek berada pada folder [`cocomang/`](./cocomang/):

- **[`cocomang/dist/`](./cocomang/dist/)**: Aplikasi frontend Web Serial live dashboard (vanilla ES Modules).
- **[`cocomang/firmware/`](./cocomang/firmware/)**: Firmware sketch Arduino untuk ESP32 (`smartheight_live_stream.ino`).
- **[`cocomang/tests/`](./cocomang/tests/)**: Automated test suite Node.js (74 unit test lulus).
- **[`cocomang/docs/`](./cocomang/docs/)**: Dokumentasi pengujian physical layer.
- **[`cocomang/README.md`](./cocomang/README.md)**: Panduan lengkap instalasi, wiring diagram, dan cara menjalankan server lokal.
- **[`cocomang/DESIGN.md`](./cocomang/DESIGN.md)**: Arsitektur desain sistem & protokol komunikasi.
- **[`cocomang/QA.md`](./cocomang/QA.md)**: Catatan verifikasi & checklist QA.

## 🚀 Menjalankan Aplikasi Secara Lokal

1. Buka terminal di dalam folder `cocomang`:
   ```powershell
   cd cocomang
   ```
2. Jalankan server lokal:
   ```powershell
   py -m http.server 8000 --directory dist
   ```
3. Buka browser Chromium (Google Chrome atau Microsoft Edge) di:
   ```
   http://localhost:8000
   ```
4. Jalankan unit test:
   ```powershell
   npm test
   ```
