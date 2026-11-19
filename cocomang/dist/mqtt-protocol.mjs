// ==============================================================================
// COCOMANG SmartHeight - MQTT Protocol
// Parser dan Validasi Payload Protokol Komunikasi MQTT (Telemetry, RFID, Command)
// ==============================================================================

import { validateDeviceFrame, normalizeRfid, formatRfid } from './data.mjs';

export const DEFAULT_MQTT_CONFIG = {
  host: 'broker.emqx.io',
  port: 8084,
  path: '/mqtt',
  protocol: 'wss',
  username: '',
  password: '',
  topicPrefix: 'cocomang',
};

/**
 * Menghasilkan daftar topik MQTT berdasarkan prefix
 */
export function getMqttTopics(prefix = DEFAULT_MQTT_CONFIG.topicPrefix) {
  const cleanPrefix = String(prefix || DEFAULT_MQTT_CONFIG.topicPrefix).trim().replace(/\/+$/, '');
  return {
    telemetry: `${cleanPrefix}/telemetry`,
    rfidReader1: `${cleanPrefix}/rfid/reader1`,
    rfidReader2: `${cleanPrefix}/rfid/reader2`,
    buzzerCmd: `${cleanPrefix}/cmd/buzzer`,
    measureCmd: `${cleanPrefix}/cmd/measure`,
    deviceStatus: `${cleanPrefix}/status`,
  };
}

/**
 * Memvalidasi dan mem-parse pesan telemetri ultrasonik dari ESP32
 */
export function parseTelemetryMessage(payload) {
  let frame = payload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text || !text.startsWith('{')) return null;
    try {
      frame = JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (!frame || typeof frame !== 'object') return null;
  if (frame.type !== 'measurement' || frame.device !== 'smartheight-esp32') return null;

  const issue = validateDeviceFrame(frame);
  if (issue) {
    return {
      type: 'measurement',
      device: frame.device,
      status: 'invalid',
      error: issue,
      sequence: Number.isInteger(frame.sequence) ? frame.sequence : null,
      receivedAt: new Date().toISOString(),
    };
  }

  return {
    ...frame,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Mem-parse pesan deteksi kartu RFID dari ESP32 (Reader 1 atau Reader 2)
 */
export function parseRfidMessage(payload, defaultReader = 1) {
  let data = payload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (text.startsWith('{')) {
      try {
        data = JSON.parse(text);
      } catch {
        return null;
      }
    } else {
      // Fallback jika payload dikirim sebagai raw string UID
      const rawNormalized = normalizeRfid(text);
      if (rawNormalized.length >= 8) {
        return {
          reader: defaultReader,
          uid: formatRfid(rawNormalized),
          bytes: rawNormalized.length / 2,
          label: defaultReader === 1 ? 'PENDAFTARAN' : 'AKSES WAHANA',
          receivedAt: new Date().toISOString(),
        };
      }
      return null;
    }
  }

  if (!data || typeof data !== 'object') return null;

  const reader = Number(data.reader || defaultReader);
  const rawUid = normalizeRfid(String(data.uid || ''));
  if (!rawUid || (rawUid.length !== 8 && rawUid.length !== 14 && rawUid.length !== 20)) {
    return null;
  }

  const formattedUid = formatRfid(rawUid);
  const label = data.label || (reader === 1 ? 'PENDAFTARAN' : 'AKSES WAHANA');

  return {
    reader,
    uid: formattedUid,
    bytes: data.bytes || rawUid.length / 2,
    label,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Validasi dan format perintah suara buzzer
 * 'b' / 'B' = 1 bip (sukses/lolos)
 * 'n' / 'N' = 3 bip (peringatan/ditolak)
 */
export function buildBuzzerPayload(cmd) {
  const char = String(cmd || '').trim().toLowerCase();
  if (char === 'b' || char === 'n') {
    return char;
  }
  return null;
}

/**
 * Validasi dan format perintah pengukuran + kalibrasi tinggi badan ke ESP32
 * Menerima 'start', 'measure', atau 'y' -> dinormalisasi ke 'start'
 */
export function buildMeasurePayload(cmd = 'start') {
  const token = String(cmd || '').trim().toLowerCase();
  if (token === 'start' || token === 'measure' || token === 'y') {
    return 'start';
  }
  return null;
}
