// ==============================================================================
// COCOMANG SmartHeight - Kiosk Service
// Layanan Integrasi Basis Data Loket Wahana (Supabase & Local-First Fallback)
// ==============================================================================

import { getClient } from './supabase-service.mjs';
import { DEFAULT_RIDES } from './ride-validator.mjs';
import { formatRfid, normalizeRfid, STORAGE_KEY } from './data.mjs';

const TICKET_STORAGE_KEY = 'cocomang-tickets-v1';

/**
 * Normalisasi format UID agar cocok dengan format di Supabase ('04:A1:B2:C3')
 */
export function sanitizeRfid(input) {
  if (!input) return '';
  const clean = normalizeRfid(String(input));
  return formatRfid(clean);
}

/**
 * Mencari data member hasil pendaftaran berdasarkan UID kartu RFID.
 * Mendukung Supabase Cloud dengan fallback ke LocalStorage (Local-First).
 */
export async function lookupMember(rfidInput) {
  const formattedUid = sanitizeRfid(rfidInput);
  const rawUid = normalizeRfid(rfidInput);
  if (!formattedUid && !rawUid) return null;

  // 1. Prioritas Cloud: Ambil dari Supabase
  try {
    const client = await getClient();
    if (client) {
      const { data, error } = await client
        .from('members')
        .select('*')
        .or(`rfid_uid.eq.${formattedUid},rfid_uid.eq.${rawUid}`)
        .maybeSingle();

      if (!error && data) {
        return {
          rfid_uid: data.rfid_uid,
          name: data.name,
          age: data.age,
          gender: data.gender,
          weight_kg: data.weight_kg != null ? Number(data.weight_kg) : null,
          height_cm: data.height_cm != null ? Number(data.height_cm) : null,
          notes: data.notes || '',
          last_measured_at: data.last_measured_at,
          source: 'supabase',
        };
      }
    }
  } catch (err) {
    console.warn('Gagal fetch member dari Supabase, beralih ke cache lokal:', err);
  }

  // 2. Fallback Local-First: Ambil dari localStorage pos pendaftaran
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const visitors = Array.isArray(parsed?.visitors) ? parsed.visitors : [];
      const local = visitors.find(v => {
        const vFormatted = sanitizeRfid(v.rfidUid || v.rfid);
        const vRaw = normalizeRfid(v.rfidUid || v.rfid);
        return vFormatted === formattedUid || vRaw === rawUid;
      });

      if (local) {
        return {
          rfid_uid: formatRfid(local.rfidUid || local.rfid),
          name: local.name,
          age: local.age != null ? Number(local.age) : null,
          gender: local.gender || null,
          weight_kg: local.weightKg != null ? Number(local.weightKg) : null,
          height_cm: local.heightCm != null ? Number(local.heightCm) : null,
          notes: local.notes || '',
          last_measured_at: local.measuredAt || null,
          source: 'local_storage',
        };
      }
    }
  } catch (err) {
    console.warn('Gagal membaca localStorage lokal:', err);
  }

  return null;
}

/**
 * Mengambil daftar katalog wahana aktif dari Supabase atau DEFAULT_RIDES
 */
export async function getActiveRides() {
  try {
    const client = await getClient();
    if (client) {
      const { data, error } = await client
        .from('rides')
        .select('*')
        .eq('is_active', true)
        .order('min_height_cm', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map(r => ({
          id: r.id,
          name: r.name,
          min_height_cm: Number(r.min_height_cm),
          max_height_cm: r.max_height_cm != null ? Number(r.max_height_cm) : null,
          description: r.description || '',
          is_active: r.is_active,
        }));
      }
    }
  } catch (err) {
    console.warn('Gagal mengambil wahana dari Supabase, gunakan default:', err);
  }

  // Fallback ke daftar wahana default bawaan
  return DEFAULT_RIDES.map(r => ({
    id: r.id,
    name: r.name,
    min_height_cm: Number(r.minHeightCm),
    max_height_cm: r.maxHeightCm != null ? Number(r.maxHeightCm) : null,
    description: r.description,
    is_active: true,
  }));
}

/**
 * Mengevaluasi kelayakan tinggi badan pengunjung terhadap aturan wahana
 */
export function evaluateRideEligibility(memberHeight, ride) {
  const height = Number(memberHeight);
  if (!Number.isFinite(height) || height <= 0) {
    return {
      eligible: false,
      diffCm: 0,
      reason: 'Belum ada data tinggi badan. Lakukan pengukuran ultrasonik di pos pendaftaran.',
    };
  }

  const min = Number(ride.min_height_cm ?? 0);
  const max = ride.max_height_cm != null ? Number(ride.max_height_cm) : null;

  if (height < min) {
    const diff = Number((min - height).toFixed(1));
    return {
      eligible: false,
      diffCm: diff,
      reason: `Tinggi badan (${height} cm) kurang ${diff} cm dari syarat minimum ${ride.name} (${min} cm).`,
    };
  }

  if (max !== null && height > max) {
    const diff = Number((height - max).toFixed(1));
    return {
      eligible: false,
      diffCm: diff,
      reason: `Tinggi badan (${height} cm) melebihi batas maksimal ${ride.name} (${max} cm). Khusus arena anak.`,
    };
  }

  return {
    eligible: true,
    diffCm: 0,
    reason: `Lolos syarat aman ${ride.name} (Tinggi badan: ${height} cm memenuhi ketentuan Min: ${min} cm${max ? `, Max: ${max} cm` : ''}).`,
  };
}

/**
 * Mencatat log percobaan validasi ke database (baik lolos maupun ditolak)
 */
export async function recordValidationAttempt({ member, ride, evaluation }) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const validationId = `VAL-${timestamp}-${randomSuffix}`;
  const nowIso = new Date().toISOString();

  const validationRecord = {
    id: validationId,
    rfid_uid: member.rfid_uid,
    member_name: member.name,
    measured_height_cm: member.height_cm,
    ride_id: ride.id,
    ride_name: ride.name,
    min_height_required_cm: ride.min_height_cm,
    is_eligible: evaluation.eligible,
    rejection_reason: evaluation.eligible ? null : evaluation.reason,
    reader_id: 2, // ID 2: Reader 2 Akses Masuk Wahana
    validated_at: nowIso,
  };

  try {
    const client = await getClient();
    if (client) {
      await client.from('ride_validations').insert([validationRecord]);
    }
  } catch (err) {
    console.warn('Gagal mencatat log validasi ke Supabase:', err);
  }

  return validationRecord;
}

/**
 * Menerbitkan tiket wahana & menyimpan riwayat validasi ke Supabase dan localStorage
 */
export async function bookRideTicket({ member, ride, evaluation }) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const ticketId = `TCK-${timestamp}-${randomSuffix}`;
  const nowIso = new Date().toISOString();

  const ticketRecord = {
    id: ticketId,
    rfid_uid: member.rfid_uid,
    member_name: member.name,
    member_height_cm: member.height_cm,
    ride_id: ride.id,
    ride_name: ride.name,
    status: 'ISSUED',
    issued_at: nowIso,
  };

  // 1. Simpan riwayat validasi
  await recordValidationAttempt({ member, ride, evaluation });

  // 2. Simpan tiket ke Supabase jika terhubung
  try {
    const client = await getClient();
    if (client) {
      await client.from('ride_tickets').insert([ticketRecord]);
    }
  } catch (err) {
    console.warn('Gagal menyimpan tiket ke Supabase, tersimpan di lokal:', err);
  }

  // 3. Simpan ke LocalStorage sebagai backup riwayat
  try {
    const existingRaw = localStorage.getItem(TICKET_STORAGE_KEY);
    const tickets = existingRaw ? JSON.parse(existingRaw) : [];
    tickets.unshift(ticketRecord);
    localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(tickets.slice(0, 100)));
  } catch (_) {}

  return ticketRecord;
}
