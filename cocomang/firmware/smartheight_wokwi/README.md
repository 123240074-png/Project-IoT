# SmartHeight Wokwi Simulation

Simulasi ESP32 COCOMANG SmartHeight pada Wokwi dengan komunikasi nirkabel berbasis **WiFi + MQTT over WebSocket** langsung ke dashboard web tanpa ketergantungan port serial fisik.

---

## 🔌 Komponen & Pemetaan Pin (Wokwi Circuit)

| Komponen di Wokwi | ID Komponen | Pin ESP32 DevKit V1 | Keterangan |
|---|---|---|---|
| **RFID 1 (Pendaftaran)** | `rfid1` (board-mfrc522) | SCK 18, MISO 19, MOSI 23, SS 5, RST 22 | Bus VSPI Hardware |
| **RFID 2 (Akses Wahana)** | `rfid2` (board-mfrc522) | SCK 14, MISO 32, MOSI 13, SS 4, RST 21 | Bus HSPI Hardware |
| **HC-SR04 (Ultrasonik)** | `ultra` (wokwi-hc-sr04) | TRIG 25, ECHO 26 (via divider 1k/2k) | Pengukuran Jarak |
| **Buzzer Pasif** | `bz1` (wokwi-buzzer) | SIGNAL 27, GND | Indikator Audio (2.000 Hz) |

---

## 🚀 Cara Menjalankan Simulasi

### Opsi A: Melalui Wokwi Web (wokwi.com)
1. Buka [https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32).
2. Salin seluruh isi file [`diagram.json`](./diagram.json) ke tab **diagram.json** di Wokwi.
3. Salin kode [`smartheight_wokwi.ino`](./smartheight_wokwi.ino) ke tab sketch Arduino utama.
4. Pada tab **Library Manager** Wokwi, cari dan tambahkan dependensi library:
   - `PubSubClient` (oleh Nick O'Leary)
5. Klik tombol **Play / Start Simulation** (F10).
6. Jalankan dashboard lokal COCOMANG (`http://localhost:8000`) lalu klik tombol **"Hubungkan Wokwi"**.

### Opsi B: Melalui Ekstensi VS Code Wokwi
1. Pasang ekstensi **Wokwi Simulator** di VS Code.
2. Buka folder proyek ini di VS Code.
3. Buka file `diagram.json` atau tekan `F1` lalu pilih **Wokwi: Start Simulator**.

---

## 📡 Topik MQTT & Perintah Interaktif

Broker publik: `broker.hivemq.com` (Port 1883 TCP untuk ESP32 / Port 8884 WSS untuk Dashboard Web).

| Topik MQTT | Arah | Keterangan & Format |
|---|---|---|
| `cocomang/smartheight/telemetry` | Publish (ESP32 -> Web) | Payload JSON: `distanceCm`, `heightCm`, `referenceHeightCm`, dll. |
| `cocomang/smartheight/rfid` | Publish (ESP32 -> Web) | Format event: `[RFID 1 - PENDAFTARAN] Kartu Terdeteksi! UID: ...` |
| `cocomang/smartheight/command` | Subscribe (Web -> ESP32) | Karakter ASCII: `'b'` (bip sukses), `'n'` (bip gagal), `'u'` (trigger ultrasonik) |

---

## 🧪 Pengujian Interaktif di Simulator
- **Uji Tap RFID 1**: Klik modul RFID 1 (`rfid1`) di simulator, lalu dekatkan kartu RFID dummy untuk memicu pendaftaran member di dashboard.
- **Uji Tap RFID 2**: Klik modul RFID 2 (`rfid2`) di simulator untuk memvalidasi akses member ke gerbang wahana.
- **Uji Sensor Ultrasonik**: Klik modul sensor `ultra`, geser slider jarak untuk mengamati perubahan tinggi badan secara instan di dashboard.
