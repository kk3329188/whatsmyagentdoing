// public/hub.js: who your secretary is; what a public view says people are doing.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// hub.js builds its panels at load: any DOM call returns another stub.
function stub() {
  const f = function () {};
  return new Proxy(f, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), set: () => true, construct: () => stub() });
}
function load() {
  const window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const ctx = { window, document: stub(), localStorage: stub(), location: { search: '' }, navigator: stub(), URLSearchParams, Map, Set, Date, Math, JSON, setTimeout, setInterval, clearInterval, clearTimeout, console, store: { get: () => null, set() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/hub.js'), 'utf8'), ctx);
  return window.Hub;
}

const s = (key, title, extra = {}) => ({ key, agent: 'claude', title, ...extra });
const sessions = [
  s('claude:a', '值班 session 重開後的交接筆記'),
  s('claude:b', '2026-10-30 值班'),
  s('claude:c', '2026-10-26 值班'),
  s('claude:d', 'secretary notes'),
];

test('the session you picked is the secretary, not every title that mentions it', () => {
  const pick = load().pickSecretary(sessions, 'claude:b', '值班');
  assert.deepEqual(sessions.filter(pick).map((x) => x.key), ['claude:b']);
});

test('once it is gone, the one named the same but for the date takes over', () => {
  const later = [s('claude:a', '值班 session 重開後的交接筆記'), s('claude:e', '2026-10-31 值班')];
  const pick = load().pickSecretary(later, 'claude:b', '值班');
  assert.deepEqual(later.filter(pick).map((x) => x.key), ['claude:e']);
});

test('none picked: a session titled secretary; cancelled: nobody', () => {
  const Hub = load();
  assert.deepEqual(sessions.filter(Hub.pickSecretary(sessions, null, null)).map((x) => x.key), ['claude:d']);
  assert.deepEqual(sessions.filter(Hub.pickSecretary(sessions, null, '\u0000')), []);
});

test('public view: what they are doing, in plain words, from the kind of work alone', () => {
  const { publicDoing } = load();
  assert.equal(publicDoing({ status: 'tool', task: 'test', activity: 'Bash:' }), '跑測試');
  assert.equal(publicDoing({ status: 'tool', activity: 'Edit' }), '寫程式');
  assert.equal(publicDoing({ status: 'tool', activity: 'Bash:' }), '下指令');
  assert.equal(publicDoing({ status: 'thinking' }), '思考中');
  assert.equal(publicDoing({ status: 'waiting' }), '等老闆回覆');
  assert.equal(publicDoing({ status: 'done', ask: true }), '等老闆決定');
  assert.equal(publicDoing({ status: 'done' }), '剛完成一輪');
  assert.equal(publicDoing({ status: 'idle' }), '休息中');
  assert.equal(publicDoing({ visitor: true }), '來訪');
});
