// Public mode (--public): a read-only live view for anyone with the link.
// Only a whitelist of fields leaves the machine, the stream needs the key,
// and nothing can be changed through it.
const assert = require('node:assert/strict');
const test = require('node:test');
process.env.WMAD_NO_WEATHER = '1'; // no network in tests
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-public-'));
process.env.WMAD_REMOTE_DIR = path.join(root, 'inbox');
process.env.WMAD_DESKTOP_META_DIR = path.join(root, 'meta');
process.env.WMAD_PROGRESS_FILE = path.join(root, 'progress.json');
const { createServer, publicView, publicWorld, safeText } = require('../src/server');
const { EventEmitter } = require('node:events');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const SECRET = ['/Users/someone/work/acme-billing', 'acme-billing', 'feature/ACME-123-refund', 'Fix refund rounding', 'rm -rf build', 'secret prompt', 'npm test -- billing'];

function snap() {
  return {
    now: 1, lang: 'zh', privacy: false,
    sessions: [
      { key: 'claude:aaaa', agent: 'claude', id: 'aaaa', sessionId: 'sid', parentId: null, subagent: false, cwd: SECRET[0], project: SECRET[1],
        title: SECRET[3], model: 'claude-x', status: 'tool', activity: `Bash: ${SECRET[4]}`, task: 'test', outcome: { at: 5, task: 'test', ok: false, text: SECRET[6] },
        kinds: { test: 3, 'bad key!': 1 }, prompt: SECRET[5], reply: 'r', error: 'e', branch: SECRET[2], git: { dirty: 3 }, plan: [{ content: 'x', status: 'pending' }],
        stuck: 'loop: same command', ask: 'decide?', needs: 'approve', level: 3, xp: 40, next: 80, badges: [{ id: 'b1', name: 'Bug hunter', emoji: '🐛', at: 2 }],
        talk: [{ key: 'claude:bbbb', dir: 'out', at: 3, text: 'hi there' }], lastEventAt: 9, startedAt: 1, turnStartedAt: 8, controllable: true },
      { key: 'claude:bbbb', agent: 'claude', id: 'bbbb', parentId: null, subagent: false, cwd: '/Users/someone/.claude/worktrees/x', project: 'x',
        title: '總機 secretary', status: 'idle', activity: 'Edit: /Users/someone/x.js', lastEventAt: 7 },
      { key: 'claude:cccc', agent: 'claude', id: 'cccc', parentId: 'aaaa', subagent: true, cwd: SECRET[0], project: SECRET[1], status: 'tool', activity: 'Read: secret.txt' },
    ],
    visitors: [{ kind: 'visit', id: 'conv@1', conv: 'conv', from: 'Alice', text: 'please look', topic: 'billing', at: 4 }],
    office: {
      turns: 10, tools: 20,
      badges: [{ id: 'b1', name: 'Bug hunter', emoji: '🐛', desc: 'd', holders: [{ key: 'claude:aaaa', at: 2 }] }],
      recentBadges: [{ key: 'claude:aaaa', id: 'b1', at: 2 }],
      today: { date: 'd', turns: 3, tools: 4, top: [{ key: 'claude:aaaa', turns: 3, tools: 4, title: SECRET[3] }], answered: 1, avgWaitMs: 5,
        longest: [{ key: 'claude:aaaa', ms: 5 }], spans: { 'claude:aaaa': { title: SECRET[3], s: [[1, 'w']] } } },
      onLeave: [{ key: 'claude:dddd', title: SECRET[3], since: 1, days: 2 }],
    },
    weather: { kind: 'rain', emoji: '🌧️', temp: 20 },
  };
}

test('public view: none of the private text leaves, the office still works', () => {
  const out = publicView(snap(), 'salt', { company: 'Acme' });
  // The card a click shows (detail) is checked on its own below.
  const body = JSON.stringify({ ...out, sessions: out.sessions.map(({ detail, ...rest }) => rest) });
  for (const s of [...SECRET, 'aaaa', 'bbbb', 'cccc', 'dddd', 'Alice', 'please look', 'secret.txt', 'hi there', 'someone', 'claude-x']) {
    assert.ok(!body.includes(s), `leaked: ${s}`);
  }
  assert.equal(out.public, true);
  assert.equal(out.privacy, true);
  const [a, b, c] = out.sessions;
  // Same id -> same alias, so subagents still sit with their parent.
  assert.equal(c.parentId, a.id);
  assert.equal(a.talk[0].key, b.key);
  assert.equal(out.office.badges[0].holders[0].key, a.key);
  assert.ok(out.office.today.spans[a.key]);
  // What the office draws from survives in coarse form.
  assert.equal(a.status, 'tool');
  assert.equal(a.activity, 'Bash:');
  assert.equal(b.activity, 'Edit');
  assert.equal(a.task, 'test');
  assert.deepEqual(a.outcome, { at: 5, task: 'test', ok: false });
  assert.deepEqual(a.kinds, { test: 3 });
  assert.equal(a.level, 3);
  assert.equal(a.stuck, true);
  assert.equal(a.ask, true);
  assert.equal(a.controllable, false);
  // A unit from what the work looks like, and a nickname: "維修部・豆豆".
  assert.equal(a.project, '維修部');
  assert.match(a.title, /^維修部・\S+$/);
  assert.equal(c.project, a.project, 'a helper sits with its parent');
  assert.equal(c.title, `${a.title.split('・')[1]}的助手`);
  assert.match(b.title, /^總機室・/, 'the secretary keeps a title the page recognises');
  assert.notEqual(a.title.split('・')[1], b.title.split('・')[1], 'nicknames do not repeat');
  assert.equal(out.company, 'Acme');
  assert.equal(out.visitors[0].from, '訪客');
  assert.equal(out.weather.kind, 'rain');
});

test('public view: nicknames hold still, custom unit rules come first', () => {
  const units = [{ match: 'rounding', unit: '會計部' }];
  const one = publicView(snap(), 'salt-n', { units });
  const two = publicView({ ...snap(), sessions: snap().sessions.slice().reverse() }, 'salt-n', { units });
  assert.equal(one.sessions[0].title.split('・')[0], '會計部');
  assert.equal(two.sessions.find((s) => s.id === one.sessions[0].id).title, one.sessions[0].title);
  // A rule that is not a valid pattern is matched as plain text.
  assert.equal(publicView(snap(), 'salt-m', { units: [{ match: 'Fix (', unit: 'X' }] }).sessions[0].project, '維修部');
  // Untitled work is R&D.
  assert.equal(publicView({ sessions: [{ key: 'claude:z', agent: 'claude', id: 'z', status: 'idle' }] }, 'salt-o').sessions[0].project, '研發部');
});

test('public view: aliases change with the salt (no lookup across restarts)', () => {
  assert.notEqual(publicView(snap(), 's1').sessions[0].id, publicView(snap(), 's2').sessions[0].id);
});

function get(port, pth, { method = 'GET', host = 'abc.trycloudflare.com', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pth, method, headers: { host, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (res.headers['content-type'] === 'text/event-stream') { req.destroy(); resolve({ status: res.statusCode, body }); } });
      res.on('end', () => resolve({ status: res.statusCode, body, etag: res.headers.etag }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

test('public server: any host, key-gated stream, read-only', async () => {
  const watcher = Object.assign(new EventEmitter(), { sessions: () => [] });
  const server = createServer(watcher, { public: true, privacy: true, publicKey: 'k3y' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal((await get(port, '/')).status, 200, 'page loads through the tunnel host');
    assert.equal((await get(port, '/events')).status, 403, 'no key, no stream');
    assert.equal((await get(port, '/events?k=nope')).status, 403);
    assert.equal((await get(port, '/api/sessions?k=k3y')).status, 404, 'only the stream');
    // Polling, for tunnels that hold a stream back: same key, 304 when nothing changed.
    assert.equal((await get(port, '/api/state')).status, 403);
    const st = await get(port, '/api/state?k=k3y');
    assert.equal(st.status, 200);
    assert.match(st.body, /"public":true/);
    assert.ok(st.etag, 'carries an etag');
    assert.equal((await get(port, '/api/state?k=k3y', { headers: { 'if-none-match': st.etag } })).status, 304);
    const ok = await get(port, '/events?k=k3y');
    assert.equal(ok.status, 200);
    assert.match(ok.body, /"public":true/);
    for (const [p, h] of [['/api/shutdown', 'stop'], ['/api/update', 'update'], ['/api/hub/say', 'hub'], ['/api/visit', 'visit'], ['/api/scenes/install?id=x', 'install'], ['/api/hub/verify', 'verify']]) {
      assert.equal((await get(port, p, { method: 'POST', headers: { 'x-whatsmyagentdoing': h } })).status, 404, `${p} refused`);
    }
    assert.equal((await get(port, '/api/version')).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('public server: units come from the real titles (privacy is applied by the whitelist, after)', async () => {
  const now = Date.now();
  const watcher = Object.assign(new EventEmitter(), { sessions: () => [{ agent: 'claude', id: 'unit-1', title: 'fix the crash in billing', status: 'idle', lastEventAt: now, mtime: now, cwd: '/tmp/secret-repo' }] });
  const server = createServer(watcher, { public: true, privacy: true, publicKey: 'k3y', publicCompany: 'Acme' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { body } = await get(server.address().port, '/events?k=k3y');
    assert.match(body, /"title":"維修部・/);
    assert.match(body, /"company":"Acme"/);
    assert.ok(!/secret-repo|unit-1/.test(body), 'folder and id stay home');
    const sess = JSON.parse(body.replace(/^data: /, '').split('\n')[0]).sessions;
    assert.ok(!/billing/.test(JSON.stringify(sess.map(({ detail, ...rest }) => rest))), 'the title only on the card a click shows');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('the normal server still refuses other hosts', async () => {
  const watcher = Object.assign(new EventEmitter(), { sessions: () => [] });
  const server = createServer(watcher, { demo: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await get(server.address().port, '/')).status, 403);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

function world() {
  return {
    host: 'h1', at: 5,
    floors: {
      1: {
        t: 100, n: 6, secKey: 'claude:aaaa',
        people: [
          { key: 'claude:aaaa', x: 1, y: 2, path: [{ x: 3, y: 4 }], mode: 'work', skin: '#f1c8a8', until: { $inf: 1 }, desk: { $ref: 'desks.3' },
            event: { text: '去找 Fix refund rounding', at: 9, zone: 'held' }, meeting: { with: 'claude:bbbb', text: 'secret prompt', seat: { $ref: 'pois.2' } },
            chatWith: { $p: 'claude:bbbb' }, dept: 'acme-billing', note: 'rm -rf build', sk: { agent: 'claude', status: 'tool' } },
        ],
        visitors: [{ key: 'visitor:conv@1', x: 0, y: 0, path: [], text: 'please look', event: { text: '你好，我是Alice', at: 1, zone: 'held' } }],
        standup: { order: ['claude:aaaa'], lines: ['Fix refund rounding'] },
        slot: { spinAt: 50, pos: [1, 2, 3, 4, 5] },
      },
    },
  };
}

test('public world: the office moves, nothing private rides along', () => {
  const w = publicWorld(world(), 'salt', ['/Users/someone/work/acme-billing', 'acme-billing', 'someone']);
  const body = JSON.stringify(w);
  for (const x of [...SECRET, 'aaaa', 'bbbb', 'Alice', 'please look', 'conv@1', 'someone']) assert.ok(!body.includes(x), `leaked: ${x}`);
  const f = w.floors[1];
  const view = publicView(snap(), 'salt');
  assert.equal(f.people[0].key, view.sessions[0].key, 'same alias as the session it belongs to');
  assert.equal(f.secKey, view.sessions[0].key);
  assert.equal(f.people[0].chatWith.$p, view.sessions[1].key);
  assert.equal(f.people[0].meeting.with, view.sessions[1].key);
  assert.equal(f.standup.order[0], view.sessions[0].key);
  assert.equal(f.people[0].event.text, '…', 'a stock line instead of the real bubble');
  assert.deepEqual(f.people[0].desk, { $ref: 'desks.3' });
  assert.deepEqual(f.people[0].until, { $inf: 1 });
  assert.equal(f.people[0].skin, '#f1c8a8');
  assert.equal(f.people[0].dept, undefined, 'a project name is dropped wherever it turns up');
  assert.match(f.visitors[0].key, /^visitor:[0-9a-f]{10}$/);
  assert.deepEqual(f.standup.lines, undefined);
  assert.equal(f.slot.spinAt, 50);
});

test('public world: your page -> main server -> public server -> viewer', async () => {
  const watcher = Object.assign(new EventEmitter(), { sessions: () => [] });
  const main = createServer(watcher, { demo: true });
  await new Promise((r) => main.listen(0, '127.0.0.1', r));
  const mainPort = main.address().port;
  const pub = createServer(watcher, { public: true, privacy: true, publicKey: 'k3y', mainPort });
  await new Promise((r) => pub.listen(0, '127.0.0.1', r));
  const port = pub.address().port;
  const post = (body, header = 'world') => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: mainPort, path: '/api/world', method: 'POST', headers: { 'x-whatsmyagentdoing': header, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.end(JSON.stringify(body));
  });
  try {
    assert.equal((await get(port, '/api/world?k=k3y')).status, 204, 'no host page yet: viewers run their own');
    assert.equal((await post(world(), 'nope')).status, 403);
    const first = JSON.parse((await post(world())).body);
    assert.equal(first.ok, true);
    assert.equal(first.wanted, true, 'a viewer asked a moment ago');
    // Another page cannot take over while the host is alive and nobody touched it…
    assert.equal(JSON.parse((await post({ ...world(), host: 'h2' })).body).ok, false);
    // …unless you are using that one now: the page you last touched is shown.
    assert.equal(JSON.parse((await post({ ...world(), host: 'h2', input: Date.now() })).body).ok, true);
    assert.equal(JSON.parse((await post({ ...world(), host: 'h1' })).body).ok, false, 'the old one, untouched, does not take it back');
    assert.equal(JSON.parse((await post({ ...world(), host: 'h1', input: Date.now() + 5 })).body).ok, true, 'until you go back to it');
    await new Promise((r) => setTimeout(r, 450));
    assert.equal((await get(port, '/api/world')).status, 403);
    const got = await get(port, '/api/world?k=k3y');
    assert.equal(got.status, 200);
    assert.ok(!/Alice|secret prompt|aaaa/.test(got.body));
    assert.match(got.body, /"desks\.3"/);
    assert.equal((await get(port, '/api/world?k=k3y', { headers: { 'if-none-match': got.etag } })).status, 304);
    // The main server only hands it to a caller on this machine with the header.
    assert.equal((await get(mainPort, '/api/world', { host: '127.0.0.1' })).status, 403);
  } finally {
    for (const s of [main, pub]) { s.closeAllConnections(); s.close(); }
  }
});

test('public view, live: a WebSocket with the key gets the sessions and the office, pushed', async () => {
  const watcher = Object.assign(new EventEmitter(), { sessions: () => [] });
  const main = createServer(watcher, { demo: true });
  await new Promise((r) => main.listen(0, '127.0.0.1', r));
  const mainPort = main.address().port;
  const pub = createServer(watcher, { public: true, privacy: true, publicKey: 'k3y', mainPort });
  await new Promise((r) => pub.listen(0, '127.0.0.1', r));
  const port = pub.address().port;
  const send = (body) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: mainPort, path: '/api/world', method: 'POST', headers: { 'x-whatsmyagentdoing': 'world' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.end(JSON.stringify(body));
  });
  const open = (k) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?k=${k}`);
    const got = [];
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, got, ok: true });
    ws.onerror = () => resolve({ ws, got, ok: false });
  });
  try {
    assert.equal((await open('nope')).ok, false, 'no key, no socket');
    const v = await open('k3y');
    assert.equal(v.ok, true);
    await send(world());
    const t0 = Date.now();
    while (!v.got.some((m) => m.t === 'world') && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50));
    const st = v.got.find((m) => m.t === 'state');
    const w = v.got.find((m) => m.t === 'world');
    assert.ok(st && st.data.public, 'sessions first');
    assert.ok(w, 'the office pushed within a moment');
    assert.ok(Math.abs(w.now - Date.now()) < 5000, "with this machine's clock");
    assert.ok(!/Alice|secret prompt|aaaa/.test(JSON.stringify(w)), 'filtered like the polled one');
    // Nothing changed: nothing more is sent.
    const n = v.got.filter((m) => m.t === 'world').length;
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(v.got.filter((m) => m.t === 'world').length, n);
    v.ws.close();
  } finally {
    for (const s of [main, pub]) { s.closeAllConnections(); s.close(); }
  }
});

test('public view: a click shows what your page shows over their head, made safe', () => {
  const sn = snap();
  sn.sessions[0].activity = 'Bash: curl -H "Authorization: Bearer abcdef123456" https://api.example.com/x?token=zzz && cat /Users/someone/.ssh/config';
  sn.sessions[0].plan = [{ content: 'write tests', status: 'completed' }, { content: 'fix the bug for bob@corp.com', status: 'in_progress' }, { content: 'ship', status: 'pending' }];
  const d = publicView(sn, 'salt').sessions[0].detail;
  assert.equal(d.title, 'Fix refund rounding', 'the real title, as your page shows it');
  assert.match(d.doing, /^Bash: curl/);
  for (const x of ['abcdef123456', 'token=zzz', '/Users/someone', 'bob@corp.com']) assert.ok(!JSON.stringify(d).includes(x), `hidden: ${x}`);
  assert.equal(safeText('cat /Users/someone/.ssh/config'), 'cat ~/.ssh/config', 'your home folder as ~');
  assert.deepEqual({ done: d.steps.done, total: d.steps.total }, { done: 1, total: 3 });
  assert.equal(publicView(sn, 'salt').sessions[2].detail, null, 'helpers: none');
  // A made-up token, put together here so no scanner mistakes this file for a leak.
  const fake = ['gh', 'p_', 'abcdefghijklmnop1234'].join('');
  assert.equal(safeText(`export GITHUB_TOKEN=${fake}`), 'export GITHUB_TOKEN=***');
  assert.equal(safeText(`using ${fake} here`), 'using *** here');
  assert.equal(safeText('fix the thing '.repeat(10)).length, 60, 'short');
});
