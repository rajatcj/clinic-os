class CaseLoader {
  constructor() { this.index = []; this.cache = {}; }

  async loadIndex(url = './data/caseIndex.json') {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.index = await r.json();
      return this.index;
    } catch(e) { console.error('loadIndex:', e); return []; }
  }

  async loadCase(id) {
    if (this.cache[id]) return this.cache[id];
    try {
      const r = await fetch(`./data/cases/${id}.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.cache[id] = await r.json();
      return this.cache[id];
    } catch(e) { console.error(`loadCase(${id}):`, e); return null; }
  }
}