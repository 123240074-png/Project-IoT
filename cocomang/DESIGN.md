# COCOMANG SmartHeight Live

## Product scope at this progress

The dashboard is the operator's measurement station for the current physical-layer prototype. The active hardware is ESP32 DevKit V1, overhead HC-SR04 ultrasonic sensor, passive buzzer, and I2C LCD. Pengukuran live focuses exclusively on height measurement for visitor history from the overhead sensor. RFID/RC522, NFC, gate control, Firebase, and ride access decisions are intentionally out of scope for this stage.

## Interaction decisions

- Keep the COCOMANG name and warm paper / pine-green visual language from the prior staff-desk design.
- Reduce navigation to Ringkasan, Pengunjung, Pengukuran live, and Riwayat ukur.
- Visitor identity is entered manually. Optional gender and weight fields are additive, validated, and compatible with legacy records; height remains sensor-only. There is no UID field or simulated card scan.
- The measurement page has an explicit USB connection step using Web Serial at 115200 baud.
- Pengukuran live operates exclusively in height measurement mode; the overhead HC-SR04 measures distance to top of head and computes height.
- Live height readings update the current readout but are not automatically inserted into history. The operator chooses a visitor and saves a valid reading, avoiding hundreds of history rows during continuous sampling.
- The live panel makes distance, estimated height, reference height, calibration offset, valid sample count, buzzer threshold state, and calibration confirmation visible.
- The website does not control the buzzer. The ESP32 firmware computes the height and operates GPIO 27; the dashboard receives its status.
- History supports date/name/buzzer/calibration filters and time/height sorting. CSV export and the PDF report follow the active filters.
- PDF output uses a print-ready report and the browser's Save as PDF command, avoiding an external PDF dependency.
- The app starts with empty real-data collections. It does not display seeded demo visitors as if they were physical measurements.
- Data stays in localStorage on the current browser/device. This build does not claim cloud synchronization or Firebase integration.

## Live connection

- USB serial connection is initiated by a user click through Web Serial API.
- Browser support target: Chrome/Edge desktop on localhost or HTTPS.
- The ESP32 sends one JSON measurement object per line at 115200 baud.
- The parser ignores startup/debug lines and accepts only `type: measurement` from `device: smartheight-esp32` with validated numeric fields.
- The operator must close Arduino Serial Monitor before opening the same COM port from the browser.

## Hardware assumptions

- TRIG GPIO 25, ECHO GPIO 26 through a 1 kΩ / 2 kΩ divider, buzzer GPIO 27, I2C SDA 21, SCL 22.
- Height is computed on the ESP32 as `referenceHeightCm - (distanceCm + offsetCm)`.
- The buzzer alarm threshold is height below 100 cm.
- Reference height 220 cm and calibration offset 0 cm are firmware placeholders until physically measured and calibrated.
- I2C backpack mapping is the common PCF8574 arrangement; alternative backpack wiring may need a different low-level mapping.

## Integrity and limitations

- A saved height record comes from a valid serial frame and explicit operator action.
- No generated sample readings are inserted into the database.
- Automated tests cover data validation, JSON parsing, and serial protocol validation; they do not verify physical hardware, COM ports, or physical orientation.
- Web Serial cannot be assumed on Safari/Firefox or `file://` pages.
