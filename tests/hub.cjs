// Hub edition: remote-control queue, one-time tokens, Touch ID gate.
// Isolated dirs only; the gate is a stub script, never the real Touch ID.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-hub-'));
process.env.WMAD_REMOTE_DIR = path.join(root, 'inbox');
process.env.WMAD_DESKTOP_META_DIR = path.join(root, 'meta');
const hub = require('../src/hub');
const ID = '11111111-2222-4333-8444-555555555555';
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function inbox() {
  const dir = path.join(root, 'inbox', ID);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

test('queued command carries a token the server accepts exactly once', () => {
  hub.queue(ID, 'say', '  看一下進度  ');
  const [cmd] = inbox().slice(-1);
  assert.equal(cmd.text, '看一下進度');
  assert.match(cmd.token, /^[0-9a-f]{32}$/);
  assert.equal(hub.verify({ token: cmd.token, session: ID, kind: 'say', text: '看一下進度' }), true);
  assert.equal(hub.verify({ token: cmd.token, session: ID, kind: 'say', text: '看一下進度' }), false, 'replay');
});

test('a token does not transfer to another session, kind or text', () => {
  hub.queue(ID, 'say', '原本的話');
  const { token } = inbox().slice(-1)[0];
  assert.equal(hub.verify({ token, session: '99999999-2222-4333-8444-555555555555', kind: 'say', text: '原本的話' }), false);
  assert.equal(hub.verify({ token, session: ID, kind: 'stop' }), false);
  assert.equal(hub.verify({ token, session: ID, kind: 'say', text: '改過的話' }), false);
  assert.equal(hub.verify({ token: 'made-up', session: ID, kind: 'say', text: '原本的話' }), false);
  assert.equal(hub.verify({ token, session: ID, kind: 'say', text: '原本的話' }), true, 'still valid for the real thing');
});

test('tokens expire after 10 minutes', () => {
  hub.queue(ID, 'stop');
  const { token } = inbox().slice(-1)[0];
  assert.equal(hub.verify({ token, session: ID, kind: 'stop' }, Date.now() + 11 * 60_000), false);
});

test('bad input is refused before anything is written', () => {
  assert.throws(() => hub.queue('../etc', 'say', 'x'), /bad session id/);
  assert.throws(() => hub.queue(ID, 'rm', 'x'), /bad command/);
  assert.throws(() => hub.queue(ID, 'say', '   '), /empty/);
  assert.throws(() => hub.queue(ID, 'say', 'x'.repeat(4001)), /longer/);
});

test('pending counts waiting commands and sweeps ones nobody picked up', () => {
  const dir = path.join(root, 'inbox', ID);
  const before = hub.pending(ID);
  fs.writeFileSync(path.join(dir, `${Date.now() - 11 * 60_000}-deadbeef.json`), '{}');
  assert.equal(hub.pending(ID), before);
  assert.equal(fs.readdirSync(dir).some((f) => f.includes('deadbeef')), false);
});

test('Touch ID gate: only GATE_OK passes', async () => {
  const stub = (out) => {
    const f = path.join(root, `gate-${out}.sh`);
    fs.writeFileSync(f, `#!/bin/sh\necho ${out}\n`, { mode: 0o755 });
    return f;
  };
  // humanGate runs `/usr/bin/swift <gate> …`; point it at a stub through a fresh module copy.
  for (const [out, ok] of [['GATE_OK', true], ['GATE_DENIED', false], ['GATE_TIMEOUT', false]]) {
    delete require.cache[require.resolve('../src/hub')];
    process.env.WMAD_HUMAN_GATE = stub(out);
    const cp = require('node:child_process');
    const real = cp.execFile;
    cp.execFile = (bin, args, o, cb) => real(args[0], args.slice(1), o, cb);
    const h = require('../src/hub');
    try {
      const r = await h.humanGate('test');
      assert.equal(r.ok, ok, out);
    } finally { cp.execFile = real; }
  }
});

test('one unlock cookie is good for 8 hours, and only the one the server issued', () => {
  const h = require('../src/hub');
  const cookie = h.unlockCookie();
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const v = cookie.match(/wmad_unlock=([0-9a-f]+)/)[1];
  assert.equal(h.unlocked(`a=1; wmad_unlock=${v}`), true);
  assert.equal(h.unlocked(`wmad_unlock=${'0'.repeat(48)}`), false);
  assert.equal(h.unlocked(''), false);
  assert.equal(h.unlocked(`wmad_unlock=${v}`, Date.now() + 8 * 3600_000 + 1000), false);
});
