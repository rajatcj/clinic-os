/**
 * pregameStats.js
 * Shared pre-game modal stats loader.
 * Works on both cases.html and index.html.
 *
 * Usage: call loadPreGameStats(caseId) after injecting the modal HTML.
 * Requires #pregame-stats to exist in the DOM.
 */

/**
 * Wait for window.MedSim to be set by firebase.js (which is type="module" and deferred).
 * Polls every 50ms, gives up after 5 seconds and resolves null.
 */
function _waitForMedSim(timeoutMs = 5000) {
  return new Promise(resolve => {
    if (window.MedSim) { resolve(window.MedSim); return; }
    const start    = Date.now();
    const interval = setInterval(() => {
      if (window.MedSim) {
        clearInterval(interval);
        resolve(window.MedSim);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 50);
  });
}

function _escStats(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _fmtSecsStats(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function loadPreGameStats(caseId) {
  const statsEl = document.getElementById('pregame-stats');
  if (!statsEl) return;

  // Show spinner while we wait for Firebase to initialise
  statsEl.innerHTML = '<div class="pgstat-spinner">Loading stats…</div>';

  const MS = await _waitForMedSim();

  if (!MS) {
    statsEl.innerHTML = '<div class="pgstat-empty">Stats unavailable</div>';
    return;
  }

  try {
    const [caseMeta, leaderboard] = await Promise.all([
      MS.getCaseMeta(caseId).catch(() => null),
      MS.getCaseLeaderboard(caseId, 3).catch(() => [])
    ]);

    const plays  = caseMeta?.totalPlays        ?? 0;
    const unique = caseMeta?.totalUniquePlayers ?? 0;
    const avg    = caseMeta?.averageScore       ? caseMeta.averageScore.toFixed(1) : '—';
    const compl  = caseMeta?.totalCompletions   ?? 0;

    statsEl.innerHTML = `
      <div class="pgstat-grid">
        <div class="pgstat-item">
          <div class="pgstat-val">${plays.toLocaleString()}</div>
          <div class="pgstat-label">Total Plays</div>
        </div>
        <div class="pgstat-item">
          <div class="pgstat-val">${unique.toLocaleString()}</div>
          <div class="pgstat-label">Unique Players</div>
        </div>
        <div class="pgstat-item">
          <div class="pgstat-val">${compl.toLocaleString()}</div>
          <div class="pgstat-label">Completions</div>
        </div>
        <div class="pgstat-item">
          <div class="pgstat-val">${avg}</div>
          <div class="pgstat-label">Avg Score</div>
        </div>
      </div>
      ${leaderboard.length ? `
        <div class="pgstat-lb">
          <div class="pgstat-lb-title">Top Scores</div>
          ${leaderboard.map((e, i) => `
            <div class="pgstat-lb-row">
              <span class="pgstat-rank">#${i + 1}</span>
              <span class="pgstat-user">${_escStats(e.username)}</span>
              <span class="pgstat-score">${e.score}</span>
              <span class="pgstat-time">${_fmtSecsStats(e.timeElapsed)}</span>
            </div>`).join('')}
        </div>
      ` : '<div class="pgstat-empty">No scores yet — be the first!</div>'}
    `;
  } catch (e) {
    statsEl.innerHTML = '<div class="pgstat-empty">Stats unavailable</div>';
  }
}