# Panduan Integrasi Database Supabase — COCOMANG SmartHeight

Panduan langkah demi langkah untuk mengaktifkan database cloud **Supabase** (PostgreSQL) pada proyek COCOMANG SmartHeight Progres 2.

---

## 1. Persiapan Proyek di Supabase

1. Buka [https://supabase.com](https://supabase.com) dan masuk menggunakan akun GitHub / email kamu.
2. Buat proyek baru (*New Project*):
   - **Name**: `cocomang-smartheight` (atau sesuai keinginan)
   - **Database Password**: Buat password yang aman
   - **Region**: Pilih `Singapore (ap-southeast-1)` untuk latensi tercepat dari Indonesia.
3. Tunggu 1–2 menit hingga penyediaan database selesai.

---

## 2. Menjalankan Skema Database (DDL SQL)

1. Pada sidebar dashboard Supabase, buka menu **SQL Editor**.
2. Klik **New query**.
3. Buka file [`cocomang/supabase/schema.sql`](../supabase/schema.sql), lalu salin seluruh kodenya.
4. Tempel (*paste*) kode tersebut ke SQL Editor Supabase, lalu klik tombol **Run**.
5. Script ini akan secara otomatis:
   - Membuat tabel `members` (kartu RFID, nama, usia, berat, tinggi badan terkini).
   - Membuat tabel `rides` (katalog wahana: Roller Coaster, Kora-kora, Bianglala, Bumper Car).
   - Membuat tabel `ride_validations` (log akses wahana & hasil pengukuran).
   - Mengatur Row Level Security (RLS) dengan hak akses publik (*anon*).
   - Mengaktifkan publikasi Supabase Realtime (WebSocket).

---

## 3. Mengambil Kredensial API Supabase

1. Pada sidebar Supabase, buka **Project Settings** (ikon gerigi) → **API**.
2. Salin 2 nilai berikut:
   - **Project URL**: contoh `https://xyzcompany.supabase.co`
   - **Project API Keys** → `anon` `public`: contoh `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

---

## 4. Konfigurasi Kredensial via File `.env` (Praktis & Otomatis)

Kamu dapat menyimpan kredensial langsung ke file `.env` tanpa perlu memasukkannya berulang kali di browser:

1. Buat file `.env` di dalam folder `cocomang/dist/` (atau salin dari `.env.example`):
   ```powershell
   Copy-Item cocomang/dist/.env.example cocomang/dist/.env
   ```
2. Buka file `cocomang/dist/.env` dan masukkan kredensial Supabase kamu:
   ```env
   SUPABASE_URL=https://xyzcompany.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
3. File `.env` sudah masuk ke dalam `.gitignore` sehingga aman dari commit git.
4. Saat dashboard dibuka (`http://localhost:8000`), dashboard otomatis mendeteksi file `.env`, menguji koneksi, dan status di header langsung berubah menjadi **`🟢 Cloud Terhubung`**!

*(Alternatif: Jika tidak ingin menggunakan file `.env`, kamu tetap bisa memasukkan URL & Key secara manual melalui tombol status Supabase di header dashboard).*

---

## 5. Alur Pengujian Sistem (Dual RFID & Sensor HC-SR04)

```mermaid
sequenceDiagram
    autonumber
    actor Pengunjung
    actor Petugas
    participant R1 as ESP32 Reader 1 (Pendaftaran)
    participant R2 as ESP32 Reader 2 (Akses Wahana)
    participant US as Sensor HC-SR04
    participant Web as Web Dashboard
    participant DB as Supabase PostgreSQL

    Pengunjung->>R1: Tap Kartu RFID Baru
    R1-->>Web: Event Serial: [RFID 1] UID: 04:A1:B2:C3
    Web->>Petugas: Tampilkan Modal Tambah Member (UID terisi otomatis)
    Petugas->>Web: Isi Nama & Simpan Member
    Web->>DB: INSERT into members (rfid_uid, name, ...)
    
    Pengunjung->>US: Berdiri di bawah sensor tinggi
    US-->>Web: JSON Telemetri Tinggi Badan (misal: 162.5 cm)
    Petugas->>Web: Klik "Simpan hasil ukur"
    Web->>DB: UPDATE members SET height_cm = 162.5
    
    Pengunjung->>R2: Tap Kartu di Gerbang Wahana (misal: Roller Coaster Min 140 cm)
    R2-->>Web: Event Serial: [RFID 2] UID: 04:A1:B2:C3
    Web->>DB: Cek profil member & bandingkan dengan batas tinggi wahana
    alt Tinggi Memenuhi Syarat (162.5 cm >= 140 cm)
        Web-->>R2: Kirim Serial 'b' (Bip 1x normal)
        Web->>Petugas: Tampilkan Banner Hijau: LOLOS AKSES
        Web->>DB: INSERT into ride_validations (is_eligible: true)
    else Tinggi Kurang
        Web-->>R2: Kirim Serial 'n' (Bip 3x peringatan)
        Web->>Petugas: Tampilkan Banner Merah: DITOLAK
        Web->>DB: INSERT into ride_validations (is_eligible: false)
    end
```

---

## 6. Sifat Local-First & Offline Resilient

- **Koneksi Internet Terputus**: Pos ukur tetap dapat berjalan 100% menggunakan memori `localStorage` browser lokal. Pengukuran dan pendaftaran member tidak akan terblokir.
- **Koneksi Kembali Aktif**: Cukup buka modal database dan klik tombol sinkronisasi untuk mencadangkan data ke Supabase.
- **Multi-Layar / Multi-Device**: Jika Supabase terhubung, penambahan member atau pengukuran dari perangkat lain akan otomatis muncul secara live (*real-time WebSocket*) tanpa perlu me-refresh browser.
