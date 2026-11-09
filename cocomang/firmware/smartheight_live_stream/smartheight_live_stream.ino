/*
  COCOMANG SMARTHEIGHT - LIVE USB SERIAL
  ESP32 DevKit V1 + HC-SR04 + passive buzzer + I2C LCD 16x2

  LIVE PROTOCOL:
  One JSON object per line at 115200 baud. The COCOMANG website reads
  this stream through Web Serial API and stores a reading only when the
  operator presses "Simpan hasil live".

  PIN MAP:
    HC-SR04 VCC  -> VIN / 5V
    HC-SR04 TRIG -> GPIO 25
    HC-SR04 ECHO -> GPIO 26 THROUGH 1k/2k voltage divider
    HC-SR04 GND  -> GND

    Passive buzzer + / SIGNAL -> GPIO 27
    Passive buzzer - / GND    -> GND

    I2C LCD SDA -> GPIO 21
    I2C LCD SCL -> GPIO 22
    I2C LCD VCC -> 5V only if the module supports it
    I2C LCD GND -> GND

  SAFETY:
    If the I2C backpack is powered at 5V and its SDA/SCL pull-ups also go
    to 5V, place a bidirectional I2C level shifter between the backpack
    and ESP32. Never apply 5V logic directly to ESP32 GPIO.

  No RFID, RC522, Wi-Fi, Firebase, or extra LCD library is used.
*/

#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// ---------------- PIN CONFIGURATION ----------------
static const uint8_t PIN_TRIG = 25;
static const uint8_t PIN_ECHO = 26;
static const uint8_t PIN_BUZZER = 27;
static const uint8_t PIN_SDA = 21;
static const uint8_t PIN_SCL = 22;

// ---------------- MEASUREMENT CONFIGURATION ----------------
// Replace with the measured distance from the floor to the front face
// of the sensor transducers after the device is physically installed.
static const float REFERENCE_HEIGHT_CM = 220.0f; // PLACEHOLDER
static const float CALIBRATION_OFFSET_CM = 0.0f; // set after calibration
static const bool CALIBRATION_CONFIRMED = false;  // set true after validation
static const float HEIGHT_ALARM_LIMIT_CM = 100.0f;

// FAST LIVE MODE: three valid samples, median-filtered, approx. 300 ms/cycle.
// For final calibration runs, use SAMPLE_COUNT=5 and MEASUREMENT_INTERVAL_MS=650.
static const uint8_t SAMPLE_COUNT = 3;
static const uint8_t MIN_VALID_SAMPLES = 3;
static const uint32_t SENSOR_TIMEOUT_US = 30000UL;
// Keep at least 60 ms between HC-SR04 trigger cycles.
static const uint32_t SAMPLE_INTERVAL_MS = 65;
static const uint32_t MEASUREMENT_INTERVAL_MS = 300;
static const float MIN_DISTANCE_CM = 2.0f;
static const float MAX_DISTANCE_CM = 400.0f;
static const float MIN_HEIGHT_CM = 0.0f;
static const float MAX_HEIGHT_CM = 250.0f;

// ---------------- BUZZER CONFIGURATION ----------------
static const uint16_t BUZZER_FREQUENCY_HZ = 2000;
static const uint32_t BEEP_DURATION_MS = 200;
static const uint32_t BEEP_REPEAT_INTERVAL_MS = 1500;

// ---------------- LCD CONFIGURATION ----------------
static const uint8_t LCD_COLUMNS = 16;
static const uint8_t LCD_ROWS = 2;
static const uint8_t LCD_RS = 0x01;
static const uint8_t LCD_EN = 0x04;
static const uint8_t LCD_BACKLIGHT = 0x08;
static const uint8_t LCD_ROW_OFFSETS[2] = {0x00, 0x40};
static uint8_t lcdAddress = 0;
static bool lcdAvailable = false;

// ---------------- RUNTIME STATE ----------------
static uint32_t sequenceNumber = 0;
static uint32_t lastMeasurementMs = 0;
static uint32_t buzzerStartedMs = 0;
static uint32_t lastBeepStartedMs = 0;
static bool buzzerToneOn = false;
static bool alarmActive = false;
static bool measurementValid = false;
static float distanceRawCm = NAN;
static float distanceCorrectedCm = NAN;
static float estimatedHeightCm = NAN;
static uint8_t validSamples = 0;

// ============================================================
// LCD LOW-LEVEL PCF8574 DRIVER (common backpack pin mapping)
// ============================================================
void lcdExpanderWrite(uint8_t value) {
  if (!lcdAvailable) return;
  Wire.beginTransmission(lcdAddress);
  Wire.write(value | LCD_BACKLIGHT);
  Wire.endTransmission();
}

void lcdPulseEnable(uint8_t value) {
  lcdExpanderWrite(value | LCD_EN);
  delayMicroseconds(1);
  lcdExpanderWrite(value & (uint8_t)~LCD_EN);
  delayMicroseconds(50);
}

void lcdWrite4Bits(uint8_t value) {
  lcdExpanderWrite(value);
  lcdPulseEnable(value);
}

void lcdSend(uint8_t value, uint8_t mode) {
  const uint8_t highNibble = (value & 0xF0) | mode;
  const uint8_t lowNibble = ((value << 4) & 0xF0) | mode;
  lcdWrite4Bits(highNibble);
  lcdWrite4Bits(lowNibble);
}

void lcdCommand(uint8_t command) {
  lcdSend(command, 0);
  if (command == 0x01 || command == 0x02) delay(2);
  else delayMicroseconds(50);
}

void lcdWriteChar(char value) {
  lcdSend((uint8_t)value, LCD_RS);
  delayMicroseconds(50);
}

void lcdSetCursor(uint8_t column, uint8_t row) {
  if (row >= LCD_ROWS) return;
  lcdCommand(0x80 | (LCD_ROW_OFFSETS[row] + column));
}

void lcdPrintLine(uint8_t row, const char *text) {
  if (!lcdAvailable || row >= LCD_ROWS) return;
  lcdSetCursor(0, row);
  uint8_t count = 0;
  while (*text && count < LCD_COLUMNS) {
    lcdWriteChar(*text++);
    count++;
  }
  while (count < LCD_COLUMNS) {
    lcdWriteChar(' ');
    count++;
  }
}

bool detectLCD() {
  // Standard PCF8574 addresses and PCF8574A addresses.
  const uint8_t ranges[][2] = {{0x20, 0x27}, {0x38, 0x3F}};
  for (uint8_t range = 0; range < 2; range++) {
    for (uint8_t address = ranges[range][0]; address <= ranges[range][1]; address++) {
      Wire.beginTransmission(address);
      if (Wire.endTransmission() == 0) {
        lcdAddress = address;
        return true;
      }
    }
  }
  return false;
}

void lcdInit() {
  delay(50);
  lcdAvailable = true;
  lcdExpanderWrite(0x00);
  delay(1000);
  lcdWrite4Bits(0x30);
  delayMicroseconds(4500);
  lcdWrite4Bits(0x30);
  delayMicroseconds(4500);
  lcdWrite4Bits(0x30);
  delayMicroseconds(150);
  lcdWrite4Bits(0x20);
  lcdCommand(0x28); // 4-bit, 2-line, 5x8
  lcdCommand(0x08); // display off
  lcdCommand(0x01); // clear
  lcdCommand(0x06); // entry mode
  lcdCommand(0x0C); // display on, cursor off
  lcdPrintLine(0, "COCOMANG LIVE");
  lcdPrintLine(1, "ESP32 CONNECTED");
  delay(1000);
  lcdCommand(0x01);
}

// ============================================================
// HC-SR04 SENSOR
// ============================================================
bool readOneDistance(float &distanceCm) {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  const uint32_t durationUs = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (durationUs == 0) return false;

  distanceCm = durationUs / 58.0f;
  return distanceCm >= MIN_DISTANCE_CM && distanceCm <= MAX_DISTANCE_CM;
}

float medianOf(float *values, uint8_t count) {
  for (uint8_t i = 0; i < count; i++) {
    for (uint8_t j = 0; j + 1 < count - i; j++) {
      if (values[j] > values[j + 1]) {
        const float temp = values[j];
        values[j] = values[j + 1];
        values[j + 1] = temp;
      }
    }
  }
  if (count % 2 == 1) return values[count / 2];
  return (values[count / 2 - 1] + values[count / 2]) / 2.0f;
}

// ============================================================
// BUZZER: only when estimated height is below 100 cm
// ============================================================
void stopBuzzer() {
  if (buzzerToneOn) {
    noTone(PIN_BUZZER);
    buzzerToneOn = false;
  }
}

void updateBuzzer() {
  const uint32_t now = millis();
  if (buzzerToneOn && now - buzzerStartedMs >= BEEP_DURATION_MS) {
    stopBuzzer();
  }

  if (!measurementValid || !alarmActive) {
    stopBuzzer();
    lastBeepStartedMs = 0;
    return;
  }

  if (!buzzerToneOn && (lastBeepStartedMs == 0 || now - lastBeepStartedMs >= BEEP_REPEAT_INTERVAL_MS)) {
    tone(PIN_BUZZER, BUZZER_FREQUENCY_HZ);
    buzzerToneOn = true;
    buzzerStartedMs = now;
    lastBeepStartedMs = now;
  }
}

// ============================================================
// LCD OUTPUT
// ============================================================
void updateLCD() {
  if (!lcdAvailable) return;

  if (!measurementValid) {
    lcdPrintLine(0, "HC-SR04 NO ECHO");
    lcdPrintLine(1, "Check sensor");
    return;
  }

  char line1[17];
  char line2[17];
  snprintf(line1, sizeof(line1), "D:%5.1f H:%5.1f", distanceCorrectedCm, estimatedHeightCm);
  if (alarmActive) snprintf(line2, sizeof(line2), "HEIGHT LOW <100");
  else snprintf(line2, sizeof(line2), "HEIGHT NORMAL");
  lcdPrintLine(0, line1);
  lcdPrintLine(1, line2);
}

// ============================================================
// SERIAL JSON OUTPUT - one JSON object per line
// ============================================================
void emitMeasurementJson() {
  sequenceNumber++;
  if (measurementValid) {
    Serial.printf(
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"ok\",\"distanceCm\":%.2f,\"heightCm\":%.2f,\"referenceHeightCm\":%.2f,\"offsetCm\":%.2f,\"validSamples\":%u,\"buzzerAlarm\":%s,\"calibrated\":%s,\"uptimeMs\":%lu}\n",
      (unsigned long)sequenceNumber,
      distanceCorrectedCm,
      estimatedHeightCm,
      REFERENCE_HEIGHT_CM,
      CALIBRATION_OFFSET_CM,
      validSamples,
      alarmActive ? "true" : "false",
      CALIBRATION_CONFIRMED ? "true" : "false",
      (unsigned long)millis()
    );
  } else {
    Serial.printf(
      "{\"type\":\"measurement\",\"device\":\"smartheight-esp32\",\"sequence\":%lu,\"status\":\"invalid\",\"error\":\"NO_ECHO_OR_INVALID_RANGE\",\"validSamples\":%u,\"buzzerAlarm\":false,\"calibrated\":%s,\"uptimeMs\":%lu}\n",
      (unsigned long)sequenceNumber,
      validSamples,
      CALIBRATION_CONFIRMED ? "true" : "false",
      (unsigned long)millis()
    );
  }
}

// ============================================================
// MEASUREMENT CYCLE
// ============================================================
void takeMeasurement() {
  float samples[SAMPLE_COUNT];
  uint8_t count = 0;

  for (uint8_t i = 0; i < SAMPLE_COUNT; i++) {
    float distance = NAN;
    if (readOneDistance(distance)) samples[count++] = distance;
    if (i + 1 < SAMPLE_COUNT) delay(SAMPLE_INTERVAL_MS);
  }

  validSamples = count;
  measurementValid = false;
  alarmActive = false;

  if (count >= MIN_VALID_SAMPLES) {
    distanceRawCm = medianOf(samples, count);
    distanceCorrectedCm = distanceRawCm + CALIBRATION_OFFSET_CM;
    estimatedHeightCm = REFERENCE_HEIGHT_CM - distanceCorrectedCm;

    if (estimatedHeightCm >= MIN_HEIGHT_CM && estimatedHeightCm <= MAX_HEIGHT_CM) {
      measurementValid = true;
      alarmActive = estimatedHeightCm < HEIGHT_ALARM_LIMIT_CM;
    }
  }

  if (!measurementValid) {
    distanceRawCm = NAN;
    distanceCorrectedCm = NAN;
    estimatedHeightCm = NAN;
    alarmActive = false;
    stopBuzzer();
  }

  updateLCD();
  emitMeasurementJson();
}

// ============================================================
// SETUP / LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_TRIG, LOW);
  noTone(PIN_BUZZER);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  if (detectLCD()) lcdInit();

  // The website ignores this status line and waits for measurement lines.
  Serial.println("{\"type\":\"status\",\"device\":\"smartheight-esp32\",\"status\":\"ready\",\"baudRate\":115200}");
}

void loop() {
  const uint32_t now = millis();
  if (now - lastMeasurementMs >= MEASUREMENT_INTERVAL_MS) {
    lastMeasurementMs = now;
    takeMeasurement();
  }
  updateBuzzer();
  delay(5);
}
