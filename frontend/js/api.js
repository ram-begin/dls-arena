// ── API HELPER ────────────────────────────────────────────
const API = {
  base: '/api',

  _headers() {
    const token = localStorage.getItem('dls_token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },

  async get(path) {
    const r = await fetch(this.base + path, { headers: this._headers() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async post(path, body) {
    const r = await fetch(this.base + path, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async put(path, body) {
    const r = await fetch(this.base + path, {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async delete(path) {
    const r = await fetch(this.base + path, { method: 'DELETE', headers: this._headers() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async upload(path, formData) {
    const token = localStorage.getItem('dls_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(this.base + path, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data;
  }
};

// ── AUTH HELPERS ──────────────────────────────────────────
function getUser() {
  try { return JSON.parse(localStorage.getItem('dls_user') || 'null'); } catch { return null; }
}

function requireAuth() {
  const token = localStorage.getItem('dls_token');
  if (!token) { window.location.href = '/auth.html'; return null; }
  return getUser();
}

function requireAdmin() {
  const token = localStorage.getItem('dls_token');
  if (!token) { window.location.href = '/admin-login.html'; return null; }
  const user = getUser();
  if (!user?.is_admin || !user?.admin_verified) {
    window.location.href = '/admin-login.html'; return null;
  }
  return user;
}

function requirePlayer() {
  const token = localStorage.getItem('dls_token');
  if (!token) { window.location.href = '/auth.html'; return null; }
  return getUser();
}

// ── UTILITIES ─────────────────────────────────────────────
// Fix #1: Escape HTML to prevent XSS injection
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// Fix #4: Add auth token to upload URLs so protected /uploads/ works
function uploadUrl(path) {
  if (!path) return '';
  const token = localStorage.getItem('dls_token');
  return token ? `${path}?token=${token}` : path;
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── SHARED LOGOUT — blacklists token server-side (Fix #2) ─
async function performLogout(redirectUrl = '/') {
  try { await API.post('/auth/logout', {}); } catch(e) {}
  localStorage.removeItem('dls_token');
  localStorage.removeItem('dls_user');
  window.location.href = redirectUrl;
}

function switchTab(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('tab-' + name);
  if (page) page.classList.add('active');
  if (btn)  btn.classList.add('active');
  // Remove notification dot when tab is opened
  if (btn) { const dot = btn.querySelector('.tab-dot'); if (dot) dot.remove(); }
  if (typeof renderPage === 'function') renderPage(name);
}