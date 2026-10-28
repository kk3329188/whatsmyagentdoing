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
  assert.deepEqual(pr.office(), { turns: 2, tools: 10 });
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
  assert.deepEqual(again.office(), { turns: 4, tools: 55 });
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
  assert.deepEqual(pr.office(), { turns: 0, tools: 0 });
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
  assert.deepEqual(pr.office(), { turns: 0, tools: 0 });
});
