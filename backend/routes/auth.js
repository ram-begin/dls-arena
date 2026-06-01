require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PIN  = process.env.ADMIN_PIN;

// Safety check — refuse to start if secrets not set
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('❌  JWT_SECRET not set or too short in .env — please set a long random string');
  process.exit(1);
}
if (!ADMIN_PIN || ADMIN_PIN.length < 4) {
  console.error('❌  ADMIN_PIN not set in .env — please set a PIN of at least 4 digits');
  process.exit(1);
}

// ── ADMIN LOGIN LOCKOUT ───────────────────────────────────
// Track failed admin login attempts per IP in memory
const adminFailedAttempts = {};
const MAX_ADMIN_ATTEMPTS  = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function checkAdminLockout(ip) {
  const record = adminFailedAttempts[ip];
  if (!record) return null;
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const minsLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return `Too many failed attempts. Locked for ${minsLeft} more minute(s).`;
  }
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    delete adminFailedAttempts[ip]; // Reset after lockout expires
  }
  return null;
}

function recordAdminFailure(ip) {
  if (!adminFailedAttempts[ip]) adminFailedAttempts[ip] = { count: 0 };
  adminFailedAttempts[ip].count++;
  if (adminFailedAttempts[ip].count >= MAX_ADMIN_ATTEMPTS) {
    adminFailedAttempts[ip].lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`⚠️  Admin login locked for IP ${ip} after ${MAX_ADMIN_ATTEMPTS} failed attempts`);
  }
}

function clearAdminFailure(ip) {
  delete adminFailedAttempts[ip];
}

// Middleware: verify JWT + check blacklist (Fix #2)
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.split(' ')[1];
  // Check if token was invalidated on logout
  if (db.isTokenBlacklisted(token)) return res.status(401).json({ error: 'Token revoked. Please login again.' });
  try {
    req.user  = jwt.verify(token, JWT_SECRET);
    req.token = token;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware: admin only
function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}



// ── LOGOUT — blacklist the token (Fix #2) ─────────────────
router.post('/logout', auth, (req, res) => {
  db.blacklistToken(req.token);
  res.json({ ok: true });
});

// ── REGISTER ─────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.get('users').find({ email: email.toLowerCase().trim() }).value())
    return res.status(409).json({ error: 'Email already registered' });

  const user = {
    id: uuid(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: bcrypt.hashSync(password, 10),
    is_admin: false,
    created_at: new Date().toISOString()
  };
  db.get('users').push(user).write();

  const payload = { id: user.id, name: user.name, email: user.email, is_admin: false };
  res.status(201).json({ token: jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }), user: payload });
});

// ── PLAYER LOGIN ──────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'All fields required' });
  const user = db.get('users').find({ email: email.toLowerCase().trim() }).value();
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  if (user.is_admin) return res.status(403).json({ error: 'Use the admin login page' });
  if (user.blocked) return res.status(403).json({ error: 'Your account has been blocked. Contact admin.' });
  const payload = { id: user.id, name: user.name, email: user.email, is_admin: false };
  res.json({ token: jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }), user: payload });
});

// ── ADMIN LOGIN (email + password + PIN) ──────────────────
router.post('/admin-login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const lockMsg = checkAdminLockout(ip);
  if (lockMsg) return res.status(429).json({ error: lockMsg });

  const { email, password, pin } = req.body;
  if (!email || !password || !pin) return res.status(400).json({ error: 'All fields required' });

  if (pin !== ADMIN_PIN) {
    recordAdminFailure(ip);
    const remaining = MAX_ADMIN_ATTEMPTS - (adminFailedAttempts[ip]?.count || 0);
    return res.status(401).json({ error: `Invalid admin PIN. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Account locked for 30 minutes.'}` });
  }

  const user = db.get('users').find({ email: email.toLowerCase().trim() }).value();
  if (!user || !bcrypt.compareSync(password, user.password)) {
    recordAdminFailure(ip);
    const remaining = MAX_ADMIN_ATTEMPTS - (adminFailedAttempts[ip]?.count || 0);
    return res.status(401).json({ error: `Invalid email or password. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Account locked for 30 minutes.'}` });
  }
  if (!user.is_admin) return res.status(403).json({ error: 'Not an admin account' });

  clearAdminFailure(ip);
  const payload = { id: user.id, name: user.name, email: user.email, is_admin: true, admin_verified: true };
  res.json({ token: jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }), user: payload });
});

// ── SEED ADMIN (run once on first start) ─────────────────
(function seedAdmin() {
  const exists = db.get('users').find({ email: 'admin@dlsarena.com' }).value();
  if (!exists) {
    db.get('users').push({
      id: uuid(),
      name: 'Admin',
      email: 'admin@dlsarena.com',
      password: bcrypt.hashSync('dls2026', 10),
      is_admin: true,
      created_at: new Date().toISOString()
    }).write();
    console.log('✅  Admin account seeded');
  }
})();
// REQUEST password reset (player submits request)
router.post('/reset-request', (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) return res.status(400).json({ error: 'Email and phone required' });
  const user = db.get('users').find({ email: email.toLowerCase().trim() }).value();
  if (!user) return res.status(404).json({ error: 'No account found with this email' });
  // Check phone matches any registration
  const hasPhone = db.get('registrations').find({ user_id: user.id, phone: phone.replace(/\D/g,'') }).value();
  if (!hasPhone) return res.status(400).json({ error: 'Phone number does not match our records for this account' });

  // Store reset request
  const existing = db.get('reset_requests').find({ user_id: user.id, status: 'pending' });
  if (existing.value()) return res.status(409).json({ error: 'Reset request already pending. Contact admin.' });

  db.get('reset_requests').push({
    id: uuid(),
    user_id:    user.id,
    user_name:  user.name,
    email:      user.email,
    phone:      phone.replace(/\D/g,''),
    status:     'pending',
    temp_password: null,
    requested_at: new Date().toISOString()
  }).write();
  res.json({ ok: true, message: 'Reset request submitted. Admin will contact you via WhatsApp with a temporary password.' });
});

// ADMIN: approve reset — generates temp password
router.put('/reset-request/:id/approve', auth, adminOnly, (req, res) => {
  const req2 = db.get('reset_requests').find({ id: req.params.id });
  if (!req2.value()) return res.status(404).json({ error: 'Not found' });
  const tempPw = Math.random().toString(36).slice(2, 10); // e.g. "x4k9m2qw"
  const hashed = bcrypt.hashSync(tempPw, 10);
  db.get('users').find({ id: req2.value().user_id }).assign({ password: hashed }).write();
  req2.assign({ status: 'approved', temp_password: tempPw, approved_at: new Date().toISOString() }).write();
  db.audit('PASSWORD_RESET', req.user.id, req.user.name, { player: req2.value().user_name });
  res.json({ ok: true, temp_password: tempPw });
});

// ADMIN: reject reset
router.put('/reset-request/:id/reject', auth, adminOnly, (req, res) => {
  const req2 = db.get('reset_requests').find({ id: req.params.id });
  if (!req2.value()) return res.status(404).json({ error: 'Not found' });
  req2.assign({ status: 'rejected' }).write();
  res.json({ ok: true });
});

// GET all reset requests (admin)
router.get('/reset-requests', auth, adminOnly, (req, res) => {
  res.json(db.get('reset_requests').value());
});



// ── USER MANAGEMENT ROUTES (admin) ───────────────────────

// GET all users
router.get('/users', auth, adminOnly, (req, res) => {
  const users = db.get('users')
    .map(x => ({ id: x.id, name: x.name, email: x.email, is_admin: x.is_admin, phone: x.phone, blocked: x.blocked, created_at: x.created_at }))
    .value();
  res.json(users);
});

// DELETE player
router.delete('/users/:id', auth, adminOnly, (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'Not found' });
  db.audit('DELETE_PLAYER', req.user.id, req.user.name, { deleted_player: target.name, email: target.email });
  db.get('users').remove({ id: req.params.id }).write();
  db.get('registrations').remove({ user_id: req.params.id }).write();
  res.json({ ok: true });
});

// BLOCK / UNBLOCK player
router.put('/users/:id/block', auth, adminOnly, (req, res) => {
  const target = db.get('users').find({ id: req.params.id });
  if (!target.value()) return res.status(404).json({ error: 'Not found' });
  const current = target.value().blocked;
  target.assign({ blocked: !current }).write();
  db.audit(current ? 'UNBLOCK_PLAYER' : 'BLOCK_PLAYER', req.user.id, req.user.name, { player: target.value().name });
  res.json({ ok: true, blocked: !current });
});

module.exports = router;
module.exports.auth      = auth;
module.exports.adminOnly = adminOnly;