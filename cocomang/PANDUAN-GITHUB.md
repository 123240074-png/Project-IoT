# COCOMANG: upload ke GitHub dan ajak teman

Panduan ini memakai akun GitHub pribadi dan GitHub Desktop agar kamu tidak perlu mengetik perintah Git. Nama tombol dapat sedikit berbeda menurut versi GitHub atau jenis akun.

## 1. Siapkan kode di komputer

1. Unduh ZIP sumber COCOMANG yang diberikan bersama dashboard.
2. Ekstrak ZIP. Buka folder hasil ekstraknya sampai terlihat `package.json`, `README.md`, folder `dist`, dan folder `tests`. Inilah folder proyek yang akan dipakai.
3. Pasang [GitHub Desktop](https://desktop.github.com/) dan masuk dengan akun [GitHub](https://github.com/). Buat akun terlebih dahulu jika belum punya.

Paket sumber ini tidak menyertakan riwayat `.git`, kredensial, atau identitas hosting `.openai/hosting.json` dari sesi Sites. Data pengunjung yang kamu masukkan lewat aplikasi tersimpan di browser, jadi data tersebut tidak ikut dalam ZIP sumber.

## 2. Upload melalui GitHub Desktop

1. Di GitHub Desktop, pilih **File → Add Local Repository**. Pilih folder proyek hasil ekstraksi tadi.
2. Karena folder hasil ZIP belum menjadi repository Git, GitHub Desktop akan menawarkan **create a repository here**. Klik tautan tersebut. Periksa nama dan lokasi agar repository dibuat pada folder yang berisi `package.json`, bukan folder kosong baru di dalamnya. Gunakan nama repository seperti `cocomang`.
3. Setelah repository dibuat, lihat tab **Changes**. Jika ada file yang belum dicatat, isi Summary, misalnya `Tambah dashboard COCOMANG`, lalu klik **Commit to main**. Jika sudah masuk initial commit dan Changes kosong, lanjutkan.
4. Klik **Publish repository**. Pilih akunmu sebagai pemilik dan nama `cocomang` atau nama lain yang tersedia.
5. Biarkan **Keep this code private** tercentang jika kode hanya untuk kelompokmu. Teman tetap dapat bekerja setelah diundang sebagai kolaborator.
6. Klik **Publish Repository**, lalu **View on GitHub**. Pastikan halaman repository menampilkan folder `dist`, folder `tests`, dan `package.json`.

Repository GitHub sudah berisi kode setelah langkah ini. Mengunggah kode belum membuat GitHub Pages atau menghubungkan deployment Sites secara otomatis.

## 3. Undang teman sebagai kolaborator

1. Buka repository COCOMANG di GitHub melalui browser.
2. Pilih **Settings** pada repository, bukan pengaturan akun pribadi.
3. Di bagian **Access**, buka **Collaborators**. Pada akun/organisasi tertentu namanya **Collaborators and teams** atau **Manage access**. GitHub mungkin meminta konfirmasi login.
4. Klik **Add people** atau **Add collaborator**.
5. Cari username GitHub temanmu. Pilih akun yang benar, lalu kirim undangan. Untuk repository organisasi yang menawarkan pilihan role, **Write** cukup untuk mengubah kode dan mengirim pull request.
6. Minta teman membuka email atau notifikasi GitHub dan menerima undangannya. Status **Pending** berarti undangan belum diterima.
7. Setelah menerima, teman dapat membuka repository dan memilih **Code → Open with GitHub Desktop**, atau memilih **File → Clone Repository** di GitHub Desktop.

Kamu perlu menjadi pemilik repository atau memiliki akses admin untuk mengundang orang. Tidak perlu memberikan password akun GitHub kepada teman.

## 4. Cara kerja bersama agar perubahan rapi

Setiap orang memakai salinan proyek di komputernya sendiri. Gunakan branch untuk tugas masing-masing:

1. Sebelum mulai, klik **Fetch origin** dan **Pull origin** bila ada pembaruan.
2. Dari branch `main`, pilih **Current Branch → New Branch**. Beri nama sesuai tugas, misalnya `fitur/firebase`, `perbaikan/form-pengunjung`, atau `tampilan/mobile`.
3. Edit file di VS Code atau editor lain dan coba aplikasinya secara lokal.
4. Di GitHub Desktop, tinjau file yang berubah, tulis ringkasan, lalu klik **Commit to ...** pada branch tugasmu.
5. Klik **Publish branch** untuk branch baru, atau **Push origin** untuk branch yang sudah ada.
6. Klik **Create Pull Request**, atau buka GitHub dan pilih **Compare & pull request**. Jelaskan perubahan dan hasil pengujian.
7. Minta satu teman memeriksa perubahan. Setelah disetujui dan konflik diselesaikan, pemilik atau kolaborator dengan izin menulis dapat melakukan **Merge pull request**.
8. Anggota lain kembali ke `main`, lalu **Fetch/Pull origin** untuk mendapatkan perubahan terbaru.

Pembagian tugas contoh: satu orang menangani formulir pengunjung, satu orang integrasi Firebase, dan satu orang perangkat ESP32. Jika dua orang perlu mengubah file yang sama, sepakati bagian yang dikerjakan terlebih dahulu.

## 5. Menjalankan aplikasi dan tes

Dari folder yang berisi `package.json`, jalankan server lokal dengan Python:

```sh
python3 -m http.server 8000 --directory dist
```

Pada Windows dengan Python Launcher:

```powershell
py -m http.server 8000 --directory dist
```

Buka **http://localhost:8000**. Gunakan **Ctrl+C** di terminal untuk menghentikan server. Jangan membuka `index.html` langsung melalui `file://`, karena aplikasi menggunakan JavaScript modules.

Pasang [Node.js LTS](https://nodejs.org/) untuk menjalankan pemeriksaan:

```sh
npm test
npm run check
```

Proyek saat ini tidak membutuhkan `npm install` untuk aplikasi atau dua perintah pemeriksaan tersebut. Untuk menjalankan `npm test` pada proyek ini, gunakan Node.js LTS yang masih didukung.

## Alternatif: upload langsung dari browser

Cara ini bisa dipakai untuk upload pertama jika belum memasang GitHub Desktop:

1. Buka [github.com/new](https://github.com/new), isi nama `cocomang`, pilih **Private**, lalu klik **Create repository**.
2. Pada repository kosong, pilih tautan **uploading an existing file**. Pada repository yang sudah berisi file, pilih **Add file → Upload files**.
3. Ekstrak ZIP terlebih dahulu. Seret **isi folder proyek**, termasuk folder `dist`, folder `tests`, dan file lainnya, ke area upload. Jangan hanya mengunggah file ZIP, dan jangan memasukkan semua kode satu tingkat terlalu dalam di folder tambahan.
4. Pastikan `.gitignore` ikut terunggah. Jika file bertitik tidak terlihat di file manager, aktifkan tampilan file tersembunyi atau tambahkan melalui **Add file → Create new file**.
5. Isi pesan commit, misalnya `Tambah dashboard COCOMANG`, lalu klik **Commit changes**.
6. Ikuti bagian undangan kolaborator di atas.

Sesudah upload pertama, GitHub Desktop lebih nyaman untuk perubahan rutin dan pekerjaan berkelompok.

## Akses kode dan akses aplikasi berbeda

- **Kolaborator GitHub** dapat membaca atau mengubah kode sesuai izinnya. Ini tidak membuat akun login petugas di dashboard.
- **Pengunjung situs Sites** mengikuti pengaturan berbagi situs Sites. Undangan repository GitHub tidak otomatis memberi akses ke tautan situs yang privat.
- **Data pengunjung aplikasi** saat ini memakai localStorage, jadi setiap browser/perangkat memiliki datanya sendiri. GitHub tidak menyinkronkan data tersebut.
- **Firebase dan ESP32** belum terhubung. Setelah integrasi Firebase, akun petugas, izin database, dan sinkronisasi perlu diatur tersendiri.
- **Deployment Sites** belum terhubung otomatis ke repository GitHub yang kamu buat. Push kode ke GitHub tidak otomatis memperbarui situs yang sudah terbit.

File `.gitignore` sudah mengabaikan `.env`, dependensi, dan log lokal. Saat menambahkan integrasi nanti, simpan kredensial server serta private key di tempat yang sesuai dan jangan commit ke repository.
