/**
 * ElectraCalc — script.js
 * ─────────────────────────────────────────────────────────────────
 * Frontend logic: DOM manipulation, electrical calculations,
 * Chart.js visualisation, PDF export, dark/light mode toggle.
 *
 * Architecture:
 *   1. CONSTANTS & PUIL TABLES  — wire sizes, MCB ratings, prices
 *   2. STATE                    — reactive app state object
 *   3. DOM HELPERS              — query shortcuts & toast system
 *   4. THEME                    — dark/light toggle
 *   5. APPLIANCE ROWS           — dynamic add/remove rows
 *   6. CALCULATION ENGINE       — pure electrical formulae
 *   7. RESULT RENDERER          — injects calculated values to DOM
 *   8. CHART.JS                 — doughnut & bar charts
 *   9. PDF EXPORT               — jsPDF report generation
 *  10. API INTEGRATION          — optional backend fetch
 *  11. INIT                     — event wiring & startup
 * ─────────────────────────────────────────────────────────────────
 */

/* ══════════════════════════════════════════════════════════════
   1. CONSTANTS & PUIL LOOKUP TABLES
   ══════════════════════════════════════════════════════════════ */

/**
 * PUIL 2011 wire capacity table (copper, PVC insulation, 1-phase).
 * Format: { mm2: maxAmpere }
 * Source: SNI 04-0225-2011 Tabel 5.6-1
 */
const WIRE_TABLE = [
  { mm2: 1.5,   ampere: 16,   pricePerMeter: { eterna: 4500,  supreme: 5000  } },
  { mm2: 2.5,   ampere: 21,   pricePerMeter: { eterna: 6500,  supreme: 7200  } },
  { mm2: 4,     ampere: 28,   pricePerMeter: { eterna: 10500, supreme: 11500 } },
  { mm2: 6,     ampere: 36,   pricePerMeter: { eterna: 15000, supreme: 16500 } },
  { mm2: 10,    ampere: 50,   pricePerMeter: { eterna: 24000, supreme: 26500 } },
  { mm2: 16,    ampere: 68,   pricePerMeter: { eterna: 38000, supreme: 42000 } },
  { mm2: 25,    ampere: 89,   pricePerMeter: { eterna: 62000, supreme: 68000 } },
  { mm2: 35,    ampere: 111,  pricePerMeter: { eterna: 86000, supreme: 94000 } },
  { mm2: 50,    ampere: 134,  pricePerMeter: { eterna: 122000,supreme: 135000} },
  { mm2: 70,    ampere: 171,  pricePerMeter: { eterna: 168000,supreme: 185000} },
  { mm2: 95,    ampere: 207,  pricePerMeter: { eterna: 228000,supreme: 250000} },
  { mm2: 120,   ampere: 239,  pricePerMeter: { eterna: 288000,supreme: 316000} },
];

/** Aluminum derating factor vs copper */
const ALUMINUM_FACTOR = 0.78;

/**
 * Standard MCB ratings (A) per IEC 60898-1
 */
const MCB_RATINGS = [2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];

/** Copper resistivity ρ (Ω·mm²/m) */
const RESISTIVITY = { copper: 0.01724, aluminum: 0.02826 };

/** Safety factor per PUIL 2011 Pasal 7.3 */
const SAFETY_FACTOR = 1.25;

/** Maximum allowable voltage drop percentage per PUIL */
const MAX_VDROP_PCT = 5.0;

/* ══════════════════════════════════════════════════════════════
   2. APPLICATION STATE
   ══════════════════════════════════════════════════════════════ */
let state = {
  appliances: [],         // [{ name, watt, qty, hours }]
  lastResult: null,       // last calculation result object
  chartInstance: null,    // Chart.js instance
  chartType: 'doughnut',  // 'doughnut' | 'bar'
  rowIdCounter: 0,
};

/* ══════════════════════════════════════════════════════════════
   3. DOM HELPERS
   ══════════════════════════════════════════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'success'|'warn'|'error'} type
 */
function showToast(message, type = 'success') {
  const icons = { success: '✅', warn: '⚠️', error: '❌' };
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--leaving');
    el.addEventListener('animationend', () => el.remove());
  }, 3000);
}

/** Animate a number counting up */
function animateValue(el, from, to, duration = 600, decimals = 1) {
  const start = performance.now();
  const update = (time) => {
    const elapsed = Math.min((time - start) / duration, 1);
    const ease = 1 - Math.pow(1 - elapsed, 3); // ease-out cubic
    const val = from + (to - from) * ease;
    el.textContent = val.toFixed(decimals);
    if (elapsed < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

/** Format number as Indonesian Rupiah */
function formatRupiah(num) {
  return 'Rp ' + num.toLocaleString('id-ID');
}

/* ══════════════════════════════════════════════════════════════
   4. THEME TOGGLE
   ══════════════════════════════════════════════════════════════ */
function initTheme() {
  const btn = $('#themeToggle');
  const html = document.documentElement;

  // Restore saved preference
  const saved = localStorage.getItem('electra-theme') || 'dark';
  html.setAttribute('data-theme', saved);

  btn.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('electra-theme', next);

    // Re-render chart with new colors after transition
    if (state.chartInstance) {
      setTimeout(renderChart, 250);
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   5. APPLIANCE ROW MANAGEMENT
   ══════════════════════════════════════════════════════════════ */

/**
 * Create a new appliance row element.
 * @param {string} name   - Pre-filled name
 * @param {number} watt   - Pre-filled wattage
 */
function createRow(name = '', watt = '') {
  const id = ++state.rowIdCounter;
  const row = document.createElement('div');
  row.className = 'appliance-row';
  row.dataset.id = id;
  row.setAttribute('role', 'listitem');
  row.innerHTML = `
    <input
      type="text"
      class="field-input row-name"
      placeholder="Nama alat"
      value="${name}"
      aria-label="Nama peralatan"
    />
    <input
      type="number"
      class="field-input row-watt"
      placeholder="Watt"
      value="${watt}"
      min="1"
      max="100000"
      aria-label="Daya watt"
    />
    <input
      type="number"
      class="field-input row-qty"
      placeholder="1"
      value="1"
      min="1"
      max="100"
      aria-label="Jumlah unit"
    />
    <input
      type="number"
      class="field-input row-hours"
      placeholder="Jam"
      value="8"
      min="0.5"
      max="24"
      step="0.5"
      aria-label="Jam pemakaian per hari"
    />
    <button class="row-delete" data-id="${id}" aria-label="Hapus baris" title="Hapus">✕</button>
  `;

  // Micro-interaction: highlight input on change
  row.querySelectorAll('.field-input').forEach((input) => {
    input.addEventListener('input', () => {
      input.style.borderColor = 'var(--col-accent)';
      clearTimeout(input._timer);
      input._timer = setTimeout(() => {
        input.style.borderColor = '';
      }, 800);
    });
  });

  return row;
}

function addRow(name = '', watt = '') {
  const list = $('#applianceList');
  const row = createRow(name, watt);
  list.appendChild(row);
}

function deleteRow(id) {
  const row = document.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  row.style.animation = 'none';
  row.style.transition = 'all 0.2s ease';
  row.style.opacity = '0';
  row.style.transform = 'translateX(20px)';
  setTimeout(() => row.remove(), 200);
}

/** Collect all appliance rows into an array of objects */
function collectAppliances() {
  const rows = $$('.appliance-row');
  return rows
    .map((row) => ({
      name:  row.querySelector('.row-name')?.value.trim()  || 'Tidak diketahui',
      watt:  parseFloat(row.querySelector('.row-watt')?.value)  || 0,
      qty:   parseInt(row.querySelector('.row-qty')?.value)     || 1,
      hours: parseFloat(row.querySelector('.row-hours')?.value) || 0,
    }))
    .filter((a) => a.watt > 0);
}

/* ══════════════════════════════════════════════════════════════
   6. CALCULATION ENGINE
   ══════════════════════════════════════════════════════════════ */

/**
 * Main calculation function — pure logic, no DOM side effects.
 * @param {Array}   appliances  - [{name, watt, qty, hours}]
 * @param {number}  voltage     - system voltage (V)
 * @param {number}  cableLength - one-way cable length (m)
 * @param {string}  material    - 'copper' | 'aluminum'
 * @param {string}  phase       - 'single' | 'three'
 * @returns {Object} result
 */
function calculate(appliances, voltage, cableLength, material, phase) {
  /* ── Total Power ───────────────────────────────────────── */
  const totalWatt = appliances.reduce((sum, a) => sum + a.watt * a.qty, 0);

  /* ── Current: I = P / V  (single phase)
         I = P / (√3 × V × PF)  (three phase, PF=0.9) ─── */
  let current;
  if (phase === 'single') {
    current = totalWatt / voltage;                     // I = P/V
  } else {
    current = totalWatt / (Math.sqrt(3) * voltage * 0.9);
  }

  /* ── Design current with safety factor (PUIL 125%) ────── */
  const currentSafe = current * SAFETY_FACTOR;

  /* ── Wire sizing ───────────────────────────────────────── */
  // Apply aluminium derating if needed
  const effFactor = material === 'aluminum' ? ALUMINUM_FACTOR : 1.0;
  const wire = WIRE_TABLE.find((w) => w.ampere * effFactor >= currentSafe);
  const selectedWire = wire || WIRE_TABLE[WIRE_TABLE.length - 1]; // largest if none fits

  /* ── Voltage Drop: ΔV = (2 × ρ × L × I) / A ──────────── */
  // For 3-phase, multiply by √3
  const rho   = RESISTIVITY[material];
  const phaseMult = phase === 'three' ? Math.sqrt(3) : 2;
  const deltaV = (phaseMult * rho * cableLength * current) / selectedWire.mm2;
  const vdropPct = (deltaV / voltage) * 100;

  /* ── MCB recommendation ────────────────────────────────── */
  const mcb = MCB_RATINGS.find((r) => r >= currentSafe);

  /* ── Cost estimation (Eterna & Supreme) ───────────────── */
  // Full circuit = 3 conductors (L + N + PE) for single phase
  const conductors = phase === 'single' ? 3 : 4;
  const costEterna  = selectedWire.pricePerMeter.eterna  * cableLength * conductors;
  const costSupreme = selectedWire.pricePerMeter.supreme * cableLength * conductors;

  /* ── Safety classification ─────────────────────────────── */
  // Based on vdrop and load percentage vs wire capacity
  const wireCapacity = selectedWire.ampere * effFactor;
  const loadRatio    = currentSafe / wireCapacity;
  let safetyStatus;
  if (vdropPct > MAX_VDROP_PCT || loadRatio > 0.95) {
    safetyStatus = 'danger';
  } else if (vdropPct > MAX_VDROP_PCT * 0.7 || loadRatio > 0.80) {
    safetyStatus = 'warn';
  } else {
    safetyStatus = 'safe';
  }

  /* ── Per-appliance enrichment ──────────────────────────── */
  const enrichedAppliances = appliances.map((a) => ({
    ...a,
    totalWatt:  a.watt * a.qty,
    kwhPerDay:  (a.watt * a.qty * a.hours) / 1000,
    percentage: ((a.watt * a.qty) / totalWatt) * 100,
  }));

  return {
    totalWatt,
    current:      parseFloat(current.toFixed(2)),
    currentSafe:  parseFloat(currentSafe.toFixed(2)),
    wire:         selectedWire,
    wireCapacity: parseFloat(wireCapacity.toFixed(1)),
    deltaV:       parseFloat(deltaV.toFixed(2)),
    vdropPct:     parseFloat(vdropPct.toFixed(2)),
    mcb:          mcb || 125,
    costEterna,
    costSupreme,
    safetyStatus,
    material,
    phase,
    voltage,
    cableLength,
    appliances:   enrichedAppliances,
  };
}

/* ══════════════════════════════════════════════════════════════
   7. RESULT RENDERER
   ══════════════════════════════════════════════════════════════ */
function renderResults(r) {
  const safetyMap = {
    safe:   { icon: '✅', title: 'Instalasi Aman',        desc: 'Beban dalam batas aman. Voltage drop dan kapasitas kabel sesuai standar PUIL 2011.', badge: 'AMAN' },
    warn:   { icon: '⚠️', title: 'Mendekati Batas Limit', desc: 'Perhatian! Beban mendekati kapasitas maksimum atau voltage drop cukup tinggi. Pertimbangkan upgrade kabel.', badge: 'PERHATIAN' },
    danger: { icon: '🚨', title: 'BAHAYA — Risiko Korsleting!', desc: 'Beban melebihi batas aman. WAJIB upgrade ukuran kabel atau perbesar kapasitas daya!', badge: 'BAHAYA' },
  };

  /* ── Safety banner ───────────────────────────────────────── */
  const s = safetyMap[r.safetyStatus];
  const banner = $('#safetyBanner');
  banner.className = `safety-banner ${r.safetyStatus}`;
  $('#safetyIcon').textContent  = s.icon;
  $('#safetyTitle').textContent = s.title;
  $('#safetyDesc').textContent  = s.desc;
  $('#safetyBadge').textContent = s.badge;

  /* ── Metrics ─────────────────────────────────────────────── */
  animateValue($('#metricPower'),       0, r.totalWatt,     600, 0);
  animateValue($('#metricCurrent'),     0, r.current,       600, 2);
  animateValue($('#metricCurrentSafe'), 0, r.currentSafe,   600, 2);
  animateValue($('#metricVdrop'),       0, r.vdropPct,      600, 2);

  /* ── Recommendations ─────────────────────────────────────── */
  const matLabel = r.material === 'copper' ? 'Cu (Tembaga)' : 'Al (Aluminium)';
  $('#recWire').textContent     = `${r.wire.mm2} mm²`;
  $('#recWireNote').textContent = `Kapasitas ${r.wireCapacity}A · ${matLabel} · PUIL SNI 04-0225-2011`;
  $('#recMCB').textContent      = `${r.mcb} A`;
  $('#recMCBNote').textContent  = `Rating standar IEC 60898-1 · ≥ ${r.currentSafe}A (I×125%)`;
  $('#recCost').textContent     = formatRupiah(r.costEterna);
  $('#recCostNote').textContent = `Eterna / ${formatRupiah(r.costSupreme)} Supreme · ${r.cableLength}m × ${r.phase === 'single' ? 3 : 4} konduktor`;

  /* ── Voltage drop bar ────────────────────────────────────── */
  const vdropPct = Math.min(r.vdropPct, 10);   // cap bar at 10%
  const fillPct  = (vdropPct / 10) * 100;
  const fill     = $('#vdropBarFill');
  fill.style.width      = fillPct + '%';
  fill.style.background = r.safetyStatus === 'safe'   ? 'var(--col-safe)'
                        : r.safetyStatus === 'warn'   ? 'var(--col-warn)'
                        : 'var(--col-danger)';

  $('#vdropDetail').innerHTML = `
    <strong>ΔV = ${r.deltaV} V</strong> (${r.vdropPct}% dari ${r.voltage}V) ·
    Panjang kabel: <strong>${r.cableLength}m</strong> ·
    Batas PUIL: <strong>${MAX_VDROP_PCT}%</strong>
    ${r.vdropPct > MAX_VDROP_PCT
      ? `<br/>⚠️ Voltage drop <strong>melebihi batas ${MAX_VDROP_PCT}%</strong>!
         Solusi: gunakan kabel yang lebih besar atau perbesar penampang.`
      : `<br/>✅ Voltage drop dalam batas aman PUIL 2011.`
    }
  `;

  /* ── Result table ────────────────────────────────────────── */
  const tbody = $('#resultTableBody');
  tbody.innerHTML = '';
  r.appliances.forEach((a) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a.name}</td>
      <td>${a.watt} W</td>
      <td>${a.qty}</td>
      <td><strong>${a.totalWatt} W</strong></td>
      <td>${a.kwhPerDay.toFixed(2)} kWh</td>
      <td>
        <div class="pct-bar">
          <div class="pct-track">
            <div class="pct-fill" style="width:${a.percentage.toFixed(1)}%"></div>
          </div>
          <span>${a.percentage.toFixed(1)}%</span>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  /* ── Voltage badge update ────────────────────────────────── */
  $('#voltageLabel').textContent = `${r.voltage}V ${r.phase === 'single' ? '1Ø' : '3Ø'}`;

  /* ── Reveal results panel ────────────────────────────────── */
  $('#emptyState').hidden    = true;
  $('#resultsContainer').hidden = false;
}

/* ══════════════════════════════════════════════════════════════
   8. CHART.JS
   ══════════════════════════════════════════════════════════════ */

/**
 * Determine if dark mode is active.
 */
function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/**
 * Palette generator for chart slices.
 */
function chartColors(count) {
  const base = [
    '#f5c518','#22c55e','#38bdf8','#a78bfa',
    '#fb923c','#f43f5e','#34d399','#818cf8',
    '#fbbf24','#4ade80','#60a5fa','#c084fc',
  ];
  return Array.from({ length: count }, (_, i) => base[i % base.length]);
}

function renderChart() {
  if (!state.lastResult) return;

  const r      = state.lastResult;
  const labels = r.appliances.map((a) => `${a.name} (${a.totalWatt}W)`);
  const data   = r.appliances.map((a) => a.totalWatt);
  const colors = chartColors(data.length);
  const dark   = isDark();

  const textColor  = dark ? '#7a7e8a' : '#6b7280';
  const gridColor  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const ctx = $('#loadChart').getContext('2d');

  // Destroy existing chart before re-creating
  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 700, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        position: state.chartType === 'doughnut' ? 'right' : 'top',
        labels: {
          color: textColor,
          font: { family: "'DM Sans', sans-serif", size: 11 },
          boxWidth: 12,
          padding: 12,
        },
      },
      tooltip: {
        backgroundColor: dark ? '#1a1d28' : '#ffffff',
        titleColor: dark ? '#e8eaf0' : '#1a1d28',
        bodyColor: textColor,
        borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
        callbacks: {
          label: (ctx) => ` ${ctx.parsed || ctx.parsed.y || 0} W (${
            ((( ctx.parsed || ctx.raw) / r.totalWatt) * 100).toFixed(1)
          }%)`,
        },
      },
    },
  };

  if (state.chartType === 'doughnut') {
    state.chartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: dark ? '#13161e' : '#ffffff', hoverOffset: 6 }] },
      options: {
        ...commonOptions,
        cutout: '62%',
        plugins: {
          ...commonOptions.plugins,
          legend: { ...commonOptions.plugins.legend, position: 'right' },
        },
      },
    });
  } else {
    state.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Beban (Watt)', data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
      options: {
        ...commonOptions,
        indexAxis: 'y',
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 11 } },
            grid:  { color: gridColor },
          },
          y: {
            ticks: { color: textColor, font: { size: 11 } },
            grid:  { display: false },
          },
        },
      },
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   9. PDF EXPORT (jsPDF + autoTable)
   ══════════════════════════════════════════════════════════════ */
function exportPDF() {
  if (!state.lastResult) {
    showToast('Laporan belum tersedia. Silakan klik "Hitung Sekarang" terlebih dahulu.', 'warn');
    return;
  }

  // Pastikan library jsPDF tersedia
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    showToast('Library PDF gagal dimuat. Pastikan koneksi internet aktif.', 'error');
    return;
  }

  const r = state.lastResult;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const now = new Date().toLocaleString('id-ID');

  const MARGIN = 15;
  const W      = 210 - MARGIN * 2;
  let   y      = MARGIN;

  /* ── Header ──────────────────────────────────────────────── */
  doc.setFillColor(245, 197, 24); // Warna kuning ElectraCalc
  doc.rect(0, 0, 210, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(12, 14, 19);
  doc.text('LAPORAN ANALISIS BEBAN LISTRIK', MARGIN, 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('ElectraCalc — PUIL 2011 Wire Sizing Tool', 210 - MARGIN, 14, { align: 'right' });
  y = 30;

  /* ── Metadata & Status ───────────────────────────────────── */
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Dicetak pada: ${now}`, MARGIN, y);
  doc.text(`Parameter: ${r.voltage}V | ${r.phase === 'single' ? '1 Fasa' : '3 Fasa'} | ${r.cableLength}m | ${r.material === 'copper' ? 'Tembaga' : 'Aluminium'}`, MARGIN, y + 6);
  y += 16;

 /* ── Status Keamanan (Versi Perbaikan Teks) ──────────────── */
  const statusColors = { 
    safe: [34, 197, 94], 
    warn: [245, 158, 11], 
    danger: [239, 68, 68] 
  };
  
  // Gunakan teks polos saja agar tidak terjadi error encoding/font
  const statusLabel = { 
    safe: 'STATUS: AMAN', 
    warn: 'STATUS: PERHATIAN', 
    danger: 'STATUS: BAHAYA' 
  };
  
  const currentColor = statusColors[r.safetyStatus] || statusColors.safe;
  
  // 1. Gambar kotaknya dulu
  doc.setFillColor(currentColor[0], currentColor[1], currentColor[2]);
  doc.roundedRect(MARGIN, y, W, 10, 2, 2, 'F');
  
  // 2. Reset setting teks agar tidak mewarisi sisa buffer fillColor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255); // Putih murni
  
  // 3. Tambahkan sedikit offset manual agar teks benar-benar di tengah kotak
  const labelText = statusLabel[r.safetyStatus];
  doc.text(labelText, MARGIN + 5, y + 6.5); 
  
  y += 18;

  /* ── Tabel Ringkasan ─────────────────────────────────────── */
  doc.setTextColor(30, 30, 30);
  doc.text('Ringkasan Perhitungan', MARGIN, y);
  
  doc.autoTable({
    startY: y + 2,
    head: [['Parameter', 'Nilai', 'Keterangan']],
    body: [
      ['Total Beban',            `${r.totalWatt} W`,              'Total daya semua alat'],
      ['Arus Nominal (I)',       `${r.current} A`,                'Arus beban penuh'],
      ['Arus Design (I x 125%)', `${r.currentSafe} A`,            'Safety Factor PUIL'],
      ['Ukuran Kabel',           `${r.wire.mm2} mm²`,             `Kapasitas hantar: ${r.wireCapacity}A`],
      ['Rekomendasi MCB',        `${r.mcb} A`,                    'Proteksi arus lebih'],
      ['Voltage Drop',           `${r.vdropPct}%`,                `Batas Maksimum: 5%`],
      ['Estimasi Biaya Kabel',   formatRupiah(r.costEterna),      'Berdasarkan harga pasar']
    ],
    theme: 'grid',
    headStyles: { fillColor: [12, 14, 19], textColor: [245, 197, 24] },
    margin: { left: MARGIN, right: MARGIN }
  });

  /* ── Tabel Daftar Alat ───────────────────────────────────── */
  y = doc.lastAutoTable.finalY + 10;
  doc.text('Daftar Peralatan', MARGIN, y);

  doc.autoTable({
    startY: y + 2,
    head: [['Nama Alat', 'Daya', 'Qty', 'Total', 'kWh/Hari']],
    body: r.appliances.map(a => [
      a.name, 
      `${a.watt}W`, 
      a.qty, 
      `${a.totalWatt}W`, 
      a.kwhPerDay.toFixed(2)
    ]),
    theme: 'striped',
    headStyles: { fillColor: [12, 14, 19], textColor: [245, 197, 24] },
    margin: { left: MARGIN, right: MARGIN }
  });

  /* ── Footer ──────────────────────────────────────────────── */
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(150);
  doc.text('Catatan: Perhitungan berdasarkan standar PUIL 2011 (SNI 04-0225-2011).', MARGIN, 285);

  /* ── Simpan ──────────────────────────────────────────────── */
  doc.save(`Laporan_ElectraCalc_${r.totalWatt}W.pdf`);
  showToast('Laporan PDF berhasil diunduh!', 'success');
}

/* ══════════════════════════════════════════════════════════════
   10. OPTIONAL API INTEGRATION (ASP.NET Core Backend)
       Comment out if running purely frontend.
   ══════════════════════════════════════════════════════════════ */

/**
 * Send calculation data to ASP.NET Core backend.
 * Endpoint: POST /api/calculator/calculate
 *
 * The backend validates and re-calculates, then returns the same
 * result shape with additional database-driven wire prices.
 *
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
async function fetchFromBackend(payload) {
  const API_BASE = window.ELECTRA_API_URL || 'https://localhost:5000';
  try {
    const res = await fetch(`${API_BASE}/api/calculator/calculate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Backend unavailable — fall back to frontend calculation silently
    console.warn('[ElectraCalc] Backend unavailable, using client-side calculation.', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   11. INIT — EVENT WIRING
   ══════════════════════════════════════════════════════════════ */
function initDefaultRows() {
  // Seed with common appliances for demo purposes
  const defaults = [
    { name: 'Lampu LED', watt: 10 },
    { name: 'TV 43"',    watt: 120 },
    { name: 'Kulkas',    watt: 150 },
  ];
  defaults.forEach((d) => addRow(d.name, d.watt));
}

async function handleCalculate() {
  const btn        = $('#calculateBtn');
  const appliances = collectAppliances();

  if (appliances.length === 0) {
    showToast('Tambahkan minimal satu peralatan listrik', 'warn');
    return;
  }

  const voltage     = parseFloat($('#systemVoltage').value) || 220;
  const cableLength = parseFloat($('#cableLength').value)   || 10;
  const material    = $('#cableMaterial').value;
  const phase       = $('#phaseSystem').value;

  /* ── Show loading state ───────────────────────────────────── */
  btn.classList.add('btn--loading');
  btn.disabled = true;

  $('#emptyState').hidden      = true;
  $('#resultsContainer').hidden = true;

  // Show skeleton
  const skeletonGroup = $('#skeletonGroup');
  skeletonGroup.removeAttribute('aria-hidden');
  skeletonGroup.style.display = 'flex';

  /* ── Try backend, fallback to frontend calculation ────────── */
  await new Promise((r) => setTimeout(r, 600)); // brief pause for UX skeleton

  const payload = { appliances, voltage, cableLength, material, phase };
  const backendResult = await fetchFromBackend(payload);

  // Use backend result if available, else compute locally
  const result = backendResult || calculate(appliances, voltage, cableLength, material, phase);
  state.lastResult = result;

  /* ── Hide skeleton ────────────────────────────────────────── */
  skeletonGroup.setAttribute('aria-hidden', 'true');
  skeletonGroup.style.display = 'none';

  /* ── Render ───────────────────────────────────────────────── */
  renderResults(result);
  renderChart();

  /* ── Toast feedback ───────────────────────────────────────── */
  const toastMap = {
    safe:   ['Instalasi listrik aman! ✅', 'success'],
    warn:   ['Perhatian: mendekati batas kapasitas!', 'warn'],
    danger: ['BAHAYA: Risiko korsleting! Upgrade kabel segera!', 'error'],
  };
  const [msg, type] = toastMap[result.safetyStatus];
  showToast(msg, type);

  /* ── Restore button ───────────────────────────────────────── */
  btn.classList.remove('btn--loading');
  btn.disabled = false;

  /* ── Smooth scroll to results on mobile ──────────────────── */
  if (window.innerWidth < 860) {
    $('#resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function handleReset() {
  state.lastResult  = null;
  if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
  $('#emptyState').hidden       = false;
  $('#resultsContainer').hidden  = true;
  $('#resultTableBody').innerHTML = '';
  $$('.appliance-row').forEach((r) => r.remove());
  state.rowIdCounter = 0;
  initDefaultRows();
  showToast('Data direset', 'success');
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDefaultRows();

  /* ── Add row button ─────────────────────────────────────── */
  $('#addRowBtn').addEventListener('click', () => {
    addRow();
    // Focus last name input
    const rows = $$('.appliance-row');
    rows.at(-1)?.querySelector('.row-name')?.focus();
  });

  /* ── Delete row (event delegation) ──────────────────────── */
  $('#applianceList').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-delete');
    if (btn) deleteRow(btn.dataset.id);
  });

  /* ── Preset chips ───────────────────────────────────────── */
  $('#presetChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    addRow(chip.dataset.name, chip.dataset.watt);
    showToast(`${chip.dataset.name} ditambahkan`, 'success');
  });

  /* ── Calculate button ───────────────────────────────────── */
  $('#calculateBtn').addEventListener('click', handleCalculate);

  /* ── Allow Enter key to calculate ──────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) handleCalculate();
  });

  /* ── Chart tab switcher ─────────────────────────────────── */
  document.querySelectorAll('.chart-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.chartType = tab.dataset.chart;
      if (state.lastResult) renderChart();
    });
  });

  /* ── Export PDF ─────────────────────────────────────────── */
  $('#exportPdfBtn').addEventListener('click', exportPDF);

  /* ── Reset ──────────────────────────────────────────────── */
  $('#resetBtn').addEventListener('click', () => {
    if (confirm('Reset semua data?')) handleReset();
  });

  /* ── Voltage input live sync with badge ─────────────────── */
  $('#systemVoltage').addEventListener('input', (e) => {
    const v = e.target.value || '220';
    const phase = $('#phaseSystem').value === 'single' ? '1Ø' : '3Ø';
    $('#voltageLabel').textContent = `${v}V ${phase}`;
  });
  $('#phaseSystem').addEventListener('change', (e) => {
    const v = $('#systemVoltage').value || '220';
    $('#voltageLabel').textContent = `${v}V ${e.target.value === 'single' ? '1Ø' : '3Ø'}`;
  });
});
