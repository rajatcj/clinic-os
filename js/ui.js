/**
 * ClinicalUI v3 — Full UI controller
 * Changes from v2:
 *  - Custom CSS confirm/alert dialogs (no browser confirm/alert)
 *  - Mobile toasts appear at top
 *  - Auto-scroll to disease management on diagnosis selection
 *  - Proper cured endgame: review mode with notes/results revealed
 *  - Review mode HUD bar with "View Scorecard" button
 *  - Death/Transfer review mode (same reveal, different badge)
 *  - Mobile: activity log as FAB + bottom drawer with skip-time buttons
 *  - Back button removed (CSS hides it; end-case is the only exit)
 *  - Dynamic exam section rendering (any key in exam JSON)
 */
class ClinicalUI {
  constructor(engine, caseData) {
    this.engine    = engine;
    this.case      = caseData;
    this.activeTab = 'history';
    this._reviewMode = false;
    this._reviewOutcome = null; // 'cured' | 'death' | 'transfer'
    this._cachedScore = null;
    this._bindEngineEvents();
  }

  // ── Custom confirm / alert ────────────────────────────────────────────────
  _confirm(opts) {
    // opts: { icon, title, msg, okLabel, okClass, cancelLabel, onOk, onCancel }
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'cconfirm-overlay';
      overlay.innerHTML = `
        <div class="cconfirm-box">
          ${opts.icon ? `<div class="cconfirm-icon">${opts.icon}</div>` : ''}
          ${opts.title ? `<div class="cconfirm-title">${opts.title}</div>` : ''}
          ${opts.msg   ? `<div class="cconfirm-msg">${opts.msg}</div>` : ''}
          <div class="cconfirm-btns">
            <button class="cconfirm-btn-cancel">${opts.cancelLabel || 'Cancel'}</button>
            <button class="cconfirm-btn-ok ${opts.okClass || ''}">${opts.okLabel || 'Confirm'}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cconfirm-btn-cancel').onclick = () => close(false);
      overlay.querySelector('.cconfirm-btn-ok').onclick     = () => close(true);
      overlay.onclick = e => { if (e.target === overlay) close(false); };
    });
  }

  _alert(opts) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'cconfirm-overlay';
      overlay.innerHTML = `
        <div class="cconfirm-box">
          ${opts.icon ? `<div class="cconfirm-icon">${opts.icon}</div>` : ''}
          ${opts.title ? `<div class="cconfirm-title">${opts.title}</div>` : ''}
          ${opts.msg   ? `<div class="cconfirm-msg">${opts.msg}</div>` : ''}
          <div class="cconfirm-btns">
            <button class="cconfirm-btn-ok ok-green" style="flex:1">${opts.okLabel || 'OK'}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.cconfirm-btn-ok').onclick = () => { overlay.remove(); resolve(); };
    });
  }

  // ── Engine bindings ───────────────────────────────────────────────────────
  _bindEngineEvents() {
    this.engine
      .on('tick',            ()  => this._updateHUD())
      .on('stateChanged',    ()  => this._updateHUD())
      .on('stageChanged',    d   => { this._updateHUD(); this._flashStage(d); })
      .on('testResult',      r   => { this._showToast(`📋 Result ready: ${r.name}`, 'info'); this._refreshResults(); })
      .on('log',             e   => { this._appendLog(e); this._appendDrawerLog(e); })
      .on('cured',           ()  => {
        this._updateHUD();
        this._reviewMode = true;
        this._reviewOutcome = 'cured';
        this._onCureSubmit();
        this._showCuredModal();
      })
      .on('gameOver',        d   => this._handleGameOver(d))
      .on('diagnosisChanged',d   => {
        this._renderDiagnosisTab();
        this._renderDiseaseTab();
        this._showToast(`🩺 Dx: ${d.label}`, 'info');
        // Scroll to disease management
        setTimeout(() => {
          const anchor = document.getElementById('disease-scroll-anchor');
          if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      });
  }

  // ── Score submission on cure ──────────────────────────────────────────────
  async _onCureSubmit() {
    const MS = window.MedSim;
    if (!MS) return;
    try {
      const user = await new Promise(resolve => {
        const current = MS.currentUser();
        if (current !== null && current !== undefined) { resolve(current); return; }
        const unsub = MS.onAuthChange(u => { unsub(); resolve(u); });
      });
      if (!user) return;
      await user.getIdToken(true);
      const result = await MS.submitGameResult(
        this.case.id,
        this.engine.getState(),
        this.engine.calculateScore(),
        this.engine.log
      );
      if (result.written) this._showToast('🏆 First attempt score saved!', 'success');
      else if (result.alreadyPlayed) this._showToast('📋 Score recorded — first attempt stands.', 'info');
    } catch (e) {
      console.warn('Score submit failed:', e.code, e.message);
    }
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
    this._buildMobileLogFAB();
  }

  _gameHTML() {
    const c = this.case, p = c.clinicalPresentation.patientParticulars;
    return `
    <div class="game-layout">
      <header class="game-header">
        <div class="header-left">
          <button class="btn-back" id="btn-back">←</button>
          <div class="case-title-small">${c.title}</div>
          <div class="patient-stage-badge stage-badge-yellow" id="stage-badge"><span id="stage-badge-text">—</span></div>
        </div>
        <div class="header-right">
          <div class="hud-stats">
            <div class="hud-stat btn-jump" id="btn-jump"><span class="hud-label">TIME</span><span class="hud-value mono" id="stat-time">00h 00m</span></div>
            <div class="hud-stat"><span class="hud-label">COINS</span><span class="hud-value mono" id="stat-budget">🪙—</span></div>
          </div>
          <div class="hud-actions">
            <button class="btn-resign" id="btn-resign">🚑 Transfer</button>
            <button class="btn-end" id="btn-end">End & Score</button>
          </div>
        </div>
      </header>

      <div id="review-mode-bar" style="display:none" class="review-mode-bar">
        <div class="review-label">📖 REVIEW MODE, All notes unlocked</div>
        <button class="btn-to-score" id="btn-review-to-score">View Scorecard →</button>
      </div>

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
        </div>
      </div>

      <div class="game-body">
        <div class="tab-bar">
          <button class="tab-btn active" data-tab="history">CASE</button>
          <button class="tab-btn" data-tab="tests">TESTS<span class="badge" id="results-badge">0</span></button>
          <button class="tab-btn" data-tab="general">MANAGEMENT</button>
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
            <div id="tab-diagnosiss"></div>
            <div id="disease-scroll-anchor"></div>
            <div id="tab-disease"></div>
          </div>
        </div>
      </div>

      <aside class="log-panel">
        <div class="log-header">Activity Log</div>
        <div class="log-entries" id="log-entries"></div>
      </aside>
    </div>

    <!-- Mobile log drawer -->
    <div class="log-drawer" id="log-drawer">
      <div class="log-drawer-backdrop" id="log-drawer-backdrop"></div>
      <div class="log-drawer-sheet">
        <div class="log-drawer-header">
          <div class="log-drawer-title">📋 Activity Log</div>
          <div class="log-drawer-skip">
            <button class="log-drawer-skip-btn" data-h="0.5">+30m</button>
            <button class="log-drawer-skip-btn" data-h="1">+1h</button>
            <button class="log-drawer-skip-btn" data-h="2">+2h</button>
            <button class="log-drawer-skip-btn" data-h="4">+4h</button>
            <button class="log-drawer-skip-btn" data-h="6">+6h</button>
          </div>
        </div>
        <div class="log-drawer-entries" id="log-drawer-entries"></div>
        <button class="log-drawer-close" id="log-drawer-close">✕ Close</button>
      </div>
    </div>

    <div class="modal-overlay hidden" id="modal-jump">
      <div class="modal">
        <div class="modal-title">⏩ Skip Time</div>
        <p class="modal-desc">Advance simulation time. Pending results arrive if due, disease evolves.</p>
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
    <div class="modal-overlay hidden" id="modal-cured">
      <div class="modal modal-cured" id="cured-content"></div>
    </div>
    <div class="toast-container" id="toasts"></div>`;
  }

  // ── Mobile FAB + drawer ───────────────────────────────────────────────────
  _buildMobileLogFAB() {
    const fab = document.createElement('button');
    fab.className = 'log-fab';
    fab.id = 'log-fab';
    fab.innerHTML = `LOG<span class="fab-dot"></span>`;
    fab.title = 'Activity Log';
    document.body.appendChild(fab);

    fab.addEventListener('click', () => this._openLogDrawer());
    document.getElementById('log-drawer-close')?.addEventListener('click', () => this._closeLogDrawer());
    document.getElementById('log-drawer-backdrop')?.addEventListener('click', () => this._closeLogDrawer());

    document.querySelectorAll('.log-drawer-skip-btn').forEach(b => {
      b.addEventListener('click', () => {
        this.engine.jumpTime(parseFloat(b.dataset.h));
        this._renderTestsTab();
        this._renderGeneralTab();
        this._renderDiseaseTab();
        this._closeLogDrawer();
      });
    });
  }

  _openLogDrawer() {
    const drawer = document.getElementById('log-drawer');
    if (drawer) drawer.classList.add('open');
    const fab = document.getElementById('log-fab');
    if (fab) fab.classList.remove('has-new');
  }

  _closeLogDrawer() {
    const drawer = document.getElementById('log-drawer');
    if (drawer) drawer.classList.remove('open');
  }

  _appendDrawerLog(e) {
    const c = document.getElementById('log-drawer-entries');
    if (!c) return;
    const d = document.createElement('div');
    d.className = `log-entry log-${e.type}`;
    d.innerHTML = `<span class="log-time">${e.timeLabel}</span><span class="log-msg">${e.msg}</span>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    // Light up FAB
    const fab = document.getElementById('log-fab');
    const drawer = document.getElementById('log-drawer');
    if (fab && drawer && !drawer.classList.contains('open')) {
      fab.classList.add('has-new');
    }
  }

  // ── History tab ───────────────────────────────────────────────────────────
  _renderHistoryTab() {
    const cp = this.case.clinicalPresentation, p = cp.patientParticulars;

    // Dynamic exam sections — render ALL keys in cp.exam, not just general/others
    const examSectionsHTML = Object.entries(cp.exam || {}).map(([key, val]) => {
      const label = key.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
      const items = Array.isArray(val) ? val : [val];
      return `<div class="exam-section">
        <div class="exam-label">${label}</div>
        <ul class="detail-list">${items.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>`;
    }).join('');

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
            <div class="vital-item"><span>Weight</span><strong>${cp.vitals.weight}</strong></div>
          </div>
        </div>
        <div class="info-card full-width clue-card">
          <div class="card-label">SPONSORED SEGMENT</div>
          <h2>SPONSORED ADS SPACE</h2>
          <ul class="detail-list"><li>A free service still take resources to operate. To purchase Database, Host, Domain and API services. The cases of this website will always be free of cost available for everyone powered by our sponsors.</li></ul>
          Place your advertisement? Contace me at <a style="color: #0dbd8b;" href="mail@rajatcj.com">mail@rajatcj.com</a>
        </div>
        <div class="info-card full-width">
          <div class="card-label">Examination</div>
          <div class="exam-sections">${examSectionsHTML}</div>
        </div>
        <div class="info-card full-width">
          <div class="card-label">Current Active Symptoms</div>
          <div class="symptom-tags" id="active-symptoms"></div>
        </div>
        ${this.case.clinicalClue ? `
        <div class="info-card full-width clue-card">
            <label class="spoiler-overlay" for="spoiler-1">
    <input type="checkbox" id="spoiler-1">
    <span class="spoiler-title">⚡ Clinical Clue</span>
    <span class="spoiler-hint">Click to reveal, try to solve without it first!</span>
  </label>
          <div class="card-label">⚡ Clinical Clue</div>
          <div class="card-value">${this.case.clinicalClue}</div>
        </div>` : ''}
        
        <div class="skip-inline-bar">
          <span class="skip-inline-label">⏩ Skip Time:</span>
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
    const cats  = [...new Set(this.case.tests.map(t=>t.category))];
    const stage = this.engine.state.stage;
    const review = this._reviewMode;

    document.getElementById('tab-testss').innerHTML = `<br><div class="disease-mgmt-label">SELECT YOUR TESTS:</div><div class="tests-container">` +
      cats.map(cat => {
        const tests = this.case.tests.filter(t=>t.category===cat);
        return `<div class="test-category"><div class="category-label">${cat}</div><div class="test-grid">
          ${tests.map(t => {
            const pend  = this.engine.state.pendingResults.some(r=>r.testId===t.id);
            const done  = this.engine.state.completedTests.some(r=>r.testId===t.id);
            const avail = t.stageAvailability?.includes(stage);
            const cls   = pend?'test-pending':done?'test-done':!avail&&!review?'test-unavailable':'';

            // In review mode, show all stage results for each test
            let reviewBlock = '';
            if (review && t.results) {
              reviewBlock = `<div class="review-stage-results">` +
                Object.entries(t.results).map(([stg, res]) => {
                  const stgLabel = this.case.stages?.[stg]?.label || stg;
                  return `<div class="review-stage-row"><strong>${stgLabel}:</strong> <span>${res}</span></div>`;
                }).join('') +
                `</div>`;
            }

            return `<div class="test-card ${cls}" id="tc-${t.id}">
              <div class="test-name">${t.name}</div>
              <div class="test-fullname">${t.fullName}</div>
              <div class="test-meta"><span>⏱ ${this.engine._fmtDur(t.time)}</span><span>🪙${t.cost}</span>${t.type==='dummy'?'<span class="test-type-dummy">Non-specific</span>':''}</div>
              ${review
                ? `<div class="test-status done">📖 Review</div>${reviewBlock}`
                : !avail&&!done&&!pend?'<div class="test-status">Not available</div>'
                  :pend?'<div class="test-status">⏳ Pending…</div>'
                  :done?'<div class="test-status done">✅ Done, check Logs for effect</div>'
                  :`<button class="btn-order" data-tid="${t.id}">Order</button>`}
            </div>`;
          }).join('')}
        </div></div>`;
      }).join('') + `</div>`;

    if (!review) {
      document.querySelectorAll('.btn-order[data-tid]').forEach(b => b.addEventListener('click', () => {
        const res = this.engine.orderTest(b.dataset.tid);
        if (res.success) { this._renderTestsTab(); if(res.willOverspend) this._showToast('⚠️ Over budget — score penalised','warning'); }
        else this._showToast(res.msg,'warning');
      }));
    }
  }

  // ── Results tab ───────────────────────────────────────────────────────────
  _refreshResults() {
    const done = this.engine.state.completedTests;
    const pend = this.engine.state.pendingResults;

    const badge = document.getElementById('results-badge');
    if (badge) badge.textContent = done.length;

    const panel = document.getElementById('tab-results');
    if (!panel) return;

    const stateKey = JSON.stringify({
      d: done.map(x=>x.name),
      p: pend.map(x=>x.testId),
      r: this._reviewMode
    });

    if (panel.dataset.lastKey === stateKey) {
      pend.forEach(r => {
        const etaEl = panel.querySelector(`[data-eta="${r.testId}"]`);
        if (!etaEl) return;
        const eta = Math.max(0, r.readyAt - this.engine.state.time);
        etaEl.textContent = `ETA: ~${this.engine._fmtDur(eta)}`;
      });
      return;
    }

    panel.dataset.lastKey = stateKey;

    // In review mode: show ALL test results for all stages
    if (this._reviewMode) {
      let html = '<br><div class="disease-mgmt-label">ALL TEST RESULTS (REVIEW):</div>';
      html += this.case.tests.map(t => {
        const stageResultsHTML = Object.entries(t.results || {}).map(([stg, res]) => {
          const stgLabel = this.case.stages?.[stg]?.label || stg;
          const interp   = t.interpretation?.[stg] || '';
          return `<div class="review-stage-row"><strong>${stgLabel}:</strong> <span>${res}</span>
            ${interp ? `<br><em style="color:var(--blue);font-size:9px">💡 ${interp}</em>` : ''}</div>`;
        }).join('');
        return `
          <div class="result-card review-reveal">
            <div class="result-header">
              <span class="result-name">${t.name}</span>
              <span class="result-time">${t.fullName}</span>
            </div>
            <div class="review-stage-results">${stageResultsHTML}</div>
          </div>`;
      }).join('');
      panel.innerHTML = `<div class="results-container">${html}</div>`;
      return;
    }

    if (!done.length && !pend.length) {
      panel.innerHTML = `
        <br>
        <div class="disease-mgmt-label">TEST REPORTS:</div>
        <div class="empty-state">No investigations ordered yet.</div>`;
      return;
    }

    let html = '<br><div class="disease-mgmt-label">TEST REPORTS:</div>';
    if (pend.length) {
      html += `<div class="results-section-label">⏳ Awaiting Results (Click on the clock at the top to skip time)</div>`;
      html += pend.map(r => {
        const t   = this.case.tests.find(x=>x.id===r.testId);
        const eta = Math.max(0, r.readyAt - this.engine.state.time);
        return `<div class="result-card pending">
          <div class="result-name">${t?.name||r.testId}</div>
          <div class="result-eta" data-eta="${r.testId}">ETA: ~${this.engine._fmtDur(eta)}</div>
        </div>`;
      }).join('');
    }
    if (done.length) {
      html += `<div class="results-section-label">✅ Results Available</div>`;
      html += done.slice().reverse().map(r => `
        <div class="result-card done">
          <div class="result-header">
            <span class="result-name">${r.name}</span>
            <span class="result-time">${r.timeLabel}</span>
          </div>
          <div class="result-text">${r.result}</div>
          
        </div>`).join('');
    }
    panel.innerHTML = `<div class="results-container">${html}</div>`;
  }

  // ── General management tab ────────────────────────────────────────────────
  _renderGeneralTab() {
    const given  = this.engine.state.givenManagement.map(g=>g.id);
    const opts   = this.case.managementOptions.general || [];
    const review = this._reviewMode;

    document.getElementById('tab-general').innerHTML = `
      <br><div class="disease-mgmt-label">GENERAL MANAGEMENT:</div><br>
      <div class="mgmt-container" style="width:100%"><div class="mgmt-grid">` +
      opts.map(m => {
        const isGiven = given.includes(m.id);
        const isBad   = m.type==='wrong'||m.type==='dummy';

        // Collect all stage notes for review
        let reviewNotes = '';
        if (review && m.stageEffect) {
          reviewNotes = Object.entries(m.stageEffect).map(([stg, eff]) => {
            const stgLabel = this.case.stages?.[stg]?.label || stg;
            return eff.note ? `<span class="review-note-pill ${isBad?'pill-warn':''}">${stgLabel}: ${eff.note}</span>` : '';
          }).join('');
        }

        return `<div class="mgmt-card ${isGiven?'mgmt-given':''} ${isBad?'mgmt-wrong':''} ${review?'review-open':''}">
          <div class="mgmt-name">${m.name}</div>
          <div class="mgmt-fullname">${m.fullName}</div>
          <div class="mgmt-meta"><span>🪙${m.cost}</span>${isBad?`<span class="badge-wrong">⚠️ CAUTION</span>`:''}</div>
          ${isGiven
            ? '<div class="mgmt-done">✅ Done, check Logs for effect</div>'
            : review
              ? '<div class="mgmt-done" style="color:var(--text-dim)">— Not administered</div>'
              : `<button class="btn-give btn-give-gen" data-mid="${m.id}">Administer</button>`}
          ${review && reviewNotes ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${reviewNotes}</div>` : ''}
          ${review && m.description ? `<div class="mgmt-review-note" style="display:block">${m.description}</div>` : ''}
        </div>`;
      }).join('') + `</div></div>`;

    if (!review) {
      document.querySelectorAll('.btn-give-gen').forEach(b => b.addEventListener('click', () => {
        const res = this.engine.applyGeneralManagement(b.dataset.mid);
        if (res.success) { this._renderGeneralTab(); this._updateHUD(); }
        else this._showToast(res.msg,'warning');
      }));
    }
  }

  // ── Diagnosis tab ──────────────────────────────────────────────────────────
  _renderDiagnosisTab() {
    const cur    = this.engine.state.selectedDiagnosis;
    const opts   = this.case.diagnosisOptions;
    const review = this._reviewMode;

    document.getElementById('tab-diagnosiss').innerHTML = `
      <div class="diagnosis-container">
        <br><div class="disease-mgmt-label">SELECT YOUR DIAGNOSIS:</div>
        ${!review ? `<div class="diagnosis-info-box">🔒 The <strong>Treatment</strong> tab unlocks after you select a diagnosis. You can change it at any time — the final selection at case end is scored.</div>` : ''}
        <div class="diagnosis-options">
          ${opts.map(o => {
            const isCorrect = o.correct;
            return `<div class="diagnosis-option ${cur===o.id?'selected':''}" data-did="${o.id}" style="${review&&isCorrect?'border-color:rgba(13,189,139,.5);background:rgba(13,189,139,.05)':''}">
              <div class="diag-radio ${cur===o.id?'filled':''}"></div>
              <div class="diag-label">${o.label}${review&&isCorrect?' <span style="color:var(--green);font-size:10px">✓ Correct</span>':''}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="diag-current">${cur?`Working Dx: <strong>${opts.find(o=>o.id===cur)?.label}</strong>`:'No diagnosis selected'}</div><br><br>
      </div>`;

    if (!review) {
      document.querySelectorAll('.diagnosis-option').forEach(el => el.addEventListener('click', () => {
        this.engine.setDiagnosis(el.dataset.did);
      }));
    }
  }

  // ── Disease-specific treatment tab ────────────────────────────────────────
  _renderDiseaseTab() {
    const diagId = this.engine.state.selectedDiagnosis;
    const panel  = document.getElementById('tab-disease');
    const review = this._reviewMode;

    if (!diagId) {
      panel.innerHTML = `<div class="locked-treatment"><div class="lock-icon">🔒</div><div class="lock-title">Treatment Locked</div><div class="lock-desc">Select a working diagnosis in the Diagnosis tab to unlock disease-specific treatment options.</div></div>`;
      return;
    }

    const diagLabel = this.case.diagnosisOptions.find(d=>d.id===diagId)?.label||diagId;
    const opts      = this.case.managementOptions.diseaseSpecific?.[diagId];
    if (!opts) { panel.innerHTML = `<div class="empty-state">No treatment options for: ${diagLabel}</div>`; return; }

    const given = this.engine.state.givenManagement.map(g=>g.id);
    const stage = this.engine.state.stage;

    panel.innerHTML = `<div class="mgmt-container">
      <div class="disease-mgmt-label">DIAGNOSIS MANAGEMENT:</div>
      <div class="disease-mgmt-header">
        <div class="disease-mgmt-warning">⚠️ Wrong treatments and blunders incur score penalties. Blunders may end the case.</div>
      </div>
      <div class="mgmt-grid">` +
      opts.map(m => {
        const isGiven   = given.includes(m.id);
        const eff       = m.stageEffect?.[stage] || {};
        const isBlocked = eff.blocked && !review;

        // Build review notes across all stages
        let reviewNotes = '';
        if (review && m.stageEffect) {
          reviewNotes = Object.entries(m.stageEffect).map(([stg, e]) => {
            const stgLabel = this.case.stages?.[stg]?.label || stg;
            const parts = [];
            if (e.note) parts.push(e.note);
            if (e.cure) parts.push('✅ Curative');
            if (e.penalty) parts.push(`⚠️ Penalty: ${e.penalty}`);
            if (e.blocked) parts.push('🚫 Blocked at this stage');
            return parts.length ? `<div class="review-stage-row"><strong>${stgLabel}:</strong> <span>${parts.join(' · ')}</span></div>` : '';
          }).join('');
        }

        const typeColor = m.type==='curative'?'mgmt-curative':m.type==='wrong'?'mgmt-wrong':m.type==='blunder'?'mgmt-blunder':'';
        return `<div class="mgmt-card ${typeColor} ${isGiven?'mgmt-given':''} ${isBlocked?'mgmt-blocked':''} ${review?'review-open':''}">
          <div class="mgmt-name">${m.name}</div>
          <div class="mgmt-fullname">${m.fullName}</div>
          <div class="mgmt-meta"><span>🪙${m.cost}</span></div>
          ${isGiven
            ? '<div class="mgmt-done">✅ Administered, check Logs for effect</div>'
            : isBlocked
              ? `<div class="mgmt-blocked-msg">🚫 ${eff.note||'Not applicable now'}</div>`
              : review
                ? '<div class="mgmt-done" style="color:var(--text-dim)">— Not administered</div>'
                : `<button class="btn-give btn-give-dis" data-mid="${m.id}" data-did="${diagId}">Administer</button>`}
          ${review && reviewNotes ? `<div class="review-stage-results">${reviewNotes}</div>` : ''}
          ${review && m.description ? `<div class="mgmt-review-note" style="display:block">${m.description}</div>` : ''}
        </div>`;
      }).join('') + `</div></div>`;

    if (!review) {
      document.querySelectorAll('.btn-give-dis').forEach(b => b.addEventListener('click', () => {
        const res = this.engine.applyDiseaseManagement(b.dataset.mid, b.dataset.did);
        if (res.success) { this._renderDiseaseTab(); this._renderGeneralTab(); this._updateHUD(); }
        else this._showToast(res.msg,'warning');
      }));
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  _updateHUD() {
    const s = this.engine.state;

    const te = document.getElementById('stat-time');
    if (te) te.textContent = this.engine._formatTime(s.time);

    const be = document.getElementById('stat-budget');
    if (be) {
      const rem = s.budget - s.cost, over = rem < 0;
      be.textContent = `🪙 ${over?'-':''}${Math.abs(rem).toLocaleString()}`;
      be.className   = `hud-value mono${over?' budget-over':rem<600?' budget-low':''}`;
    }

    // Vitals HUD
    const renderVitals = (id) => {
      const ve = document.getElementById(id);
      if (!ve) return;
      const wHR = s.vitals.hr>110||s.vitals.hr<50;
      const wBP = parseInt((s.vitals.bp||'120/80').split('/')[0])<100;
      const wT  = s.vitals.temp>38.5;
      ve.innerHTML = `
        <div class="vital-hud-item${wHR?' vital-warn':''}">❤️ ${s.vitals.hr}</div>
        <div class="vital-hud-item${wBP?' vital-warn':''}">🫀 ${s.vitals.bp}</div>
        <div class="vital-hud-item${wT?' vital-warn':''}">🌡️ ${s.vitals.temp}°C</div>
        <div class="vital-hud-item">💨 ${s.vitals.rr||18}</div>`;
    };
    renderVitals('hud-vitals');
    renderVitals('hud-vitals-header');

    // Stage badge
    let color, badgeLabel, badgeClass;
    if (this._reviewMode) {
      if (this._reviewOutcome === 'cured') {
        color = 'green'; badgeLabel = '✅ Cured'; badgeClass = 'stage-badge-cured-review';
      } else if (this._reviewOutcome === 'death') {
        color = 'red'; badgeLabel = '💀 Death'; badgeClass = 'stage-badge-death';
      } else {
        color = 'amber'; badgeLabel = '🚑 Transferred'; badgeClass = 'stage-badge-transfer';
      }
    } else {
      color      = s.cured ? 'green' : this.engine.getCurrentStageColor();
      badgeLabel = this.engine.getCurrentStageLabel();
      badgeClass = `stage-badge-${color}`;
    }

    const glow  = document.getElementById('stage-glow');
    const badge = document.getElementById('stage-badge');
    const btext = document.getElementById('stage-badge-text');
    if (glow)  glow.className  = `stage-glow glow-${color}`;
    if (badge) badge.className = `patient-stage-badge ${badgeClass}`;
    if (btext) btext.textContent = badgeLabel;

    // Review mode bar
    // if (this._reviewMode) {
    //   const bar = document.getElementById('review-mode-bar');
    //   if (bar) bar.style.display = 'flex';
    // }

    this._updateSymptoms();
    this._refreshResults();

    this.case.tests.forEach(t => {
      const card = document.getElementById(`tc-${t.id}`);
      if (!card || this._reviewMode) return;
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

  // ── Cured endgame modal ───────────────────────────────────────────────────
  _showCuredModal() {
    this._pulseGlow('green');
    document.getElementById('btn-end')?.classList.add('btn-end-ready');
    

    const modal = document.getElementById('modal-cured');
    const cont  = document.getElementById('cured-content');
    if (!modal || !cont) return;

    const sc = this.engine.calculateScore();
    this._cachedScore = sc;

    cont.innerHTML = `
      <div class="cured-header">
        <div class="cured-icon">✅</div>
        <div class="cured-title">Patient Cured!</div>
        <div class="cured-sub">Excellent work! The patient has recovered. You can now review the full case details — all notes, drug mechanisms, and test results across all disease stages are now unlocked.</div>
      </div>
      <div class="cured-actions">
        <button class="btn-review-case" id="cured-btn-review">📖 Study Case (Review Mode)</button>
        <button class="btn-score-now" id="cured-btn-score">🏆 View Scorecard</button>
      </div>`;

    modal.classList.remove('hidden');

    document.getElementById('cured-btn-review')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this._enterReviewMode();
    });
    document.getElementById('cured-btn-score')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this.showScoreModal(sc);
    });
  }

  _enterReviewMode() {
    this._reviewMode = true;
    this._updateHUD();
    this._renderHistoryTab();
    this._renderTestsTab();
    this._refreshResults();
    this._renderGeneralTab();
    this._renderDiagnosisTab();
    this._renderDiseaseTab();
    this._showToast('📖 Review Mode — all notes and results unlocked', 'info');

    document.querySelector('.game-header').style.padding = "0";
    document.querySelector('.game-header').style.margin = "0";
    document.querySelector(".game-header").innerHTML = `
      <div id="review-mode-bar" class="review-mode-bar">
        <div class="review-label">📖 REVIEW MODE, All notes unlocked</div>
        <button class="btn-to-score" id="btn-review-to-score">View Scorecard →</button>
      </div>`;
    // Hide game controls that no longer apply
    const btnEnd    = document.getElementById('btn-end');
    const btnResign = document.getElementById('btn-resign');
    if (btnEnd)    { btnEnd.style.display = 'none'; }
    if (btnResign) { btnResign.style.display = 'none'; }

    // Wire review-to-score button
    document.getElementById('btn-review-to-score')?.addEventListener('click', () => {
      this.showScoreModal(this._cachedScore || this.engine.calculateScore());
    });
  }

  // ── Game Over ─────────────────────────────────────────────────────────────
  _handleGameOver(d) {
    this._reviewMode    = true;
    this._reviewOutcome = d.reason === 'death' ? 'death' : 'transfer';

    const sc = this.engine.calculateScore();
    this._cachedScore = sc;

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
        <button class="btn-review-case" id="go-review">Review Case</button>
        <button class="btn-home" id="go-score">View Scorecard</button>
        <button class="btn-back-home" id="go-home2">Back to Cases</button>
      </div>`;
    modal.classList.remove('hidden');

    document.getElementById('go-review')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this._enterReviewMode();
    });
    document.getElementById('go-score')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this.showScoreModal(sc);
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
        <button class="btn-review-case" id="score-review">📖 Review Case</button>
        <button class="btn-home" id="score-home">Back to Cases</button>
      </div>`;
    modal.classList.remove('hidden');

    document.getElementById('score-review')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this._enterReviewMode();
    });
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

    // Back button — hidden via CSS, but wire it anyway
    document.getElementById('btn-back')?.addEventListener('click', async () => {
      const ok = await this._confirm({
        icon: '🚪',
        title: 'Exit Case?',
        msg: 'All progress will be lost. Are you sure you want to leave?',
        okLabel: 'Exit',
        cancelLabel: 'Stay',
        okClass: ''
      });
      if (ok) { this.engine.stop(); document.referrer ? history.back() : window.location.href = '/'; }
    });

    // Jump modal
    document.getElementById('btn-jump')?.addEventListener('click', () => document.getElementById('modal-jump')?.classList.remove('hidden'));
    document.getElementById('jump-close')?.addEventListener('click', () => document.getElementById('modal-jump')?.classList.add('hidden'));
    document.querySelectorAll('.jump-btn').forEach(b => b.addEventListener('click', () => {
      this.engine.jumpTime(parseFloat(b.dataset.h));
      document.getElementById('modal-jump')?.classList.add('hidden');
      this._renderTestsTab(); this._renderGeneralTab(); this._renderDiseaseTab();
    }));

    // Transfer
    document.getElementById('btn-resign')?.addEventListener('click', async () => {
      const ok = await this._confirm({
        icon: '🚑',
        title: 'Transfer Patient?',
        msg: 'Transfer the patient to a higher centre? This ends the case with a score penalty.',
        okLabel: 'Transfer',
        okClass: 'ok-amber',
        cancelLabel: 'Cancel'
      });
      if (ok) this.engine.resignCase();
    });

    // End & score
    document.getElementById('btn-end')?.addEventListener('click', async () => {
      if (!this.engine.state.selectedDiagnosis) {
        const ok = await this._confirm({
          icon: '🩺',
          title: 'No Diagnosis Selected',
          msg: 'You have not selected a working diagnosis. End the case anyway?',
          okLabel: 'End Anyway',
          cancelLabel: 'Go Back'
        });
        if (!ok) return;
      }
      this.engine.stop(); this.engine.ended = true;
      const sc = this.engine.calculateScore();
      this._cachedScore = sc;
      this.showScoreModal(sc);
    });

    // Review-to-score (wired once bar appears)
    document.getElementById('btn-review-to-score')?.addEventListener('click', () => {
      this.showScoreModal(this._cachedScore || this.engine.calculateScore());
    });
  }
}
