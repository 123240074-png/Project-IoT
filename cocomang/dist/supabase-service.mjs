// ==============================================================================
// COCOMANG SmartHeight - Supabase Service
// Integrasi Client Supabase (PostgreSQL Cloud) berbasis Vanilla ES Modules
// ==============================================================================

import { DEFAULT_RIDES } from './ride-validator.mjs';

export const SUPABASE_CONFIG_KEY = 'cocomang-supabase-config-v1';
const SUPABASE_CDN_URL = 'https://esm.sh/@supabase/supabase-js@2?bundle';

let supabaseClient = null;
let realtimeChannel = null;

export function getSupabaseConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(SUPABASE_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    url: '',
    anonKey: '',
    syncEnabled: true,
  };
}

export function saveSupabaseConfig(config) {
  const data = {
    url: String(config?.url ?? '').trim(),
    anonKey: String(config?.anonKey ?? '').trim(),
    syncEnabled: Boolean(config?.syncEnabled ?? true),
  };
  try {
    globalThis.localStorage?.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(data));
  } catch {}
  // Reset existing client instance so next call uses updated config
  supabaseClient = null;
  return data;
}

export function isConfigured() {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

/**
 * Inisialisasi Supabase JS Client secara asinkron dari CDN ESM.
 */
export async function getClient() {
  if (supabaseClient) return supabaseClient;
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) return null;

  try {
    const { createClient } = await import(SUPABASE_CDN_URL);
    supabaseClient = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    return supabaseClient;
  } catch (err) {
    console.warn('Gagal memuat Supabase JS SDK dari CDN:', err);
    return null;
  }
}

/**
 * Menguji koneksi ke database Supabase.
 */
export async function testConnection(url, anonKey) {
  try {
    const { createClient } = await import(SUPABASE_CDN_URL);
    const testClient = createClient(url.trim(), anonKey.trim(), {
      auth: { persistSession: false },
    });
    const { data, error } = await testClient.from('rides').select('id, name').limit(1);
    if (error) throw new Error(error.message);
    return { success: true, message: 'Koneksi ke Supabase berhasil!' };
  } catch (err) {
    return { success: false, message: `Koneksi gagal: ${err.message}` };
  }
}

/**
 * Pemetaan CamelCase lokal ke SnakeCase PostgreSQL Supabase
 */
export function memberToDb(member) {
  return {
    rfid_uid: member.rfidUid || member.rfid_uid,
    name: member.name,
    age: member.age != null ? Number(member.age) : null,
    gender: member.gender || null,
    weight_kg: member.weightKg != null ? Number(member.weightKg) : null,
    height_cm: member.heightCm != null ? Number(member.heightCm) : null,
    notes: member.notes || '',
    last_measured_at: member.measuredAt || member.last_measured_at || null,
    created_at: member.createdAt || member.created_at || new Date().toISOString(),
  };
}

export function dbToMember(row) {
  return {
    id: `member-${row.rfid_uid}`,
    rfidUid: row.rfid_uid,
    name: row.name,
    age: row.age,
    gender: row.gender,
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : null,
    heightCm: row.height_cm != null ? Number(row.height_cm) : null,
    notes: row.notes || '',
    measuredAt: row.last_measured_at,
    createdAt: row.created_at,
  };
}

/**
 * Mengambil seluruh data member dari Supabase.
 */
export async function fetchMembers() {
  const client = await getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('members')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(dbToMember);
  } catch (err) {
    console.error('fetchMembers error:', err);
    return null;
  }
}

/**
 * Menyimpan / memperbarui profil member ke Supabase.
 */
export async function upsertMember(member) {
  const client = await getClient();
  if (!client || !member.rfidUid) return null;

  try {
    const payload = memberToDb(member);
    const { data, error } = await client
      .from('members')
      .upsert(payload, { onConflict: 'rfid_uid' })
      .select()
      .single();
    if (error) throw error;
    return dbToMember(data);
  } catch (err) {
    console.error('upsertMember error:', err);
    return null;
  }
}

/**
 * Memperbarui tinggi badan hasil ukur HC-SR04 pada member.
 */
export async function updateMemberHeight(rfidUid, heightCm, now = new Date().toISOString()) {
  const client = await getClient();
  if (!client || !rfidUid) return null;

  try {
    const { data, error } = await client
      .from('members')
      .update({
        height_cm: Number(heightCm),
        last_measured_at: now,
      })
      .eq('rfid_uid', rfidUid)
      .select()
      .single();
    if (error) throw error;
    return dbToMember(data);
  } catch (err) {
    console.error('updateMemberHeight error:', err);
    return null;
  }
}

/**
 * Mengambil katalog wahana aktif dari Supabase (fallback ke DEFAULT_RIDES jika offline).
 */
export async function fetchRides() {
  const client = await getClient();
  if (!client) return DEFAULT_RIDES;

  try {
    const { data, error } = await client
      .from('rides')
      .select('*')
      .eq('is_active', true)
      .order('min_height_cm', { ascending: true });
    if (error || !data?.length) return DEFAULT_RIDES;

    return data.map(r => ({
      id: r.id,
      name: r.name,
      minHeightCm: Number(r.min_height_cm),
      maxHeightCm: r.max_height_cm != null ? Number(r.max_height_cm) : null,
      description: r.description,
    }));
  } catch (err) {
    console.warn('Gagal memuat wahana dari Supabase, menggunakan default lokal:', err);
    return DEFAULT_RIDES;
  }
}

/**
 * Mencatat log validasi wahana ke Supabase.
 */
export async function recordValidation(val) {
  const client = await getClient();
  if (!client) return null;

  try {
    const row = {
      id: val.id,
      rfid_uid: val.rfidUid,
      member_name: val.memberName,
      measured_height_cm: Number(val.measuredHeightCm),
      ride_id: val.rideId,
      ride_name: val.rideName,
      min_height_required_cm: Number(val.minHeightRequiredCm),
      is_eligible: Boolean(val.isEligible),
      rejection_reason: val.rejectionReason || null,
      reader_id: val.readerId || 2,
      validated_at: val.validatedAt || new Date().toISOString(),
    };
    const { data, error } = await client.from('ride_validations').insert([row]).select().single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('recordValidation error:', err);
    return null;
  }
}

/**
 * Mengambil riwayat validasi wahana terbaru dari Supabase.
 */
export async function fetchRecentValidations(limit = 50) {
  const client = await getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('ride_validations')
      .select('*')
      .order('validated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchRecentValidations error:', err);
    return [];
  }
}

/**
 * Migrasikan seluruh data member lokal ke Supabase.
 */
export async function syncLocalMembersToSupabase(localMembers = []) {
  const client = await getClient();
  if (!client || !localMembers.length) return { synced: 0, failed: 0 };

  const validMembers = localMembers.filter(m => m.rfidUid);
  if (!validMembers.length) return { synced: 0, failed: 0 };

  const payloads = validMembers.map(memberToDb);
  try {
    const { data, error } = await client
      .from('members')
      .upsert(payloads, { onConflict: 'rfid_uid' });
    if (error) throw error;
    return { synced: payloads.length, failed: 0 };
  } catch (err) {
    console.error('syncLocalMembersToSupabase error:', err);
    return { synced: 0, failed: payloads.length, error: err.message };
  }
}

/**
 * Berlangganan Realtime Supabase (WebSocket) untuk sinkronisasi otomatis multi-layar.
 */
export async function subscribeToRealtime({ onMemberChange, onValidationChange }) {
  const client = await getClient();
  if (!client) return null;

  try {
    if (realtimeChannel) {
      await client.removeChannel(realtimeChannel);
    }
    realtimeChannel = client
      .channel('smartheight-live-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        payload => {
          if (typeof onMemberChange === 'function') {
            onMemberChange(payload);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ride_validations' },
        payload => {
          if (typeof onValidationChange === 'function') {
            onValidationChange(payload);
          }
        }
      )
      .subscribe();
    return realtimeChannel;
  } catch (err) {
    console.warn('Realtime subscription error:', err);
    return null;
  }
}
