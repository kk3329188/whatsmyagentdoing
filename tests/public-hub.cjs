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
const { createServer, publicView } = require('../src/server');
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
  const out = publicView(snap(), 'salt');
  const body = JSON.stringify(out);
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
  // A department per project, without its name; worktrees join their repo.
  assert.match(a.project, /^部門 [A-Z]$/);
  assert.equal(c.project, a.project);
  assert.equal(b.title, '秘書');
  assert.equal(a.title, null);
  assert.equal(out.visitors[0].from, '訪客');
  assert.equal(out.weather.kind, 'rain');
});

test('public view: aliases change with the salt (no lookup across restarts)', () => {
  assert.notEqual(publicView(snap(), 's1').sessions[0].id, publicView(snap(), 's2').sessions[0].id);
});

function get(port, pth, { method = 'GET', host = 'abc.trycloudflare.com', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pth, method, headers: { host, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (res.headers['content-type'] === 'text/event-stream') { req.destroy(); resolve({ status: res.statusCode, body }); } });
      res.on('end', () => resolve({ status: res.statusCode, body }));
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
