const fs   = require('fs');
const path = require('path');
const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, adminOnly } = require('./auth');

const router = express.Router();

// GET all tournaments (public)
router.get('/', (req, res) => {
  res.json(db.get('tournaments').value());
});

// GET refund ledger (admin)
router.get('/refunds/all', auth, adminOnly, (req, res) => {
  res.json(db.get('refunds').value());
});

// GET audit log (admin)
router.get('/audit/log', auth, adminOnly, (req, res) => {
  const logs = db.get('audit_log').value().slice().reverse().slice(0, 200);
  res.json(logs);
});

// GET single tournament
router.get('/:id', (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// CREATE tournament (admin)
router.post('/', auth, adminOnly, (req, res) => {
  const { name, format, entry_fee, max_players, payment_link, date, prize, description } = req.body;
  if (!name || !format) return res.status(400).json({ error: 'Name and format required' });

  const t = {
    id: uuid(),
    name: name.trim(),
    format,                         // 'knockout' | 'league' | 'group_knockout'
    entry_fee: entry_fee || 0,
    max_players: max_players || 16,
    payment_link: payment_link || '',
    date: date || '',
    prize: prize || '',
    description: description || '',
    status: 'open',                 // open → ongoing → completed
    winner_id: null,
    winner_name: null,
    started_at: null,
    created_at: new Date().toISOString()
  };
  db.get('tournaments').push(t).write();
  res.status(201).json(t);
});

// UPDATE tournament (admin) — with validation (Fix #8)
router.put('/:id', auth, adminOnly, (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Cannot edit a tournament that has already started' });

  // Validate max_players not below current confirmed count
  if (req.body.max_players !== undefined) {
    const confirmed = db.get('registrations').filter({ tournament_id: req.params.id, status: 'confirmed' }).value().length;
    if (parseInt(req.body.max_players) < confirmed) {
      return res.status(400).json({ error: `Cannot set max players below current confirmed count (${confirmed})` });
    }
  }

  // Prevent changing entry fee if anyone has already paid
  if (req.body.entry_fee !== undefined && parseFloat(req.body.entry_fee) !== parseFloat(t.entry_fee)) {
    const hasPaid = db.get('registrations').filter({ tournament_id: req.params.id, status: 'confirmed' }).value().length;
    if (hasPaid > 0) {
      return res.status(400).json({ error: `Cannot change entry fee — ${hasPaid} player(s) already paid ₹${t.entry_fee}` });
    }
  }

  // Log the change
  db.audit('EDIT_TOURNAMENT', req.user.id, req.user.name, {
    tournament_id: req.params.id,
    tournament_name: t.name,
    changes: req.body
  });

  db.get('tournaments').find({ id: req.params.id }).assign(req.body).write();
  res.json(db.get('tournaments').find({ id: req.params.id }).value());
});

// DELETE tournament (admin) — saves refund ledger first
router.delete('/:id', auth, adminOnly, (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'Not found' });

  // Build refund ledger before deleting
  const paidRegs = db.get('registrations')
    .filter(r => r.tournament_id === req.params.id && r.status === 'confirmed')
    .value();

  if (paidRegs.length > 0) {
    const refundEntry = {
      id: uuid(),
      tournament_id:   req.params.id,
      tournament_name: t.name,
      entry_fee:       t.entry_fee || 0,
      deleted_at:      new Date().toISOString(),
      players: paidRegs.map(r => ({
        player_name: r.player_name,
        team_name:   r.team_name,
        phone:       r.phone,
        utr_number:  r.utr_number || null,
        payment_ref: r.payment_ref || null,
        amount:      parseFloat(t.entry_fee) || 0
      }))
    };
    db.get('refunds').push(refundEntry).write();
  }

  db.audit('DELETE_TOURNAMENT', req.user.id, req.user.name, {
    tournament_name: t.name,
    refunded_players: paidRegs.length
  });

  // Delete all uploaded files for this tournament
  const matchFiles = db.get('matches').filter({ tournament_id: req.params.id }).value();
  const regFiles   = db.get('registrations').filter({ tournament_id: req.params.id }).value();
  const allFiles   = [
    ...matchFiles.flatMap(m => [m.p1_screenshot, m.p2_screenshot]),
    ...regFiles.map(r => r.profile_screenshot)
  ].filter(Boolean);

  allFiles.forEach(filePath => {
    try {
      const abs = path.join(__dirname, '../..', filePath);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch(e) { console.warn('Could not delete file:', filePath); }
  });

  db.get('tournaments').remove({ id: req.params.id }).write();
  db.get('registrations').remove({ tournament_id: req.params.id }).write();
  db.get('matches').remove({ tournament_id: req.params.id }).write();
  res.json({ ok: true, refund_players: paidRegs.length });
});



// START tournament — generate all matches (admin)
router.post('/:id/start', auth, adminOnly, (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Tournament already started' });

  let regs = db.get('registrations')
    .filter({ tournament_id: req.params.id, status: 'confirmed' })
    .value();

  if (regs.length < 2) return res.status(400).json({ error: 'Need at least 2 confirmed players' });

  let removedPlayer = null;

  // ── ODD PLAYER REMOVAL (league format) ───────────────────
  if (t.format === 'league' && regs.length % 2 !== 0) {
    // Sort by registered_at — last registered gets removed
    const sorted = [...regs].sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
    const toRemove = sorted[0];
    removedPlayer = toRemove;

    // Notify them
    const catchyMessages = [
      `Hey champ! The squad wasn't complete this time, but your legend begins next tournament. Stay ready! 🔥⚽`,
      `The arena wasn't big enough for an odd number this time — but champions wait for no one. See you next tournament! 🏆`,
      `Not this time, legend! The draw didn't include you today, but your moment is coming. Get ready to dominate! ⚡🎮`,
      `You registered with heart, but the numbers didn't align this time. Next tournament — that trophy has your name on it! 🌟`
    ];
    const msg = catchyMessages[Math.floor(Math.random() * catchyMessages.length)];

    db.get('registrations').find({ id: toRemove.id }).assign({
      status: 'removed_odd',
      notification: msg,
      notified_at: new Date().toISOString()
    }).write();

    // Remove from active regs
    regs = regs.filter(r => r.id !== toRemove.id);
  }

  // Generate matches based on format
  const matches = generateMatches(t, regs);
  matches.forEach(m => db.get('matches').push(m).write());

  db.get('tournaments').find({ id: req.params.id }).assign({
    status: 'ongoing',
    started_at: new Date().toISOString()
  }).write();

  res.json({
    ok: true,
    matches_created: matches.length,
    removed_player: removedPlayer ? { name: removedPlayer.player_name, phone: removedPlayer.phone } : null
  });
});

// ── MATCH GENERATION ─────────────────────────────────────
function generateMatches(tournament, regs) {
  const matches = [];
  const tid = tournament.id;
  const players = shuffle([...regs]);

  if (tournament.format === 'league') {
    // Round-robin: every player plays every other player
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        matches.push(makeMatch(tid, players[i], players[j], 'League', 1));
      }
    }
  } else if (tournament.format === 'knockout') {
    // Single elimination bracket
    generateKnockoutRound(tid, players, 1, matches);
  } else if (tournament.format === 'group_knockout') {
    // Make even groups — remove last player(s) if needed so all groups equal size
    const groupSize = 4;
    let evenPlayers = [...players];
    const remainder = evenPlayers.length % groupSize;
    const removed = [];
    if (remainder !== 0) {
      // Remove last 'remainder' players (last registered)
      const sortedByReg = [...evenPlayers].sort((a, b) =>
        new Date(db.get('registrations').find({ user_id: b.user_id, tournament_id: tid }).value()?.registered_at || 0) -
        new Date(db.get('registrations').find({ user_id: a.user_id, tournament_id: tid }).value()?.registered_at || 0)
      );
      for (let i = 0; i < remainder; i++) {
        const r = sortedByReg[i];
        removed.push(r);
        evenPlayers = evenPlayers.filter(p => p.user_id !== r.user_id);
        const reg = db.get('registrations').find({ tournament_id: tid, user_id: r.user_id });
        if (reg.value()) reg.assign({
          status: 'removed_odd',
          notification: `⚠ The group stage couldn't fit an even number of players. You've been placed on the reserve list for <b>${tournament.name}</b>. Contact admin for a refund or next tournament priority! 🙏`
        }).write();
      }
    }
    const groups = chunkArray(evenPlayers, groupSize);
    groups.forEach((group, gi) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          matches.push(makeMatch(tid, group[i], group[j], `Group ${String.fromCharCode(65 + gi)}`, 1));
        }
      }
    });
  }

  return matches;
}

function generateKnockoutRound(tid, players, roundNum, matches) {
  const roundName = getRoundName(players.length);
  for (let i = 0; i < players.length - 1; i += 2) {
    matches.push(makeMatch(tid, players[i], players[i + 1], roundName, roundNum));
  }
  // Bye if odd number
  if (players.length % 2 !== 0) {
    const byePlayer = players[players.length - 1];
    matches.push(makeMatch(tid, byePlayer, null, roundName + ' (Bye)', roundNum, true));
  }
}

function getRoundName(count) {
  if (count >= 16) return 'Round of 16';
  if (count >= 8)  return 'Quarter Final';
  if (count >= 4)  return 'Semi Final';
  if (count >= 2)  return 'Final';
  return 'Match';
}

function generateFriendsPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars like 0,O,1,I
  let pw = '';
  for (let i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function makeMatch(tid, p1, p2, round, roundNum, isBye = false) {
  return {
    id: uuid(),
    tournament_id: tid,
    round,
    round_num: roundNum,
    player1_id:   p1 ? p1.user_id : null,
    player1_name: p1 ? p1.player_name : null,
    player2_id:   p2 ? p2.user_id : null,
    player2_name: p2 ? p2.player_name : null,
    score1: isBye ? 1 : null,
    score2: isBye ? 0 : null,
    status: isBye ? 'confirmed' : 'pending',
    friends_password: isBye ? null : generateFriendsPassword(),
    p1_screenshot: null,
    p2_screenshot: null,
    p1_submitted_score: null,
    p2_submitted_score: null,
    is_bye: isBye,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
// PAUSE tournament (admin)
router.put('/:id/pause', auth, adminOnly, (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id });
  if (!t.value()) return res.status(404).json({ error: 'Not found' });
  if (t.value().status !== 'ongoing') return res.status(400).json({ error: 'Only ongoing tournaments can be paused' });
  t.assign({ status: 'paused', paused_at: new Date().toISOString() }).write();
  db.audit('PAUSE_TOURNAMENT', req.user.id, req.user.name, { tournament: t.value().name });
  res.json({ ok: true });
});

// UNPAUSE tournament (admin)
router.put('/:id/unpause', auth, adminOnly, (req, res) => {
  const t = db.get('tournaments').find({ id: req.params.id });
  if (!t.value()) return res.status(404).json({ error: 'Not found' });
  if (t.value().status !== 'paused') return res.status(400).json({ error: 'Tournament is not paused' });
  t.assign({ status: 'ongoing', paused_at: null }).write();
  db.audit('UNPAUSE_TOURNAMENT', req.user.id, req.user.name, { tournament: t.value().name });
  res.json({ ok: true });
});

module.exports = router;

