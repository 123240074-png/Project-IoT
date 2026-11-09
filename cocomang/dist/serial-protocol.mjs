import { validateDeviceFrame } from './data.mjs';

// The ESP32 sends one JSON object per line at 115200 baud.
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
