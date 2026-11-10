# QA dan status verifikasi

## Pemeriksaan otomatis

`npm test` — 10 lulus, 0 gagal. `npm run check` — sukses.

- Parser mengabaikan teks Serial Monitor biasa dan JSON status yang tidak relevan.
- Parser menerima baris JSON measurement yang valid dan menolak field malformed.
- Model data memulai dengan daftar kosong, bukan sampel pengunjung palsu.
- Pengunjung dapat dibuat tanpa RFID.
- Gender dan berat badan tersimpan sebagai field opsional; data lama tanpa field tersebut tetap dapat dimuat.
- Hanya frame ESP32 valid yang dapat disimpan sebagai pengukuran tinggi.
- Penyimpanan lokal mempertahankan measurement history dengan schema dan storage key yang sama.
- CSV dan laporan PDF pengunjung tidak memiliki dependensi eksternal; keduanya memakai data aktif di browser.

## Pemeriksaan browser — UI dan data

Dilakukan dengan Edge headless melalui server statis lokal dan profil QA terisolasi berisi 7 pengunjung serta 5 measurement.

- Desktop 1366 px dan 1920 px, tablet 768 px, mobile 390 px, dan narrow 320 px tidak mengalami overflow halaman.
- Tidak ada error console atau favicon 404 pada sesi QA.
- Navigasi, status aktif, ringkasan 7/4/3/5, serta status koneksi `Terputus` tampil konsisten.
- Pencarian `bima` menghasilkan 1 baris; filter buzzer menghasilkan 1; filter kalibrasi belum terkonfirmasi menghasilkan 2; rentang tanggal 1–9 November menghasilkan 4; satu hari 9 November menghasilkan 3; reset mengembalikan 5.
- Pengunjung baru dengan gender dan berat badan tersimpan, lalu otomatis dipilih pada halaman pengukuran.
- Laporan PDF terfilter menghasilkan 1 baris dan memuat nama yang dicari; CSV menghasilkan header dan 1 baris data.
- Empty state menampilkan 0 data, pesan khusus tanpa data, dan tombol simpan nonaktif tanpa error.
- Modal petunjuk perangkat dapat dibuka dan ditutup.
- Mobile: instrumen tampil sebelum form capture, navigasi tidak terpotong, toolbar riwayat memakai grid dua kolom, dan tabel lebar memakai scroll internal dengan petunjuk geser.

## Batas verifikasi

- Tes Node tidak mengakses port COM atau hardware ESP32.
- Web Serial, koneksi COM nyata, LCD, buzzer, HC-SR04, dan akurasi kalibrasi harus diverifikasi dengan perangkat fisik.
- Pada pemeriksaan terakhir, sensor fisik yang terhubung masih mengirim `Echo tidak valid`; pengujian objek fisik belum dapat diklaim.
- Dialog **Save as PDF** yang sebenarnya belum diuji end-to-end; yang diverifikasi adalah pembuatan HTML laporan terfilter dari browser.
- Edge headless dan fake Web Serial bukan pengganti uji tampilan pada perangkat pengguna atau uji akurasi dengan alat ukur fisik.
