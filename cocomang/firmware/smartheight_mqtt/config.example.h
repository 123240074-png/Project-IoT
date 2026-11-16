#pragma once

// ==============================================================================
// COCOMANG SmartHeight - Konfigurasi Wi-Fi & MQTT Cloud Broker
// Salin berkas ini ke 'config.h' dan sesuaikan dengan SSID serta Password Wi-Fi Anda.
// ==============================================================================

// 1. Kredensial Jaringan Wi-Fi (2.4 GHz)
#define WIFI_SSID     "NAMA_WIFI_ANDA"
#define WIFI_PASSWORD "PASSWORD_WIFI_ANDA"

// 2. Kredensial MQTT Cloud Broker (Default: EMQX Public Broker)
#define MQTT_BROKER_HOST "broker.emqx.io"
#define MQTT_BROKER_PORT 1883
#define MQTT_CLIENT_ID   "cocomang-esp32-node"
#define MQTT_USERNAME    ""  // Kosongkan jika anonymous
#define MQTT_PASSWORD    ""

// 3. Topic Prefix (Wajib sama dengan pengaturan di Web Dashboard)
#define MQTT_TOPIC_PREFIX "cocomang"
