/**
 * app.js — Home screen, pre-game modal, case launch
 * Entry point for Clinical Simulation
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
          <div class="logo-text">Clinical Simulation</div>
          <div class="logo-sub">Medical Decision Engine</div>
        </div>
      </div>
      <div class="topbar-right">
        <div id="nav-auth-area">
            <div id="nav-auth-area">
            <a id="nav-signin-profile" class="nav-user-pill">Loading...</a>
        </div>
        </div>
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
    </div><br>

    <div class="home-stats">
      <div class="home-stat"><div class="home-stat-value">Sponsored Ads Section (1/3)</div><div class="home-stat-label">A free service still take resources to operate for the database, server and domain! The cases of this website will always be free of cost availabe for everyone powered by our sponsors.</div></div>
    </div><br>

    <section class="home-cases-section">
      <div class="section-header">
        <div class="section-title">Active Cases</div>
        <div class="section-line"></div>
      </div>
      <div class="cases-grid" id="cases-grid">
${cases.slice(0, 4).map(c => caseCardHTML(c)).join('')}
      </div>

      <div class="home-mid-cta">
  <a href="/cases.html" class="home-cta-btn">
    Explore All Cases →
  </a>
</div>
    </section>


<section class="home-hero">
      <h1 class="hero-title"><br/><em>SPONSORED ADS SECTION (2/3)</em></h1>
      <p class="hero-sub">A free service still take resources to operate for the database, server and domain! The cases of this website will always be free of cost availabe for everyone powered by our sponsors.</p>
      </section>

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
        <div class="rule-item"><div class="rule-icon">⏱️</div><div class="rule-text"><strong>1 real second = 1 sim minute.</strong> Disease progresses automatically. Skip with ⏩.</div></div>
        <div class="rule-item"><div class="rule-icon">🔬</div><div class="rule-text"><strong>Investigations</strong> cost coins and take time. Results vary by disease stage.</div></div>
        <div class="rule-item"><div class="rule-icon">🩺</div><div class="rule-text"><strong>Set a working diagnosis</strong> to unlock disease-specific treatment. Change anytime.</div></div>
        <div class="rule-item"><div class="rule-icon">💊</div><div class="rule-text"><strong>Wrong management </strong> incur score penalties. Blunders can end the case.</div></div>
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
    window.location.href = `/play.html?id=${caseId}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();