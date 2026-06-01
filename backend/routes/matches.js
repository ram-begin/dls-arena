require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, adminOnly } = require('./auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename:    (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG or WEBP images allowed'));
    cb(null, true);
  }
});

// GET all matches (admin) or own matches
router.get('/', auth, (req, res) => {
  if (req.user.is_admin) return res.json(db.get('matches').value());
  const uid = req.user.id;
  res.json(db.get('matches').filter(m => m.player1_id === uid || m.player2_id === uid).value());
});

// GET matches for a tournament
router.get('/tournament/:tid', auth, (req, res) => {
  res.json(db.get('matches').filter({ tournament_id: req.params.tid }).value());
});

// ADMIN: set match start time
router.put('/:id/schedule', auth, adminOnly, (req, res) => {
  const { start_time } = req.body;
  if (!start_time) return res.status(400).json({ error: 'start_time required' });
  const match = db.get('matches').find({ id: req.params.id });
  if (!match.value()) return res.status(404).json({ error: 'Match not found' });
  match.assign({
    start_time,
    deadline: new Date(new Date(start_time).getTime() + 15 * 60 * 1000).toISOString()
  }).write();
  res.json(match.value());
});

// SUBMIT SCREENSHOT
router.post('/:id/submit', auth, upload.single('screenshot'), (req, res) => {
  const match = db.get('matches').find({ id: req.params.id }).value();
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const uid = req.user.id;
  const isP1 = match.player1_id === uid;
  const isP2 = match.player2_id === uid;
  if (!isP1 && !isP2) return res.status(403).json({ error: 'Not your match' });

  // Check if tournament is paused
  const tournament = db.get('tournaments').find({ id: match.tournament_id }).value();
  if (tournament?.status === 'paused') {
    return res.status(400).json({ error: 'Tournament is currently paused by admin. Please wait before submitting.' });
  }

  // Check deadline
  if (match.deadline && new Date() > new Date(match.deadline)) {
    return res.status(400).json({ error: 'Deadline passed. You have been marked as a loss.' });
  }

  if (!req.file) return res.status(400).json({ error: 'Screenshot required' });
  if (req.file.size < 10 * 1024) return res.status(400).json({ error: 'Screenshot too small. Upload the actual DLS result screen.' });

  const screenshotUrl = `/uploads/${req.file.filename}`;
  const { my_score, opp_score } = req.body;
  const myScore  = parseInt(my_score)  || 0;
  const oppScore = parseInt(opp_score) || 0;

  const update = {};
  if (isP1) {
    if (match.p1_screenshot) return res.status(400).json({ error: 'Already submitted' });
    update.p1_screenshot = screenshotUrl;
    update.p1_submitted_score = `${myScore}-${oppScore}`;
    update.score1 = myScore;
    update.score2 = oppScore;
  } else {
    if (match.p2_screenshot) return res.status(400).json({ error: 'Already submitted' });
    update.p2_screenshot = screenshotUrl;
    update.p2_submitted_score = `${myScore}-${oppScore}`;
    if (!match.p1_screenshot) { update.score1 = oppScore; update.score2 = myScore; }
  }

  const p1Done = isP1 ? true : !!match.p1_screenshot;
  const p2Done = isP2 ? true : !!match.p2_screenshot;
  if (p1Done && p2Done) update.status = 'pending_review';

  update.updated_at = new Date().toISOString();
  db.get('matches').find({ id: req.params.id }).assign(update).write();
  res.json({ ok: true, status: update.status || match.status });
});

// ADMIN: confirm score
router.put('/:id/confirm', auth, adminOnly, (req, res) => {
  const match = db.get('matches').find({ id: req.params.id }).value();
  if (!match) return res.status(404).json({ error: 'Not found' });
  const s1 = req.body.score1 !== undefined ? parseInt(req.body.score1) : match.score1;
  const s2 = req.body.score2 !== undefined ? parseInt(req.body.score2) : match.score2;
  db.get('matches').find({ id: req.params.id }).assign({
    score1: s1, score2: s2, status: 'confirmed', updated_at: new Date().toISOString()
  }).write();

  // Notify both players
  const t = db.get('tournaments').find({ id: match.tournament_id }).value();
  const tName = t ? t.name : 'the tournament';
  const p1Won = s1 > s2;
  notifyPlayer(match.tournament_id, match.player1_id,
    p1Won
      ? `🏆 Match result confirmed! You beat <b>${match.player2_name}</b> ${s1}–${s2} in <b>${tName}</b>. Well played, champion! 💪`
      : `Match result confirmed. You lost to <b>${match.player2_name}</b> ${s1}–${s2} in <b>${tName}</b>. Chin up — keep fighting! 🔥`
  );
  notifyPlayer(match.tournament_id, match.player2_id,
    !p1Won
      ? `🏆 Match result confirmed! You beat <b>${match.player1_name}</b> ${s2}–${s1} in <b>${tName}</b>. Well played, champion! 💪`
      : `Match result confirmed. You lost to <b>${match.player1_name}</b> ${s2}–${s1} in <b>${tName}</b>. Chin up — keep fighting! 🔥`
  );

  advanceKnockout(match.tournament_id);
  updateGroupStandings(match.tournament_id);
  db.audit('CONFIRM_SCORE', req.user.id, req.user.name, { match_id: req.params.id, player1: match.player1_name, player2: match.player2_name, score: `${s1}-${s2}` });
  res.json({ ok: true });
});

// ADMIN: dispute/disqualify
router.put('/:id/dispute', auth, adminOnly, (req, res) => {
  const match = db.get('matches').find({ id: req.params.id }).value();
  if (!match) return res.status(404).json({ error: 'Not found' });
  const dq = req.body.disqualify_player;
  const s1 = dq === 'player1' ? 0 : 1;
  const s2 = dq === 'player2' ? 0 : 1;
  db.get('matches').find({ id: req.params.id }).assign({
    score1: s1, score2: s2, status: 'confirmed',
    disputed: true, disqualified: dq, updated_at: new Date().toISOString()
  }).write();

  const t = db.get('tournaments').find({ id: match.tournament_id }).value();
  const tName = t ? t.name : 'the tournament';
  if (dq === 'player1') {
    notifyPlayer(match.tournament_id, match.player1_id, `❌ You have been disqualified from a match in <b>${tName}</b> due to a score dispute. Contact admin for details.`);
    notifyPlayer(match.tournament_id, match.player2_id, `✅ Match awarded to you in <b>${tName}</b> after score verification. You advance! 🔥`);
  } else {
    notifyPlayer(match.tournament_id, match.player2_id, `❌ You have been disqualified from a match in <b>${tName}</b> due to a score dispute. Contact admin for details.`);
    notifyPlayer(match.tournament_id, match.player1_id, `✅ Match awarded to you in <b>${tName}</b> after score verification. You advance! 🔥`);
  }

  advanceKnockout(match.tournament_id);
  updateGroupStandings(match.tournament_id);
  db.audit('DISQUALIFY_PLAYER', req.user.id, req.user.name, { match_id: req.params.id, disqualified: dq, player1: match.player1_name, player2: match.player2_name });
  res.json({ ok: true });
});

// ── NOTIFY PLAYER HELPER ──────────────────────────────────
function notifyPlayer(tournamentId, userId, message) {
  if (!userId || !message) return;
  const reg = db.get('registrations').find({ tournament_id: tournamentId, user_id: userId });
  if (reg.value()) {
    reg.assign({ notification: message, notified_at: new Date().toISOString() }).write();
  }
}

// ADMIN: check deadlines manually (or called by cron)
router.post('/check-deadlines', auth, adminOnly, (req, res) => {
  const expired = processDeadlines();
  res.json({ processed: expired });
});

// ── DEADLINE PROCESSOR ─────────────────────────────────────
function processDeadlines() {
  const now = new Date();
  const pending = db.get('matches').filter(m =>
    m.status === 'pending' && m.deadline && new Date(m.deadline) < now
  ).value();

  let processed = 0;
  pending.forEach(m => {
    const p1Submitted = !!m.p1_screenshot;
    const p2Submitted = !!m.p2_screenshot;
    let s1, s2, notification1 = null, notification2 = null;

    if (!p1Submitted && !p2Submitted) {
      // Both missed — both lose
      s1 = 0; s2 = 0;
      notification1 = `⏰ You missed the 15-minute deadline for your match against ${m.player2_name}. Both players have been marked as a loss.`;
      notification2 = `⏰ You missed the 15-minute deadline for your match against ${m.player1_name}. Both players have been marked as a loss.`;
    } else if (!p1Submitted) {
      // P1 missed
      s1 = 0; s2 = 1;
      notification1 = `⏰ You missed the 15-minute deadline for your match against ${m.player2_name}. You have been marked as a loss. Be ready next time! 💪`;
    } else if (!p2Submitted) {
      // P2 missed
      s1 = 1; s2 = 0;
      notification2 = `⏰ You missed the 15-minute deadline for your match against ${m.player1_name}. You have been marked as a loss. Be ready next time! 💪`;
    } else {
      return; // Both submitted, no action needed
    }

    db.get('matches').find({ id: m.id }).assign({
      score1: s1, score2: s2,
      status: 'confirmed',
      deadline_expired: true,
      updated_at: now.toISOString()
    }).write();

    // Store notifications in registrations
    if (notification1) {
      const reg1 = db.get('registrations').find({ tournament_id: m.tournament_id, user_id: m.player1_id });
      if (reg1.value()) reg1.assign({ notification: notification1, notified_at: now.toISOString() }).write();
    }
    if (notification2) {
      const reg2 = db.get('registrations').find({ tournament_id: m.tournament_id, user_id: m.player2_id });
      if (reg2.value()) reg2.assign({ notification: notification2, notified_at: now.toISOString() }).write();
    }

    advanceKnockout(m.tournament_id);
    updateGroupStandings(m.tournament_id);
    processed++;
  });
  return processed;
}

// Run deadline check every minute automatically
setInterval(processDeadlines, 60 * 1000);

// ── GROUP STAGE STANDINGS ─────────────────────────────────
function updateGroupStandings(tournamentId) {
  const t = db.get('tournaments').find({ id: tournamentId }).value();
  if (!t || t.format !== 'group_knockout') return;

  const allMatches = db.get('matches').filter({ tournament_id: tournamentId }).value();
  const groupMatches = allMatches.filter(m => m.round && m.round.startsWith('Group'));
  const allGroupsDone = groupMatches.every(m => m.status === 'confirmed');
  if (!allGroupsDone) return;

  // Get unique groups
  const groups = [...new Set(groupMatches.map(m => m.round))];
  const qualifiers = [];

  groups.forEach(groupName => {
    const gMatches = groupMatches.filter(m => m.round === groupName);
    const playerPoints = {};

    gMatches.forEach(m => {
      if (!playerPoints[m.player1_id]) playerPoints[m.player1_id] = { id: m.player1_id, name: m.player1_name, pts: 0, gf: 0, ga: 0 };
      if (!playerPoints[m.player2_id]) playerPoints[m.player2_id] = { id: m.player2_id, name: m.player2_name, pts: 0, gf: 0, ga: 0 };

      const s1 = m.score1 || 0, s2 = m.score2 || 0;
      playerPoints[m.player1_id].gf += s1;
      playerPoints[m.player1_id].ga += s2;
      playerPoints[m.player2_id].gf += s2;
      playerPoints[m.player2_id].ga += s1;

      if (s1 > s2)      { playerPoints[m.player1_id].pts += 3; }
      else if (s2 > s1) { playerPoints[m.player2_id].pts += 3; }
    });

    // Sort by points then goal difference
    const sorted = Object.values(playerPoints).sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      return (b.gf - b.ga) - (a.gf - a.ga);
    });

    // Top 2 qualify
    qualifiers.push(...sorted.slice(0, 2).map(p => ({ user_id: p.id, player_name: p.name })));
  });

  // Check if knockout stage already generated
  const knockoutExists = allMatches.some(m => m.round === 'Quarter Final' || m.round === 'Semi Final' || m.round === 'Final');
  if (knockoutExists) return;

  // Generate knockout from qualifiers
  const roundName = getRoundName(qualifiers.length);
  for (let i = 0; i < qualifiers.length - 1; i += 2) {
    const m = {
      id: uuid(),
      tournament_id: tournamentId,
      round: roundName,
      round_num: 2,
      player1_id:   qualifiers[i].user_id,
      player1_name: qualifiers[i].player_name,
      player2_id:   qualifiers[i + 1].user_id,
      player2_name: qualifiers[i + 1].player_name,
      score1: null, score2: null,
      status: 'pending',
      friends_password: generateFriendsPassword(),
      p1_screenshot: null, p2_screenshot: null,
      p1_submitted_score: null, p2_submitted_score: null,
      is_bye: false,
      start_time: null, deadline: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.get('matches').push(m).write();
  }

  db.get('tournaments').find({ id: tournamentId }).assign({ group_stage_done: true }).write();
}

// ── AUTO-ADVANCE KNOCKOUT ─────────────────────────────────
function advanceKnockout(tournamentId) {
  const t = db.get('tournaments').find({ id: tournamentId }).value();
  if (!t || t.format === 'league') {
    // For league format, check if all matches done and declare winner
    if (t && t.format === 'league') declareLeagueWinner(tournamentId);
    return;
  }

  const allMatches = db.get('matches').filter({ tournament_id: tournamentId }).value();
  const knockoutMatches = allMatches.filter(m => !m.round?.startsWith('Group') && !m.round?.startsWith('League'));
  if (!knockoutMatches.length) return;

  const currentRound = Math.max(...knockoutMatches.map(m => m.round_num || 1));
  const roundMatches = knockoutMatches.filter(m => m.round_num === currentRound);
  const allDone = roundMatches.every(m => m.status === 'confirmed');
  if (!allDone) return;

  const winners = roundMatches.map(m => {
    if ((m.score1 || 0) >= (m.score2 || 0)) return { user_id: m.player1_id, player_name: m.player1_name };
    return { user_id: m.player2_id, player_name: m.player2_name };
  });

  if (winners.length === 1) {
    db.get('tournaments').find({ id: tournamentId }).assign({
      status: 'completed',
      winner_id:   winners[0].user_id,
      winner_name: winners[0].player_name
    }).write();
    return;
  }

  const nextRound = currentRound + 1;
  const roundName = getRoundName(winners.length);
  for (let i = 0; i < winners.length - 1; i += 2) {
    db.get('matches').push({
      id: uuid(),
      tournament_id: tournamentId,
      round: roundName, round_num: nextRound,
      player1_id:   winners[i].user_id,
      player1_name: winners[i].player_name,
      player2_id:   winners[i + 1].user_id,
      player2_name: winners[i + 1].player_name,
      score1: null, score2: null,
      status: 'pending',
      friends_password: generateFriendsPassword(),
      p1_screenshot: null, p2_screenshot: null,
      p1_submitted_score: null, p2_submitted_score: null,
      is_bye: false, start_time: null, deadline: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).write();
  }
}

// ── LEAGUE WINNER DECLARATION (Fix #6) ───────────────────
function declareLeagueWinner(tournamentId) {
  const t = db.get('tournaments').find({ id: tournamentId }).value();
  if (!t || t.status === 'completed') return;

  const allMatches = db.get('matches').filter({ tournament_id: tournamentId, is_bye: false }).value();
  if (!allMatches.length) return;

  // Check all matches confirmed
  const allDone = allMatches.every(m => m.status === 'confirmed');
  if (!allDone) return;

  // Calculate standings
  const playerPoints = {};
  allMatches.forEach(m => {
    if (!playerPoints[m.player1_id]) playerPoints[m.player1_id] = { id: m.player1_id, name: m.player1_name, pts: 0, gf: 0, ga: 0, wins: 0 };
    if (!playerPoints[m.player2_id]) playerPoints[m.player2_id] = { id: m.player2_id, name: m.player2_name, pts: 0, gf: 0, ga: 0, wins: 0 };

    const s1 = m.score1 || 0, s2 = m.score2 || 0;
    playerPoints[m.player1_id].gf += s1;
    playerPoints[m.player1_id].ga += s2;
    playerPoints[m.player2_id].gf += s2;
    playerPoints[m.player2_id].ga += s1;

    if (s1 > s2) {
      playerPoints[m.player1_id].pts  += 3;
      playerPoints[m.player1_id].wins += 1;
    } else if (s2 > s1) {
      playerPoints[m.player2_id].pts  += 3;
      playerPoints[m.player2_id].wins += 1;
    }
  });

  // Sort: points → goal difference → goals for → wins (Fix #12 tiebreaker)
  const sorted = Object.values(playerPoints).sort((a, b) => {
  if (b.pts !== a.pts)                       return b.pts - a.pts;
  if ((b.gf - b.ga) !== (a.gf - a.ga))      return (b.gf - b.ga) - (a.gf - a.ga);
  if (b.gf !== a.gf)                         return b.gf - a.gf;
  return 0; // truly equal — first registered stays higher
});

  const winner = sorted[0];
  db.get('tournaments').find({ id: tournamentId }).assign({
    status:      'completed',
    winner_id:   winner.id,
    winner_name: winner.name,
    final_standings: sorted.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, pts: p.pts, gf: p.gf, ga: p.ga }))
  }).write();

  // Notify winner
  const reg = db.get('registrations').find({ tournament_id: tournamentId, user_id: winner.id });
  if (reg.value()) {
    reg.assign({
      notification: `🏆 Congratulations! You've won the <b>${t.name}</b> league tournament with ${winner.pts} points! Champion! 🎉⚽`,
      notified_at: new Date().toISOString()
    }).write();
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pw = '';
  for (let i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

module.exports = router;
module.exports.processDeadlines  = processDeadlines;
module.exports.advanceKnockout   = advanceKnockout;
module.exports.updateGroupStandings = updateGroupStandings;