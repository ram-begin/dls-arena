const user = requireAdmin();

// ── ADMIN SESSION TIMEOUT (Fix #17) ──────────────────────
// Auto-logout after 30 minutes of inactivity
let adminActivityTimer;
function resetAdminTimer() {
  clearTimeout(adminActivityTimer);
  adminActivityTimer = setTimeout(() => {
    alert('⚠ Session expired due to inactivity. You will be logged out.');
    performLogout('/admin-login.html');
  }, 30 * 60 * 1000); // 30 minutes
}
// Track any user interaction
['click','keydown','mousemove','touchstart'].forEach(e =>
  document.addEventListener(e, resetAdminTimer, { passive: true })
);
resetAdminTimer(); // start timer immediately

if (!user) throw new Error('Not admin');

let allTournaments = [], allRegs = [], allUsers = [], allMatches = [];

// ── INIT ──────────────────────────────────────────────────
async function init() {
  await loadAll();
  renderPage('overview');
}

async function loadAll() {
  try {
    [allTournaments, allRegs, allUsers, allMatches] = await Promise.all([
      API.get('/tournaments'),
      API.get('/registrations'),
      API.get('/auth/users').catch(() => []),
      API.get('/matches')
    ]);
  } catch (e) { console.error('Load error', e); }
}

// ── PAGE ROUTER ───────────────────────────────────────────
function renderPage(name) {
  if (name === 'overview')      renderOverview();
  if (name === 'tournaments')   renderAdminTournaments();
  if (name === 'payments')      renderPayments();
  if (name === 'reviews')       renderReviews();
  if (name === 'players')       renderPlayers();
  if (name === 'announcements') { renderAnnouncements(); populateAnnDropdown(); }
  if (name === 'revenue')       renderRevenue();
  if (name === 'players-detail') renderPlayersDetail();
  if (name === 'refunds')       renderRefunds();
  if (name === 'auditlog')      renderAuditLog();
  if (name === 'appeals')       renderAdminAppeals();
  if (name === 'resets')        renderResetRequests();
}

// ── OVERVIEW ──────────────────────────────────────────────
function renderOverview() {
  const totalRevenue = allRegs.filter(r => r.status === 'confirmed').reduce((sum, r) => {
    const t = allTournaments.find(x => x.id === r.tournament_id);
    return sum + (t ? (parseFloat(t.entry_fee) || 0) : 0);
  }, 0);
  const pending = allRegs.filter(r => r.status === 'pending').length;
  const reviews = allMatches.filter(m => m.status === 'pending_review').length;

  document.getElementById('overviewStats').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card" onclick="switchTab('revenue', document.getElementById('tabBtn-overview')); renderPage('revenue')">
        <div class="sc-icon">💰</div>
        <div class="sc-val" style="color:var(--green)">₹${totalRevenue}</div>
        <div class="sc-lbl">Total Revenue — click for breakdown</div>
      </div>
      <div class="stat-card" onclick="switchTab('players-detail', document.getElementById('tabBtn-overview')); renderPage('players-detail')">
        <div class="sc-icon">👥</div>
        <div class="sc-val" style="color:var(--blue)">${allUsers.length || allRegs.length}</div>
        <div class="sc-lbl">Players — click to view all</div>
      </div>
    </div>
    ${pending > 0 ? `<div class="ann-banner" style="margin:14px 0"><div class="ann-icon">⏳</div><div class="ann-text"><b>${pending}</b> payments waiting for confirmation. <a href="#" onclick="switchTab('payments',document.getElementById('tabBtn-payments'));return false" style="color:var(--blue)">Review now →</a></div></div>` : ''}
    ${reviews > 0 ? `<div class="ann-banner" style="margin:14px 0;border-left-color:var(--yellow)"><div class="ann-icon">🔍</div><div class="ann-text"><b>${reviews}</b> match screenshot${reviews > 1 ? 's' : ''} waiting for review. <a href="#" onclick="switchTab('reviews',document.getElementById('tabBtn-reviews'));return false" style="color:var(--blue)">Review now →</a></div></div>` : ''}
    <div style="margin-top:20px">
      <div class="section-label" style="padding:0 0 8px">ACTIVE TOURNAMENTS</div>
      ${allTournaments.filter(t => t.status !== 'completed').map(t => {
        const conf = allRegs.filter(r => r.tournament_id === t.id && r.status === 'confirmed').length;
        return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-weight:600;margin-bottom:2px">${t.name}</div>
            <div style="font-size:11px;color:var(--muted)">${t.format} • ${conf} confirmed players</div>
          </div>
          <span class="badge ${t.status === 'open' ? 'badge-success' : 'badge-warning'}">${t.status.toUpperCase()}</span>
        </div>`;
      }).join('') || '<div style="color:var(--muted);font-size:13px">No active tournaments</div>'}
    </div>
    <div style="height:20px"></div>
  `;
}

// ── TOURNAMENTS ───────────────────────────────────────────
function renderAdminTournaments() {
  const el = document.getElementById('adminToursList');
  if (!allTournaments.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">🏆</div><p>No tournaments yet. Create one above.</p></div>`;
    return;
  }

  el.innerHTML = allTournaments.map(t => {
    const regs  = allRegs.filter(r => r.tournament_id === t.id);
    const conf  = regs.filter(r => r.status === 'confirmed');
    const pend  = regs.filter(r => r.status === 'pending');
    const revenue = conf.reduce((s, _) => s + (parseFloat(t.entry_fee) || 0), 0);

    return `
    <div class="card" style="margin-bottom:14px">
      <div style="background:linear-gradient(135deg,#0d2818,#0f1f30);padding:14px 16px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700">${t.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${t.format} • ${t.date ? formatDate(t.date) : 'No date set'}</div>
        </div>
        <span class="badge ${t.status === 'open' ? 'badge-success' : t.status === 'ongoing' ? 'badge-warning' : 'badge-muted'}">${t.status.toUpperCase()}</span>
      </div>
      <div class="card-body">
        <!-- Badges -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${t.entry_fee ? `<span class="badge badge-warning">₹${t.entry_fee} Entry</span>` : '<span class="badge badge-success">Free</span>'}
          ${t.prize ? `<span class="badge badge-info">🏆 ${t.prize}</span>` : ''}
          <span class="badge badge-muted">👥 ${conf.length}/${t.max_players} confirmed</span>
          ${pend.length ? `<span class="badge badge-warning">⏳ ${pend.length} pending</span>` : ''}
          <span class="badge badge-success">💰 ₹${revenue} collected</span>
        </div>

        <!-- Confirmed players -->
        ${conf.length ? `
        <div style="margin-bottom:12px">
          <div class="match-section-label">Confirmed Players (${conf.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${conf.map(r => `<span style="background:var(--green-bg);border:1px solid #238636;color:var(--green);padding:3px 10px;border-radius:20px;font-size:12px">${r.player_name}</span>`).join('')}
          </div>
        </div>` : ''}

        <!-- Pending players with confirm/reject -->
        ${pend.length ? `
        <div style="margin-bottom:12px">
          <div class="match-section-label">Pending Payment (${pend.length})</div>
          ${pend.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bg3)">
            <span style="font-size:13px">${r.player_name}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-primary btn-sm" onclick="confirmReg('${r.id}')">✅ Confirm</button>
              <button class="btn btn-danger  btn-sm" onclick="rejectReg('${r.id}')">✕ Reject</button>
            </div>
          </div>`).join('')}
        </div>` : ''}

        <!-- Actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--bg3)">
          ${t.status === 'open'
            ? `<button class="btn btn-primary btn-sm" onclick="startTournament('${t.id}')">▶ Start Tournament</button>
               <button class="btn btn-ghost btn-sm" onclick="previewDraw('${t.id}')">🎲 Preview Draw</button>`
            : t.status === 'ongoing'
              ? `<button class="btn btn-warning btn-sm" onclick="switchTab('reviews',document.getElementById('tabBtn-reviews'))">🔍 Review Scores</button>
                 <button class="btn btn-blue btn-sm" onclick="showMatchScheduler('${t.id}')">⏰ Set Match Times</button>
                 <button class="btn btn-ghost btn-sm" onclick="pauseTournament('${t.id}')">⏸ Pause</button>`
              : t.status === 'paused'
                ? `<button class="btn btn-primary btn-sm" onclick="unpauseTournament('${t.id}')">▶ Resume</button>
                   <span class="badge badge-warning">⏸ PAUSED</span>`
                : t.winner_name ? `<span class="badge badge-success">🏆 Winner: ${t.winner_name}</span>` : ''
          }
          <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteTournament('${t.id}')">🗑 Delete</button>
          ${t.status === 'open' ? `<button class="btn btn-ghost btn-sm" onclick="openEditTournament('${t.id}')">✏️ Edit</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── PAYMENTS ──────────────────────────────────────────────
function renderPayments() {
  const pending   = allRegs.filter(r => r.status === 'pending');
  const confirmed = allRegs.filter(r => r.status === 'confirmed');

  document.getElementById('pendingCount').textContent = pending.length ? `(${pending.length})` : '';

  const pendEl = document.getElementById('pendingPayments');
  pendEl.innerHTML = pending.length
    ? pending.map(r => paymentCard(r, true)).join('')
    : `<div style="color:var(--muted);font-size:13px;padding:8px 0">No pending payments.</div>`;

  const confEl = document.getElementById('confirmedPayments');
  confEl.innerHTML = confirmed.length
    ? confirmed.map(r => paymentCard(r, false)).join('')
    : `<div style="color:var(--muted);font-size:13px;padding:8px 0">No confirmed payments yet.</div>`;
}

function paymentCard(reg, showActions) {
  const t = allTournaments.find(x => x.id === reg.tournament_id);
  const waLink = reg.phone ? `https://wa.me/91${reg.phone}` : null;
  return `
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div style="flex:1">
        <div style="font-weight:600">${reg.player_name} <span style="font-size:11px;color:var(--muted);font-weight:400">— ${reg.team_name || '—'}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${t ? t.name : 'Unknown'} • ${t && t.entry_fee ? '₹' + t.entry_fee : 'Free'} • ${formatDate(reg.registered_at)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${reg.phone ? `<span style="font-size:12px;color:var(--muted)">📱 ${reg.phone}</span>
            <a href="${waLink}" target="_blank" class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:11px">💬 WhatsApp</a>` : ''}
        </div>
        ${reg.payment_ref ? `<div style="font-size:11px;margin-top:6px;color:var(--muted)">Ref Code: <span style="font-family:'Courier New',monospace;color:var(--yellow);font-weight:700">${reg.payment_ref}</span></div>` : ''}
        ${reg.utr_number
          ? `<div style="font-size:11px;margin-top:4px;color:var(--green)">✅ UTR: <b>${reg.utr_number}</b> <span style="color:var(--muted)">(submitted ${formatDate(reg.utr_submitted_at)})</span></div>`
          : showActions ? `<div style="font-size:11px;margin-top:4px;color:var(--yellow)">⚠ No UTR submitted yet</div>` : ''
        }
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        ${reg.profile_screenshot ? `<a href="${uploadUrl(reg.profile_screenshot)}" target="_blank"><img src="${uploadUrl(reg.profile_screenshot)}" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" title="DLS Profile"/></a>` : ''}
        ${showActions ? `
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" onclick="confirmReg('${reg.id}')">✅ Confirm</button>
          <button class="btn btn-danger  btn-sm" onclick="rejectReg('${reg.id}')">✕ Reject</button>
        </div>` : `<span class="badge badge-success">✅ Confirmed</span>`}
      </div>
    </div>
  </div>`;
}

async function confirmReg(id) {
  try { await API.put(`/registrations/${id}/confirm`, {}); await loadAll(); renderPage(currentTab()); }
  catch (e) { alert('Error: ' + e.message); }
}
async function rejectReg(id) {
  if (!confirm('Reject this registration?')) return;
  try { await API.put(`/registrations/${id}/reject`, {}); await loadAll(); renderPage(currentTab()); }
  catch (e) { alert('Error: ' + e.message); }
}

// ── SCORE REVIEWS ─────────────────────────────────────────
function renderReviews() {
  const reviews = allMatches.filter(m => m.status === 'pending_review');
  const el = document.getElementById('reviewsList');

  if (!reviews.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">✅</div><p>No matches pending review.</p></div>`;
    return;
  }

  el.innerHTML = reviews.map(m => {
    const t = allTournaments.find(x => x.id === m.tournament_id);
    const p1Name  = escapeHtml(m.player1_name);
    const p2Name  = escapeHtml(m.player2_name);
    const tName   = escapeHtml(t ? t.name : '');
    const p1Score = escapeHtml(m.p1_submitted_score || '?');
    const p2Score = escapeHtml(m.p2_submitted_score || '?');
    const scoresMatch = p1Score !== '?' && p2Score !== '?'
      ? p1Score === reverseScore(p2Score)
      : false;

    return `
    <div class="review-card">
      <div class="review-header">
        <div>
          <div style="font-weight:600">${p1Name} vs ${p2Name}</div>
          <div style="font-size:11px;color:var(--muted)">${tName} • ${escapeHtml(m.round || 'Match')}</div>
        </div>
        <span class="badge ${scoresMatch ? 'badge-success' : 'badge-warning'}">${scoresMatch ? '✅ Scores Match' : '⚠ Verify'}</span>
      </div>
      <div class="review-body">
        <div class="screenshots-row">
          <div class="screenshot-box">
            <div class="sb-label">📱 ${p1Name}</div>
            <div class="sb-score">${p1Score}</div>
            ${m.p1_screenshot ? `<img src="${uploadUrl(m.p1_screenshot)}" alt="P1 screenshot" loading="lazy"/>` : '<div style="color:var(--muted);font-size:12px;margin-top:8px">No screenshot yet</div>'}
          </div>
          <div class="screenshot-box">
            <div class="sb-label">📱 ${p2Name}</div>
            <div class="sb-score">${p2Score}</div>
            ${m.p2_screenshot ? `<img src="${uploadUrl(m.p2_screenshot)}" alt="P2 screenshot" loading="lazy"/>` : '<div style="color:var(--muted);font-size:12px;margin-top:8px">No screenshot yet</div>'}
          </div>
        </div>

        <div style="margin-bottom:12px">
          <label class="form-label">Final Score (override if needed)</label>
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center">
            <input class="form-input" type="number" id="cs1_${m.id}" value="${m.score1 ?? ''}" min="0" style="text-align:center;font-size:18px;font-family:'Rajdhani',sans-serif"/>
            <div class="score-vs">–</div>
            <input class="form-input" type="number" id="cs2_${m.id}" value="${m.score2 ?? ''}" min="0" style="text-align:center;font-size:18px;font-family:'Rajdhani',sans-serif"/>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px">
            <span>${p1Name}</span>
            <span>${p2Name}</span>
          </div>
        </div>

        <div class="review-actions">
          <button class="btn btn-primary" onclick="confirmScore('${m.id}')">✅ Confirm Score</button>
          <button class="btn btn-danger btn-sm" onclick="disputeMatch('${m.id}','player1')">Disqualify ${p1Name}</button>
          <button class="btn btn-danger btn-sm" onclick="disputeMatch('${m.id}','player2')">Disqualify ${p2Name}</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function reverseScore(score) {
  const parts = score.split('-');
  if (parts.length === 2) return `${parts[1]}-${parts[0]}`;
  return score;
}

async function confirmScore(matchId) {
  const s1 = document.getElementById(`cs1_${matchId}`).value;
  const s2 = document.getElementById(`cs2_${matchId}`).value;
  if (s1 === '' || s2 === '') return alert('Enter both scores before confirming');
  try {
    await API.put(`/matches/${matchId}/confirm`, { score1: parseInt(s1), score2: parseInt(s2) });
    await loadAll(); renderReviews();
  } catch (e) { alert('Error: ' + e.message); }
}

async function disputeMatch(matchId, player) {
  if (!confirm(`Disqualify ${player === 'player1' ? 'Player 1' : 'Player 2'}? They will lose this match 0–1.`)) return;
  try {
    await API.put(`/matches/${matchId}/dispute`, { disqualify_player: player });
    await loadAll(); renderReviews();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── PLAYERS ───────────────────────────────────────────────
function renderPlayers() {
  const el = document.getElementById('playersList');
  const users = allUsers.filter(u => !u.is_admin);
  if (!users.length) {
    const uniqueNames = [...new Set(allRegs.map(r => r.player_name))];
    el.innerHTML = uniqueNames.length
      ? uniqueNames.map(n => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">${n}</div>`).join('')
      : `<div class="dash-empty"><div class="de-icon">👥</div><p>No players registered yet.</p></div>`;
    return;
  }
  el.innerHTML = users.map(u => {
    const myRegs = allRegs.filter(r => r.user_id === u.id);
    const waLink = u.phone ? `https://wa.me/91${u.phone}` : null;
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
      <div class="nav-avatar">${u.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div style="font-weight:600">${u.name}</div>
        <div style="font-size:11px;color:var(--muted)">${u.email} • ${myRegs.length} tournament${myRegs.length !== 1 ? 's' : ''}</div>
        ${u.phone ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">📱 ${u.phone}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary btn-sm" style="font-size:11px">💬 WhatsApp</a>` : ''}
        <div style="font-size:12px;color:var(--muted)">${formatDate(u.created_at)}</div>
        <button class="btn btn-danger btn-sm" onclick="deletePlayer('${u.id}','${u.name}')">🗑</button>
        <button class="btn btn-ghost btn-sm" onclick="blockPlayer('${u.id}','${u.name}')">🚫</button>
      </div>
    </div>`;
  }).join('');
}

// ── ANNOUNCEMENTS ─────────────────────────────────────────
function populateAnnDropdown() {
  const sel = document.getElementById('annTournament');
  const active = allTournaments.filter(t => t.status !== 'completed');
  sel.innerHTML = '<option value="">— General announcement —</option>' +
    active.map(t => `<option value="${t.id}" data-name="${t.name}">${t.name}</option>`).join('');
}

async function postAnnouncement() {
  const msg = document.getElementById('annMessage').value.trim();
  if (!msg) return alert('Please enter a message');
  const sel   = document.getElementById('annTournament');
  const tid   = sel.value;
  const tname = tid ? sel.options[sel.selectedIndex].dataset.name : null;
  try {
    await API.post('/announcements', { message: msg, tournament_id: tid || null, tournament_name: tname });
    document.getElementById('annMessage').value = '';
    sel.value = '';
    await loadAll();
    renderAnnouncements();
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  try {
    await API.delete(`/announcements/${id}`);
    await loadAll();
    renderAnnouncements();
  } catch (e) { alert('Error: ' + e.message); }
}

async function renderAnnouncements() {
  let anns = [];
  try { anns = await API.get('/announcements'); } catch (e) {}
  const el = document.getElementById('annList');
  if (!anns.length) { el.innerHTML = `<div style="color:var(--muted);font-size:13px">No announcements posted yet.</div>`; return; }
  el.innerHTML = anns.map(a => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="font-size:13px;color:var(--muted);line-height:1.5">
          ${a.tournament_name ? `<span style="background:#238636;color:#fff;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-right:6px">${a.tournament_name}</span>` : ''}
          ${a.message}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="deleteAnnouncement('${a.id}')" style="flex-shrink:0;color:var(--red)">✕</button>
      </div>
      <div style="font-size:11px;color:#484f58;margin-top:6px">${formatDateTime(a.created_at)}</div>
    </div>`).join('');
}

// ── REVENUE ───────────────────────────────────────────────
function renderRevenue() {
  const el = document.getElementById('revenueDetail');
  const withFee = allTournaments.filter(t => t.entry_fee > 0);
  if (!withFee.length) { el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0">No paid tournaments yet.</div>`; return; }

  let totalAll = 0;
  el.innerHTML = withFee.map(t => {
    const conf = allRegs.filter(r => r.tournament_id === t.id && r.status === 'confirmed');
    const rev  = conf.length * (parseFloat(t.entry_fee) || 0);
    const pct  = Math.round((conf.length / t.max_players) * 100);
    totalAll  += rev;
    return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <div style="font-weight:600">${t.name}</div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:var(--green)">₹${rev}</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;height:6px;margin-bottom:8px">
          <div style="background:var(--green);height:100%;border-radius:6px;width:${pct}%"></div>
        </div>
        <div style="font-size:12px;color:var(--muted)">${conf.length}/${t.max_players} slots sold • ₹${t.entry_fee} per player</div>
        ${conf.length ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${conf.map(r => `<span style="background:var(--green-bg);color:var(--green);border:1px solid #238636;padding:2px 10px;border-radius:20px;font-size:11px">${r.player_name}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('') + `<div style="text-align:right;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;color:var(--green);padding:8px 0">Total: ₹${totalAll}</div>`;
}

// ── PLAYERS DETAIL ────────────────────────────────────────
function renderPlayersDetail() {
  renderPlayers();
  document.getElementById('playersDetail').innerHTML = document.getElementById('playersList').innerHTML;
}

// ── TOURNAMENTS CRUD ──────────────────────────────────────
function toggleCreateForm() {
  document.getElementById('createForm').classList.toggle('hidden');
}

function togglePrizeFields() {
  const type = document.getElementById('tPrizeType').value;
  ['winner', 'top3', 'per_goal', 'custom'].forEach(t => {
    document.getElementById('prize-' + t).classList.toggle('hidden', t !== type);
  });
}

function buildPrizeString() {
  const type = document.getElementById('tPrizeType').value;
  if (type === 'none')     return '';
  if (type === 'winner')   return `🥇 Winner: ₹${document.getElementById('tPrize1st').value || 0}`;
  if (type === 'top3')     return `🥇 ₹${document.getElementById('tPrize1').value || 0}  🥈 ₹${document.getElementById('tPrize2').value || 0}  🥉 ₹${document.getElementById('tPrize3').value || 0}`;
  if (type === 'per_goal') return `⚽ ₹${document.getElementById('tPrizeGoal').value || 0} per goal`;
  if (type === 'custom')   return document.getElementById('tPrizeCustom').value.trim();
  return '';
}

async function createTournament() {
  const name = document.getElementById('tName').value.trim();
  if (!name) return alert('Tournament name is required');
  try {
    await API.post('/tournaments', {
      name,
      format:       document.getElementById('tFormat').value,
      entry_fee:    parseFloat(document.getElementById('tFee').value) || 0,
      max_players:  parseInt(document.getElementById('tMax').value)   || 16,
      payment_link: document.getElementById('tPayLink').value.trim(),
      date:         document.getElementById('tDate').value,
      prize:        buildPrizeString(),
      description:  document.getElementById('tDesc').value.trim()
    });
    ['tName','tFee','tMax','tPayLink','tDate','tDesc','tPrize1st','tPrize1','tPrize2','tPrize3','tPrizeGoal','tPrizeCustom']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('tPrizeType').value = 'none';
    togglePrizeFields();
    toggleCreateForm();
    await loadAll();
    renderAdminTournaments();
  } catch (e) { alert('Error: ' + e.message); }
}

async function startTournament(id) {
  if (!confirm('Start tournament? This will generate all matches for confirmed players.')) return;
  try {
    const r = await API.post(`/tournaments/${id}/start`, {});
    let msg = `✅ Tournament started! ${r.matches_created} matches generated.`;
    if (r.removed_player) {
      const waLink = r.removed_player.phone ? `https://wa.me/91${r.removed_player.phone}` : null;
      msg += `\n\n⚠ Odd number of players — ${r.removed_player.name} was removed and notified on their dashboard.`;
      if (waLink && confirm(`${msg}\n\nClick OK to open WhatsApp to notify ${r.removed_player.name} personally.`)) {
        window.open(waLink, '_blank');
      } else {
        alert(msg);
      }
    } else {
      alert(msg);
    }
    await loadAll();
    renderAdminTournaments();
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteTournament(id) {
  const t = allTournaments.find(x => x.id === id);
  const paidPlayers = allRegs.filter(r => r.tournament_id === id && r.status === 'confirmed');

  if (paidPlayers.length > 0) {
    const totalRefund = paidPlayers.length * (parseFloat(t?.entry_fee) || 0);
    const names = paidPlayers.map(r => `• ${r.player_name} (₹${t?.entry_fee || 0})`).join('\n');
    const proceed = confirm(`⚠ REFUND REQUIRED\n\nDeleting "${t?.name}" will require refunding ${paidPlayers.length} player(s):\n\n${names}\n\nTotal to refund: ₹${totalRefund}\n\nA refund record will be saved. Proceed?`);
    if (!proceed) return;
  } else {
    if (!confirm(`Delete "${t?.name}"? This cannot be undone.`)) return;
  }

  try {
    const r = await API.delete(`/tournaments/${id}`);
    if (r.refund_players > 0) {
      alert(`✅ Tournament deleted. Refund record saved for ${r.refund_players} player(s).\n\nGo to the Refunds tab to see who needs to be refunded.`);
    }
    await loadAll();
    renderAdminTournaments();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── HELPERS ───────────────────────────────────────────────
function showMatchScheduler(tournamentId) {
  const matches = allMatches.filter(m => m.tournament_id === tournamentId && m.status === 'pending' && !m.is_bye);
  if (!matches.length) { alert('No pending matches to schedule.'); return; }

  const html = matches.map(m => `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="font-weight:600;margin-bottom:8px">${m.player1_name} vs ${m.player2_name} — <span style="color:var(--muted);font-weight:400">${m.round}</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="datetime-local" id="stime_${m.id}" value="${m.start_time ? m.start_time.slice(0,16) : ''}"
          style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px 10px;font-size:12px;flex:1"/>
        <button class="btn btn-primary btn-sm" onclick="setMatchTime('${m.id}')">Set</button>
        ${m.start_time ? `<span style="font-size:11px;color:var(--green)">✅ ${formatDateTime(m.start_time)}</span>` : ''}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Deadline = start time + 15 minutes</div>
    </div>`).join('');

  // Show in a modal-like overlay
  const overlay = document.createElement('div');
  overlay.id = 'scheduleOverlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px`;
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:520px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border)">
        <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700">⏰ Set Match Start Times</div>
        <button onclick="document.getElementById('scheduleOverlay').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px">${html}</div>
    </div>`;
  document.body.appendChild(overlay);
}

async function setMatchTime(matchId) {
  const input = document.getElementById(`stime_${matchId}`);
  if (!input || !input.value) { alert('Please select a date and time'); return; }
  try {
    await API.put(`/matches/${matchId}/schedule`, { start_time: new Date(input.value).toISOString() });
    await loadAll();

    const m = allMatches.find(x => x.id === matchId);
    const reg1 = allRegs.find(r => r.tournament_id === m.tournament_id && r.user_id === m.player1_id);
    const reg2 = allRegs.find(r => r.tournament_id === m.tournament_id && r.user_id === m.player2_id);
    const matchTime = new Date(input.value).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const pw = m.friends_password || '------';

    const msg1 = encodeURIComponent(`Hey ${m.player1_name}! 🏆 Your ${m.round} match is scheduled for *${matchTime}*.\n\nOpponent: *${m.player2_name}*\nFriends Mode Password: *${pw}*\n\nBe online on time! ⚽ — DLS Arena`);
    const msg2 = encodeURIComponent(`Hey ${m.player2_name}! 🏆 Your ${m.round} match is scheduled for *${matchTime}*.\n\nOpponent: *${m.player1_name}*\nFriends Mode Password: *${pw}*\n\nBe online on time! ⚽ — DLS Arena`);

    const wa1 = reg1?.phone ? `https://wa.me/91${reg1.phone}?text=${msg1}` : null;
    const wa2 = reg2?.phone ? `https://wa.me/91${reg2.phone}?text=${msg2}` : null;

    document.getElementById('scheduleOverlay')?.remove();
    const tId = m.tournament_id;
    if (tId) showMatchScheduler(tId);

    if (wa1 || wa2) {
      const popup = document.createElement('div');
      popup.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--bg2);border:1px solid var(--green);border-radius:14px;padding:16px 20px;z-index:2000;max-width:320px;box-shadow:0 4px 24px rgba(0,0,0,.5)`;
      popup.innerHTML = `
        <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;margin-bottom:10px;color:var(--green)">✅ Match time set!</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Notify both players on WhatsApp:</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${wa1 ? `<a href="${wa1}" target="_blank" class="btn btn-primary btn-sm">💬 Notify ${escapeHtml(m.player1_name)}</a>` : `<span style="font-size:11px;color:var(--muted)">No phone for ${escapeHtml(m.player1_name)}</span>`}
          ${wa2 ? `<a href="${wa2}" target="_blank" class="btn btn-primary btn-sm">💬 Notify ${escapeHtml(m.player2_name)}</a>` : `<span style="font-size:11px;color:var(--muted)">No phone for ${escapeHtml(m.player2_name)}</span>`}
        </div>
        <button onclick="this.parentElement.remove()" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer">✕</button>`;
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), 15000);
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function renderAuditLog() {
  const el = document.getElementById('auditLogList');
  if (!el) return;
  let logs = [];
  try { logs = await API.get('/tournaments/audit/log'); } catch(e) {}
  if (!logs.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">📋</div><p>No admin actions recorded yet.</p></div>`;
    return;
  }
  const actionColors = {
    CONFIRM_SCORE:     'var(--green)',
    DISQUALIFY_PLAYER: 'var(--red)',
    DELETE_TOURNAMENT: 'var(--red)',
    DELETE_PLAYER:     'var(--red)',
    BLOCK_PLAYER:      'var(--yellow)',
    UNBLOCK_PLAYER:    'var(--blue)',
    EDIT_TOURNAMENT:   'var(--blue)',
    CONFIRM_PAYMENT:   'var(--green)',
  };
  el.innerHTML = logs.map(l => {
    const color = actionColors[l.action] || 'var(--muted)';
    const details = Object.entries(l.details || {})
      .filter(([k]) => !['changes'].includes(k))
      .map(([k, v]) => `<span style="color:var(--muted)">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}`)
      .join(' &nbsp;•&nbsp; ');
    return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${color};border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px">
        <span style="font-size:12px;font-weight:700;color:${color}">${escapeHtml(l.action.replace(/_/g,' '))}</span>
        <span style="font-size:11px;color:var(--muted)">${formatDateTime(l.timestamp)}</span>
      </div>
      <div style="font-size:12px;color:var(--muted)">By: <b style="color:var(--text)">${escapeHtml(l.admin_name)}</b></div>
      ${details ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${details}</div>` : ''}
    </div>`;
  }).join('');
}

async function renderRefunds() {
  const el = document.getElementById('refundsList');
  if (!el) return;
  let refunds = [];
  try { refunds = await API.get('/tournaments/refunds/all'); } catch(e) {}

  if (!refunds.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">✅</div><p>No refunds needed. No tournaments have been deleted with paid players.</p></div>`;
    return;
  }

  el.innerHTML = refunds.slice().reverse().map(r => `
    <div class="card" style="margin-bottom:14px">
      <div style="background:linear-gradient(135deg,#2d0a0a,#1a0d1a);padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700">${r.tournament_name}</div>
          <div style="font-size:11px;color:var(--muted)">Deleted on ${formatDate(r.deleted_at)} • ₹${r.entry_fee} per player</div>
        </div>
        <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:var(--red)">
          ₹${r.players.reduce((s, p) => s + p.amount, 0)} total
        </div>
      </div>
      <div class="card-body">
        ${r.players.map(p => {
          const waLink = p.phone ? `https://wa.me/91${p.phone}` : null;
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg3)">
            <div>
              <div style="font-weight:600;font-size:13px">${p.player_name} <span style="color:var(--muted);font-weight:400">— ${p.team_name || '—'}</span></div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">
                📱 ${p.phone || '—'}
                ${p.utr_number ? ` • UTR: <span style="color:var(--green)">${p.utr_number}</span>` : ' • <span style="color:var(--yellow)">No UTR on file</span>'}
                ${p.payment_ref ? ` • Ref: <span style="color:var(--yellow);font-family:monospace">${p.payment_ref}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;color:var(--red)">₹${p.amount}</span>
              ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary btn-sm" style="font-size:11px">💬 Refund via WhatsApp</a>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function currentTab() {
  const active = document.querySelector('.tab-btn.active');
  if (!active) return 'overview';
  return active.id.replace('tabBtn-', '');
}

function openEditTournament(id) {
  const t = allTournaments.find(x => x.id === id);
  if (!t) return;
  const overlay = document.createElement('div');
  overlay.id = 'editTournamentOverlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px`;
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border)">
        <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700">✏️ Edit Tournament</div>
        <button onclick="document.getElementById('editTournamentOverlay').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
        <div class="form-group"><label class="form-label">Tournament Name</label><input class="form-input" id="etName" value="${t.name}"/></div>
        <div class="form-group"><label class="form-label">Entry Fee (₹)</label><input class="form-input" id="etFee" type="number" value="${t.entry_fee || 0}"/></div>
        <div class="form-group"><label class="form-label">Max Players</label><input class="form-input" id="etMax" type="number" value="${t.max_players || 16}"/></div>
        <div class="form-group"><label class="form-label">Payment Link</label><input class="form-input" id="etPayLink" value="${t.payment_link || ''}"/></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="etDate" type="date" value="${t.date || ''}"/></div>
        <div class="form-group"><label class="form-label">Prize</label><input class="form-input" id="etPrize" value="${t.prize || ''}"/></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="etDesc">${t.description || ''}</textarea></div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-primary" onclick="saveEditTournament('${t.id}')">Save Changes</button>
          <button class="btn btn-ghost" onclick="document.getElementById('editTournamentOverlay').remove()">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveEditTournament(id) {
  try {
    await API.put(`/tournaments/${id}`, {
      name:         document.getElementById('etName').value.trim(),
      entry_fee:    parseFloat(document.getElementById('etFee').value) || 0,
      max_players:  parseInt(document.getElementById('etMax').value) || 16,
      payment_link: document.getElementById('etPayLink').value.trim(),
      date:         document.getElementById('etDate').value,
      prize:        document.getElementById('etPrize').value.trim(),
      description:  document.getElementById('etDesc').value.trim()
    });
    document.getElementById('editTournamentOverlay').remove();
    await loadAll();
    renderAdminTournaments();
  } catch(e) { alert('Error: ' + e.message); }
}

async function deletePlayer(id, name) {
  if (!confirm(`Delete player "${name}"? This cannot be undone.`)) return;
  try {
    await API.delete(`/auth/users/${id}`);
    await loadAll();
    renderPage('players-detail');
  } catch(e) { alert('Error: ' + e.message); }
}

async function blockPlayer(id, name) {
  if (!confirm(`Block player "${name}"? They won't be able to login.`)) return;
  try {
    await API.put(`/auth/users/${id}/block`, {});
    await loadAll();
    renderPage('players-detail');
  } catch(e) { alert('Error: ' + e.message); }
}
async function pauseTournament(id) {
  if (!confirm('Pause this tournament? Players cannot submit results while paused.')) return;
  try {
    await API.put(`/tournaments/${id}/pause`, {});
    await loadAll(); renderAdminTournaments();
  } catch(e) { alert('Error: ' + e.message); }
}

async function unpauseTournament(id) {
  try {
    await API.put(`/tournaments/${id}/unpause`, {});
    await loadAll(); renderAdminTournaments();
  } catch(e) { alert('Error: ' + e.message); }
}
// ── APPEALS ───────────────────────────────────────────────
async function renderAdminAppeals() {
  const el = document.getElementById('adminAppealsList');
  if (!el) return;
  let appeals = [];
  try { appeals = await API.get('/appeals'); } catch(e) {}
  const pending  = appeals.filter(a => a.status === 'pending');
  const reviewed = appeals.filter(a => a.status !== 'pending');
  if (!appeals.length) {
    el.innerHTML = `<div class="dash-empty"><div class="de-icon">⚖️</div><p>No appeals submitted yet.</p></div>`;
    return;
  }
  const renderCard = (a, showActions) => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${
      a.status === 'overturned' ? 'var(--green)' : a.status === 'upheld' ? 'var(--red)' : 'var(--yellow)'
    };border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-weight:600">${escapeHtml(a.user_name)} → ${escapeHtml(a.match_round)} vs ${escapeHtml(a.opponent_name)}</div>
          <div style="font-size:11px;color:var(--muted)">Score: ${escapeHtml(a.score)} • ${formatDate(a.submitted_at)}</div>
        </div>
        <span class="badge ${a.status === 'overturned' ? 'badge-success' : a.status === 'upheld' ? 'badge-danger' : 'badge-warning'}">
          ${a.status === 'overturned' ? '✅ Overturned' : a.status === 'upheld' ? '❌ Upheld' : '⏳ Pending'}
        </span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:${showActions ? '10px' : '0'}">
        Player's reason: <span style="color:var(--text)">${escapeHtml(a.reason)}</span>
      </div>
      ${showActions ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="resolveAppeal('${a.id}','uphold')">❌ Uphold (keep decision)</button>
        <button class="btn btn-warning btn-sm" onclick="resolveAppeal('${a.id}','overturn')">✅ Overturn (reverse result)</button>
      </div>` : a.admin_response ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">Your response: ${escapeHtml(a.admin_response)}</div>` : ''}
    </div>`;
  el.innerHTML =
    (pending.length  ? `<div class="match-section-label" style="padding:0 0 8px">PENDING (${pending.length})</div>${pending.map(a => renderCard(a, true)).join('')}` : '') +
    (reviewed.length ? `<div class="match-section-label" style="padding:12px 0 8px">REVIEWED</div>${reviewed.map(a => renderCard(a, false)).join('')}` : '');
}

async function resolveAppeal(id, action) {
  const response = prompt('Add a response message to the player (optional):');
  try {
    await API.put(`/appeals/${id}/${action}`, { response: response || '' });
    await loadAll();
    renderAdminAppeals();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── PASSWORD RESET REQUESTS ───────────────────────────────
async function renderResetRequests() {
  const el = document.getElementById('resetRequestsList');
  if (!el) return;
  let reqs = [];
  try { reqs = await API.get('/auth/reset-requests'); } catch(e) {}
  if (!reqs.length) { el.innerHTML = `<div class="dash-empty"><div class="de-icon">🔑</div><p>No reset requests yet.</p></div>`; return; }
  el.innerHTML = reqs.map(r => {
    const waLink = r.phone ? `https://wa.me/91${r.phone}` : null;
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:600">${escapeHtml(r.user_name)}</div>
          <div style="font-size:11px;color:var(--muted)">${escapeHtml(r.email)} • 📱 ${r.phone} • ${formatDate(r.requested_at)}</div>
          ${r.temp_password ? `<div style="font-size:12px;margin-top:6px">Temp password: <span style="font-family:monospace;color:var(--yellow);font-weight:700">${r.temp_password}</span> — share via WhatsApp</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-direction:column;align-items:flex-end">
          <span class="badge ${r.status === 'approved' ? 'badge-success' : r.status === 'rejected' ? 'badge-danger' : 'badge-warning'}">${r.status.toUpperCase()}</span>
          ${r.status === 'pending' ? `
          <div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-primary btn-sm" onclick="approveReset('${r.id}')">✅ Approve</button>
            <button class="btn btn-danger  btn-sm" onclick="rejectReset('${r.id}')">✕ Reject</button>
          </div>` : ''}
          ${r.status === 'approved' && waLink ? `<a href="${waLink}" target="_blank" class="btn btn-primary btn-sm" style="font-size:11px">💬 Send via WhatsApp</a>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function approveReset(id) {
  try {
    const r = await API.put(`/auth/reset-request/${id}/approve`, {});
    alert(`✅ Password reset approved!\nTemp password: ${r.temp_password}\n\nShare this with the player via WhatsApp.`);
    renderResetRequests();
  } catch(e) { alert('Error: ' + e.message); }
}

async function rejectReset(id) {
  if (!confirm('Reject this reset request?')) return;
  try { await API.put(`/auth/reset-request/${id}/reject`, {}); renderResetRequests(); }
  catch(e) { alert('Error: ' + e.message); }
}

async function previewDraw(id) {
  const t = allTournaments.find(x => x.id === id);
  const confirmed = allRegs.filter(r => r.tournament_id === id && r.status === 'confirmed');
  if (confirmed.length < 2) { alert('Need at least 2 confirmed players to preview draw.'); return; }

  // Shuffle players
  const shuffled = [...confirmed].sort(() => Math.random() - 0.5);

  // Build preview matchups
  let html = `<div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;margin-bottom:14px">🎲 Draw Preview — ${escapeHtml(t.name)}</div>`;
  html += `<div style="font-size:12px;color:var(--muted);margin-bottom:14px">This is how matches will be generated. Click Re-draw to shuffle again or Start to confirm.</div>`;

  for (let i = 0; i < shuffled.length - 1; i += 2) {
    html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;font-weight:600;color:var(--green);flex:1">${escapeHtml(shuffled[i].player_name)}</span>
      <span style="font-size:12px;color:var(--muted);background:var(--bg3);padding:3px 10px;border-radius:6px">vs</span>
      <span style="font-size:13px;font-weight:600;flex:1;text-align:right">${escapeHtml(shuffled[i+1].player_name)}</span>
    </div>`;
  }
  if (shuffled.length % 2 !== 0) {
    html += `<div style="font-size:12px;color:var(--yellow);margin-top:8px">⚠ ${escapeHtml(shuffled[shuffled.length-1].player_name)} gets a bye (odd number of players)</div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'drawOverlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px`;
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto">
      <div style="padding:20px 20px 0">${html}</div>
      <div style="display:flex;gap:10px;padding:16px 20px;border-top:1px solid var(--border);margin-top:14px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('drawOverlay').remove();previewDraw('${id}')">🎲 Re-draw</button>
        <button class="btn btn-primary" onclick="document.getElementById('drawOverlay').remove();startTournament('${id}')">▶ Start with this Draw</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('drawOverlay').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function logout() { performLogout('/admin-login.html'); }

// ── START ─────────────────────────────────────────────────
init();