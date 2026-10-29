// Hub edition additions to the Claude parser: task-list steps, recent
// actions, the question it waits on, and skipping cache keep-alive pings.
const assert = require('node:assert/strict');
const test = require('node:test');
const { newSession, applyClaude } = require('../src/parsers');

const at = (m) => new Date(Date.parse('2026-10-28T10:00:00Z') + m * 60_000).toISOString();
const tool = (m, name, input) => ({ type: 'assistant', timestamp: at(m), message: { content: [{ type: 'tool_use', name, input }] } });
const result = (m) => ({ type: 'user', timestamp: at(m), message: { content: [{ type: 'tool_result' }] } });

test('update_plan items, advance, done/start and wrap-up track the steps', () => {
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, tool(0, 'mcp__ccd_turn__update_plan', { items: [
    { content: '看設定', status: 'in_progress' }, { content: '改程式', status: 'pending' }, { content: '驗證', status: 'pending' }] }));
  applyClaude(s, tool(1, 'mcp__ccd_turn__update_plan', { advance: true }));
  assert.deepEqual(s.plan.map((x) => x.status), ['completed', 'in_progress', 'pending']);
  applyClaude(s, tool(2, 'mcp__ccd_turn__update_plan', { done: [2], start: 3 }));
  assert.deepEqual(s.plan.map((x) => x.status), ['completed', 'completed', 'in_progress']);
  applyClaude(s, tool(3, 'mcp__ccd_turn__wrap_up', { recap: '做完了', ask: '要推嗎？' }));
  assert.deepEqual(s.plan.map((x) => x.status), ['completed', 'completed', 'completed']);
  assert.equal(s.ask, '要推嗎？');
  assert.equal(s.recap, '做完了');
});

test('recent keeps the last actions; AskUserQuestion is the question until answered', () => {
  const s = newSession('claude', 'x', 'f');
  for (let i = 0; i < 15; i++) applyClaude(s, tool(i, 'Read', { file_path: `/a/f${i}.js` }));
  assert.equal(s.recent.length, 12);
  assert.equal(s.recent.at(-1).text, 'Read f14.js');
  applyClaude(s, tool(20, 'AskUserQuestion', { questions: [{ question: '要用哪個方案？' }] }));
  assert.equal(s.status, 'waiting');
  assert.equal(s.question, '要用哪個方案？');
  applyClaude(s, result(21));
  assert.equal(s.question, null);
});

test('a cache keep-alive ping does not change status, reply or last activity', () => {
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, { type: 'user', timestamp: at(0), message: { content: '幫我查' } });
  applyClaude(s, { type: 'assistant', timestamp: at(1), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '查好了' }] } });
  const last = s.lastEventAt;
  applyClaude(s, { type: 'user', isMeta: true, timestamp: at(30), message: { content: '[cache-keepalive] 心跳，只回覆 pong' } });
  applyClaude(s, { type: 'assistant', timestamp: at(30), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'pong' }] } });
  applyClaude(s, { type: 'system', subtype: 'stop_hook_summary', timestamp: at(30) });
  assert.equal(s.reply, '查好了');
  assert.equal(s.lastEventAt, last);
  applyClaude(s, { type: 'user', timestamp: at(40), message: { content: '下一個' } });
  assert.equal(s.prompt, '下一個');
  assert.equal(s.status, 'thinking');
});

test('wrap-up reply buttons become choices; app actions are left out', () => {
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, tool(0, 'mcp__ccd_turn__wrap_up', { recap: 'r', ask: '要推嗎？', actions: [
    { label: '推上去', message: '好，推上去' }, { action: 'commit' }, { label: '先不要' }] }));
  assert.deepEqual(s.choices, [{ label: '推上去', message: '好，推上去' }, { label: '先不要', message: '先不要' }]);
  applyClaude(s, { type: 'user', timestamp: at(5), message: { content: '好，推上去' } });
  assert.equal(s.choices, null);
});

test('failed tool calls in a row and repeated commands are counted', () => {
  const s = newSession('claude', 'x', 'f');
  const fail = (m) => ({ type: 'user', timestamp: at(m), message: { content: [{ type: 'tool_result', is_error: true }] } });
  for (let i = 0; i < 3; i++) { applyClaude(s, tool(i * 2, 'Bash', { description: '跑測試' })); applyClaude(s, fail(i * 2 + 1)); }
  assert.equal(s.errStreak, 3);
  assert.deepEqual(s.repeat, { text: 'Bash: 跑測試', n: 3 });
  applyClaude(s, tool(10, 'Read', { file_path: '/a/b.js' }));
  applyClaude(s, result(11));
  assert.equal(s.errStreak, 0);
  assert.equal(s.repeat.n, 1);
});

test('AskUserQuestion options are kept until it is answered', () => {
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, tool(0, 'AskUserQuestion', { questions: [{ question: '哪個？', options: [{ label: 'A 方案' }, { label: 'B 方案' }] }] }));
  assert.deepEqual(s.options, ['A 方案', 'B 方案']);
  applyClaude(s, result(1));
  assert.equal(s.options, null);
});

test('messages to and from other sessions are remembered with who and which way', () => {
  const A = 'local_11111111-2222-3333-4444-555555555555';
  const B = 'local_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const C = 'local_99999999-8888-7777-6666-555555555555';
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, tool(0, 'SendMessage', { to: A, message: '幫我看一下  REQ-1\n的回覆' }));
  applyClaude(s, tool(1, 'mcp__ccd_session_mgmt__send_message', { session_id: B, message: '轉送' }));
  applyClaude(s, tool(2, 'SendMessage', { to: 'some-name', message: '叫名字的沒有 id，略過' }));
  applyClaude(s, { type: 'user', isMeta: true, timestamp: at(3), origin: { kind: 'peer', from: A },
    message: { content: `Another Claude session sent a message:\n<cross-session-message from="${A}" name="x">\n收到，處理好了` } });
  applyClaude(s, { type: 'assistant', timestamp: at(4), message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__ccd_session__start_session', input: { initiation: 'user_asked', title: '查 log' } }] } });
  applyClaude(s, { type: 'user', timestamp: at(5), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: `Started ${C}` }] } });
  assert.deepEqual(s.talk.map((t) => [t.peer, t.dir, t.text]), [
    [A, 'out', '幫我看一下 REQ-1 的回覆'],
    [B, 'out', '轉送'],
    [A, 'in', '收到，處理好了'],
    [C, 'out', '查 log'],
  ]);
});

test('tool calls are tagged by kind of work; test / push results are remembered', () => {
  const { taskOf } = require('../src/parsers');
  assert.equal(taskOf('Bash', { command: 'node --test tests/a.cjs' }), 'test');
  assert.equal(taskOf('Bash', { command: 'cd x && mvn -q test -Dtest=Foo' }), 'test');
  assert.equal(taskOf('Bash', { command: 'git push -q origin hub:hub' }), 'push');
  assert.equal(taskOf('Bash', { command: 'git commit -m "x"' }), 'commit');
  assert.equal(taskOf('Bash', { command: 'npm run build' }), 'build');
  assert.equal(taskOf('Bash', { command: 'ls -la' }), 'shell');
  assert.equal(taskOf('Grep', { pattern: 'x' }), 'lookup');
  assert.equal(taskOf('WebSearch', { query: 'x' }), 'web');
  assert.equal(taskOf('Write', { file_path: '/a/REPORT.md' }), 'doc');
  assert.equal(taskOf('Write', { file_path: '/a/b.js' }), 'edit');
  assert.equal(taskOf('mcp__ccd_turn__update_plan', { items: [] }), 'plan');
  assert.equal(taskOf('mcp__ccd_turn__update_plan', { advance: true }), null);

  const s = newSession('claude', 'x', 'f');
  const use = (m, id, command) => ({ type: 'assistant', timestamp: at(m), message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const res = (m, id, isError) => ({ type: 'user', timestamp: at(m), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });
  applyClaude(s, use(0, 't1', 'npm test'));
  assert.equal(s.task, 'test');
  applyClaude(s, res(1, 't1', true));
  assert.deepEqual({ task: s.outcome.task, ok: s.outcome.ok }, { task: 'test', ok: false });
  applyClaude(s, use(2, 'l1', 'ls'));
  applyClaude(s, res(3, 'l1', false));
  assert.equal(s.outcome.task, 'test', 'an ordinary command leaves the last outcome alone');
  applyClaude(s, use(4, 'p1', 'git push'));
  applyClaude(s, res(5, 'p1', false));
  assert.deepEqual({ task: s.outcome.task, ok: s.outcome.ok }, { task: 'push', ok: true });
});

test('a /clear keeps one person: older logs of the same desktop session are dropped', () => {
  const { latestSegments } = require('../src/server');
  const s = newSession('claude', 'old', 'f');
  applyClaude(s, { type: 'bridge-session', sessionId: 'old', bridgeSessionId: 'cse_1' });
  assert.equal(s.bridgeId, 'cse_1');
  const seg = (id, startedAt, extra = {}) => ({ agent: 'claude', id, bridgeId: 'cse_1', startedAt, ...extra });
  const old = seg('a', 1, { ask: '要保留還是還原？', status: 'done' });
  const mid = seg('b', 2);
  const cur = seg('c', 3);
  const other = { agent: 'claude', id: 'z', bridgeId: 'cse_2', startedAt: 1 };
  const helper = { agent: 'claude', id: 'h', subagent: true, parentId: 'a' };
  const plain = { agent: 'codex', id: 'x' };
  const out = latestSegments([old, mid, cur, other, helper, plain]);
  assert.deepEqual(out.map((s) => s.id), ['c', 'z', 'h', 'x']);
  assert.equal(out.find((s) => s.id === 'h').parentId, 'c', 'a helper follows the current log');
  assert.equal(helper.parentId, 'a', 'the watcher\'s own record is left alone');
  // The log the desktop app points at wins even if another started later.
  assert.deepEqual(latestSegments([old, cur], (s) => s.id === 'a').map((s) => s.id), ['a']);
});

test('each session counts its tool calls by kind of work', () => {
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, tool(0, 'Read', { file_path: '/a/b.js' }));
  applyClaude(s, tool(1, 'Grep', { pattern: 'x' }));
  applyClaude(s, tool(2, 'Bash', { command: 'npm test' }));
  applyClaude(s, tool(3, 'Skill', { skill: 'x' }));
  assert.equal(JSON.stringify(s.kinds), JSON.stringify({ lookup: 2, test: 1, other: 1 }));
});

test('a PR merge and a CI run are recognised, with their results', () => {
  const { taskOf } = require('../src/parsers');
  assert.equal(taskOf('Bash', { command: 'gh pr merge 12 --squash' }), 'merge');
  assert.equal(taskOf('Bash', { command: 'gh run watch 123 --exit-status' }), 'ci');
  assert.equal(taskOf('Bash', { command: 'gh pr checks 12' }), 'ci');
  assert.equal(taskOf('Bash', { command: 'curl -X POST https://ci.example/job/web-app/buildWithParameters' }), 'ci');
  const s = newSession('claude', 'x', 'f');
  applyClaude(s, { type: 'assistant', timestamp: at(0), message: { content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'gh run watch 1 --exit-status' } }] } });
  applyClaude(s, { type: 'user', timestamp: at(1), message: { content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true }] } });
  assert.equal(s.outcome.task, 'ci');
  assert.equal(s.outcome.ok, false);
});
