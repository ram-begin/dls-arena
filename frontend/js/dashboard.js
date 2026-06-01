const user = requirePlayer();
if (!user) throw new Error('Not logged in');

let allTournaments = [], allRegs = [], allMatches = [];
let activeRegTournament = null, activeSubmitMatchId = null;

// ── INIT ──────────────────────────────────────────────────
async function init() {
  // Set navbar
  document.getElementById('navAvatar').textContent = user.name.charAt(0).toUpperCase();
  document.getElementById('navName').textContent   = user.name;

  await loadAll();
  renderPage('home');
  checkNotifications(); // show any pending notifications
  startPolling();
}

async function loadAll() {
  try {
    [allTournaments, allRegs, allMatches] = await Promise.all([
      API.get('/tournaments'),
      API.get('/registrations'),
      API.get('/matches')
    ]);
  } catch (e) { console.error('Load error', e); }
}

// ── PAGE ROUTER ───────────────────────────────────────────
function renderPage(name) {
  if (name === 'home')        renderHome();
  if (name === 'tournaments') renderTournaments();
  if (name === 'myregs')      renderMyEntries();
  if (name === 'mymatches')   renderSubmitResults();
  if (name === 'bracket')     initBracketTab();
  if (name === 'appeals')     renderAppeals();
}

// ── HOME TAB ──────────────────────────────────────────────
async function renderHome() {
  const myMatches = allMatches.filter(m => m.player1_id === user.id || m.player2_id === user.id);
  const played    = myMatches.filter(m => m.status === 'confirmed');
  const wins      = played.filter(m => {
    if (m.player1_id === user.id) return (m.score1 || 0) > (m.score2 || 0);
    return (m.score2 || 0) > (m.score1 || 0);
  });
  const winRate = played.length ? Math.round((wins.length / played.length) * 100) : 0;

  // Update hero
  document.getElementById('heroTitle').textContent = `Welcome, ${user.name}!`;
  const pending = myMatches.filter(m => m.status === 'pending' && !(
    (m.player1_id === user.id && m.p1_screenshot) ||
    (m.player2_id === user.id && m.p2_screenshot)
  ));
  document.getElementById('heroSub').textContent = pending.length
    ? `⚠ You have ${pending.length} match${pending.length > 1 ? 'es' : ''} waiting for your screenshot!`
    : 'Track your tournaments and results below.';

  // Fetch announcements
  let anns = [];
  try { anns = await API.get('/announcements'); } catch(e){}

  const upcoming = allTournaments.filter(t => t.status === 'open').slice(0, 5);
  const completed = allTournaments.filter(t => t.status === 'completed' && t.winner_name);

  // Activity feed
  const feed = [];
  [...allRegs].reverse().slice(0, 8).forEach(r => {
    const t = allTournaments.find(x => x.id === r.tournament_id);
    if (t) feed.push({ dot: 'blue', text: `<b>${r.player_name}</b> registered for <b>${t.name}</b>`, time: r.registered_at });
  });
  allMatches.filter(m => m.status === 'confirmed').slice(-5).reverse().forEach(m => {
    feed.push({ dot: 'green', text: `Match confirmed: <b>${m.player1_name}</b> vs <b>${m.player2_name}</b> — ${m.score1}–${m.score2}`, time: m.updated_at });
  });
  allTournaments.filter(t => t.status === 'ongoing').forEach(t => {
    feed.push({ dot: 'yellow', text: `Tournament started: <b>${t.name}</b>`, time: t.started_at });
  });
  feed.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  document.getElementById('tab-home').innerHTML = `
    <!-- Quick Actions -->
    <div style="display:flex;gap:10px;padding:16px 20px 0;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="switchTab('tournaments',document.getElementById('tabBtn-tournaments'))">🏆 Browse Tournaments</button>
      <button class="btn btn-warning" onclick="switchTab('mymatches',document.getElementById('tabBtn-mymatches'))">📤 Submit Results</button>
    </div>

    <!-- Announcements -->
    ${anns.length ? `<div style="margin:0 20px">${anns.slice(0, 3).map(a => `
      <div class="ann-banner" style="margin-top:14px">
        <div class="ann-icon">📢</div>
        <div class="ann-text">
          ${a.tournament_name ? `<span style="background:#238636;color:#fff;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-right:6px">${a.tournament_name}</span>` : ''}
          ${a.message}
          <div class="ann-time">${formatDateTime(a.created_at)}</div>
        </div>
      </div>`).join('')}</div>` : ''}

    <!-- My Stats -->
    <div style="padding:16px 20px 4px"><div class="section-hdr-title">📊 My Stats</div></div>
    <div class="stat-mini-grid">
      <div class="stat-mini"><div class="sm-val">${played.length}</div><div class="sm-lbl">Matches Played</div></div>
      <div class="stat-mini"><div class="sm-val">${wins.length}</div><div class="sm-lbl">Wins</div></div>
      <div class="stat-mini"><div class="sm-val">${played.length - wins.length}</div><div class="sm-lbl">Losses</div></div>
      <div class="stat-mini"><div class="sm-val" style="color:${winRate >= 50 ? 'var(--green)' : 'var(--red)'}">${winRate}%</div><div class="sm-lbl">Win Rate</div></div>
    </div>

    <!-- Tournament Schedule -->
    <div style="padding:16px 20px 4px"><div class="section-hdr-title">📅 Tournament Schedule</div></div>
    ${upcoming.length ? `<div class="schedule-card">${upcoming.map(t => `
      <div class="schedule-row">
        <div class="schedule-date">${t.date ? new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'TBA'}</div>
        <div class="schedule-name">${t.name}</div>
        <div class="schedule-badge">${t.format || 'KO'}</div>
        <div class="schedule-fee">${t.entry_fee ? '₹' + t.entry_fee : 'Free'}</div>
      </div>`).join('')}</div>`
    : `<div style="padding:0 20px 4px;color:var(--muted);font-size:13px">No open tournaments right now.</div>`}

    <!-- Hall of Fame -->
    ${completed.length ? `
    <div style="padding:16px 20px 4px"><div class="section-hdr-title">🏅 Hall of Fame</div></div>
    <div class="schedule-card">${completed.slice(0, 5).map(t => `
      <div class="hof-row">
        <div style="font-size:18px">🏆</div>
        <div style="flex:1">
          <div class="hof-winner">${t.winner_name}</div>
          <div class="hof-tournament">${t.name}</div>
        </div>
        <div style="font-size:11px;color:#484f58">${t.date ? new Date(t.date).getFullYear() : ''}</div>
      </div>`).join('')}</div>` : ''}

    <!-- Activity Feed -->
    ${feed.length ? `
    <div style="padding:16px 20px 4px"><div class="section-hdr-title">🔔 Activity Feed</div></div>
    <div class="schedule-card">${feed.slice(0, 6).map(f => `
      <div class="feed-row">
        <div class="feed-dot ${f.dot}"></div>
        <div class="feed-text">${f.text}</div>
        <div class="feed-time">${timeAgo(f.time)}</div>
      </div>`).join('')}</div>` : ''}

    <div style="height:24px"></div>
  `;
}

// ── TOURNAMENTS TAB ───────────────────────────────────────
function renderTournaments() {
  const el = document.getElementById('toursList');
  if (!allTournaments.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">🏆</div><p>No tournaments yet. Check back soon!</p></div>`;
    return;
  }

  el.innerHTML = allTournaments.map(t => {
    const myReg = allRegs.find(r => r.tournament_id === t.id && r.user_id === user.id);
    const confirmed = allRegs.filter(r => r.tournament_id === t.id && r.status === 'confirmed').length;
    const statusColor = t.status === 'open' ? 'var(--green)' : t.status === 'ongoing' ? 'var(--yellow)' : 'var(--muted)';
    const tName = escapeHtml(t.name);
    const tPrize = escapeHtml(t.prize);
    const tDesc  = escapeHtml(t.description);

    return `<div class="t-card">
      <div class="t-card-body">
        <div class="t-card-name">${tName}</div>
        <div class="t-card-meta">
          <span class="badge" style="color:${statusColor};background:var(--bg3)">${t.status.toUpperCase()}</span>
          <span class="badge badge-muted">${escapeHtml(t.format) || 'Knockout'}</span>
          ${t.entry_fee ? `<span class="badge badge-warning">₹${t.entry_fee} Entry</span>` : '<span class="badge badge-success">Free</span>'}
          ${tPrize ? `<span class="badge badge-info">🏆 ${tPrize}</span>` : ''}
          ${t.date ? `<span class="badge badge-muted">📅 ${formatDate(t.date)}</span>` : ''}
        </div>
        ${tDesc ? `<p style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5">${tDesc}</p>` : ''}
        <div class="t-card-footer">
          <span style="font-size:12px;color:var(--muted)">👥 ${confirmed}/${t.max_players} players</span>
          ${myReg
            ? `<span class="badge ${myReg.status === 'confirmed' ? 'badge-success' : myReg.status === 'rejected' ? 'badge-danger' : 'badge-warning'}">
                ${myReg.status === 'confirmed' ? '✅ Registered' : myReg.status === 'rejected' ? '❌ Rejected' : '⏳ Pending Payment'}
               </span>`
            : t.status === 'open'
              ? `<button class="btn btn-primary btn-sm" onclick="openRegModal('${t.id}')">Register →</button>`
              : `<span class="badge badge-muted">${t.status === 'ongoing' ? 'In Progress' : 'Completed'}</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── MY ENTRIES TAB ────────────────────────────────────────
function renderMyEntries() {
  const myRegs = allRegs.filter(r => r.user_id === user.id);
  const el = document.getElementById('myRegsList');

  if (!myRegs.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">🎟️</div><p>You haven't entered any tournaments yet.<br/><a href="#" onclick="switchTab('tournaments',document.getElementById('tabBtn-tournaments'))">Browse open tournaments →</a></p></div>`;
    return;
  }

  el.innerHTML = myRegs.map(reg => {
    const t = allTournaments.find(x => x.id === reg.tournament_id) || {};
    const tName      = escapeHtml(t.name || 'Tournament');
    const playerName = escapeHtml(reg.player_name);
    const teamName   = escapeHtml(reg.team_name);
    const myMatches = allMatches.filter(m =>
      m.tournament_id === reg.tournament_id &&
      (m.player1_id === user.id || m.player2_id === user.id)
    ).sort((a, b) => (a.round_num || 0) - (b.round_num || 0));

    const payBadge = reg.status === 'confirmed'
      ? `<span class="badge badge-success">✅ Paid</span>`
      : reg.status === 'rejected'
        ? `<span class="badge badge-danger">❌ Rejected</span>`
        : `<span class="badge badge-warning">⏳ Pending Payment</span>`;

    const tBadge = `<span class="badge badge-muted">${(t.status || 'open').toUpperCase()}</span>`;

    // Build match items
    const matchesHtml = buildMatchItems(myMatches, t);

    return `
    <div class="entry-card">
      <div class="entry-header" onclick="toggleEntry(this)">
        <div>
          <div class="entry-t-name">${tName}</div>
          <div class="entry-sub">Playing as: <b style="color:var(--green)">${playerName}</b>${teamName ? ` &nbsp;•&nbsp; Team: <b style="color:var(--yellow)">${teamName}</b>` : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${payBadge} ${tBadge}
          <span class="entry-chevron">▼</span>
        </div>
      </div>
      <div class="entry-body hidden">
        <div class="entry-meta">
          ${t.format ? `<span class="badge badge-success">${t.format}</span>` : ''}
          ${t.entry_fee ? `<span class="badge badge-warning">₹${t.entry_fee} Entry</span>` : ''}
          ${t.prize ? `<span class="badge badge-info">🏆 ${t.prize}</span>` : ''}
          ${t.date ? `<span class="badge badge-muted">📅 ${formatDate(t.date)}</span>` : ''}
        </div>

        ${reg.status === 'pending' && t.payment_link
          ? `<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
               <div style="font-size:12px;color:var(--muted);margin-bottom:6px">💳 Payment Instructions</div>
               <div style="font-size:13px;margin-bottom:8px">1. Pay ₹${t.entry_fee} via: <a href="${t.payment_link}" target="_blank" style="color:var(--blue)">Payment Link →</a></div>
               <div style="font-size:13px;margin-bottom:10px">2. In payment remarks/description, write your reference code:</div>
               <div style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;color:var(--yellow);letter-spacing:2px;margin-bottom:10px">${reg.payment_ref || '—'}</div>
               <div style="font-size:12px;color:var(--muted);margin-bottom:10px">3. After paying, enter your UPI/UTR transaction ID below:</div>
               ${reg.utr_number
                 ? `<div style="font-size:12px;color:var(--green)">✅ UTR submitted: <b>${reg.utr_number}</b> — waiting for admin confirmation</div>`
                 : `<div style="display:flex;gap:8px">
                      <input class="form-input" id="utr_${reg.id}" placeholder="e.g. 123456789012" style="flex:1;font-size:13px"/>
                      <button class="btn btn-primary btn-sm" onclick="submitUTR('${reg.id}')">Submit</button>
                    </div>`
               }
             </div>`
          : ''}

        <div class="match-section-label">My Matches</div>
        ${matchesHtml}
      </div>
    </div>`;
  }).join('') + '<div style="height:24px"></div>';
}

function buildMatchItems(matches, tournament) {
  if (!matches.length) {
    return `<div style="font-size:12px;color:var(--muted);padding:8px 0">
      ${tournament.status === 'open' ? 'Tournament hasn\'t started yet. Matches will appear here once the admin starts it.' : 'No matches assigned yet.'}
    </div>`;
  }

  return matches.map(m => {
    const isP1     = m.player1_id === user.id;
    const myScore  = isP1 ? m.score1 : m.score2;
    const oppScore = isP1 ? m.score2 : m.score1;
    const oppName  = escapeHtml(isP1 ? (m.player2_name || 'TBD') : (m.player1_name || 'TBD'));

    // Score box
    let scoreClass = 'tbd', scoreText = 'TBD';
    if (m.is_bye) {
      scoreText = 'BYE'; scoreClass = 'draw';
    } else if (m.status === 'confirmed' && myScore !== null) {
      scoreText  = `${myScore}–${oppScore}`;
      scoreClass = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw';
    } else if (m.status === 'pending_review') {
      scoreText = '🔍 Review'; scoreClass = 'review';
    }

    // Screenshot submission status
    const iSubmitted  = isP1 ? !!m.p1_screenshot : !!m.p2_screenshot;
    const oppSubmitted = isP1 ? !!m.p2_screenshot : !!m.p1_screenshot;
    const canUpload   = m.status === 'pending' && !iSubmitted && !m.is_bye;

    // Friends mode password — stored in DB, unique per match
    const friendsPw = m.friends_password || '------';

    // Countdown timer
    let countdownHtml = '';
    if (m.start_time && m.deadline && m.status === 'pending') {
      const deadline = new Date(m.deadline);
      const now = new Date();
      if (now < deadline) {
        const secsLeft = Math.floor((deadline - now) / 1000);
        const mins = Math.floor(secsLeft / 60);
        const secs = secsLeft % 60;
        countdownHtml = `<div id="countdown_${m.id}" style="font-size:12px;color:var(--yellow);margin-top:6px;font-weight:600">
          ⏰ Submit within: ${mins}m ${secs}s
        </div>`;
        setTimeout(() => startCountdown(m.id, deadline.toISOString()), 100);
      } else {
        countdownHtml = `<div style="font-size:12px;color:var(--red);margin-top:6px;font-weight:600">⏰ Deadline passed</div>`;
      }
    }

    return `
    <div class="match-item">
      <div class="match-round-name">${m.round || 'Match'}</div>
      <div class="match-vs-row">
        <span class="match-player-name me">${user.name}</span>
        <span class="match-score-box ${scoreClass}">${scoreText}</span>
        <span class="match-player-name opp" style="text-align:right">${oppName}</span>
      </div>

      ${m.status === 'pending' && !m.is_bye ? `
        <div style="margin-top:10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">🎮 Friends Mode Password</div>
          <div style="font-family:'Courier New',monospace;font-size:16px;font-weight:700;color:var(--yellow);letter-spacing:3px">${friendsPw}</div>
          <div style="font-size:10px;color:#484f58;margin-top:2px">Both you and your opponent use this same password in DLS Friends Mode</div>
        </div>
        ${countdownHtml}` : ''}

      <div class="match-status-row">
        <div class="match-submit-info">
          <span class="${iSubmitted ? 'dot-done' : 'dot-pending'}">${iSubmitted ? '✅' : '⬜'} You</span>
          <span class="${oppSubmitted ? 'dot-done' : 'dot-pending'}">${oppSubmitted ? '✅' : '⬜'} ${oppName}</span>
        </div>
        ${allTournaments.find(x => x.id === m.tournament_id)?.status === 'paused'
          ? `<span style="font-size:11px;color:var(--yellow)">⏸ Tournament paused by admin</span>`
          : canUpload
            ? `<button class="btn btn-primary btn-sm" onclick="openSubmitModal('${m.id}','${oppName}')">📤 Upload Screenshot</button>`
            : iSubmitted && m.status === 'pending'
              ? `<span style="font-size:11px;color:var(--muted)">Waiting for opponent…</span>`
              : ''
        }
      </div>
      ${m.deadline_expired ? `<div style="font-size:11px;color:var(--red);margin-top:6px">⏰ This match was decided by deadline</div>` : ''}
      ${m.disputed ? `<div style="font-size:11px;color:var(--red);margin-top:6px">⚠ This match had a score dispute</div>` : ''}
    </div>`;
  }).join('');
}

// ── SUBMIT RESULTS TAB ────────────────────────────────────
function renderSubmitResults() {
  const el = document.getElementById('myMatchesList');
  const pending = allMatches.filter(m =>
    (m.player1_id === user.id || m.player2_id === user.id) &&
    m.status === 'pending' &&
    !m.is_bye
  );

  if (!pending.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">📤</div><p>No pending matches to submit.<br/>Results appear here after your tournament match is scheduled.</p></div>`;
    return;
  }

  el.innerHTML = pending.map(m => {
    const isP1       = m.player1_id === user.id;
    const oppName    = isP1 ? (m.player2_name || 'TBD') : (m.player1_name || 'TBD');
    const iSubmitted = isP1 ? !!m.p1_screenshot : !!m.p2_screenshot;
    const friendsPw  = m.friends_password || '------';
    const t = allTournaments.find(x => x.id === m.tournament_id);

    // Countdown
    let countdownHtml = '';
    if (m.deadline) {
      const deadline = new Date(m.deadline);
      const now = new Date();
      if (now < deadline) {
        const secsLeft = Math.floor((deadline - now) / 1000);
        const mins = Math.floor(secsLeft / 60);
        const secs = secsLeft % 60;
        countdownHtml = `<div id="countdown_submit_${m.id}" style="font-size:13px;color:var(--yellow);font-weight:600;margin-bottom:10px">⏰ Submit within: ${mins}m ${secs}s</div>`;
        setTimeout(() => startCountdown(`submit_${m.id}`, deadline.toISOString()), 100);
      } else {
        countdownHtml = `<div style="font-size:13px;color:var(--red);font-weight:600;margin-bottom:10px">⏰ Deadline passed</div>`;
      }
    }

    return `<div class="t-card" style="margin-bottom:12px">
      <div class="t-card-body">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${t ? t.name : ''} • ${m.round || 'Match'}</div>
        ${countdownHtml}
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:15px;font-weight:600;color:var(--green)">${user.name}</span>
          <span style="font-size:13px;color:var(--muted)">vs</span>
          <span style="font-size:15px;font-weight:600">${oppName}</span>
        </div>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">🎮 Friends Mode Password</div>
          <div style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;color:var(--yellow);letter-spacing:3px">${friendsPw}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:12px;color:var(--muted)">
            ${iSubmitted ? '✅ You submitted' : '⬜ Not submitted yet'}
          </div>
          ${t?.status === 'paused'
            ? `<span style="font-size:12px;color:var(--yellow)">⏸ Tournament paused by admin</span>`
            : !iSubmitted
              ? `<button class="btn btn-primary btn-sm" onclick="openSubmitModal('${m.id}','${oppName}')">📤 Upload Screenshot</button>`
              : `<span style="font-size:12px;color:var(--muted)">Waiting for opponent…</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── REGISTRATION MODAL ────────────────────────────────────
function openRegModal(tournamentId) {
  activeRegTournament = allTournaments.find(t => t.id === tournamentId);
  if (!activeRegTournament) return;

  document.getElementById('regPlayerName').value = '';
  document.getElementById('regTeamName').value   = '';
  document.getElementById('regPhone').value      = '';
  document.getElementById('profileScreenshotFile').value = '';
  document.getElementById('profileUploadPreview').classList.add('hidden');
  document.getElementById('profileUploadZone').innerHTML = `
    <div class="uz-icon">📱</div>
    <p>Upload your DLS profile screenshot showing team name and stars</p>
    <p style="font-size:11px;margin-top:4px;color:var(--muted)">Open DLS → tap your profile → take screenshot</p>`;
  document.getElementById('regModalError').classList.add('hidden');

  const t = activeRegTournament;
  document.getElementById('regModalInfo').innerHTML = `
    <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;margin-bottom:8px">${t.name}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span class="badge badge-muted">${t.format || 'Knockout'}</span>
      ${t.entry_fee ? `<span class="badge badge-warning">₹${t.entry_fee} Entry Fee</span>` : '<span class="badge badge-success">Free</span>'}
      ${t.prize ? `<span class="badge badge-info">🏆 ${t.prize}</span>` : ''}
    </div>
    ${t.entry_fee && t.payment_link ? `<div style="font-size:12px;color:var(--muted);margin-top:8px">After registering, you'll be redirected to pay ₹${t.entry_fee}. Your spot is confirmed after admin verifies payment.</div>` : ''}
  `;
  document.getElementById('regModal').classList.remove('hidden');
}

function previewProfileScreenshot(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('profileUploadPreview');
    img.src = e.target.result;
    img.classList.remove('hidden');
    document.getElementById('profileUploadZone').innerHTML = `<p style="font-size:12px;color:var(--green)">✅ Profile screenshot selected — ${file.name}</p>`;
  };
  reader.readAsDataURL(file);
}

async function submitRegistration() {
  const playerName = document.getElementById('regPlayerName').value.trim();
  const teamName   = document.getElementById('regTeamName').value.trim();
  const phone      = document.getElementById('regPhone').value.trim();
  const file       = document.getElementById('profileScreenshotFile').files[0];
  const errEl      = document.getElementById('regModalError');

  if (!playerName) { errEl.textContent = '⚠ Please enter your DLS in-game name'; errEl.classList.remove('hidden'); return; }
  if (!teamName)   { errEl.textContent = '⚠ Please enter your DLS team name'; errEl.classList.remove('hidden'); return; }
  if (!phone)      { errEl.textContent = '⚠ Please enter your phone number'; errEl.classList.remove('hidden'); return; }
  if (!file)       { errEl.textContent = '⚠ Please upload your DLS profile screenshot'; errEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('regSubmitBtn');
  btn.disabled = true; btn.textContent = 'Registering…';
  errEl.classList.add('hidden');

  try {
    const fd = new FormData();
    fd.append('tournament_id', activeRegTournament.id);
    fd.append('player_name',   playerName);
    fd.append('team_name',     teamName);
    fd.append('phone',         phone);
    fd.append('profile_screenshot', file);
    await API.upload('/registrations', fd);

    closeModal('regModal');
    await loadAll();
    renderTournaments();
    renderMyEntries();

    if (activeRegTournament.entry_fee && activeRegTournament.payment_link) {
      setTimeout(() => { window.open(activeRegTournament.payment_link, '_blank'); }, 300);
    }
  } catch (e) {
    errEl.textContent = '⚠ ' + e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Register & Pay →';
  }
}

// ── SCREENSHOT SUBMIT MODAL ───────────────────────────────
function openSubmitModal(matchId, oppName) {
  activeSubmitMatchId = matchId;
  const m = allMatches.find(x => x.id === matchId);
  if (!m) return;

  document.getElementById('myScore').value     = '';
  document.getElementById('oppScore').value    = '';
  document.getElementById('screenshotFile').value = '';
  document.getElementById('uploadPreview').classList.add('hidden');
  document.getElementById('submitModalError').classList.add('hidden');
  document.getElementById('uploadZone').innerHTML = `
    <div class="uz-icon">📸</div>
    <p>Click to upload your DLS result screenshot</p>
    <p style="font-size:11px;margin-top:4px">JPG, PNG — max 5MB</p>`;

  document.getElementById('submitMatchInfo').innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;align-items:center;gap:10px">
      <div style="flex:1;font-size:14px;font-weight:600;color:var(--green)">${user.name}</div>
      <div style="font-size:12px;color:var(--muted)">vs</div>
      <div style="flex:1;font-size:14px;font-weight:600;text-align:right">${oppName}</div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5">
      Enter the score <b>as shown on your DLS result screen</b>. Your score on the left, opponent on the right.
    </div>`;

  document.getElementById('submitModal').classList.remove('hidden');
}

function previewScreenshot(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('uploadPreview');
    img.src = e.target.result;
    img.classList.remove('hidden');
    document.getElementById('uploadZone').innerHTML = `<p style="font-size:12px;color:var(--green)">✅ Screenshot selected — ${file.name}</p>`;
  };
  reader.readAsDataURL(file);
}

async function doSubmitResult() {
  const myScore  = document.getElementById('myScore').value;
  const oppScore = document.getElementById('oppScore').value;
  const file     = document.getElementById('screenshotFile').files[0];
  const errEl    = document.getElementById('submitModalError');

  if (myScore === '' || oppScore === '') { errEl.textContent = '⚠ Please enter both scores'; errEl.classList.remove('hidden'); return; }
  if (!file) { errEl.textContent = '⚠ Please upload your screenshot'; errEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('submitResultBtn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  errEl.classList.add('hidden');

  try {
    const fd = new FormData();
    fd.append('screenshot', file);
    fd.append('my_score',   myScore);
    fd.append('opp_score',  oppScore);
    await API.upload(`/matches/${activeSubmitMatchId}/submit`, fd);

    closeModal('submitModal');
    await loadAll();
    renderMyEntries();
    renderSubmitResults();
    alert('✅ Screenshot submitted! Waiting for your opponent to submit theirs. Admin will confirm the result once both are in.');
  } catch (e) {
    errEl.textContent = '⚠ ' + e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Result';
  }
}

// ── HELPERS ───────────────────────────────────────────────
function toggleEntry(header) {
  const body    = header.nextElementSibling;
  const chevron = header.querySelector('.entry-chevron');
  body.classList.toggle('hidden');
  chevron.classList.toggle('open');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function logout() { performLogout('/'); }

// ── BRACKET TAB ───────────────────────────────────────────
function initBracketTab() {
  const sel = document.getElementById('bracketTournamentSelect');
  const myTournamentIds = [...new Set(allRegs.filter(r => r.user_id === user.id).map(r => r.tournament_id))];
  sel.innerHTML = '<option value="">— Select a tournament —</option>' +
    allTournaments
      .map(t => `<option value="${t.id}">${t.name} (${t.status})</option>`)
      .join('');
  if (sel.options.length === 2) { sel.value = sel.options[1].value; renderBracket(); }
}

function renderBracket() {
  const tid = document.getElementById('bracketTournamentSelect').value;
  const el  = document.getElementById('bracketView');
  if (!tid) { el.innerHTML = ''; return; }

  const t = allTournaments.find(x => x.id === tid);
  const matches = allMatches.filter(m => m.tournament_id === tid && !m.is_bye);

  if (!matches.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">🏟️</div><p>Tournament hasn't started yet.<br/>Bracket will appear once matches are generated.</p></div>`;
    return;
  }

  // Group by round
  const rounds = {};
  matches.forEach(m => {
    const key = m.round || 'Match';
    if (!rounds[key]) rounds[key] = [];
    rounds[key].push(m);
  });

  const roundOrder = ['Group A','Group B','Group C','Group D','League','Round of 16','Quarter Final','Semi Final','Final'];
  const sortedRounds = Object.keys(rounds).sort((a, b) => {
    const ai = roundOrder.indexOf(a), bi = roundOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  el.innerHTML = sortedRounds.map(roundName => {
    const roundMatches = rounds[roundName];
    return `
    <div style="margin-bottom:20px">
      <div style="font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;color:var(--muted);
        text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;padding-bottom:6px;
        border-bottom:1px solid var(--border)">${roundName}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${roundMatches.map(m => {
          const isMyMatch = m.player1_id === user.id || m.player2_id === user.id;
          const p1Won = m.status === 'confirmed' && (m.score1 || 0) > (m.score2 || 0);
          const p2Won = m.status === 'confirmed' && (m.score2 || 0) > (m.score1 || 0);
          return `
          <div style="background:${isMyMatch ? 'rgba(63,185,80,.06)' : 'var(--bg2)'};
            border:1px solid ${isMyMatch ? 'var(--green)' : 'var(--border)'};
            border-radius:10px;overflow:hidden">
            <div style="display:grid;grid-template-columns:1fr auto 1fr">
              <!-- Player 1 -->
              <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;
                ${p1Won ? 'background:rgba(63,185,80,.08)' : ''}">
                ${p1Won ? '<span style="font-size:14px">🏆</span>' : ''}
                <span style="font-size:13px;font-weight:${p1Won ? '700' : '500'};
                  color:${m.player1_id === user.id ? 'var(--green)' : p1Won ? 'var(--text)' : 'var(--muted)'};
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${m.player1_name || 'TBD'}
                </span>
              </div>
              <!-- Score -->
              <div style="padding:10px 12px;display:flex;align-items:center;justify-content:center;
                background:var(--bg3);gap:6px;min-width:80px">
                ${m.status === 'confirmed'
                  ? `<span style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:var(--text)">${m.score1 ?? 0}</span>
                     <span style="color:var(--muted);font-size:12px">–</span>
                     <span style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:var(--text)">${m.score2 ?? 0}</span>`
                  : m.status === 'pending_review'
                    ? `<span style="font-size:10px;color:var(--blue);font-weight:600">REVIEW</span>`
                    : `<span style="font-size:11px;color:var(--muted)">vs</span>`
                }
              </div>
              <!-- Player 2 -->
              <div style="padding:10px 14px;display:flex;align-items:center;justify-content:flex-end;gap:8px;
                ${p2Won ? 'background:rgba(63,185,80,.08)' : ''}">
                <span style="font-size:13px;font-weight:${p2Won ? '700' : '500'};
                  color:${m.player2_id === user.id ? 'var(--green)' : p2Won ? 'var(--text)' : 'var(--muted)'};
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">
                  ${m.player2_name || 'TBD'}
                </span>
                ${p2Won ? '<span style="font-size:14px">🏆</span>' : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('') +
  (t?.winner_name ? `
    <div style="text-align:center;padding:20px;background:linear-gradient(135deg,#0d2818,#2d2103);
      border:1px solid var(--yellow);border-radius:14px;margin-top:8px">
      <div style="font-size:32px;margin-bottom:6px">🏆</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;color:var(--yellow)">${t.winner_name}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">Tournament Champion</div>
    </div>` : '');
}

// ── UTR SUBMISSION ────────────────────────────────────────
async function submitUTR(regId) {
  const input = document.getElementById(`utr_${regId}`);
  const utr = input?.value.trim();
  if (!utr) { alert('Please enter your UTR / Transaction ID'); return; }
  try {
    await API.put(`/registrations/${regId}/utr`, { utr_number: utr });
    await loadAll();
    renderMyEntries();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── COUNTDOWN TIMER ───────────────────────────────────────
const countdownIntervals = {};
function startCountdown(id, deadlineISO) {
  if (countdownIntervals[id]) clearInterval(countdownIntervals[id]);
  countdownIntervals[id] = setInterval(() => {
    const el = document.getElementById(`countdown_${id}`);
    if (!el) { clearInterval(countdownIntervals[id]); return; }
    const secsLeft = Math.floor((new Date(deadlineISO) - new Date()) / 1000);
    if (secsLeft <= 0) {
      el.innerHTML = '⏰ Deadline passed';
      el.style.color = 'var(--red)';
      clearInterval(countdownIntervals[id]);
      return;
    }
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    el.innerHTML = `⏰ Submit within: <b>${mins}m ${String(secs).padStart(2,'0')}s</b>`;
    if (secsLeft < 120) el.style.color = 'var(--red)'; // red when under 2 min
  }, 1000);
}

// ── CHECK NOTIFICATIONS ───────────────────────────────────
async function checkNotifications() {
  try {
    const regs = await API.get('/registrations');
    regs.forEach(reg => {
      if (reg.notification && reg.user_id === user.id) {
        showNotificationBanner(reg.notification);
      }
    });
  } catch (e) {}
}

function showNotificationBanner(msg) {
  const existing = document.getElementById('notifBanner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'notifBanner';
  banner.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);
    background:#161b22;border:1px solid var(--blue);border-left:3px solid var(--blue);
    border-radius:10px;padding:12px 20px;max-width:500px;width:90%;z-index:999;
    font-size:13px;color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.5);display:flex;gap:12px;align-items:flex-start`;
  banner.innerHTML = `
    <div style="font-size:20px">📢</div>
    <div style="flex:1;line-height:1.5">${msg}</div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;flex-shrink:0">✕</button>`;
  document.body.appendChild(banner);
}
// ── REAL-TIME POLLING (every 30s) ─────────────────────────
function startPolling() {
  setInterval(async () => {
    const prevMatches = JSON.stringify(allMatches);
    const prevRegs    = JSON.stringify(allRegs);
    await loadAll();

    // Check for new notifications
    checkNotifications();
    

    // If current tab data changed, re-render silently
    const tab = document.querySelector('.tab-btn.active')?.id?.replace('tabBtn-','');
    if (tab === 'mymatches' && JSON.stringify(allMatches) !== prevMatches) renderSubmitResults();
    if (tab === 'myregs'    && JSON.stringify(allRegs)    !== prevRegs)    renderMyEntries();
    if (tab === 'bracket'   && JSON.stringify(allMatches) !== prevMatches) renderBracket();

    // Show notification dot on tabs if something changed
    if (JSON.stringify(allMatches) !== prevMatches) showTabDot('tabBtn-mymatches');
    if (JSON.stringify(allRegs)    !== prevRegs)    showTabDot('tabBtn-myregs');
  }, 30000); // every 30 seconds
}

function showTabDot(tabId) {
  const btn = document.getElementById(tabId);
  if (!btn || btn.classList.contains('active')) return;
  if (!btn.querySelector('.tab-dot')) {
    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.style.cssText = 'width:7px;height:7px;background:var(--red);border-radius:50%;display:inline-block;margin-left:5px;vertical-align:middle';
    btn.appendChild(dot);
  }
}
// ── APPEALS TAB ───────────────────────────────────────────
async function renderAppeals() {
  const el = document.getElementById('appealsList');
  let appeals = [];
  try { appeals = await API.get('/appeals'); } catch(e) {}

  const appealableMatches = allMatches.filter(m =>
    (m.player1_id === user.id || m.player2_id === user.id) &&
    m.status === 'confirmed' && !m.is_bye
  ).filter(m => {
    const isP1     = m.player1_id === user.id;
    const myScore  = isP1 ? m.score1 : m.score2;
    const oppScore = isP1 ? m.score2 : m.score1;
    return myScore < oppScore && !appeals.find(a => a.match_id === m.id);
  });

  el.innerHTML = `
    ${appealableMatches.length ? `
    <div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;color:var(--blue);margin-bottom:8px">📋 Matches You Can Appeal</div>
      ${appealableMatches.map(m => {
        const isP1    = m.player1_id === user.id;
        const oppName = escapeHtml(isP1 ? m.player2_name : m.player1_name);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px">${escapeHtml(m.round)} vs ${oppName} — <span style="color:var(--red)">${m.score1}–${m.score2}</span></div>
          <button class="btn btn-primary btn-sm" onclick="openAppealModal('${m.id}','${oppName}')">⚖️ Appeal</button>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${appeals.length ? `
    <div class="match-section-label">YOUR APPEALS</div>
    ${appeals.map(a => `
      <div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${
        a.status === 'overturned' ? 'var(--green)' : a.status === 'upheld' ? 'var(--red)' : 'var(--yellow)'
      };border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:600;font-size:13px">${escapeHtml(a.match_round)} vs ${escapeHtml(a.opponent_name)} — ${escapeHtml(a.score)}</div>
          <span class="badge ${a.status === 'overturned' ? 'badge-success' : a.status === 'upheld' ? 'badge-danger' : 'badge-warning'}">
            ${a.status === 'overturned' ? '✅ Overturned' : a.status === 'upheld' ? '❌ Upheld' : '⏳ Pending'}
          </span>
        </div>
        <div style="font-size:12px;color:var(--muted)">Your reason: ${escapeHtml(a.reason)}</div>
        ${a.admin_response ? `<div style="font-size:12px;color:var(--text);margin-top:6px">Admin: ${escapeHtml(a.admin_response)}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);margin-top:4px">${formatDateTime(a.submitted_at)}</div>
      </div>`).join('')}
    ` : !appealableMatches.length ? `<div class="dash-empty"><div class="de-icon">⚖️</div><p>No appeals yet.<br/>If you believe a match result was wrong, you can appeal it here.</p></div>` : ''}
  `;
}

function openAppealModal(matchId, oppName) {
  const reason = prompt(`Appeal match vs ${oppName}\n\nDescribe why you think the result was wrong:`);
  if (!reason?.trim()) return;
  API.post('/appeals', { match_id: matchId, reason })
    .then(() => { alert('✅ Appeal submitted. Admin will review it.'); renderAppeals(); })
    .catch(e => alert('⚠ ' + e.message));
}
// ── START ─────────────────────────────────────────────────
init();