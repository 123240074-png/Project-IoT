-- ==============================================================================
-- COCOMANG SmartHeight - Skema Database Supabase PostgreSQL
-- Progres 2: Dual RFID MFRC522 + HC-SR04 Ultrasonic + Buzzer Pasif
-- ==============================================================================

-- 1. Tabel Member Wahana Permainan (Berbasis Kartu RFID)
CREATE TABLE IF NOT EXISTS members (
  rfid_uid VARCHAR(32) PRIMARY KEY,              -- Format standar: '04:A1:B2:C3'
  name VARCHAR(100) NOT NULL,                    -- Nama lengkap pemilik kartu
  age SMALLINT CHECK (age >= 1 AND age <= 120),  -- Usia dalam tahun
  gender VARCHAR(10) CHECK (gender IN ('L', 'P', 'Lainnya')),
  weight_kg NUMERIC(5,2) CHECK (weight_kg >= 1 AND weight_kg <= 300),
  height_cm NUMERIC(5,2) CHECK (height_cm >= 0 AND height_cm <= 250), -- Hasil ukur HC-SR04
  notes TEXT,
  last_measured_at TIMESTAMPTZ,                 -- Waktu pengukuran tinggi terakhir
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabel Katalog Wahana Permainan & Batas Tinggi
CREATE TABLE IF NOT EXISTS rides (
  id VARCHAR(50) PRIMARY KEY,                    -- Slug unik (contoh: 'roller-coaster')
  name VARCHAR(100) NOT NULL,                   -- Nama wahana
  min_height_cm NUMERIC(5,2) NOT NULL,          -- Syarat tinggi minimum (cm)
  max_height_cm NUMERIC(5,2),                   -- Batas tinggi maksimum (opsional, misal arena anak)
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabel Riwayat Pengukuran & Log Validasi Akses Wahana
CREATE TABLE IF NOT EXISTS ride_validations (
  id TEXT PRIMARY KEY,                          -- ID unik (contoh: 'val-UUID')
  rfid_uid VARCHAR(32) REFERENCES members(rfid_uid) ON DELETE CASCADE,
  member_name VARCHAR(100) NOT NULL,
  measured_height_cm NUMERIC(5,2) NOT NULL,     -- Tinggi member saat divalidasi
  ride_id VARCHAR(50) REFERENCES rides(id) ON DELETE SET NULL,
  ride_name VARCHAR(100) NOT NULL,
  min_height_required_cm NUMERIC(5,2) NOT NULL,
  is_eligible BOOLEAN NOT NULL,                 -- TRUE = Lolos, FALSE = Ditolak
  rejection_reason TEXT,                        -- Alasan jika ditolak (misal: 'Kurang 12 cm')
  reader_id SMALLINT DEFAULT 2,                  -- 1 = Pos Pendaftaran, 2 = Pos Akses Wahana
  validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing untuk optimasi query cepat
CREATE INDEX IF NOT EXISTS idx_members_created ON members(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
CREATE INDEX IF NOT EXISTS idx_validations_time ON ride_validations(validated_at DESC);
CREATE INDEX IF NOT EXISTS idx_validations_rfid ON ride_validations(rfid_uid);
CREATE INDEX IF NOT EXISTS idx_validations_ride ON ride_validations(ride_id);

-- Aktifkan Row Level Security (RLS)
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_validations ENABLE ROW LEVEL SECURITY;

-- Policy Akses Publik untuk Anon Key (Dashboard Operator Web Serial)
CREATE POLICY "Allow public all on members" 
  ON members FOR ALL 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow public all on rides" 
  ON rides FOR ALL 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow public all on ride_validations" 
  ON ride_validations FOR ALL 
  USING (true) 
  WITH CHECK (true);

-- Aktifkan Realtime Publikasi untuk tabel (Supabase Realtime WebSocket)
ALTER PUBLICATION supabase_realtime ADD TABLE members;
ALTER PUBLICATION supabase_realtime ADD TABLE rides;
ALTER PUBLICATION supabase_realtime ADD TABLE ride_validations;

-- Data Awal Katalog Wahana Populer
INSERT INTO rides (id, name, min_height_cm, max_height_cm, description) VALUES
  ('roller-coaster', 'Roller Coaster Halilintar', 140.0, NULL, 'Wahana kecepatan tinggi dengan lintasan loop ekstrem 360 derajat.'),
  ('kora-kora', 'Kora-Kora Perahu Ayun', 125.0, NULL, 'Wahana ayunan bandul raksasa sensasi gravitasi tinggi sudut 60 derajat.'),
  ('bianglala', 'Bianglala Pemandangan', 100.0, NULL, 'Kincir ria santai untuk segala usia di atas 100 cm.'),
  ('kiddie-ride', 'Arena Bumper Car Anak', 85.0, 125.0, 'Mobil senggol khusus anak dengan batas tinggi maksimal 125 cm.')
ON CONFLICT (id) DO NOTHING;
