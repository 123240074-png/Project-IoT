/*
  SMART HEIGHT MEASUREMENT SYSTEM - PURE MQTT WIRELESS EDITION (CALIBRATED ON-DEMAND)
  ESP32 DevKit V1 + Dual RFID RC522 (VSPI & HSPI) + HC-SR04 + Buzzer Pasif

  Perubahan pada versi ini (pengukuran tinggi badan terkalibrasi):
  - Tinggi referensi (jarak sensor ke lantai) tetap 200 cm (REFERENCE_HEIGHT_CM).
  - Data tinggi badan TIDAK dikirim ke MQTT secara realtime/periodik.
  - Pengukuran & kalibrasi dipicu oleh tombol "Ukur Tinggi Badan" dari website
    melalui topik MQTT <MQTT_TOPIC_PREFIX>/cmd/measure (atau perintah Serial 'y').
  - Saat dipicu, ESP32 mengambil 20 sampel valid, menghitung MEDIAN, lalu
    memverifikasi kestabilan data (rentang IQR <= 5 cm & rentang tinggi valid).
  - Data hanya dipublish ke MQTT (<MQTT_TOPIC_PREFIX>/telemetry) setelah
    terkalibrasi dan terverifikasi sesuai (calibrated: true).

  Arsitektur Komunikasi:
  - ESP32 terhubung ke Wi-Fi dan MQTT Cloud Broker (default: broker.emqx.io:1883).
  - Mengirim hasil pengukuran terkalibrasi ke topik: <MQTT_TOPIC_PREFIX>/telemetry
  - Mengirim deteksi kartu RFID 1 (Pendaftaran) ke topik: <MQTT_TOPIC_PREFIX>/rfid/reader1
  - Mengirim deteksi kartu RFID 2 (Akses Wahana) ke topik: <MQTT_TOPIC_PREFIX>/rfid/reader2
  - Mengirim status LWT (online/offline) ke topik: <MQTT_TOPIC_PREFIX>/status
  - Menerima perintah ukur & kalibrasi dari website di topik: <MQTT_TOPIC_PREFIX>/cmd/measure
      "start" / "measure" / "y" : Mulai pengambilan 20 sampel + median + verifikasi
  - Menerima perintah suara buzzer dari dashboard di topik: <MQTT_TOPIC_PREFIX>/cmd/buzzer
      'b' : Bunyi 1 bip pendek (200 ms) - konfirmasi sukses/lolos
      'n' : Bunyi 3 bip peringatan (100 ms per bip) - peringatan/ditolak

  Wiring Hardware:
  - RFID 1 (Pendaftaran Member): Bus VSPI
      SCK  -> GPIO 18, MISO -> GPIO 19, MOSI -> GPIO 23, SS -> GPIO 5, RST -> GPIO 22
  - RFID 2 (Akses Masuk Wahana): Bus HSPI
      SCK  -> GPIO 14, MISO -> GPIO 32 (remapped), MOSI -> GPIO 13, SS -> GPIO 4, RST -> GPIO 21
  - HC-SR04: TRIG -> GPIO 25, ECHO -> GPIO 26 (voltage divider 1k / 2k)
  - Buzzer Pasif: SIGNAL -> GPIO 27, GND -> GND (2.000 Hz)
*/

#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"

// ============================================================
// KONFIGURASI PIN HARDWARE
// ============================================================

// --- RFID 1: Bus VSPI (Pendaftaran) ---
static const uint8_t PIN_RFID1_SCK  = 18;
static const uint8_t PIN_RFID1_MISO = 19;
static const uint8_t PIN_RFID1_MOSI = 23;
static const uint8_t PIN_RFID1_SS   = 5;
static const uint8_t PIN_RFID1_RST  = 22;

// --- RFID 2: Bus HSPI (Akses Wahana) ---
static const uint8_t PIN_RFID2_SCK  = 14;
static const uint8_t PIN_RFID2_MISO = 32;
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
// PARAMETER SISTEM & TIMER NON-BLOCKING
// ============================================================
static const uint32_t SENSOR_TIMEOUT_US = 30000UL;
static const float MIN_DISTANCE_CM = 2.0f;
static const float MAX_DISTANCE_CM = 400.0f;
static const uint32_t ULTRASONIC_SAMPLE_INTERVAL_MS = 100;  // satu sampel tiap 100 ms
static const uint32_t RFID_POLL_INTERVAL_MS         = 100;
static const uint32_t RFID_COOLDOWN_MS              = 1500;

// --- Parameter pengukuran & kalibrasi tinggi badan ---
static const float   REFERENCE_HEIGHT_CM    = 200.0f; // jarak sensor ke lantai (tetap)
static const float   HEIGHT_CALIB_OFFSET_CM = 10.0f;  // koreksi kalibrasi (+10 cm)
static const float   MIN_PERSON_HEIGHT_CM   = 50.0f;  // di bawah ini dianggap bukan orang
static const float   MAX_PERSON_HEIGHT_CM   = 250.0f; // batas atas tinggi valid
static const float   FINAL_MAX_IQR_CM       = 5.0f;   // batas kestabilan IQR (Q3 - Q1) agar terverifikasi
static const uint8_t MEDIAN_WINDOW          = 5;      // jumlah sampel untuk filter median singkat
static const uint8_t INVALID_STREAK_LIMIT   = 3;      // bacaan gagal beruntun sebelum dianggap invalid
static const uint8_t  FINAL_SAMPLES         = 20;     // jumlah sampel untuk kalibrasi median
static const uint32_t FINAL_TIMEOUT_MS      = 10000;  // batas waktu pengumpulan 20 sampel

static float latestDistanceCm = NAN;
static float latestEstimatedHeightCm = NAN;
static bool  personPresent = false;

// State filter median singkat
static float   distBuf[MEDIAN_WINDOW];
static uint8_t distCount = 0;
static uint8_t distIdx = 0;
static uint8_t invalidStreak = 0;

// State pengukuran & kalibrasi final (median 20 sampel)
static bool     finalActive  = false;
static uint8_t  finalCount   = 0;
static float    finalHeightSamples[FINAL_SAMPLES];
static float    finalDistSamples[FINAL_SAMPLES];
static uint32_t finalStartMs = 0;

static uint32_t lastSampleMs     = 0;
static uint32_t lastRfidMs       = 0;
static uint32_t lastRfid1ReadMs  = 0;
static uint32_t lastRfid2ReadMs  = 0;
static uint32_t lastMqttRetryMs  = 0;
static uint32_t lastWifiRetryMs  = 0;
static uint32_t sequenceNumber   = 1;

// Buffer string topik MQTT
static char topicTelemetry[80];
static char topicRfid1[80];
static char topicRfid2[80];
static char topicCmdBuzzer[80];
static char topicCmdMeasure[80];
static char topicStatus[80];

// Inisialisasi Klien Jaringan
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ============================================================
// DRIVER MFRC522 DUAL-SPI (SPICLASS INDEPENDEN VSPI & HSPI)
// ============================================================
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
    : _spi(spi), _ssPin(ssPin), _rstPin(rstPin), _spiSettings(2000000, MSBFIRST, SPI_MODE0) {}

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

    // Konfigurasi transmiter (100% ASK modulation) & Sensitivitas Maksimum
    writeRegister(TxASKReg, 0x40);
    writeRegister(ModeReg, 0x3D);
    writeRegister(RFCfgReg, (0x07 << 4)); // 48 dB (Max antenna gain)

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

MFRC522_DualSPI rfid1(&vspiBus, PIN_RFID1_SS, PIN_RFID1_RST);
MFRC522_DualSPI rfid2(&hspiBus, PIN_RFID2_SS, PIN_RFID2_RST);

// ============================================================
// FUNGSI SUARA BUZZER PASIF
// ============================================================
void buzzerTone(uint16_t durationMs) {
  tone(PIN_BUZZER, BUZZER_FREQ_HZ, durationMs);
  delay(durationMs);
  noTone(PIN_BUZZER);
}

void buzzerBeepSingle() {
  buzzerTone(200);
}

void buzzerBeepTriple() {
  buzzerTone(100);
  delay(100);
  buzzerTone(100);
  delay(100);
  buzzerTone(100);
}

// ============================================================
// FUNGSI SENSOR HC-SR04
// ============================================================
bool readUltrasonicDistance(float &distanceCm) {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  const unsigned long durationUs = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (durationUs == 0) {
    return false;
  }

  distanceCm = durationUs / 58.0f;
  return (distanceCm >= MIN_DISTANCE_CM && distanceCm <= MAX_DISTANCE_CM);
}

// Forward declarations untuk publikasi MQTT hasil kalibrasi
void publishCalibratedTelemetry(float dist, float height, uint8_t samples, bool alarm);
void publishInvalidTelemetry(const char* errorMsg);

// Urutkan array float (ascending) untuk perhitungan median & kuartil
void sortFloatArray(float* arr, uint8_t len) {
  for (uint8_t i = 0; i + 1 < len; i++) {
    for (uint8_t j = i + 1; j < len; j++) {
      if (arr[j] < arr[i]) {
        float t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
    }
  }
}

// Median dari sampel terakhir di buffer singkat (membuang outlier sesaat)
float medianOfBuffer() {
  float tmp[MEDIAN_WINDOW];
  for (uint8_t i = 0; i < distCount; i++) tmp[i] = distBuf[i];
  sortFloatArray(tmp, distCount);
  return tmp[distCount / 2];
}

void startFinalMeasurement() {
  // Reset buffer agar 20 sampel benar-benar baru untuk sesi ukur saat ini
  distCount     = 0;
  distIdx       = 0;
  invalidStreak = 0;
  personPresent = false;
  latestDistanceCm = NAN;
  latestEstimatedHeightCm = NAN;

  finalActive  = true;
  finalCount   = 0;
  finalStartMs = millis();
  lastSampleMs = finalStartMs;
  Serial.printf("[KALIBRASI] Memulai pengukuran (%u sampel median). Mohon berdiri diam di bawah sensor...\n",
                (unsigned)FINAL_SAMPLES);
}

void abortFinalMeasurement(const char* reason) {
  if (!finalActive) return;
  finalActive = false;
  Serial.printf("[KALIBRASI] GAGAL: %s (terkumpul %u/%u sampel)\n",
                reason, (unsigned)finalCount, (unsigned)FINAL_SAMPLES);
  publishInvalidTelemetry(reason);
  buzzerBeepTriple();
}

// Dipanggil tiap ada sampel valid saat mode pengukuran & kalibrasi aktif
void collectFinalSample(float distCm, float heightCm) {
  if (!finalActive) return;

  finalDistSamples[finalCount]   = distCm;
  finalHeightSamples[finalCount] = heightCm;
  finalCount++;

  if (finalCount >= FINAL_SAMPLES) {
    finalActive = false;

    float sortedHeights[FINAL_SAMPLES];
    float sortedDists[FINAL_SAMPLES];
    for (uint8_t i = 0; i < FINAL_SAMPLES; i++) {
      sortedHeights[i] = finalHeightSamples[i];
      sortedDists[i]   = finalDistSamples[i];
    }
    sortFloatArray(sortedHeights, FINAL_SAMPLES);
    sortFloatArray(sortedDists, FINAL_SAMPLES);

    // Hitung median (untuk 20 sampel genap: rata-rata indeks 9 dan 10)
    const float medianHeight = (sortedHeights[FINAL_SAMPLES / 2 - 1] + sortedHeights[FINAL_SAMPLES / 2]) / 2.0f;
    const float medianDist   = (sortedDists[FINAL_SAMPLES / 2 - 1] + sortedDists[FINAL_SAMPLES / 2]) / 2.0f;

    // Hitung IQR (Q3 - Q1) untuk verifikasi kestabilan data tinggi badan
    const float q1  = sortedHeights[FINAL_SAMPLES / 4];
    const float q3  = sortedHeights[(FINAL_SAMPLES * 3) / 4];
    const float iqr = q3 - q1;

    Serial.printf("[KALIBRASI] Selesai %u sampel | min: %.1f | median: %.1f | max: %.1f | IQR: %.2f cm\n",
                  (unsigned)FINAL_SAMPLES, sortedHeights[0], medianHeight, sortedHeights[FINAL_SAMPLES - 1], iqr);

    // Verifikasi hasil kalibrasi sebelum dikirim ke MQTT
    const bool rangeValid = (medianHeight >= MIN_PERSON_HEIGHT_CM && medianHeight <= MAX_PERSON_HEIGHT_CM)
                         && (medianDist >= MIN_DISTANCE_CM && medianDist <= MAX_DISTANCE_CM);
    const bool stableValid = (iqr <= FINAL_MAX_IQR_CM);

    if (!rangeValid) {
      Serial.println(F("[KALIBRASI] DITOLAK: Nilai tinggi/jarak di luar rentang valid."));
      publishInvalidTelemetry("Tinggi badan di luar rentang valid");
      buzzerBeepTriple();
      return;
    }

    if (!stableValid) {
      Serial.printf("[KALIBRASI] DITOLAK: Pembacaan tidak stabil (IQR %.2f cm > %.1f cm).\n", iqr, FINAL_MAX_IQR_CM);
      publishInvalidTelemetry("Pembacaan tidak stabil, mohon berdiri diam dan ulangi");
      buzzerBeepTriple();
      return;
    }

    latestDistanceCm = medianDist;
    latestEstimatedHeightCm = medianHeight;
    const bool alarm = (medianHeight < 100.0f);

    Serial.printf("[KALIBRASI] TERVERIFIKASI -> Mengirim ke MQTT: %.1f cm (jarak: %.1f cm)\n",
                  medianHeight, medianDist);
    publishCalibratedTelemetry(medianDist, medianHeight, FINAL_SAMPLES, alarm);
    buzzerBeepSingle();
  }
}

void resetMeasurementWindow() {
  abortFinalMeasurement("Pembacaan sensor terputus");
  distCount = 0;
  distIdx = 0;
  personPresent = false;
  latestDistanceCm = NAN;
  latestEstimatedHeightCm = NAN;
}

// Dipanggil tiap ULTRASONIC_SAMPLE_INTERVAL_MS hanya saat sesi pengukuran aktif
void updateMeasurement() {
  float d = 0.0f;
  if (!readUltrasonicDistance(d)) {
    if (++invalidStreak >= INVALID_STREAK_LIMIT) {
      resetMeasurementWindow();
    }
    return;
  }
  invalidStreak = 0;

  // Masukkan ke ring buffer median singkat
  distBuf[distIdx] = d;
  distIdx = (distIdx + 1) % MEDIAN_WINDOW;
  if (distCount < MEDIAN_WINDOW) distCount++;
  if (distCount < 3) return;  // belum cukup sampel awal

  const float m = medianOfBuffer();
  latestDistanceCm = m;

  const float diff = REFERENCE_HEIGHT_CM - m;  // tinggi objek dari lantai (tanpa offset)

  if (diff >= MIN_PERSON_HEIGHT_CM) {
    personPresent = true;
    const float height = REFERENCE_HEIGHT_CM - m + HEIGHT_CALIB_OFFSET_CM;
    latestEstimatedHeightCm = height;
    collectFinalSample(m, height);
  } else {
    // Jika orang sudah sempat terdeteksi lalu pergi sebelum 20 sampel, gagalkan
    if (personPresent && finalCount > 0) {
      abortFinalMeasurement("Orang meninggalkan area sensor sebelum kalibrasi selesai");
    }
    personPresent = false;
    latestEstimatedHeightCm = 0.0f;
  }
}

void formatUidString(const MFRC522_DualSPI::Uid &uid, char* outBuffer, size_t maxLen) {
  size_t offset = 0;
  for (uint8_t i = 0; i < uid.size && offset + 3 < maxLen; i++) {
    offset += snprintf(outBuffer + offset, maxLen - offset, "%02X%s", uid.uidByte[i], (i + 1 < uid.size) ? ":" : "");
  }
}

// ============================================================
// CALLBACK & RECONNECT MQTT
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (length == 0) return;

  if (strcmp(topic, topicCmdBuzzer) == 0) {
    char cmd = (char)payload[0];
    Serial.printf("[MQTT CMD] Perintah buzzer diterima: '%c'\n", cmd);
    if (cmd == 'b' || cmd == 'B') {
      buzzerBeepSingle();
    } else if (cmd == 'n' || cmd == 'N') {
      buzzerBeepTriple();
    }
    return;
  }

  if (strcmp(topic, topicCmdMeasure) == 0) {
    char msg[24];
    unsigned int copyLen = (length < sizeof(msg) - 1) ? length : (sizeof(msg) - 1);
    memcpy(msg, payload, copyLen);
    msg[copyLen] = '\0';
    Serial.printf("[MQTT CMD] Perintah ukur tinggi badan diterima: '%s'\n", msg);

    if (strcmp(msg, "start") == 0 || strcmp(msg, "measure") == 0 ||
        msg[0] == 'y' || msg[0] == 'Y' || msg[0] == '1') {
      startFinalMeasurement();
    }
  }
}

bool connectMqttBroker() {
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.printf("[MQTT] Menghubungkan ke %s:%d...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);

  bool connected = false;
  if (strlen(MQTT_USERNAME) > 0) {
    connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD, topicStatus, 0, true, "offline");
  } else {
    connected = mqttClient.connect(MQTT_CLIENT_ID, topicStatus, 0, true, "offline");
  }

  if (connected) {
    Serial.println(F("[MQTT] Terhubung ke Cloud Broker!"));
    mqttClient.publish(topicStatus, "online", true);
    mqttClient.subscribe(topicCmdBuzzer);
    mqttClient.subscribe(topicCmdMeasure);
    Serial.printf("[MQTT] Berlangganan ke topik: %s & %s\n", topicCmdBuzzer, topicCmdMeasure);
    buzzerBeepSingle();
    return true;
  } else {
    Serial.printf("[MQTT] Gagal konek, status=%d\n", mqttClient.state());
    return false;
  }
}

void handleNetworkReconnections(uint32_t now) {
  // 1. Cek Koneksi Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiRetryMs >= 5000) {
      lastWifiRetryMs = now;
      Serial.println(F("[WIFI] Menghubungkan ke Wi-Fi..."));
      WiFi.reconnect();
    }
    return;
  }

  // 2. Cek Koneksi MQTT jika Wi-Fi sudah aktif
  if (!mqttClient.connected()) {
    if (now - lastMqttRetryMs >= 4000) {
      lastMqttRetryMs = now;
      connectMqttBroker();
    }
  } else {
    mqttClient.loop();
  }
}

// ============================================================
// PUBLIKASI DATA TELEMETRI TERKALIBRASI & EVENT RFID VIA MQTT
// ============================================================
void publishCalibratedTelemetry(float dist, float height, uint8_t samples, bool alarm) {
  char jsonBuffer[384];
  snprintf(
    jsonBuffer, sizeof(jsonBuffer),
    "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"ok\",\"distanceCm\":%.1f,\"heightCm\":%.1f,\"referenceHeightCm\":%.1f,\"offsetCm\":%.1f,\"validSamples\":%u,\"buzzerAlarm\":%s,\"calibrated\":true,\"uptimeMs\":%lu}",
    (unsigned long)(sequenceNumber++),
    dist,
    height,
    REFERENCE_HEIGHT_CM,
    HEIGHT_CALIB_OFFSET_CM,
    (unsigned)samples,
    alarm ? "true" : "false",
    (unsigned long)millis()
  );

  Serial.println(jsonBuffer);

  if (mqttClient.connected()) {
    mqttClient.publish(topicTelemetry, jsonBuffer);
  }
}

void publishInvalidTelemetry(const char* errorMsg) {
  char jsonBuffer[384];
  snprintf(
    jsonBuffer, sizeof(jsonBuffer),
    "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"invalid\",\"error\":\"%s\",\"distanceCm\":0.0,\"heightCm\":0.0,\"referenceHeightCm\":%.1f,\"offsetCm\":%.1f,\"validSamples\":0,\"buzzerAlarm\":true,\"calibrated\":false,\"uptimeMs\":%lu}",
    (unsigned long)(sequenceNumber++),
    errorMsg,
    REFERENCE_HEIGHT_CM,
    HEIGHT_CALIB_OFFSET_CM,
    (unsigned long)millis()
  );

  Serial.println(jsonBuffer);

  if (mqttClient.connected()) {
    mqttClient.publish(topicTelemetry, jsonBuffer);
  }
}

void publishRfidEvent(uint8_t readerNum, const MFRC522_DualSPI::Uid &uid) {
  char uidStr[32];
  formatUidString(uid, uidStr, sizeof(uidStr));

  char jsonBuffer[160];
  const char* typeStr = (readerNum == 1) ? "registration" : "ride_access";
  const char* labelStr = (readerNum == 1) ? "PENDAFTARAN" : "AKSES WAHANA";

  snprintf(
    jsonBuffer, sizeof(jsonBuffer),
    "{\"reader\":%d,\"uid\":\"%s\",\"bytes\":%d,\"type\":\"%s\",\"label\":\"%s\"}",
    readerNum, uidStr, uid.size, typeStr, labelStr
  );

  Serial.printf("[RFID %d] %s -> %s\n", readerNum, labelStr, uidStr);

  if (mqttClient.connected()) {
    const char* targetTopic = (readerNum == 1) ? topicRfid1 : topicRfid2;
    mqttClient.publish(targetTopic, jsonBuffer);
  }
}

// ============================================================
// PROSEDUR SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(400);

  Serial.println();
  Serial.println(F("================================================================"));
  Serial.println(F("    SMART HEIGHT MEASUREMENT SYSTEM - PURE MQTT WIRELESS        "));
  Serial.println(F("================================================================"));

  // 1. Format Topik MQTT berdasarkan konfigurasi
  snprintf(topicTelemetry, sizeof(topicTelemetry), "%s/telemetry", MQTT_TOPIC_PREFIX);
  snprintf(topicRfid1, sizeof(topicRfid1), "%s/rfid/reader1", MQTT_TOPIC_PREFIX);
  snprintf(topicRfid2, sizeof(topicRfid2), "%s/rfid/reader2", MQTT_TOPIC_PREFIX);
  snprintf(topicCmdBuzzer, sizeof(topicCmdBuzzer), "%s/cmd/buzzer", MQTT_TOPIC_PREFIX);
  snprintf(topicCmdMeasure, sizeof(topicCmdMeasure), "%s/cmd/measure", MQTT_TOPIC_PREFIX);
  snprintf(topicStatus, sizeof(topicStatus), "%s/status", MQTT_TOPIC_PREFIX);

  // 2. Inisialisasi Hardware
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);

  // 3. Inisialisasi Dual RFID SPI
  Serial.print(F("[INIT] Inisialisasi RFID 1 (VSPI: SCK=18, MISO=19, MOSI=23, SS=5, RST=22)... "));
  vspiBus.begin(PIN_RFID1_SCK, PIN_RFID1_MISO, PIN_RFID1_MOSI, PIN_RFID1_SS);
  rfid1.begin();
  uint8_t v1 = rfid1.getFirmwareVersion();
  if (v1 != 0x00 && v1 != 0xFF) {
    Serial.printf("OK! Chip Version: 0x%02X\n", v1);
  } else {
    Serial.printf("PERINGATAN (Chip Version: 0x%02X - Cek koneksi VSPI)\n", v1);
  }

  Serial.print(F("[INIT] Inisialisasi RFID 2 (HSPI: SCK=14, MISO=32, MOSI=13, SS=4, RST=21)... "));
  hspiBus.begin(PIN_RFID2_SCK, PIN_RFID2_MISO, PIN_RFID2_MOSI, PIN_RFID2_SS);
  rfid2.begin();
  uint8_t v2 = rfid2.getFirmwareVersion();
  if (v2 != 0x00 && v2 != 0xFF) {
    Serial.printf("OK! Chip Version: 0x%02X\n", v2);
  } else {
    Serial.printf("PERINGATAN (Chip Version: 0x%02X - Cek koneksi HSPI / Pin MISO 32 / RST 21)\n", v2);
  }

  // 4. Inisialisasi Koneksi Wi-Fi
  Serial.printf("[WIFI] Menghubungkan ke SSID: %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // 5. Inisialisasi Klien MQTT
  mqttClient.setBufferSize(512);
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setCallback(mqttCallback);

  buzzerBeepSingle();
  Serial.println(F("[SYSTEM] Inisialisasi selesai. Sistem siap beroperasi!"));
}

// ============================================================
// MAIN LOOP NON-BLOCKING
// ============================================================
void loop() {
  const uint32_t now = millis();

  // 1. HANDLE PERINTAH SERIAL INTERAKTIF (DIAGNOSTIK & TES)
  if (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    if (cmd == 'r' || cmd == 'R') {
      Serial.println(F("[DIAGNOSTIK] Status Hardware Chip RFID:"));
      uint8_t v1 = rfid1.getFirmwareVersion();
      uint8_t v2 = rfid2.getFirmwareVersion();
      Serial.printf("  RFID 1 (VSPI - Pendaftaran) : Version 0x%02X -> %s\n", v1, (v1 != 0x00 && v1 != 0xFF) ? "OK" : "ERROR (Cek Pin/Kabel)");
      Serial.printf("  RFID 2 (HSPI - Akses Wahana): Version 0x%02X -> %s\n", v2, (v2 != 0x00 && v2 != 0xFF) ? "OK" : "ERROR (Cek Pin MISO 32 / RST 21)");
    } else if (cmd == 'y' || cmd == 'Y') {
      startFinalMeasurement();    // mulai kalibrasi median 20 sampel
    } else if (cmd == 'b' || cmd == 'B') {
      buzzerBeepSingle();
    } else if (cmd == 'n' || cmd == 'N') {
      buzzerBeepTriple();
    }
  }

  // 2. PENGELOLAAN JARINGAN (WI-FI & MQTT NON-BLOCKING)
  handleNetworkReconnections(now);

  // 3. POLLING PEMBACAAN DUAL RFID
  if (now - lastRfidMs >= RFID_POLL_INTERVAL_MS) {
    lastRfidMs = now;

    // Polling RFID 1 (VSPI - Pendaftaran)
    if (rfid1.isNewCardPresent() && rfid1.readCardSerial()) {
      if (now - lastRfid1ReadMs > RFID_COOLDOWN_MS) {
        lastRfid1ReadMs = now;
        publishRfidEvent(1, rfid1.uid);
        buzzerBeepSingle();
        rfid1.haltA();
      }
    }

    // Polling RFID 2 (HSPI - Akses Wahana)
    if (rfid2.isNewCardPresent() && rfid2.readCardSerial()) {
      if (now - lastRfid2ReadMs > RFID_COOLDOWN_MS) {
        lastRfid2ReadMs = now;
        publishRfidEvent(2, rfid2.uid);
        buzzerBeepSingle(); // Konfirmasi lokal tap kartu
        rfid2.haltA();
      }
    }
  }

  // 4. SAMPLING & KALIBRASI SENSOR ULTRASONIK ON-DEMAND (100 ms)
  // Data tidak dikirim realtime; hanya dikirim ke MQTT setelah 20 sampel median terverifikasi.
  if (finalActive) {
    const uint32_t sampleNow = millis();
    if (sampleNow - lastSampleMs >= ULTRASONIC_SAMPLE_INTERVAL_MS) {
      lastSampleMs = sampleNow;
      updateMeasurement();
    }

    if (finalActive && (millis() - finalStartMs) > FINAL_TIMEOUT_MS) {
      abortFinalMeasurement("Waktu habis, orang tidak terdeteksi di bawah sensor");
    }
  }

  delay(10);
}
