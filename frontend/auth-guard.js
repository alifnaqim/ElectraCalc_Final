/**
 * auth-guard.js — ElectraCalc
 * ─────────────────────────────────────────────────────────────
 * Taruh script ini PERTAMA di <head> index.html.
 * Fungsi: cek apakah user sudah login via Google.
 * Jika belum → redirect ke login.html SEBELUM halaman dirender.
 * ─────────────────────────────────────────────────────────────
 */

(function authGuard() {
  const LOGIN_PAGE = 'login.html';

  // Ambil data user dari sessionStorage
  const raw = sessionStorage.getItem('electra_user');

  if (!raw) {
    // Belum login → redirect ke login
    window.location.replace(LOGIN_PAGE);
    return;
  }

  try {
    const user = JSON.parse(raw);

    // Validasi struktur data minimal
    if (!user.email || !user.loginAt) {
      sessionStorage.removeItem('electra_user');
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // Opsional: session expire setelah 8 jam
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    if (Date.now() - user.loginAt > EIGHT_HOURS) {
      sessionStorage.removeItem('electra_user');
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // ✅ User valid — inject info ke header aplikasi
    // Dijalankan setelah DOM siap
    document.addEventListener('DOMContentLoaded', function () {
      injectUserBadge(user);
    });

  } catch {
    sessionStorage.removeItem('electra_user');
    window.location.replace(LOGIN_PAGE);
  }

  /**
   * Sisipkan avatar + nama + tombol logout ke header ElectraCalc.
   */
  function injectUserBadge(user) {
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;

    const badge = document.createElement('div');
    badge.className = 'user-header-badge';
    badge.innerHTML = `
      <img
        src="${user.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=f5c518&color=0c0e13&size=32`}"
        alt="${user.name}"
        class="user-header-avatar"
        title="${user.name} · ${user.email}"
      />
      <span class="user-header-name">${user.name.split(' ')[0]}</span>
      <button class="user-logout-btn" onclick="logoutUser()" title="Keluar">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14">
          <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M13 15l4-5-4-5M17 10H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `;

    // Masukkan sebelum theme toggle
    const themeToggle = headerActions.querySelector('#themeToggle');
    headerActions.insertBefore(badge, themeToggle);

    // Tambah style badge (inline agar tidak perlu edit style.css)
    if (!document.getElementById('user-badge-style')) {
      const s = document.createElement('style');
      s.id = 'user-badge-style';
      s.textContent = `
        .user-header-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0.25rem 0.25rem 0.25rem;
          background: var(--col-surface-2);
          border: 1px solid var(--col-border-hi);
          border-radius: 999px;
        }
        .user-header-avatar {
          width: 28px; height: 28px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid var(--col-accent);
        }
        .user-header-name {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--col-text);
          padding-right: 0.25rem;
          max-width: 80px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .user-logout-btn {
          width: 26px; height: 26px;
          border-radius: 50%;
          background: transparent;
          border: none;
          display: grid;
          place-items: center;
          color: var(--col-text-muted);
          cursor: pointer;
          transition: all 0.18s;
          margin-right: 0.15rem;
        }
        .user-logout-btn:hover {
          background: var(--col-danger-bg);
          color: var(--col-danger);
        }
        @media (max-width: 480px) {
          .user-header-name { display: none; }
        }
      `;
      document.head.appendChild(s);
    }
  }
})();

/**
 * Logout — hapus session & kembali ke halaman login.
 * Dipanggil dari tombol logout di header.
 */
function logoutUser() {
  if (!confirm('Keluar dari ElectraCalc?')) return;

  // Revoke Google session (opsional, mencegah auto re-login)
  if (typeof google !== 'undefined' && google.accounts?.id) {
    const user = JSON.parse(sessionStorage.getItem('electra_user') || '{}');
    if (user.sub) {
      google.accounts.id.revoke(user.sub, () => {});
    }
    google.accounts.id.disableAutoSelect();
  }

  sessionStorage.removeItem('electra_user');
  window.location.replace('login.html');
}
