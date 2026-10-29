// Hub edition: experience points counted from the logs and kept on disk.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Progress, levelOf } = require('../src/progress');
const { newSession, applyClaude } = require('../src/parsers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-xp-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = () => path.join(dir, `p${n++}.json`);

const ts = (i) => new Date(Date.UTC(2026, 9, 28, 10, 0, i)).toISOString();
const prompt = (i) => ({ type: 'user', timestamp: ts(i), message: { content: 'go' } });
const tool = (i, cmd) => ({ type: 'assistant', timestamp: ts(i), message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: cmd } }] } });
const result = (i) => ({ type: 'user', timestamp: ts(i), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const reply = (i) => ({ type: 'assistant', timestamp: ts(i), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } });
const stopHook = (i) => ({ type: 'system', subtype: 'stop_hook_summary', timestamp: ts(i) });

test('the parser counts tool calls and finished turns once each', () => {
  const s = newSession('claude', 'a');
  for (const d of [prompt(1), tool(2, 'ls'), result(3), tool(4, 'pwd'), result(5), reply(6), stopHook(7), prompt(8), reply(9)]) applyClaude(s, d);
  assert.equal(s.tools, 2);
  assert.equal(s.turns, 2);
});

test('an interrupted turn is not a finished one', () => {
  const s = newSession('claude', 'a');
  for (const d of [prompt(1), tool(2, 'ls'), { type: 'user', timestamp: ts(3), message: { content: '[Request interrupted by user]' } }]) applyClaude(s, d);
  assert.equal(s.turns, 0);
});

test('a new session is credited what its log shows; later work adds on', () => {
  const f = file();
  const pr = new Progress(f);
  const s = { agent: 'claude', id: 'a', tools: 10, turns: 2 };
  pr.update([s]);
  assert.equal(pr.office().turns, 2); assert.equal(pr.office().tools, 10);
  assert.equal(pr.level('claude:a').xp, 20);
  pr.update([s]);
  assert.equal(pr.level('claude:a').xp, 20, 'the same snapshot twice counts once');
  s.tools = 13; s.turns = 3;
  pr.update([s]);
  assert.equal(pr.level('claude:a').xp, 13 + 15);
  assert.equal(pr.office().turns, 3);
});

test('after a restart a known session only gains what happens next', () => {
  const f = file();
  const pr = new Progress(f);
  pr.update([{ agent: 'claude', id: 'a', tools: 50, turns: 4 }]);
  pr.save();
  // Restart: the log tail is read again and shows fewer calls than were counted.
  const again = new Progress(f);
  const s = { agent: 'claude', id: 'a', tools: 20, turns: 1 };
  again.update([s]);
  assert.equal(again.level('claude:a').xp, 70, 'nothing double counted');
  s.tools = 25;
  again.update([s]);
  assert.equal(again.level('claude:a').xp, 75);
  assert.equal(again.office().turns, 4); assert.equal(again.office().tools, 55);
});

test('a log read again from scratch (new session object) is not credited twice', () => {
  const pr = new Progress(file());
  pr.update([{ agent: 'claude', id: 'a', tools: 5, turns: 1 }]);
  pr.update([{ agent: 'claude', id: 'a', tools: 5, turns: 1 }]);
  assert.equal(pr.level('claude:a').xp, 10);
});

test('subagents earn nothing on their own', () => {
  const pr = new Progress(file());
  pr.update([{ agent: 'claude', id: 'k', subagent: true, tools: 99, turns: 9 }]);
  assert.equal(pr.office().turns, 0); assert.equal(pr.office().tools, 0);
});

test('levels', () => {
  assert.deepEqual(levelOf(0), { level: 1, xp: 0, next: 60 });
  assert.deepEqual(levelOf(60), { level: 2, xp: 60, next: 200 });
  assert.deepEqual(levelOf(599), { level: 3, xp: 599, next: 600 });
  assert.deepEqual(levelOf(5000), { level: 5, xp: 5000, next: null });
});

test('a broken file starts over instead of crashing', () => {
  const f = file();
  fs.writeFileSync(f, '{not json');
  const pr = new Progress(f);
  assert.equal(pr.office().turns, 0); assert.equal(pr.office().tools, 0);
});

test('today counts only today\'s work and how long you took to answer', () => {
  const pr = new Progress(file());
  const day = new Date(2026, 9, 28, 15, 0, 0).getTime();
  const old = { agent: 'claude', id: 'old', tools: 40, turns: 6, startedAt: day - 3 * 86400_000 };
  const fresh = { agent: 'claude', id: 'new', tools: 4, turns: 1, startedAt: day - 3600_000 };
  pr.update([old, fresh], day);
  let t = pr.office().today;
  assert.equal(t.turns, 1, 'an older session\'s history is not today\'s work');
  old.turns = 7; old.tools = 42;
  pr.update([old, fresh], day + 1000);
  t = pr.office().today;
  assert.equal(t.turns, 2);
  assert.equal(t.top[0].turns, 1);
  // It asks you something; you answer 4 minutes later.
  Object.assign(old, { status: 'waiting', lastEventAt: day + 2000 });
  pr.update([old, fresh], day + 2000);
  Object.assign(old, { status: 'thinking', turnStartedAt: day + 2000 + 240_000 });
  pr.update([old, fresh], day + 250_000);
  t = pr.office().today;
  assert.equal(t.answered, 1);
  assert.equal(t.avgWaitMs, 240_000);
  assert.equal(t.longest[0].key, 'claude:old');
  // Next day it starts over.
  pr.update([old, fresh], day + 86400_000);
  assert.equal(pr.office().today.turns, 0);
  assert.equal(pr.office().today.answered, 0);
});

test('today\'s story: each change between working, waiting, error, done and idle is kept for the replay', () => {
  const { Progress } = require('../src/progress');
  const p = new Progress(path.join(os.tmpdir(), `wmad-track-${process.pid}-${Date.now()}.json`));
  const t0 = new Date(); t0.setHours(10, 0, 0, 0);
  const T = t0.getTime();
  p.update([], T);
  const v = (status, extra = {}) => ({ key: 'claude:a', agent: 'claude', id: 'a', title: '做報告', status, startedAt: T - 3600_000, ...extra });
  p.track([v('tool')], T);
  p.track([v('tool')], T + 1000);
  p.track([v('waiting')], T + 2000);
  p.track([v('done', { ask: '要推嗎？' })], T + 3000);
  p.track([v('done')], T + 4000);
  p.track([{ ...v('tool'), key: 'claude:sub', subagent: true }], T + 5000);
  const sp = p.office().today.spans;
  assert.equal(sp['claude:a'].title, '做報告');
  assert.equal(sp['claude:a'].s.map((x) => x[1]).join(''), 'wqd', 'working since it started, then waiting (question, then decision), then done');
  assert.equal(sp['claude:a'].s[0][0], T - 3600_000);
  assert.equal(sp['claude:sub'], undefined, 'helpers are not tracked');
});

test('badges: earned from what they do; history already there is given quietly, new ones are announced', () => {
  const p = new Progress(path.join(os.tmpdir(), `wmad-badges-${process.pid}-${Date.now()}.json`));
  const s = newSession('claude', 'b1', 'f');
  s.turns = 60; s.tools = 10; s.startedAt = 0;
  const T = Date.now();
  p.update([s], T);
  const ids = () => p.badges('claude:b1').map((b) => b.id).sort().join();
  assert.equal(ids(), 'first,marathon', 'from its history');
  assert.equal(p.office().recentBadges.length, 0, 'no announcement for history');
  // Ten pushes that went through, one at a time.
  for (let i = 1; i <= 10; i++) { s.outcome = { at: T + i, task: 'push', ok: true }; p.update([s], T + i * 1000); }
  assert.match(ids(), /pusher/);
  const recent = p.office().recentBadges;
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, 'pusher');
  // A failed push does not count; a long run without errors does.
  s.okStreak = 31; p.update([s], T + 20_000);
  assert.match(ids(), /flawless/);
  const wall = p.office().badges.find((b) => b.id === 'pusher');
  assert.equal(wall.holders[0].key, 'claude:b1');
});
