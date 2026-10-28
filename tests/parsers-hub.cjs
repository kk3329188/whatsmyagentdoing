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
