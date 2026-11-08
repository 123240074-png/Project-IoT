# COCOMANG: dashboard petugas

Simulasi aplikasi petugas untuk tugas Smart Height Measurement System. Tidak memerlukan framework atau dependensi produksi. Semua aset disajikan dari direktori `dist/`.

## Fitur

- Pendaftaran dan perubahan nama, usia, jenis kelamin, berat badan, nomor wali/telepon opsional, catatan, UID RFID.
- UID kartu virtual, validasi format, dan pencegahan duplikat.
- Tinggi tidak tersedia pada formulir petugas. Pos pengukuran menghitung tinggi referensi sensor (200 cm) dikurangi jarak dari skenario simulasi. Skenario gagal tidak menghapus hasil sebelumnya.
- Enam wahana contoh dengan minimum tinggi berbeda; konfigurasi nama, minimum tinggi, batas berat opsional, dan status operasional.
- Pemeriksaan akses dengan alasan penolakan dan riwayat keputusan tersendiri.
- Pencarian, filter, ekspor CSV pengunjung/riwayat, cadangan JSON.
- Penyimpanan localStorage tervalidasi, pesan gagal simpan, pencegahan penimpaan perubahan tab lain.

Nama wahana, pengunjung awal, dan ketentuannya adalah data fiktif untuk simulasi. Nama COCOMANG ditentukan pengguna. Ketentuan bukan standar keselamatan operasional wahana nyata. Label meja petugas pada header menunjukkan area kerja simulasi, bukan sistem autentikasi.

## Struktur

- `dist/app.mjs`: tampilan, formulir, navigasi, interaksi simulasi.
- `dist/data.mjs`: model, repository lokal, validasi, aturan akses, snapshot riwayat, CSV.
- `dist/style.css`: tema loket terang, responsive desktop/tablet/mobile.
- `tests/data.test.mjs`: uji aturan, validasi, penyimpanan, CSV.
- `DESIGN.md`: alasan desain dan penerapan Antislop.
- `QA.md`: bukti pemeriksaan dan batas verifikasi.
- `PANDUAN-GITHUB.md`: langkah mengunggah kode, mengundang teman, dan bekerja melalui branch/pull request.

## Menjalankan

Sajikan `dist/` dengan server file statis yang mendukung MIME `.mjs` (`text/javascript`). Jalankan terminal dari folder yang berisi `package.json`:

```sh
python3 -m http.server 8000 --directory dist
```

Pada Windows dengan Python Launcher, gunakan `py -m http.server 8000 --directory dist`. Buka http://localhost:8000. Buka melalui HTTP, bukan `file://`, karena menggunakan ES modules. Situs terhosting menyajikan direktori yang sama.

Untuk pemeriksaan, pasang Node.js LTS lalu jalankan `npm test` dan `npm run check`. Tidak perlu `npm install` untuk menjalankan pemeriksaan tersebut.

## Berkolaborasi melalui GitHub

Ikuti [panduan GitHub](PANDUAN-GITHUB.md) untuk mengunggah isi paket sumber dan menambahkan teman sebagai kolaborator. Paket sumber untuk dibagikan tidak membawa riwayat Git atau konfigurasi identitas hosting Sites dari sesi ini.

GitHub menyimpan kode proyek. Mengundang kolaborator ke repository tidak membuat akun petugas di aplikasi atau menyinkronkan data pengunjung. Perubahan yang di-push ke GitHub juga belum otomatis memperbarui situs Sites; integrasi deployment belum diatur.

## Persiapan integrasi Firebase berikutnya

Firebase belum terhubung dan tidak ada kredensial Firebase di sumber ini. Lapisan data dipisah dari UI tetapi repository saat ini sinkron. Saat mengintegrasikan Firestore, ubah alur load/save dan commit menjadi async, gunakan transaksi/update per dokumen dan subscription, bukan menimpa seluruh snapshot browser. Pisahkan koleksi `visitors`, `rides`, `accessLogs`, serta data pengukuran perangkat. Pertahankan validasi UID unik dan aturan tinggi minimum inklusif. Gunakan autentikasi petugas dan aturan akses Firestore sebelum memakai data nyata. Status dan kunci perangkat ESP32 memerlukan backend terotorisasi, bukan rahasia di JavaScript browser.

Data lokal tidak tersinkron antarperangkat. Ekspor JSON menyimpan cadangan; impor cadangan belum disediakan melalui UI.
