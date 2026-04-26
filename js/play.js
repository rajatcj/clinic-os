/**
 * play.js — Case game page entry point
 * Loads a single case by ?id= param and launches the simulation engine + UI.
 */

const loader = new CaseLoader();

function getCaseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

async function init() {
  const caseId = getCaseId();
  const app    = document.getElementById('app');

  if (!caseId) {
    app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#e84058;text-align:center;padding:20px">
      No case ID specified.<br><a href="/" style="color:#17b288;margin-top:8px;display:block">← Back to Cases</a>
    </div>`;
    return;
  }

  // Show loading state
  app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#243549;letter-spacing:.14em;">
    Retrieving Case Data...
  </div>`;

  const caseData = await loader.loadCase(caseId);
  if (!caseData) {
    app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#e84058;text-align:center;padding:20px">
      Failed to load case: ${caseId}<br><small style="color:#364e65;display:block;margin-top:8px">Check data/cases/${caseId}.json exists.</small>
    </div>`;
    return;
  }

  // Fade out
  app.style.opacity    = '0';
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

init();