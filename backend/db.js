const low  = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs   = require('fs');

const DB_PATH     = path.join(__dirname, 'db.json');
const BACKUP_PATH = path.join(__dirname, 'db.backup.json');

const adapter = new FileSync(DB_PATH);
const db = low(adapter);

db.defaults({
  users:          [],
  tournaments:    [],
  registrations:  [],
  matches:        [],
  announcements:  [],
  refunds:        [],
  audit_log:      [],
  reset_requests: [],
  appeals:        []
}).write();

// ── WRITE QUEUE — prevents concurrent write corruption ────
let writeQueue = Promise.resolve();
const originalWrite = db.write.bind(db);
db.write = function() {
  writeQueue = writeQueue.then(() => {
    try { return originalWrite(); }
    catch(e) { console.error('DB write error:', e); }
  });
  return writeQueue;
};

// ── AUTO BACKUP every hour (Fix #10) ─────────────────────
function backupDB() {
  try {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    console.log(`💾  DB backed up at ${new Date().toLocaleTimeString()}`);
  } catch(e) {
    console.error('Backup failed:', e.message);
  }
}
// Backup on startup and then every hour
setTimeout(backupDB, 5000);
setInterval(backupDB, 60 * 60 * 1000);

// ── AUDIT LOG helper (Fix #11) ────────────────────────────
const { v4: uuid } = require('uuid');
db.audit = function(action, adminId, adminName, details = {}) {
  db.get('audit_log').push({
    id:         uuid(),
    action,
    admin_id:   adminId,
    admin_name: adminName,
    details,
    timestamp:  new Date().toISOString()
  }).write();
};

// ── TOKEN BLACKLIST (Fix #2) ──────────────────────────────
// In-memory set — fast lookup, clears on restart (tokens expire in 7d anyway)
const tokenBlacklist = new Set();
db.blacklistToken = function(token) {
  tokenBlacklist.add(token);
  // Auto-remove after 7 days to prevent memory leak
  setTimeout(() => tokenBlacklist.delete(token), 7 * 24 * 60 * 60 * 1000);
};
db.isTokenBlacklisted = function(token) {
  return tokenBlacklist.has(token);
};

module.exports = db;