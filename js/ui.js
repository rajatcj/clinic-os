/**
 * ClinicalUI v2 — Full UI controller
 */
class ClinicalUI {
  constructor(engine, caseData) {
    this.engine    = engine;
    this.case      = caseData;
    this.activeTab = 'history';
    this._bindEngineEvents();
  }

  // ── Engine bindings ───────────────────────────────────────────────────────
  _bindEngineEvents() {
    this.engine
      .on('tick',            ()  => this._updateHUD())
      .on('stateChanged',    ()  => this._updateHUD())
      .on('stageChanged',    d   => { this._updateHUD(); this._flashStage(d); })
      .on('testResult',      r   => { this._showToast(`📋 Result ready: ${r.name}`, 'info'); this._refreshResults(); })
      .on('log',             e   => this._appendLog(e))
      .on('cured',           ()  => { this._updateHUD(); this._showToast('✅ Patient cured!', 'success'); this._pulseGlow('green'); document.getElementById('btn-end')?.classList.add('btn-end-ready'); })
      .on('gameOver',        d   => this._handleGameOver(d))
      .on('diagnosisChanged',d   => { this._renderDiagnosisTab(); this._renderDiseaseTab(); this._showToast(`🩺 Dx: ${d.label}`, 'info'); });
  }

  // ── Render game ───────────────────────────────────────────────────────────
  renderGame() {
    document.getElementById('app').innerHTML = this._gameHTML();
    this._bindUIEvents();
    this._updateHUD();
    this._renderHistoryTab();
    this._renderTestsTab();
    this._refreshResults();
    this._renderGeneralTab();
    this._renderDiagnosisTab();
    this._renderDiseaseTab();
  }

  _gameHTML() {
    const c = this.case, p = c.clinicalPresentation.patientParticulars;
    return `
    <div class="game-layout">
      <header class="game-header">
        <div class="header-left">
          <button class="btn-back" id="btn-back">←</button>
          <div class="case-title-small">${c.title}</div>
        </div>
        <div class="hud-vitals" id="///hud-vitals"></div>
        <div class="header-right">
          <div class="hud-stats">
            <div class="hud-stat btn-jump" id="btn-jump"><span class="hud-label">TIME</span><span class="hud-value mono" id="stat-time">00h 00m</span></div>
            <!--<div class="hud-stat"><span class="hud-label">STAGE</span><span class="hud-value mono" id="stat-stage">—</span></div>-->
            <div class="hud-stat"><span class="hud-label">COINS</span><span class="hud-value mono" id="stat-budget">🪙—</span></div>
          </div>
          <div class="hud-actions">
            <button class="btn-resign" id="btn-resign">🚑 Transfer</button>
            <button class="btn-end" id="btn-end">End & Score</button>
          </div>
        </div>
      </header>

      <div class="patient-banner">
        <div class="patient-avatar">
          <svg viewBox="0 0 60 60" fill="none"><circle cx="30" cy="20" r="12" fill="currentColor" opacity="0.55"/><path d="M10 55c0-11 8.95-20 20-20s20 8.95 20 20" fill="currentColor" opacity="0.38"/></svg>
        </div>
        <div class="patient-info">
          <div class="patient-name">${p.age}y ${p.sex} · ${p.occupation}</div>
          <div class="patient-complaint">"${c.clinicalPresentation.chiefComplaint}"</div>
        </div>
        <div class="stage-glow-wrap">
        
        <div class="hud-vitals" id="hud-vitals"></div>
          <div class="stage-glow glow-yellow" id="stage-glow"></div>
          <div class="patient-stage-badge stage-badge-yellow" id="stage-badge"><span id="stage-badge-text">—</span></div>
        </div>
      </div>
      


      <div class="game-body">
        <div class="tab-bar">
          <button class="tab-btn active" data-tab="history">CASE</button>
          <button class="tab-btn" data-tab="tests">TESTS<span class="badge" id="results-badge">0</span></button>
          <!--<button class="tab-btn" data-tab="results">RESULTS<span class="badge" id="results-badge">0</span></button>-->
          <button class="tab-btn" data-tab="general">MANAGEMENET</button>
          <button class="tab-btn" data-tab="diagnosis">DIAGNOSIS</button>
        </div>
        <div class="tab-content">
          <div class="tab-panel active" id="tab-history"></div>
          <div class="tab-panel" id="tab-tests">
            <div id="tab-results"></div> <br><br><br>
            <div id="tab-testss"></div>
          </div>
          <div class="tab-panel" id="tab-general"></div>
          <div class="tab-panel" id="tab-diagnosis">
            <div id="tab-diagnosiss"></div><br> <br>
            <div id="tab-disease"></div>
          </div>
        </div>
      </div>

      <aside class="log-panel">
        <div class="log-header">Activity Log</div>
        <div class="log-entries" id="log-entries"></div>
      </aside>
    </div>

    <div class="modal-overlay hidden" id="modal-jump">
      <div class="modal">
        <div class="modal-title">⏩ Skip Time</div>
        <p class="modal-desc">Advance simulation time. Pending results arrive if due, disease evolve.</p>
        <div class="jump-options">
          <button class="jump-btn" data-h="0.5">+30 min</button>
          <button class="jump-btn" data-h="1">+1 hour</button>
          <button class="jump-btn" data-h="2">+2 hours</button>
          <button class="jump-btn" data-h="4">+4 hours</button>
          <button class="jump-btn" data-h="6">+6 hours</button>
          <button class="jump-btn" data-h="12">+12 hours</button>
        </div>
        <button class="modal-close" id="jump-close">Cancel</button>
      </div>
    </div>

    <div class="modal-overlay hidden" id="modal-score">
      <div class="modal modal-score" id="score-content"></div>
    </div>
    <div class="modal-overlay hidden" id="modal-gameover">
      <div class="modal modal-gameover" id="gameover-content"></div>
    </div>
    <div class="toast-container" id="toasts"></div>`;
  }

  // ── History tab ───────────────────────────────────────────────────────────
  _renderHistoryTab() {
    const cp = this.case.clinicalPresentation, p = cp.patientParticulars;
    document.getElementById('tab-history').innerHTML = `
      <div class="history-grid">
        <div class="info-card">
          <div class="card-label">Chief Complaint</div>
          <div class="card-value big">${cp.chiefComplaint}</div>
        </div>
        <div class="info-card">
          <div class="card-label">Patient</div>
          <div class="card-value">${p.age} yrs · ${p.sex} · ${p.occupation}</div>
          <div class="card-value" style="color:var(--text-muted);font-size:.75rem;margin-top:3px">${p.address||''}</div>
        </div>
        <div class="info-card full-width">
          <div class="card-label">History of Presenting Illness</div>
          <ul class="detail-list">
            <li><strong>Onset:</strong> ${cp.HOPI.onset}</li>
            <li><strong>Progression:</strong> ${cp.HOPI.progression}</li>
            <li><strong>Associated:</strong> ${cp.HOPI.associatedSymptoms.join(', ')}</li>
            ${cp.HOPI.relievingFactors?.length ? `<li><strong>Relieving:</strong> ${cp.HOPI.relievingFactors.join(', ')}</li>` : ''}
            ${cp.HOPI.aggravatingFactors?.length ? `<li><strong>Aggravating:</strong> ${cp.HOPI.aggravatingFactors.join(', ')}</li>` : ''}
          </ul>
        </div>
        <div class="info-card">
          <div class="card-label">Past / Personal History</div>
          <ul class="detail-list">
            ${[...(cp.pastHistory||[]),...(cp.personalHistory||[])].map(h=>`<li>${h}</li>`).join('')}
          </ul>
        </div>
        <div class="info-card">
          <div class="card-label">Vitals on Arrival</div>
          <div class="vitals-grid-small">
            <div class="vital-item"><span>Temp</span><strong>${cp.vitals.temp}°C</strong></div>
            <div class="vital-item"><span>Pulse</span><strong>${cp.vitals.pulse}</strong></div>
            <div class="vital-item"><span>BP</span><strong>${cp.vitals.bp}</strong></div>
            <div class="vital-item"><span>RR</span><strong>${cp.vitals.rr}/min</strong></div>
            <div class="vital-item"><span>SpO₂</span><strong>${cp.vitals.spo2}%</strong></div>
          </div>
        </div>
        <div class="info-card full-width clue-card">
          <div class="card-label">SPONSORED SEGMENT (NOT PART OF THE SIMULATION)</div>
          <h2>SPONSORED ADS SPACE</h2>
          A free service like this website takes resources to operate! The cases on this app will be available for free of cost to everyone powered by our sponsors.
        </div>
        <div class="info-card full-width">
          <div class="card-label">Examination</div>
          <div class="exam-sections">
            <div class="exam-section"><div class="exam-label">General</div><ul class="detail-list">${cp.exam.general.map(e=>`<li>${e}</li>`).join('')}</ul></div>
            ${cp.exam.others?.length ? `<div class="exam-section"><div class="exam-label">Others</div><ul class="detail-list">${cp.exam.others.map(e=>`<li>${e}</li>`).join('')}</ul></div>` : ''}
          </div>
        </div>
        ${this.case.clinicalClue ? `
        <div class="info-card full-width clue-card">
          <div class="card-label">⚡ Clinical Clue</div>
          <div class="card-value">${this.case.clinicalClue}</div>
        </div>` : ''}
        <div class="info-card full-width">
          <div class="card-label">Current Active Symptoms</div>
          <div class="symptom-tags" id="active-symptoms"></div>
        </div>
        <div class="skip-inline-bar">
          <span class="skip-inline-label">⏩ Skip:</span>
          ${[['0.5','+30m'],['1','+1h'],['2','+2h'],['4','+4h'],['6','+6h']].map(([h,l])=>`<button class="skip-inline-btn" data-h="${h}">${l}</button>`).join('')}
        </div>
      </div>`;
    this._updateSymptoms();
    document.querySelectorAll('.skip-inline-btn').forEach(b => b.addEventListener('click', () => {
      this.engine.jumpTime(parseFloat(b.dataset.h));
      this._renderTestsTab(); this._renderGeneralTab(); this._renderDiseaseTab();
    }));
  }

  _updateSymptoms() {
    const el = document.getElementById('active-symptoms');
    if (el) el.innerHTML = this.engine.state.activeSymptoms.map(s=>`<span class="symptom-tag">${s}</span>`).join('');
  }

  // ── Tests tab ─────────────────────────────────────────────────────────────
  _renderTestsTab() {
    const cats = [...new Set(this.case.tests.map(t=>t.category))];
    const stage = this.engine.state.stage;
    document.getElementById('tab-testss').innerHTML = `<br><div class="disease-mgmt-label">SELECT YOUR TESTS :</strong></div><div class="tests-container">` +
      cats.map(cat => {
        const tests = this.case.tests.filter(t=>t.category===cat);
        return `<div class="test-category"><div class="category-label">${cat}</div><div class="test-grid">
          ${tests.map(t => {
            const pend = this.engine.state.pendingResults.some(r=>r.testId===t.id);
            const done = this.engine.state.completedTests.some(r=>r.testId===t.id);
            const avail = t.stageAvailability?.includes(stage);
            const cls = pend?'test-pending':done?'test-done':!avail?'test-unavailable':'';
            return `<div class="test-card ${cls}" id="tc-${t.id}">
              <div class="test-name">${t.name}</div>
              <div class="test-fullname">${t.fullName}</div>
              <div class="test-meta"><span>⏱ ${this.engine._fmtDur(t.time)}</span><span>🪙${t.cost}</span>${t.type==='dummy'?'<span class="test-type-dummy">Non-specific</span>':''}</div>
              ${!avail&&!done&&!pend?'<div class="test-status">Not available</div>'
                :pend?'<div class="test-status">⏳ Pending…</div>'
                :done?'<div class="test-status done">✅ Done</div>'
                :`<button class="btn-order" data-tid="${t.id}">Order</button>`}
            </div>`;
          }).join('')}
        </div></div>`;
      }).join('') + `</div>`;

    document.querySelectorAll('.btn-order[data-tid]').forEach(b => b.addEventListener('click', () => {
      const res = this.engine.orderTest(b.dataset.tid);
      if (res.success) { this._renderTestsTab(); if(res.willOverspend) this._showToast('⚠️ Over budget — score penalised','warning'); }
      else this._showToast(res.msg,'warning');
    }));
  }

  // ── Results tab ───────────────────────────────────────────────────────────
_refreshResults() {
  const done = this.engine.state.completedTests;
  const pend = this.engine.state.pendingResults;

  const badge = document.getElementById('results-badge');
  if (badge) badge.textContent = done.length;

  const panel = document.getElementById('tab-results');
  if (!panel) return;

  // ── KEY: detect structural change (not time change) ──
  const stateKey = JSON.stringify({
    d: done.map(x => x.name),
    p: pend.map(x => x.testId)
  });

  // If structure SAME → only update ETA text, no re-render
  if (panel.dataset.lastKey === stateKey) {
    pend.forEach(r => {
      const etaEl = panel.querySelector(`[data-eta="${r.testId}"]`);
      if (!etaEl) return;

      const eta = Math.max(0, r.readyAt - this.engine.state.time);
      etaEl.textContent = `ETA: ~${this.engine._fmtDur(eta)}`;
    });
    return;
  }

  // Save new structure key
  panel.dataset.lastKey = stateKey;

  // ── FULL RENDER ONLY WHEN NEEDED ──
  if (!done.length && !pend.length) {
    panel.innerHTML = `
      <br>
      <div class="disease-mgmt-label">TEST REPORTS :</div>
      <div class="empty-state">No investigations ordered yet.</div>
    `;
    return;
  }

  let html = '<br><div class="disease-mgmt-label">TEST REPORTS :</div>';

  // ── Pending (dynamic ETA targets) ──
  if (pend.length) {
    html += `<div class="results-section-label">⏳ Awaiting Results (Clink on the clock at the top to skip time)</div>`;

    html += pend.map(r => {
      const t = this.case.tests.find(x => x.id === r.testId);
      const eta = Math.max(0, r.readyAt - this.engine.state.time);

      return `
        <div class="result-card pending">
          <div class="result-name">${t?.name || r.testId}</div>
          <div class="result-eta" data-eta="${r.testId}">
            ETA: ~${this.engine._fmtDur(eta)}
          </div>
        </div>`;
    }).join('');
  }

  // ── Done (STATIC → will NOT re-render every second) ──
  if (done.length) {
    html += `<div class="results-section-label">✅ Results Available</div>`;

    html += done.slice().reverse().map(r => `
      <div class="result-card done">
        <div class="result-header">
          <span class="result-name">${r.name}</span>
          <span class="result-time">${r.timeLabel}</span>
        </div>
        <div class="result-text">${r.result}</div>
        ${r.interpretation ? `<div class="result-interp">💡 ${r.interpretation}</div>` : ''}
      </div>
    `).join('');
  }

  panel.innerHTML = `<div class="results-container">${html}</div>`;
}
  

  // ── General management tab ────────────────────────────────────────────────
  _renderGeneralTab() {
    const given = this.engine.state.givenManagement.map(g=>g.id);
    const opts  = this.case.managementOptions.general || [];
    document.getElementById('tab-general').innerHTML = `
            <br><div class="disease-mgmt-label">GENERAL MANAGEMENT :</strong></div><br><div class="mgmt-container" style="width:100%"><div class="mgmt-grid">` +
      opts.map(m => {
        const isGiven = given.includes(m.id);
        const eff = m.stageEffect?.[this.engine.state.stage] || {};
        const isBad = m.type==='wrong'||m.type==='dummy';
        return `<div class="mgmt-card ${isGiven?'mgmt-given':''} ${isBad?'mgmt-wrong':''}">
          <div class="mgmt-name">${m.name}</div>
          <div class="mgmt-fullname">${m.fullName}</div>
          <div class="mgmt-meta"><span>🪙${m.cost}</span>${isBad?`<span class="badge-wrong">⚠️ CAUTION</span>`:''}</div>
          ${isGiven?'<div class="mgmt-done">✅ Done</div>':`<button class="btn-give btn-give-gen" data-mid="${m.id}">Administer</button>`}
        </div>`;
      }).join('') + `</div></div>`;

    document.querySelectorAll('.btn-give-gen').forEach(b => b.addEventListener('click', () => {
      const res = this.engine.applyGeneralManagement(b.dataset.mid);
      if (res.success) { this._renderGeneralTab(); this._updateHUD(); }
      else this._showToast(res.msg,'warning');
    }));
  }

  // ── Diagnosis tab ──────────────────────────────────────────────────────────
  _renderDiagnosisTab() {
    const cur  = this.engine.state.selectedDiagnosis;
    const opts = this.case.diagnosisOptions;
    document.getElementById('tab-diagnosiss').innerHTML = `
      <div class="diagnosis-container">
        <br><div class="disease-mgmt-label">SELECT YOUR DIAGNOSIS :</strong></div>
        <div class="diagnosis-info-box">🔒 The <strong>Treatment</strong> tab unlocks after you select a diagnosis. You can change it at any time, the final selection at case end is scored.</div>
        <div class="diagnosis-options">
          ${opts.map(o=>`<div class="diagnosis-option ${cur===o.id?'selected':''}" data-did="${o.id}">
            <div class="diag-radio ${cur===o.id?'filled':''}"></div>
            <div class="diag-label">${o.label}</div>
          </div>`).join('')}
        </div>
        <div class="diag-current">${cur?`Working Dx: <strong>${opts.find(o=>o.id===cur)?.label}</strong>`:'No diagnosis selected'}</div><br><br>
      </div>`;

    document.querySelectorAll('.diagnosis-option').forEach(el => el.addEventListener('click', () => {
      this.engine.setDiagnosis(el.dataset.did);
    }));
  }

  // ── Disease-specific treatment tab ────────────────────────────────────────
  _renderDiseaseTab() {
    const diagId = this.engine.state.selectedDiagnosis;
    const panel  = document.getElementById('tab-disease');
    const lock   = document.getElementById('treatment-lock');
    if (!diagId) {
      if(lock){lock.textContent='🔒';lock.classList.add('badge-locked');}
      panel.innerHTML=`<div class="locked-treatment"><div class="lock-icon">🔒</div><div class="lock-title">Treatment Locked</div><div class="lock-desc">Select a working diagnosis in the Diagnosis tab to unlock disease-specific treatment options.</div></div>`;
      return;
    }
    if(lock){lock.textContent='';lock.classList.remove('badge-locked');}

    const diagLabel = this.case.diagnosisOptions.find(d=>d.id===diagId)?.label||diagId;
    const opts = this.case.managementOptions.diseaseSpecific?.[diagId];
    if (!opts) { panel.innerHTML=`<div class="empty-state">No treatment options for: ${diagLabel}</div>`; return; }

    const given = this.engine.state.givenManagement.map(g=>g.id);
    const stage = this.engine.state.stage;

    panel.innerHTML = `<div class="mgmt-container">
            <div class="disease-mgmt-label">DIAGNOSIS MANAGEMENT :</strong></div>
      <div class="disease-mgmt-header">
        <div class="disease-mgmt-warning">⚠️ Wrong treatments and blunders incur score penalties. Blunders may end the case.</div>
      </div>
      <div class="mgmt-grid">` +
      opts.map(m => {
        const isGiven   = given.includes(m.id);
        const eff       = m.stageEffect?.[stage] || {};
        const isBlocked = eff.blocked;
        const cls = [isGiven?'mgmt-given':'', m.type==='curative'?'mgmt-curative':'', m.type==='wrong'?'mgmt-wrong':'', m.type==='blunder'?'mgmt-blunder':'', isBlocked?'mgmt-blocked':''].join(' ');
        return `<!--<div class="mgmt-card ${cls}">--><div class="mgmt-card">
          <div class="mgmt-name">${m.name}</div>
          <div class="mgmt-fullname">${m.fullName}</div>
          <div class="mgmt-meta">
            <span>🪙${m.cost}</span>
            <!--${m.type==='curative'?'<span class="badge-curative">DEFINITIVE</span>':''}
            ${m.type==='blunder'?'<span class="badge-blunder">🚨 RISKY</span>':''}
            ${m.type==='wrong'?'<span class="badge-wrong">⚠️</span>':''}-->
          </div>
          ${isGiven?'<div class="mgmt-done">✅ Administered</div>'
            :isBlocked?`<div class="mgmt-blocked-msg">🚫 ${eff.note||'Not applicable now'}</div>`
            :`<!--<button class="btn-give btn-give-dis ${m.type==='curative'?'btn-curative':''}" data-mid="${m.id}" data-did="${diagId}">${m.type==='curative'?'⚡ Perform':'Administer'}</button>--><button class="btn-give btn-give-dis" data-mid="${m.id}" data-did="${diagId}">Administer</button>`}
        </div>`;
      }).join('') + `</div></div>`;

    document.querySelectorAll('.btn-give-dis').forEach(b => b.addEventListener('click', () => {
      const res = this.engine.applyDiseaseManagement(b.dataset.mid, b.dataset.did);
      if (res.success) { this._renderDiseaseTab(); this._renderGeneralTab(); this._updateHUD(); }
      else this._showToast(res.msg,'warning');
    }));
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  _updateHUD() {
    const s = this.engine.state;
    const te = document.getElementById('stat-time');
    if (te) te.textContent = this.engine._formatTime(s.time);

    const se = document.getElementById('stat-stage');
    if (se) { se.textContent = this.engine.getCurrentStageLabel(); se.className = `hud-value mono stage-color-${this.engine.getCurrentStageColor()}`; }

    const be = document.getElementById('stat-budget');
    if (be) {
      const rem = s.budget - s.cost, over = rem < 0;
      be.textContent = `🪙 ${over?'-':''}${Math.abs(rem).toLocaleString()}`;
      be.className   = `hud-value mono${over?' budget-over':rem<600?' budget-low':''}`;
    }

    const ve = document.getElementById('hud-vitals');
    if (ve) {
      const wHR = s.vitals.hr>110||s.vitals.hr<50;
      const wBP = parseInt((s.vitals.bp||'120/80').split('/')[0])<100;
      const wT  = s.vitals.temp>38.5;
      ve.innerHTML = `
        <div class="vital-hud-item${wHR?' vital-warn':''}">❤️ ${s.vitals.hr}</div>
        <div class="vital-hud-item${wBP?' vital-warn':''}">🫀 ${s.vitals.bp}</div>
        <div class="vital-hud-item${wT?' vital-warn':''}">🌡️ ${s.vitals.temp}°C</div>
        <div class="vital-hud-item">💨 ${s.vitals.rr||18}</div>`;
    }

    const color = s.cured ? 'green' : this.engine.getCurrentStageColor();
    const glow  = document.getElementById('stage-glow');
    const badge = document.getElementById('stage-badge');
    const btext = document.getElementById('stage-badge-text');
    if (glow)  glow.className  = `stage-glow glow-${color}`;
    if (badge) badge.className = `patient-stage-badge stage-badge-${color}`;
    if (btext) btext.textContent = this.engine.getCurrentStageLabel();

    this._updateSymptoms();
    this._refreshResults();
    // Refresh test card statuses without full re-render
    this.case.tests.forEach(t => {
      const card = document.getElementById(`tc-${t.id}`);
      if (!card) return;
      const pend  = this.engine.state.pendingResults.some(r=>r.testId===t.id);
      const done  = this.engine.state.completedTests.some(r=>r.testId===t.id);
      const avail = t.stageAvailability?.includes(this.engine.state.stage);
      card.className = `test-card ${pend?'test-pending':done?'test-done':!avail?'test-unavailable':''}`;
    });
  }

  // ── Log ───────────────────────────────────────────────────────────────────
  _appendLog(e) {
    const c = document.getElementById('log-entries');
    if (!c) return;
    const d = document.createElement('div');
    d.className = `log-entry log-${e.type}`;
    d.innerHTML = `<span class="log-time">${e.timeLabel}</span><span class="log-msg">${e.msg}</span>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  _showToast(msg, type='info') {
    const c = document.getElementById('toasts');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = msg;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast-show'));
    setTimeout(() => { t.classList.remove('toast-show'); setTimeout(()=>t.remove(),300); }, 3500);
  }

  // ── Stage flash ───────────────────────────────────────────────────────────
  _flashStage(d) {
    const color = this.case.stages[d.to]?.color||'red';
    const label = this.case.stages[d.to]?.label||d.to;
    const el = document.createElement('div');
    el.className = `stage-flash stage-flash-${color}`;
    el.innerHTML = `<div class="stage-flash-content"><div class="stage-flash-icon">⚠️</div><div class="stage-flash-text">Condition Worsened</div><div class="stage-flash-sub">${label}</div></div>`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 2800);
  }

  _pulseGlow(color) {
    const g = document.getElementById('stage-glow');
    if (g) { g.className=`stage-glow glow-${color} glow-pulse`; }
  }

  // ── Game Over ─────────────────────────────────────────────────────────────
  _handleGameOver(d) {
    const modal = document.getElementById('modal-gameover');
    const cont  = document.getElementById('gameover-content');
    if (!modal||!cont) return;
    const death = d.reason==='death';
    cont.innerHTML = `
      <div class="gameover-header ${death?'gameover-death':'gameover-transfer'}">
        <div class="gameover-icon">${death?'💀':'🚑'}</div>
        <div class="gameover-title">${death?'Patient Deceased':'Patient Transferred'}</div>
        <div class="gameover-sub">${death?'The patient died due to disease progression without adequate treatment.':'Patient has been transferred to a higher centre.'}</div>
      </div>
      <div class="gameover-actions">
        <button class="btn-home" id="go-score">View Scorecard</button>
        <button class="btn-back-home" id="go-home2">Back to Cases</button>
      </div>`;
    modal.classList.remove('hidden');
    document.getElementById('go-score')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this.showScoreModal(this.engine.calculateScore());
    });
    document.getElementById('go-home2')?.addEventListener('click', () => document.referrer ? history.back() : window.location.href = '/');
  }

  // ── Score modal ───────────────────────────────────────────────────────────
  showScoreModal(sc) {
    const modal = document.getElementById('modal-score');
    const cont  = document.getElementById('score-content');
    if (!modal||!cont) return;
    const gc = {A:'#10b981','A+':'#10b981',B:'#f59e0b',C:'#f97316',F:'#ef4444'}[sc.grade]||'#ef4444';
    const cdx = this.case.diagnosisOptions.find(d=>d.id===sc.correctDiagnosis)?.label||sc.correctDiagnosis;
    const udx = this.case.diagnosisOptions.find(d=>d.id===sc.selectedDiagnosis)?.label||'(none)';
    cont.innerHTML = `
      <div class="score-header">
        <div class="score-grade" style="color:${gc}">${sc.grade}</div>
        <div class="score-number">${sc.score}<span>/100</span></div>
        <div class="score-msg">${sc.msg}</div>
      </div>
      <div class="score-dx-compare">
        <div class="dx-row"><span class="dx-label">Correct Dx</span><span class="dx-value correct">${cdx}</span></div>
        <div class="dx-row"><span class="dx-label">Your Dx</span><span class="dx-value ${sc.diagnosisCorrect?'correct':'wrong'}">${udx}</span></div>
      </div>
      <div class="score-breakdown">${sc.breakdown.map(b=>`
        <div class="score-row">
          <span class="score-label">${b.label}</span>
          <span class="score-pts ${b.earned<0?'neg':b.earned===0?'zero':'pos'}">${b.earned>0?'+':''}${b.earned}</span>
        </div>`).join('')}
      </div>
      <div class="score-stats">
        <div class="stat-row"><span>Time elapsed</span><strong>${this.engine._formatTime(sc.time)}</strong></div>
        <div class="stat-row"><span>Final stage</span><strong>${this.case.stages[sc.stage]?.label||sc.stage}</strong></div>
        <div class="stat-row"><span>Coins spent</span><strong>🪙 ${sc.cost.toLocaleString()} / ${sc.budget.toLocaleString()}</strong></div>
        <div class="stat-row"><span>Outcome</span><strong>${sc.cured?'✅ Cured':sc.outcome==='death'?'💀 Died':'🚑 Transferred'}</strong></div>
      </div>
      ${sc.mistakes?.length?`
      <div class="score-mistakes">
        <div class="mistakes-label">Areas for Improvement</div>
        ${sc.mistakes.map(m=>`<div class="mistake-item mistake-${m.type}">${m.label}</div>`).join('')}
      </div>`:''}
      <div class="score-actions">
        <button class="btn-home" id="score-home">Back to Cases</button>
      </div>`;
    modal.classList.remove('hidden');
    document.getElementById('score-home')?.addEventListener('click', () => document.referrer ? history.back() : window.location.href = '/');
    }

  // ── UI event bindings ─────────────────────────────────────────────────────
  _bindUIEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
      const tab = b.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById(`tab-${tab}`)?.classList.add('active');
      this.activeTab = tab;
      if (tab==='results') this._refreshResults();
      if (tab==='disease') this._renderDiseaseTab();
      if (tab==='general') this._renderGeneralTab();
    }));

    // Back
    document.getElementById('btn-back')?.addEventListener('click', ()=>{
      if (confirm('Exit case? Progress will be lost.')) { this.engine.stop(); document.referrer ? history.back() : window.location.href = '/'; }
    });

  

    // Jump modal
    document.getElementById('btn-jump')?.addEventListener('click', ()=>document.getElementById('modal-jump')?.classList.remove('hidden'));
    document.getElementById('jump-close')?.addEventListener('click', ()=>document.getElementById('modal-jump')?.classList.add('hidden'));
    document.querySelectorAll('.jump-btn').forEach(b => b.addEventListener('click', ()=>{
      this.engine.jumpTime(parseFloat(b.dataset.h));
      document.getElementById('modal-jump')?.classList.add('hidden');
      this._renderTestsTab(); this._renderGeneralTab(); this._renderDiseaseTab();
    }));

    // Transfer
    document.getElementById('btn-resign')?.addEventListener('click', ()=>{
      if (confirm('Transfer patient to higher centre? This ends the case with a penalty.')) this.engine.resignCase();
    });

    // End & score
    document.getElementById('btn-end')?.addEventListener('click', ()=>{
      if (!this.engine.state.selectedDiagnosis && !confirm('No diagnosis selected — end anyway?')) return;
      this.engine.stop(); this.engine.ended = true;
      this.showScoreModal(this.engine.calculateScore());
    });
  }
}