'use strict';

// Visitors: someone from outside (say, a colleague messaging your team's chat
// bot) walks into the office and comes to the secretary's desk. Two ways in:
//
// - Folders named in ~/.whatsmyagentdoing/config.json as "visitorDirs" (or the
//   WMAD_VISITOR_DIRS environment variable, separated like PATH). Each holds
//   one conversation per sub-folder (its request.json) or per .json file:
//   { id, userName|from, messages: [{ ts, text, user, userName }] } or
//   { id, from, text, at }. A conversation whose newest message changed is a
//   visit; ids containing "-OUT-" (conversations you started) and the users
//   in "visitorIgnoreUsers" (your own bot) are left out.
// - POST /api/visit { from, text, topic } with the header
//   x-whatsmyagentdoing: visit, for anything else that wants to knock.
//
// Only visits from after the dashboard started count; nothing is replayed.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = process.env.WMAD_CONFIG || path.join(os.homedir(), '.whatsmyagentdoing', 'config.json');
const RECENT_MS = 10 * 60_000;
const SCAN_MS = 5000;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch { return {}; }
}

// Chat markup out: mentions, links, extra space.
function clean(t) {
  return String(t || '').replace(/<@[A-Z0-9]+>/g, '').replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<https?:[^>]+>/g, '🔗')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

// One conversation file -> { id, from, text, topic, at } for its newest message, or null.
function visitOf(j, fallbackId, mtime, ignore) {
  if (!j || typeof j !== 'object') return null;
  const id = String(j.id || fallbackId);
  if (/-OUT-/.test(id) || j.outbound) return null;
  const msgs = Array.isArray(j.messages) ? j.messages : null;
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
  if (last && last.user && ignore.has(last.user)) return null;
  const from = (last && last.userName) || j.userName || j.from || null;
  if (!from) return null;
  const at = last && last.ts ? Number(last.ts) * 1000 : Number(j.at) || (j.lastMsgTs ? Number(j.lastMsgTs) * 1000 : mtime);
  return { id, from: String(from).slice(0, 30), text: clean(last ? last.text : j.text), topic: j.role || j.topic || null, at };
}

class Visitors {
  constructor({ dirs = null, ignore = null } = {}) {
    const cfg = readConfig();
    const env = process.env.WMAD_VISITOR_DIRS;
    this.dirs = dirs || (env ? env.split(path.delimiter).filter(Boolean) : Array.isArray(cfg.visitorDirs) ? cfg.visitorDirs : []);
    this.ignore = new Set(ignore || cfg.visitorIgnoreUsers || []);
    this.seen = new Map(); // conversation id -> time of its newest message we know of
    this.files = new Map(); // file -> mtime
    this.list = [];
    this.first = true;
    this.lastScan = 0;
  }

  scan(now = Date.now()) {
    if (now - this.lastScan < SCAN_MS || !this.dirs.length) return;
    this.lastScan = now;
    for (const dir of this.dirs) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const file = e.isDirectory() ? path.join(dir, e.name, 'request.json') : e.name.endsWith('.json') ? path.join(dir, e.name) : null;
        if (!file) continue;
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (this.files.get(file) === st.mtimeMs) continue;
        this.files.set(file, st.mtimeMs);
        let v = null;
        try { v = visitOf(JSON.parse(fs.readFileSync(file, 'utf8')), e.name.replace(/\.json$/, ''), st.mtimeMs, this.ignore); } catch { continue; }
        if (!v) continue;
        const known = this.seen.get(v.id);
        this.seen.set(v.id, v.at);
        if (this.first || known === v.at || (known && v.at < known)) continue;
        if (now - v.at > RECENT_MS) continue;
        this.push(v);
      }
    }
    this.first = false;
  }

  push(v) {
    this.list.push({ ...v, id: `${v.id}@${v.at}` });
    if (this.list.length > 30) this.list.shift();
  }

  // A visit announced over HTTP.
  add({ from, text, topic } = {}, now = Date.now()) {
    if (!from) return false;
    this.push({ id: `api-${now}`, from: String(from).slice(0, 30), text: clean(text), topic: topic ? String(topic).slice(0, 20) : null, at: now });
    return true;
  }

  recent(now = Date.now()) {
    return this.list.filter((v) => now - v.at < RECENT_MS);
  }
}

module.exports = { Visitors, visitOf, clean };
