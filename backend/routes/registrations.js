require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, adminOnly } = require('./auth');

const router = express.Router();

// Multer for profile screenshots
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename:    (req, file, cb) => cb(null, `profile_${uuid()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG/PNG/WEBP allowed'));
    cb(null, true);
  }
});

// GET all registrations
router.get('/', auth, (req, res) => {
  if (req.user.is_admin) return res.json(db.get('registrations').value());
  res.json(db.get('registrations').filter({ user_id: req.user.id }).value());
});

// REGISTER — with team name, phone, profile screenshot
router.post('/', auth, upload.single('profile_screenshot'), (req, res) => {
  const { tournament_id, player_name, team_name, phone } = req.body;
  if (!tournament_id || !player_name || !team_name || !phone)
    return res.status(400).json({ error: 'All fields required including team name and phone number' });

  // Basic phone validation
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10)
    return res.status(400).json({ error: 'Enter a valid phone number' });

  if (!req.file)
    return res.status(400).json({ error: 'DLS profile screenshot is required' });

  const t = db.get('tournaments').find({ id: tournament_id }).value();
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Tournament is not open for registration' });

  const existing = db.get('registrations').find({ tournament_id, user_id: req.user.id }).value();
  if (existing) return res.status(409).json({ error: 'Already registered for this tournament' });

  // Block same phone number registering twice in same tournament
  const samePhone = db.get('registrations')
    .filter(r => r.tournament_id === tournament_id && r.phone === cleanPhone)
    .value();
  if (samePhone.length) return res.status(409).json({ error: 'This phone number is already registered for this tournament' });

  const confirmed = db.get('registrations').filter({ tournament_id, status: 'confirmed' }).value().length;
  if (confirmed >= t.max_players) return res.status(400).json({ error: 'Tournament is full' });

  // Generate unique payment reference code for this registration
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let payRef = 'DLS-';
  for (let i = 0; i < 6; i++) payRef += chars[Math.floor(Math.random() * chars.length)];

  const isFree = !t.entry_fee || parseFloat(t.entry_fee) === 0;
  const reg = {
    id: uuid(),
    tournament_id,
    user_id:    req.user.id,
    player_name: player_name.trim(),
    team_name:   team_name.trim(),
    phone:       cleanPhone,
    profile_screenshot: `/uploads/${req.file.filename}`,
    payment_ref: payRef,
    utr_number:  null,
    status: isFree ? 'confirmed' : 'pending',
    notification: isFree ? `🎉 You're registered for <b>${t.name}</b>! Get ready to play! ⚽🔥` : null,
    notified_at: isFree ? new Date().toISOString() : null,
    registered_at: new Date().toISOString()
  };
  db.get('registrations').push(reg).write();
  res.status(201).json(reg);
});

// SUBMIT UTR number — player submits transaction ID after paying
router.put('/:id/utr', auth, (req, res) => {
  const { utr_number } = req.body;
  if (!utr_number?.trim()) return res.status(400).json({ error: 'UTR/Transaction ID required' });
  const reg = db.get('registrations').find({ id: req.params.id, user_id: req.user.id });
  if (!reg.value()) return res.status(404).json({ error: 'Registration not found' });
  if (reg.value().status === 'confirmed') return res.status(400).json({ error: 'Payment already confirmed' });
  reg.assign({
    utr_number: utr_number.trim(),
    utr_submitted_at: new Date().toISOString()
  }).write();
  res.json(reg.value());
});

// CONFIRM payment (admin)
router.put('/:id/confirm', auth, adminOnly, (req, res) => {
  const reg = db.get('registrations').find({ id: req.params.id });
  if (!reg.value()) return res.status(404).json({ error: 'Not found' });
  const t = db.get('tournaments').find({ id: reg.value().tournament_id }).value();
  db.audit('CONFIRM_PAYMENT', req.user.id, req.user.name, { player: reg.value().player_name, tournament: t?.name });
  reg.assign({
    status: 'confirmed',
    notification: `🎉 Your payment for <b>${t ? t.name : 'the tournament'}</b> has been confirmed! You're officially in. Get your DLS skills ready! ⚽🔥`,
    notified_at: new Date().toISOString()
  }).write();
  res.json(reg.value());
});

// REJECT registration (admin)
router.put('/:id/reject', auth, adminOnly, (req, res) => {
  const reg = db.get('registrations').find({ id: req.params.id });
  if (!reg.value()) return res.status(404).json({ error: 'Not found' });
  reg.assign({ status: 'rejected' }).write();
  res.json(reg.value());
});

// NOTIFY player (admin sends notification message)
router.put('/:id/notify', auth, adminOnly, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const reg = db.get('registrations').find({ id: req.params.id });
  if (!reg.value()) return res.status(404).json({ error: 'Not found' });
  reg.assign({ notification: message, notified_at: new Date().toISOString() }).write();
  res.json(reg.value());
});

// DELETE registration (admin)
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.get('registrations').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

module.exports = router;