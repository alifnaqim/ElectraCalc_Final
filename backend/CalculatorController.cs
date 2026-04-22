// ═══════════════════════════════════════════════════════════════════
// ElectraCalc — CalculatorController.cs
// ASP.NET Core Web API · Separation of Concerns Architecture
//
// Endpoint:  POST /api/calculator/calculate
// Docs:      GET  /swagger
//
// Tugas Akhir Teknik Elektro
// Standar: PUIL 2011 (SNI 04-0225-2011)
// ═══════════════════════════════════════════════════════════════════

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace ElectraCalc.Controllers;

// ──────────────────────────────────────────────────────────────────
// REQUEST & RESPONSE DATA TRANSFER OBJECTS
// ──────────────────────────────────────────────────────────────────

/// <summary>Satu item peralatan listrik dari form input.</summary>
public record ApplianceInput(
    [Required] string Name,
    [Range(1, 1_000_000)] double WattPerUnit,
    [Range(1, 100)] int Quantity,
    [Range(0, 24)] double HoursPerDay
);

/// <summary>Payload utama yang dikirim dari frontend (JSON POST).</summary>
public record CalculatorRequest(
    [Required] IList<ApplianceInput> Appliances,
    [Range(100, 500)] double Voltage       = 220,
    [Range(1, 1000)]  double CableLength   = 10,
    string Material = "copper",   // "copper" | "aluminum"
    string Phase    = "single"    // "single" | "three"
);

/// <summary>Hasil per peralatan yang dikembalikan ke frontend.</summary>
public record ApplianceResult(
    string Name,
    double WattPerUnit,
    int    Quantity,
    double TotalWatt,
    double HoursPerDay,
    double KwhPerDay,
    double Percentage
);

/// <summary>Respons lengkap dari API perhitungan.</summary>
public record CalculatorResponse(
    double TotalWatt,
    double Current,
    double CurrentSafe,
    double WireSizeMm2,
    double WireCapacityAmpere,
    double DeltaVoltage,
    double VdropPercent,
    int    McbRating,
    long   CostEterna,
    long   CostSupreme,
    string SafetyStatus,   // "safe" | "warn" | "danger"
    string SafetyMessage,
    double Voltage,
    double CableLength,
    string Material,
    string Phase,
    IList<ApplianceResult> Appliances
);

// ──────────────────────────────────────────────────────────────────
// CONTROLLER
// ──────────────────────────────────────────────────────────────────

/// <summary>
/// API Controller untuk kalkulasi beban listrik dan ukuran kabel.
/// Semua logika perhitungan dilakukan di service layer (ICalculatorService).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CalculatorController : ControllerBase
{
    private readonly ICalculatorService _svc;
    private readonly ILogger<CalculatorController> _log;

    public CalculatorController(ICalculatorService svc, ILogger<CalculatorController> log)
    {
        _svc = svc;
        _log = log;
    }

    /// <summary>
    /// Hitung beban listrik, arus, ukuran kabel (PUIL), rating MCB,
    /// voltage drop, dan estimasi biaya kabel.
    /// </summary>
    /// <param name="req">Data peralatan dan parameter sistem.</param>
    /// <returns>Hasil analisis lengkap.</returns>
    /// <response code="200">Kalkulasi berhasil.</response>
    /// <response code="400">Input tidak valid.</response>
    [HttpPost("calculate")]
    [ProducesResponseType(typeof(CalculatorResponse), 200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Calculate([FromBody] CalculatorRequest req)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        _log.LogInformation(
            "Calculation request: {Count} appliances, {Voltage}V, {Length}m {Material} {Phase}",
            req.Appliances.Count, req.Voltage, req.CableLength, req.Material, req.Phase
        );

        var result = await _svc.CalculateAsync(req);
        return Ok(result);
    }

    /// <summary>Kembalikan daftar standar kabel dari database.</summary>
    [HttpGet("wire-standards")]
    [ProducesResponseType(typeof(IEnumerable<WireStandard>), 200)]
    public async Task<IActionResult> GetWireStandards(
        [FromServices] AppDbContext db)
    {
        var standards = await db.WireStandards
            .OrderBy(w => w.CrossSectionMm2)
            .ToListAsync();
        return Ok(standards);
    }

    /// <summary>Health check endpoint.</summary>
    [HttpGet("health")]
    public IActionResult Health() => Ok(new { status = "ok", timestamp = DateTime.UtcNow });
}

// ──────────────────────────────────────────────────────────────────
// SERVICE INTERFACE & IMPLEMENTATION
// ──────────────────────────────────────────────────────────────────

public interface ICalculatorService
{
    Task<CalculatorResponse> CalculateAsync(CalculatorRequest req);
}

/// <summary>
/// Implementasi service kalkulasi beban listrik.
/// Rumus utama: I = P / V (single-phase), I = P / (√3 × V × PF) (three-phase).
/// Safety factor 125% sesuai PUIL 2011 Pasal 7.3.
/// </summary>
public class CalculatorService : ICalculatorService
{
    private readonly AppDbContext _db;

    // Resistivitas listrik (Ω·mm²/m) pada 20°C
    private static readonly Dictionary<string, double> Resistivity = new()
    {
        ["copper"]   = 0.01724,
        ["aluminum"] = 0.02826,
    };

    // Faktor derating aluminium vs tembaga
    private const double AluminumFactor = 0.78;

    // Safety factor PUIL Pasal 7.3
    private const double SafetyFactor = 1.25;

    // Batas voltage drop maksimum (%) per PUIL
    private const double MaxVdropPct = 5.0;

    // Rating MCB standar (A) per IEC 60898-1
    private static readonly int[] McbRatings = { 2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125 };

    public CalculatorService(AppDbContext db) => _db = db;

    public async Task<CalculatorResponse> CalculateAsync(CalculatorRequest req)
    {
        // Ambil standar kabel dari database, urutkan dari terkecil
        var wireStandards = await _db.WireStandards
            .OrderBy(w => w.CrossSectionMm2)
            .ToListAsync();

        var mat   = req.Material.ToLower() == "aluminum" ? "aluminum" : "copper";
        var rho   = Resistivity[mat];
        var effF  = mat == "aluminum" ? AluminumFactor : 1.0;

        // ── Total Daya ──────────────────────────────────────────
        double totalWatt = req.Appliances.Sum(a => a.WattPerUnit * a.Quantity);

        // ── Arus: I = P/V (1-fasa) | I = P/(√3·V·PF) (3-fasa) ─
        double current = req.Phase == "three"
            ? totalWatt / (Math.Sqrt(3) * req.Voltage * 0.9)
            : totalWatt / req.Voltage;

        // ── Arus desain dengan safety factor 125% ───────────────
        double currentSafe = current * SafetyFactor;

        // ── Pilih ukuran kabel (PUIL) ───────────────────────────
        var selectedWire = wireStandards
            .FirstOrDefault(w => w.MaxAmpere * effF >= currentSafe)
            ?? wireStandards.Last();   // fallback: kabel terbesar

        double wireCapacity = selectedWire.MaxAmpere * effF;

        // ── Voltage Drop: ΔV = (k·ρ·L·I) / A ──────────────────
        // k=2 untuk single-phase, k=√3 untuk three-phase
        double phaseMult = req.Phase == "three" ? Math.Sqrt(3) : 2.0;
        double deltaV    = (phaseMult * rho * req.CableLength * current)
                           / selectedWire.CrossSectionMm2;
        double vdropPct  = (deltaV / req.Voltage) * 100.0;

        // ── MCB Rating ─────────────────────────────────────────
        int mcb = McbRatings.FirstOrDefault(r => r >= currentSafe);
        if (mcb == 0) mcb = 125;

        // ── Biaya kabel (database-driven) ──────────────────────
        int conductors  = req.Phase == "single" ? 3 : 4;
        long costEterna = (long)(selectedWire.PricePerMeterEterna  * req.CableLength * conductors);
        long costSupreme= (long)(selectedWire.PricePerMeterSupreme * req.CableLength * conductors);

        // ── Status keamanan ─────────────────────────────────────
        double loadRatio = currentSafe / wireCapacity;
        string status;
        string safetyMsg;

        if (vdropPct > MaxVdropPct || loadRatio > 0.95)
        {
            status    = "danger";
            safetyMsg = "BAHAYA! Beban melebihi batas aman. Wajib upgrade ukuran kabel atau perbesar kapasitas daya untuk mencegah risiko korsleting!";
        }
        else if (vdropPct > MaxVdropPct * 0.7 || loadRatio > 0.80)
        {
            status    = "warn";
            safetyMsg = "Perhatian: Beban mendekati kapasitas maksimum atau voltage drop cukup tinggi. Pertimbangkan upgrade kabel.";
        }
        else
        {
            status    = "safe";
            safetyMsg = "Instalasi dalam batas aman. Voltage drop dan kapasitas kabel sesuai standar PUIL 2011.";
        }

        // ── Enriched appliance list ─────────────────────────────
        var enriched = req.Appliances.Select(a => new ApplianceResult(
            Name:        a.Name,
            WattPerUnit: a.WattPerUnit,
            Quantity:    a.Quantity,
            TotalWatt:   a.WattPerUnit * a.Quantity,
            HoursPerDay: a.HoursPerDay,
            KwhPerDay:   a.WattPerUnit * a.Quantity * a.HoursPerDay / 1000.0,
            Percentage:  totalWatt > 0 ? (a.WattPerUnit * a.Quantity / totalWatt) * 100 : 0
        )).ToList();

        return new CalculatorResponse(
            TotalWatt:            Math.Round(totalWatt,    2),
            Current:              Math.Round(current,      2),
            CurrentSafe:          Math.Round(currentSafe,  2),
            WireSizeMm2:          selectedWire.CrossSectionMm2,
            WireCapacityAmpere:   Math.Round(wireCapacity, 1),
            DeltaVoltage:         Math.Round(deltaV,       2),
            VdropPercent:         Math.Round(vdropPct,     2),
            McbRating:            mcb,
            CostEterna:           costEterna,
            CostSupreme:          costSupreme,
            SafetyStatus:         status,
            SafetyMessage:        safetyMsg,
            Voltage:              req.Voltage,
            CableLength:          req.CableLength,
            Material:             mat,
            Phase:                req.Phase,
            Appliances:           enriched
        );
    }
}

// ──────────────────────────────────────────────────────────────────
// DATABASE ENTITIES & CONTEXT (Entity Framework Core)
// ──────────────────────────────────────────────────────────────────

/// <summary>
/// Standar kabel PUIL — disimpan di database agar harga
/// bisa diupdate tanpa recompile.
/// </summary>
public class WireStandard
{
    public int    Id                   { get; set; }
    public double CrossSectionMm2      { get; set; }   // luas penampang (mm²)
    public double MaxAmpere            { get; set; }   // kapasitas max arus (A)
    public long   PricePerMeterEterna  { get; set; }   // Rp/meter (Eterna 2024)
    public long   PricePerMeterSupreme { get; set; }   // Rp/meter (Supreme 2024)
    public string? Description         { get; set; }
}

/// <summary>Entity Framework Core DbContext.</summary>
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> opts) : base(opts) { }

    public DbSet<WireStandard> WireStandards => Set<WireStandard>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Seed data — harga pasar 2024 (Eterna & Supreme)
        b.Entity<WireStandard>().HasData(
            new WireStandard { Id=1,  CrossSectionMm2=1.5,  MaxAmpere=16,  PricePerMeterEterna=4500,   PricePerMeterSupreme=5000,   Description="Penerangan ringan" },
            new WireStandard { Id=2,  CrossSectionMm2=2.5,  MaxAmpere=21,  PricePerMeterEterna=6500,   PricePerMeterSupreme=7200,   Description="Instalasi daya umum" },
            new WireStandard { Id=3,  CrossSectionMm2=4,    MaxAmpere=28,  PricePerMeterEterna=10500,  PricePerMeterSupreme=11500,  Description="AC 1-2 PK, pompa" },
            new WireStandard { Id=4,  CrossSectionMm2=6,    MaxAmpere=36,  PricePerMeterEterna=15000,  PricePerMeterSupreme=16500,  Description="Beban sedang" },
            new WireStandard { Id=5,  CrossSectionMm2=10,   MaxAmpere=50,  PricePerMeterEterna=24000,  PricePerMeterSupreme=26500,  Description="Beban berat" },
            new WireStandard { Id=6,  CrossSectionMm2=16,   MaxAmpere=68,  PricePerMeterEterna=38000,  PricePerMeterSupreme=42000,  Description="Panel distribusi" },
            new WireStandard { Id=7,  CrossSectionMm2=25,   MaxAmpere=89,  PricePerMeterEterna=62000,  PricePerMeterSupreme=68000,  Description="Feeder industri kecil" },
            new WireStandard { Id=8,  CrossSectionMm2=35,   MaxAmpere=111, PricePerMeterEterna=86000,  PricePerMeterSupreme=94000,  Description="Feeder industri" },
            new WireStandard { Id=9,  CrossSectionMm2=50,   MaxAmpere=134, PricePerMeterEterna=122000, PricePerMeterSupreme=135000, Description="Feeder utama" },
            new WireStandard { Id=10, CrossSectionMm2=70,   MaxAmpere=171, PricePerMeterEterna=168000, PricePerMeterSupreme=185000, Description="Panel utama gedung" },
            new WireStandard { Id=11, CrossSectionMm2=95,   MaxAmpere=207, PricePerMeterEterna=228000, PricePerMeterSupreme=250000, Description="Trafo kecil" },
            new WireStandard { Id=12, CrossSectionMm2=120,  MaxAmpere=239, PricePerMeterEterna=288000, PricePerMeterSupreme=316000, Description="Kapasitas besar" }
        );
    }
}
