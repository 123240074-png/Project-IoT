/*
  SMART HEIGHT MEASUREMENT SYSTEM - PURE MQTT WIRELESS EDITION
  ESP32 DevKit V1 + Dual RFID RC522 (VSPI & HSPI) + HC-SR04 + Buzzer Pasif
  
  Arsitektur Komunikasi:
  - ESP32 terhubung ke Wi-Fi dan MQTT Cloud Broker (default: broker.emqx.io:1883).
  - Mengirim telemetri ultrasonik periodik ke topik: <MQTT_TOPIC_PREFIX>/telemetry
  - Mengirim deteksi kartu RFID 1 (Pendaftaran) ke topik: <MQTT_TOPIC_PREFIX>/rfid/reader1
  - Mengirim deteksi kartu RFID 2 (Akses Wahana) ke topik: <MQTT_TOPIC_PREFIX>/rfid/reader2
  - Mengirim status LWT (online/offline) ke topik: <MQTT_TOPIC_PREFIX>/status
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
static const uint32_t ULTRASONIC_INTERVAL_MS = 500;
static const uint32_t RFID_POLL_INTERVAL_MS   = 100;
static const uint32_t RFID_COOLDOWN_MS        = 1500;

// Jarak sensor ke lantai (default: 220 cm)
static const float REFERENCE_HEIGHT_CM = 220.0f;

static float latestDistanceCm = NAN;
static float latestEstimatedHeightCm = NAN;
static uint32_t lastUltrasonicMs = 0;
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
    for (; i < count; i++) {
      values[i] = _spi->transfer(0x00);
    }
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
  }

  void setBitMask(uint8_t reg, uint8_t mask) {
    uint8_t current = readRegister(reg);
    writeRegister(reg, current | mask);
  }

  void clearBitMask(uint8_t reg, uint8_t mask) {
    uint8_t current = readRegister(reg);
    writeRegister(reg, current & (~mask));
  }

  void begin() {
    pinMode(_ssPin, OUTPUT);
    digitalWrite(_ssPin, HIGH);

    if (_rstPin != 255) {
      pinMode(_rstPin, OUTPUT);
      digitalWrite(_rstPin, LOW);
      delayMicroseconds(2);
      digitalWrite(_rstPin, HIGH);
      delay(50);
    }

    reset();
    writeRegister(TModeReg, 0x80);
    writeRegister(TPrescalerReg, 0xA9);
    writeRegister(TReloadRegH, 0x03);
    writeRegister(TReloadRegL, 0xE8);
    writeRegister(TxASKReg, 0x40);
    writeRegister(ModeReg, 0x3D);
    antennaOn();
  }

  void reset() {
    writeRegister(CommandReg, PCD_SoftReset);
    delay(50);
    while (readRegister(CommandReg) & (1 << 4)) {
      delay(1);
    }
  }

  void antennaOn() {
    uint8_t val = readRegister(TxControlReg);
    if ((val & 0x03) != 0x03) {
      writeRegister(TxControlReg, val | 0x03);
    }
  }

  uint8_t getFirmwareVersion() {
    return readRegister(VersionReg);
  }

  bool isNewCardPresent() {
    uint8_t bufferATQA[2];
    uint8_t bufferSize = sizeof(bufferATQA);
    writeRegister(BitFramingReg, 0x07);
    return (transceive(PICC_CMD_REQA, bufferATQA, bufferSize) == 0);
  }

  bool readCardSerial() {
    uint8_t responseBuffer[18];
    uint8_t responseLength = sizeof(responseBuffer);
    uint8_t cmdBuffer[2] = { PICC_CMD_SEL_CL1, 0x20 };

    if (transceiveData(cmdBuffer, 2, responseBuffer, responseLength) != 0) {
      return false;
    }

    if (responseLength >= 5) {
      uid.size = 4;
      for (uint8_t i = 0; i < 4; i++) {
        uid.uidByte[i] = responseBuffer[i];
      }
      uid.sak = responseBuffer[4];
      return true;
    }
    return false;
  }

  void haltA() {
    uint8_t buffer[4] = { PICC_CMD_HLTA, 0x00, 0x00, 0x00 };
    calculateCRC(buffer, 2, &buffer[2]);
    uint8_t responseBuffer[2];
    uint8_t responseLength = sizeof(responseBuffer);
    transceiveData(buffer, 4, responseBuffer, responseLength);
  }

private:
  uint8_t transceive(uint8_t cmd, uint8_t* backData, uint8_t &backLen) {
    return transceiveData(&cmd, 1, backData, backLen);
  }

  uint8_t transceiveData(uint8_t* sendData, uint8_t sendLen, uint8_t* backData, uint8_t &backLen) {
    writeRegister(CommandReg, PCD_Idle);
    writeRegister(ComIrqReg, 0x7F);
    writeRegister(FIFOLevelReg, 0x80);
    writeRegister(FIFODataReg, sendLen, sendData);
    writeRegister(CommandReg, PCD_Transceive);
    setBitMask(BitFramingReg, 0x80);

    uint32_t start = millis();
    bool completed = false;
    while (millis() - start < 35) {
      uint8_t irq = readRegister(ComIrqReg);
      if (irq & 0x30) {
        completed = true;
        break;
      }
    }
    clearBitMask(BitFramingReg, 0x80);
    if (!completed) return 1;

    uint8_t error = readRegister(ErrorReg);
    if (error & 0x1B) return 2;

    uint8_t fifoBytes = readRegister(FIFOLevelReg);
    if (fifoBytes > backLen) return 3;
    backLen = fifoBytes;
    readRegister(FIFODataReg, fifoBytes, backData);
    return 0;
  }

  bool calculateCRC(uint8_t* data, uint8_t length, uint8_t* result) {
    writeRegister(CommandReg, PCD_Idle);
    writeRegister(DivIrqReg, 0x04);
    writeRegister(FIFOLevelReg, 0x80);
    writeRegister(FIFODataReg, length, data);
    writeRegister(CommandReg, PCD_CalcCRC);

    uint32_t start = millis();
    while (millis() - start < 50) {
      if (readRegister(DivIrqReg) & 0x04) {
        writeRegister(CommandReg, PCD_Idle);
        result[0] = readRegister(0x21);
        result[1] = readRegister(0x22);
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
  if (strcmp(topic, topicCmdBuzzer) == 0 && length > 0) {
    char cmd = (char)payload[0];
    Serial.printf("[MQTT CMD] Perintah buzzer diterima: '%c'\n", cmd);
    if (cmd == 'b' || cmd == 'B') {
      buzzerBeepSingle();
    } else if (cmd == 'n' || cmd == 'N') {
      buzzerBeepTriple();
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
    Serial.printf("[MQTT] Berlangganan ke topik: %s\n", topicCmdBuzzer);
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
// PUBLIKASI DATA TELEMETRI & EVENT RFID VIA MQTT
// ============================================================
void publishTelemetryJson(float dist, float height, bool ok) {
  char jsonBuffer[256];
  if (ok) {
    snprintf(
      jsonBuffer, sizeof(jsonBuffer),
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"ok\",\"distanceCm\":%.1f,\"heightCm\":%.1f,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":5,\"buzzerAlarm\":false,\"calibrated\":false,\"uptimeMs\":%lu}",
      (unsigned long)(sequenceNumber++), dist, height, REFERENCE_HEIGHT_CM, (unsigned long)millis()
    );
  } else {
    snprintf(
      jsonBuffer, sizeof(jsonBuffer),
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"invalid\",\"error\":\"Di luar rentang pantulan\",\"distanceCm\":0.0,\"heightCm\":0.0,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":0,\"buzzerAlarm\":true,\"calibrated\":false,\"uptimeMs\":%lu}",
      (unsigned long)(sequenceNumber++), REFERENCE_HEIGHT_CM, (unsigned long)millis()
    );
  }

  // Cetak ke Serial lokal untuk debugging
  Serial.println(jsonBuffer);

  // Publish ke MQTT Broker jika terhubung
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
  Serial.printf("Version 0x%02X\n", v1);

  Serial.print(F("[INIT] Inisialisasi RFID 2 (HSPI: SCK=14, MISO=32, MOSI=13, SS=4, RST=21)... "));
  hspiBus.begin(PIN_RFID2_SCK, PIN_RFID2_MISO, PIN_RFID2_MOSI, PIN_RFID2_SS);
  rfid2.begin();
  uint8_t v2 = rfid2.getFirmwareVersion();
  Serial.printf("Version 0x%02X\n", v2);

  // 4. Inisialisasi Koneksi Wi-Fi
  Serial.printf("[WIFI] Menghubungkan ke SSID: %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // 5. Inisialisasi Klien MQTT
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

  // 1. PENGELOLAAN JARINGAN (WI-FI & MQTT NON-BLOCKING)
  handleNetworkReconnections(now);

  // 2. POLLING PEMBACAAN DUAL RFID
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
        // Respon buzzer pada Reader 2 dikendalikan via instruksi MQTT dari dashboard
        rfid2.haltA();
      }
    }
  }

  // 3. PEMBACAAN PERIODIK SENSOR ULTRASONIK (500 ms)
  if (now - lastUltrasonicMs >= ULTRASONIC_INTERVAL_MS) {
    lastUltrasonicMs = now;

    float currentDistance = 0.0f;
    if (readUltrasonicDistance(currentDistance)) {
      latestDistanceCm = currentDistance;
      latestEstimatedHeightCm = REFERENCE_HEIGHT_CM - currentDistance;
      if (latestEstimatedHeightCm < 0.0f) latestEstimatedHeightCm = 0.0f;

      publishTelemetryJson(latestDistanceCm, latestEstimatedHeightCm, true);
    } else {
      latestDistanceCm = NAN;
      latestEstimatedHeightCm = NAN;
      publishTelemetryJson(0.0f, 0.0f, false);
    }
  }

  delay(10);
}
