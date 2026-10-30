'use strict';

const crypto = require('crypto');
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
  '/ambient.js': ['ambient.js', 'text/javascript; charset=utf-8'],
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

// The desktop app's title for a session that is not showing any more; null
// when it was archived (finished work, not someone on leave).
function leaveTitle(key) {
  if (!key.startsWith('claude:')) return undefined;
  const m = desktop.get(key.slice(7));
  if (!m) return undefined;
  return m.archived ? null : m.title || undefined;
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
  return { now, lang: opts.demo ? null : promptLanguage(raw), privacy: !!(opts.privacy || opts.demo), office: opts.demo ? null : { ...progress.office(), onLeave: progress.onLeave(new Set(sessions.map((s) => s.key)), now, leaveTitle).map((x) => (opts.privacy ? { ...x, title: '員工' } : x)) }, sessions, visitors: visits, weather: opts.demo ? null : weather.tick(now) };
}

// Public mode (--public): what a stranger with the link may see. Built from a
// whitelist, so a field added to view() later stays home until listed here.
// Ids become salted aliases (stable while this process runs); each person is
// "unit・nickname", the unit guessed from what the title looks like and the
// nickname drawn at random; every other bit of text is dropped.
const WORK_KIND = [[/^(Bash|Shell):/, 'Bash:'], [/^(Edit|Write|MultiEdit|NotebookEdit|Editing)\b/, 'Edit'], [/^Subagent:/, 'Subagent:'],
  [/slack|send_message|SendMessage|relay/i, 'SendMessage'], [/update_plan|wrap_up|progress|TodoWrite|Updating todo/, 'TodoWrite']];
// First match wins; your own rules ("publicUnits" in the config) go first.
const UNITS = [
  [/秘書|總機|secretary|reception/i, '總機室'],
  [/排查|除錯|修正|修復|錯誤|亂碼|重啟|bug|debug|fix|crash|\blog\b/i, '維修部'],
  [/部署|上線|串接|deploy|release|infra|redis|kafka|docker|k8s|jenkins/i, '工程部'],
  [/進測|測試|回歸|驗證|QA\b|test|verify/i, '品管部'],
  [/數據|分析|預測|流失|統計|data|analytics|metric/i, '數據部'],
  [/數值|數學|規格|體驗|企劃|spec|balance/i, '企劃部'],
  [/可視化|畫面|介面|前端|設計|\bUI\b|frontend|design/i, '設計部'],
  [/簡報|文件|通知|進度|報告|docs?\b|slides|meeting/i, '行政部'],
  [/覆盤|檢討|評估|機制|架構|記憶|放權|規劃|策略|retro|plan|review/i, '策略室'],
];
const NICKS = ['豆豆', '小芋', '阿凱', '小橘', '阿布', '米糕', '小葵', '阿傑', '湯圓', '小滿', '阿哲', '麻糬', '小柚', '阿寶', '布丁', '小安',
  '阿德', '芝麻', '小晴', '阿樂', '饅頭', '小蘋', '阿宏', '奶茶', '小夏', '阿誠', '可樂', '小玉', '阿文', '雪球', '小鹿', '阿泰', '花生', '小雲',
  '阿翔', '栗子', '小琪', '阿豪', '黑糖', '小星', '阿峰', '蛋捲', '小禾', '阿達', '仙草', '小莓', '阿賢', '銅鑼燒'];
const nicks = new Map(); // `${salt}|${id}` -> nickname, kept while the process runs
function nicknameOf(salt, id, alias) {
  const k = `${salt}|${id}`;
  if (nicks.has(k)) return nicks.get(k);
  const used = new Set([...nicks].filter(([x]) => x.startsWith(`${salt}|`)).map(([, v]) => v));
  const start = parseInt(alias.slice(0, 8), 16) % NICKS.length;
  let n = null;
  for (let i = 0; i < NICKS.length && !n; i++) if (!used.has(NICKS[(start + i) % NICKS.length])) n = NICKS[(start + i) % NICKS.length];
  n = n || `${NICKS[start]}${used.size}`;
  nicks.set(k, n);
  return n;
}
const asRule = (m) => { try { return new RegExp(m, 'i'); } catch { return { test: (t) => t.toLowerCase().includes(String(m).toLowerCase()) }; } };
// What a person is doing, as the page shows it over their head, made safe to
// show anyone with the link: your home folder as ~, no tokens, passwords,
// keys, emails or URL queries, and short.
function safeText(v, max = 60) {
  let t = String(v || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/\/(?:Users|home)\/[^/\s]+/g, '~');
  t = t.replace(/\b(ghp|gho|ghu|ghs|github_pat|xox[abprs]|sk|pk|rk|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, '***');
  t = t.replace(/\b(bearer|basic)\s+[^\s'"]+/gi, '$1 ***');
  t = t.replace(/\b(token|key|secret|password|passwd|pwd|auth|authorization|cookie|session)(["']?\s*[=:]\s*["']?)[^\s'"&]+/gi, '$1$2***');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***');
  t = t.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1');
  t = t.replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '***');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function publicView(snap, salt, { units = [], company = '' } = {}) {
  const alias = (id) => (id == null ? null : crypto.createHmac('sha256', salt).update(String(id)).digest('hex').slice(0, 10));
  const key = (k) => { const i = String(k).indexOf(':'); return `${String(k).slice(0, i)}:${alias(String(k).slice(i + 1))}`; };
  const rules = [...(Array.isArray(units) ? units : []).filter((u) => u && u.match && u.unit).map((u) => [asRule(u.match), String(u.unit).slice(0, 8)]), ...UNITS];
  const unitOf = (s) => { const t = String(s.title || ''); return (t && (rules.find(([re]) => re.test(t)) || [])[1]) || '研發部'; };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const word = (v) => (typeof v === 'string' && /^[a-z]{1,12}$/.test(v) ? v : null);
  const kind = (a) => (a ? (WORK_KIND.find(([re]) => re.test(a)) || [null, 'Read'])[1] : null);
  const kinds = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => word(k) && Number.isFinite(v)));
  const badge = (b) => ({ id: word(b.id) || String(b.id).slice(0, 20), name: b.name, emoji: b.emoji, at: num(b.at) });
  const raw = snap.sessions || [];
  const byId = new Map(raw.map((s) => [s.id, s]));
  const who = (s) => ({ unit: unitOf(s), nick: nicknameOf(salt, s.id, alias(s.id)) });
  const sessions = raw.map((s) => {
    const parent = s.subagent && byId.get(s.parentId);
    const me = who(parent || s);
    return {
      key: key(s.key), agent: s.agent, id: alias(s.id), parentId: alias(s.parentId), subagent: !!s.subagent,
      cwd: `/${me.unit}`, project: me.unit, title: s.subagent ? `${me.nick}的助手` : `${me.unit}・${me.nick}`,
      status: s.status, activity: kind(s.activity), task: word(s.task),
      outcome: s.outcome ? { at: num(s.outcome.at), task: word(s.outcome.task), ok: !!s.outcome.ok } : null,
      kinds: kinds(s.kinds), stuck: s.stuck ? true : null, ask: s.ask ? true : null, needs: s.needs ? true : null,
      lastEventAt: num(s.lastEventAt), startedAt: num(s.startedAt), turnStartedAt: num(s.turnStartedAt),
      level: num(s.level), xp: num(s.xp), next: num(s.next), badges: (s.badges || []).map(badge),
      talk: (s.talk || []).map((t) => ({ key: key(t.key), dir: t.dir === 'in' ? 'in' : 'out', at: num(t.at), text: null })),
      recent: [], controllable: false, pending: 0,
      // Clicking someone on the public view shows this (public/hub.js peek):
      // what your own page shows over their head.
      detail: s.subagent ? null : publicDetail(s),
    };
  });
  function publicDetail(s) {
    const plan = Array.isArray(s.plan) ? s.plan : null;
    const cur = plan && plan.find((x) => x.status === 'in_progress');
    const st = plan && plan.length ? { done: plan.filter((x) => x.status === 'completed').length, total: plan.length, step: safeText(cur && cur.content, 50) }
      : s.progress ? { done: num(s.progress.done), total: num(s.progress.total), step: safeText(s.progress.step, 50) } : null;
    return { title: safeText(s.title, 40), doing: safeText(s.activity, 60), steps: st };
  }
  const o = snap.office;
  const t = (o && o.today) || {};
  const office = o && {
    turns: num(o.turns), tools: num(o.tools),
    badges: (o.badges || []).map((b) => ({ ...badge(b), desc: b.desc, holders: (b.holders || []).map((h) => ({ key: key(h.key), at: num(h.at) })) })),
    recentBadges: (o.recentBadges || []).map((x) => ({ key: key(x.key), id: x.id, at: num(x.at) })),
    today: {
      date: t.date, turns: num(t.turns), tools: num(t.tools), answered: num(t.answered), avgWaitMs: num(t.avgWaitMs),
      top: (t.top || []).map((r) => ({ key: key(r.key), turns: num(r.turns), tools: num(r.tools) })),
      longest: (t.longest || []).map((w) => ({ key: key(w.key), ms: num(w.ms) })),
      spans: Object.fromEntries(Object.entries(t.spans || {}).map(([k, v]) => [key(k), { title: null, s: v.s || [] }])),
    },
    onLeave: (o.onLeave || []).map((x) => ({ key: key(x.key), title: '員工', since: num(x.since), days: num(x.days) })),
  };
  const w = snap.weather;
  return {
    now: snap.now, lang: snap.lang, privacy: true, public: true, company: String(company || '').slice(0, 24), sessions, office,
    visitors: (snap.visitors || []).map((v) => ({ kind: v.kind === 'reply' ? 'reply' : 'visit', id: alias(v.id), conv: alias(v.conv), from: '訪客', text: null, topic: null, at: num(v.at) })),
    weather: w ? { code: num(w.code), temp: num(w.temp), day: !!w.day, kind: w.kind, emoji: w.emoji, at: num(w.at) } : null,
  };
}

// The office as your page runs it (public/office.js worldState), made safe
// for strangers: ids become the same aliases as in publicView, any field that
// may hold words (names, bubbles, meeting lines) is dropped or replaced by a
// stock line, and the only strings left are short ASCII tokens (colours,
// states, plan references) that match none of your projects or folders.
const WORLD_DROP = new Set(['s', 'text', 'say', 'title', 'label', 'name', 'from', 'topic', 'conv', 'lines', 'lineOf', 'note', 'notes', 'msg',
  'message', 'prompt', 'reply', 'question', 'words', 'line', 'caption', 'who', 'what', 'cwd', 'project', 'branch', 'activity', 'error', 'recap']);
const WORLD_SAY = { work: '開工！', done: '做完了 ✓', error: '出錯了…', wait: '有事問你！', level: '升等！⭐', held: '…' };
// Same hours as the office (public/office.js closing): 19:00 to 07:00.
const closedHours = (now = Date.now()) => { const h = new Date(now).getHours(); return h >= 19 || h < 7; };
function publicWorld(world, salt, privateWords = [], now = Date.now()) {
  const alias = (id) => crypto.createHmac('sha256', salt).update(String(id)).digest('hex').slice(0, 10);
  const words = [...new Set(privateWords.map((w) => String(w || '').toLowerCase()).filter((w) => w.length >= 3))];
  const str = (v) => {
    const m = v.match(/^(claude|codex|gemini|visitor):(.+)$/);
    if (m) return `${m[1]}:${alias(m[2])}`;
    if (!/^[A-Za-z0-9#._-]{1,24}$/.test(v)) return undefined;
    const low = v.toLowerCase();
    return words.some((w) => low.includes(w)) ? undefined : v;
  };
  const walk = (v, d) => {
    if (d > 9) return undefined;
    if (v == null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return str(v);
    if (Array.isArray(v)) return v.slice(0, 400).map((x) => { const e = walk(x, d + 1); return e === undefined ? null : e; });
    if (typeof v !== 'object') return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (WORLD_DROP.has(k) || !/^[A-Za-z0-9_$]{1,32}$/.test(k)) continue;
      if (k === 'event' && x && typeof x === 'object') {
        const zone = typeof x.zone === 'string' && WORLD_SAY[x.zone] ? x.zone : 'held';
        out.event = { at: Number.isFinite(x.at) ? x.at : 0, zone, text: WORLD_SAY[zone], ...(Number.isFinite(x.ttl) ? { ttl: x.ttl } : {}) };
        continue;
      }
      const e = walk(x, d + 1);
      if (e !== undefined) out[k] = e;
    }
    return out;
  };
  const floors = {};
  for (const f of ['1', '2']) if (world && world.floors && world.floors[f]) floors[f] = walk(world.floors[f], 0);
  // After hours by this machine's clock (the same as your page's) when your
  // page did not say (an older page still open): the lights still go down.
  for (const f of Object.values(floors)) if (typeof f.closedNow !== 'boolean') f.closedNow = closedHours(now);
  return { at: world && world.at, floors };
}
// Words a public world must never carry: your projects' and folders' names.
function privateWordsOf(snap) {
  const out = new Set();
  for (const s of (snap && snap.sessions) || []) {
    for (const part of String(s.cwd || '').split('/')) if (part.length >= 3) out.add(part);
    if (s.project) out.add(s.project);
    if (s.branch) out.add(s.branch);
  }
  return [...out];
}

// Paths a public server answers; everything else (every POST included) is 404.
const PUBLIC_OK = (p) => !!STATIC[p] || p.startsWith('/assets/') || p.startsWith('/scenes/') || p === '/api/scenes' || p === '/api/ping' || p === '/events' || p === '/api/state' || p === '/api/world';
const PUBLIC_MAX_VIEWERS = 50;

// A WebSocket, by hand (RFC 6455, just what a viewer needs): the handshake,
// text frames out, and reading close / ping from the browser.
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return false;
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return true;
}
function wsFrame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len])
    : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}
function wsSend(socket, text) { if (!socket.destroyed) socket.write(wsFrame(1, Buffer.from(text))); }
// Frames from the browser (masked): answer pings, close on close.
function wsRead(socket, onClose) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 1 << 20) { socket.destroy(); return; }
    while (buf.length >= 2) {
      const op = buf[0] & 15, masked = buf[1] & 128;
      let len = buf[1] & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const need = at + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      const mask = masked ? buf.subarray(at, at + 4) : null;
      const data = Buffer.from(buf.subarray(at + (masked ? 4 : 0), need));
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(need);
      if (op === 8) { try { socket.end(wsFrame(8, Buffer.alloc(0))); } catch {} onClose(); return; }
      if (op === 9) socket.write(wsFrame(10, data));
    }
  });
  socket.on('close', onClose);
  socket.on('error', onClose);
}

// The public server fetches your page's office from the main one.
function fetchHostWorld(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/world', timeout: 1500, headers: { 'x-whatsmyagentdoing': 'world' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4 * 1024 * 1024) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function createServer(watcher, opts, { onShutdown, onRestart } = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const shape = opts.public ? (s) => publicView(s, salt, { units: opts.publicUnits, company: opts.publicCompany }) : (s) => s;
  // The public whitelist needs the real titles to pick each unit; it drops
  // them itself, so the snapshot under it is the full one.
  const snapOpts = opts.public ? { ...opts, privacy: false } : opts;
  let polled = null; // { at, body, tag }: the last state handed to pollers
  let worldCache = null; // public: { at, w: { body, tag } | null }
  let privateWords = null; // public: { at, list }
  let world = null; // your page's office: { at, host, data }
  let worldPulled = 0; // when a public view last asked for it
  const clients = new Set();
  let last = '';

  const push = (force) => {
    let body;
    try { body = JSON.stringify(shape(snapshot(watcher, snapOpts))); } catch (e) { console.error('snapshot failed:', e.message); return; }
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
  // A public server is a second reader: the main one keeps the books.
  if (!opts.demo && !opts.public) setInterval(() => progress.save(), 10000).unref();

  const server = http.createServer((req, res) => {
    // Refuse anything not addressed to loopback (blocks DNS-rebinding pages
    // from reading your prompts through this server).
    // A public server sits behind a tunnel, so any host goes; it only
    // answers reads, and the stream needs the key from the link.
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!opts.public && !['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (opts.public) {
      if (req.method !== 'GET' || !PUBLIC_OK(url.pathname)) { res.writeHead(404).end(); return; }
      if (url.pathname === '/events' || url.pathname === '/api/state' || url.pathname === '/api/world') {
        const k = Buffer.from(url.searchParams.get('k') || '');
        const want = Buffer.from(String(opts.publicKey || ''));
        if (!want.length || k.length !== want.length || !crypto.timingSafeEqual(k, want)) { res.writeHead(403).end(); return; }
        if (url.pathname === '/events' && clients.size >= PUBLIC_MAX_VIEWERS) { res.writeHead(503).end(); return; }
      }
      // The office as your own page runs it, filtered (see publicWorld).
      if (url.pathname === '/api/world') {
        const send = (w) => {
          if (!w) { res.writeHead(204, { 'cache-control': 'no-store' }).end(); return; }
          if (req.headers['if-none-match'] === w.tag) { res.writeHead(304, { etag: w.tag, 'cache-control': 'no-store', 'x-now': String(Date.now()) }).end(); return; }
          res.writeHead(200, { 'content-type': 'application/json', etag: w.tag, 'cache-control': 'no-store', 'x-now': String(Date.now()) });
          res.end(w.body);
        };
        if (worldCache && Date.now() - worldCache.at < 400) { send(worldCache.w); return; }
        fetchHostWorld(opts.mainPort || 4545).then((raw) => {
          if (!privateWords || Date.now() - privateWords.at > 60_000) privateWords = { at: Date.now(), list: privateWordsOf(snapshot(watcher, snapOpts)) };
          let w = null;
          if (raw) {
            const body = JSON.stringify(publicWorld(raw, salt, privateWords.list));
            w = { body, tag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
          }
          worldCache = { at: Date.now(), w };
          send(w);
        });
        return;
      }
      // Polling, for tunnels that hold an event stream back (Cloudflare quick
      // tunnels do): the latest state, shared by every viewer for a second,
      // and 304 when it has not changed.
      if (url.pathname === '/api/state') {
        const now = Date.now();
        if (!polled || now - polled.at > 1000) {
          const body = JSON.stringify(shape(snapshot(watcher, snapOpts)));
          const tag = `"${crypto.createHash('sha1').update(body.replace(/^\{"now":\d+,/, '{')).digest('hex').slice(0, 16)}"`;
          polled = { at: now, body, tag };
        }
        if (req.headers['if-none-match'] === polled.tag) { res.writeHead(304, { etag: polled.tag, 'cache-control': 'no-store' }).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json', etag: polled.tag, 'cache-control': 'no-store' });
        res.end(polled.body);
        return;
      }
    }
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
    } else if (url.pathname === '/api/world' && req.method === 'POST') {
      // Your page, sending the office as it runs it (public/index.html).
      if (req.headers['x-whatsmyagentdoing'] !== 'world') { res.writeHead(403).end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        const now = Date.now();
        let ok = false;
        try {
          const w = JSON.parse(body);
          // One page at a time is the host: the one you last touched (clicked,
          // typed, scrolled in), else whichever keeps going when the other
          // goes quiet.
          const input = Number(w && w.input) || 0;
          if (w && w.floors && (!world || world.host === w.host || now - world.at > 5000 || input > world.input)) {
            world = { at: now, host: w.host, input: world && world.host === w.host ? Math.max(input, world.input) : input, data: w };
            ok = true;
          }
        } catch {}
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok, wanted: now - worldPulled < 15_000 }));
      });
    } else if (url.pathname === '/api/world' && req.method === 'GET') {
      // The public view's server (another process on this machine) asking.
      if (req.headers['x-whatsmyagentdoing'] !== 'world') { res.writeHead(403).end(); return; }
      worldPulled = Date.now();
      if (!world || Date.now() - world.at > 10_000) { res.writeHead(204).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(world.data));
    } else if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ app: 'whatsmyagentdoing' }));
    } else if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        // no-transform: a proxy in between (a tunnel) must not gzip and hold
        // the stream until a buffer fills.
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(shape(snapshot(watcher, snapOpts)))}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404).end();
    }
  });
  // Public view, live: a WebSocket per viewer. Your page's office is fetched
  // from the main server every 300 ms and pushed when it changed; the
  // sessions every 2 s. Each message carries this machine's clock, so a
  // viewer on another computer can set its own against it.
  if (opts.public) {
    const viewers = new Set();
    let lastWorld = '', lastState = '', worldBusy = false;
    const pushAll = (text) => { for (const v of viewers) wsSend(v, text); };
    const pushWorld = async () => {
      if (!viewers.size || worldBusy) return;
      worldBusy = true;
      try {
        const raw = await fetchHostWorld(opts.mainPort || 4545);
        if (!privateWords || Date.now() - privateWords.at > 60_000) privateWords = { at: Date.now(), list: privateWordsOf(snapshot(watcher, snapOpts)) };
        const body = raw ? JSON.stringify(publicWorld(raw, salt, privateWords.list)) : '';
        if (body && body !== lastWorld) { lastWorld = body; pushAll(`{"t":"world","now":${Date.now()},"world":${body}}`); }
      } finally { worldBusy = false; }
    };
    const pushState = (force) => {
      if (!viewers.size) return;
      const body = JSON.stringify(shape(snapshot(watcher, snapOpts)));
      const sig = body.replace(/^\{"now":\d+,/, '{');
      if (!force && sig === lastState) return;
      lastState = sig;
      pushAll(`{"t":"state","now":${Date.now()},"data":${body}}`);
    };
    setInterval(pushWorld, 300).unref();
    setInterval(() => pushState(false), 2000).unref();
    setInterval(() => { for (const v of viewers) if (!v.destroyed) v.write(wsFrame(9, Buffer.alloc(0))); }, 25_000).unref();
    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url, 'http://localhost');
      const k = Buffer.from(url.searchParams.get('k') || '');
      const want = Buffer.from(String(opts.publicKey || ''));
      const keyOk = want.length && k.length === want.length && crypto.timingSafeEqual(k, want);
      if (url.pathname !== '/ws' || !keyOk || viewers.size >= PUBLIC_MAX_VIEWERS || !wsAccept(req, socket)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      socket.setNoDelay(true);
      viewers.add(socket);
      wsRead(socket, () => viewers.delete(socket));
      // Straight away: the sessions, and the office if we have it.
      wsSend(socket, `{"t":"state","now":${Date.now()},"data":${JSON.stringify(shape(snapshot(watcher, snapOpts)))}}`);
      if (lastWorld) wsSend(socket, `{"t":"world","now":${Date.now()},"world":${lastWorld}}`);
    });
  }
  return server;
}

module.exports = { createServer, snapshot, latestSegments, publicView, publicWorld, safeText };
