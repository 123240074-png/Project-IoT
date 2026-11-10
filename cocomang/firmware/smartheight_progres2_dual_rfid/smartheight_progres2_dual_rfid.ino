/*
  SMART HEIGHT MEASUREMENT SYSTEM - PROGRES 2 (PHYSICAL LAYER)
  ESP32 DevKit V1 + Dual RFID RC522 (VSPI & HSPI) + HC-SR04 + Buzzer Pasif
  
  Berdasarkan Dokumen Laporan & Skema Wokwi Progres 2:
  - RFID 1 (Pendaftaran Member): Bus VSPI
      SCK  -> GPIO 18
      MISO -> GPIO 19
      MOSI -> GPIO 23
      SDA/SS -> GPIO 5
      RST  -> GPIO 22
      3.3V -> 3V3, GND -> GND
  
  - RFID 2 (Akses Masuk Wahana): Bus HSPI
      SCK  -> GPIO 14
      MISO -> GPIO 32 (remapped dari GPIO 12 untuk kestabilan booting ESP32)
      MOSI -> GPIO 13
      SDA/SS -> GPIO 4
      RST  -> GPIO 21
      3.3V -> 3V3, GND -> GND
  
  - Sensor Ultrasonik HC-SR04:
      VCC  -> VIN (5V)
      GND  -> GND
      TRIG -> GPIO 25
      ECHO -> GPIO 26 (melalui voltage divider R1=1kΩ seri & R2=2kΩ ke GND -> ~3.33V)
  
  - Buzzer Pasif:
      SIGNAL / + -> GPIO 27
      GND / -    -> GND
      Frekuensi  -> 2.000 Hz

  Perintah Serial Interaktif:
    'b' : Bunyi 1 bip pendek (200 ms) - konfirmasi normal
    'n' : Bunyi 3 bip peringatan (100 ms per bip, jeda 100 ms)
    'r' : Baca status hardware kedua reader RFID
    'u' : Trigger pembacaan langsung sensor ultrasonik
*/

#include <Arduino.h>
#include <SPI.h>

// ============================================================
// KONFIGURASI PIN HARDWARE (SESUAI LAPORAN PROGRES 2)
// ============================================================

// --- RFID 1: Bus VSPI (Pendaftaran) ---
static const uint8_t PIN_RFID1_SCK  = 18;
static const uint8_t PIN_RFID1_MISO = 19;
static const uint8_t PIN_RFID1_MOSI = 23;
static const uint8_t PIN_RFID1_SS   = 5;
static const uint8_t PIN_RFID1_RST  = 22;

// --- RFID 2: Bus HSPI (Akses Wahana) ---
static const uint8_t PIN_RFID2_SCK  = 14;
static const uint8_t PIN_RFID2_MISO = 32; // Remapped pin
static const uint8_t PIN_RFID2_MOSI = 13;
static const uint8_t PIN_RFID2_SS   = 4;
static const uint8_t PIN_RFID2_RST  = 21;

// --- HC-SR04 Ultrasonik ---
static const uint8_t PIN_TRIG = 25;
static const uint8_t PIN_ECHO = 26;

// --- Buzzer Pasif ---
static const uint8_t PIN_BUZZER = 27;
static const uint16_t BUZZER_FREQ_HZ = 2000;

// ============================================================
// PARAMETER SISTEM & PENGUJIAN
// ============================================================
static const uint32_t SENSOR_TIMEOUT_US = 30000UL; // 30 ms (~5 meter max)
static const float MIN_DISTANCE_CM = 2.0f;
static const float MAX_DISTANCE_CM = 400.0f;
static const uint32_t ULTRASONIC_INTERVAL_MS = 500; // Pembacaan periodik tiap 500 ms
static const uint32_t RFID_POLL_INTERVAL_MS   = 100; // Polling RFID tiap 100 ms

// --- Parameter Kalkulasi Tinggi Badan ---
// Jarak dari lantai ke permukaan depan sensor (default instalasi: 220 cm)
static const float REFERENCE_HEIGHT_CM = 220.0f; 

// State pembacaan sensor & timer non-blocking
static float latestDistanceCm = NAN;
static float latestEstimatedHeightCm = NAN;
static uint32_t lastUltrasonicMs = 0;
static uint32_t lastRfidMs       = 0;
static uint32_t lastRfid1ReadMs  = 0;
static uint32_t lastRfid2ReadMs  = 0;
static const uint32_t RFID_COOLDOWN_MS = 1500; // Mencegah spam deteksi kartu yang sama
static uint32_t sequenceNumber = 1;

// ============================================================
// DRIVER MFRC522 NATIVE DUAL-SPI (MENDUKUNG SPICLASS TERPISAH)
// ============================================================
// Implementasi driver register MFRC522 langsung di atas SPIClass ESP32.
// Memungkinkan VSPI dan HSPI beroperasi secara benar-benar independen
// tanpa keterbatasan hardcoded SPI bawaan library standar.

class MFRC522_DualSPI {
public:
  enum PCD_Register : uint8_t {
    CommandReg     = 0x01,
    ComIEnReg      = 0x02,
    DivIEnReg      = 0x03,
    ComIrqReg      = 0x04,
    DivIrqReg      = 0x05,
    ErrorReg       = 0x06,
    Status1Reg     = 0x07,
    Status2Reg     = 0x08,
    FIFODataReg    = 0x09,
    FIFOLevelReg   = 0x0A,
    WaterLevelReg  = 0x0B,
    ControlReg     = 0x0C,
    BitFramingReg  = 0x0D,
    CollReg        = 0x0E,
    ModeReg        = 0x11,
    TxModeReg      = 0x12,
    RxModeReg      = 0x13,
    TxControlReg   = 0x14,
    TxASKReg       = 0x15,
    RFCfgReg       = 0x26,
    TModeReg       = 0x2A,
    TPrescalerReg  = 0x2B,
    TReloadRegH    = 0x2C,
    TReloadRegL    = 0x2D,
    VersionReg     = 0x37
  };

  enum PCD_Command : uint8_t {
    PCD_Idle       = 0x00,
    PCD_CalcCRC    = 0x03,
    PCD_Transceive = 0x0C,
    PCD_SoftReset  = 0x0F
  };

  enum PICC_Command : uint8_t {
    PICC_CMD_REQA    = 0x26,
    PICC_CMD_WUPA    = 0x52,
    PICC_CMD_SEL_CL1 = 0x93,
    PICC_CMD_SEL_CL2 = 0x95,
    PICC_CMD_HLTA    = 0x50
  };

  struct Uid {
    uint8_t size;
    uint8_t uidByte[10];
    uint8_t sak;
  } uid;

  SPIClass* _spi;
  uint8_t _ssPin;
  uint8_t _rstPin;
  SPISettings _spiSettings;

  MFRC522_DualSPI(SPIClass* spi, uint8_t ssPin, uint8_t rstPin)
    : _spi(spi), _ssPin(ssPin), _rstPin(rstPin), _spiSettings(4000000, MSBFIRST, SPI_MODE0) {}

  void writeRegister(uint8_t reg, uint8_t value) {
    _spi->beginTransaction(_spiSettings);
    digitalWrite(_ssPin, LOW);
    _spi->transfer((reg << 1) & 0x7E);
    _spi->transfer(value);
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
  }

  void writeRegister(uint8_t reg, uint8_t count, uint8_t* values) {
    _spi->beginTransaction(_spiSettings);
    digitalWrite(_ssPin, LOW);
    _spi->transfer((reg << 1) & 0x7E);
    for (uint8_t i = 0; i < count; i++) {
      _spi->transfer(values[i]);
    }
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
  }

  uint8_t readRegister(uint8_t reg) {
    _spi->beginTransaction(_spiSettings);
    digitalWrite(_ssPin, LOW);
    _spi->transfer(((reg << 1) & 0x7E) | 0x80);
    uint8_t val = _spi->transfer(0x00);
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
    return val;
  }

  void readRegister(uint8_t reg, uint8_t count, uint8_t* values, uint8_t rxAlign = 0) {
    if (count == 0) return;
    uint8_t address = ((reg << 1) & 0x7E) | 0x80;
    _spi->beginTransaction(_spiSettings);
    digitalWrite(_ssPin, LOW);
    _spi->transfer(address);
    uint8_t i = 0;
    if (rxAlign) {
      uint8_t mask = (0xFF << rxAlign) & 0xFF;
      uint8_t value = _spi->transfer(address);
      values[0] = (values[0] & ~mask) | (value & mask);
      i++;
    }
    while (i < count) {
      values[i] = _spi->transfer(address);
      i++;
    }
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
  }

  void setBitMask(uint8_t reg, uint8_t mask) {
    writeRegister(reg, readRegister(reg) | mask);
  }

  void clearBitMask(uint8_t reg, uint8_t mask) {
    writeRegister(reg, readRegister(reg) & (~mask));
  }

  void begin() {
    pinMode(_ssPin, OUTPUT);
    digitalWrite(_ssPin, HIGH);
    pinMode(_rstPin, OUTPUT);

    // Hard reset modul
    digitalWrite(_rstPin, LOW);
    delayMicroseconds(20);
    digitalWrite(_rstPin, HIGH);
    delay(50);

    // Soft reset melalui register
    writeRegister(CommandReg, PCD_SoftReset);
    delay(50);

    // Inisialisasi Timer prescaler untuk timeout komunikasi (~40 kHz timer)
    writeRegister(TModeReg, 0x8D);
    writeRegister(TPrescalerReg, 0x3E);
    writeRegister(TReloadRegL, 30);
    writeRegister(TReloadRegH, 0);

    // Konfigurasi transmiter (100% ASK modulation)
    writeRegister(TxASKReg, 0x40);
    writeRegister(ModeReg, 0x3D);

    // Aktifkan antena (Tx1 & Tx2 output pins)
    setBitMask(TxControlReg, 0x03);
  }

  uint8_t getFirmwareVersion() {
    return readRegister(VersionReg);
  }

  bool communicateWithPICC(uint8_t command, uint8_t waitIRq,
                           uint8_t* sendData, uint8_t sendLen,
                           uint8_t* backData = nullptr, uint8_t* backLen = nullptr,
                           uint8_t* validBits = nullptr, uint8_t rxAlign = 0) {
    uint8_t txLastBits = validBits ? *validBits : 0;
    uint8_t bitFraming = (rxAlign << 4) + txLastBits;

    writeRegister(CommandReg, PCD_Idle);
    writeRegister(ComIrqReg, 0x7F);              // Clear interrupt bits
    setBitMask(FIFOLevelReg, 0x80);              // Flush FIFO buffer
    writeRegister(FIFODataReg, sendLen, sendData); // Isi data pengiriman
    writeRegister(BitFramingReg, bitFraming);
    writeRegister(CommandReg, command);          // Jalankan command (Transceive)

    if (command == PCD_Transceive) {
      setBitMask(BitFramingReg, 0x80);           // StartSend bit
    }

    // Tunggu proses selesai atau timeout (~36 ms)
    uint32_t startMs = millis();
    bool completed = false;
    while (millis() - startMs < 40) {
      uint8_t irq = readRegister(ComIrqReg);
      if (irq & waitIRq) {
        completed = true;
        break;
      }
      if (irq & 0x01) { // Timer interrupt (timeout)
        break;
      }
    }

    clearBitMask(BitFramingReg, 0x80); // Stop send

    if (!completed) return false;

    uint8_t errorRegValue = readRegister(ErrorReg);
    if (errorRegValue & 0x13) return false; // BufferOvfl, ParityErr, ProtocolErr

    if (backData && backLen) {
      uint8_t n = readRegister(FIFOLevelReg);
      if (n > *backLen) return false;
      *backLen = n;
      readRegister(FIFODataReg, n, backData, rxAlign);
      if (validBits) {
        *validBits = readRegister(ControlReg) & 0x07;
      }
    }
    return true;
  }

  bool isNewCardPresent() {
    // Kirim perintah WUPA (0x52) 7-bit
    writeRegister(BitFramingReg, 0x07);
    uint8_t cmd = PICC_CMD_WUPA;
    uint8_t bufferATQA[2];
    uint8_t bufferSize = sizeof(bufferATQA);
    uint8_t validBits = 7;

    bool success = communicateWithPICC(PCD_Transceive, 0x30, &cmd, 1, bufferATQA, &bufferSize, &validBits, 0);
    return success && (bufferSize == 2);
  }

  bool readCardSerial() {
    // Protokol Anti-collision ISO/IEC 14443-3 PICC Cascade Level 1
    uint8_t buffer[9];
    buffer[0] = PICC_CMD_SEL_CL1;
    buffer[1] = 0x20; // NVB (Number of Valid Bits: 2 bytes)
    uint8_t bufferSize = sizeof(buffer);
    uint8_t validBits = 0;

    writeRegister(BitFramingReg, 0x00);
    bool success = communicateWithPICC(PCD_Transceive, 0x30, buffer, 2, buffer, &bufferSize, &validBits, 0);
    if (!success || bufferSize < 5) return false;

    // Verifikasi XOR Checksum (BCC)
    uint8_t bcc = buffer[0] ^ buffer[1] ^ buffer[2] ^ buffer[3];
    if (bcc != buffer[4]) return false;

    // Simpan UID (4 byte)
    uid.size = 4;
    for (uint8_t i = 0; i < 4; i++) {
      uid.uidByte[i] = buffer[i];
    }
    return true;
  }

  void haltA() {
    uint8_t buffer[4];
    buffer[0] = PICC_CMD_HLTA;
    buffer[1] = 0;
    // Hitung CRC sederhana untuk Halt
    calculateCRC(buffer, 2, &buffer[2]);
    communicateWithPICC(PCD_Transceive, 0x30, buffer, 4);
  }

  bool calculateCRC(uint8_t* data, uint8_t length, uint8_t* result) {
    writeRegister(CommandReg, PCD_Idle);
    writeRegister(DivIrqReg, 0x04);
    setBitMask(FIFOLevelReg, 0x80);
    writeRegister(FIFODataReg, length, data);
    writeRegister(CommandReg, PCD_CalcCRC);

    uint32_t start = millis();
    while (millis() - start < 50) {
      if (readRegister(DivIrqReg) & 0x04) {
        writeRegister(CommandReg, PCD_Idle);
        result[0] = readRegister(0x21); // CRCResultRegL
        result[1] = readRegister(0x22); // CRCResultRegH
        return true;
      }
    }
    return false;
  }
};

// Inisialisasi Bus Hardware ESP32
SPIClass vspiBus(VSPI);
SPIClass hspiBus(HSPI);

// Inisialisasi Reader
MFRC522_DualSPI rfid1(&vspiBus, PIN_RFID1_SS, PIN_RFID1_RST);
MFRC522_DualSPI rfid2(&hspiBus, PIN_RFID2_SS, PIN_RFID2_RST);

// ============================================================
// FUNGSI BUZZER PASIF (SESUAI PENGUJIAN 3 LAPORAN)
// ============================================================
void buzzerTone(uint16_t durationMs) {
  tone(PIN_BUZZER, BUZZER_FREQ_HZ, durationMs);
  delay(durationMs);
  noTone(PIN_BUZZER);
}

// Pola Perintah 'b': Satu bip 200 ms (konfirmasi sukses)
void buzzerBeepSingle() {
  buzzerTone(200);
}

// Pola Perintah 'n': Tiga bip 100 ms dengan jeda 100 ms (peringatan)
void buzzerBeepTriple() {
  buzzerTone(100);
  delay(100);
  buzzerTone(100);
  delay(100);
  buzzerTone(100);
}

// ============================================================
// FUNGSI SENSOR HC-SR04 (SESUAI PENGUJIAN 2 LAPORAN)
// ============================================================
bool readUltrasonicDistance(float &distanceCm) {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  const unsigned long durationUs = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (durationUs == 0) {
    return false; // Timeout (tidak ada pantulan)
  }

  // Rumus konversi laporan: durasi (µs) / 58.0
  distanceCm = durationUs / 58.0f;
  return (distanceCm >= MIN_DISTANCE_CM && distanceCm <= MAX_DISTANCE_CM);
}

void printUidString(const MFRC522_DualSPI::Uid &uid) {
  for (uint8_t i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) Serial.print("0");
    Serial.print(uid.uidByte[i], HEX);
    if (i + 1 < uid.size) Serial.print(":");
  }
}

// ============================================================
// EMISI TELEMETRI SERIAL JSON (KOMPATIBEL DENGAN WEB DASHBOARD)
// ============================================================
void emitMeasurementJson(float dist, float height, bool ok) {
  if (ok) {
    Serial.printf(
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"ok\",\"distanceCm\":%.1f,\"heightCm\":%.1f,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":5,\"buzzerAlarm\":false,\"calibrated\":false}\n",
      (unsigned long)(sequenceNumber++), dist, height, REFERENCE_HEIGHT_CM
    );
  } else {
    Serial.printf(
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"invalid\",\"error\":\"Di luar rentang pantulan\",\"distanceCm\":0.0,\"heightCm\":0.0,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":0,\"buzzerAlarm\":true,\"calibrated\":false}\n",
      (unsigned long)(sequenceNumber++), REFERENCE_HEIGHT_CM
    );
  }
}

// ============================================================
// PROSEDUR SETUP & VERIFIKASI AWAL
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println(F("================================================================"));
  Serial.println(F("       SMART HEIGHT MEASUREMENT SYSTEM - PROGRES 2 (PHYSICAL)   "));
  Serial.println(F("    Realisasi Wiring & Validasi Dual RFID, HC-SR04, Buzzer      "));
  Serial.println(F("================================================================"));

  // 1. Inisialisasi Pin Ultrasonik & Buzzer
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);

  // 2. Inisialisasi Bus VSPI untuk RFID 1 (Pendaftaran)
  Serial.print(F("[INIT] Inisialisasi VSPI (SCK:18, MISO:19, MOSI:23, SS:5, RST:22)... "));
  vspiBus.begin(PIN_RFID1_SCK, PIN_RFID1_MISO, PIN_RFID1_MOSI, PIN_RFID1_SS);
  rfid1.begin();
  uint8_t v1 = rfid1.getFirmwareVersion();
  if (v1 != 0x00 && v1 != 0xFF) {
    Serial.printf("OK! Chip Version: 0x%02X\n", v1);
  } else {
    Serial.printf("PERINGATAN (Chip Version: 0x%02X - Cek koneksi VSPI)\n", v1);
  }

  // 3. Inisialisasi Bus HSPI untuk RFID 2 (Akses Wahana)
  Serial.print(F("[INIT] Inisialisasi HSPI (SCK:14, MISO:32, MOSI:13, SS:4, RST:21)... "));
  hspiBus.begin(PIN_RFID2_SCK, PIN_RFID2_MISO, PIN_RFID2_MOSI, PIN_RFID2_SS);
  rfid2.begin();
  uint8_t v2 = rfid2.getFirmwareVersion();
  if (v2 != 0x00 && v2 != 0xFF) {
    Serial.printf("OK! Chip Version: 0x%02X\n", v2);
  } else {
    Serial.printf("PERINGATAN (Chip Version: 0x%02X - Cek koneksi HSPI)\n", v2);
  }

  // Bip sambutan awal (1 bip pendek)
  buzzerBeepSingle();

  Serial.println(F("----------------------------------------------------------------"));
  Serial.println(F("Sistem Siap! Perintah Serial Tersedia:"));
  Serial.println(F("  'b' -> Tes buzzer 1 bip (200 ms)"));
  Serial.println(F("  'n' -> Tes buzzer 3 bip (100 ms)"));
  Serial.println(F("  'r' -> Cek ulang status firmware chip RFID"));
  Serial.println(F("  'u' -> Baca langsung sensor HC-SR04"));
  Serial.println(F("Dekatkan kartu RFID pada reader 1 atau reader 2 di simulator Wokwi."));
  Serial.println(F("================================================================\n"));
}

// ============================================================
// MAIN LOOP
// ============================================================
void loop() {
  const uint32_t now = millis();

  // --- 1. HANDLE PERINTAH SERIAL INTERAKTIF ---
  if (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    if (cmd == 'b' || cmd == 'B') {
      Serial.println(F("[COMMAND] Eksekusi 'b' -> Satu bip 200 ms"));
      buzzerBeepSingle();
    } else if (cmd == 'n' || cmd == 'N') {
      Serial.println(F("[COMMAND] Eksekusi 'n' -> Tiga bip peringatan"));
      buzzerBeepTriple();
    } else if (cmd == 'r' || cmd == 'R') {
      Serial.println(F("[COMMAND] Cek Status Chip RFID:"));
      Serial.printf("  RFID 1 (VSPI): Version 0x%02X\n", rfid1.getFirmwareVersion());
      Serial.printf("  RFID 2 (HSPI): Version 0x%02X\n", rfid2.getFirmwareVersion());
    } else if (cmd == 'u' || cmd == 'U') {
      float testDist = 0.0f;
      bool ok = readUltrasonicDistance(testDist);
      float testHeight = ok ? (REFERENCE_HEIGHT_CM - testDist) : 0.0f;
      if (testHeight < 0.0f) testHeight = 0.0f;
      emitMeasurementJson(testDist, testHeight, ok);
    }
  }

  // --- 2. POLLING PEMBACAAN DUAL RFID ---
  if (now - lastRfidMs >= RFID_POLL_INTERVAL_MS) {
    lastRfidMs = now;

    // Polling RFID 1 (VSPI - Pendaftaran)
    if (rfid1.isNewCardPresent() && rfid1.readCardSerial()) {
      if (now - lastRfid1ReadMs > RFID_COOLDOWN_MS) {
        lastRfid1ReadMs = now;
        Serial.print(F("[RFID 1 - PENDAFTARAN] Kartu Terdeteksi! UID: "));
        printUidString(rfid1.uid);
        Serial.printf(" (Panjang: %d byte)\n", rfid1.uid.size);
        buzzerBeepSingle();
        rfid1.haltA();
      }
    }

    // Polling RFID 2 (HSPI - Akses Wahana)
    if (rfid2.isNewCardPresent() && rfid2.readCardSerial()) {
      if (now - lastRfid2ReadMs > RFID_COOLDOWN_MS) {
        lastRfid2ReadMs = now;
        Serial.print(F("[RFID 2 - AKSES WAHANA] Kartu Terdeteksi! UID: "));
        printUidString(rfid2.uid);
        Serial.printf(" (Panjang: %d byte)\n", rfid2.uid.size);
        // Respon buzzer pada Reader 2 (bip sukses / gagal) dikendalikan interaktif
        // oleh hasil verifikasi tinggi wahana dari dashboard via serial ('b' / 'n').
        rfid2.haltA();
      }
    }
  }

  // --- 3. PEMBACAAN PERIODIK SENSOR ULTRASONIK ---
  if (now - lastUltrasonicMs >= ULTRASONIC_INTERVAL_MS) {
    lastUltrasonicMs = now;

    float currentDistance = 0.0f;
    if (readUltrasonicDistance(currentDistance)) {
      latestDistanceCm = currentDistance;
      latestEstimatedHeightCm = REFERENCE_HEIGHT_CM - currentDistance;
      if (latestEstimatedHeightCm < 0.0f) latestEstimatedHeightCm = 0.0f;

      emitMeasurementJson(latestDistanceCm, latestEstimatedHeightCm, true);
    } else {
      latestDistanceCm = NAN;
      latestEstimatedHeightCm = NAN;
      emitMeasurementJson(0.0f, 0.0f, false);
    }
  }

  delay(10);
}
