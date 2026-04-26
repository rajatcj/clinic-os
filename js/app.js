/**
 * app.js — Home screen, pre-game modal, case launch
 * Entry point for Clinical Simulation
 */

const loader = new CaseLoader();
let allCases  = [];
let activeFilter = 'all';
const MedSimAvail = typeof MedSim !== 'undefined';

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    allCases = await loader.loadIndex('./data/caseIndex.json');
    if (!allCases.length) throw new Error('Empty index');
    renderHome(allCases);
  } catch(e) {
    document.getElementById('app').innerHTML = `
      <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:monospace;text-align:center;padding:20px">
        <div style="font-size:2rem">⚠️</div>
        <div style="color:#e84058;font-size:13px">Failed to load case data</div>
        <div style="color:#364e65;font-size:11px">Make sure data/caseIndex.json is accessible.<br>If running locally, use a local server (e.g. <code>npx serve .</code>)</div>
      </div>`;
  }
}

// ── Home render ───────────────────────────────────────────────────────────────
function renderHome(cases) {
  document.getElementById('cases-grid').innerHTML = homeHTML(cases);
  bindHomeEvents();
}

function homeHTML(cases) {
  document.getElementById('total-cases-available').innerHTML = cases.length;
  return `
${cases.slice(0, 4).map(c => caseCardHTML(c)).join('')}
`;
}

function caseCardHTML(c) {
  const diffClass = `diff-${c.difficulty}`;
  return `
    <div class="case-card" data-case-id="${c.id}" data-diff="${c.difficulty}" data-sys="${c.system}" tabindex="0" role="button" aria-label="Open case: ${c.title}">
      <div class="card-top">
        <span class="card-difficulty ${diffClass}">${c.difficulty}</span>
        <span class="card-id">${c.id}</span>
      </div>
      <div class="card-patient">
        <div class="patient-dot"></div>
        ${c.patientAge}y ${c.patientSex} · ${c.patientOccupation || c.department}
      </div>
      <div class="card-title">${c.title}</div>
      <div class="card-subtitle">${c.subtitle}</div>
      <div class="card-desc">${c.description}</div>
      <div class="card-tags">${(c.tags||[]).map(t=>`<span class="card-tag">${t}</span>`).join('')}</div>
      <div class="card-footer">
        <div class="card-meta">
          <span class="card-time">⏱ ${c.estimatedTime}</span>
          <span class="card-coins">🪙 ${c.budget?.toLocaleString()} starting coins</span>
        </div>
        <span class="card-cta">Start →</span>
      </div>
    </div>`;
}

function lockedCardsHTML() {
  return `
    <div class="case-card locked">
      <div class="card-top"><span class="card-difficulty diff-Resident">.</span><span class="card-id">---</span></div>
      <div class="card-patient"><div class="patient-dot" style="background:var(--text-dim)"></div>.</div>
      <div class="card-title">More Cases Coming Soon</div>
    </div>
    <div class="case-card locked">
      <div class="card-top"><span class="card-difficulty diff-MO">.</span><span class="card-id">---</span></div>
      <div class="card-patient"><div class="patient-dot" style="background:var(--text-dim)"></div>.</div>
      <div class="card-title">Submit a Case Design</div>
      <div class="card-subtitle">.</div>
      <div class="card-desc">Email : mail@rajatcj.com</div>
    </div>`;
}

// ── Bind home events ──────────────────────────────────────────────────────────
function bindHomeEvents() {
  document.querySelectorAll('.case-card:not(.locked)').forEach(card => {
    card.addEventListener('click', () => openPreGame(card.dataset.caseId));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openPreGame(card.dataset.caseId); });
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilter();
    });
  });
}

function applyFilter() {
  document.querySelectorAll('.case-card:not(.locked)').forEach(card => {
    const diff = card.dataset.diff;
    const sys  = card.dataset.sys;
    const show = activeFilter === 'all'
      || activeFilter === `diff:${diff}`
      || activeFilter === `sys:${sys}`;
    card.style.display = show ? '' : 'none';
  });
}

// ── Pre-game modal ────────────────────────────────────────────────────────────
async function openPreGame(caseId) {
  const meta = allCases.find(c => c.id === caseId);
  if (!meta) return;

  const overlay = document.createElement('div');
  overlay.className = 'pregame-overlay';
  overlay.id = 'pregame-overlay';
  overlay.innerHTML = buildPreGameModal(meta);
  document.body.appendChild(overlay);

  document.getElementById('btn-cancel-case').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('btn-start-case').addEventListener('click', async () => {
    overlay.remove();
    await launchGame(caseId);
  });

  // Load stats after modal is visible — non-blocking
  loadPreGameStats(caseId);
}

function buildPreGameModal(meta) {
  return `
    <div class="pregame-modal">
      <div class="pregame-head">
        <div class="pregame-case-label">${meta.category} · ${meta.difficulty}</div>
        <div class="pregame-title">${meta.title}</div>
        <div class="pregame-patient">
          <div class="pregame-patient-item"><strong>${meta.patientAge}y ${meta.patientSex}</strong><small>Patient</small></div>
          <div class="pregame-patient-item"><strong>${meta.patientOccupation||'—'}</strong><small>Occupation</small></div>
          <div class="pregame-patient-item"><strong>${meta.department}</strong><small>Department</small></div>
          <div class="pregame-patient-item"><strong>${meta.stages} stages</strong><small>Progression</small></div>
        </div>
      </div>

      <div class="pregame-stats-wrap">
        <div id="pregame-stats" class="pregame-stats-loading">
          <div class="pgstat-spinner">Loading stats…</div>
        </div>
      </div>

      <div class="pregame-rules">
        <div class="rules-title">How This Simulation Works</div>
        <div class="rule-item"><div class="rule-icon">⏱️</div><div class="rule-text"><strong>1 real second = 1 sim minute.</strong> Disease progresses automatically. Skip with ⏩.</div></div>
        <div class="rule-item"><div class="rule-icon">🔬</div><div class="rule-text"><strong>Investigations</strong> cost coins and take time. Results vary by disease stage.</div></div>
        <div class="rule-item"><div class="rule-icon">🩺</div><div class="rule-text"><strong>Set a working diagnosis</strong> to unlock disease-specific treatment. Change anytime.</div></div>
        <div class="rule-item"><div class="rule-icon">💊</div><div class="rule-text"><strong>Wrong management</strong> incurs score penalties. Blunders can end the case.</div></div>
        <div class="rule-item"><div class="rule-icon">🪙</div><div class="rule-text"><strong>Budget: ${meta.budget?.toLocaleString()} coins.</strong> Overspending penalises final score.</div></div>
      </div>

      <div class="pregame-meta">
        <div class="meta-item"><div class="meta-label">Estimated Time</div><div class="meta-value">${meta.estimatedTime}</div></div>
        <div class="meta-item"><div class="meta-label">Difficulty</div><div class="meta-value">${meta.difficulty}</div></div>
        <div class="meta-item"><div class="meta-label">Starting Budget</div><div class="meta-value coins">🪙 ${meta.budget?.toLocaleString()}</div></div>
        <div class="meta-item"><div class="meta-label">Disease Stages</div><div class="meta-value">${meta.stages} stages</div></div>
      </div>

      <div class="pregame-actions">
        <button class="btn-start" id="btn-start-case">Start Simulation →</button>
        <button class="btn-cancel" id="btn-cancel-case">Cancel</button>
      </div>
    </div>`;
}

// async function loadPreGameStats(caseId) {
//   const statsEl = document.getElementById('pregame-stats');
//   if (!statsEl) return;

//   if (!MedSimAvail) {
//     statsEl.innerHTML = '<div class="pgstat-empty">Stats unavailable</div>';
//     return;
//   }

//   try {
//     const [caseMeta, leaderboard] = await Promise.all([
//       MedSim.getCaseMeta(caseId).catch(() => null),
//       MedSim.getCaseLeaderboard(caseId, 3).catch(() => [])
//     ]);

//     const plays  = caseMeta?.totalPlays         ?? 0;
//     const unique = caseMeta?.totalUniquePlayers  ?? 0;
//     const avg    = caseMeta?.averageScore        ? caseMeta.averageScore.toFixed(1) : '—';
//     const compl  = caseMeta?.totalCompletions    ?? 0;

//     statsEl.innerHTML = `
//       <div class="pgstat-grid">
//         <div class="pgstat-item"><div class="pgstat-val">${plays.toLocaleString()}</div><div class="pgstat-label">Total Plays</div></div>
//         <div class="pgstat-item"><div class="pgstat-val">${unique.toLocaleString()}</div><div class="pgstat-label">Unique Players</div></div>
//         <div class="pgstat-item"><div class="pgstat-val">${compl.toLocaleString()}</div><div class="pgstat-label">Completions</div></div>
//         <div class="pgstat-item"><div class="pgstat-val">${avg}</div><div class="pgstat-label">Avg Score</div></div>
//       </div>
//       ${leaderboard.length ? `
//       <div class="pgstat-lb">
//         <div class="pgstat-lb-title">Top Scores</div>
//         ${leaderboard.map((e, i) => `
//           <div class="pgstat-lb-row">
//             <span class="pgstat-rank">#${i + 1}</span>
//             <span class="pgstat-user">${_esc(e.username)}</span>
//             <span class="pgstat-score">${e.score}</span>
//             <span class="pgstat-time">${_fmtSecs(e.timeElapsed)}</span>
//           </div>`).join('')}
//       </div>` : '<div class="pgstat-empty">No scores yet — be the first!</div>'}
//     `;
//   } catch (e) {
//     statsEl.innerHTML = '<div class="pgstat-empty">Stats unavailable</div>';
//   }
// }

// ── Launch game ───────────────────────────────────────────────────────────────
async function launchGame(caseId) {
  window.location.href = `/play.html?id=${caseId}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtSecs(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();