require('dotenv').config();
const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, adminOnly } = require('./auth');

const router = express.Router();


// GET all appeals (admin) or own appeals (player)
router.get('/', auth, (req, res) => {
  if (req.user.is_admin) return res.json(db.get('appeals').value());
  res.json(db.get('appeals').filter({ user_id: req.user.id }).value());
});

// SUBMIT appeal (player)
router.post('/', auth, (req, res) => {
  const { match_id, reason } = req.body;
  if (!match_id || !reason?.trim()) return res.status(400).json({ error: 'Match ID and reason required' });

  const match = db.get('matches').find({ id: match_id }).value();
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Only player in this match can appeal
  const isP1 = match.player1_id === req.user.id;
  const isP2 = match.player2_id === req.user.id;
  if (!isP1 && !isP2) return res.status(403).json({ error: 'Not your match' });

  // Only confirmed/disputed matches can be appealed
  if (!['confirmed', 'pending_review'].includes(match.status)) {
    return res.status(400).json({ error: 'Only confirmed matches can be appealed' });
  }

  // Check if already appealed
  const existing = db.get('appeals').find({ match_id, user_id: req.user.id }).value();
  if (existing) return res.status(409).json({ error: 'You already submitted an appeal for this match' });

  const appeal = {
    id: uuid(),
    match_id,
    tournament_id: match.tournament_id,
    user_id:   req.user.id,
    user_name: req.user.name,
    opponent_name: isP1 ? match.player2_name : match.player1_name,
    match_round: match.round,
    score: `${match.score1}–${match.score2}`,
    reason: reason.trim(),
    status: 'pending',   // pending | upheld | overturned
    admin_response: null,
    submitted_at: new Date().toISOString()
  };
  db.get('appeals').push(appeal).write();
  res.status(201).json(appeal);
});

// ADMIN: uphold appeal (keep original decision)
router.put('/:id/uphold', auth, adminOnly, (req, res) => {
  const appeal = db.get('appeals').find({ id: req.params.id });
  if (!appeal.value()) return res.status(404).json({ error: 'Not found' });
  const { response } = req.body;
  appeal.assign({
    status: 'upheld',
    admin_response: response || 'Original decision stands.',
    reviewed_at: new Date().toISOString()
  }).write();

  // Notify player
  const reg = db.get('registrations').find({ tournament_id: appeal.value().tournament_id, user_id: appeal.value().user_id });
  if (reg.value()) reg.assign({
    notification: `📋 Your appeal for the match against <b>${appeal.value().opponent_name}</b> has been reviewed. Decision: <b>Upheld</b>. ${response || 'Original decision stands.'}`,
    notified_at: new Date().toISOString()
  }).write();

  db.audit('APPEAL_UPHELD', req.user.id, req.user.name, { appeal_id: req.params.id, player: appeal.value().user_name });
  res.json({ ok: true });
});

// ADMIN: overturn appeal (reverse decision)
router.put('/:id/overturn', auth, adminOnly, (req, res) => {
  const appeal = db.get('appeals').find({ id: req.params.id });
  if (!appeal.value()) return res.status(404).json({ error: 'Not found' });
  const { response } = req.body;

  // Reverse the match result
  const match = db.get('matches').find({ id: appeal.value().match_id }).value();
  if (match) {
    const isP1 = match.player1_id === appeal.value().user_id;
    db.get('matches').find({ id: match.id }).assign({
      score1: isP1 ? 1 : 0,
      score2: isP1 ? 0 : 1,
      disputed: true,
      appeal_overturned: true,
      updated_at: new Date().toISOString()
    }).write();
  }

  appeal.assign({
    status: 'overturned',
    admin_response: response || 'Decision reversed in your favour.',
    reviewed_at: new Date().toISOString()
  }).write();

  // Notify player
  const reg = db.get('registrations').find({ tournament_id: appeal.value().tournament_id, user_id: appeal.value().user_id });
  if (reg.value()) reg.assign({
    notification: `✅ Your appeal for the match against <b>${appeal.value().opponent_name}</b> has been <b>overturned</b>! ${response || 'Decision reversed in your favour.'} 🎉`,
    notified_at: new Date().toISOString()
  }).write();

  db.audit('APPEAL_OVERTURNED', req.user.id, req.user.name, { appeal_id: req.params.id, player: appeal.value().user_name });
  if (match) {
    const matchesRouter = require('./matches');
    matchesRouter.advanceKnockout(match.tournament_id);
    matchesRouter.updateGroupStandings(match.tournament_id);
  }
  res.json({ ok: true });
});

module.exports = router;