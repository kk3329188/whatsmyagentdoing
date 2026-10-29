'use strict';

const fs = require('fs');
const http = require('http');
const { guessFromPrompts } = require('./lang');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/office.js': ['office.js', 'text/javascript; charset=utf-8'],
  '/office3d.js': ['office3d.js', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/popout.js': ['popout.js', 'text/javascript; charset=utf-8'],
  '/hub.js': ['hub.js', 'text/javascript; charset=utf-8'],
};
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
// 3D models, served as-is (3D view only).
const MOUNTS = { '/assets/': path.join(__dirname, '..', 'assets') };
const scenes = require('./scenes');
const updater = require('./update');
const hub = require('./hub');
const { Progress } = require('./progress');
const { Visitors } = require('./visitors');
const { Weather } = require('./weather');
const desktop = new hub.DesktopMeta();
const progress = new Progress();
const visitors = new Visitors();
const weather = new Weather();

function serveFile(res, root, rel) {
  const file = path.normalize(path.join(root, rel));
  const type = TYPES[path.extname(file)];
  if (!type || !file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  // no-cache: a reinstalled scene pack or an updated clone must show up on reload
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
const ACTIVE = new Set(['thinking', 'tool', 'typing']);
const TALK_MS = 3 * 60_000;

// Logs only record finished blocks, so a few states need a clock to resolve:
// a reply with no follow-up is a finished turn, and an "active" session that
// has gone silent for a long time was most likely closed mid-turn.
function view(s, now, { privacy }) {
  const meta = s.agent === 'claude' && !s.subagent ? desktop.get(s.id) : null;
  const quiet = now - (s.lastEventAt || s.mtime || now);
  let status = s.status;
  if (status === 'typing' && quiet > 45_000) status = 'done';
  if (status === 'thinking' && quiet > 15 * 60_000) status = 'idle';
  if (status === 'tool' && quiet > 45 * 60_000) status = 'idle';
  if ((status === 'waiting' || status === 'error') && quiet > 2 * 3600_000) status = 'idle';

  const out = {
    key: `${s.agent}:${s.id}`,
    agent: s.agent,
    id: s.id,
    sessionId: s.sessionId || null,
    parentId: s.parentId,
    subagent: s.subagent,
    cwd: s.cwd,
    project: s.cwd ? path.basename(s.cwd) : null,
    title: (meta && meta.title) || s.title,
    model: s.model,
    status,
    activity: status === 'tool' || status === 'waiting' ? s.activity : null,
    task: status === 'tool' ? s.task || null : null,
    outcome: s.outcome && now - s.outcome.at < 5 * 60_000 ? s.outcome : null,
    kinds: s.kinds || {},
    prompt: s.prompt,
    reply: s.reply,
    error: s.error,
    turnStartedAt: s.turnStartedAt,
    lastEventAt: s.lastEventAt || s.mtime,
    startedAt: s.startedAt,
    // hub edition additions
    plan: s.plan,
    progress: s.progress,
    recent: s.recent,
    question: status === 'waiting' ? s.question : null,
    options: status === 'waiting' ? s.options : null,
    choices: status === 'done' && s.ask ? s.choices : null,
    stuck: stuckReason(s, status, quiet),
    ask: status === 'done' ? s.ask : null,
    recap: s.recap,
    ccdId: meta ? meta.ccdId : null,
    branch: meta ? meta.branch : null,
    permission: meta ? meta.permissionMode : null,
    effort: meta ? meta.effort : null,
    git: s.cwd && !s.subagent && s.agent === 'claude' ? hub.gitState(s.cwd) : null,
    needs: meta && status === 'done' ? meta.needs : null,
    summary: meta ? meta.summary : null,
    scheduled: meta ? meta.scheduled : false,
    archived: meta ? meta.archived : false,
    // A desktop or terminal Claude session runs the myoffice-remote plugin, which
    // reads the queued commands.
    controllable: s.agent === 'claude' && !s.subagent,
    pending: s.agent === 'claude' && !s.subagent ? hub.pending(s.id) : 0,
    ack: s.agent === 'claude' && !s.subagent ? hub.lastAck(s.id) : null,
    // Experience points: { level, xp, next } (see src/progress.js).
    ...(s.subagent ? {} : progress.level(`${s.agent}:${s.id}`)),
    badges: s.subagent ? [] : progress.badges(`${s.agent}:${s.id}`),
    // Other sessions it just sent a message to or got one from.
    talk: (s.talk || [])
      .filter((t) => now - t.at < TALK_MS)
      .map((t) => { const m = desktop.byLocal(t.peer); return m && m.cliId ? { key: `claude:${m.cliId}`, dir: t.dir, at: t.at, text: t.text } : null; })
      .filter(Boolean),
  };
  if (privacy) {
    out.prompt = out.reply = out.title = null;
    out.question = out.ask = out.recap = out.needs = out.summary = out.choices = out.options = null;
    out.recent = [];
    out.talk = out.talk.map((t) => ({ ...t, text: null }));
    out.plan = out.plan && out.plan.map((x) => ({ content: '', status: x.status }));
    if (out.progress) out.progress = { ...out.progress, step: '' };
    if (out.activity) out.activity = out.activity.split(/[:\s]/)[0];
  }
  return out;
}

// Signs a session is going in circles: one action for
// too long, the same action over and over, or tools failing in a row.
function stuckReason(s, status, quiet) {
  if (status === 'tool' && quiet > 10 * 60_000) return `同一個動作卡了 ${Math.round(quiet / 60_000)} 分鐘`;
  if (status === 'thinking' && quiet > 8 * 60_000) return `思考了 ${Math.round(quiet / 60_000)} 分鐘沒動靜`;
  if ((status === 'tool' || status === 'thinking') && s.repeat && s.repeat.n >= 4 && /^(Bash|Shell):/.test(s.repeat.text)) return `重複同一件事 ${s.repeat.n} 次：${s.repeat.text}`;
  if ((status === 'tool' || status === 'thinking') && s.errStreak >= 3) return `工具連續出錯 ${s.errStreak} 次`;
  return null;
}

// The language the user writes their prompts in (recent sessions first);
// the page uses it as the default UI language.
function promptLanguage(raw) {
  const recent = raw
    .filter((s) => !s.subagent && s.prompt && !s.prompt.startsWith('/'))
    .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))
    .slice(0, 60)
    .map((s) => s.prompt);
  return guessFromPrompts(recent);
}

// One desktop conversation can leave several logs behind: /clear (and some
// restarts) start a new log under the same desktop session, and the old one
// would otherwise stay on as a second person with the same name, still
// "waiting on you" for a question that is no longer on screen. Keep only the
// current log of each: the one the desktop app points at, else the newest.
// Helpers started from an older log follow the current one.
function latestSegments(raw, current = () => false) {
  const keep = new Map(); // bridge id -> session
  for (const s of raw) {
    if (s.agent !== 'claude' || s.subagent || !s.bridgeId) continue;
    const k = keep.get(s.bridgeId);
    const better = !k || (current(s) !== current(k) ? current(s) : (s.startedAt || 0) > (k.startedAt || 0));
    if (better) keep.set(s.bridgeId, s);
  }
  const moved = new Map(); // dropped id -> kept id
  for (const s of raw) {
    const k = s.bridgeId && !s.subagent && s.agent === 'claude' && keep.get(s.bridgeId);
    if (k && k !== s) moved.set(s.id, k.id);
  }
  return raw.filter((s) => !moved.has(s.id))
    .map((s) => (s.subagent && moved.has(s.parentId) ? { ...s, parentId: moved.get(s.parentId) } : s));
}

function snapshot(watcher, opts) {
  const now = Date.now();
  if (!opts.demo) desktop.refresh(now);
  const raw = watcher.sessions();
  if (!opts.demo) progress.update(raw, now);
  // Archived desktop sessions are closed work: keep them out of the office.
  const sessions = latestSegments(raw, (s) => !!desktop.get(s.id)).map((s) => view(s, now, opts)).filter((s) => !s.archived);
  if (!opts.demo) progress.track(sessions, now);
  if (!opts.demo) visitors.scan(now);
  const visits = opts.demo ? [] : visitors.recent(now).map((v) => (opts.privacy ? { ...v, text: null, from: '訪客' } : v));
  sessions.sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
  return { now, lang: opts.demo ? null : promptLanguage(raw), privacy: !!(opts.privacy || opts.demo), office: opts.demo ? null : progress.office(), sessions, visitors: visits, weather: opts.demo ? null : weather.tick(now) };
}

function createServer(watcher, opts, { onShutdown, onRestart } = {}) {
  const clients = new Set();
  let last = '';

  const push = (force) => {
    let body;
    try { body = JSON.stringify(snapshot(watcher, opts)); } catch (e) { console.error('snapshot failed:', e.message); return; }
    // Compare without the timestamp so idle ticks don't spam clients.
    const sig = body.replace(/^\{"now":\d+,/, '{');
    if (!force && sig === last) return;
    last = sig;
    for (const res of clients) res.write(`data: ${body}\n\n`);
  };
  watcher.on('change', () => push(false));
  // Status can flip with no new log lines (see view()), so re-check on a clock.
  setInterval(() => push(false), 5000).unref();
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000).unref();
  if (!opts.demo) setInterval(() => progress.save(), 10000).unref();

  const server = http.createServer((req, res) => {
    // Refuse anything not addressed to loopback (blocks DNS-rebinding pages
    // from reading your prompts through this server).
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
    } else if (Object.keys(MOUNTS).some((m) => url.pathname.startsWith(m))) {
      const m = Object.keys(MOUNTS).find((k) => url.pathname.startsWith(k));
      serveFile(res, MOUNTS[m], decodeURIComponent(url.pathname.slice(m.length)));
    } else if (url.pathname.startsWith('/scenes/')) {
      const rel = decodeURIComponent(url.pathname.slice('/scenes/'.length));
      const [id, ...rest] = rel.split('/');
      const dir = scenes.sceneDir(id);
      if (!dir) res.writeHead(404).end();
      else serveFile(res, dir, rest.join('/'));
    } else if (url.pathname === '/api/scenes') {
      const cat = scenes.catalog();
      const icon = (x) => x.icon || (cat.find((c) => c.id === x.id) || {}).icon || '🗺️';
      const have = scenes.installed().map((x) => ({ ...x, icon: icon(x) }));
      const ids = new Set(have.map((x) => x.id));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        installed: have.map(({ id, name, version, credits, icon }) => ({ id, name, version, credits, icon })),
        available: cat.filter((x) => !ids.has(x.id)).map(({ id, name, version, size, credits, icon }) => ({ id, name, version, size, credits, icon: icon || '🗺️' })),
      }));
    } else if (url.pathname === '/api/scenes/install' && req.method === 'POST') {
      // Same guard as shutdown: a custom header web pages can't send cross-site.
      if (req.headers['x-whatsmyagentdoing'] !== 'install') { res.writeHead(403).end(); return; }
      const id = url.searchParams.get('id') || '';
      scenes.install(id).then(
        (x) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, id: x.id })); },
        (e) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); },
      );
    } else if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot(watcher, opts)));
    } else if (url.pathname === '/api/shutdown' && req.method === 'POST') {
      // Only our CLI sends this header; a web page can't add a custom header
      // to a cross-site request without a CORS preflight, which we never allow.
      if (req.headers['x-whatsmyagentdoing'] !== 'stop' || !onShutdown) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      for (const c of clients) c.end();
      progress.save();
      setTimeout(onShutdown, 50);
    } else if (url.pathname === '/api/version') {
      updater.checkLatest().finally(() => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(updater.info()));
      });
    } else if (url.pathname === '/api/update' && req.method === 'POST') {
      // Same guard as shutdown: web pages can't send this header cross-site.
      if (req.headers['x-whatsmyagentdoing'] !== 'update') { res.writeHead(403).end(); return; }
      updater.update().then(
        (version) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, version }));
          for (const c of clients) c.end();
          if (onRestart) setTimeout(onRestart, 100);
        },
        (e) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); },
      );
    } else if (url.pathname === '/api/visit' && req.method === 'POST') {
      // Someone knocking from outside (a chat bot, a script): display only.
      if (req.headers['x-whatsmyagentdoing'] !== 'visit') { res.writeHead(403).end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 16 * 1024) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try { ok = visitors.add(JSON.parse(body || '{}')); } catch {}
        res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok }));
        if (ok) push(true);
      });
    } else if (url.pathname === '/api/hub/verify' && req.method === 'POST') {
      // The myoffice-remote plugin asks whether a queued command really came from
      // a Touch ID approval here (see src/hub.js).
      if (req.headers['x-whatsmyagentdoing'] !== 'verify') { res.writeHead(403).end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try { ok = hub.verify(JSON.parse(body || '{}')); } catch {}
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      });
    } else if (url.pathname.startsWith('/api/hub/') && req.method === 'POST') {
      // Same guard as shutdown: web pages can't send this header cross-site.
      if (req.headers['x-whatsmyagentdoing'] !== 'hub' || opts.privacy || opts.demo) { res.writeHead(403).end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', async () => {
        const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        try {
          const { key, text } = JSON.parse(body || '{}');
          const s = watcher.sessions().find((x) => `${x.agent}:${x.id}` === key);
          if (!s || s.agent !== 'claude' || s.subagent) return reply(404, { ok: false, error: 'no such session' });
          const action = url.pathname.slice('/api/hub/'.length);
          if (action === 'open') {
            const meta = desktop.get(s.id);
            if (!meta) return reply(400, { ok: false, error: 'not a desktop app session' });
            await hub.openInApp(meta.ccdId);
            return reply(200, { ok: true });
          }
          if (action === 'say' || action === 'stop') {
            if (action === 'say' && !String(text || '').trim()) return reply(400, { ok: false, error: 'empty message' });
            // One Touch ID unlocks this browser for 8 hours (an HttpOnly
            // cookie only the browser holds); a process calling the API
            // without it still triggers Touch ID, which you would refuse.
            if (!hub.unlocked(req.headers.cookie)) {
              const gate = await hub.humanGate('myoffice：允許這個瀏覽器 8 小時內傳話／中斷 session');
              if (!gate.ok) return reply(403, { ok: false, error: gate.error });
              res.setHeader('set-cookie', hub.unlockCookie());
            }
            return reply(200, { ok: true, id: hub.queue(s.id, action, text) });
          }
          reply(404, { ok: false, error: 'unknown action' });
        } catch (e) {
          reply(400, { ok: false, error: String(e.message || e) });
        }
      });
    } else if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ app: 'whatsmyagentdoing' }));
    } else if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot(watcher, opts))}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404).end();
    }
  });
  return server;
}

module.exports = { createServer, snapshot, latestSegments };
