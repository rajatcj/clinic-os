/**
 * ClinicalEngine v2
 * 1 real second = 1 sim minute
 */
class ClinicalEngine {
  constructor(caseData) {
    this.case     = caseData;
    this.state    = JSON.parse(JSON.stringify(caseData.initialState));
    this.listeners = {};
    this.tickInterval = null;
    this.tickRate = 1000;       // ms per tick
    this.simMinsPerTick = 1;    // 1 tick = 1 sim-minute
    this.paused = false;
    this.ended  = false;
    this.log    = [];
    this.progressionDelayBonus = 0;
    this.userId = 'guest_001'; // future auth hook
    this._stageEntryTimes = { [this.state.stage]: 0 };
  }

  // ── Event bus ────────────────────────────────────────────────────────────
  on(event, cb) {
    (this.listeners[event] = this.listeners[event] || []).push(cb);
    return this;
  }
  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  start() {
    this.tickInterval = setInterval(() => this._tick(), this.tickRate);
    this.emit('started', this.state);
    this.addLog('system', '🏥 Patient assessed. Simulation clock started.');
  }
  pause()  { this.paused = true;  this.emit('paused'); }
  resume() { this.paused = false; this.emit('resumed'); }
  stop()   { clearInterval(this.tickInterval); }

  // ── Time jump ─────────────────────────────────────────────────────────────
  jumpTime(hours) {
    const steps = Math.ceil((hours * 60) / this.simMinsPerTick);
    for (let i = 0; i < steps; i++) {
      this._advanceTime(this.simMinsPerTick);
      if (this.ended) break;
    }
    const lbl = hours < 1 ? `${hours * 60} minutes` : `${hours} hour${hours !== 1 ? 's' : ''}`;
    this.addLog('system', `⏩ Time advanced by ${lbl}.`);
    this.emit('stateChanged', this.state);
    this.emit('tick', this.state);
  }

  // ── Core tick ─────────────────────────────────────────────────────────────
  _tick() {
    if (this.paused || this.ended) return;
    this._advanceTime(this.simMinsPerTick);
    this.emit('tick', this.state);
  }

  _advanceTime(mins) {
    this.state.time += mins / 60;
    this._processPendingResults();
    this._checkProgression();
  }

  // ── Pending test results ──────────────────────────────────────────────────
  _processPendingResults() {
    const ready = this.state.pendingResults.filter(r => this.state.time >= r.readyAt);
    this.state.pendingResults = this.state.pendingResults.filter(r => this.state.time < r.readyAt);
    ready.forEach(r => {
      const test = this.case.tests.find(t => t.id === r.testId);
      if (!test) return;
      const resultText = test.results[this.state.stage] || test.results[Object.keys(test.results)[0]];
      const interpText = test.interpretation?.[this.state.stage] || '';
      const result = {
        testId: r.testId, name: test.name, fullName: test.fullName,
        result: resultText, interpretation: interpText,
        time: this.state.time, timeLabel: this._formatTime(this.state.time),
        stage: this.state.stage
      };
      this.state.completedTests.push(result);
      this.addLog('result', `📋 <strong>${test.name}</strong> result ready.`);
      this.emit('testResult', result);
    });
  }

  // ── Disease progression ───────────────────────────────────────────────────
  _checkProgression() {
    if (this.state.cured || this.ended) return;
    const cur = this.case.stages[this.state.stage];
    if (!cur?.next) return;
    const threshold = cur.afterTime + this.progressionDelayBonus;
    if (this.state.time >= threshold) {
      const rule = this.case.progressionRules.find(r => r.from === this.state.stage);
      this.progressionDelayBonus = 0;
      this._transitionStage(cur.next, rule);
    }
  }

  _transitionStage(newStage, rule) {
    const oldStage = this.state.stage;
    this.state.stage = newStage;
    this._stageEntryTimes[newStage] = this.state.time;
    if (rule?.effects) {
      const e = rule.effects;
      if (e.vitals)   Object.assign(this.state.vitals, e.vitals);
      if (e.symptoms) this.state.activeSymptoms = [...new Set([...this.state.activeSymptoms, ...e.symptoms])];
      if (e.penalty)  this.state.penalty += e.penalty;
      if (e.penaltyMsg) this.addLog('danger', `⚠️ ${e.penaltyMsg}`);
      if (e.endGame) {
        this.ended = true; this.stop();
        this.state.outcome = e.outcome || 'death';
        setTimeout(() => this.emit('gameOver', { reason: e.outcome, state: this.state }), 400);
        return;
      }
    }
    this.addLog('warning', `🔴 Stage advanced: <strong>${this.case.stages[newStage]?.label || newStage}</strong>`);
    this.emit('stageChanged', { from: oldStage, to: newStage, state: this.state });
  }

  // ── Order test ────────────────────────────────────────────────────────────
  orderTest(testId) {
    if (this.ended) return { success: false, msg: 'Case has ended.' };
    const test = this.case.tests.find(t => t.id === testId);
    if (!test) return { success: false, msg: 'Test not found.' };
    if (!test.stageAvailability?.includes(this.state.stage))
      return { success: false, msg: `${test.name} not available at this stage.` };
    if (this.state.completedTests.some(t => t.testId === testId) ||
        this.state.pendingResults.some(t => t.testId === testId))
      return { success: false, msg: `${test.name} already ordered.` };

    const willOverspend = (this.state.cost + test.cost) > this.state.budget;
    this.state.cost += test.cost;
    this.state.pendingResults.push({ testId, readyAt: this.state.time + test.time });

    const over = willOverspend ? ' ⚠️ Over budget.' : '';
    this.addLog('action', `🔬 Ordered: <strong>${test.name}</strong> · Results in ${this._fmtDur(test.time)} · 🪙 ${test.cost}${over}`);
    this.emit('stateChanged', this.state);
    return { success: true, willOverspend };
  }

  // ── General management ────────────────────────────────────────────────────
  applyGeneralManagement(mgmtId) {
    if (this.ended) return { success: false, msg: 'Case has ended.' };
    const mgmt = this.case.managementOptions.general?.find(m => m.id === mgmtId);
    if (!mgmt) return { success: false, msg: 'Option not found.' };
    if (!mgmt.repeatable && this.state.givenManagement.some(g => g.id === mgmtId))
      return { success: false, msg: `${mgmt.name} already administered.` };

    const eff = mgmt.stageEffect?.[this.state.stage] || {};
    const willOverspend = (this.state.cost + mgmt.cost) > this.state.budget;
    this.state.cost += mgmt.cost;
    this.state.givenManagement.push({ id: mgmtId, name: mgmt.name, time: this.state.time, category: 'general' });

    if (eff.vitalEffect) this._applyVitals(eff.vitalEffect);
    if (eff.penalty) { this.state.penalty += eff.penalty; this.addLog('warning', `⚠️ Suboptimal: ${eff.note || 'penalty applied.'}`); }

    const over = willOverspend ? ' ⚠️ Over budget.' : '';
    this.addLog('action', `💉 <strong>${mgmt.name}</strong> · 🪙 ${mgmt.cost}${over}${eff.note ? ' — ' + eff.note : ''}`);
    this.emit('stateChanged', this.state);
    return { success: true };
  }

  // ── Disease-specific management ───────────────────────────────────────────
  applyDiseaseManagement(mgmtId, diagId) {
    if (this.ended) return { success: false, msg: 'Case has ended.' };
    const opts = this.case.managementOptions.diseaseSpecific?.[diagId];
    if (!opts) return { success: false, msg: 'No options for this diagnosis.' };
    const mgmt = opts.find(m => m.id === mgmtId);
    if (!mgmt) return { success: false, msg: 'Option not found.' };
    if (this.state.givenManagement.some(g => g.id === mgmtId))
      return { success: false, msg: `${mgmt.name} already administered.` };

    const eff = mgmt.stageEffect?.[this.state.stage] || {};
    if (eff.blocked) return { success: false, msg: eff.note || 'Not applicable at this stage.' };

    const willOverspend = (this.state.cost + mgmt.cost) > this.state.budget;
    this.state.cost += mgmt.cost;
    this.state.givenManagement.push({ id: mgmtId, name: mgmt.name, time: this.state.time, category: 'disease' });

    if (eff.vitalEffect)      this._applyVitals(eff.vitalEffect);
    if (eff.delayProgression) this.progressionDelayBonus += eff.delayProgression;
    if (eff.penalty) {
      this.state.penalty += eff.penalty;
      this.addLog(mgmt.type === 'blunder' ? 'danger' : 'warning',
        `${mgmt.type === 'blunder' ? '🚨 BLUNDER' : '⚠️ Wrong treatment'}: ${eff.note || ''}`);
    }

    const over = willOverspend ? ' ⚠️ Over budget.' : '';
    this.addLog('action', `💊 <strong>${mgmt.name}</strong> · 🪙 ${mgmt.cost}${over}${eff.note ? ' — ' + eff.note : ''}`);

    if (eff.cure) { this._cure(mgmt, eff); return { success: true }; }
    if (eff.endGame) {
      this.state.outcome = eff.outcome || 'transfer';
      this.ended = true; this.stop();
      setTimeout(() => this.emit('gameOver', { reason: eff.outcome, state: this.state }), 400);
      return { success: true };
    }
    this.emit('stateChanged', this.state);
    return { success: true };
  }

  _cure(mgmt, eff) {
    this.state.cured = true; this.state.outcome = 'cured';
    this.ended = true; this.stop();
    this.addLog('success', `✅ <strong>${mgmt.fullName || mgmt.name}</strong> — ${eff.note}`);
    this.emit('cured', { state: this.state, mgmt });
  }

  // ── Diagnosis ─────────────────────────────────────────────────────────────
  setDiagnosis(diagId) {
    const opt = this.case.diagnosisOptions.find(d => d.id === diagId);
    if (!opt) return { success: false };
    this.state.selectedDiagnosis = diagId;
    this.state.diagnosisCorrect  = opt.correct;
    this.state.diagnosisHistory.push({ diagnosis: diagId, time: this.state.time });
    this.addLog('info', `🩺 Working diagnosis: <strong>${opt.label}</strong>`);
    this.emit('diagnosisChanged', { diagId, correct: opt.correct, label: opt.label });
    return { success: true, correct: opt.correct, label: opt.label };
  }

  // ── Resign ────────────────────────────────────────────────────────────────
  resignCase() {
    this.state.outcome = 'transfer';
    this.state.penalty += 10;
    this.ended = true; this.stop();
    this.addLog('warning', '🚑 Patient transferred to higher centre.');
    this.emit('gameOver', { reason: 'transfer', state: this.state });
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  calculateScore() {
    const r = this.case.scoringRubric;
    let score = 0;
    const breakdown = [];

    // Diagnosis
    const dScore = this.state.diagnosisCorrect ? r.correctDiagnosis : 0;
    score += dScore;
    breakdown.push({ label: 'Correct Diagnosis', max: r.correctDiagnosis, earned: dScore });

    // Timely cure
    let cScore = 0;
    if (this.state.cured) {
      const keys = Object.keys(this.case.stages);
      const idx  = keys.indexOf(this.state.stage);
      const frac = Math.max(0, 1 - idx / (keys.length - 1));
      cScore = Math.round(r.timelyCure * (0.4 + 0.6 * frac));
    }
    score += cScore;
    breakdown.push({ label: 'Timely Cure', max: r.timelyCure, earned: cScore });

    // Cost efficiency
    const spent = this.state.cost, budget = this.state.budget;
    let costScore = 0;
    if (spent <= budget) {
      const p = spent / budget;
      costScore = p <= 0.5 ? r.costEfficiency : p <= 0.7 ? Math.round(r.costEfficiency * 0.85)
        : p <= 0.9 ? Math.round(r.costEfficiency * 0.55) : Math.round(r.costEfficiency * 0.2);
    } else {
      const overPct = (spent - budget) / budget;
      const pen = Math.min(25, Math.round(overPct * 25));
      this.state.penalty += pen;
      breakdown.push({ label: 'Budget Overspend Penalty', max: 0, earned: -pen });
    }
    score += costScore;
    breakdown.push({ label: 'Cost Efficiency', max: r.costEfficiency, earned: costScore });

    // Tests
    const usefulIds  = this.case.tests.filter(t => t.type === 'useful').map(t => t.id);
    const dummyIds   = this.case.tests.filter(t => t.type === 'dummy').map(t => t.id);
    const orderedIdsSet = new Set(this.state.completedTests.map(t => t.testId));
    const gotUseful  = usefulIds.filter(id => orderedIdsSet.has(id)).length;
    const gotDummy   = dummyIds.filter(id => orderedIdsSet.has(id)).length;
    const tScore     = Math.round((gotUseful / Math.max(usefulIds.length, 1)) * r.correctTests);
    score += tScore;
    breakdown.push({ label: 'Relevant Investigations', max: r.correctTests, earned: tScore });
    if (gotDummy > 0) {
      const dp = gotDummy * 2;
      this.state.penalty += dp;
      breakdown.push({ label: `Unnecessary Tests (×${gotDummy})`, max: 0, earned: -dp });
    }

    // Management
    const correctMgmt = this.case.correctManagement || [];
    const givenIds    = this.state.givenManagement.map(g => g.id);
    const gotMgmt     = correctMgmt.filter(id => givenIds.includes(id)).length;
    const mScore      = Math.round((gotMgmt / Math.max(correctMgmt.length, 1)) * r.correctManagement);
    score += mScore;
    breakdown.push({ label: 'Correct Management', max: r.correctManagement, earned: mScore });

    // Penalties
    const penTotal = this.state.penalty * Math.abs(r.penaltyPerPoint);
    score -= penTotal;
    if (this.state.penalty > 0)
      breakdown.push({ label: `Penalties (×${this.state.penalty})`, max: 0, earned: -penTotal });

    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'F';
    const msg   = score >= 90 ? this.case.endMessages.perfect
      : score >= 70 ? this.case.endMessages.good
      : score >= 50 ? this.case.endMessages.average
      : this.case.endMessages.poor;

    const mistakes = this._buildMistakes(correctMgmt, givenIds, dummyIds);
    return { score, grade, msg, breakdown, mistakes,
      time: this.state.time, stage: this.state.stage,
      cost: spent, budget,
      cured: this.state.cured, outcome: this.state.outcome,
      penalty: this.state.penalty,
      diagnosisCorrect: this.state.diagnosisCorrect,
      selectedDiagnosis: this.state.selectedDiagnosis,
      correctDiagnosis: this.case.correctDiagnosis
    };
  }

  _buildMistakes(correctMgmt, givenIds, dummyIds) {
    const mistakes = [];
    correctMgmt.forEach(id => {
      if (!givenIds.includes(id)) {
        const n = this._mgmtName(id);
        if (n) mistakes.push({ type: 'missed', label: `Missed: ${n}` });
      }
    });
    this.state.givenManagement.forEach(g => {
      const m = this._findMgmt(g.id);
      if (m && (m.type === 'wrong' || m.type === 'blunder'))
        mistakes.push({ type: m.type, label: `${m.type === 'blunder' ? '🚨 Blunder' : '❌ Wrong'}: ${g.name}` });
    });
    this.state.completedTests.forEach(t => {
      if (dummyIds.includes(t.testId)) {
        const td = this.case.tests.find(x => x.id === t.testId);
        if (td) mistakes.push({ type: 'unnecessary', label: `Unnecessary test: ${td.name}` });
      }
    });
    return mistakes;
  }

  _findMgmt(id) {
    const g = this.case.managementOptions.general?.find(m => m.id === id);
    if (g) return g;
    for (const arr of Object.values(this.case.managementOptions.diseaseSpecific || {})) {
      const f = arr.find(m => m.id === id);
      if (f) return f;
    }
    return null;
  }
  _mgmtName(id) { return this._findMgmt(id)?.name || null; }

  // ── Vitals helper ─────────────────────────────────────────────────────────
  _applyVitals(eff) {
    Object.entries(eff).forEach(([k, v]) => {
      if (typeof v === 'string' && (v[0] === '+' || v[0] === '-')) {
        const n = parseFloat(v);
        if (k === 'bp') {
          const [s, d] = this.state.vitals.bp.split('/').map(Number);
          this.state.vitals.bp = `${Math.max(50, s + n)}/${Math.max(30, d + Math.round(n * 0.6))}`;
        } else {
          this.state.vitals[k] = Math.round(((this.state.vitals[k] || 0) + n) * 10) / 10;
        }
      } else {
        this.state.vitals[k] = v;
      }
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  addLog(type, msg) {
    const e = { type, msg, time: this.state.time, timeLabel: this._formatTime(this.state.time) };
    this.log.push(e);
    this.emit('log', e);
  }

  _formatTime(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2,'0')}h ${String(mm).padStart(2,'0')}m`;
  }
  _fmtDur(h) { return h < 1 ? `${Math.round(h * 60)} min` : `${h}h`; }

  getState()             { return this.state; }
  getCurrentStage()      { return this.case.stages[this.state.stage] || {}; }
  getCurrentStageLabel() { return this.getCurrentStage().label || this.state.stage; }
  getCurrentStageColor() { return this.getCurrentStage().color || 'yellow'; }
  isOverBudget()         { return this.state.cost > this.state.budget; }
}