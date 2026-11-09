# Panduan pengujian COCOMANG SmartHeight Live

## Tahap A — cek hardware

1. Pastikan HC-SR04: VCC ke 5V, TRIG ke GPIO 25, ECHO melalui pembagi 1 kΩ/2 kΩ ke GPIO 26, GND bersama.
2. Buzzer pasif: positif/signal ke GPIO 27 dan negatif ke GND.
3. LCD I2C: SDA GPIO 21, SCL GPIO 22, VCC/GND sesuai spesifikasi. Gunakan level shifter jika pull-up I2C backpack berada di 5V.
4. Periksa tidak ada hubung singkat sebelum memberi daya.

## Tahap B — kalibrasi jarak

Sebelum mengukur manusia, gunakan papan datar tegak lurus terhadap sensor. Ukur jarak aktual pada titik 30, 40, 50, 60, dan 70 cm. Catat minimal 10 pembacaan di setiap titik. Bandingkan median pembacaan dengan jarak aktual.

Offset untuk setiap titik:

`offset_i = jarak_aktual_i - jarak_terbaca_i`

Jika offset relatif konstan, gunakan rata-rata offset sebagai `CALIBRATION_OFFSET_CM`. Jika error berubah nyata mengikuti jarak, satu offset tidak cukup; jangan mengklaim kalibrasi selesai sebelum model koreksi diuji ulang.

## Tahap C — tinggi referensi

Ukur jarak vertikal dari lantai ke permukaan depan transduser HC-SR04 setelah sensor dipasang menghadap ke bawah. Masukkan angka itu ke `REFERENCE_HEIGHT_CM`. Jangan menganggap placeholder 220 cm sebagai nilai final.

Rumus firmware:

`correctedDistanceCm = medianDistanceCm + CALIBRATION_OFFSET_CM`

`heightCm = REFERENCE_HEIGHT_CM - correctedDistanceCm`

## Tahap D — integrasi serial

1. Upload firmware live.
2. Tutup Arduino Serial Monitor.
3. Jalankan server lokal: `py -m http.server 8000 --directory dist`.
4. Buka `http://localhost:8000` pada Chrome/Edge desktop.
5. Hubungkan COM port dan pastikan nilai live berubah saat target digerakkan.
6. Bandingkan data di LCD, Serial (bila browser sedang tidak membuka COM), dan dashboard.
7. Simpan hasil setelah nilai stabil.

## Tahap E — uji alarm buzzer

Dengan reference height yang diketahui, atur objek sehingga estimasi tinggi berada di bawah 100 cm. Buzzer seharusnya berbunyi secara berkala. Pada tinggi 100 cm atau lebih, buzzer tidak aktif. Uji kondisi ini di meja dengan target datar dahulu, jangan menggunakan manusia sebagai satu-satunya target kalibrasi.

## Tahap F — laporan

Pilih rentang tanggal di Riwayat pengukuran. Gunakan Ekspor CSV untuk pengolahan data atau Cetak / Simpan PDF lalu pilih Save as PDF di dialog browser.
