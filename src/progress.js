'use strict';

// Experience points for the office game. Every tool call (+1) and finished
// turn (+5) a session makes while the dashboard runs is added to it, and the
// office's lifetime count of finished turns unlocks furniture.
//
// Logs are read from their tail, so a session's own counters are only trusted
// as deltas within one run. A session seen for the first time ever is
// credited what its log shows; one already on record starts from zero again
// after a restart (or when its log is re-read) and only gains what happens next.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = process.env.WMAD_PROGRESS_FILE || path.join(os.homedir(), '.whatsmyagentdoing', 'progress.json');
const LEVELS = [0, 60, 200, 600, 1500]; // XP needed for Lv1..Lv5
const KEEP_MS = 60 * 86400_000;

const xpOf = (r) => (r ? r.tools + r.turns * 5 : 0);

function levelOf(xp) {
  let lv = 1;
  while (lv < LEVELS.length && xp >= LEVELS[lv]) lv++;
  return { level: lv, xp, next: LEVELS[lv] ?? null };
}

class Progress {
  constructor(file = FILE) {
    this.file = file;
    this.seen = new Map(); // key -> { obj, tools, turns } as last counted this run
    this.dirty = false;
    this.data = { turns: 0, tools: 0, sessions: {} };
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && typeof d.sessions === 'object') this.data = { turns: +d.turns || 0, tools: +d.tools || 0, sessions: d.sessions };
    } catch { /* first run */ }
  }

  update(sessions, now = Date.now()) {
    const d = this.data;
    for (const s of sessions) {
      if (s.subagent) continue;
      const key = `${s.agent}:${s.id}`;
      const cur = { tools: s.tools || 0, turns: s.turns || 0 };
      const last = this.seen.get(key);
      let rec = d.sessions[key];
      let add = null;
      if (!last || last.obj !== s) add = rec ? null : cur;
      else add = { tools: Math.max(0, cur.tools - last.tools), turns: Math.max(0, cur.turns - last.turns) };
      this.seen.set(key, { obj: s, ...cur });
      if (!rec) { rec = d.sessions[key] = { tools: 0, turns: 0, at: now }; this.dirty = true; }
      if (add && (add.tools || add.turns)) {
        rec.tools += add.tools; rec.turns += add.turns; rec.at = now;
        d.tools += add.tools; d.turns += add.turns;
        this.dirty = true;
      }
    }
  }

  level(key) { return levelOf(xpOf(this.data.sessions[key])); }

  office() { return { turns: this.data.turns, tools: this.data.tools }; }

  save(now = Date.now()) {
    if (!this.dirty) return;
    this.dirty = false;
    const d = this.data;
    for (const [k, r] of Object.entries(d.sessions)) if (now - (r.at || 0) > KEEP_MS) delete d.sessions[k];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(d));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('progress save failed:', e.message); }
  }
}

module.exports = { Progress, levelOf, LEVELS };
