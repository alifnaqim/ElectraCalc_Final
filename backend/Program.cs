// ═══════════════════════════════════════════════════════════════
// ElectraCalc — Program.cs
// ASP.NET Core 8 minimal hosting model
// ═══════════════════════════════════════════════════════════════
using ElectraCalc.Controllers;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using System.Reflection;

var builder = WebApplication.CreateBuilder(args);

// ── Services ───────────────────────────────────────────────────

builder.Services.AddControllers();

// Swagger / OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title       = "ElectraCalc API",
        Version     = "v1",
        Description = "REST API untuk kalkulasi beban listrik dan ukuran kabel berbasis PUIL 2011. " +
                      "Tugas Akhir Teknik Elektro.",
        Contact     = new OpenApiContact { Name = "Teknik Elektro", Email = "elektro@kampus.ac.id" },
        License     = new OpenApiLicense { Name = "MIT" },
    });
    // Include XML comments in Swagger (enable in .csproj)
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath)) c.IncludeXmlComments(xmlPath);
});

// Database — SQLite for development, swap to SQL Server for production
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=electracalc.db";

builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlite(connectionString));

// Register service
builder.Services.AddScoped<ICalculatorService, CalculatorService>();

// CORS — allow frontend origins
builder.Services.AddCors(opt =>
    opt.AddPolicy("AllowFrontend", policy =>
        policy
            .WithOrigins(
                "http://localhost:5500",    // VS Code Live Server
                "http://127.0.0.1:5500",
                "http://localhost:3000",    // React dev server
                "https://your-frontend.vercel.app"  // Production Vercel URL
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
    )
);

var app = builder.Build();

// ── Middleware pipeline ────────────────────────────────────────

// Auto-migrate on startup (safe for SQLite/development)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "ElectraCalc API v1");
        c.RoutePrefix   = "swagger";
        c.DocumentTitle = "ElectraCalc API Docs";
    });
}

app.UseHttpsRedirection();
app.UseCors("AllowFrontend");
app.UseAuthorization();
app.MapControllers();

app.Run();
