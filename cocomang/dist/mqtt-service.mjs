// ==============================================================================
// COCOMANG SmartHeight - MQTT Service
// Layanan Klien MQTT over WebSockets untuk Browser (Dashboard & Kiosk)
// ==============================================================================

import {
  DEFAULT_MQTT_CONFIG,
  getMqttTopics,
  parseTelemetryMessage,
  parseRfidMessage,
  buildBuzzerPayload,
  buildMeasurePayload,
} from './mqtt-protocol.mjs';

export const MQTT_CONFIG_KEY = 'cocomang-mqtt-config-v1';
const MQTT_CDN_URL = 'https://esm.sh/mqtt@5.10.4?bundle';

let mqttClient = null;
let currentConfig = null;
let connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
let deviceStatus = 'unknown'; // 'unknown' | 'online' | 'offline'
let lastTelemetryTime = 0;

const listeners = {
  connection: new Set(),
  telemetry: new Set(),
  rfid1: new Set(),
  rfid2: new Set(),
  deviceStatus: new Set(),
};

/**
 * Membaca konfigurasi MQTT dari localStorage atau default
 */
export function getMqttConfig() {
  if (currentConfig) return currentConfig;
  try {
    const raw = localStorage.getItem(MQTT_CONFIG_KEY);
    if (raw) {
      currentConfig = { ...DEFAULT_MQTT_CONFIG, ...JSON.parse(raw) };
      return currentConfig;
    }
  } catch {}
  currentConfig = { ...DEFAULT_MQTT_CONFIG };
  return currentConfig;
}

/**
 * Menyimpan konfigurasi MQTT ke localStorage
 */
export function saveMqttConfig(cfg) {
  currentConfig = { ...getMqttConfig(), ...cfg };
  try {
    localStorage.setItem(MQTT_CONFIG_KEY, JSON.stringify(currentConfig));
  } catch {}
  return currentConfig;
}

export function getConnectionState() {
  return connectionState;
}

export function getDeviceStatus() {
  // Jika telemetry diterima dalam 3 detik terakhir, anggap device aktif
  if (Date.now() - lastTelemetryTime <= 3000) {
    return 'online';
  }
  return deviceStatus;
}

function notify(group, data) {
  if (listeners[group]) {
    listeners[group].forEach(fn => {
      try { fn(data); } catch (e) { console.warn(`Error in listener [${group}]:`, e); }
    });
  }
}

export function onMqttConnection(cb) {
  listeners.connection.add(cb);
  return () => listeners.connection.delete(cb);
}

export function onTelemetry(cb) {
  listeners.telemetry.add(cb);
  return () => listeners.telemetry.delete(cb);
}

export function onRfidReader1(cb) {
  listeners.rfid1.add(cb);
  return () => listeners.rfid1.delete(cb);
}

export function onRfidReader2(cb) {
  listeners.rfid2.add(cb);
  return () => listeners.rfid2.delete(cb);
}

export function onDeviceStatusChange(cb) {
  listeners.deviceStatus.add(cb);
  return () => listeners.deviceStatus.delete(cb);
}

/**
 * Menghubungkan browser ke Broker MQTT via Secure WebSockets (wss://)
 */
export async function connectMqtt(customConfig = null) {
  if (customConfig) {
    saveMqttConfig(customConfig);
  }
  const cfg = getMqttConfig();
  const topics = getMqttTopics(cfg.topicPrefix);

  if (mqttClient) {
    try { mqttClient.end(true); } catch {}
    mqttClient = null;
  }

  connectionState = 'connecting';
  notify('connection', { state: connectionState, config: cfg });

  try {
    // Dynamic import MQTT.js
    const mqttModule = await import(MQTT_CDN_URL);
    const mqtt = mqttModule.default || mqttModule;

    // Susun URL WebSocket (wss:// atau ws://)
    const protocol = cfg.protocol || (window.location.protocol === 'https:' ? 'wss' : 'wss');
    const path = cfg.path.startsWith('/') ? cfg.path : `/${cfg.path}`;
    const brokerUrl = `${protocol}://${cfg.host}:${cfg.port}${path}`;

    const clientId = `cocomang-web-${Math.random().toString(16).slice(2, 10)}`;

    const options = {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
    };

    if (cfg.username) {
      options.username = cfg.username;
      options.password = cfg.password || '';
    }

    console.info(`[MQTT] Menghubungkan ke ${brokerUrl} (Client ID: ${clientId})...`);
    mqttClient = mqtt.connect(brokerUrl, options);

    mqttClient.on('connect', () => {
      connectionState = 'connected';
      console.info(`[MQTT] Berhasil terhubung ke broker! Subscribe ke topik ${cfg.topicPrefix}/#`);
      notify('connection', { state: connectionState, config: cfg });

      // Subscribe ke topik-topik yang dibutuhkan
      mqttClient.subscribe([
        topics.telemetry,
        topics.rfidReader1,
        topics.rfidReader2,
        topics.deviceStatus,
      ], (err) => {
        if (err) {
          console.warn('[MQTT] Gagal subscribe ke topik:', err);
        }
      });
    });

    mqttClient.on('message', (topic, messageBuffer) => {
      const message = messageBuffer.toString();

      // 1. Pesan Telemetri Ultrasonik
      if (topic === topics.telemetry) {
        const frame = parseTelemetryMessage(message);
        if (frame) {
          lastTelemetryTime = Date.now();
          if (deviceStatus !== 'online') {
            deviceStatus = 'online';
            notify('deviceStatus', 'online');
          }
          notify('telemetry', frame);
        }
        return;
      }

      // 2. Pesan Tap Kartu RFID 1 (Pendaftaran Member)
      if (topic === topics.rfidReader1) {
        const rfid = parseRfidMessage(message, 1);
        if (rfid) {
          notify('rfid1', rfid);
        }
        return;
      }

      // 3. Pesan Tap Kartu RFID 2 (Akses Masuk Wahana)
      if (topic === topics.rfidReader2) {
        const rfid = parseRfidMessage(message, 2);
        if (rfid) {
          notify('rfid2', rfid);
        }
        return;
      }

      // 4. Status Perangkat ESP32 (LWT)
      if (topic === topics.deviceStatus) {
        const status = message.trim().toLowerCase();
        deviceStatus = status === 'online' ? 'online' : 'offline';
        notify('deviceStatus', deviceStatus);
      }
    });

    mqttClient.on('reconnect', () => {
      connectionState = 'connecting';
      notify('connection', { state: connectionState, config: cfg });
    });

    mqttClient.on('offline', () => {
      connectionState = 'disconnected';
      notify('connection', { state: connectionState, config: cfg });
    });

    mqttClient.on('error', (err) => {
      console.error('[MQTT] Connection Error:', err);
      connectionState = 'error';
      notify('connection', { state: connectionState, error: err, config: cfg });
    });

    mqttClient.on('close', () => {
      connectionState = 'disconnected';
      notify('connection', { state: connectionState, config: cfg });
    });

    return true;
  } catch (err) {
    console.error('[MQTT] Gagal memuat library atau inisialisasi koneksi:', err);
    connectionState = 'error';
    notify('connection', { state: connectionState, error: err, config: cfg });
    return false;
  }
}

/**
 * Memutuskan koneksi MQTT
 */
export function disconnectMqtt() {
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch {}
    mqttClient = null;
  }
  connectionState = 'disconnected';
  notify('connection', { state: connectionState, config: getMqttConfig() });
}

/**
 * Mengirimkan perintah suara buzzer ke ESP32 via MQTT ('b' atau 'n')
 */
export async function sendBuzzerCommand(cmd) {
  const payload = buildBuzzerPayload(cmd);
  if (!payload) return false;
  if (!mqttClient || connectionState !== 'connected') {
    console.warn('[MQTT] Tidak dapat mengirim perintah buzzer: broker belum terhubung.');
    return false;
  }

  const topics = getMqttTopics(getMqttConfig().topicPrefix);
  return new Promise((resolve) => {
    mqttClient.publish(topics.buzzerCmd, payload, { qos: 0 }, (err) => {
      if (err) {
        console.warn('[MQTT] Gagal mem-publish perintah buzzer:', err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Mengirimkan perintah ukur & kalibrasi tinggi badan ke ESP32 via MQTT
 */
export async function sendMeasureCommand(cmd = 'start') {
  const payload = buildMeasurePayload(cmd);
  if (!payload) return false;
  if (!mqttClient || connectionState !== 'connected') {
    console.warn('[MQTT] Tidak dapat mengirim perintah ukur: broker belum terhubung.');
    return false;
  }

  const topics = getMqttTopics(getMqttConfig().topicPrefix);
  return new Promise((resolve) => {
    mqttClient.publish(topics.measureCmd, payload, { qos: 0 }, (err) => {
      if (err) {
        console.warn('[MQTT] Gagal mem-publish perintah ukur:', err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
