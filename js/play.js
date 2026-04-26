
const loader = new CaseLoader();

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

function getCaseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

async function init() {


  const caseId = getCaseId()
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

init();