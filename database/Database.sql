-- ═══════════════════════════════════════════════════════════════
-- ElectraCalc — Database.sql
-- Skema + Seed Data untuk Standar Kabel PUIL 2011
-- Compatible: SQLite (dev) & SQL Server (production)
-- ═══════════════════════════════════════════════════════════════

-- Hapus tabel lama jika ada (aman untuk re-run)
DROP TABLE IF EXISTS WireStandards;
DROP TABLE IF EXISTS CalculationLogs;

-- ── TABEL 1: Standar Kabel ─────────────────────────────────────
-- Data standar dari PUIL 2011 (SNI 04-0225-2011) Tabel 5.6-1
-- Kabel NYM/NYA/NYY dengan insulasi PVC, pemasangan di udara 30°C
-- Harga referensi: pasar 2024 (Eterna & Supreme)

CREATE TABLE WireStandards (
    Id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    CrossSectionMm2      REAL    NOT NULL,   -- Luas penampang (mm²)
    MaxAmpere            REAL    NOT NULL,   -- Kapasitas arus max (A), tembaga
    PricePerMeterEterna  INTEGER NOT NULL,   -- Harga Eterna per meter (Rp)
    PricePerMeterSupreme INTEGER NOT NULL,   -- Harga Supreme per meter (Rp)
    Description          TEXT,
    CreatedAt            TEXT    DEFAULT (datetime('now')),
    UpdatedAt            TEXT    DEFAULT (datetime('now'))
);

-- ── TABEL 2: Log Perhitungan ───────────────────────────────────
-- Menyimpan riwayat kalkulasi untuk analitik & audit

CREATE TABLE CalculationLogs (
    Id              INTEGER PRIMARY KEY AUTOINCREMENT,
    RequestJson     TEXT    NOT NULL,   -- Seluruh request JSON
    ResponseJson    TEXT    NOT NULL,   -- Seluruh response JSON
    TotalWatt       REAL,
    CurrentAmpere   REAL,
    WireSizeMm2     REAL,
    SafetyStatus    TEXT,               -- 'safe' | 'warn' | 'danger'
    IpAddress       TEXT,
    UserAgent       TEXT,
    CreatedAt       TEXT DEFAULT (datetime('now'))
);

-- ── INDEX ──────────────────────────────────────────────────────
CREATE INDEX idx_wire_mm2     ON WireStandards (CrossSectionMm2);
CREATE INDEX idx_log_status   ON CalculationLogs (SafetyStatus);
CREATE INDEX idx_log_created  ON CalculationLogs (CreatedAt);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Standar Kabel PUIL 2011
-- Sumber: SNI 04-0225-2011 Tabel 5.6-1 (Kabel Cu NYA/NYM, PVC)
-- Kapasitas arus untuk pemasangan di udara, suhu sekitar 30°C
-- Harga Eterna & Supreme: per meter, single core, pasar 2024
-- ═══════════════════════════════════════════════════════════════

INSERT INTO WireStandards
    (CrossSectionMm2, MaxAmpere, PricePerMeterEterna, PricePerMeterSupreme, Description)
VALUES
--  mm²     A       Eterna(Rp)  Supreme(Rp)  Keterangan
    (1.5,   16,     4500,       5000,        'Penerangan ringan, stop kontak tunggal'),
    (2.5,   21,     6500,       7200,        'Instalasi daya umum, stop kontak ganda'),
    (4,     28,     10500,      11500,       'AC 1 PK, pompa air, water heater'),
    (6,     36,     15000,      16500,       'AC 2 PK, beban menengah'),
    (10,    50,     24000,      26500,       'Beban berat, sub-panel'),
    (16,    68,     38000,      42000,       'Panel distribusi, mesin industri ringan'),
    (25,    89,     62000,      68000,       'Feeder industri kecil'),
    (35,    111,    86000,      94000,       'Feeder industri menengah'),
    (50,    134,    122000,     135000,      'Feeder panel utama'),
    (70,    171,    168000,     185000,      'Panel utama gedung bertingkat'),
    (95,    207,    228000,     250000,      'Trafo distribusi kecil'),
    (120,   239,    288000,     316000,      'Kapasitas daya besar');

-- ═══════════════════════════════════════════════════════════════
-- QUERY REFERENSI (untuk debugging & verifikasi)
-- ═══════════════════════════════════════════════════════════════

-- 1. Tampilkan seluruh standar kabel
-- SELECT * FROM WireStandards ORDER BY CrossSectionMm2;

-- 2. Cari kabel yang mampu menampung arus tertentu (contoh: 30A)
-- SELECT * FROM WireStandards
-- WHERE MaxAmpere >= 30
-- ORDER BY CrossSectionMm2
-- LIMIT 1;

-- 3. Statistik log perhitungan per status keamanan
-- SELECT SafetyStatus, COUNT(*) as Jumlah, AVG(TotalWatt) as RataWatt
-- FROM CalculationLogs
-- GROUP BY SafetyStatus;

-- 4. Update harga kabel (contoh update saat harga naik)
-- UPDATE WireStandards
-- SET PricePerMeterEterna = 7000, UpdatedAt = datetime('now')
-- WHERE CrossSectionMm2 = 2.5;
