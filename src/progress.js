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
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Waiting on you: a question, or a finished turn that left you a decision.
const waiting = (s) => s.status === 'waiting' || (s.status === 'done' && !!s.ask);
const WAITS_MAX = 200;
const TRACK_ZONE = (s) => (['thinking', 'tool', 'typing'].includes(s.status) ? 'w'
  : s.status === 'waiting' || (s.status === 'done' && (s.ask || s.needs)) ? 'q'
    : s.status === 'error' ? 'e' : s.status === 'done' || s.status === 'interrupted' ? 'd' : 'i');

function levelOf(xp) {
  let lv = 1;
  while (lv < LEVELS.length && xp >= LEVELS[lv]) lv++;
  return { level: lv, xp, next: LEVELS[lv] ?? null };
}

class Progress {
  constructor(file = FILE) {
    this.file = file;
    this.seen = new Map(); // key -> { obj, tools, turns } as last counted this run
    this.waitSince = new Map(); // key -> when it started waiting on you
    this.dirty = false;
    this.data = { turns: 0, tools: 0, sessions: {} };
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && typeof d.sessions === 'object') this.data = { turns: +d.turns || 0, tools: +d.tools || 0, sessions: d.sessions, today: d.today || null };
    } catch { /* first run */ }
  }

  update(sessions, now = Date.now()) {
    const d = this.data;
    // Today's tally (for the end-of-day report) starts over at midnight.
    const day = dayOf(now);
    if (!d.today || d.today.date !== day) { d.today = { date: day, sessions: {}, waits: [] }; this.dirty = true; }
    for (const s of sessions) {
      if (s.subagent) continue;
      const key = `${s.agent}:${s.id}`;
      const cur = { tools: s.tools || 0, turns: s.turns || 0 };
      const last = this.seen.get(key);
      let rec = d.sessions[key];
      let add = null;
      // Today only counts what happened today: deltas, or all of a session that started today.
      let today = false;
      if (!last || last.obj !== s) { add = rec ? null : cur; today = (s.startedAt || 0) >= midnight(now); }
      else { add = { tools: Math.max(0, cur.tools - last.tools), turns: Math.max(0, cur.turns - last.turns) }; today = true; }
      // How long you took to answer it.
      const since = this.waitSince.get(key);
      if (waiting(s) && since == null) this.waitSince.set(key, s.lastEventAt || now);
      else if (!waiting(s) && since != null) {
        this.waitSince.delete(key);
        const end = s.turnStartedAt && s.turnStartedAt > since ? s.turnStartedAt : now;
        if (last && last.obj === s && end - since > 5000 && end >= midnight(now)) {
          d.today.waits.push({ key, ms: end - since });
          if (d.today.waits.length > WAITS_MAX) d.today.waits.shift();
          this.dirty = true;
        }
      }
      this.seen.set(key, { obj: s, ...cur });
      if (!rec) { rec = d.sessions[key] = { tools: 0, turns: 0, at: now }; this.dirty = true; }
      if (add && (add.tools || add.turns)) {
        rec.tools += add.tools; rec.turns += add.turns; rec.at = now;
        d.tools += add.tools; d.turns += add.turns;
        if (today) {
          const t = d.today.sessions[key] || (d.today.sessions[key] = { tools: 0, turns: 0 });
          t.tools += add.tools; t.turns += add.turns;
        }
        this.dirty = true;
      }
    }
  }

  level(key) { return levelOf(xpOf(this.data.sessions[key])); }

  // Today's story for the replay: for each session, when it changed between
  // working (w), waiting on you (q), error (e), done (d) and idle (i).
  // `views` are the sessions as the page sees them.
  track(views, now = Date.now()) {
    const d = this.data;
    if (!d.today || d.today.date !== dayOf(now)) return;
    const spans = d.today.spans || (d.today.spans = {});
    for (const s of views) {
      if (s.subagent || s.archived) continue;
      const z = TRACK_ZONE(s);
      const rec = spans[s.key] || (spans[s.key] = { title: null, s: [] });
      if (s.title && rec.title !== s.title) { rec.title = String(s.title).slice(0, 80); this.dirty = true; }
      const last = rec.s[rec.s.length - 1];
      if (last && last[1] === z) continue;
      // First sight of one that started today: it has been working since then.
      if (!last && s.startedAt && s.startedAt >= midnight(now) && s.startedAt < now - 60_000) rec.s.push([s.startedAt, 'w']);
      if (rec.s.length && rec.s[rec.s.length - 1][1] === z) continue;
      rec.s.push([now, z]);
      if (rec.s.length > 400) rec.s.splice(0, rec.s.length - 400);
      this.dirty = true;
    }
  }

  // What the page shows: lifetime totals and a summary of today.
  office() {
    const t = this.data.today || { date: null, sessions: {}, waits: [] };
    const rows = Object.entries(t.sessions).map(([key, v]) => ({ key, ...v }));
    const waits = t.waits;
    return {
      turns: this.data.turns,
      tools: this.data.tools,
      today: {
        date: t.date,
        turns: rows.reduce((a, r) => a + r.turns, 0),
        tools: rows.reduce((a, r) => a + r.tools, 0),
        top: rows.sort((a, b) => b.turns - a.turns || b.tools - a.tools).slice(0, 30),
        answered: waits.length,
        avgWaitMs: waits.length ? Math.round(waits.reduce((a, w) => a + w.ms, 0) / waits.length) : 0,
        longest: [...waits].sort((a, b) => b.ms - a.ms).slice(0, 3),
        spans: t.spans || {},
      },
    };
  }

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
