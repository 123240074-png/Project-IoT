# COCOMANG SmartHeight — Live USB Serial

Dashboard pengujian physical layer untuk proyek Smart Height Measurement. Versi ini disesuaikan dengan progres terakhir: **ESP32 DevKit V1 + HC-SR04 + buzzer pasif + LCD I2C**, dengan dua mode pada Pengukuran live: pengukuran tinggi dan deteksi objek untuk dataset kalibrasi. Tidak menggunakan RFID/RC522, NFC, Firebase, Telegram, load cell, atau servo.

## Cara kerja saat ini

1. Firmware ESP32 membaca HC-SR04 dan menghitung estimasi tinggi.
2. Buzzer ESP32 aktif ketika estimasi tinggi **kurang dari 100 cm**.
3. LCD I2C menampilkan jarak dan estimasi tinggi.
4. Firmware live mode mengambil 3 sampel, memakai median, lalu mengirim satu baris JSON sekitar setiap 300 ms melalui USB Serial pada 115200 baud. Untuk kalibrasi akhir, gunakan 5 sampel dan interval sekitar 650 ms agar pembacaan lebih tahan terhadap noise.
5. Dashboard COCOMANG membaca USB Serial langsung melalui Web Serial API.
6. Petugas memilih nama pengunjung dan menekan **Simpan hasil live**. Pembacaan live tidak otomatis memenuhi riwayat agar tabel tidak dipenuhi sampel berulang.
7. Mode **Deteksi objek** menguji kestabilan 5 frame valid berturut-turut terhadap target default 20–60 cm dengan toleransi 2 cm. Jarak sensor dan jarak aktual meteran ditampilkan sebelum snapshot eksplisit.
8. Snapshot pengujian objek disimpan sebagai dataset kalibrasi terpisah, bukan riwayat pengunjung, dan dapat diekspor ke CSV.
9. Riwayat tinggi dapat difilter berdasarkan rentang tanggal, nama, status buzzer, status kalibrasi, serta diurutkan menurut waktu atau tinggi.
10. Riwayat dapat diekspor ke CSV atau dicetak lalu disimpan sebagai PDF dari dialog browser.

## Persyaratan

- ESP32 DevKit V1 dan kabel USB data.
- HC-SR04 dengan pembagi tegangan ECHO 1 kΩ / 2 kΩ ke GPIO 26.
- Buzzer pasif pada GPIO 27.
- LCD I2C pada SDA GPIO 21 dan SCL GPIO 22.
- Arduino IDE untuk mengunggah firmware.
- Google Chrome atau Microsoft Edge desktop yang mendukung Web Serial API.
- Python 3 untuk menjalankan server statis lokal.

## Wiring

| Komponen | ESP32 |
|---|---|
| HC-SR04 VCC | VIN / 5V |
| HC-SR04 TRIG | GPIO 25 |
| HC-SR04 ECHO | GPIO 26 melalui divider 1 kΩ (seri) + 2 kΩ (ke GND) |
| HC-SR04 GND | GND |
| Buzzer pasif (+) | GPIO 27 |
| Buzzer pasif (-) | GND |
| LCD I2C SDA | GPIO 21 |
| LCD I2C SCL | GPIO 22 |
| LCD I2C VCC | Sesuai spesifikasi modul; umumnya 5V |
| LCD I2C GND | GND |

**Peringatan level logika:** bila backpack LCD diberi 5V dan pull-up SDA/SCL-nya menuju 5V, pasang bidirectional I2C logic-level converter antara backpack dan ESP32. Jangan biarkan GPIO ESP32 menerima sinyal I2C 5V. Semua GND harus tersambung bersama.

## Mengatur firmware

Buka `firmware/smartheight_progres2_dual_rfid/smartheight_progres2_dual_rfid.ino` dengan Arduino IDE. Firmware mendukung Dual SPI MFRC522 (VSPI & HSPI), HC-SR04, dan Buzzer Pasif.

Periksa nilai berikut sebelum pengujian manusia:

```cpp
static const float REFERENCE_HEIGHT_CM = 220.0f; // ganti dengan tinggi fisik aktual
static const float CALIBRATION_OFFSET_CM = 0.0f; // isi setelah kalibrasi jarak
static const bool CALIBRATION_CONFIRMED = false; // ubah true setelah validasi selesai
static const float HEIGHT_ALARM_LIMIT_CM = 100.0f;
```

- `REFERENCE_HEIGHT_CM`: jarak dari lantai ke permukaan depan transduser HC-SR04 setelah perangkat dipasang.
- `CALIBRATION_OFFSET_CM`: koreksi jarak berdasarkan pengujian dengan penggaris/meteran.
- `CALIBRATION_CONFIRMED`: hanya menjadi penanda status pada dashboard, bukan pengganti proses kalibrasi.
- Buzzer aktif ketika `heightCm < 100`. Pada tepat 100 cm, buzzer tidak aktif.

Upload ke ESP32 Dev Module. Firmware mengirim data JSON satu baris per pengukuran pada baud 115200. Contoh:

```json
{"type":"measurement","device":"smartheight-esp32","sequence":12,"status":"ok","distanceCm":45.20,"heightCm":174.80,"referenceHeightCm":220.00,"offsetCm":0.00,"validSamples":5,"buzzerAlarm":false,"calibrated":false,"uptimeMs":15320}
```

Contoh itu hanya format protokol, bukan hasil pengujian fisik.

## Menjalankan website di Windows

Ekstrak folder proyek, buka PowerShell pada folder `COCOMANG-Live`, lalu jalankan:

```powershell
py -m http.server 8000 --directory dist
```

Buka `http://localhost:8000` menggunakan Chrome atau Edge desktop. Jangan membuka `index.html` melalui `file://`. Web Serial tersedia pada secure context seperti `localhost` dan HTTPS.

## Menghubungkan ESP32

1. Pastikan firmware `smartheight_progres2_dual_rfid.ino` sudah diunggah.
2. Sebelum upload firmware, putuskan koneksi website melalui tombol **Putuskan**. Sebelum menghubungkan website, tutup Serial Monitor Arduino IDE. Port COM biasanya hanya dapat dibuka oleh satu aplikasi pada satu waktu.
3. Buka menu **Pengukuran live** pada COCOMANG.
4. Klik **Hubungkan ESP32**.
5. Pilih COM port ESP32 pada dialog browser dan izinkan akses.
6. Dashboard harus menunjukkan **Data live diterima** serta nilai jarak dan tinggi.
7. Untuk pengukuran tinggi, tambahkan pengunjung secara manual pada menu Pengunjung, pilih namanya, lalu klik **Simpan hasil live**.
8. Nama, usia, jenis kelamin, dan berat badan adalah data manual/opsional. Tinggi badan hanya berasal dari pembacaan sensor, bukan input operator.
Jika browser tidak menawarkan daftar COM, cek kabel USB data, driver USB-serial, dan apakah Serial Monitor atau aplikasi lain masih menggunakan port tersebut.

## Riwayat dan PDF

- Riwayat pengunjung hanya bertambah saat petugas menekan **Simpan hasil live** pada mode pengukuran tinggi.
- Data disimpan pada `localStorage` browser di perangkat tersebut. Tidak ada cloud sync atau Firebase pada tahap ini.
- CSV dapat diunduh langsung.
- Tombol **Cetak / Simpan PDF** membuka halaman laporan. Pada dialog cetak Chrome/Edge pilih printer **Save as PDF / Simpan sebagai PDF**.
- Gunakan rentang tanggal, pencarian nama, status buzzer, dan status kalibrasi untuk membatasi isi laporan. CSV dan PDF mengikuti filter yang sedang aktif.

## Pemeriksaan cepat

```powershell
npm test
npm run check
```

Tes Node memvalidasi model data, repository localStorage, dan parser protokol serial ESP32. Saat ini 10 test lulus. Pengujian browser dan perangkat fisik dijelaskan di `QA.md`.

## Batasan dan status verifikasi

- Tes otomatis memvalidasi model data, parser JSON, visualisasi, dan logika perangkat lunak; tes ini bukan pengujian sensor fisik.
- Koneksi USB Serial membutuhkan browser Chromium desktop yang mendukung Web Serial API.
- Website tidak dapat membaca COM port dari Safari/Firefox atau halaman `file://`.
- Firmware dan website harus memakai protokol JSON dan baud rate 115200 yang sama.
- Hasil tinggi tetap berupa estimasi prototipe. Validasi reference height, offset, posisi sensor, dan perbandingan dengan alat ukur perlu dilakukan secara fisik sebelum menyimpulkan akurasi.
- Buzzer dikendalikan firmware. Dashboard hanya menampilkan status ambang yang dikirim ESP32.
