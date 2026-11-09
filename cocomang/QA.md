# QA dan status verifikasi

## Pemeriksaan otomatis

`npm test` — 33 lulus, 0 gagal. `npm run check` — sukses.

- Parser mengabaikan teks Serial Monitor biasa dan JSON status yang tidak relevan.
- Parser menerima baris JSON measurement yang valid dan menolak field malformed.
- Model data memulai dengan daftar kosong, bukan sampel pengunjung palsu.
- Pengunjung dapat dibuat tanpa RFID.
- Gender dan berat badan tersimpan sebagai field opsional; data lama tanpa field tersebut tetap dapat dimuat.
- Hanya frame ESP32 valid yang dapat disimpan sebagai pengukuran tinggi.
- Penyimpanan lokal mempertahankan measurement history dengan schema dan storage key yang sama.
- State machine objek menghasilkan `DEVICE_OFFLINE`, `INVALID`, `NO_OBJECT`, `COLLECTING`, `STABLE`, dan `UNSTABLE` sesuai frame.
- Buffer objek tidak menghitung frame duplikat dan dikosongkan setelah frame invalid, objek keluar target, disconnect, atau data stale.
- Target range default 20–60 cm, toleransi 2 cm, dan 5 sampel dapat dikonfigurasi serta divalidasi.
- Error objek dihitung dari jarak terukur dikurangi jarak aktual; median dipakai untuk jarak terukur.
- Dataset objek memuat data kosong, menyimpan snapshot terbaru lebih dahulu, menolak data rusak/duplikat, dan memakai storage key terpisah.
- CSV dataset objek memakai BOM, header, dan baris data yang sesuai.
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

## Pemeriksaan browser — mode deteksi objek

Dilakukan pada Edge headless terisolasi di `127.0.0.1:9223` dengan fake Web Serial, profil QA terpisah, dan satu hasil object test awal. Hasil terakhir: `pass: true`.

- Halaman awal tetap memakai mode **Pengukuran tinggi**; segmented control berpindah ke **Deteksi objek** dengan judul “Deteksi Objek — HC-SR04”.
- Lima frame fake yang valid menghasilkan `STABLE`, jarak `40.2 cm`, rentang stabilitas `0.4 cm`, sampel `5/5`, dan buffer teknis `40.0 · 40.3 · 39.9 · 40.1 · 40.2`.
- Setelah target 40 cm dan jarak aktual 40 cm diisi, error tampil `+0.1 cm` dan tombol catat aktif.
- Snapshot menambah dataset dari 1 menjadi 2 baris dan `cocomang-object-tests-v1` menjadi 2 hasil.
- `cocomang-live-v1` tetap berisi 0 measurement dan 0 visitor setelah snapshot objek.
- Pada 1366 px dan 1920 px, input aktual desktop terlihat dan input mobile tersembunyi; nilainya tetap tersinkron.
- Pada 390 px, input aktual mobile terlihat setelah visualisasi dan sebelum status kestabilan; input desktop tersembunyi. Screenshot 320 px juga menunjukkan urutan yang sama.
- Tidak ada page overflow pada 320, 390, 768, 1366, dan 1920 px.
- Tidak ada console error, log error, atau exception selama sesi QA.
- Setelah berpindah kembali ke mode tinggi, elemen object hilang dan kontrol koneksi perangkat tetap tersedia.
- Screenshot QA tersedia di `%TEMP%\cocomang-object-qa\01-object-live-1366.png` sampai `08-dataset-390.png`; hasil ringkas ada di `results.json`.

## Batas verifikasi

- Tes Node tidak mengakses port COM atau hardware ESP32.
- Web Serial, koneksi COM nyata, LCD, buzzer, HC-SR04, dan akurasi kalibrasi harus diverifikasi dengan perangkat fisik.
- Pada pemeriksaan terakhir, sensor fisik yang terhubung masih mengirim `Echo tidak valid`; pengujian objek fisik belum dapat diklaim.
- Deteksi objek hanya memakai echo ultrasonik 1D terhadap target geometris universal; tidak ada kamera, pengenalan tangan, atau pengukuran koordinat 3D lateral. Enam arah adalah pengujian manual terkonfigurasi.
- Dialog **Save as PDF** yang sebenarnya belum diuji end-to-end; yang diverifikasi adalah pembuatan HTML laporan terfilter dari browser.
- Edge headless dan fake Web Serial bukan pengganti uji tampilan pada perangkat pengguna atau uji akurasi dengan alat ukur fisik.
