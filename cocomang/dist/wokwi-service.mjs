/**
 * Wokwi MQTT over WebSocket Transport Service
 * Menghubungkan frontend COCOMANG dengan simulator Wokwi melalui broker MQTT publik.
 */

const MQTT_CDN_URL = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';

export const DEFAULT_WOKWI_CONFIG = {
  brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
  topicTelemetry: 'cocomang/smartheight/telemetry',
  topicRfid: 'cocomang/smartheight/rfid',
  topicCommand: 'cocomang/smartheight/command',
  clientIdPrefix: 'cocomang-web-',
};

let mqttClient = null;
let currentConfig = { ...DEFAULT_WOKWI_CONFIG };
let isConnecting = false;

/**
 * Memastikan script MQTT.js tersedia di window, mendownload dari CDN jika belum ada.
 */
export async function ensureMqttLoaded() {
  if (typeof window !== 'undefined' && window.mqtt) {
    return window.mqtt;
  }
  if (typeof document === 'undefined') {
    // Mode Node.js / unit testing
    try {
      const mqttModule = await import('mqtt');
      return mqttModule.default || mqttModule;
    } catch {
      return null;
    }
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MQTT_CDN_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.mqtt));
      existing.addEventListener('error', () => reject(new Error('Gagal memuat MQTT SDK')));
      return;
    }

    const script = document.createElement('script');
    script.src = MQTT_CDN_URL;
    script.async = true;
    script.onload = () => resolve(window.mqtt);
    script.onerror = () => reject(new Error('Gagal mengunduh MQTT.js dari CDN'));
    document.head.appendChild(script);
  });
}

/**
 * Menghubungkan dashboard ke broker MQTT Wokwi.
 * @param {Object} options
 * @param {Function} options.onMessage - Callback saat menerima baris data/event (telemetry/rfid)
 * @param {Function} options.onStatusChange - Callback saat status koneksi berubah ('connecting' | 'connected' | 'offline' | 'error')
 * @param {Object} [options.config] - Override konfigurasi broker / topic
 */
export async function connectWokwi({ onMessage, onStatusChange, config = {} }) {
  if (mqttClient) {
    disconnectWokwi();
  }

  currentConfig = { ...DEFAULT_WOKWI_CONFIG, ...config };
  isConnecting = true;
  onStatusChange?.('connecting');

  try {
    const mqtt = await ensureMqttLoaded();
    if (!mqtt) {
      throw new Error('Library MQTT tidak dapat dimuat.');
    }

    const clientId = currentConfig.clientIdPrefix + Math.random().toString(16).substring(2, 10);
    const client = mqtt.connect(currentConfig.brokerUrl, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
    });

    mqttClient = client;

    client.on('connect', () => {
      isConnecting = false;
      client.subscribe([currentConfig.topicTelemetry, currentConfig.topicRfid], { qos: 0 }, (err) => {
        if (err) {
          console.warn('Gagal subscribe ke topik Wokwi:', err);
        }
      });
      onStatusChange?.('connected');
    });

    client.on('message', (topic, payload) => {
      const message = payload.toString().trim();
      if (!message) return;
      onMessage?.(message, topic);
    });

    client.on('error', (err) => {
      console.warn('MQTT error:', err);
      onStatusChange?.('error', err);
    });

    client.on('close', () => {
      if (!isConnecting) {
        onStatusChange?.('offline');
      }
    });

    client.on('offline', () => {
      onStatusChange?.('offline');
    });

    return client;
  } catch (err) {
    isConnecting = false;
    onStatusChange?.('error', err);
    throw err;
  }
}

/**
 * Memutuskan koneksi MQTT Wokwi.
 */
export function disconnectWokwi() {
  isConnecting = false;
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch (e) {
      console.warn('Error closing MQTT:', e);
    }
    mqttClient = null;
  }
}

/**
 * Mengirim perintah interaktif ke simulator Wokwi ('b' bip single, 'n' bip triple, 'u' ukur, 'r' cek status).
 * @param {string} command
 */
export function sendWokwiCommand(command) {
  if (!mqttClient || !mqttClient.connected) {
    console.warn('Tidak dapat mengirim perintah: Wokwi MQTT tidak terhubung.');
    return false;
  }

  mqttClient.publish(currentConfig.topicCommand, String(command), { qos: 0 });
  return true;
}

/**
 * Mengecek status apakah koneksi Wokwi saat ini sedang terhubung.
 */
export function isWokwiConnected() {
  return Boolean(mqttClient && mqttClient.connected);
}
