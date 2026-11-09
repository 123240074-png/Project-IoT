# COCOMANG SmartHeight Live

## Product scope at this progress

The dashboard is the operator's measurement station for the current physical-layer prototype. The active hardware is ESP32 DevKit V1, HC-SR04, passive buzzer, and I2C LCD. Pengukuran live has two modes: height measurement for visitor history and object detection for a separate calibration dataset. RFID/RC522, NFC, gate control, Firebase, and ride access decisions are intentionally out of scope for this stage.

## Interaction decisions

- Keep the COCOMANG name and warm paper / pine-green visual language from the prior staff-desk design.
- Reduce navigation to Ringkasan, Pengunjung, Pengukuran live, and Riwayat ukur.
- Visitor identity is entered manually. Optional gender and weight fields are additive, validated, and compatible with legacy records; height remains sensor-only. There is no UID field or simulated card scan.
- The measurement page has an explicit USB connection step using Web Serial at 115200 baud.
- A segmented control switches between **Pengukuran tinggi** and **Deteksi objek**; height remains the initial mode so the existing visitor workflow is unchanged.
- Live height readings update the current readout but are not automatically inserted into history. The operator chooses a visitor and saves a valid reading, avoiding hundreds of history rows during continuous sampling.
- Object mode evaluates five valid frames against a configurable target range, defaulting to 20–60 cm with a 2 cm stability tolerance.
- The operator measures the actual object distance manually. Object records capture the target, measured distance, actual distance, signed error, stability range, sample count, duration, and sequence.
- Object snapshots are explicit and go to a calibration dataset, never the visitor measurement history. The two stores have separate storage keys and CSV exports.
- The 3D isometric SVG visualization uses a universal geometric cube/block target and HC-SR04 dual transducers across six manual test directions (UP, DOWN, LEFT, RIGHT, FRONT, BACK). It communicates 1D distance along the chosen beam axis only and must never imply camera recognition, hand tracking, multi-sensor simultaneous arrays, or 3D lateral coordinate positioning.
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
- Object mode consumes the same validated frames; the serial contract and firmware remain unchanged.
- The operator must close Arduino Serial Monitor before opening the same COM port from the browser.

## Object detection mode

- `object-detection.mjs` owns the pure state machine. Status values are `COLLECTING`, `STABLE`, `UNSTABLE`, `NO_OBJECT`, `INVALID`, and `DEVICE_OFFLINE`.
- Stability requires five in-range samples. The displayed range is `max(buffer) − min(buffer)`; readings within 2 cm are stable.
- Duplicate sequence numbers are ignored. Invalid frames, out-of-range objects, disconnects, stale data, mode changes, and route changes clear the buffer.
- A sequence is recorded once. **Ulangi pengujian** keeps the entered target/actual values but starts a new buffer and time window.
- Snapshot storage uses `cocomang-object-tests-v1`, schema version 1, with a maximum of 500 newest results.
- The dataset is intentionally separate from `cocomang-live-v1`; saving or exporting object tests must not create visitor or height-history records.
- On narrow layouts, the manual actual-distance field follows the visualization before the stability status so the operator sees visual → actual distance → detection/stability → actions.

## Hardware assumptions

- TRIG GPIO 25, ECHO GPIO 26 through a 1 kΩ / 2 kΩ divider, buzzer GPIO 27, I2C SDA 21, SCL 22.
- Height is computed on the ESP32 as `referenceHeightCm - (distanceCm + offsetCm)`.
- The buzzer alarm threshold is height below 100 cm.
- Reference height 220 cm and calibration offset 0 cm are firmware placeholders until physically measured and calibrated.
- I2C backpack mapping is the common PCF8574 arrangement; alternative backpack wiring may need a different low-level mapping.

## Integrity and limitations

- A saved height record comes from a valid serial frame and explicit operator action.
- A saved object record also requires an explicit snapshot action; individual frames are never persisted automatically.
- No generated sample readings are inserted into the database.
- Automated tests cover data validation, JSON parsing, 6-direction isometric scene math and SVG rendering, object state transitions, dataset storage, and CSV serialization; they do not verify physical hardware, COM ports, or physical orientation.
- Object stability does not prove physical sensor alignment or automated 3D tracking. The UI must explicitly remind operators that physical sensor orientation must be adjusted manually for each of the six directions.
- Web Serial cannot be assumed on Safari/Firefox or `file://` pages.
