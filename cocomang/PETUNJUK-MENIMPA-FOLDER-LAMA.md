# Mengganti folder COCOMANG lama

Paket ini berisi satu folder proyek lengkap bernama `COCOMANG-Live`.

## Cara mengganti dengan aman di Windows

1. Tutup tab COCOMANG yang sedang berjalan dan putuskan ESP32 dari menu Pengukuran Live.
2. Hentikan server lokal dengan `Ctrl+C` di PowerShell.
3. Buat salinan cadangan folder COCOMANG lama terlebih dahulu, terutama jika masih ada perubahan yang belum disalin.
4. Ekstrak ZIP ini. Di dalamnya terdapat satu folder bernama `COCOMANG-Live`.
5. Ganti nama folder lama menjadi `COCOMANG-Live-backup` atau pindahkan ke lokasi cadangan.
6. Pindahkan folder `COCOMANG-Live` hasil ekstrak ke lokasi folder lama.
7. Jalankan server dari folder baru menggunakan:

   ```powershell
   py -m http.server 8000 --directory dist
   ```

8. Buka `http://localhost:8000` melalui Chrome atau Edge.

Jangan mengekstrak isi `dist` langsung ke root folder lama. Struktur folder `dist`, `firmware`, `docs`, dan `tests` harus tetap utuh.

## Firmware dan port serial

- Firmware berada di `firmware/smartheight_live_stream.ino`.
- Pin: TRIG GPIO 25, ECHO GPIO 26 melalui pembagi 1 kΩ/2 kΩ, buzzer GPIO 27, SDA GPIO 21, SCL GPIO 22.
- Buzzer aktif jika estimasi tinggi badan kurang dari 100 cm.
- Ganti `REFERENCE_HEIGHT_CM` dengan tinggi fisik aktual setelah pemasangan sensor; jangan menganggap nilai placeholder 220 cm sebagai hasil kalibrasi.
- Putuskan koneksi website sebelum upload firmware. Tutup Serial Monitor sebelum menghubungkan website karena satu port COM biasanya hanya dapat dibuka satu aplikasi pada satu waktu.

## Isi paket

- `dist/`: website COCOMANG untuk dijalankan secara lokal.
- `firmware/`: sketch Arduino untuk ESP32.
- `docs/`: panduan pengujian live.
- `tests/`: tes otomatis untuk data dan protokol serial.
- `README.md`, `DESIGN.md`, `QA.md`, dan `PANDUAN-GITHUB.md`.
