/*
  SMART HEIGHT MEASUREMENT SYSTEM - WOKWI SIMULATOR EDITION
  ESP32 DevKit V1 + Dual RFID RC522 (VSPI & HSPI) + HC-SR04 + Buzzer Pasif
  Komunikasi: WiFi (Wokwi-GUEST) + MQTT (broker.hivemq.com) -> Terhubung ke Web Dashboard tanpa Serial USB!
  
  Topik MQTT:
  - Publish Telemetry: cocomang/smartheight/telemetry
  - Publish RFID:      cocomang/smartheight/rfid
  - Subscribe Command: cocomang/smartheight/command ('b': beep single, 'n': beep triple, 'u': baca ultrasonik, 'r': status)
*/

#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <PubSubClient.h>

// ============================================================
// KONFIGURASI WIFI & MQTT WOKWI
// ============================================================
const char* WIFI_SSID     = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* MQTT_BROKER   = "broker.hivemq.com";
const uint16_t MQTT_PORT  = 1883;

const char* TOPIC_TELEMETRY = "cocomang/smartheight/telemetry";
const char* TOPIC_RFID      = "cocomang/smartheight/rfid";
const char* TOPIC_COMMAND   = "cocomang/smartheight/command";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ============================================================
// KONFIGURASI PIN HARDWARE (SESUAI WOKWI DIAGRAM)
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
// PARAMETER SISTEM & TIMER
// ============================================================
static const uint32_t SENSOR_TIMEOUT_US = 30000UL;
static const float MIN_DISTANCE_CM = 2.0f;
static const float MAX_DISTANCE_CM = 400.0f;
static const uint32_t ULTRASONIC_INTERVAL_MS = 500;
static const uint32_t RFID_POLL_INTERVAL_MS   = 100;
static const float REFERENCE_HEIGHT_CM = 220.0f;

static float latestDistanceCm = NAN;
static float latestEstimatedHeightCm = NAN;
static uint32_t lastUltrasonicMs = 0;
static uint32_t lastRfidMs       = 0;
static uint32_t lastRfid1ReadMs  = 0;
static uint32_t lastRfid2ReadMs  = 0;
static const uint32_t RFID_COOLDOWN_MS = 1500;
static uint32_t sequenceNumber = 1;

// ============================================================
// DRIVER MFRC522 DUAL-SPI REGISTER
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

  uint8_t readRegister(uint8_t reg) {
    _spi->beginTransaction(_spiSettings);
    digitalWrite(_ssPin, LOW);
    _spi->transfer(((reg << 1) & 0x7E) | 0x80);
    uint8_t val = _spi->transfer(0x00);
    digitalWrite(_ssPin, HIGH);
    _spi->endTransaction();
    return val;
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

    digitalWrite(_rstPin, LOW);
    delayMicroseconds(20);
    digitalWrite(_rstPin, HIGH);
    delay(50);

    writeRegister(CommandReg, PCD_SoftReset);
    delay(50);

    writeRegister(TModeReg, 0x8D);
    writeRegister(TPrescalerReg, 0x3E);
    writeRegister(TReloadRegL, 30);
    writeRegister(TReloadRegH, 0);

    writeRegister(TxASKReg, 0x40);
    writeRegister(ModeReg, 0x3D);
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
    writeRegister(ComIrqReg, 0x7F);
    setBitMask(FIFOLevelReg, 0x80);

    for (uint8_t i = 0; i < sendLen; i++) {
      writeRegister(FIFODataReg, sendData[i]);
    }

    writeRegister(BitFramingReg, bitFraming);
    writeRegister(CommandReg, command);
    if (command == PCD_Transceive) {
      setBitMask(BitFramingReg, 0x80);
    }

    uint32_t i = 2000;
    uint8_t n = 0;
    do {
      n = readRegister(ComIrqReg);
      if (n & waitIRq) break;
      if (n & 0x01) return false;
      delayMicroseconds(10);
    } while (--i);

    if (i == 0) return false;

    uint8_t errorRegValue = readRegister(ErrorReg);
    if (errorRegValue & 0x13) return false;

    if (backData && backLen) {
      uint8_t bytesInFIFO = readRegister(FIFOLevelReg);
      if (bytesInFIFO > *backLen) return false;
      *backLen = bytesInFIFO;

      for (uint8_t j = 0; j < bytesInFIFO; j++) {
        backData[j] = readRegister(FIFODataReg);
      }
    }
    return true;
  }

  bool isNewCardPresent() {
    writeRegister(BitFramingReg, 0x07);
    uint8_t cmd = PICC_CMD_REQA;
    uint8_t buffer[2];
    uint8_t bufferSize = sizeof(buffer);
    return communicateWithPICC(PCD_Transceive, 0x30, &cmd, 1, buffer, &bufferSize);
  }

  bool readCardSerial() {
    uint8_t sendBuffer[9];
    uint8_t backBuffer[18];
    uint8_t backLen = sizeof(backBuffer);

    sendBuffer[0] = PICC_CMD_SEL_CL1;
    sendBuffer[1] = 0x20;

    writeRegister(BitFramingReg, 0x00);
    bool status = communicateWithPICC(PCD_Transceive, 0x30, sendBuffer, 2, backBuffer, &backLen);
    if (!status || backLen < 5) return false;

    uid.size = 4;
    for (uint8_t i = 0; i < 4; i++) {
      uid.uidByte[i] = backBuffer[i];
    }
    return true;
  }

  void haltA() {
    uint8_t cmdBuffer[4];
    cmdBuffer[0] = PICC_CMD_HLTA;
    cmdBuffer[1] = 0;
    communicateWithPICC(PCD_Transceive, 0x30, cmdBuffer, 2);
  }
};

SPIClass vspiBus(VSPI);
SPIClass hspiBus(HSPI);
MFRC522_DualSPI rfid1(&vspiBus, PIN_RFID1_SS, PIN_RFID1_RST);
MFRC522_DualSPI rfid2(&hspiBus, PIN_RFID2_SS, PIN_RFID2_RST);

// ============================================================
// BUZZER PASIF
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
// HC-SR04 ULTRASONIK
// ============================================================
bool readUltrasonicDistance(float &distanceCm) {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  const unsigned long durationUs = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (durationUs == 0) return false;

  distanceCm = durationUs / 58.0f;
  return (distanceCm >= MIN_DISTANCE_CM && distanceCm <= MAX_DISTANCE_CM);
}

void formatUidString(const MFRC522_DualSPI::Uid &uid, char* outStr) {
  outStr[0] = '\0';
  for (uint8_t i = 0; i < uid.size; i++) {
    char byteBuf[4];
    sprintf(byteBuf, "%02X%s", uid.uidByte[i], (i + 1 < uid.size) ? ":" : "");
    strcat(outStr, byteBuf);
  }
}

// ============================================================
// EMISI TELEMETRY & EVENT RFID
// ============================================================
void publishMeasurementTelemetry(float distanceCm, float heightCm, bool isValid) {
  char jsonBuffer[256];
  if (isValid) {
    snprintf(jsonBuffer, sizeof(jsonBuffer),
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"ok\",\"distanceCm\":%.1f,\"heightCm\":%.1f,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":5,\"buzzerAlarm\":false,\"calibrated\":false}",
      sequenceNumber++, distanceCm, heightCm, REFERENCE_HEIGHT_CM);
  } else {
    snprintf(jsonBuffer, sizeof(jsonBuffer),
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"invalid\",\"error\":\"Di luar rentang pantulan\",\"distanceCm\":0.0,\"heightCm\":0.0,\"referenceHeightCm\":%.1f,\"offsetCm\":0.0,\"validSamples\":0,\"buzzerAlarm\":true,\"calibrated\":false}",
      sequenceNumber++, REFERENCE_HEIGHT_CM);
  }

  Serial.println(jsonBuffer);
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_TELEMETRY, jsonBuffer);
  }
}

void publishRfidEvent(uint8_t readerNum, const char* label, const char* uidStr) {
  char rfidBuffer[128];
  snprintf(rfidBuffer, sizeof(rfidBuffer),
    "[RFID %d - %s] Kartu Terdeteksi! UID: %s (Panjang: 4 byte)",
    readerNum, label, uidStr);

  Serial.println(rfidBuffer);
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_RFID, rfidBuffer);
  }
}

// ============================================================
// MQTT CALLBACK & RECONNECT
// ============================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  char msg[32];
  unsigned int copyLen = (length < sizeof(msg) - 1) ? length : (sizeof(msg) - 1);
  memcpy(msg, payload, copyLen);
  msg[copyLen] = '\0';

  Serial.printf("[MQTT RX] Topik: %s | Pesan: %s\n", topic, msg);

  char cmd = msg[0];
  if (cmd == 'b' || cmd == 'B') {
    Serial.println(F("[COMMAND] 1x Bip Sukses"));
    buzzerBeepSingle();
  } else if (cmd == 'n' || cmd == 'N') {
    Serial.println(F("[COMMAND] 3x Bip Peringatan"));
    buzzerBeepTriple();
  } else if (cmd == 'u' || cmd == 'U') {
    float dist = 0.0f;
    bool ok = readUltrasonicDistance(dist);
    float h = ok ? (REFERENCE_HEIGHT_CM - dist) : 0.0f;
    publishMeasurementTelemetry(dist, h, ok);
  } else if (cmd == 'r' || cmd == 'R') {
    Serial.printf("[STATUS] RFID1: 0x%02X | RFID2: 0x%02X\n",
      rfid1.getFirmwareVersion(), rfid2.getFirmwareVersion());
  }
}

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mqttClient.connected()) {
    String clientId = "ESP32-SmartHeight-Wokwi-" + String(random(0xffff), HEX);
    Serial.print(F("[MQTT] Menghubungkan ke broker HiveMQ... "));
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(F("TERHUBUNG!"));
      mqttClient.subscribe(TOPIC_COMMAND);
      Serial.printf("[MQTT] Subscribed ke topik: %s\n", TOPIC_COMMAND);
      buzzerBeepSingle();
    } else {
      Serial.printf("GAGAL (rc=%d), akan dicoba lagi di loop\n", mqttClient.state());
    }
  }
}

void setupWifi() {
  Serial.printf("\n[WIFI] Menghubungkan ke SSID: %s... ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(250);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F(" TERKONEKSI!"));
    Serial.print(F("[WIFI] IP Address: "));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F(" TIMEOUT (Lanjut ke loop untuk auto-reconnect)"));
  }
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println(F("\n================================================================"));
  Serial.println(F("     COCOMANG SMART HEIGHT - WOKWI SIMULATOR EDITION (MQTT)    "));
  Serial.println(F("================================================================"));

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);

  vspiBus.begin(PIN_RFID1_SCK, PIN_RFID1_MISO, PIN_RFID1_MOSI, PIN_RFID1_SS);
  rfid1.begin();

  hspiBus.begin(PIN_RFID2_SCK, PIN_RFID2_MISO, PIN_RFID2_MOSI, PIN_RFID2_SS);
  rfid2.begin();

  setupWifi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  connectMqtt();

  Serial.println(F("Sistem Simulasi Wokwi Siap!"));
  Serial.printf("Data dipublikasikan ke: %s dan %s\n", TOPIC_TELEMETRY, TOPIC_RFID);
  Serial.println(F("================================================================\n"));
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  } else if (!mqttClient.connected()) {
    static uint32_t lastReconnectAttempt = 0;
    if (millis() - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = millis();
      connectMqtt();
    }
  } else {
    mqttClient.loop();
  }

  const uint32_t now = millis();

  // --- HANDLE SERIAL INPUT SIMULATOR ---
  if (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    if (cmd == 'b' || cmd == 'B') buzzerBeepSingle();
    else if (cmd == 'n' || cmd == 'N') buzzerBeepTriple();
    else if (cmd == 'u' || cmd == 'U') {
      float testDist = 0.0f;
      bool ok = readUltrasonicDistance(testDist);
      float h = ok ? (REFERENCE_HEIGHT_CM - testDist) : 0.0f;
      publishMeasurementTelemetry(testDist, h, ok);
    }
  }

  // --- POLLING DUAL RFID ---
  if (now - lastRfidMs >= RFID_POLL_INTERVAL_MS) {
    lastRfidMs = now;

    // Polling RFID 1 (Pendaftaran)
    if (rfid1.isNewCardPresent() && rfid1.readCardSerial()) {
      if (now - lastRfid1ReadMs > RFID_COOLDOWN_MS) {
        lastRfid1ReadMs = now;
        char uidBuf[32];
        formatUidString(rfid1.uid, uidBuf);
        publishRfidEvent(1, "PENDAFTARAN", uidBuf);
        buzzerBeepSingle();
        rfid1.haltA();
      }
    }

    // Polling RFID 2 (Akses Wahana)
    if (rfid2.isNewCardPresent() && rfid2.readCardSerial()) {
      if (now - lastRfid2ReadMs > RFID_COOLDOWN_MS) {
        lastRfid2ReadMs = now;
        char uidBuf[32];
        formatUidString(rfid2.uid, uidBuf);
        publishRfidEvent(2, "AKSES WAHANA", uidBuf);
        rfid2.haltA();
      }
    }
  }

  // --- PEMBACAAN PERIODIK HC-SR04 ---
  if (now - lastUltrasonicMs >= ULTRASONIC_INTERVAL_MS) {
    lastUltrasonicMs = now;

    float currentDistance = 0.0f;
    if (readUltrasonicDistance(currentDistance)) {
      latestDistanceCm = currentDistance;
      latestEstimatedHeightCm = REFERENCE_HEIGHT_CM - currentDistance;
      if (latestEstimatedHeightCm < 0.0f) latestEstimatedHeightCm = 0.0f;
      publishMeasurementTelemetry(latestDistanceCm, latestEstimatedHeightCm, true);
    } else {
      latestDistanceCm = NAN;
      latestEstimatedHeightCm = NAN;
      publishMeasurementTelemetry(0.0f, 0.0f, false);
    }
  }

  delay(10);
}
