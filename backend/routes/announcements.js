const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, adminOnly } = require('./auth');

const router = express.Router();

// GET all announcements (public)
router.get('/', (req, res) => {
  const anns = db.get('announcements').value().slice().reverse();
  res.json(anns);
});

// POST announcement (admin)
router.post('/', auth, adminOnly, (req, res) => {
  const { message, tournament_id, tournament_name } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const ann = {
    id: uuid(),
    message: message.trim(),
    tournament_id:   tournament_id   || null,
    tournament_name: tournament_name || null,
    created_at: new Date().toISOString()
  };
  db.get('announcements').push(ann).write();
  res.status(201).json(ann);
});

// DELETE announcement (admin)
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.get('announcements').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

module.exports = router;
