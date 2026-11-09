import { validateDeviceFrame } from './data.mjs';

// The ESP32 sends one JSON object per line at 115200 baud for measurements,
// or formatted status lines for RFID tap events.
export function parseDeviceLine(line) {
  const text = String(line ?? '').trim();
  if (!text || !text.startsWith('{')) return null; // ignore startup text/noise
  let frame;
  try { frame = JSON.parse(text); }
  catch { return null; }
  if (frame?.type !== 'measurement' || frame?.device !== 'smartheight-esp32') return null;
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
  return { ...frame, receivedAt: new Date().toISOString() };
}

export function parseRfidLine(line) {
  const text = String(line ?? '').trim();
  const match = text.match(/\[RFID\s*([12])\s*-\s*([^\]]+)\]\s*Kartu Terdeteksi!\s*UID:\s*([0-9A-Fa-f:]+)/i);
  if (!match) return null;
  return {
    reader: Number(match[1]),
    label: match[2].trim(),
    uid: match[3].trim().toUpperCase(),
  };
}
