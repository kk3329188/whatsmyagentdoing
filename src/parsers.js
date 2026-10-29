'use strict';

// Turns raw session-log lines from Claude Code and Codex into one shared
// session shape. Both tools append JSONL as they work, so the last meaningful
// line tells us what the agent is doing right now.
//
// Status values:
//   thinking  – model is reasoning / waiting on the API
//   tool      – a tool call is in flight (activity says which)
//   typing    – it has started writing its reply but the turn is not over
//   waiting   – it asked you something and is blocked on you
//   done      – the turn finished
//   interrupted, error, idle

const path = require('path');

const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

function newSession(agent, id, file) {
  return {
    agent,
    id,
    file,
    cwd: null,
    title: null,
    model: null,
    subagent: false,
    parentId: null,
    status: 'idle',
    activity: null,
    prompt: null,
    reply: null,
    error: null,
    turnStartedAt: null,
    lastEventAt: null,
    startedAt: null,
    // Hub edition: what the session is working through
    plan: null,       // [{ content, status }] from its task list
    progress: null,   // { total, done, step } reported to the session board
    recent: [],       // last few actions, newest last: { at, text }
    question: null,   // the question it is waiting on you for
    ask: null,        // the decision its wrap-up left you
    recap: null,      // its wrap-up recap
    choices: null,    // the reply buttons its wrap-up offered: [{ label, message }]
    options: null,    // the choices of the question it is waiting on
    repeat: null,     // { text, n }: the same action n times in a row
    errStreak: 0,     // tool calls that failed in a row
    talk: [],         // messages with other sessions, newest last: { peer, dir: 'out'|'in', at, text }
    spawning: null,   // tool_use id of a start_session call whose result names the new session
    tools: 0,         // tool calls seen and turns finished, for experience points (src/progress.js)
    turns: 0,
    task: null,       // what kind of work the current tool call is (taskOf)
    pendingTasks: {}, // tool_use id -> task, for the ones whose result is worth reacting to
    outcome: null,    // { at, task, ok }: the last test / build / push / commit result
    kinds: {},        // task -> how many tool calls of that kind (what they are good at)
  };
}

const KEEPALIVE = '[cache-keepalive]';
const RECENT_MAX = 12;
const TALK_MAX = 6;
const LOCAL_ID = /local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// A message to or from another desktop session.
function talk(s, peer, dir, at, text) {
  if (!peer || !LOCAL_ID.test(peer)) return;
  s.talk.push({ peer: peer.match(LOCAL_ID)[0], dir, at, text: short(String(text || '').replace(/\s+/g, ' '), 60) });
  if (s.talk.length > TALK_MAX) s.talk.shift();
}

function clean(text, max = 220) {
  if (!text) return null;
  let t = String(text);
  // Codex wraps the real prompt after injected context blocks.
  const marker = t.lastIndexOf('## My request:');
  if (marker !== -1) t = t.slice(marker + 14);
  t = t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<command-(message|args)>[\s\S]*?<\/command-\1>/g, ' ')
    // Drop injected context blocks (<foo attr="…">…</foo>); keep short inline tags' text.
    .replace(/<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>/g, (m) => (m.length > 300 ? ' ' : m.replace(/<[^>]+>/g, ' ')))
    // Markdown noise reads badly in a two-line preview.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`+|^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function short(s, max = 90) {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function stamp(s, ts) {
  const t = ts ? Date.parse(ts) : NaN;
  if (Number.isFinite(t)) {
    s.lastEventAt = Math.max(s.lastEventAt || 0, t);
    if (!s.startedAt) s.startedAt = t;
  }
  return Number.isFinite(t) ? t : null;
}

const BUSY = new Set(['thinking', 'tool', 'typing', 'waiting']);
function set(s, status, activity) {
  if ((status === 'tool' || status === 'waiting') && activity && activity !== s.activity) s.tools++;
  if (status === 'done' && BUSY.has(s.status)) s.turns++;
  s.status = status;
  if (activity !== undefined) s.activity = activity;
  if (status !== 'error') s.error = null;
}

// ---------------------------------------------------------------- Claude Code

function describeClaudeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '');
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return `${server} · ${rest.join('__')}`;
  }
  switch (name) {
    case 'Bash':
      return `Bash: ${short(input.description || input.command)}`;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `${name} ${base(input.file_path || input.notebook_path)}`;
    case 'Grep':
    case 'Glob':
      return `${name} ${short(input.pattern, 60)}`;
    case 'WebFetch':
      try { return `WebFetch ${new URL(input.url).host}`; } catch { return 'WebFetch'; }
    case 'WebSearch':
      return `WebSearch “${short(input.query, 60)}”`;
    case 'Agent':
    case 'Task':
      return `Subagent: ${short(input.description || input.subagent_type, 60)}`;
    case 'Skill':
      return `Skill ${input.skill || ''}`;
    case 'TodoWrite':
      return 'Updating todo list';
    default:
      return name;
  }
}

// What kind of work a tool call is, so the office can act it out: a test
// run, a push, reading up on something, writing a document, planning.
const NOTABLE = new Set(['test', 'build', 'push', 'commit']);
function taskOf(name, input = {}) {
  if (name === 'Bash') {
    const cmd = String(input.command || '');
    if (/\bgit\s+push\b/.test(cmd)) return 'push';
    if (/\bgit\s+commit\b/.test(cmd)) return 'commit';
    if (/node\s+--test|\b(npm|pnpm|yarn)\s+(run\s+)?test\b|\b(jest|vitest|pytest|mocha|karate)\b|\bgo\s+test\b|\b(mvn|mvnw|gradle|gradlew)\b[^|;&]*\b(test|verify)\b|\bcargo\s+test\b/.test(cmd)) return 'test';
    if (/\b(npm|pnpm|yarn)\s+run\s+build\b|\b(mvn|mvnw)\b[^|;&]*\b(package|install|compile)\b|\bgradlew?\b[^|;&]*\b(build|assemble)\b|\b(tsc|webpack|esbuild)\b|\bvite\s+build\b|\bcargo\s+build\b|^\s*make\b/.test(cmd)) return 'build';
    return 'shell';
  }
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'lookup';
  if (/^(WebSearch|WebFetch)$/.test(name)) return 'web';
  if (name === 'Write') return /\.(md|html?|pdf|docx?|txt|csv|xlsx?|pptx?)$/i.test(String(input.file_path || '')) ? 'doc' : 'edit';
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name)) return 'edit';
  if (name === 'TodoWrite' || (name === 'mcp__ccd_turn__update_plan' && Array.isArray(input.items))) return 'plan';
  if (name === 'Agent' || name === 'Task') return 'agent';
  if (/Browser|chrome/i.test(name)) return 'browser';
  if (/slack|send_message|SendMessage/i.test(name)) return 'chat';
  return null;
}

// The desktop app's task list (update_plan), TodoWrite, and the
// session board's progress tool all describe the same thing: the steps.
function applyPlan(s, name, input = {}) {
  if (name === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) {
      s.plan = input.items.map((x) => ({ content: short(x.content, 80), status: x.status || 'pending' }));
      return true;
    }
    const plan = s.plan;
    if (!plan) return true;
    const at = (n) => plan[n - 1];
    if (input.advance) {
      const i = plan.findIndex((x) => x.status === 'in_progress');
      if (i !== -1) plan[i].status = 'completed';
      const next = plan.findIndex((x, j) => j > i && x.status === 'pending');
      if (next !== -1) plan[next].status = 'in_progress';
    }
    for (const n of input.done || []) if (at(n)) at(n).status = 'completed';
    if (input.start && at(input.start)) {
      for (const x of plan) if (x.status === 'in_progress') x.status = 'pending';
      at(input.start).status = 'in_progress';
    }
    return true;
  }
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    s.plan = input.todos.map((x) => ({ content: short(x.activeForm || x.content, 80), status: x.status || 'pending' }));
    return true;
  }
  if (name === 'mcp__session-board__progress') {
    const total = Math.max(1, Number(input.total) || 1);
    s.progress = { total, done: Math.min(total, Math.max(0, Number(input.done) || 0)), step: short(input.step, 80) };
    return true;
  }
  if (name === 'mcp__ccd_turn__wrap_up') {
    if (s.plan) for (const x of s.plan) x.status = 'completed';
    s.ask = input.ask ? short(input.ask, 160) : null;
    s.recap = input.recap ? short(input.recap, 400) : null;
    // Reply buttons only (app actions like "commit" are the app's own).
    const acts = Array.isArray(input.actions) ? input.actions : [];
    s.choices = s.ask ? acts.filter((a) => a && !a.action && (a.label || a.message))
      .map((a) => ({ label: short(a.label || a.message, 30), message: String(a.message || a.label).slice(0, 600) })) : null;
    if (s.choices && !s.choices.length) s.choices = null;
    return true;
  }
  return false;
}

function applyClaude(s, d) {
  // Cache keep-alive pings ("[cache-keepalive]" → "pong") are not work:
  // skip the whole ping turn so an idle session doesn't look busy.
  if (d.type === 'user') {
    const c = d.message?.content;
    const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('') : '';
    if (d.isMeta && t.includes(KEEPALIVE)) { s.pinging = true; return; }
    if (!d.isMeta) s.pinging = false;
  }
  if (s.pinging && (d.type === 'assistant' || d.type === 'system' || d.type === 'attachment')) return;
  const ts = stamp(s, d.timestamp);
  if (d.cwd) s.cwd = d.cwd;

  switch (d.type) {
    case 'custom-title':
      if (d.customTitle) s.title = d.customTitle;
      return;
    case 'agent-name':
      if (!s.title && d.agentName) s.title = d.agentName;
      return;
    case 'bridge-session':
      // The desktop app's own id for the conversation. /clear and some
      // restarts begin a new log under the same one (see latestSegments).
      if (d.bridgeSessionId) s.bridgeId = d.bridgeSessionId;
      return;
    case 'system':
      if (d.subtype === 'stop_hook_summary') set(s, 'done', null);
      else if (d.subtype === 'api_error') {
        set(s, 'error', null);
        s.error = short(d.error?.formatted || d.error?.message || 'API error', 120);
      }
      return;
    case 'user': {
      const c = d.message?.content;
      // Another session sent this one a message.
      if (d.origin && d.origin.kind === 'peer') {
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('') : '';
        talk(s, d.origin.from, 'in', ts, t.replace(/^[\s\S]*?<cross-session-message[^>]*>/, ''));
      }
      if (d.isMeta) return;
      if (Array.isArray(c) && s.spawning) {
        // start_session's result names the session it started.
        const r = c.find((x) => x.type === 'tool_result' && x.tool_use_id === s.spawning.id);
        if (r) {
          const body = typeof r.content === 'string' ? r.content : JSON.stringify(r.content || '');
          const m = !r.is_error && body.match(LOCAL_ID);
          if (m) talk(s, m[0], 'out', ts, s.spawning.text);
          s.spawning = null;
        }
      }
      if (Array.isArray(c) && c.some((x) => x.type === 'tool_result')) {
        // Tool finished (or you answered its question); model reads the result.
        s.question = null;
        s.options = null;
        s.errStreak = c.some((x) => x.type === 'tool_result' && x.is_error) ? s.errStreak + 1 : 0;
        for (const r of c) {
          const task = r.type === 'tool_result' && s.pendingTasks[r.tool_use_id];
          if (!task) continue;
          delete s.pendingTasks[r.tool_use_id];
          s.outcome = { at: ts, task, ok: !r.is_error };
        }
        set(s, 'thinking');
        return;
      }
      const text = typeof c === 'string'
        ? c
        : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
      if (!text) return;
      if (text.startsWith('[Request interrupted')) { set(s, 'interrupted', null); return; }
      if (text.includes('<local-command-stdout>') || text.includes('<local-command-caveat>')) return;
      const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
      const isNotification = text.trimStart().startsWith('<task-notification>');
      if (!isNotification) {
        s.prompt = cmd ? cmd[1].trim() : clean(text, 600);
        if (!s.title && d.isSidechain) s.title = clean(text, 80);
        s.reply = null;
        s.ask = null;
        s.recap = null;
        s.choices = null;
      }
      s.question = null;
      s.options = null;
      s.repeat = null;
      s.errStreak = 0;
      s.turnStartedAt = ts;
      set(s, 'thinking', null);
      return;
    }
    case 'assistant': {
      const m = d.message || {};
      if (m.model && m.model !== '<synthetic>') s.model = m.model;
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b.type === 'thinking' || b.type === 'redacted_thinking') set(s, 'thinking');
        else if (b.type === 'text') {
          s.reply = clean(b.text, 1200) || s.reply;
          set(s, m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence' ? 'done' : 'typing', null);
        } else if (b.type === 'tool_use') {
          const what = describeClaudeTool(b.name, b.input);
          set(s, WAITING_TOOLS.has(b.name) ? 'waiting' : 'tool', what);
          applyPlan(s, b.name, b.input || {});
          s.task = taskOf(b.name, b.input || {});
          const kind = s.task || 'other';
          s.kinds[kind] = (s.kinds[kind] || 0) + 1;
          if (NOTABLE.has(s.task) && b.id) {
            s.pendingTasks[b.id] = s.task;
            const ids = Object.keys(s.pendingTasks);
            if (ids.length > 20) delete s.pendingTasks[ids[0]];
          }
          if (b.name === 'AskUserQuestion') {
            const q = (b.input?.questions || [])[0];
            s.question = q ? short(q.question, 200) : null;
            s.options = q && Array.isArray(q.options) ? q.options.map((o) => short(o.label, 40)).filter(Boolean) : null;
          }
          const inp = b.input || {};
          if (b.name === 'SendMessage') talk(s, inp.to, 'out', ts, inp.message);
          else if (b.name === 'mcp__ccd_session_mgmt__send_message') talk(s, inp.session_id, 'out', ts, inp.message);
          else if (b.name === 'mcp__ccd_session__start_session' && inp.initiation === 'user_asked') s.spawning = { id: b.id, text: inp.title || '開新 session' };
          s.repeat = s.repeat && s.repeat.text === what ? { text: what, n: s.repeat.n + 1 } : { text: what, n: 1 };
          s.recent.push({ at: ts, text: what });
          if (s.recent.length > RECENT_MAX) s.recent.shift();
        }
      }
      if (d.isApiErrorMessage) {
        set(s, 'error', null);
        s.error = s.reply;
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------- Codex

function codexText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((x) => x.text || '').join('\n');
}

function describeCodexCall(name, raw) {
  let args = raw;
  if (typeof raw === 'string') {
    try { args = JSON.parse(raw); } catch { args = raw; }
  }
  if (name === 'request_user_input' || name === 'request_user_input_async') return 'Asking you a question';
  if (typeof args === 'object' && args) {
    const cmd = args.cmd || args.command;
    if (cmd) return `Shell: ${short(Array.isArray(cmd) ? cmd[cmd.length - 1] : cmd)}`;
    if (args.query) return `${name} “${short(args.query, 60)}”`;
  }
  if (typeof args === 'string') {
    // The `exec` tool wraps other tools in a JS snippet; pull out the command.
    const m = args.match(/(?:cmd|command)\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return `Shell: ${short(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'))}`;
    const t = args.match(/tools\.([a-zA-Z_]+)\(/);
    if (t) return t[1];
  }
  return name;
}

function applyCodex(s, d) {
  const ts = stamp(s, d.timestamp);
  const p = d.payload || {};

  switch (d.type) {
    case 'session_meta':
      if (p.cwd) s.cwd = p.cwd;
      if (p.source && typeof p.source === 'object' && p.source.subagent) s.subagent = true;
      if (p.parent_thread_id) { s.parentId = p.parent_thread_id; s.subagent = true; }
      if (p.thread_source && p.thread_source !== 'user') s.subagent = true;
      return;
    case 'turn_context':
      if (p.model) s.model = p.model;
      if (p.cwd) s.cwd = p.cwd;
      return;
    case 'event_msg':
      switch (p.type) {
        case 'task_started':
          s.turnStartedAt = ts;
          s.reply = null;
          set(s, 'thinking', null);
          return;
        case 'task_complete':
          if (p.last_agent_message) s.reply = clean(p.last_agent_message);
          set(s, 'done', null);
          return;
        case 'turn_aborted':
          set(s, 'interrupted', null);
          return;
        case 'error':
          set(s, 'error', null);
          s.error = short(p.message || 'Error', 120);
          return;
        case 'user_message':
          s.prompt = clean(p.message);
          set(s, 'thinking', null);
          return;
        case 'agent_message':
          s.reply = clean(p.message) || s.reply;
          set(s, 'typing', null);
          return;
        case 'exec_approval_request':
        case 'apply_patch_approval_request':
        case 'request_user_input':
          set(s, 'waiting', 'Needs your approval');
          return;
        case 'item_started':
        case 'item_completed': {
          const it = p.item || {};
          const started = p.type === 'item_started';
          switch (it.type) {
            case 'UserMessage': {
              const text = clean(codexText(it.content));
              if (text) s.prompt = text;
              return;
            }
            case 'AgentMessage':
              s.reply = clean(codexText(it.content)) || s.reply;
              set(s, 'typing', null);
              return;
            case 'Reasoning':
              set(s, 'thinking');
              return;
            case 'CommandExecution': {
              const c = Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command;
              set(s, started ? 'tool' : 'thinking', `Shell: ${short(c)}`);
              return;
            }
            case 'McpToolCall':
              set(s, started ? 'tool' : 'thinking', `${it.server || 'mcp'} · ${it.tool || ''}`);
              return;
            case 'FileChange':
              set(s, started ? 'tool' : 'thinking', `Editing ${Object.keys(it.changes || {}).map((f) => path.basename(f)).join(', ')}`);
              return;
            case 'Extension':
              set(s, started ? 'tool' : 'thinking', `${it.kind || 'tool'} ${short(it.query, 50)}`);
              return;
          }
          return;
        }
      }
      return;
    case 'response_item':
      switch (p.type) {
        case 'reasoning':
          set(s, 'thinking');
          return;
        case 'function_call':
        case 'custom_tool_call':
        case 'local_shell_call':
        case 'web_search_call': {
          const name = p.name || p.type;
          const waiting = name.startsWith('request_user_input');
          set(s, waiting ? 'waiting' : 'tool', describeCodexCall(name, p.arguments ?? p.input ?? p.action));
          return;
        }
        case 'function_call_output':
        case 'custom_tool_call_output':
          set(s, 'thinking');
          return;
        case 'message':
          if (p.role === 'assistant') {
            s.reply = clean(codexText(p.content)) || s.reply;
            set(s, 'typing', null);
          }
          return;
      }
      return;
  }
}

// --------------------------------------------------------------- Gemini CLI
//
// ~/.gemini/tmp/<project>/chats/session-*.jsonl, append-only: a metadata
// line, then message records. A message is re-appended in full whenever it
// changes (tool calls finishing etc.), so the last line for an id wins.
// Older versions wrote a single .json file instead; see applyGeminiDocument.

const GEMINI_PENDING = new Set(['validating', 'scheduled', 'executing']);

function geminiText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(geminiText).join('');
  if (typeof content === 'object' && typeof content.text === 'string') return content.text;
  return '';
}

function describeGeminiTool(tc) {
  const a = tc.args || {};
  const name = tc.name || tc.displayName || 'tool';
  const file = a.absolute_path || a.file_path || a.path;
  switch (name) {
    case 'run_shell_command':
      return `Shell: ${short(a.description || a.command)}`;
    case 'read_file':
    case 'write_file':
    case 'replace':
    case 'edit':
      return `${tc.displayName || name} ${file ? path.basename(String(file)) : ''}`.trim();
    case 'glob':
    case 'search_file_content':
    case 'grep':
      return `${tc.displayName || name} ${short(a.pattern, 60)}`;
    case 'google_web_search':
      return `WebSearch “${short(a.query, 60)}”`;
    case 'web_fetch':
      return `WebFetch ${short(a.url || a.prompt, 60)}`;
    default:
      return tc.displayName || name;
  }
}

function applyGemini(s, d) {
  if (!d || typeof d !== 'object') return;
  // metadata line / $set updates
  const meta = d.$set || (d.sessionId && !d.type ? d : null);
  if (meta) {
    if (meta.sessionId) s.sessionId = meta.sessionId;
    if (meta.kind === 'subagent') s.subagent = true;
    if (Array.isArray(meta.directories) && meta.directories[0] && !s.cwd) s.cwd = meta.directories[0];
    if (meta.summary) s.title = clean(meta.summary, 80);
    if (meta.startTime) stamp(s, meta.startTime);
    if (Array.isArray(meta.messages)) for (const m of meta.messages) applyGemini(s, m);
    return;
  }
  if (d.$patch || d.$rewindTo || !d.type) return;

  stamp(s, d.timestamp);
  switch (d.type) {
    case 'user': {
      const text = clean(geminiText(d.displayContent ?? d.content));
      if (!text) return;
      if (text.startsWith('/')) { s.prompt = text.split(' ')[0]; } else s.prompt = text;
      s.reply = null;
      s.turnStartedAt = d.timestamp ? Date.parse(d.timestamp) : s.turnStartedAt;
      set(s, 'thinking', null);
      return;
    }
    case 'gemini': {
      if (d.model) s.model = d.model;
      const calls = Array.isArray(d.toolCalls) ? d.toolCalls : [];
      const waiting = calls.find((c) => c.status === 'awaiting_approval');
      const pending = calls.filter((c) => GEMINI_PENDING.has(c.status));
      const text = clean(geminiText(d.content));
      if (waiting) set(s, 'waiting', describeGeminiTool(waiting));
      else if (pending.length) set(s, 'tool', describeGeminiTool(pending[pending.length - 1]));
      else if (calls.length && !text) set(s, 'thinking', null); // tools done, model continues
      else if (text) { s.reply = text; set(s, 'typing', null); }
      else set(s, 'thinking');
      return;
    }
    case 'error':
      set(s, 'error', null);
      s.error = short(geminiText(d.content) || 'Error', 120);
      return;
    case 'info':
    case 'warning': {
      const t = geminiText(d.content).toLowerCase();
      if (t.includes('cancel') || t.includes('interrupt')) set(s, 'interrupted', null);
      return;
    }
  }
}

// Legacy whole-file .json sessions.
function applyGeminiDocument(s, doc) {
  applyGemini(s, { $set: doc });
}

module.exports = { newSession, applyClaude, applyCodex, applyGemini, applyGeminiDocument, clean, taskOf };
