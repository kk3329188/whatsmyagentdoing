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

// Badges: earned once, kept. `has(rec, today)` decides; rec.k holds counts.
const BADGES = [
  { id: 'first', name: '首日報到', emoji: '🎉', desc: '做完第一輪', has: (r) => r.turns >= 1 },
  { id: 'diligent', name: '今日勤奮', emoji: '💪', desc: '一天做完 10 輪', has: (r, t) => t && t.turns >= 10 },
  { id: 'marathon', name: '馬拉松', emoji: '🏃', desc: '累計 50 輪', has: (r) => r.turns >= 50 },
  { id: 'veteran', name: '百輪老將', emoji: '🎖️', desc: '累計 100 輪', has: (r) => r.turns >= 100 },
  { id: 'tools', name: '工具人', emoji: '🛠️', desc: '累計 500 個動作', has: (r) => r.tools >= 500 },
  { id: 'pusher', name: '推手', emoji: '🚀', desc: '成功推上去 10 次', has: (r) => r.k.push >= 10 },
  { id: 'tester', name: '測試達人', emoji: '🧪', desc: '測試通過 20 次', has: (r) => r.k.test >= 20 },
  { id: 'merger', name: '合併王', emoji: '🔀', desc: '合併 PR 5 次', has: (r) => r.k.merge >= 5 },
  { id: 'flawless', name: '零失誤', emoji: '✨', desc: '連續 30 個動作沒出錯', has: (r) => r.k.streak >= 30 },
  { id: 'owl', name: '夜貓', emoji: '🦉', desc: '晚上 10 點後做完 3 輪', has: (r) => r.k.night >= 3 },
  { id: 'early', name: '早鳥', emoji: '🐦', desc: '早上 8 點前做完一輪', has: (r) => r.k.early >= 1 },
];

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
      // Results that count toward badges: passed tests, pushes, merges; the
      // longest run of tool calls without a failure.
      const prevOut = last && last.obj === s ? last.outAt : (s.outcome ? s.outcome.at : 0);
      this.seen.set(key, { obj: s, ...cur, outAt: s.outcome ? s.outcome.at : 0 });
      if (!rec) { rec = d.sessions[key] = { tools: 0, turns: 0, at: now }; this.dirty = true; }
      const k = rec.k || (rec.k = { push: 0, test: 0, merge: 0, streak: 0, night: 0, early: 0 });
      if (s.outcome && s.outcome.ok && s.outcome.at > prevOut && k[s.outcome.task] != null) { k[s.outcome.task]++; this.dirty = true; }
      if ((s.okStreak || 0) > k.streak) { k.streak = s.okStreak; this.dirty = true; }
      if (add && add.turns && last && last.obj === s) {
        const h = new Date(now).getHours();
        if (h >= 22 || h < 5) k.night += add.turns;
        if (h >= 5 && h < 8) k.early += add.turns;
      }
      if (add && (add.tools || add.turns)) {
        rec.tools += add.tools; rec.turns += add.turns; rec.at = now;
        d.tools += add.tools; d.turns += add.turns;
        if (today) {
          const t = d.today.sessions[key] || (d.today.sessions[key] = { tools: 0, turns: 0 });
          t.tools += add.tools; t.turns += add.turns;
        }
        this.dirty = true;
      }
      this.award(key, rec, d.today.sessions[key], now);
    }
    this.started = true;
  }

  // New badges for one session. The ones earned by history already there
  // when the dashboard starts are given quietly (no announcement).
  award(key, rec, today, now) {
    const got = rec.badges || (rec.badges = {});
    for (const b of BADGES) {
      if (got[b.id] || !b.has(rec, today)) continue;
      got[b.id] = now;
      this.dirty = true;
      if (!this.started) continue;
      const list = this.data.recentBadges || (this.data.recentBadges = []);
      list.push({ key, id: b.id, at: now });
      if (list.length > 50) list.shift();
    }
  }

  // Regulars (3+ finished turns) not seen today but within the last two
  // weeks: they are on leave. `live` are the keys showing right now.
  // `titleOf(key)` names the ones we never saw a title for (and returns
  // null for closed work, which is not on leave).
  onLeave(live, now = Date.now(), titleOf = () => undefined) {
    const out = [];
    for (const [key, r] of Object.entries(this.data.sessions)) {
      if (live.has(key) || (r.turns || 0) < 3) continue;
      const away = now - (r.at || 0);
      if (away < 86_400_000 || away > 14 * 86_400_000) continue;
      const known = titleOf(key);
      if (known === null) continue;
      const title = r.title || known;
      if (!title) continue;
      out.push({ key, title, since: r.at, days: Math.floor(away / 86_400_000) });
    }
    return out.sort((a, b) => b.since - a.since).slice(0, 8);
  }

  badges(key) {
    const got = (this.data.sessions[key] && this.data.sessions[key].badges) || {};
    return BADGES.filter((b) => got[b.id]).map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, at: got[b.id] }));
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
      // Remember the name for when they are away (the "on leave" sign).
      const life = d.sessions[s.key];
      if (life && s.title && life.title !== s.title) { life.title = String(s.title).slice(0, 80); this.dirty = true; }
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
      // Every badge, who holds it, and the ones just earned.
      badges: BADGES.map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, desc: b.desc,
        holders: Object.entries(this.data.sessions).filter(([, r]) => r.badges && r.badges[b.id]).map(([key, r]) => ({ key, at: r.badges[b.id] })) })),
      recentBadges: (this.data.recentBadges || []).filter((x) => Date.now() - x.at < 86_400_000),
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

module.exports = { Progress, levelOf, LEVELS, BADGES };
