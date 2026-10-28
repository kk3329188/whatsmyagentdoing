'use strict';

// Hub edition additions (branch `hub`):
//
// 1. Desktop-app awareness. The Claude desktop app keeps one metadata file per
//    Code session (title as shown in its sidebar, its local id for claude://
//    deep links, archived flag, the app's own post-turn summary). Sessions are
//    named and filtered by it, so a character is "流失玩家專案進度統整", not the
//    folder it runs in.
// 2. Remote control. "say" and "stop" commands are queued as files under
//    ~/.cache/session-remote/<cli session id>/; the myoffice-remote plugin
//    (plugin/myoffice-remote) running inside that session picks them up within
//    ~2s, submits the text as your prompt (queued until the session is idle)
//    or stops the running turn. Nothing here talks to the app directly.
//
//    Any local process can write that folder, so a file alone proves nothing
//    (a prompt-injected session could pose as you to a more trusted one).
//    Each command is therefore approved with Touch ID first (gate/human-gate.swift,
//    once per browser for 8 hours), which mints a one-time token held only in
//    this server's memory; the plugin asks POST /api/hub/verify on
//    127.0.0.1:4545 before acting and drops anything the server did not issue.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const META_DIR = process.env.WMAD_DESKTOP_META_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const INBOX = process.env.WMAD_REMOTE_DIR || path.join(os.homedir(), '.cache', 'session-remote');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_ID = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TEXT = 4000;
const STALE_MS = 10 * 60_000;
const GATE = process.env.WMAD_HUMAN_GATE || path.join(__dirname, '..', 'gate', 'human-gate.swift');
const tokens = new Map(); // token -> { cliId, kind, text, exp }

function ls(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

class DesktopMeta {
  constructor() {
    this.files = new Map(); // file -> { mtime, row }
    this.byCli = new Map(); // cli session id -> row
    this.byCcd = new Map(); // desktop local id -> row
    this.lastScan = 0;
  }

  refresh(now = Date.now()) {
    if (now - this.lastScan < 4000) return;
    this.lastScan = now;
    const seen = new Set();
    for (const a of ls(META_DIR)) {
      if (!a.isDirectory()) continue;
      for (const b of ls(path.join(META_DIR, a.name))) {
        if (!b.isDirectory()) continue;
        const dir = path.join(META_DIR, a.name, b.name);
        for (const f of ls(dir)) {
          if (!f.isFile() || !/^local_.*\.json$/.test(f.name)) continue;
          const file = path.join(dir, f.name);
          seen.add(file);
          let st;
          try { st = fs.statSync(file); } catch { continue; }
          const known = this.files.get(file);
          if (known && known.mtime === st.mtimeMs) continue;
          try {
            const m = JSON.parse(fs.readFileSync(file, 'utf8'));
            const summary = m.postTurnSummary && m.postTurnSummaryFor === m.lastAssistantUuid ? m.postTurnSummary : null;
            this.files.set(file, {
              mtime: st.mtimeMs,
              row: {
                ccdId: m.sessionId,
                cliId: m.cliSessionId,
                title: m.title || null,
                archived: !!m.isArchived,
                scheduled: !!m.scheduledTaskId,
                branch: m.branch || null,
                permissionMode: m.permissionMode || null,
                effort: m.effort || null,
                needs: summary && summary.needs_action ? String(summary.needs_action).slice(0, 300) : null,
                summary: summary && summary.status_detail ? String(summary.status_detail).slice(0, 200) : null,
              },
            });
          } catch { /* half-written; next scan */ }
        }
      }
    }
    for (const f of this.files.keys()) if (!seen.has(f)) this.files.delete(f);
    this.byCli = new Map();
    this.byCcd = new Map();
    for (const { row } of this.files.values()) {
      if (row.cliId) this.byCli.set(row.cliId, row);
      if (row.ccdId) this.byCcd.set(row.ccdId, row);
    }
  }

  byLocal(ccdId) {
    return this.byCcd.get(ccdId) || null;
  }

  get(cliId) {
    return this.byCli.get(cliId) || null;
  }
}

function inboxDir(cliId) {
  if (!UUID.test(cliId)) throw new Error('bad session id');
  return path.join(INBOX, cliId);
}

// Commands still waiting for the session to pick them up. Ones nobody took
// in time (session closed, or /clear gave it a new id) are swept away.
function pending(cliId, now = Date.now()) {
  if (!UUID.test(cliId)) return 0;
  const dir = path.join(INBOX, cliId);
  let n = 0;
  for (const f of ls(dir)) {
    if (!f.isFile() || !f.name.endsWith('.json')) continue;
    if (now - Number(f.name.split('-')[0]) > STALE_MS) { try { fs.unlinkSync(path.join(dir, f.name)); } catch {} continue; }
    n++;
  }
  return n;
}

// Browsers unlocked by a Touch ID, in memory only (a restart asks again).
const UNLOCK_MS = 8 * 3600_000;
const unlocks = new Map(); // cookie value -> expiry
function unlockCookie() {
  const v = crypto.randomBytes(24).toString('hex');
  unlocks.set(v, Date.now() + UNLOCK_MS);
  return `wmad_unlock=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${UNLOCK_MS / 1000}`;
}
function unlocked(cookieHeader, now = Date.now()) {
  const m = String(cookieHeader || '').match(/(?:^|;\s*)wmad_unlock=([0-9a-f]{48})/);
  const exp = m && unlocks.get(m[1]);
  if (exp && exp > now) return true;
  if (m) unlocks.delete(m[1]);
  return false;
}

// Branch, uncommitted files and unpushed commits per folder, refreshed in
// the background at most once a minute.
const gitCache = new Map(); // cwd -> { at, state, busy }
function gitState(cwd) {
  let e = gitCache.get(cwd);
  if (!e) { e = { at: 0, state: null, busy: false }; gitCache.set(cwd, e); }
  if (!e.busy && Date.now() - e.at > 60_000) {
    e.busy = true;
    execFile('git', ['-C', cwd, 'status', '--porcelain=v1', '-b'], { timeout: 5000 }, (err, out) => {
      e.busy = false;
      e.at = Date.now();
      if (err) { e.state = null; return; }
      const lines = String(out).split('\n').filter(Boolean);
      const head = lines[0] || '';
      const br = head.match(/^## (?:No commits yet on )?([^.\s]+)/);
      const ahead = head.match(/ahead (\d+)/);
      e.state = { branch: br ? br[1] : null, dirty: lines.length - 1, ahead: ahead ? Number(ahead[1]) : 0, upstream: head.includes('...') };
    });
  }
  return e.state;
}

// Touch ID (or the login password): proof a person at this Mac asked for it.
function humanGate(reason) {
  return new Promise((resolve) => {
    if (!fs.existsSync(GATE)) return resolve({ ok: false, error: `Touch ID 閘門不存在：${GATE}` });
    if (process.platform !== 'darwin') return resolve({ ok: false, error: '送訊息／中斷要 macOS 的 Touch ID 或登入密碼確認，這台不是 Mac' });
    execFile('/usr/bin/swift', [GATE, reason, '45'], { timeout: 90000 }, (err, stdout, stderr) => {
      const last = String(stdout || '').trim().split('\n').pop() || '';
      if (last === 'GATE_OK') return resolve({ ok: true });
      if (!last && /xcode-select|developer tools|xcrun|No such file/i.test(String(stderr || '') + String(err && err.message || ''))) {
        return resolve({ ok: false, error: 'Touch ID 確認要用到 Swift：先在終端機執行 xcode-select --install 裝好 Command Line Tools 再試' });
      }
      resolve({ ok: false, error: last.startsWith('GATE_') ? `Touch ID 沒通過（${last}）` : `Touch ID 失敗：${String(err && err.message || last).slice(0, 160)}` });
    });
  });
}

// Checked by the mod before it acts; each token works once.
function verify({ token, session, kind, text }, now = Date.now()) {
  for (const [k, v] of tokens) if (v.exp < now) tokens.delete(k);
  const t = tokens.get(String(token || ''));
  if (!t || t.cliId !== session || t.kind !== kind || (kind === 'say' && t.text !== String(text || '').trim())) return false;
  tokens.delete(String(token));
  return true;
}

// The newest result the session wrote back for a command (see the mod).
function lastAck(cliId) {
  if (!UUID.test(cliId)) return null;
  const dir = path.join(INBOX, 'acks', cliId);
  const names = ls(dir).filter((f) => f.isFile() && f.name.endsWith('.json')).map((f) => f.name).sort();
  if (!names.length) return null;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(dir, names[names.length - 1]), 'utf8'));
    return { kind: a.kind, outcome: String(a.outcome || ''), at: Number(a.at) || 0 };
  } catch { return null; }
}

function queue(cliId, kind, text) {
  if (!['say', 'stop'].includes(kind)) throw new Error('bad command');
  const body = { kind, at: Date.now() };
  if (kind === 'say') {
    body.text = String(text || '').trim();
    if (!body.text) throw new Error('empty message');
    if (body.text.length > MAX_TEXT) throw new Error(`message longer than ${MAX_TEXT} characters`);
  }
  const dir = inboxDir(cliId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  body.token = crypto.randomBytes(16).toString('hex');
  tokens.set(body.token, { cliId, kind, text: body.text, exp: Date.now() + STALE_MS });
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const tmp = path.join(dir, `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, `${id}.json`));
  return id;
}

// Brings the session up in the desktop app.
function openInApp(ccdId) {
  return new Promise((resolve, reject) => {
    if (!LOCAL_ID.test(ccdId)) return reject(new Error('not a desktop session'));
    execFile('open', [`claude://claude.ai/epitaxy/${ccdId}`], { timeout: 10000 }, (err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { DesktopMeta, queue, pending, lastAck, openInApp, humanGate, verify, unlockCookie, unlocked, gitState, INBOX };
