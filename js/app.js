/**
 * app.js — Home screen, pre-game modal, case launch
 * Entry point for Clinical Simulation OS
 */

const loader = new CaseLoader();
let allCases  = [];
let activeFilter = 'all';

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
  document.getElementById('app').innerHTML = homeHTML(cases);
  bindHomeEvents();
}

function homeHTML(cases) {
  const systems = [...new Set(cases.map(c => c.system))];
  const diffs   = [...new Set(cases.map(c => c.difficulty))];

  return `
  <div class="home-screen">
    <nav class="home-topbar">
      <div class="topbar-logo">
        <div class="logo-icon">🩺</div>
        <div>
          <div class="logo-text">Clinical Simulation Engine</div>
          <div class="logo-sub">Medical Decision Engine</div>
        </div>
      </div>
      <div class="topbar-right">
        <div class="topbar-badge" 
          style="cursor:pointer;"
          onclick="window.open('https://rajatcj.com?sim', '_blank')"> ● RAJATCJ.COM</div>
      </div>
    </nav>


    <section class="home-hero">
      <div class="hero-eyebrow">MBBS Clinical Training Platform</div>
      <h1 class="hero-title">Make decisions.<br/><em>Watch consequences unfold.</em></h1>
      <p class="hero-sub">Realtime patient simulation. Order investigations, prescribe treatment, and race against disease progression, every decision has consequences.</p>
    </section>

    <div class="home-stats">
      <div class="home-stat"><div class="home-stat-value">${cases.length}</div><div class="home-stat-label">Cases Available</div></div>
      <div class="home-stat"><div class="home-stat-value">5</div><div class="home-stat-label">New Cases / Week</div></div>
      <div class="home-stat"><div class="home-stat-value">xxx</div><div class="home-stat-label">Total Visitors</div></div>
      <div class="home-stat"><div class="home-stat-value">xxx</div><div class="home-stat-label">Cases Played</div></div>
    </div><br>

    <div class="home-filters">
      <span class="filter-label">Filter:</span>
      <button class="filter-btn active" data-filter="all">All Cases</button>
      <div class="filter-sep"></div>
      ${diffs.map(d => `<button class="filter-btn" data-filter="diff:${d}">${d}</button>`).join('')}
      <div class="filter-sep"></div>
      ${systems.map(s => `<button class="filter-btn" data-filter="sys:${s}">${s}</button>`).join('')}
    </div>

    <section class="home-cases-section">
      <div class="section-header">
        <div class="section-title">Active Cases</div>
        <div class="section-line"></div>
      </div>
      <div class="cases-grid" id="cases-grid">
        ${cases.map(c => caseCardHTML(c)).join('')}
        ${lockedCardsHTML()}
      </div>
    </section>


<section class="home-hero">
      <h1 class="hero-title"><br/><em>SPONSORED ADS SECTION</em></h1>
      <p class="hero-sub">A free service still take resources to operate! The cases of this website will always be free of cost availabe for everyone powered by out sponsors.</p>
      </section>


    <footer class="home-footer">All Rights reserved @ 2026 · FOR EDUCATIONAL PURPOSES ONLY · NOT FOR CLINICAL USE · CLINICAL SIM OS v2.0 · By <a style="color:#555555; text-decoration: underline;" href="https://rajatcj.com">RAJAT CJ</a></footer>
  </div>`;
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
  // Case card click
  document.querySelectorAll('.case-card:not(.locked)').forEach(card => {
    card.addEventListener('click', () => openPreGame(card.dataset.caseId));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openPreGame(card.dataset.caseId); });
  });

  // Filters
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

// ── Pre-game modal (rules) ────────────────────────────────────────────────────
async function openPreGame(caseId) {
  const meta = allCases.find(c => c.id === caseId);
  if (!meta) return;

  const overlay = document.createElement('div');
  overlay.className = 'pregame-overlay';
  overlay.id = 'pregame-overlay';
  overlay.innerHTML = `
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

      <div class="pregame-rules">
        <div class="rules-title">How This Simulation Works</div>
        <div class="rule-item"><div class="rule-icon">⏱️</div><div class="rule-text"><strong>1 real second = 1 sim minute.</strong> The clock runs continuously. Disease progresses automatically if untreated. You can skip time using the ⏩ button.</div></div>
        <div class="rule-item"><div class="rule-icon">🔬</div><div class="rule-text"><strong>Order investigations</strong> from the Investigations tab. Tests take time and cost coins. Results change based on disease stage. Unnecessary tests waste your budget.</div></div>
        <div class="rule-item"><div class="rule-icon">🩺</div><div class="rule-text"><strong>Set a working diagnosis</strong> in the Diagnosis tab. This unlocks disease-specific treatment options. You can change your diagnosis at any time.</div></div>
        <div class="rule-item"><div class="rule-icon">💊</div><div class="rule-text"><strong>Two management tracks:</strong> General Management (always available) and Disease-Specific Treatment (unlocks after diagnosis). Wrong treatments incur penalties. Blunders can end the case.</div></div>
        <div class="rule-item"><div class="rule-icon">🪙</div><div class="rule-text"><strong>Budget: ${meta.budget?.toLocaleString()} coins.</strong> You can overspend — but the final score is penalised proportionally. Efficient workup scores higher.</div></div>
        <div class="rule-item"><div class="rule-icon">📊</div><div class="rule-text"><strong>Scored on:</strong> correct diagnosis (25pts), timely cure (30pts), cost efficiency (15pts), relevant investigations (15pts), correct management (15pts), minus penalties.</div></div>
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

  document.body.appendChild(overlay);

  document.getElementById('btn-cancel-case').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('btn-start-case').addEventListener('click', async () => {
    overlay.remove();
    await launchGame(caseId);
  });
}

// ── Launch game ───────────────────────────────────────────────────────────────
async function launchGame(caseId) {
  const app = document.getElementById('app');

  // Show loading state
  app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#364e65;letter-spacing:.12em;flex-direction:column;gap:12px">
    <div style="font-size:1.5rem">🏥</div>
    <div>LOADING CASE…</div>
  </div>`;

  const caseData = await loader.loadCase(caseId);
  if (!caseData) {
    app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#e84058;text-align:center;padding:20px">
      Failed to load case: ${caseId}<br><small style="color:#364e65;display:block;margin-top:8px">Check data/cases/${caseId}.json exists.</small>
    </div>`;
    return;
  }

  // Fade out
  app.style.opacity = '0';
  app.style.transition = 'opacity 0.2s ease';

  setTimeout(() => {
    const engine = new ClinicalEngine(caseData);
    const ui     = new ClinicalUI(engine, caseData);
    ui.renderGame();
    app.style.opacity = '1';
    // Start engine after DOM settles
    setTimeout(() => engine.start(), 120);
  }, 200);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();