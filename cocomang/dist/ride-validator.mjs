// ==============================================================================
// COCOMANG SmartHeight - Ride Validator
// Logika Verifikasi Kelayakan Akses Wahana Permainan Berdasarkan Tinggi Badan
// ==============================================================================

export const DEFAULT_RIDES = [
  {
    id: 'roller-coaster',
    name: 'Roller Coaster Halilintar',
    minHeightCm: 140,
    maxHeightCm: null,
    description: 'Wahana kecepatan tinggi dengan lintasan loop ekstrem 360 derajat.',
  },
  {
    id: 'kora-kora',
    name: 'Kora-Kora Perahu Ayun',
    minHeightCm: 125,
    maxHeightCm: null,
    description: 'Wahana ayunan bandul raksasa sudut 60 derajat.',
  },
  {
    id: 'bianglala',
    name: 'Bianglala Pemandangan',
    minHeightCm: 100,
    maxHeightCm: null,
    description: 'Kincir ria santai untuk segala usia di atas 100 cm.',
  },
  {
    id: 'kiddie-ride',
    name: 'Arena Bumper Car Anak',
    minHeightCm: 85,
    maxHeightCm: 125,
    description: 'Mobil senggol khusus anak dengan batas tinggi maksimal 125 cm.',
  },
];

const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * Memvalidasi apakah member memenuhi syarat batas tinggi wahana permainan.
 * @param {Object} member - Data profil member (wajib memiliki heightCm atau diberikan via currentHeight)
 * @param {Object} ride - Objek wahana (wajib memiliki minHeightCm)
 * @param {number|null} currentHeight - Tinggi badan saat ini jika berbeda dari profil member
 * @returns {Object} { eligible: boolean, height: number|null, diffCm: number, reason: string }
 */
export function validateRideEligibility(member, ride, currentHeight = null) {
  if (!ride || typeof ride !== 'object') {
    return { eligible: false, height: null, diffCm: 0, reason: 'Wahana permainan belum dipilih.' };
  }

  const height = currentHeight != null && Number.isFinite(Number(currentHeight))
    ? Number(currentHeight)
    : (member?.heightCm != null && Number.isFinite(Number(member.heightCm)) ? Number(member.heightCm) : null);

  if (height === null) {
    return {
      eligible: false,
      height: null,
      diffCm: 0,
      reason: 'Member belum melakukan pengukuran tinggi badan. Lakukan pengukuran sensor terlebih dahulu.',
    };
  }

  const min = Number(ride.minHeightCm ?? ride.min_height_cm ?? 0);
  const max = ride.maxHeightCm != null || ride.max_height_cm != null
    ? Number(ride.maxHeightCm ?? ride.max_height_cm)
    : null;

  if (height < min) {
    const diff = Number((min - height).toFixed(1));
    return {
      eligible: false,
      height,
      diffCm: diff,
      reason: `Tinggi badan (${height} cm) kurang ${diff} cm dari syarat minimum ${ride.name} (${min} cm).`,
    };
  }

  if (max !== null && height > max) {
    const diff = Number((height - max).toFixed(1));
    return {
      eligible: false,
      height,
      diffCm: diff,
      reason: `Tinggi badan (${height} cm) melebihi batas maksimal ${ride.name} (${max} cm).`,
    };
  }

  return {
    eligible: true,
    height,
    diffCm: 0,
    reason: `Lolos syarat tinggi badan ${ride.name} (Min: ${min} cm${max ? `, Max: ${max} cm` : ''}).`,
  };
}

/**
 * Membuat objek log validasi wahana yang siap disimpan ke database.
 */
export function createValidationRecord({ member, ride, evaluation, readerId = 2, now = new Date().toISOString() }) {
  if (!member || !ride || !evaluation) {
    throw new Error('Data validasi wahana tidak lengkap.');
  }

  return {
    id: makeId('val'),
    rfidUid: member.rfidUid || member.rfid_uid || '-',
    memberName: member.name || 'Member',
    measuredHeightCm: Number(evaluation.height || 0),
    rideId: ride.id,
    rideName: ride.name,
    minHeightRequiredCm: Number(ride.minHeightCm ?? ride.min_height_cm ?? 0),
    isEligible: Boolean(evaluation.eligible),
    rejectionReason: evaluation.eligible ? null : evaluation.reason,
    readerId: Number(readerId),
    validatedAt: now,
  };
}
