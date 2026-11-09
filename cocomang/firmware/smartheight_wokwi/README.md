# SmartHeight Wokwi Simulation

Simulasi ESP32 COCOMANG SmartHeight pada Wokwi dengan komunikasi nirkabel berbasis **WiFi + MQTT** langsung ke dashboard web (tanpa kabel serial USB).

## 🚀 Cara Menjalankan

### Opsi A: Melalui Wokwi Web (wokwi.com)
1. Buka [https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32).
2. Salin isi `diagram.json` ke tab `diagram.json` di Wokwi.
3. Salin kode `smartheight_wokwi.ino` ke tab sketch.
4. Di tab `Library Manager` Wokwi, tambahkan `PubSubClient`.
5. Klik tombol **Play/Start Simulation**.
6. Buka dashboard COCOMANG di peramban (`http://localhost:8000`), lalu klik **"Hubungkan Wokwi"**.

### Opsi B: Melalui Wokwi VS Code Extension
1. Pasang ekstensi **Wokwi Simulator** di VS Code.
2. Buka file `diagram.json` di folder ini.
3. Tekan `F1` -> pilih `Wokwi: Start Simulator`.

## 📡 Topik MQTT
- **Publish Telemetry:** `cocomang/smartheight/telemetry`
- **Publish RFID:** `cocomang/smartheight/rfid`
- **Subscribe Command:** `cocomang/smartheight/command`
