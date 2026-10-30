// Isometric office: agents that are working sit at cubicle desks; a few that
// are off duty wander between the pantry, lounge, meeting room and ping-pong
// table. Plain canvas 2D with local provider logos, no dependencies.
(() => {
  'use strict';

  const TW = 64; // tile width px
  const TH = 32; // tile height px; one z unit is TH px too
  const WALL_H = 2.4;
  const WORKING = new Set(['thinking', 'tool', 'typing', 'waiting', 'error']);
  const MAX_WANDERERS = 7;

  // Where someone is tells you their state at a glance.
  //   desk = working · meeting room = waiting on you / left you a decision
  //   in front of the server rack = hit an error · pantry = just finished
  //   lounge = idle · walked out the door = gone home (beyond the seats)
  const DONE_MS = 30 * 60_000;
  const ZONE_ORDER = ['wait', 'error', 'done', 'idle'];
  // What kind of work a desk worker is doing; it picks their pose and what
  // their screen shows.
  function workKind(s) {
    if (s.status === 'thinking') return 'think';
    if (s.status === 'typing') return 'reply';
    const a = s.activity || '';
    if (/^(Bash|Shell):/.test(a)) return 'shell';
    if (/^(Edit|Write|MultiEdit|NotebookEdit|Editing)\b/.test(a)) return 'edit';
    if (/^Subagent:/.test(a)) return 'agent';
    if (/slack|send_message|SendMessage|relay/i.test(a)) return 'chat';
    if (/update_plan|wrap_up|progress|TodoWrite|Updating todo/.test(a)) return 'plan';
    return 'read';
  }
  // A shell command or a subagent that has been running a while: lean back and wait.
  const longRun = (s) => s.status === 'tool' && Date.now() - (s.lastEventAt || Date.now()) > 90_000;
  const EVENT_TEXT = {
    work: () => '開工！',
    wait: (s) => (s.status === 'waiting' ? '有事問你！' : '要你決定！'),
    error: () => '出錯了…',
    done: (s) => (s.status === 'interrupted' ? '被中斷' : '做完了 ✓'),
  };
  function zoneOf(s) {
    if (s.status === 'thinking' || s.status === 'tool' || s.status === 'typing') return 'work';
    if (s.status === 'waiting' || (s.status === 'done' && (s.ask || s.needs))) return 'wait';
    if (s.status === 'error') return 'error';
    if ((s.status === 'done' || s.status === 'interrupted') && Date.now() - (s.lastEventAt || 0) < DONE_MS) return 'done';
    return 'idle';
  }
  const SPEED = 2.1; // tiles / second
  // Picked up with the mouse: how high they dangle, and what they say.
  const HOLD_Z = 0.55;
  const HELD_TEXT = ['哇！', '放我下來！', '欸欸欸', '咦？要去哪', '我還在忙耶'];
  // Experience: what each level is called, and what the office unlocks as
  // its lifetime count of finished turns grows (src/progress.js).
  const LEVEL_TITLE = ['新人', '新人', '正職', '資深', '主管', '傳奇'];
  const UNLOCKS = [
    { id: 'plants', at: 10, name: '🌿 盆栽' },
    { id: 'tv', at: 50, name: '📺 休息區電視' },
    { id: 'cat2', at: 120, name: '🐈‍⬛ 第二隻貓（2D）' },
    { id: 'trophy', at: 250, name: '🏆 獎盃櫃' },
    { id: 'neon', at: 500, name: '✨ 霓虹招牌' },
  ];
  // Waiting on you this long: hold up a sign, then come and knock on the screen.
  const SIGN_MS = 3 * 60_000;
  const KNOCK_MS = 10 * 60_000;
  const waitedMs = (s) => Date.now() - (s.lastEventAt || Date.now());
  const hour = () => new Date().getHours() + new Date().getMinutes() / 60;
  const lunch = () => { const h = hour(); return h >= 12 && h < 13.5; };
  // Closing time: whoever is just resting goes home, the lights go down.
  const closing = () => { const h = hour(); return h >= 19 || h < 7; };
  // Sitting somewhere off duty is not just sitting: what they get up to on
  // each kind of seat, a new thing every 7–10 seconds.
  const SEAT_ACTS = {
    stool: ['eat', 'sip', 'scroll', 'chat', 'laugh', 'scroll'],
    couch: ['scroll', 'read', 'laptop', 'laugh', 'watch', 'sip', 'game'],
    beanbag: ['scroll', 'game', 'read', 'watch', 'laugh'],
    read: ['read', 'laptop', 'write', 'think', 'read'],
    meeting: ['laptop', 'write', 'scroll', 'think'],
    tv: ['watch', 'laugh', 'watch'],
  };
  // The slot machine in the play corner: five reels of these, three rows
  // showing, paid along the middle row (three or more alike from the left).
  const SLOT_SYMS = ['7', '💎', '🍒', '🔔', '⭐', '🍋', '🍀', 'BAR'];
  const SLOT_PAY = { '7': 500, '💎': 300, 'BAR': 200, '⭐': 150, '🔔': 100, '🍀': 80, '🍒': 50, '🍋': 40 };
  // Each reel holds every symbol twice, in its own order.
  const SLOT_STRIPS = [0, 1, 2, 3, 4].map((i) => Array.from({ length: 16 }, (_, k) => SLOT_SYMS[(k < 8 ? k * 3 + i : k * 5 + i * 3) % 8]));
  const SLOT_EASE = (k) => (k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2));

  // Everyone has a personality or two (fixed by who they are): it decides
  // where they like to spend a break and what they do sitting down.
  const TRAITS = [
    { id: 'coffee', name: '咖啡控', emoji: '☕', likes: { coffee: 4, water: 1.5, vending: 1.5 }, seat: ['sip', 'sip'] },
    { id: 'sporty', name: '運動咖', emoji: '🏃', likes: { run: 5, yoga: 4, pingpong: 3, foosball: 2.5 }, seat: ['scroll'], stretch: 3 },
    { id: 'owl', name: '夜貓子', emoji: '🦉', likes: { arcade: 2, slot: 2.5, tv: 2, couch: 1.5 }, seat: ['watch', 'game'], owl: true },
    { id: 'chatty', name: '話匣子', emoji: '💬', likes: { stool: 1.5 }, seat: ['chat', 'laugh'], chat: 3 },
    { id: 'bookworm', name: '書蟲', emoji: '📚', likes: { read: 5, window: 1.5 }, seat: ['read', 'read'] },
    { id: 'gamer', name: '遊戲宅', emoji: '🎮', likes: { arcade: 5, slot: 4, beanbag: 3, foosball: 2 }, seat: ['game', 'game'] },
    { id: 'foodie', name: '美食家', emoji: '🍙', likes: { fridge: 4, vending: 4, stool: 2 }, seat: ['eat', 'eat'] },
    { id: 'tidy', name: '整潔控', emoji: '🧹', likes: { plant: 3, printer: 2 }, seat: ['write'], tidy: true },
  ];
  function traitsOf(key) {
    const h = hash(String(key || ''));
    const a = TRAITS[h % TRAITS.length], b = TRAITS[(h >>> 7) % TRAITS.length];
    return b !== a && (h >>> 13) % 3 === 0 ? [a, b] : [a];
  }
  const STANDUP_TURN_MS = 5000;  // each one talks this long
  const STANDUP_GATHER_MS = 6500; // time to walk over before the first one talks
  const night = () => { const h = new Date().getHours(); return h >= 20 || h < 7; };
  const morning = () => { const h = hour(); return h >= 7 && h < 10; };
  // Which department a session works in: its repository (a worktree counts
  // as the repository it was cut from), else its folder.
  function deptOf(s) {
    const cwd = String((s && s.cwd) || '');
    const m = cwd.match(/^(.*?)\/\.(?:claude|codex)\/worktrees\//);
    return (m ? m[1] : cwd).split('/').filter(Boolean).pop() || (s && s.project) || '其他';
  }
  // How a desk worker takes the result of a test run, a build or a push
  // (src/parsers.js outcome): [act when it failed, text], [act when it passed, text].
  const REACT = {
    test: [['facepalm', '測試沒過…'], ['cheer', '測試全過！']],
    build: [['facepalm', '編譯失敗…'], ['cheer', '建好了！']],
    push: [['facepalm', '推不上去…'], ['cheer', '推上去了 🚀']],
    commit: [['facepalm', 'commit 失敗'], [null, 'commit ✓']],
    merge: [['facepalm', '合併失敗…'], ['cheer', '合併了！🎉']],
    ci: [['facepalm', 'CI 掛了！🚨'], ['cheer', 'CI 綠燈 ✓']],
  };
  const ALARM_MS = 30_000;   // a failed CI run: the server room flashes red this long
  const CONFETTI_MS = 4500;  // a merged PR: confetti over them
  const REACT_MS = 4500;
  // Starting work or finishing: the camera closes in on them for a moment.
  const SPOT_MS = 5500;
  const SPOT_AGAIN_MS = 60_000; // the same person at most once a minute
  // The boss walks in: everyone hurries back to a desk and looks busy.
  const BOSS_IN = ['老闆來了！', '快回座位！', '假裝很忙…', '咳咳，在做事', '老闆好～'];
  const BOSS_OUT = ['呼～老闆走了', '終於…', '休息一下', '伸個懶腰', '可以摸魚了'];
  const RUSH_MS = 9000;

  const SKIN = ['#f3cfb0', '#e5b38f', '#c98d66', '#9a6646', '#6e4630', '#f7dcc7'];
  const HAIR = ['#2a2019', '#4b3020', '#8a4b2a', '#c99a5b', '#1c1c1c', '#8c8c8c', '#a33a2c', '#3d3550'];
  const SHIRT = {
    claude: ['#c96442', '#d9825f', '#b4553a', '#e09a72'],
    codex: ['#10a37f', '#2bb38f', '#0d8a6b', '#4cc3a0'],
    gemini: ['#4f7cf0', '#6b8ff5', '#3d66d6', '#8aa6f8'],
  };
  // Official product icons, shared by both renderers and the page UI.
  // Load once per page from the same origin so video capture stays readable.
  // Initials remain a fallback if an image cannot be loaded.
  const AGENT_BADGES = {
    claude: { label: 'Claude', short: 'Cl', color: '#c96442', logo: '/assets/agents/claude.png' },
    codex: { label: 'Codex', short: 'Cx', color: '#10a37f', logo: '/assets/agents/codex.png' },
    gemini: { label: 'Gemini', short: 'G', color: '#4f7cf0', logo: '/assets/agents/gemini.png' },
  };
  for (const badge of Object.values(AGENT_BADGES)) {
    badge.image = new Image();
    badge.image.src = badge.logo;
  }
  const PANTS = ['#34405a', '#2c2c34', '#4a3f35', '#3b4a3f'];
  const PANEL = ['#7d93c4', '#d98b6a', '#7fb08a', '#c9a24c'];

  const STATUS_COLOR = {
    thinking: '#8b6be6', tool: '#3b8ee0', typing: '#22a874', waiting: '#e09412',
    done: '#5f9a4c', error: '#de4b40', interrupted: '#9b9a94', idle: '#9b9a94',
  };

  const ACT_EMOJI = {
    coffee: '☕', water: '💧', fridge: '🍎', sink: '🫧', stool: '💬', couch: '💬', beanbag: '🎧',
    window: '☁️', read: '📖', whiteboard: '✏️', meeting: '💬', arcade: '🎮', pingpong: '🏓', plant: '🌱',
    vending: '🥤', foosball: '⚽', phone: '📞', eat: '🍱', printer: '📄', petcat: '😺', stretch: '🙆',
    tv: '📺', trophy: '🏆', run: '🏃', yoga: '🧘',
    pin: '📌', fix: '🔧', refill: '☕', waterplant: '🌱', unpack: '🍱', deliver: '📦',
    scroll: '📱', laptop: '💻', laugh: '😂', watch: '📺', game: '🎮', think: '💭', nap: '💤',
  };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Thirteen hairstyles, the same in 2D and 3D (see hair2d / chibi.js).
  const HAIR_STYLES = 13;
  const hairOf = (h) => (h >>> 3) % HAIR_STYLES;
  const pick = (arr, h, salt) => arr[(Math.imul(h ^ Math.imul(salt, 2654435761), 2246822519) >>> 0) % arr.length];
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function palette() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return dark ? {
      dark: true,
      wood1: '#4a3f35', wood2: '#453a31', woodLine: 'rgba(0,0,0,.22)',
      tileA: '#3d4044', tileB: '#35383c', carpet: '#33404d', carpetLine: 'rgba(255,255,255,.04)',
      wallL: '#4a4640', wallR: '#3f3b36', wallTop: '#5a554e', trim: '#2b2926',
      deskTop: '#8a6a4c', deskL: '#6e533b', deskR: '#5c4431',
      monitor: '#18181a', screenOff: '#26282c', chair: '#a8664a', panel: '#8e8a82',
      rug: '#47544f', rugEdge: '#3a4541', couch: '#5b6b8c', couchD: '#4a587a',
      workA: '#3a3d42', workB: '#36393e', runner: '#7a4f3e', runnerEdge: '#a8745c',
      counter: '#d9d4c9', counterL: '#a9a397', counterR: '#958f84', metal: '#8d939a',
      glass: 'rgba(160,200,230,.10)', glassEdge: 'rgba(190,220,240,.35)', mat: '#2f4a3a',
      text: '#ecebe6', tagBg: 'rgba(20,20,19,.78)', bubble: '#f4f3ee', bubbleInk: '#1c1c1a',
      plant: '#4f8a52', pot: '#9a5b3c', shadow: 'rgba(0,0,0,.28)', book: ['#c96442', '#3b8ee0', '#5f9a4c', '#c9a24c', '#8b6be6'],
    } : {
      dark: false,
      wood1: '#e6d3b6', wood2: '#dfcaab', woodLine: 'rgba(120,90,50,.12)',
      tileA: '#f4f4f1', tileB: '#e6e7e3', carpet: '#c9d3dc', carpetLine: 'rgba(0,0,0,.035)',
      wallL: '#f4efe6', wallR: '#e8e1d4', wallTop: '#fbf8f2', trim: '#cfc5b3',
      deskTop: '#c9a47e', deskL: '#a8825a', deskR: '#946f4b',
      monitor: '#2a2a2e', screenOff: '#3a3d44', chair: '#cd8a68', panel: '#e9e3d7',
      rug: '#c4d4cb', rugEdge: '#a9bcb1', couch: '#7d93c4', couchD: '#6a80b0',
      workA: '#d9d6cf', workB: '#d2cec6', runner: '#cd8a68', runnerEdge: '#f0d9c8',
      counter: '#fbfaf7', counterL: '#d9d4c9', counterR: '#c9c3b6', metal: '#b5bcc4',
      glass: 'rgba(170,210,235,.16)', glassEdge: 'rgba(120,160,190,.55)', mat: '#bfd8c4',
      text: '#1c1c1a', tagBg: 'rgba(255,255,255,.9)', bubble: '#ffffff', bubbleInk: '#1c1c1a',
      plant: '#5a9b5d', pot: '#b86f4b', shadow: 'rgba(60,40,20,.18)', book: ['#c96442', '#3b8ee0', '#5f9a4c', '#c9a24c', '#8b6be6'],
    };
  }

  function skyColor(d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 7 && h < 17) return { sky: '#a9d4f2', night: false };
    if (h >= 5 && h < 7) return { sky: '#f3c9a8', night: false };
    if (h >= 17 && h < 19) return { sky: '#f0a679', night: false };
    return { sky: '#1d2747', night: true };
  }

  // ---------------------------------------------------------------- A* grid

  class Grid {
    constructor(W, D, res = 4) {
      this.res = res;
      this.cw = Math.ceil(W * res);
      this.ch = Math.ceil(D * res);
      this.cost = new Uint8Array(this.cw * this.ch);
    }
    block(x, y, w, d, pad = 0.12) {
      const R = this.res;
      const i0 = clamp(Math.floor((x - pad) * R), 0, this.cw - 1);
      const i1 = clamp(Math.ceil((x + w + pad) * R) - 1, 0, this.cw - 1);
      const j0 = clamp(Math.floor((y - pad) * R), 0, this.ch - 1);
      const j1 = clamp(Math.ceil((y + d + pad) * R) - 1, 0, this.ch - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cost[j * this.cw + i] = 1;
    }
    // Solid cells here become seats: walkable for the one sitting down.
    soften(x, y, w, d) {
      const R = this.res;
      for (let j = Math.max(0, Math.floor(y * R)); j <= Math.min(this.ch - 1, Math.ceil((y + d) * R) - 1); j++) {
        for (let i = Math.max(0, Math.floor(x * R)); i <= Math.min(this.cw - 1, Math.ceil((x + w) * R) - 1); i++) {
          if (this.cost[j * this.cw + i] === 1) this.cost[j * this.cw + i] = 2;
        }
      }
    }
    blocked(x, y) {
      const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
      if (i < 0 || j < 0 || i >= this.cw || j >= this.ch) return true;
      return !!this.cost[j * this.cw + i];
    }
    // Solid furniture only (seats and chairs are not).
    hard(x, y) {
      const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
      if (i < 0 || j < 0 || i >= this.cw || j >= this.ch) return true;
      return this.cost[j * this.cw + i] === 1;
    }
    path(ax, ay, bx, by) {
      const R = this.res, cw = this.cw, ch = this.ch;
      const si = clamp(Math.floor(ax * R), 0, cw - 1), sj = clamp(Math.floor(ay * R), 0, ch - 1);
      const gi = clamp(Math.floor(bx * R), 0, cw - 1), gj = clamp(Math.floor(by * R), 0, ch - 1);
      const N = cw * ch;
      const g = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = [];
      const push = (f, n) => {
        heap.push([f, n]);
        let k = heap.length - 1;
        while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let k = 0;
          for (;;) {
            const l = 2 * k + 1, r = l + 1;
            let m = k;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === k) break;
            [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
          }
        }
        return top;
      };
      const hfn = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
      // Blocked cells are very expensive (walk round any furniture you can),
      // not impossible, so a path always exists
      // (someone standing right against furniture can still step away).
      // 2 = a seat: fine to walk onto when it is yours, avoided otherwise.
      const stepCost = (n) => (this.cost[n] === 1 ? 400 : this.cost[n] === 2 ? 150 : 1);
      const start = sj * cw + si, goal = gj * cw + gi;
      g[start] = 0;
      push(hfn(si, sj), start);
      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
      while (heap.length) {
        const [, n] = pop();
        if (n === goal) break;
        if (closed[n]) continue;
        closed[n] = 1;
        const i = n % cw, j = (n / cw) | 0;
        for (const [di, dj, c] of dirs) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cw || nj >= ch) continue;
          if (di && dj && (this.cost[j * cw + ni] || this.cost[nj * cw + i])) continue;
          const nn = nj * cw + ni;
          const ng = g[n] + c * stepCost(nn);
          if (ng < g[nn]) { g[nn] = ng; came[nn] = n; push(ng + hfn(ni, nj), nn); }
        }
      }
      const cells = [];
      for (let n = goal; n !== -1 && n !== start; n = came[n]) cells.push(n);
      cells.reverse();
      const pts = [];
      let lastDir = null;
      for (let k = 0; k < cells.length; k++) {
        const n = cells[k];
        const dir = n - (k ? cells[k - 1] : start);
        const pt = { x: ((n % cw) + 0.5) / R, y: (((n / cw) | 0) + 0.5) / R };
        if (dir === lastDir && pts.length) pts[pts.length - 1] = pt;
        else pts.push(pt);
        lastDir = dir;
      }
      if (pts.length) pts[pts.length - 1] = { x: bx, y: by };
      else pts.push({ x: bx, y: by });
      return pts;
    }
  }

  // ---------------------------------------------------------------- office

  class Office {
    constructor(root, { floor = 1, onHover, onRelay, onCommand, isSecretary, label, doing, zoneLabels, helpers, onFrame, roam = true, showAgent = true, compact = false } = {}) {
      this.root = root;
      this.onHover = onHover || (() => {});
      // Dropped one person onto another: pass the first one's last reply on.
      this.onRelay = onRelay || null;
      // Which floor this view is (2 = upstairs: breaks and overflow desks).
      this.floor = floor;
      // Dropped someone on a piece of furniture (printer, whiteboard, coffee, door).
      this.onCommand = onCommand || null;
      // Which session works as your secretary (sits beside your desk, brings news).
      this.isSecretary = isSecretary || null;
      this.label = label || ((s) => s.project || s.agent);
      // What a working person's bubble says (default: the tool's name).
      this.doing = doing || ((s) => (s.activity || 'tool').split(/[:\s]/)[0]);
      // Floor signs naming each zone ({ work, wait, error, done, idle }).
      this.zoneLabels = zoneLabels || null;
      // Subagents a session is running right now, drawn as small helpers.
      this.helpers = helpers || (() => []);
      // Off-duty people roam the whole office (state shown by the bubble and
      // a ring at their feet) instead of keeping to their state's room.
      this.roam = roam;
      this.onFrame = onFrame;
      this.showAgent = showAgent;
      this.compact = compact;
      this.offDutyLabel = 'went home';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'office-canvas';
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.people = new Map();
      this.deskOf = new Map();
      this.offDuty = 0;
      this.first = true;
      this.visible = true;
      this.hit = [];
      this.hoverKey = null;
      this.t = performance.now();
      this.pal = palette();
      this.plan = this.buildPlan(0);
      this.cat = { x: this.plan.W - 3, y: this.plan.D - 2, path: [], until: 0, face: 1, color: floor === 2 ? '#8f8f96' : null };
      this.theme = matchMedia('(prefers-color-scheme: dark)');
      this.onTheme = () => (this.pal = palette());
      this.theme.addEventListener('change', this.onTheme);

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(root);
      // Press and hold on a person to pick them up; a plain click still opens them.
      this.canvas.addEventListener('pointerdown', (e) => this.grab(e));
      this.canvas.addEventListener('pointermove', (e) => (this.press ? this.drag(e) : this.pointer(e)));
      this.canvas.addEventListener('pointerup', (e) => this.drop(e));
      this.canvas.addEventListener('pointercancel', (e) => this.drop(e));
      this.canvas.addEventListener('click', (e) => { if (this.dropped) { this.dropped = false; return; } this.pointer(e, true); });
      this.canvas.addEventListener('mouseleave', () => { if (this.held) return; this.hoverKey = null; this.onHover(null); });
      this.canvas.addEventListener('dblclick', (e) => {
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const h = [...this.hit].reverse().find((b) => mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1);
        const p = h && this.people.get(h.key);
        if (p) this.poke(p);
      });
      this.resize();
      this.last = performance.now();
      // Resolves true once a few frames have been drawn with data in place,
      // false if the renderer gave up (3D load failure).
      this.ready = new Promise((ok) => (this.markReady = ok));
      this.framesShown = 0;
      const loop = (t) => { if (this.dead) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      this.ro.disconnect();
      this.theme.removeEventListener('change', this.onTheme);
      this.canvas.remove();
    }

    // ------------------------------------------------------------ floor plan

    buildPlan(nWorking) {
      const pal = this.pal;
      // At least four pods (16 desks): it should feel like a company even on
      // a quiet day (free desks also hold the ones on leave).
      const pods = Math.max(4, Math.ceil((nWorking + 2) / 4));
      const podCols = pods <= 4 ? 2 : 3;
      const podRows = Math.ceil(pods / podCols);
      // Pods 4.6 apart: a proper aisle between them, with a runner down it.
      const PODX = 4.6;
      const OW = 1.3 + (podCols - 1) * PODX + 3.9; // open office width
      const OD = podRows * 4.7 + 0.8;             // open office depth (pods)
      // Both floors are as deep (the lift is in the same spot). Upstairs keeps
      // the older plan; downstairs (the refit below) is a little wider.
      const D = Math.max(OD + 7.2, 14.5);
      const W = 7.6 + (podCols - 1) * PODX + 6.2;
      const RW = W - OW;                           // right column width (upstairs)
      const MR = 5.2;                              // meeting room depth
      const PY = 9.9;                              // pantry / lounge boundary
      const grid = new Grid(W, D);
      const items = [];
      const pois = [];
      const desks = [];
      const podSpots = [];
      const add = (depth, draw) => items.push({ depth, draw });
      // Semantic list of what is where, for renderers that don't use the 2D
      // draw closures (the 3D view).
      const props = [];
      const prop = (t, o) => props.push({ t, ...o });
      const solid = (x, y, w, d, pad) => grid.block(x, y, w, d, pad);
      const poi = (x, y, act, face, opt = {}) => pois.push({ x, y, act, face, sit: 0, ...opt });

      // Long boxes are split into ~1 tile pieces so depth sorting against
      // people stays right along their length. `extra(x0, x1)` draws things on
      // the front face of each piece (books on a shelf, etc).
      const longBox = (x, y, z, w, d, h, top, left, right, opts = {}) => {
        const n = Math.max(1, Math.ceil(Math.max(w, d) / 0.9));
        for (let k = 0; k < n; k++) {
          const sx = w >= d ? x + (w / n) * k : x, sy = w >= d ? y : y + (d / n) * k;
          const sw = w >= d ? w / n : w, sd = w >= d ? d : d / n;
          add(sx + sw / 2 + sy + sd / 2 + (opts.bias || 0), () => {
            this.box(sx, sy, z, sw, sd, h, top, left, right);
            if (opts.extra) opts.extra(sx, sx + sw);
          });
        }
      };

      // ---- cubicle pods: 4 desks back to back with a divider
      const cubicles = (count, x0 = 1.3) => { for (let p = 0; p < count; p++) {
        const c = p % podCols, r = Math.floor(p / podCols);
        const px = x0 + c * PODX, py = 2.0 + r * 4.7;
        const panel = PANEL[p % PANEL.length];
        podSpots.push({ x: px, y: py, color: panel });
        for (let k = 0; k < 2; k++) {
          const x = px + k * 1.5;
          desks.push({ x, y: py, side: 'n', pod: p, seat: { x: x + 0.7, y: py - 0.45 } });
          desks.push({ x, y: py + 0.92, side: 's', pod: p, seat: { x: x + 0.7, y: py + 0.92 + 1.25 } });
          solid(x, py, 1.4, 0.8, 0.08);
          solid(x, py + 0.92, 1.4, 0.8, 0.08);
        }
        longBox(px - 0.1, py + 0.82, 0, 3.15, 0.08, 1.15, this.shade(panel, 25), panel, this.shade(panel, -15), { bias: 0.05 });
        prop('panel', { x: px - 0.1, y: py + 0.82, w: 3.15, d: 0.08, h: 1.15, color: panel });
        prop('panel', { x: px - 0.18, y: py - 0.05, w: 0.08, d: 1.82, h: 1.15, color: panel });
        add(px - 0.1 + py + 0.86, () => this.box(px - 0.18, py - 0.05, 0, 0.08, 1.82, 1.15, this.shade(panel, 25), panel, this.shade(panel, -15)));
        solid(px - 0.18, py + 0.8, 3.25, 0.12, 0.05);
        // Pendant lamps over the pod and a planter along the divider (3D).
        prop('pendant', { x: px + 1.45, y: py + 0.86, span: 1.5 });
        prop('planter', { x: px + 0.2, y: py + 0.82, w: 2.4 });
      } };
      const aislesFrom = (x0) => {
        const out = [];
        for (let c = 0; c + 1 < Math.min(podCols, pods); c++) out.push({ x: x0 + c * PODX + 3.12, w: PODX - 3.4 });
        return out;
      };
      // The lift on the left wall, the same spot on both floors.
      const lift = { x: 0.55, y: D - 3.0 };
      prop('lift', { y: lift.y });
      if (this.floor === 2) {
        // Upstairs: a few hot desks for overflow work, the rest is for breaks.
        // Always a spare desk or two, as downstairs (else every update would
        // lay the floor out again and send everyone walking).
        cubicles(Math.max(1, Math.ceil((nWorking + 2) / 4)));
        return { ...this.upstairs({ W, D, OW, OD, MR, PY, RW, pods, podCols, PODX, grid, items, props, pois, desks, add, prop, solid, poi, longBox, lift }), podSpots, aisles: aislesFrom(1.3) };
      }
      // ---- Downstairs (the 2026 refit). Back left: the meeting room behind
      // glass; back right, under the windows: the work area; left middle: the
      // play corner; across the front, one long "street": the lounge by the
      // front door (visitors wait there), your desk and the secretary's in
      // the middle, then the cafe.
      const WX = 6.6;                 // the work area starts here
      const PX0 = WX + 1.0;           // first pod
      const FY = D - 6.4;             // where the front street starts
      const MW = 6.0, MD = 5.0;       // meeting room
      const LX1 = W - 5.8;            // your desk's area runs from WX to here
      const CX0 = LX1 + 0.2;          // cafe
      cubicles(pods, PX0);
      const aisles = aislesFrom(PX0);
      const floors = [
        { kind: 'wood', x: 0, y: 0, w: W, d: D },
        { kind: 'carpet', x: 0, y: 0, w: MW, d: MD },
        { kind: 'work', x: WX, y: 0, w: W - WX, d: FY - 0.3 },
        { kind: 'tiles', x: CX0, y: FY - 0.3, w: W - CX0, d: D - FY + 0.3 },
      ];

      // ---- work area extras: server rack and printer against the back wall
      const rx = W - 1.0;
      add(rx + 0.35 + 0.5, () => this.serverRack(rx, 0.2));
      prop('rack', { x: rx, y: 0.2 });
      solid(rx, 0.2, 0.7, 0.6);
      const prx = W - 2.4;
      prop('printer', { x: prx, y: 0.25 });
      add(prx + 0.3 + 0.5, () => this.printer(prx, 0.25));
      solid(prx, 0.25, 0.75, 0.55);
      poi(prx + 0.35, 1.15, 'printer', 'back');
      // Someone who hit an error stands at the server rack, scratching their head.
      poi(rx + 0.35, 1.1, 'rack', 'back', { zone: 'error' });
      poi(prx + 0.35, 1.1, 'rack', 'back', { zone: 'error' });
      poi(rx - 0.4, 1.6, 'rack', 'back', { zone: 'error' });
      for (const [x, y] of [[WX + 0.45, FY - 0.75], [W - 0.45, FY - 0.75], [W - 0.45, 2.2]]) { add(x + y, () => this.plant(x, y)); prop('plant', { x, y }); solid(x - 0.2, y - 0.2, 0.4, 0.4); }
      // The company's name, big on the back wall over the work area.
      const logo = this.company ? { x: Math.max(WX + 0.4, (WX + W) / 2 - 1.8), w: 3.2 } : null;
      const clearOfLogo = (x) => !logo || x + 1.5 < logo.x - 0.1 || x > logo.x + logo.w + 0.1;
      const windows = [];
      for (let x = WX + 0.3; x < W - 2.7; x += 2.4) {
        if (!clearOfLogo(x)) continue;
        windows.push(x);
        poi(x + 0.75, 0.75, 'window', 'back');
      }

      // ---- the meeting room (glass on two sides, door at the front)
      const mDoor = { x0: MW - 1.4, x1: MW - 0.4 };
      for (let y = 0; y < MD - 0.01; y += 1) this.glassX(add, MW, y, Math.min(1, MD - y));
      for (const [x0, x1] of [[0, mDoor.x0], [mDoor.x1, MW]]) for (let x = x0; x < x1 - 0.01; x += 1) this.glassY(add, x, MD, Math.min(1, x1 - x));
      prop('glass', { x: MW, y: 0, w: 0, d: MD });
      prop('glass', { x: 0, y: MD, w: mDoor.x0, d: 0 });
      prop('glass', { x: mDoor.x1, y: MD, w: MW - mDoor.x1, d: 0 });
      solid(MW - 0.05, 0, 0.1, MD, 0.05);
      solid(0, MD - 0.05, mDoor.x0, 0.1, 0.05);
      solid(mDoor.x1, MD - 0.05, MW - mDoor.x1, 0.1, 0.05);
      const mtx = 1.4, mty = 1.7;
      add(mtx + 1.5 + mty + 0.7, () => this.meetingTable(mtx, mty));
      prop('meetingTable', { x: mtx, y: mty, w: 3.0, d: 1.4 });
      prop('pendant', { x: mtx + 1.5, y: mty + 0.7, span: 1.2 });
      solid(mtx, mty, 3.0, 1.4);
      for (let k = 0; k < 3; k++) {
        const cx = mtx + 0.5 + k * 1.0;
        add(cx + mty - 0.45, () => this.stool(cx, mty - 0.4, 0.4, '#555c66'));
        add(cx + mty + 1.78, () => this.stool(cx, mty + 1.8, 0.4, '#555c66'));
        poi(cx, mty - 0.4, 'meeting', 'front', { sit: 0.42, zone: 'wait' });
        prop('chair', { x: cx, y: mty - 0.4, face: 'front' });
        prop('chair', { x: cx, y: mty + 1.8, face: 'back' });
        poi(cx, mty + 1.8, 'meeting', 'back', { sit: 0.42, zone: 'wait' });
      }
      const whiteboard = { x: 1.6 };
      poi(whiteboard.x + 1.3, 0.65, 'whiteboard', 'back', { zone: 'wait' });
      // Waited long enough: stand at the glass door looking out for you.
      poi((mDoor.x0 + mDoor.x1) / 2, MD - 0.5, 'peek', 'front', { zone: 'wait', restless: true });
      poi(MW - 0.5, MD - 1.3, 'peek', 'front', { zone: 'wait', restless: true });
      add(MW - 0.45 + 0.45, () => this.plant(MW - 0.45, 0.45));
      prop('plant', { x: MW - 0.45, y: 0.45 });
      solid(MW - 0.65, 0.25, 0.4, 0.4);

      // ---- the play corner: ping-pong, foosball, vending machines
      const tx = 1.5, ty = MD + 1.1;
      add(tx + 1.3 + ty + 0.7, () => this.pingpong(tx, ty));
      prop('pingpong', { x: tx, y: ty });
      solid(tx, ty, 2.6, 1.4, 0.05);
      poi(tx - 0.55, ty + 0.7, 'pingpong', 'side', { pair: 'pp' });
      poi(tx + 3.15, ty + 0.7, 'pingpong', 'side', { pair: 'pp' });
      const pp = { x0: tx - 0.2, x1: tx + 2.8, y: ty + 0.7 };
      floors.push({ kind: 'mat', x: pp.x0 - 0.6, y: pp.y - 1.4, w: pp.x1 - pp.x0 + 1.2, d: 2.7 });
      const vy = FY - 2.1;
      add(0.5 + vy + 0.4, () => this.vending(0.12, vy, '#c0392b'));
      prop('vending', { x: 0.12, y: vy, color: '#c0392b' });
      prop('vending', { x: 0.12, y: vy + 0.8, color: '#2f6fb0' });
      add(0.5 + vy + 1.2, () => this.vending(0.12, vy + 0.8, '#2f6fb0'));
      solid(0.1, vy, 0.75, 1.55);
      poi(1.3, vy + 0.4, 'vending', 'back');
      poi(1.3, vy + 1.2, 'vending', 'back');
      const fx = 3.0, fby = vy + 0.4;
      add(fx + 0.8 + fby + 0.4, () => this.foosball(fx, fby));
      prop('foosball', { x: fx, y: fby });
      solid(fx, fby, 1.6, 0.8, 0.05);
      poi(fx - 0.45, fby + 0.4, 'foosball', 'side', { pair: 'fb' });
      poi(fx + 2.05, fby + 0.4, 'foosball', 'side', { pair: 'fb' });
      const ax = MW - 1.55, ay = MD + 2.6;
      add(ax + 0.35 + ay + 0.35, () => this.arcade(ax, ay));
      prop('arcade', { x: ax, y: ay });
      solid(ax, ay, 0.7, 0.7);
      poi(ax + 0.35, ay + 1.15, 'arcade', 'back', { zone: 'idle' });
      // A modern video slot machine, with a stool in front of it.
      const slx = MW - 0.75, sly = MD + 2.6;
      add(slx + 0.35 + sly + 0.35, () => this.slotMachine(slx, sly));
      prop('slot', { x: slx, y: sly });
      solid(slx, sly, 0.7, 0.7);
      add(slx + 0.35 + sly + 1.0 - 0.02, () => this.stool(slx + 0.35, sly + 1.0, 0.45, '#c0392b'));
      prop('barStool', { x: slx + 0.35, y: sly + 1.0 });
      poi(slx + 0.35, sly + 1.0, 'slot', 'back', { sit: 0.47, zone: 'idle', yaw: Math.PI });

      // ---- the front street, left: the phone booth
      const bx = WX - 1.6, by = FY + 0.3;
      this.booth(add, bx, by);
      prop('booth', { x: bx, y: by });
      solid(bx - 0.05, by - 0.05, 1.4, 0.1, 0.03);
      solid(bx - 0.05, by - 0.05, 0.1, 1.4, 0.03);
      solid(bx + 1.25, by - 0.05, 0.1, 1.4, 0.03);
      solid(bx + 0.85, by + 1.25, 0.5, 0.1, 0.03);
      poi(bx + 0.65, by + 0.6, 'phone', 'front', { sit: 0.45 });

      // ---- the cafe, front right: counter with its back to the work area
      const cy = FY - 0.1;
      const cw = W - CX0 - 2.0;
      longBox(CX0 + 0.9, cy, 0, cw, 0.7, 0.9, pal.counter, pal.counterL, pal.counterR, { bias: -0.5 });
      solid(CX0 + 0.9, cy, cw, 0.7);
      prop('counter', { x: CX0 + 0.9, y: cy, w: cw, d: 0.7 });
      const cfx = CX0 + 1.3, skx = CX0 + 0.9 + cw - 1.1;
      prop('coffee', { x: cfx, y: cy + 0.12 });
      prop('sink', { x: skx, y: cy + 0.12 });
      prop('fridge', { x: W - 1.0, y: cy });
      prop('cooler', { x: CX0 + 0.3, y: cy + 0.05 });
      add(cfx + 0.25 + cy + 0.35, () => this.coffeeMachine(cfx, cy + 0.12));
      add(skx + 0.25 + cy + 0.35, () => this.sink(skx, cy + 0.12));
      add(W - 0.6 + cy + 0.4, () => this.fridge(W - 1.0, cy));
      solid(W - 1.0, cy, 0.85, 0.75);
      add(CX0 + 0.5 + cy + 0.25, () => this.waterCooler(CX0 + 0.3, cy + 0.05));
      solid(CX0 + 0.25, cy, 0.5, 0.5);
      poi(cfx + 0.25, cy + 1.2, 'coffee', 'back', { zone: 'done' });
      poi(skx + 0.25, cy + 1.2, 'sink', 'back', { zone: 'done' });
      poi(W - 0.6, cy + 1.3, 'fridge', 'back', { zone: 'done' });
      poi(CX0 + 0.55, cy + 0.95, 'water', 'back', { zone: 'done' });
      const rtx = CX0 + 2.7, rty = cy + 3.4;
      add(rtx + rty, () => this.roundTable(rtx, rty));
      prop('roundTable', { x: rtx, y: rty });
      prop('pendant', { x: rtx, y: rty, span: 0 });
      solid(rtx - 0.45, rty - 0.45, 0.9, 0.9);
      for (const [sx, sy, face] of [[rtx - 1.0, rty, 'front'], [rtx + 1.0, rty, 'front'], [rtx, rty + 1.0, 'back'], [rtx, rty - 0.95, 'front']]) {
        add(sx + sy - 0.02, () => this.stool(sx, sy, 0.45, '#c9a24c'));
        poi(sx, sy, 'stool', face, { sit: 0.47, zone: 'done' });
        prop('barStool', { x: sx, y: sy });
      }
      add(W - 0.5 + D - 0.5, () => this.plant(W - 0.5, D - 0.5));
      prop('plant', { x: W - 0.5, y: D - 0.5 });
      solid(W - 0.7, D - 0.7, 0.4, 0.4);

      // ---- behind your desk, a bookcase screens the front from the desks
      const shelfX = WX + 0.5, shelfW = Math.min(3.6, LX1 - WX - 1.6), PYs = FY - 0.15;
      longBox(shelfX, PYs - 0.25, 0, shelfW, 0.45, 1.45, this.shade(pal.deskTop, -5), pal.deskL, pal.deskR, {
        extra: (x0, x1) => this.books(x0, x1, PYs + 0.2),
      });
      solid(shelfX, PYs - 0.25, shelfW, 0.45);
      prop('shelf', { x: shelfX, y: PYs - 0.25, w: shelfW, d: 0.45 });
      poi(shelfX + 1.0, PYs + 0.75, 'read', 'back', { zone: 'idle' });
      poi(shelfX + 2.4, PYs + 0.75, 'read', 'back', { zone: 'idle' });

      // ---- the lounge, front left by the front door
      const lx = 1.4, ly = FY + 0.8;
      add(lx + ly + 0.6, () => this.couch(lx, ly + 0.6));
      prop('couch', { x: lx, y: ly + 0.6, w: 2.8, d: 0.8 });
      prop('coffeeTable', { x: lx + 0.6, y: ly + 2.0, w: 1.6, d: 0.7 });
      prop('beanbag', { x: lx + 0.4, y: ly + 3.6, color: '#c96442' });
      prop('beanbag', { x: lx + 2.6, y: ly + 3.6, color: '#7d93c4' });
      solid(lx, ly + 0.6, 2.8, 0.8);
      // Sit well back on the cushions, with a way out to the front.
      for (let k = 0; k < 3; k++) { grid.soften(lx + 0.38 + k * 0.9, ly + 1.0, 0.24, 0.85); } for (let k = 0; k < 3; k++) poi(lx + 0.5 + k * 0.9, ly + 1.0, 'couch', 'front', { sit: 0.36, zone: 'idle' });
      add(lx + 1.4 + ly + 2.35, () => this.coffeeTable(lx + 0.6, ly + 2.0));
      solid(lx + 0.6, ly + 2.0, 1.6, 0.7, 0.02); // leave a way out in front of the sofa
      add(lx + 0.4 + ly + 3.6, () => this.beanbag(lx + 0.4, ly + 3.6, '#c96442'));
      add(lx + 2.6 + ly + 3.6, () => this.beanbag(lx + 2.6, ly + 3.6, '#7d93c4'));
      poi(lx + 0.4, ly + 3.6, 'beanbag', 'front', { sit: 0.18, zone: 'idle' });
      poi(lx + 2.6, ly + 3.6, 'beanbag', 'front', { sit: 0.18, zone: 'idle' });
      prop('lamp', { x: WX - 0.6, y: D - 0.5 });
      add(WX - 0.6 + D - 0.5, () => this.floorLamp(WX - 0.6, D - 0.5));
      floors.push({ kind: 'rug', x: lx - 0.3, y: ly + 0.2, w: 4.0, d: D - ly - 0.6 });

      // ---- unlocked by the office's experience (setProgress)
      const un = this.unlocks || new Set();
      // Only on floor nothing else stands on, so no path is cut off.
      const fits = (x, y, w, d) => [[x, y], [x + w, y], [x, y + d], [x + w, y + d], [x + w / 2, y + d / 2]].every(([a, b]) => !grid.blocked(a, b));
      if (un.has('plants')) {
        for (const [x, y] of [[MW - 0.45, MD + 0.5], [WX + 0.45, 2.0], [LX1 - 0.4, D - 0.5], [WX + 0.4, D - 0.5]]) {
          if (!fits(x - 0.2, y - 0.2, 0.4, 0.4)) continue;
          add(x + y, () => this.plant(x, y)); prop('plant', { x, y }); solid(x - 0.2, y - 0.2, 0.4, 0.4);
        }
      }
      if (un.has('tv')) {
        const vx = lx + 3.2, vy = ly + 2.2;
        if (fits(vx, vy, 1.1, 0.4)) {
          add(vx + 0.55 + vy + 0.2, () => this.tv(vx, vy));
          prop('tv', { x: vx, y: vy });
          solid(vx, vy, 1.1, 0.4);
          poi(vx + 0.55, Math.min(D - 0.3, vy + 1.05), 'tv', 'back', { zone: 'idle' });
        }
      }
      if (un.has('trophy') && fits(0.1, MD + 0.3, 0.45, 0.9)) {
        add(0.32 + MD + 0.75, () => this.trophyCase(0.1, MD + 0.3));
        prop('trophy', { x: 0.1, y: MD + 0.3 });
        solid(0.1, MD + 0.3, 0.45, 0.9);
        poi(0.95, MD + 0.75, 'trophy', 'back', { yaw: -Math.PI / 2 });
      }
      const neon = un.has('neon') ? { x: logo && logo.x + logo.w + 2.6 < W - 2.6 ? logo.x + logo.w + 0.3 : WX + 0.4, text: 'SHIP IT ✦' } : null;
      if (neon) prop('neon', neon);
      // A coat rack by the front door, an armchair by the lounge lamp.
      if (fits(0.2, D - 0.6, 0.5, 0.5)) { prop('coatRack', { x: 0.45, y: D - 0.35 }); add(0.45 + D - 0.35, () => this.coatRack(0.45, D - 0.35)); solid(0.25, D - 0.55, 0.4, 0.4); }
      const acx = WX - 1.75, acy = D - 1.55;
      if (fits(acx, acy, 0.8, 0.8)) {
        prop('armchair', { x: acx, y: acy });
        add(acx + 0.4 + acy + 0.4, () => this.armchair(acx, acy));
        solid(acx, acy, 0.8, 0.8);
        poi(acx + 0.4, acy + 0.4, 'couch', 'front', { sit: 0.34, zone: 'idle' });
      }

      // ---- the notice board on the left wall: whoever finishes pins a note
      let board = null;
      for (const by0 of [FY + 0.2, MD + 1.6, MD + 0.4]) {
        if (by0 + 1.6 > lift.y - 0.8) continue;
        const spot = { x: 0.8, y: by0 + 0.8 };
        if (grid.blocked(spot.x, spot.y)) continue;
        board = { y: by0, w: 1.6, spot };
        break;
      }
      if (board) prop('board', { y: board.y, w: board.w });

      // ---- your desk at the front (you sit on this side of the screen), the
      // secretary's beside it as the front desk, and a queue of whoever is
      // waiting on you.
      let boss = null, sec = null;
      const bdy = D - 1.45;
      const mid = (WX + LX1) / 2;
      for (const bdx of [mid + 0.1, mid + 0.6, mid - 0.4]) {
        const sx = bdx - 1.7;
        if (sx < 0.9 || !fits(bdx, bdy, 1.4, 0.8) || !fits(sx, bdy, 1.4, 0.8)) continue;
        if (grid.blocked(bdx + 0.7, bdy + 1.25) || grid.blocked(sx + 0.7, bdy - 0.45)) continue;
        boss = { x: bdx, y: bdy, side: 's', seat: { x: bdx + 0.7, y: bdy + 1.25 }, boss: true };
        sec = { x: sx, y: bdy, side: 'n', seat: { x: sx + 0.7, y: bdy - 0.45 }, secretary: true };
        break;
      }
      const queue = [];
      if (boss) {
        for (const dk of [boss, sec]) solid(dk.x, dk.y, 1.4, 0.8, 0.08);
        prop('bossDesk', { x: boss.x, y: boss.y });
        floors.push({ kind: 'rug', x: sec.x - 0.5, y: sec.seat.y - 0.6, w: boss.x + 1.9 - sec.x, d: D - sec.seat.y + 0.5 });
        // Line up in front of your desk, then along the floor if the way up is taken.
        let qx = boss.x + 0.7, qy = boss.y - 0.55;
        const minY = FY + 0.2;
        for (let k = 0; k < 40 && queue.length < 6; k++) {
          if (!grid.blocked(qx, qy) && qy >= minY && !(sec && Math.hypot(qx - sec.seat.x, qy - sec.seat.y) < 0.6)) queue.push({ x: qx, y: qy });
          else if (queue.length) { qx -= 0.7; continue; }
          if (qy - 0.7 >= minY && !grid.blocked(qx, qy - 0.7)) qy -= 0.7; else qx -= 0.7;
          if (qx < 0.8) break;
        }
      }
      const spots = [[WX - 0.6, FY + 2.4], [LX1 - 0.6, D - 0.6], [W - 0.9, FY + 1.6], [WX + 0.6, D - 0.6], [0.8, MD + 0.6], [WX + 0.5, 3.4],
        [W - 0.8, D - 1.8], [LX1 - 0.6, FY + 1.0], [4.6, D - 0.6]];
      this.decorate({ W, D, OW: W, PY: FY, grid, pois, prop, solid, add, spots, entry: { x: 0.4, y: D - 1.2 }, lift, seats: [...desks.map((d) => d.seat), boss && boss.seat, sec && sec.seat, ...queue].filter(Boolean) });

      // Drop someone on these to do something with their session.
      const targets = [
        { id: 'printer', x: prx + 0.35, y: 1.15, hint: '印成報告（複製）' },
        { id: 'whiteboard', x: whiteboard.x + 1.3, y: 0.65, hint: '釘到白板上' },
        { id: 'coffee', x: cfx + 0.25, y: cy + 1.2, hint: '叫它停下這一輪' },
        { id: 'door', x: 0.9, y: D - 1.2, hint: '先不顯示，有事再出現' },
      ];

      const posters = [
        { y: MD + 1.4, color: '#c96442', text: 'SHIP IT' },
        { y: MD + 2.6, color: '#10a37f', text: 'TESTS ✓' },
      ].filter((ps) => !board || ps.y + 0.9 < board.y || ps.y > board.y + board.w);
      const art = [];
      {
        let from = WX + 0.2;
        for (const wx of [...windows, W - 2.6]) {
          if (wx - from >= 1.0 && !(logo && from < logo.x + logo.w && wx > logo.x)) art.push({ x: (from + wx) / 2, w: Math.min(0.8, wx - from - 0.3) });
          from = wx + 1.5;
        }
      }
      const zones = {};
      for (const z of ZONE_ORDER) zones[z] = pois.filter((q) => q.zone === z);
      // Where each zone's floor sign goes.
      const zoneAt = {
        work: { x: aisles.length ? aisles[0].x + aisles[0].w / 2 - 0.5 : PX0 + 1.0, y: 1.0 },
        wait: { x: mtx + 1.5, y: mty + 0.7 },
        error: { x: rx - 1.0, y: 1.9 },
        done: { x: rtx - 0.3, y: rty - 1.6 },
        idle: { x: lx + 1.4, y: ly + 2.35 },
      };
      orientSeats(pois, props);
      return {
        W, D, OW: W, OD: FY - 0.3, MR: MD, PY: FY, RW: 0, grid, items, props, pois, desks, podSpots, aisles, floors, art,
        whiteboard, wallSign: { x: 0.4, text: 'MEETING' }, board, logo, windows, posters, pp, neon, boss, sec, queue, targets, lift,
        floor: 1, door: { x: 0.4, y: D - 1.2 }, zones, zoneAt, noNap: true,
      };
    }

    // ---- the second floor: hot desks, a gym, a library, a cafe and a lounge.
    // Same footprint as downstairs; you come and go by the lift.
    upstairs({ W, D, OW, OD, MR, PY, RW, pods, podCols, PODX, grid, items, props, pois, desks, add, prop, solid, poi, longBox, lift }) {
      const pal = this.pal;
      const mx = OW;
      const fits = (x, y, w, d) => [[x, y], [x + w, y], [x, y + d], [x + w, y + d], [x + w / 2, y + d / 2]].every(([a, b]) => !grid.blocked(a, b));
      const used = desks.length / 4;

      // yoga mats where a pod would be
      if (pods > used) {
        const c = used % podCols, r = Math.floor(used / podCols);
        const px = 1.3 + c * PODX, py = 2.0 + r * 4.7;
        ['#c96442', '#7fb08a', '#7d93c4'].forEach((col, i) => {
          const x = px + i * 1.05, y = py + 0.2;
          add(x + y, () => this.yogaMat(x, y, col));
          prop('yoga', { x, y, color: col });
          poi(x + 0.35, y + 0.75, 'yoga', 'front', { zone: 'idle' });
        });
      }
      // gym: two treadmills and a weight bench
      const tx = 2.4, ty = OD + 1.0;
      for (let k = 0; k < 2; k++) {
        const x = tx + k * 1.2;
        add(x + 0.35 + ty + 0.7, () => this.treadmill(x, ty));
        prop('treadmill', { x, y: ty });
        solid(x, ty, 0.7, 0.35);
        poi(x + 0.35, ty + 0.8, 'run', 'back', { zone: 'idle', lift: 0.16 });
      }
      for (let k = 0; k < 2; k++) {
        const x = tx + 2.6 + k * 1.05, y = ty + 0.1;
        add(x + y, () => this.yogaMat(x, y, k ? '#c9a24c' : '#8b6be6'));
        prop('yoga', { x, y, color: k ? '#c9a24c' : '#8b6be6' });
        poi(x + 0.35, y + 0.75, 'yoga', 'front', { zone: 'idle' });
      }
      const pp = { x0: tx - 0.2, x1: tx + 4.6, y: ty + 0.7 };
      // front corner: vending machines and foosball
      const fy = OD + 3.7;
      if (D - fy >= 2.2) {
        add(0.5 + fy + 0.4 + 2, () => this.vending(2.0, fy + 0.6, '#5f9a4c'));
        prop('vending', { x: 2.0, y: fy + 0.6, color: '#5f9a4c' });
        solid(2.0, fy + 0.6, 0.75, 0.75);
        poi(2.4, fy + 1.75, 'vending', 'back', { zone: 'idle' });
        const fx = 3.6, fby = fy + 0.6;
        add(fx + 0.8 + fby + 0.4, () => this.foosball(fx, fby));
        prop('foosball', { x: fx, y: fby });
        solid(fx, fby, 1.6, 0.8, 0.05);
        poi(fx - 0.45, fby + 0.4, 'foosball', 'side', { pair: 'fb', zone: 'idle' });
        poi(fx + 2.05, fby + 0.4, 'foosball', 'side', { pair: 'fb', zone: 'idle' });
      }
      for (const [x, y] of [[0.45, 0.45], [OW - 0.45, 0.45], [OW - 0.45, D - 0.6]]) { add(x + y, () => this.plant(x, y)); prop('plant', { x, y }); solid(x - 0.2, y - 0.2, 0.4, 0.4); }
      const logo = this.company ? { x: Math.max(0.6, OW / 2 - 1.6), w: 3.2 } : null;
      const windows = [];
      for (let x = 1.0; x < OW - 2.6; x += 2.4) { if (logo && !(x + 1.5 < logo.x - 0.1 || x > logo.x + logo.w + 0.1)) continue; windows.push(x); poi(x + 0.75, 0.75, 'window', 'back', { zone: 'idle' }); }

      // ---- library behind glass (top right)
      for (const [y, d] of [[0, 1], [1, 1], [2, 1], [3, 0.6], [4.6, MR - 4.6]]) this.glassX(add, mx, y, d);
      for (let x = mx; x < W - 0.01; x += 1) this.glassY(add, x, MR, Math.min(1, W - x));
      prop('glass', { x: mx, y: 0, w: 0, d: 3.6 });
      prop('glass', { x: mx, y: 4.6, w: 0, d: MR - 4.6 });
      prop('glass', { x: mx, y: MR, w: RW, d: 0 });
      solid(mx - 0.05, 0, 0.1, 3.6, 0.05);
      solid(mx - 0.05, 4.6, 0.1, MR - 4.6, 0.05);
      solid(mx, MR - 0.05, RW, 0.1, 0.05);
      const shX = mx + 0.4, shW = RW - 0.8;
      longBox(shX, 0.1, 0, shW, 0.45, 1.45, this.shade(pal.deskTop, -5), pal.deskL, pal.deskR, { extra: (x0, x1) => this.books(x0, x1, 0.55) });
      solid(shX, 0.1, shW, 0.45);
      prop('shelf', { x: shX, y: 0.1, w: shW, d: 0.45 });
      for (let k = 0; k < 3; k++) poi(shX + 0.8 + k * 2.0, 0.95, 'read', 'back', { zone: 'idle' });
      const sty = 2.0, stx = mx + 1.4;
      add(stx + 1.5 + sty + 0.7, () => this.meetingTable(stx, sty));
      prop('meetingTable', { x: stx, y: sty, w: 3.0, d: 1.4 });
      solid(stx, sty, 3.0, 1.4);
      for (let k = 0; k < 3; k++) {
        const cx = stx + 0.5 + k * 1.0;
        add(cx + sty - 0.45, () => this.stool(cx, sty - 0.4, 0.4, '#555c66'));
        add(cx + sty + 1.78, () => this.stool(cx, sty + 1.8, 0.4, '#555c66'));
        prop('chair', { x: cx, y: sty - 0.4, face: 'front' });
        prop('chair', { x: cx, y: sty + 1.8, face: 'back' });
        poi(cx, sty - 0.4, 'read', 'front', { sit: 0.42, zone: 'idle' });
        poi(cx, sty + 1.8, 'read', 'back', { sit: 0.42, zone: 'idle' });
      }
      add(W - 0.9 + MR - 1.0, () => this.beanbag(W - 0.9, MR - 1.0, '#7d93c4'));
      prop('beanbag', { x: W - 0.9, y: MR - 1.0, color: '#7d93c4' });
      poi(W - 0.9, MR - 1.0, 'beanbag', 'front', { sit: 0.18, zone: 'idle' });

      // ---- cafe (middle right)
      const cy = MR + 0.3;
      longBox(mx + 1.0, cy, 0, RW - 2.3, 0.7, 0.9, pal.counter, pal.counterL, pal.counterR, { bias: -0.5 });
      solid(mx + 1.0, cy, RW - 2.3, 0.7);
      prop('counter', { x: mx + 1.0, y: cy, w: RW - 2.3, d: 0.7 });
      prop('coffee', { x: mx + 2.4, y: cy + 0.12 });
      prop('fridge', { x: W - 1.15, y: cy });
      add(mx + 2.65 + cy + 0.35, () => this.coffeeMachine(mx + 2.4, cy + 0.12));
      add(W - 0.75 + cy + 0.4, () => this.fridge(W - 1.15, cy));
      solid(W - 1.15, cy, 0.85, 0.75);
      poi(mx + 2.65, cy + 1.2, 'coffee', 'back', { zone: 'idle' });
      poi(mx + 4.15, cy + 1.2, 'sink', 'back', { zone: 'idle' });
      poi(W - 0.75, cy + 1.3, 'fridge', 'back', { zone: 'idle' });
      for (const rtx of [mx + 1.9, mx + 4.9]) {
        const rty = MR + 2.9;
        add(rtx + rty, () => this.roundTable(rtx, rty));
        prop('roundTable', { x: rtx, y: rty });
      prop('pendant', { x: rtx, y: rty, span: 0 });
        solid(rtx - 0.45, rty - 0.45, 0.9, 0.9);
        for (const [sx, sy, face] of [[rtx - 0.95, rty, 'front'], [rtx + 0.95, rty, 'front'], [rtx, rty + 0.95, 'back']]) {
          if (sx > W - 0.3) continue;
          add(sx + sy - 0.02, () => this.stool(sx, sy, 0.45, '#c9a24c'));
          poi(sx, sy, 'stool', face, { sit: 0.47, zone: 'idle' });
          prop('barStool', { x: sx, y: sy });
        }
      }

      // ---- lounge (bottom right): sofa, TV, beanbags, two arcades
      const lx = mx + 0.6, ly = PY + 0.4;
      add(lx + ly + 0.6, () => this.couch(lx, ly + 0.6));
      prop('couch', { x: lx, y: ly + 0.6, w: 2.8, d: 0.8 });
      solid(lx, ly + 0.6, 2.8, 0.8);
      // Sit well back on the cushions, with a way out to the front.
      for (let k = 0; k < 3; k++) { grid.soften(lx + 0.38 + k * 0.9, ly + 1.0, 0.24, 0.85); } for (let k = 0; k < 3; k++) poi(lx + 0.5 + k * 0.9, ly + 1.0, 'couch', 'front', { sit: 0.36, zone: 'idle', sleepy: true });
      add(lx + 1.4 + ly + 2.35, () => this.coffeeTable(lx + 0.6, ly + 2.0));
      prop('coffeeTable', { x: lx + 0.6, y: ly + 2.0, w: 1.6, d: 0.7 });
      solid(lx + 0.6, ly + 2.0, 1.6, 0.7, 0.02); // leave a way out in front of the sofa
      const vx = mx + 4.1, vy = ly + 2.8;
      add(vx + 0.55 + vy + 0.2, () => this.tv(vx, vy));
      prop('tv', { x: vx, y: vy });
      solid(vx, vy, 1.1, 0.4);
      poi(vx + 0.55, Math.min(D - 0.3, vy + 1.05), 'tv', 'back', { zone: 'idle' });
      add(lx + 0.4 + ly + 3.6, () => this.beanbag(lx + 0.4, ly + 3.6, '#c96442'));
      prop('beanbag', { x: lx + 0.4, y: ly + 3.6, color: '#c96442' });
      poi(lx + 0.4, ly + 3.6, 'beanbag', 'front', { sit: 0.18, zone: 'idle' });
      for (const ay of [ly + 0.2, ly + 1.3]) {
        const ax = W - 1.2;
        if (!fits(ax, ay, 0.7, 0.7)) continue;
        add(ax + 0.35 + ay + 0.35, () => this.arcade(ax, ay));
        prop('arcade', { x: ax, y: ay });
        solid(ax, ay, 0.7, 0.7);
        poi(ax - 0.45, ay + 0.35, 'arcade', 'back', { zone: 'idle', yaw: Math.PI / 2 });
      }
      add(W - 0.5 + D - 0.5, () => this.plant(W - 0.5, D - 0.5));
      prop('plant', { x: W - 0.5, y: D - 0.5 });

      const posters = [{ y: 2.2, color: '#7fb08a', text: 'BREAK' }, { y: 4.6, color: '#7d93c4', text: 'RECHARGE' }];
      const zones = {};
      for (const z of ZONE_ORDER) zones[z] = pois.filter((q) => q.zone === z);
      const zoneAt = { work: { x: OW / 2 - 0.6, y: 1.0 }, idle: { x: lx + 1.4, y: ly + 2.35 } };
      // Drop someone on these upstairs: the cafe's coffee machine stops them, the lift hides them.
      const targets = [
        { id: 'coffee', x: mx + 2.65, y: cy + 1.2, hint: '叫它停下這一輪' },
        { id: 'door', x: lift.x + 0.35, y: lift.y, hint: '先不顯示，有事再出現' },
      ];
      this.decorate({ W, D, OW, PY, grid, pois, prop, solid, add, entry: lift, lift, seats: desks.map((d) => d.seat) });
      orientSeats(pois, props);
      const floors = [
        { kind: 'wood', x: 0, y: 0, w: W, d: D },
        { kind: 'work', x: 0, y: 0, w: OW, d: OD + 0.2 },
        { kind: 'carpet', x: OW, y: 0, w: W - OW, d: MR },
        { kind: 'tiles', x: OW, y: MR, w: W - OW, d: PY - MR },
        { kind: 'rug', x: OW + 0.3, y: PY + 0.6, w: 4.0, d: D - PY - 1.0 },
        { kind: 'mat', x: pp.x0 - 0.6, y: pp.y - 1.4, w: pp.x1 - pp.x0 + 1.2, d: 2.7 },
      ];
      const art = [];
      { let from = 0.3; for (const wx of [...windows, OW - 0.3]) { if (wx - from >= 1.0 && !(logo && from < logo.x + logo.w && wx > logo.x)) art.push({ x: (from + wx) / 2, w: Math.min(0.8, wx - from - 0.3) }); from = wx + 1.5; } }
      return { W, D, OW, OD, MR, PY, RW, grid, items, props, pois, desks, floors, art, whiteboard: null, wallSign: { x: OW + 0.5, text: 'LIBRARY' }, logo, windows, posters, pp, neon: null, boss: null, sec: null, queue: [], targets, lift, floor: 2, door: { x: lift.x, y: lift.y }, zones, zoneAt, noNap: true };
    }

    // The sign over your desk: how many are waiting in line.
    deskSign() {
      const boss = this.plan.boss;
      if (!boss) return;
      const c = this.ctx;
      this.deskSignAt(this.iso(boss.x + 0.7, Math.min(this.plan.D - 0.1, boss.y + 1.7), 0));
    }

    deskSignAt(at) {
      const c = this.ctx;
      const n = this.queueCount || 0;
      const text = (this.bossIn ? '👀 老闆在・' : '🧑‍💼 ') + (n ? `你的桌・${n} 個在等你` : '你的桌');
      c.save();
      c.font = '700 10px ui-sans-serif, system-ui, -apple-system, "PingFang TC", "Apple Color Emoji", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = c.measureText(text).width + 14;
      this.roundRect(at.x - w / 2, at.y - 9, w, 18, 9, n ? STATUS_COLOR.waiting : this.pal.tagBg);
      c.fillStyle = n ? '#fff' : this.pal.text;
      c.fillText(text, at.x, at.y + 0.5);
      c.restore();
    }

    // Signs painted on the floor naming each zone.
    zoneSigns() {
      const at = this.plan.zoneAt;
      if (!at || !this.zoneLabels) return;
      const c = this.ctx;
      const COLOR = { work: STATUS_COLOR.tool, wait: STATUS_COLOR.waiting, error: STATUS_COLOR.error, done: STATUS_COLOR.done, idle: STATUS_COLOR.idle };
      c.save();
      c.font = '700 11px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const [z, pos] of Object.entries(at)) {
        const text = this.zoneLabels[z];
        if (!text) continue;
        const pt = this.iso(pos.x, pos.y, 0);
        const w = c.measureText(text).width + 16;
        c.globalAlpha = 0.9;
        this.roundRect(pt.x - w / 2, pt.y - 9, w, 18, 9, COLOR[z]);
        c.globalAlpha = 1;
        c.fillStyle = '#fff';
        c.fillText(text, pt.x, pt.y + 0.5);
      }
      c.restore();
    }

    glassX(add, x, y, d) {
      add(x + y + d / 2 + 0.02, () => {
        const P = (a, b, c) => this.iso(a, b, c);
        this.poly([P(x, y, 0), P(x, y + d, 0), P(x, y + d, 0.22), P(x, y, 0.22)], this.pal.trim);
        this.poly([P(x, y, 0.22), P(x, y + d, 0.22), P(x, y + d, 2.1), P(x, y, 2.1)], this.pal.glass, this.pal.glassEdge);
      });
    }

    glassY(add, x, y, w) {
      add(x + w / 2 + y + 0.02, () => {
        const P = (a, b, c) => this.iso(a, b, c);
        this.poly([P(x, y, 0), P(x + w, y, 0), P(x + w, y, 0.22), P(x, y, 0.22)], this.pal.trim);
        this.poly([P(x, y, 0.22), P(x + w, y, 0.22), P(x + w, y, 2.1), P(x, y, 2.1)], this.pal.glass, this.pal.glassEdge);
      });
    }

    // ------------------------------------------------------------ sessions → people

    // `moved`: keys that just changed floors; they take the lift instead of the door.
    update(sessions, { moved = null } = {}) {
      // Replaying another page's office: people come from applyWorld().
      if (this.remote) return;
      const zoned = !!this.plan.zones;
      const viaLift = (k) => !!(moved && moved.has(k) && this.plan.lift);
      // The secretary keeps their own desk beside yours, whatever they are doing.
      const sec = this.plan.sec && this.isSecretary
        ? sessions.filter((s) => !s.subagent && this.isSecretary(s)).sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))[0]
        : null;
      this.secKey = sec ? sec.key : null;
      if (sec) sessions = sessions.filter((s) => s !== sec);
      // With zones only the ones actually working get a desk; waiting and
      // errors go to their own rooms. Scene packs keep the old rule.
      // During the stand-up nobody sits at a desk.
      const atDesk = (s) => (this.standup && zoned ? false : zoned ? zoneOf(s) === 'work' : WORKING.has(s.status));
      // The boss is in: everyone else not waiting on you pretends to work,
      // at a free desk if there is one, else somewhere that looks busy. The
      // floor is not laid out again for them.
      const pretend = this.bossIn && zoned && !this.standup ? sessions.filter((s) => !atDesk(s) && zoneOf(s) !== 'wait') : [];
      const pretendKeys = new Set(pretend.map((s) => s.key));
      this.closedNow = zoned && !this.compact && !this.bossIn && !this.standup && closing();
      const working = sessions.filter(atDesk);
      const off = sessions
        .filter((s) => !atDesk(s) && !pretendKeys.has(s.key))
        .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
      // After hours only the ones that need you stay about (and the stand-up).
      const after = (s) => this.closedNow && (zoneOf(s) === 'idle' || zoneOf(s) === 'done');
      let wanderers;
      if (zoned && this.standup) {
        // Stand-up: everyone here, workers included.
        wanderers = [...off];
      } else if (zoned && this.roam !== false) {
        // Everyone off duty is about; waiting and errors always show.
        const cap = Math.max(MAX_WANDERERS, Math.min(12, this.plan.pois.length - 6));
        wanderers = [];
        for (const z of ZONE_ORDER) {
          for (const s of off) if (zoneOf(s) === z && !after(s) && (wanderers.length < cap || z === 'wait' || z === 'error' || this.standup)) wanderers.push(s);
        }
      } else if (zoned) {
        // Fill each zone up to its seats; everyone else has gone home.
        const room = Object.fromEntries(ZONE_ORDER.map((z) => [z, this.plan.zones[z].length]));
        wanderers = [];
        for (const z of ZONE_ORDER) {
          for (const s of off) {
            if (zoneOf(s) !== z) continue;
            if (room[z] > 0 || z === 'wait' || z === 'error') { wanderers.push(s); room[z]--; }
          }
        }
      } else {
        wanderers = off.slice(0, MAX_WANDERERS);
      }
      this.offDuty = off.length - wanderers.length;
      wanderers.push(...pretend);

      const cap = this.plan.desks.length;
      this.nWorking = working.length;
      // Scene packs have a fixed floor plan; the built-in office grows with the team.
      // Grow (or shrink) the office with the team; never twice for the same headcount.
      if (!this.plan.fixed && (working.length > cap - 1 || (cap > 16 && working.length < cap * 0.35)) && this.builtFor !== working.length) {
        this.builtFor = working.length;
        this.rebuild();
      }

      const workKeys = new Set([...working, ...pretend].map((s) => s.key));
      for (const k of [...this.deskOf.keys()]) if (!workKeys.has(k)) this.deskOf.delete(k);
      const used = new Set(this.deskOf.values());
      // Fill the desks that face us first so more faces and screens show.
      const desks = this.plan.desks;
      const order = desks.map((d, i) => i).sort((a, b) => (desks[a].side === 's') - (desks[b].side === 's') || a - b);
      // Departments sit together: a newcomer takes a free desk in the pod
      // where their own repository already works, else an empty pod.
      const byKey = new Map([...working, ...pretend].map((s) => [s.key, s]));
      const byStart = (a, b) => (a.startedAt || 0) - (b.startedAt || 0);
      for (const s of [...working.sort(byStart), ...pretend.sort(byStart)]) {
        if (this.deskOf.has(s.key)) continue;
        const mine = deptOf(s);
        const podCount = new Map(); // pod -> [same dept, others]
        for (const [k, i] of this.deskOf) {
          const pod = desks[i].pod;
          if (pod == null || !byKey.has(k)) continue;
          const c = podCount.get(pod) || [0, 0];
          c[deptOf(byKey.get(k)) === mine ? 0 : 1]++;
          podCount.set(pod, c);
        }
        let best = null, bestScore = -Infinity;
        order.forEach((n, rank) => {
          if (used.has(n)) return;
          const c = podCount.get(desks[n].pod) || [0, 0];
          const score = c[0] * 10 - c[1] * 3 - rank * 0.01;
          if (score > bestScore) { best = n; bestScore = score; }
        });
        // Real work comes first: someone only pretending gives up their desk.
        if (best == null && !pretendKeys.has(s.key)) {
          const k = [...this.deskOf.keys()].find((x) => pretendKeys.has(x));
          if (k != null) { best = this.deskOf.get(k); this.deskOf.delete(k); }
        }
        if (best == null) continue;
        this.deskOf.set(s.key, best);
        used.add(best);
      }
      const takenDesks = new Set([...this.deskOf.values()].map((i) => desks[i]));

      const shown = new Set();
      if (sec) {
        shown.add(sec.key);
        let p = this.people.get(sec.key);
        if (!p) { p = this.newPerson(sec); this.people.set(sec.key, p); }
        p.s = sec;
        p.leaving = false;
        p.level = sec.level || 1;
        if (p.mode !== 'work' || p.desk !== this.plan.sec) {
          this.release(p); this.endRun(p, false); this.endVisit(p, false);
          p.mode = 'work'; p.desk = this.plan.sec; p.zone = null;
          if (!p.errand) this.goTo(p, this.plan.sec.seat);
        }
      }
      for (const s of [...working, ...wanderers]) {
        const isWorker = this.deskOf.has(s.key);
        if (!isWorker && atDesk(s)) continue; // no desk left
        shown.add(s.key);
        let p = this.people.get(s.key);
        let arrived = false;
        if (!p) {
          p = this.newPerson(s, viaLift(s.key) ? this.plan.lift : null);
          this.people.set(s.key, p);
          arrived = !this.first;
          if (viaLift(s.key) && !this.first) { this.liftOpen = Date.now(); p.event = { text: this.floor === 2 ? '上樓了' : '下樓了', at: Date.now(), zone: 'held' }; }
          else if (arrived && morning()) p.event = { text: '早安！☀️', at: Date.now(), zone: 'work' };
        }
        p.s = s;
        p.leaving = false;
        // Something happened: say it above their head for a moment.
        const nowZone = zoned ? zoneOf(s) : (isWorker ? 'work' : null);
        const started = nowZone === 'work' && (arrived || (p.lastZone && p.lastZone !== 'work'));
        const finished = p.lastZone === 'work' && (nowZone === 'done' || nowZone === 'wait');
        if (zoned && !this.first && !s.subagent && s.key !== this.secKey && (started || finished)) this.spotlight(s.key);
        if (zoned && !this.first && p.lastZone && p.lastZone !== nowZone && EVENT_TEXT[nowZone]) {
          p.event = { text: EVENT_TEXT[nowZone](s), at: Date.now(), zone: nowZone };
        }
        const wasWork = p.lastZone === 'work';
        p.lastZone = nowZone;
        // A test run, build or push just came back: cheer or facepalm.
        const o = s.outcome;
        if (o && o.at > (p.outcomeAt || 0)) {
          p.outcomeAt = o.at;
          if (Date.now() - o.at < 90_000) {
            if (o.task === 'ci' && !o.ok) this.alarmUntil = Date.now() + ALARM_MS;
            if (o.task === 'merge' && o.ok) this.confetti = { key: p.key, at: Date.now() };
          }
          const r = REACT[o.task] && REACT[o.task][o.ok ? 1 : 0];
          if (r && isWorker && Date.now() - o.at < 90_000) {
            p.react = r[0] ? { act: r[0], until: Date.now() + REACT_MS } : null;
            p.event = { text: r[1], at: Date.now(), zone: o.ok ? 'done' : 'error' };
          }
        }
        if (!this.first && s.level && p.level && s.level > p.level) {
          p.event = { text: `升等！Lv${s.level} ${LEVEL_TITLE[s.level] || ''}`, at: Date.now(), zone: 'level' };
        }
        p.level = s.level || 1;
        if (isWorker) {
          this.release(p);
          const desk = desks[this.deskOf.get(s.key)];
          if (p.desk !== desk || p.mode !== 'work') { p.desk = desk; if (!p.meeting) this.goTo(p, desk.seat); }
          p.mode = 'work';
          p.chores = null;
          p.pretend = false;
        } else {
          if (p.mode !== 'wander') { this.endRun(p, false); p.mode = 'wander'; p.desk = null; p.poi = null; p.until = 0; }
          p.react = null;
          const fake = pretendKeys.has(s.key);
          if (!!p.pretend !== fake) { p.pretend = fake; this.release(p); p.poi = null; p.until = 0; p.chores = null; }
          // Changed state: head to the new zone now.
          const zone = zoned ? zoneOf(s) : null;
          if (p.zone !== zone && !p.meeting) { p.zone = zone; this.release(p); p.poi = null; p.until = 0; p.path = []; p.chores = null; }
          // Just finished a piece of work: pin it on the notice board first.
          if (zone === 'done' && (wasWork || (arrived && viaLift(s.key))) && this.plan.board) p.chores = [this.pinStep()];
          // Someone started working at the desk this one was napping on.
          if (p.napDesk && takenDesks.has(p.napDesk)) { this.release(p); p.path = []; }
        }
      }
      if (this.standup) for (const k of shown) { const p = this.people.get(k); if (p && !p.leaving) this.standupJoin(p); }
      // Whoever waits on you lines up at your desk, longest wait first.
      const q = this.plan.queue || [];
      const waiting = [...this.people.values()]
        .filter((p) => shown.has(p.key) && !p.leaving && p.mode === 'wander' && p.zone === 'wait')
        .sort((a, b) => (a.s.lastEventAt || 0) - (b.s.lastEventAt || 0));
      waiting.forEach((p, i) => {
        const slot = i < q.length ? i : null;
        if (p.queue === slot) return;
        p.queue = slot;
        if (p.held || p.visit) return;
        this.release(p); p.poi = null; p.until = 0; p.path = [];
      });
      for (const p of this.people.values()) if (p.queue != null && !waiting.includes(p)) p.queue = null;
      this.queueCount = waiting.length;

      // Someone just messaged another session: walk over and tell them.
      for (const p of this.people.values()) {
        if (!shown.has(p.key) || p.leaving) continue;
        for (const t of (p.s.talk || [])) {
          if (t.at <= (p.talkSeen || 0)) continue;
          p.talkSeen = t.at;
          if (t.dir !== 'out' || Date.now() - t.at > 90_000) continue;
          const mate = this.people.get(t.key);
          if (mate && mate !== p && !mate.leaving && shown.has(mate.key) && !this.meet(p, mate, t.text)) this.visit(p, mate, t.text);
        }
      }
      for (const [k, p] of this.people) {
        if (!shown.has(k) && !p.leaving) {
          p.leaving = true;
          p.mode = 'leave';
          this.release(p);
          this.endRun(p, false);
          this.endVisit(p, false);
          p.desk = null;
          p.viaLift = viaLift(k);
          if (p.viaLift) p.event = { text: this.floor === 2 ? '下樓去' : '上樓去', at: Date.now(), zone: 'held' };
          this.goTo(p, p.viaLift ? this.plan.lift : this.plan.door);
        }
      }
      this.first = false;
    }

    // A new floor plan: everyone picks their desk and spot again.
    rebuild() {
      this.plan = this.buildPlan(this.nWorking || 0);
      this.deskOf.clear();
      if (this.me) {
        if (this.plan.boss) Object.assign(this.me, { x: this.plan.boss.seat.x, y: this.plan.boss.seat.y, seated: true, path: [], moving: false });
        else this.me = null;
      }
      for (const p of this.people.values()) {
        p.poi = null; p.napDesk = null; p.desk = null; p.until = 0; p.run = null;
      }
    }

    // The office's lifetime count of finished turns: furniture it has earned.
    // Returns the names of things unlocked by this call (none on the first).
    setProgress(office) {
      const turns = (office && office.turns) || 0;
      const have = new Set(UNLOCKS.filter((u) => turns >= u.at).map((u) => u.id));
      const key = [...have].join();
      if (key === this.unlockKey) return [];
      const fresh = this.unlockKey == null ? [] : UNLOCKS.filter((u) => have.has(u.id) && !this.unlocks.has(u.id)).map((u) => u.name);
      this.unlockKey = key;
      this.unlocks = have;
      if (have.has('cat2') && !this.cat2 && this.cat) {
        this.cat2 = { x: this.cat.x - 1.5, y: this.cat.y - 0.5, path: [], until: 0, face: -1, color: '#3b3b40' };
      }
      if (!this.plan.fixed) this.rebuild();
      return fresh;
    }

    release(p) {
      if (p.poi) {
        const mate = p.poi.partner && this.people.get(p.poi.partner);
        if (mate && mate.chatWith === p.key) mate.chatWith = null;
        if (p.poi.cat) { this.cat.until = Date.now() + 1500; this.catFan = null; }
        p.poi.taken = null; p.poi = null;
        // Walked off: whoever was talking to them is on their own.
        p.chatWith = null;
      }
      if (p.napDesk) { p.napDesk.napper = null; p.napDesk = null; }
    }

    newPerson(s, from = null) {
      const h = hash(s.key);
      const door = from || this.plan.door;
      return {
        key: s.key, h, s,
        skin: pick(SKIN, h, 3), hair: pick(HAIR, h, 7), pants: pick(PANTS, h, 13),
        shirt: pick(SHIRT[s.agent] || SHIRT.claude, h, 11),
        hairStyle: hairOf(h),
        phase: (h % 1000) / 1000 * Math.PI * 2,
        x: door.x, y: door.y,
        path: [], walkFace: 'front', until: 0, mode: null,
        outcomeAt: s.outcome ? s.outcome.at : 0,
        // On the first snapshot everyone is placed directly, no stampede.
        placeOnArrive: this.first,
      };
    }

    goTo(p, target) {
      if (p.placeOnArrive) {
        p.x = target.x; p.y = target.y; p.path = []; p.placeOnArrive = false;
        return;
      }
      p.path = this.plan.grid.path(p.x, p.y, target.x, target.y);
    }

    wander(p, now) {
      if (p.path.length) return;
      if (p.poi && now < p.until) return;
      this.release(p);
      const plan = this.plan;
      // At the stand-up: go to your place and stay.
      if (p.standupSpot) {
        p.poi = { ...p.standupSpot };
        p.until = Infinity;
        p.stay = Infinity;
        this.goTo(p, p.poi);
        return;
      }
      // In line at your desk.
      if (p.queue != null && plan.queue && plan.queue[p.queue]) {
        const slot = plan.queue[p.queue];
        p.poi = { x: slot.x, y: slot.y, act: 'queue', face: 'front', zone: 'wait', yaw: 0 };
        p.until = Infinity;
        p.stay = 20_000;
        this.goTo(p, slot);
        return;
      }
      // Something to do first: pin a note, fix the printer, fetch lunch.
      if (p.chores && p.chores.length) {
        const job = p.chores.shift();
        p.poi = { ...job };
        p.until = Infinity;
        p.stay = job.ms;
        if (job.text) p.event = { text: job.text, at: now, zone: 'work' };
        this.goTo(p, p.poi);
        return;
      }
      if (p.pretend) return this.pretendAt(p);
      // Waited on you for ages: come to the front and knock on the screen.
      if (plan.zones && p.zone === 'wait' && waitedMs(p.s) > KNOCK_MS) return this.knock(p);
      if (plan.zones && p.zone && this.roam !== false) return this.roamTo(p);
      if (plan.zones && p.zone) {
        // Stay inside your zone: waiting and errors stay put, the others
        // drift between the spots of their own room.
        // Move around inside the zone so it stays alive: pace at the rack,
        // fidget in the meeting room (and after 5 minutes go and look out
        // the door), drift around the pantry and the lounge.
        const waited = Date.now() - (p.s.lastEventAt || Date.now());
        const prev = p.lastPoi;
        let free = plan.zones[p.zone].filter((q) => !q.taken && (!q.restless || waited > 5 * 60_000));
        if (free.length > 1 && prev) free = free.filter((q) => q !== prev);
        if (!free.length) return;
        const restless = free.filter((q) => q.restless);
        const choice = restless.length && Math.random() < 0.5 ? restless[0] : free[Math.floor(Math.random() * free.length)];
        choice.taken = p.key;
        p.poi = choice;
        p.lastPoi = choice;
        p.until = Infinity;
        p.stay = ({ wait: choice.restless ? rand(6, 10) : rand(18, 35), error: rand(4, 8), done: rand(10, 20), idle: rand(20, 45) }[p.zone] || 20) * 1000;
        this.goTo(p, choice);
        return;
      }
      const workingDesks = new Set([...this.deskOf.values()].map((i) => plan.desks[i]));
      const sleepy = p.s.status === 'idle';
      const weighted = [];
      for (const q of plan.pois) {
        if (q.taken) continue;
        let w = 1;
        if (q.pair) w = plan.pois.some((o) => o.pair === q.pair && o !== q && o.taken) ? 7 : 1.2;
        if (q.act === 'couch' || q.act === 'beanbag' || q.sleepy) w = sleepy ? 3 : 1.4;
        weighted.push([q, w]);
      }
      for (const d of plan.noNap ? [] : plan.desks) {
        if (workingDesks.has(d) || d.napper) continue;
        weighted.push([{ x: d.seat.x, y: d.seat.y, act: 'nap', face: d.side === 'n' ? 'front' : 'back', sit: 0.34, desk: d }, sleepy ? 3 : 0.25]);
      }
      if (!weighted.length) return;
      let r = Math.random() * weighted.reduce((a, [, w]) => a + w, 0);
      let choice = weighted[0][0];
      for (const [q, w] of weighted) { r -= w; if (r <= 0) { choice = q; break; } }
      if (choice.desk) { choice.desk.napper = p.key; p.napDesk = choice.desk; }
      choice.taken = p.key;
      p.poi = choice;
      p.until = Infinity; // set on arrival
      p.stay = (choice.act === 'nap' ? rand(25, 60) : choice.act === 'pingpong' ? rand(15, 30) : rand(8, 20)) * 1000;
      this.goTo(p, choice);
    }

    // Off duty and free to go anywhere: a favourite spot for their state
    // (pantry when just done, sofa when idle, the rack when it broke, the
    // meeting room or the door when waiting on you), but also a chat with
    // whoever is standing around, the cat, the printer, a stretch.
    roamTo(p) {
      const plan = this.plan;
      const now = Date.now();
      const waited = now - (p.s.lastEventAt || now);
      const prev = p.lastPoi;
      const options = [];
      for (const q of plan.pois) {
        if (q.taken || q === prev) continue;
        if (q.restless && !(p.zone === 'wait' && waited > 5 * 60_000)) continue;
        let w = q.zone === p.zone ? 3 : q.zone === 'wait' ? 0.4 : 1;
        if (q.restless) w = 4;
        if (q.pair) w *= plan.pois.some((o) => o.pair === q.pair && o !== q && o.taken) ? 4 : 0.6;
        if (p.zone === 'idle' && night() && (q.act === 'couch' || q.act === 'beanbag')) w *= 3;
        if ((lunch() || this.cakeUntil > now) && q.act === 'stool') w *= 3;
        if (morning() && /^(coffee|water)$/.test(q.act)) w *= 3;
        for (const tr of this.traits(p)) w *= tr.likes[q.act] || 1;
        options.push([q, w]);
      }
      // Someone standing about who isn't busy talking: go and chat.
      for (const o of this.people.values()) {
        if (o === p || o.mode !== 'wander' || o.held || o.path.length || !o.poi || o.poi.sit || o.chatWith || o.poi.partner || o.poi.act === 'knock' || o.until === Infinity) continue;
        const side = Math.random() < 0.5 ? 0.75 : -0.75;
        const spot = [[o.x + side, o.y], [o.x - side, o.y], [o.x, o.y + 0.75]].find(([x, y]) => !plan.grid.blocked(x, y));
        if (spot) options.push([{ x: spot[0], y: spot[1], act: 'chat', face: 'front', partner: o.key }, 2.5 * this.traits(p).reduce((k, tr) => k * (tr.chat || 1), 1)]);
      }
      const cat = this.cat;
      if (!this.noCat && !cat.path.length && !this.catFan && !plan.grid.blocked(cat.x + 0.6, cat.y)) {
        options.push([{ x: cat.x + 0.6, y: cat.y, act: 'petcat', face: 'front', cat: true }, 1]);
      }
      for (let k = 0; k < 6 && options.length < 40; k++) {
        const x = rand(0.8, plan.W - 0.8), y = rand(1.2, plan.D - 0.8);
        if (!plan.grid.blocked(x, y)) { options.push([{ x, y, act: 'stretch', face: Math.random() < 0.5 ? 'front' : 'back' }, 0.8 * this.traits(p).reduce((k, tr) => k * (tr.stretch || 1), 1)]); break; }
      }
      if (!options.length) return;
      let r = Math.random() * options.reduce((a, [, w]) => a + w, 0);
      let choice = options[0][0];
      for (const [q, w] of options) { r -= w; if (r <= 0) { choice = q; break; } }
      choice.taken = p.key;
      if (choice.partner) {
        const o = this.people.get(choice.partner);
        o.chatWith = p.key;
        o.until = Math.max(o.until, now + 16_000);
      }
      if (choice.cat) { this.catFan = p.key; cat.until = Infinity; }
      p.poi = choice;
      if (plan.pois.includes(choice)) p.lastPoi = choice;
      p.until = Infinity;
      const base = { wait: [6, 12], error: [5, 9], done: [10, 18], idle: [15, 35] }[p.zone] || [10, 20];
      const span = { chat: [8, 14], petcat: [6, 10], stretch: [3, 5] }[choice.act] || base;
      p.stay = rand(span[0], span[1]) * 1000;
      this.goTo(p, choice);
    }

    // The front edge of the floor, right in front of you; side by side when
    // several are knocking.
    knock(p) {
      const plan = this.plan;
      const y = plan.D - 0.45;
      const taken = [...this.people.values()].filter((o) => o !== p && o.poi && o.poi.act === 'knock').map((o) => o.poi.x);
      let spot = null;
      for (let k = 0; k < 24 && !spot; k++) {
        const x = plan.W * 0.55 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.8;
        if (x < 0.6 || x > plan.W - 0.6 || plan.grid.blocked(x, y) || taken.some((t) => Math.abs(t - x) < 0.6)) continue;
        spot = { x, y };
      }
      if (!spot) return this.roam !== false ? this.roamTo(p) : undefined;
      p.poi = { ...spot, act: 'knock', face: 'front' };
      p.until = Infinity;
      p.stay = rand(30, 45) * 1000;
      this.goTo(p, spot);
    }

    // Walk over to another person and chat with them for a bit; a worker
    // then goes back to their desk.
    visit(p, mate, text) {
      if (p.held || mate.held || p.meeting || mate.meeting) return;
      const spot = this.besideOf(mate);
      this.endRun(p, false);
      this.release(p);
      if (p.visit && p.visit.mate !== mate.key) this.endVisit(p, false);
      p.visit = { mate: mate.key, x: spot.x, y: spot.y, text, until: Infinity };
      mate.chatWith = p.key;
      if (mate.mode === 'wander' && mate.until !== Infinity) mate.until = Math.max(mate.until, Date.now() + 14_000);
      p.event = { text: `去找 ${this.label(mate.s)}`.slice(0, 24), at: Date.now(), zone: 'held' };
      this.goTo(p, spot);
    }

    // One session messaged another: both go to the meeting room (or the
    // library table upstairs), sit across the table and talk it over for a
    // while, taking turns; then back to work. Returns false when there are
    // no two free chairs facing each other (then they just walk over).
    meet(p, mate, text) {
      if (p.held || mate.held || p.meeting || mate.meeting || this.standup || !this.plan.zones) return false;
      const seats = this.plan.pois.filter((q) => q.sit && (q.act === 'meeting' || q.act === 'read') && !q.taken);
      let pair = null;
      for (const a of seats) {
        const b = seats.find((o) => o !== a && Math.abs(o.x - a.x) < 0.15 && Math.abs(o.y - a.y) > 1 && o.face !== a.face);
        if (b) { pair = [a, b]; break; }
      }
      if (!pair) return false;
      [[p, pair[0], mate], [mate, pair[1], p]].forEach(([who, seat, other]) => {
        this.endRun(who, false); this.endVisit(who, false); this.release(who);
        who.chores = null;
        seat.taken = who.key;
        who.meeting = { seat, with: other.key, host: who === p, text: String(text || '').replace(/\s+/g, ' ').slice(0, 40), start: 0, until: Infinity, speaker: null, turn: 0 };
        this.goTo(who, seat);
      });
      p.event = { text: `找 ${this.label(mate.s)} 開會`.slice(0, 24), at: Date.now(), zone: 'held' };
      mate.event = { text: '好，會議室見', at: Date.now(), zone: 'held' };
      return true;
    }

    stepMeeting(p, wall) {
      const m = p.meeting;
      const other = this.people.get(m.with);
      if (!other || other.leaving || !other.meeting || other.meeting.with !== p.key) return this.endMeeting(p);
      // Pulled away (dragged, sent somewhere): walk back to the chair.
      if (!p.path.length && !p.held && !p.landed && !this.atSeat(p)) this.goTo(p, m.seat);
      if (!m.host) return; // the one who called it keeps the clock
      m.called = m.called || wall;
      // Never came together (one of them kept getting pulled away): call it off.
      if (!m.start && wall - m.called > 45_000) { this.endMeeting(other); this.endMeeting(p); return; }
      // Talk only once both are sitting in their chairs.
      if (!this.atSeat(p) || !this.atSeat(other)) {
        if (m.start) m.speaker = other.meeting.speaker = null;
        return;
      }
      if (!m.start) { m.start = other.meeting.start = wall; m.until = wall + 20_000; m.next = wall; }
      if (wall >= m.next) {
        const lines = ['我覺得可以', '那這樣改呢？', '好，就這麼辦', '我這邊來處理', '有道理', '細節我再補給你'];
        const speaker = m.turn % 2 === 0 ? p : other;
        const say = m.turn === 0 ? (m.text ? `「${m.text.length > 20 ? m.text.slice(0, 19) + '…' : m.text}」` : '來討論一下') : lines[(m.turn + p.h) % lines.length];
        speaker.event = { text: say, at: wall, zone: 'work', ttl: 3.4 };
        m.speaker = other.meeting.speaker = speaker.key;
        m.turn++;
        m.next = wall + 3600;
      }
      if (wall > m.until) { this.endMeeting(other); this.endMeeting(p); }
    }

    // End a meeting for both sides.
    endMeetingOf(p) {
      if (!p.meeting) return;
      const other = this.people.get(p.meeting.with);
      this.endMeeting(p);
      if (other && other.meeting) this.endMeeting(other);
    }

    // In their meeting chair (not on the way, not pulled off somewhere).
    atSeat(p) {
      const m = p.meeting;
      return !!m && !p.path.length && !p.held && Math.hypot(p.x - m.seat.x, p.y - m.seat.y) < 0.3;
    }

    endMeeting(p) {
      const m = p.meeting;
      if (!m) return;
      p.meeting = null;
      if (m.seat.taken === p.key) m.seat.taken = null;
      if (p.mode === 'work' && p.desk) this.goTo(p, p.desk.seat);
      else { p.until = 0; p.poi = null; }
    }

    // A message was passed from one to the other through the panel.
    relayed(fromKey, toKey, text) {
      const p = this.people.get(fromKey), mate = this.people.get(toKey);
      if (!p || !mate || p === mate || p.leaving || mate.leaving) return;
      p.landed = 0;
      this.visit(p, mate, '轉話：' + String(text || '').replace(/^〔[^〕]*〕\s*/, '').slice(0, 30));
    }

    // The visit carries on while the visitor has not arrived; once there they
    // talk for a while, then part.
    stepVisit(p, wall) {
      const v = p.visit;
      const mate = this.people.get(v.mate);
      if (!mate || mate.leaving || mate.held) return this.endVisit(p, true);
      if (p.path.length) return;
      if (v.until === Infinity) {
        // They moved on while we walked over: follow them once.
        if (Math.hypot(mate.x - v.x, mate.y - v.y) > 1.6 && !v.followed) {
          v.followed = true;
          const q = this.besideOf(mate);
          v.x = q.x; v.y = q.y;
          this.goTo(p, q);
          return;
        }
        v.until = wall + rand(8000, 11000);
        mate.chatWith = p.key;
        if (mate.mode === 'wander') mate.until = Math.max(mate.until === Infinity ? 0 : mate.until, v.until + 500);
      } else if (wall > v.until) this.endVisit(p, true);
    }

    endVisit(p, back) {
      const v = p.visit;
      if (!v) return;
      p.visit = null;
      const mate = this.people.get(v.mate);
      if (mate && mate.chatWith === p.key) mate.chatWith = null;
      if (!back) return;
      if (p.mode === 'work' && p.desk) this.goTo(p, p.desk.seat);
      else if (p.mode === 'wander') { p.until = 0; p.poi = null; }
    }

    // A worker waiting on a long command sometimes fetches a coffee, and
    // hurries back when something happens.
    coffeeRun(p, wall) {
      if (p.run) {
        if (!longRun(p.s)) return this.endRun(p, true);
        if (p.path.length) return;
        if (p.run.until === Infinity) p.run.until = wall + rand(5000, 9000);
        else if (wall > p.run.until) this.endRun(p, true);
        return;
      }
      if (!longRun(p.s) || p.path.length || Math.hypot(p.x - p.desk.seat.x, p.y - p.desk.seat.y) > 0.05) return;
      if (p.nextRun == null) p.nextRun = wall + rand(0, 60_000);
      if (wall < p.nextRun) return;
      p.nextRun = wall + rand(120_000, 240_000);
      const spots = this.plan.pois.filter((q) => !q.taken && /^(coffee|water|vending)$/.test(q.act));
      if (!spots.length) return;
      const q = spots.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      q.taken = p.key;
      p.run = { poi: q, until: Infinity };
      this.goTo(p, q);
    }

    endRun(p, back) {
      if (!p.run) return;
      if (p.run.poi.taken === p.key) p.run.poi.taken = null;
      p.run = null;
      if (back && p.desk) this.goTo(p, p.desk.seat);
    }

    // Work that sends a desk worker out for a moment, after what the
    // session is really doing: a push carries a box to the server rack,
    // reading up for a while goes to the bookshelf, a new document gets
    // printed, a new plan goes on the whiteboard. Returns true while on one.
    trip(p, wall) {
      if (p.run && p.run.trip) {
        if (p.path.length) return true;
        if (p.run.until === Infinity) p.run.until = wall + p.run.ms;
        else if (wall > p.run.until) this.endRun(p, true);
        return true;
      }
      if (p.run || p.path.length || Math.hypot(p.x - p.desk.seat.x, p.y - p.desk.seat.y) > 0.05) return false;
      const s = p.s;
      const task = s.status === 'tool' ? s.task : null;
      if (task !== p.task) { p.task = task; p.taskSince = wall; }
      const since = wall - (p.taskSince || wall), last = wall - (p.lastTrip || 0);
      let go = null;
      if (task === 'push' && p.pushSeen !== s.lastEventAt) { p.pushSeen = s.lastEventAt; go = { at: 'rack', act: 'deliver', ms: 4500, text: '送去機房 📦', carry: true }; }
      else if ((task === 'lookup' || task === 'web') && since > 20_000 && last > 240_000) go = { at: 'read', act: 'read', ms: rand(6000, 9000), text: task === 'web' ? '上網查資料…' : '翻一下文件…' };
      else if (task === 'doc' && p.docSeen !== s.lastEventAt && last > 120_000) { p.docSeen = s.lastEventAt; go = { at: 'printer', act: 'printer', ms: 4000, text: '印出來看看' }; }
      else if (task === 'plan' && wall - (p.planTrip || 0) > 360_000) { p.planTrip = wall; go = { at: 'whiteboard', act: 'whiteboard', ms: 5000, text: '排一下步驟' }; }
      if (!go) return false;
      const spots = this.plan.pois.filter((q) => !q.taken && q.act === go.at);
      if (!spots.length) return false;
      const q = spots.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      q.taken = p.key;
      p.lastTrip = wall;
      p.run = { poi: q, until: Infinity, trip: true, act: go.act, ms: go.ms, carry: !!go.carry };
      p.event = { text: go.text, at: wall, zone: 'work' };
      this.goTo(p, q);
      return true;
    }

    // Walk up to the notice board and pin a note.
    pinStep() {
      const b = this.plan.board;
      return { x: b.spot.x, y: b.spot.y, act: 'pin', face: 'back', yaw: -Math.PI / 2, ms: 3500, arrive: 'pin' };
    }

    // ------------------------------------------------------------ office life
    //
    // The day goes by on the real clock: someone fetches the lunch delivery
    // around noon, cake comes out at three; and now and then something small
    // happens that whoever is free takes care of.
    life(wall) {
      if (!this.plan.zones || this.compact || this.first || this.bossIn || this.standup || this.closedNow) return;
      if (!this.nextLife) this.nextLife = wall + rand(30_000, 70_000);
      const d = new Date(wall), h = d.getHours() + d.getMinutes() / 60, day = d.toDateString();
      if (this.floor === 1 && h >= 11.75 && h < 12.5 && this.lunchDay !== day && this.chore('delivery')) this.lunchDay = day;
      if (h >= 15 && h < 15.5 && this.teaDay !== day && this.chore('tea')) this.teaDay = day;
      if (wall < this.nextLife) return;
      this.nextLife = wall + rand(180_000, 420_000);
      this.chore(pick(['jam', 'refill', 'plants', 'plants'], Math.floor(wall / 1000), 1));
    }

    // Sends someone who is free (resting or just done) off to do `kind`.
    // Returns false when nobody is free or the floor has no place for it.
    chore(kind) {
      const plan = this.plan;
      const free = [...this.people.values()].filter((p) => p.mode === 'wander' && !p.leaving && !p.held && !p.visit && !p.meeting && !(p.chores && p.chores.length)
        && p.queue == null && (p.zone === 'idle' || p.zone === 'done') && p.key !== this.secKey);
      if (!free.length) return false;
      const tidy = free.filter((o) => this.traits(o).some((tr) => tr.tidy));
      const pool = tidy.length && Math.random() < 0.75 ? tidy : free;
      const p = pool[Math.floor(Math.random() * pool.length)];
      const poiOf = (act) => plan.pois.find((q) => q.act === act);
      const near = (x, y) => [[0.7, 0.7], [-0.7, 0.7], [0.75, 0], [0, 0.75], [-0.75, 0], [0, -0.75]]
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((o) => !plan.grid.blocked(o.x, o.y) && o.x > 0.3 && o.y > 0.3 && o.x < plan.W - 0.3 && o.y < plan.D - 0.3);
      const table = plan.props.find((o) => o.t === 'roundTable');
      let steps = null;
      if (kind === 'jam' && poiOf('printer')) {
        const q = poiOf('printer');
        steps = [{ x: q.x, y: q.y, act: 'fix', face: q.face, ms: 6000, text: '印表機又卡紙了…', arrive: 'jam' }];
        this.jamUntil = Infinity;
      } else if (kind === 'refill' && poiOf('coffee')) {
        const q = poiOf('coffee');
        steps = [{ x: q.x, y: q.y, act: 'refill', face: q.face, ms: 5000, text: '咖啡豆沒了，我來補' }];
      } else if (kind === 'plants') {
        steps = plan.props.filter((o) => o.t === 'plant').map((o) => near(o.x, o.y)).filter(Boolean).slice(0, 2)
          .map((o, i) => ({ ...o, act: 'waterplant', face: 'back', ms: 3500, text: i ? null : '澆個花 🌱' }));
        if (!steps.length) steps = null;
      } else if (kind === 'delivery' && table && near(table.x, table.y)) {
        const door = plan.door;
        steps = [
          { x: door.x + 0.5, y: door.y, act: 'peek', face: 'front', ms: 3000, text: '外送到了！' },
          { ...near(table.x, table.y), act: 'unpack', face: 'back', ms: 4000, text: '午餐來囉 🍱', carry: true, arrive: 'lunch' },
        ];
      } else if (kind === 'tea' && table && near(table.x, table.y)) {
        const f = poiOf('fridge');
        steps = [
          ...(f ? [{ x: f.x, y: f.y, act: 'fridge', face: f.face, ms: 2500, text: '下午茶時間 🍰' }] : []),
          { ...near(table.x, table.y), act: 'unpack', face: 'back', ms: 3500, text: f ? null : '下午茶時間 🍰', carry: true, arrive: 'cake' },
        ];
      }
      if (!steps) return false;
      p.chores = steps;
      this.release(p); p.poi = null; p.until = 0; p.path = [];
      return true;
    }

    // Something a chore changed when they got there.
    lifeMark(what, wall, stay, p) {
      if (what === 'jam') this.jamUntil = wall + stay;
      if (what === 'pin') { this.pinnedAt = wall; p.event = { text: '貼上佈告欄 📌', at: wall, zone: 'done' }; }
      if (what === 'lunch') this.lunchUntil = wall + 75 * 60_000;
      if (what === 'cake') this.cakeUntil = wall + 40 * 60_000;
    }

    traits(p) { return p.traits || (p.traits = traitsOf(p.key)); }

    // What someone sitting off duty is doing right now. Someone else sitting
    // close by makes a chat (or a laugh) likelier; a long-idle one dozes off
    // on the sofa now and then.
    seatAct(p, q) {
      const list = SEAT_ACTS[q.act];
      const t = (this.t || 0) / 1000 + p.phase * 13;
      const span = 7 + (p.h % 4);
      let act = list[Math.floor(t / span + p.h) % list.length];
      // Every other turn, something they like doing.
      const own = this.traits(p).flatMap((tr) => tr.seat);
      if (own.length && Math.floor(t / span) % 2 === 1) act = own[Math.floor(t / span / 2) % own.length];
      const company = [...this.people.values()].some((o) => o !== p && o.poi && o.poi.sit && !o.path.length && Math.hypot(o.x - p.x, o.y - p.y) < 2.2);
      if (act === 'chat' && !company) act = 'scroll';
      if (company && act === 'scroll' && (Math.floor(t / span) % 3) === 0) act = 'chat';
      if (q.act === 'couch' && p.s && p.s.status === 'idle' && (Math.floor(t / span) % 4) === 3) act = 'nap';
      return act;
    }

    // Someone in the way just ahead: coming toward you, both keep right;
    // standing there, step round them; going the same way, slow down behind
    // them. Stuck more than a second and a half: carry on anyway. Returns
    // how far to move along the path this frame (and may nudge sideways).
    makeWay(p, ux, uy, v, dt) {
      let block = null, bd = 0.6;
      for (const o of this.bodies()) {
        if (o === p || o.held || o.leaving) continue;
        if (o.pose === 'sit' || (o.me && o.seated)) continue;
        const ox = o.x - p.x, oy = o.y - p.y, dist = Math.hypot(ox, oy);
        if (dist > bd || dist < 1e-3) continue;
        const along = ox * ux + oy * uy, side = Math.abs(ox * uy - oy * ux);
        if (along < 0.05 || side > 0.38) continue;
        block = o; bd = dist;
      }
      if (!block) { p.stuck = 0; return v; }
      p.stuck = (p.stuck || 0) + dt;
      if (p.stuck > 1.5) return v;
      const moving = !!(block.path && block.path.length) || block.moving;
      let headOn = false;
      if (moving && block.path && block.path.length) {
        const n = block.path[0], bx = n.x - block.x, by = n.y - block.y, bl = Math.hypot(bx, by) || 1;
        headOn = (bx * ux + by * uy) / bl < -0.3;
      }
      if (moving && !headOn) return v * 0.25; // follow behind
      // Step to the right of where you are going (round them).
      const rx = -uy, ry = ux, step = SPEED * dt * 0.9;
      const grid = this.plan.grid;
      for (const sgn of [1, -1]) {
        const nx = p.x + rx * step * sgn, ny = p.y + ry * step * sgn;
        if (!grid.hard(nx, ny)) { p.x = nx; p.y = ny; break; }
      }
      return v * 0.5;
    }

    // Double-clicked: they jump, wave or say what they are up to.
    poke(p) {
      const now = Date.now();
      if (now - (p.pokedAt || 0) > 8000) p.pokes = 0; // forgiven after a while
      p.pokedAt = now;
      const n = (p.pokes = (p.pokes || 0) + 1);
      const doing = this.doing && p.s && p.mode === 'work' ? this.doing(p.s) : '';
      const lines = ['嚇我一跳！', '嗨～', doing ? `在${doing}啦` : '在休息啦', '幹嘛～', '別戳了啦'];
      const text = n >= 4 ? '別再戳了 😤' : lines[(p.h + n) % lines.length];
      p.poke = { act: n >= 4 ? 'facepalm' : ['dazed', 'wave', 'cheer'][(p.h + n) % 3], until: now + 2200 };
      p.event = { text, at: now, zone: 'held' };
    }

    // A merged PR: confetti bursting over them, in screen pixels at (cx, cy).
    drawConfetti(cx, cy, age) {
      const c = this.ctx, colors = ['#e0344b', '#ffd23f', '#3b8ee0', '#22a874', '#8b6be6', '#ff8c42'];
      const e = age / 1000;
      c.save();
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalAlpha = Math.max(0, Math.min(1, (CONFETTI_MS - age) / 800));
      for (let i = 0; i < 90; i++) {
        const a = (i * 2.399) % (Math.PI * 2), sp = 90 + (i * 37) % 140;
        const x = cx + Math.cos(a) * sp * e * 0.9 + Math.sin(e * 6 + i) * 6;
        const y = cy - 30 + (-Math.abs(Math.sin(a)) * sp * 1.2 * e + 160 * e * e);
        c.fillStyle = colors[i % colors.length];
        c.save(); c.translate(x, y); c.rotate(e * 8 + i); c.fillRect(-2.5, -1.2, 5, 2.4); c.restore();
      }
      c.restore();
    }

    // ------------------------------------------------------------ stand-up
    //
    // Everyone (but the secretary, who keeps the minutes at their desk) walks
    // to the meeting room, sits round the table or stands round it, and one
    // by one says where they are; `lineOf(s)` is what they say. When the
    // last one has spoken, `done(lines)` gets the minutes and everyone goes
    // back to what they were doing. Returns false when nobody is here.
    startStandup(lineOf, done) {
      if (!this.plan.zones || this.standup) return false;
      const who = [...this.people.values()].filter((p) => !p.leaving && !p.held && p.s && !p.s.subagent && p.key !== this.secKey);
      if (!who.length) return false;
      const plan = this.plan;
      const table = plan.props.find((o) => o.t === 'meetingTable') || plan.props.find((o) => o.t === 'roundTable');
      const cx = table ? table.x + (table.w || 0) / 2 : plan.W / 2, cy = table ? table.y + (table.d || 0) / 2 : plan.D / 2;
      const faceTo = (x, y) => ({ face: y < cy ? 'front' : 'back', yaw: Math.atan2(cx - x, cy - y) });
      const spots = plan.pois.filter((q) => q.act === 'meeting').map((q) => ({ x: q.x, y: q.y, sit: q.sit, ...faceTo(q.x, q.y) }));
      for (let r = 2.1; spots.length < 30 && r < 6; r += 0.8) {
        for (let a = 0; a < 16 && spots.length < 30; a++) {
          const x = cx + Math.cos(a / 16 * Math.PI * 2) * r * 1.2, y = cy + Math.sin(a / 16 * Math.PI * 2) * r;
          if (x < 0.4 || y < 0.4 || x > plan.W - 0.4 || y > plan.D - 0.4 || plan.grid.blocked(x, y)) continue;
          if (spots.some((o) => Math.hypot(o.x - x, o.y - y) < 0.7)) continue;
          spots.push({ x, y, sit: 0, ...faceTo(x, y) });
        }
      }
      const now = Date.now();
      who.forEach((p, i) => {
        this.endRun(p, false); this.endVisit(p, false); this.endMeetingOf(p); this.release(p);
        p.chores = null; p.react = null;
        p.standupSpot = spots[i] || null;
        p.poi = null; p.until = 0; p.path = [];
        if (p.mode === 'work') { p.mode = 'wander'; p.desk = null; }
      });
      this.standup = { order: who.map((p) => p.key), spots, i: -1, next: now + STANDUP_GATHER_MS, lines: [], lineOf, done, speaker: null };
      return true;
    }

    // Someone came down for the stand-up after it started: they join in.
    standupJoin(p) {
      const su = this.standup;
      if (!su || p.standupSpot || su.order.includes(p.key) || !p.s || p.s.subagent || p.key === this.secKey) return;
      const spot = su.spots[su.order.length];
      su.order.push(p.key);
      if (!spot) return;
      this.endRun(p, false); this.release(p);
      p.chores = null; p.standupSpot = spot; p.poi = null; p.until = 0; p.path = [];
    }

    stepStandup(wall) {
      const su = this.standup;
      if (!su || wall < su.next) return;
      su.speaker = null;
      for (su.i++; su.i < su.order.length; su.i++) {
        const p = this.people.get(su.order[su.i]);
        if (!p || p.leaving) continue;
        const line = String((su.lineOf ? su.lineOf(p.s) : null) || p.s.status || '');
        su.lines.push({ key: p.key, line });
        su.speaker = p.key;
        p.event = { text: line.length > 30 ? line.slice(0, 29) + '…' : line, at: wall, zone: 'work', ttl: STANDUP_TURN_MS / 1000 };
        su.next = wall + STANDUP_TURN_MS;
        return;
      }
      this.endStandup();
    }

    endStandup() {
      const su = this.standup;
      if (!su) return;
      this.standup = null;
      for (const p of this.people.values()) {
        if (!p.standupSpot) continue;
        p.standupSpot = null;
        this.release(p); p.poi = null; p.until = 0;
      }
      if (su.done) su.done(su.lines);
    }

    // After hours: the room goes dark except a pool of lamp light round
    // everyone still at a desk.
    nightShade() {
      const c = this.ctx;
      if (!this.shadeCv) this.shadeCv = document.createElement('canvas');
      const sc = this.shadeCv;
      if (sc.width !== this.cw || sc.height !== this.ch) { sc.width = this.cw; sc.height = this.ch; }
      const g = sc.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, sc.width, sc.height);
      g.fillStyle = 'rgba(6, 10, 30, 0.5)';
      g.fillRect(0, 0, sc.width, sc.height);
      g.globalCompositeOperation = 'destination-out';
      const z = this.cam.zoom;
      for (const p of this.bodies()) {
        if (!((p.mode === 'work' && p.desk) || (p.me && p.seated)) || p.path.length) continue;
        const at = this.iso(p.x, p.y, 0.6), x = at.x * z + this.cam.ox, y = at.y * z + this.cam.oy, r = 70 * z;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      c.save();
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.drawImage(sc, 0, 0, this.cw, this.ch);
      c.restore();
    }

    // ------------------------------------------------------------ you
    //
    // Your own person, at your desk downstairs. W A S D walk (in the
    // directions of the screen), Space opens the session of whoever you
    // are standing next to, R sits you back down.
    meOn() {
      if (this.me || !this.plan.boss || this.compact) return this.me;
      const seat = this.plan.boss.seat;
      this.me = {
        me: true, key: 'me', h: 7, x: seat.x, y: seat.y, path: [], phase: 0.5, walkFace: 'back', seated: true, moving: false,
        skin: SKIN[1], hair: HAIR[0], pants: '#2c2c34', shirt: '#2f3a52', hairStyle: 1,
        s: { key: 'me', agent: 'claude', status: 'idle', title: '你', level: 4 },
      };
      this.meKeys = new Set();
      return this.me;
    }

    // Everyone drawn: the sessions, and you.
    bodies() {
      const out = [...this.people.values()];
      if (this.me) out.push(this.me);
      if (this.visitors) out.push(...this.visitors.values());
      return out;
    }

    // ------------------------------------------------------------ visitors
    //
    // Someone from outside (src/visitors.js) walks in at the door, goes to
    // the secretary's desk (or yours), says what they came about, gets an
    // answer and leaves. `list` is the snapshot's recent visits; each shows
    // once, and only if it is fresh. Returns how many walked in.
    visitorsIn(list) {
      if (this.remote) return 0; // the host's visitors come with its world
      this.visitors = this.visitors || new Map();
      this.visitorSeen = this.visitorSeen || new Set();
      let n = 0;
      for (const v of list || []) {
        if (this.visitorSeen.has(v.id)) continue;
        this.visitorSeen.add(v.id);
        if (this.first || !this.plan.zones || this.compact || !this.plan.boss) continue;
        if (Date.now() - v.at > 3 * 60_000) continue;
        if (v.kind === 'reply') { this.seeOff(v); continue; }
        if (this.visitors.size >= 4) continue;
        this.spawnVisitor(v);
        n++;
      }
      return n;
    }

    spawnVisitor(v) {
      const plan = this.plan, door = plan.door;
      const sec = this.secKey && this.people.get(this.secKey);
      const desk = sec ? plan.sec : plan.boss;
      // In front of the desk, on the far side from the one sitting there.
      const cands = [[desk.x + 0.7, desk.y + 1.35], [desk.x + 0.7, desk.y - 0.6], [desk.x - 0.4, desk.y + 0.4], [desk.x + 1.8, desk.y + 0.4]];
      const at = cands.map(([x, y]) => ({ x, y })).find((q) => !plan.grid.blocked(q.x, q.y) && !plan.grid.hard(q.x, q.y)) || (plan.queue && plan.queue[0]) || door;
      const h = hash(v.id);
      const key = `visitor:${v.id}`;
      const masked = !!this.masked;
      const body = {
        visitor: true, key, conv: v.conv || v.id, h, x: door.x, y: door.y, path: plan.grid.path(door.x, door.y, at.x, at.y), walkFace: 'front',
        phase: (h % 1000) / 1000 * Math.PI * 2, skin: pick(SKIN, h, 3), hair: pick(HAIR, h, 7), pants: '#3b3f4a', shirt: pick(['#8a8f98', '#6f7d8c', '#9c8f7a', '#7f8c6a'], h, 5), hairStyle: hairOf(h),
        stage: 'in', until: 0, spot: at, desk, text: masked ? '有事來找' : v.text || '有事來找',
        s: { key, agent: 'claude', status: 'idle', title: masked ? '訪客' : `訪客・${v.from}`, level: 2, visitor: true },
      };
      body.event = { text: masked ? '你好～' : `你好，我是${v.from}`.slice(0, 18), at: Date.now(), zone: 'held' };
      this.visitors.set(key, body);
    }

    // Your bot answered someone (src/visitors.js reply): the secretary walks
    // them to the door and waves them off, then goes back to their desk. A
    // visitor from that conversation still here leaves with them.
    seeOff(v) {
      const sec = this.secKey && this.people.get(this.secKey);
      if (!sec || sec.leaving || sec.held || sec.seeOff) return false;
      const door = this.plan.door;
      const spot = [[0.8, 0], [0.8, -0.6], [0.8, 0.6], [1.3, 0]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((q) => !this.plan.grid.hard(q.x, q.y)) || door;
      sec.seeOff = { stage: 'go', until: 0, to: this.masked ? '訪客' : v.from };
      sec.event = { text: '我送一下客', at: Date.now(), zone: 'held' };
      this.goTo(sec, spot);
      for (const vis of (this.visitors || new Map()).values()) {
        if (vis.conv === (v.conv || v.id) && vis.stage !== 'out') { vis.until = 0; vis.stage = 'talk'; vis.replyAt = 0; }
      }
      return true;
    }

    stepSeeOff(p, wall) {
      const s = p.seeOff;
      if (p.path.length) return;
      if (s.stage === 'go') {
        s.stage = 'bye';
        s.until = wall + 3500;
        p.event = { text: `慢走～已回覆${s.to ? ` ${s.to}` : ''}`.slice(0, 24), at: wall, zone: 'done' };
      } else if (s.stage === 'bye' && wall > s.until) {
        p.seeOff = null;
        if (p.desk) this.goTo(p, p.desk.seat);
      }
    }

    stepVisitors(dt) {
      if (!this.visitors || !this.visitors.size) return;
      const now = Date.now(), door = this.plan.door;
      for (const [k, p] of this.visitors) {
        if (p.path.length) {
          const n = p.path[0], dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
          let v = SPEED * dt;
          if (d > 0.001) { p.walkFace = dx + dy >= 0 ? 'front' : 'back'; v = this.makeWay(p, dx / d, dy / d, v, dt); }
          if (d <= v) { p.x = n.x; p.y = n.y; p.path.shift(); } else { p.x += dx / d * v; p.y += dy / d * v; }
          continue;
        }
        if (p.stage === 'in') {
          p.stage = 'talk';
          p.until = now + 9000;
          p.event = { text: `「${p.text.length > 22 ? p.text.slice(0, 21) + '…' : p.text}」`, at: now, zone: 'work', ttl: 6 };
          p.replyAt = now + 2500;
        } else if (p.stage === 'talk') {
          if (p.replyAt && now > p.replyAt) {
            p.replyAt = 0;
            const host = this.secKey && this.people.get(this.secKey);
            if (host && !host.leaving) host.event = { text: '收到，我來處理 👍', at: now, zone: 'done' };
          }
          if (now > p.until) { p.stage = 'out'; p.event = { text: '謝啦～', at: now, zone: 'held' }; p.path = this.plan.grid.path(p.x, p.y, door.x, door.y); }
        } else if (p.stage === 'out') {
          this.visitors.delete(k);
        }
      }
    }

    // Screen directions on the floor (unit vectors in floor x/y): right and up.
    screenAxes() { const k = Math.SQRT1_2; return { right: { x: k, y: -k }, up: { x: -k, y: -k } }; }

    meKey(key, down) {
      if (this.readOnly || this.remote) return false;
      const me = this.meOn();
      if (!me) return false;
      const k = key.toLowerCase();
      if ('wasd'.includes(k) && k.length === 1) { if (down) this.meKeys.add(k); else this.meKeys.delete(k); return true; }
      if (!down) return false;
      if (k === 'r') { me.path = this.plan.grid.path(me.x, me.y, this.plan.boss.seat.x, this.plan.boss.seat.y); me.homing = true; return true; }
      if (k === ' ' || k === 'e') { const p = this.meNear(); if (p) this.onHover(p.s, null, true); return !!p; }
      return false;
    }

    // Who you are standing next to.
    meNear() {
      const me = this.me;
      if (!me || me.seated) return null;
      let best = null, d = 1.4;
      for (const p of this.people.values()) {
        if (p.leaving) continue;
        const k = Math.hypot(p.x - me.x, p.y - me.y);
        if (k < d) { d = k; best = p; }
      }
      return best;
    }

    stepMe(dt) {
      const me = this.me;
      if (!me) return;
      const keys = this.meKeys;
      let dx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), dy = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
      const grid = this.plan.grid;
      const sig = [...keys].sort().join('');
      if (sig !== me.keySig) { me.keySig = sig; me.detour = null; } // a new direction: a new way round
      if (dx || dy) {
        me.path = []; me.homing = false; me.seated = false;
        const ax = this.screenAxes();
        let vx = ax.right.x * dx + ax.up.x * dy, vy = ax.right.y * dx + ax.up.y * dy;
        const n = Math.hypot(vx, vy) || 1, v = SPEED * 1.3 * dt;
        vx = vx / n * v; vy = vy / n * v;
        const ok = (x, y) => x > 0.15 && y > 0.15 && x < this.plan.W - 0.15 && y < this.plan.D - 0.08 && !grid.hard(x, y);
        me.walkFace = vx + vy >= 0 ? 'front' : 'back';
        me.moving = true;
        // Already walking round something toward where the keys point.
        if (me.detour && me.detour.length) {
          const n = me.detour[0], ddx = n.x - me.x, ddy = n.y - me.y, d = Math.hypot(ddx, ddy), sp = SPEED * 1.3 * dt;
          if (d <= sp) { me.x = n.x; me.y = n.y; me.detour.shift(); } else { me.x += ddx / d * sp; me.y += ddy / d * sp; }
          return;
        }
        if (ok(me.x + vx, me.y + vy)) { me.x += vx; me.y += vy; me.blockedFor = 0; return; }
        if (ok(me.x + vx, me.y)) { me.x += vx; me.blockedFor = 0; return; }
        if (ok(me.x, me.y + vy)) { me.y += vy; me.blockedFor = 0; return; }
        // Boxed in (a desk ahead, a wall behind): find open floor that way and
        // walk round to it.
        me.blockedFor = (me.blockedFor || 0) + dt;
        if (me.blockedFor < 0.12) return;
        me.blockedFor = 0;
        const ux = vx / v, uy = vy / v;
        for (const r of [1.2, 1.8, 2.5]) {
          for (const side of [0, 0.5, -0.5, 1, -1]) {
            const gx = me.x + (ux - uy * side) * r, gy = me.y + (uy + ux * side) * r;
            if (!ok(gx, gy) || grid.blocked(gx, gy)) continue;
            const way = grid.path(me.x, me.y, gx, gy);
            if (way.length) { me.detour = way; return; }
          }
        }
        return;
      }
      if (me.path.length) {
        const nx = me.path[0], ddx = nx.x - me.x, ddy = nx.y - me.y, d = Math.hypot(ddx, ddy), v = SPEED * dt;
        me.walkFace = ddx + ddy >= 0 ? 'front' : 'back';
        if (d <= v) { me.x = nx.x; me.y = nx.y; me.path.shift(); } else { me.x += ddx / d * v; me.y += ddy / d * v; }
        me.moving = true;
        return;
      }
      me.moving = false;
      if (me.homing) { me.homing = false; me.seated = true; }
    }

    // No desk while the boss is in: somewhere that looks like work.
    pretendAt(p) {
      const plan = this.plan;
      const LOOKS_BUSY = { whiteboard: 'whiteboard', printer: 'printer', read: 'read', phone: 'phone', meeting: 'typefast', stool: 'typefast', couch: 'typefast', beanbag: 'typefast' };
      const free = plan.pois.filter((q) => !q.taken && LOOKS_BUSY[q.act])
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 4);
      let q = free[Math.floor(Math.random() * free.length)];
      if (q) p.pretendAct = LOOKS_BUSY[q.act];
      else {
        // Nothing left: stand somewhere holding a clipboard.
        for (let k = 0; k < 12 && !q; k++) {
          const x = rand(0.8, plan.W - 0.8), y = rand(1.2, plan.D - 0.8);
          if (!plan.grid.blocked(x, y)) q = { x, y, act: 'clipboard', face: 'front' };
        }
        if (!q) return;
        p.pretendAct = 'clipboard';
      }
      q.taken = p.key;
      p.poi = q;
      p.until = Infinity;
      p.stay = Infinity;
      this.goTo(p, q);
    }

    // ------------------------------------------------------------ the boss
    //
    // You say the boss walked in: everyone runs back to a desk and looks
    // busy (the ones waiting on you stay in line at your desk). The boss
    // leaves: back to whatever they were doing. The page calls update()
    // right after, which hands out the desks.
    setBoss(on) {
      on = !!on;
      if (on === !!this.bossIn) return;
      this.bossIn = on;
      if (this.first) return;
      const now = Date.now();
      let i = 0;
      for (const p of this.people.values()) {
        if (p.leaving || p.held) continue;
        p.rush = now + RUSH_MS;
        if (on) { p.chores = null; this.endVisit(p, false); this.endRun(p, false); this.endMeetingOf(p); }
        if ((p.h + i++) % 3 !== 0) p.event = { text: pick(on ? BOSS_IN : BOSS_OUT, p.h, 17), at: now, zone: on ? 'error' : 'done' };
      }
    }

    // ------------------------------------------------------------ spotlight
    //
    // Someone starts working or finishes: the camera zooms in on them and
    // follows them for a few seconds, then goes back. One at a time; the
    // newest few wait their turn. `follow` turns it off.
    spotlight(key, force = false) {
      if ((!force && this.follow === false) || this.compact || !this.visible) return;
      const now = Date.now();
      this.spotSeen = this.spotSeen || new Map();
      if (!force && now - (this.spotSeen.get(key) || 0) < SPOT_AGAIN_MS) return;
      this.spotSeen.set(key, now);
      this.spotQ = (this.spotQ || []).filter((k) => k !== key).concat(key).slice(-3);
    }

    // Who the camera is on right now, or null.
    spotPerson() {
      const now = Date.now();
      const alive = (p) => p && !p.leaving && !p.held;
      if (this.spot && now < this.spot.until && alive(this.people.get(this.spot.key))) return this.people.get(this.spot.key);
      this.spot = null;
      while (this.spotQ && this.spotQ.length) {
        const k = this.spotQ.shift(), p = this.people.get(k);
        if (alive(p)) { this.spot = { key: k, until: now + SPOT_MS }; return p; }
      }
      return null;
    }

    // You moved the camera yourself: drop the spotlight and what was queued.
    spotCancel() { this.spot = null; this.spotQ = []; }

    // The part of the canvas you can actually see (the page may be scrolled):
    // its size and its centre, in canvas pixels. The spotlight puts them a
    // little below the centre so their speech bubble fits above.
    spotFrame() {
      const whole = { x: this.cw / 2, y: this.ch / 2 + 18, w: this.cw, h: this.ch };
      const r = this.canvas && this.canvas.getBoundingClientRect && this.canvas.getBoundingClientRect();
      const vw = typeof innerWidth === 'number' ? innerWidth : 0, vh = typeof innerHeight === 'number' ? innerHeight : 0;
      if (!r || !r.height || !vw || !vh) return whole;
      const top = Math.max(r.top, 0), bot = Math.min(r.bottom, vh), left = Math.max(r.left, 0), right = Math.min(r.right, vw);
      if (bot - top < 120 || right - left < 160) return whole;
      return { x: (left + right) / 2 - r.left, y: (top + bot) / 2 - r.top + 18, w: right - left, h: bot - top };
    }

    // On leave (src/progress.js onLeave): regulars not seen today get a free
    // desk downstairs with a sign on it; when one of them is
    // back, they say so.
    setLeave(list) {
      list = this.plan.zones && this.plan.floor !== 2 && !this.compact ? list || [] : [];
      this.leaveKeys = this.leaveKeys || new Set();
      for (const k of this.leaveKeys) {
        const p = this.people.get(k);
        if (p && !list.some((x) => x.key === k)) p.event = { text: '休假回來了！🏖️', at: Date.now(), zone: 'done' };
      }
      this.leaveKeys = new Set(list.map((x) => x.key));
      const used = new Set(this.deskOf.values());
      const free = this.plan.desks.map((d, i) => i).filter((i) => !used.has(i));
      const keep = new Map();
      for (const [k, i] of this.leaveAt || []) if (this.leaveKeys.has(k) && free.includes(i)) keep.set(k, i);
      for (const x of list) {
        if (keep.has(x.key)) continue;
        const i = free.find((n) => ![...keep.values()].includes(n));
        if (i == null) break;
        keep.set(x.key, i);
      }
      this.leaveAt = keep;
      this.leaveInfo = new Map(list.map((x) => [x.key, x]));
    }

    // Desk -> who is on leave there.
    leaveDesk(dk) {
      if (!this.leaveAt) return null;
      const i = this.plan.desks.indexOf(dk);
      for (const [k, n] of this.leaveAt) if (n === i) return this.leaveInfo.get(k);
      return null;
    }

    // The sign on a desk of someone on leave, at screen point (x, y).
    leaveSign(x, y, who) {
      const c = this.ctx;
      const name = (this.label ? this.label({ key: who.key, title: who.title }) : who.title).slice(0, 12);
      const text = `🏖️ 休假中・${name}${who.days > 1 ? `（第 ${who.days} 天）` : ''}`;
      c.save();
      c.font = '700 9px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = c.measureText(text).width + 12;
      c.globalAlpha = 0.9;
      this.roundRect(x - w / 2, y - 7, w, 14, 4, '#f3e3c3', '#c9a46a');
      c.globalAlpha = 1;
      c.fillStyle = '#6a4b1c';
      c.fillText(text, x, y + 0.5);
      c.restore();
    }

    // The real weather outside (src/weather.js): clear, partly, cloudy, fog,
    // rain, snow or storm; null keeps the plain sky.
    setWeather(w) { this.weather = w || null; }
    weatherKind() { return this.weather ? this.weather.kind : 'partly'; }

    // The company's name over the notice board (both floors), and how many
    // notes are pinned on it today.
    setCompany(name) {
      const v = String(name || '').trim().slice(0, 24);
      if (v === (this.company || '')) return;
      this.company = v;
      // The sign takes the place of a window: lay the floor out again.
      if (this.plan && !this.plan.fixed) this.rebuild();
    }
    setBoard(n) { this.boardNotes = Math.max(0, n | 0); }

    // Each pod with people in it: the department most of them belong to.
    podDepts() {
      const spots = this.plan.podSpots || [];
      const count = spots.map(() => new Map());
      for (const [k, i] of this.deskOf) {
        const dk = this.plan.desks[i], p = this.people.get(k);
        if (!dk || dk.pod == null || !p || !count[dk.pod]) continue;
        const d = deptOf(p.s);
        count[dk.pod].set(d, (count[dk.pod].get(d) || 0) + 1);
      }
      const out = [];
      count.forEach((m, i) => {
        if (!m.size) return;
        const real = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
        // On air the repository names stay private: 部門 A, B, …
        const name = this.deptLabel ? this.deptLabel(real, i) : real;
        out.push({ x: spots[i].x + 1.4, y: spots[i].y + 0.86, z: 1.45, name, color: spots[i].color });
      });
      return out;
    }

    // A small plaque with the department's name, at screen point (x, y).
    deptPlaque(x, y, name, color) {
      const c = this.ctx;
      c.save();
      c.font = '700 9px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const text = name.length > 18 ? name.slice(0, 17) + '…' : name;
      const w = c.measureText(text).width + 12;
      c.globalAlpha = 0.92;
      this.roundRect(x - w / 2, y - 7, w, 14, 4, this.shade(color, -35));
      c.globalAlpha = 1;
      c.fillStyle = '#fff';
      c.fillText(text, x, y + 0.5);
      c.restore();
    }

    // ------------------------------------------------------------ pick up and drop

    grab(e) {
      if (e.button !== 0 || !this.canHold()) return;
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h = [...this.hit].reverse().find((b) => mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1);
      if (h) this.press = { key: h.key, x: e.clientX, y: e.clientY, id: e.pointerId };
    }

    drag(e) {
      const pr = this.press;
      let p = this.held;
      if (!p) {
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 6) return;
        p = this.people.get(pr.key);
        if (!p || p.leaving) { this.press = null; return; }
        this.held = p;
        p.held = true;
        p.errand = null;
        p.path = [];
        this.endRun(p, false);
        this.endVisit(p, false);
        this.release(p);
        p.until = 0;
        p.event = { text: pick(HELD_TEXT, p.h + Math.floor(Date.now() / 1000), 3), at: Date.now(), zone: 'held' };
        try { this.canvas.setPointerCapture(pr.id); } catch {}
        this.canvas.style.cursor = 'grabbing';
        this.onHover(null);
      }
      // Held by the scruff: feet dangle a little below the pointer.
      const at = this.heldAt(e);
      p.x = clamp(at.x, 0.2, this.plan.W - 0.2);
      p.y = clamp(at.y, 0.2, this.plan.D - 0.2);
      // Right over someone else: letting go passes your last reply to them.
      const mate = this.onRelay ? this.mateUnder(p) : null;
      this.dropOn = mate ? mate.key : null;
      this.dropAt = !mate && this.onCommand ? this.targetUnder(p) : null;
    }

    // A piece of furniture under a held person that does something when dropped on.
    targetUnder(p) {
      let best = null, bd = 1.1;
      for (const t of this.plan.targets || []) {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    }

    // The secretary walks over to your desk with news, until you have read it.
    deliver(text) {
      const p = this.secKey && this.people.get(this.secKey);
      const boss = this.plan.boss;
      if (!p || !boss || p.held || p.leaving) return false;
      this.endRun(p, false);
      this.endVisit(p, false);
      p.errand = { text };
      const spot = this.freeSpot(boss.x - 0.25, boss.y + 1.15);
      this.goTo(p, spot);
      return true;
    }

    endErrand() {
      const p = this.secKey && this.people.get(this.secKey);
      if (!p || !p.errand) return;
      p.errand = null;
      if (p.desk) this.goTo(p, p.desk.seat);
    }

    // The person standing closest under a held one, if near enough.
    mateUnder(p) {
      let best = null, bd = 0.95;
      for (const o of this.people.values()) {
        if (o === p || o.leaving || o.held) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    drop(e) {
      const p = this.held;
      this.press = null;
      if (!p) return;
      this.held = null;
      this.dropped = true;
      setTimeout(() => (this.dropped = false), 0);
      p.held = false;
      const mate = this.dropOn && this.people.get(this.dropOn);
      const target = !mate && this.dropAt;
      this.dropOn = null;
      this.dropAt = null;
      const spot = mate ? this.besideOf(mate) : target ? this.freeSpot(target.x, target.y) : this.freeSpot(p.x, p.y);
      p.x = spot.x; p.y = spot.y;
      p.path = [];
      p.landed = Date.now();
      p.event = { text: mate ? `有話跟 ${this.label(mate.s)} 說`.slice(0, 24) : p.mode === 'work' ? '回座位…' : '呼～', at: Date.now(), zone: 'held' };
      if (mate) this.onRelay(p.s, mate.s);
      if (target) { p.event = { text: target.hint, at: Date.now(), zone: 'held' }; this.onCommand(target.id, p.s); }
      this.canvas.style.cursor = 'default';
      if (e) this.pointer(e);
    }

    canHold() { return !!this.cam && !this.readOnly; }
    // Look, don't touch (a public view): no picking people up, no walking yourself.
    setReadOnly(v) { this.readOnly = !!v; if (this.meKeys) this.meKeys.clear(); }

    // Where a held person's feet are over the floor: dangling a little below the pointer.
    heldAt(e) { return this.toFloor(e, 28 + HOLD_Z * TH); }

    // Pointer position on the floor, `lift` px below the pointer.
    toFloor(e, lift = 0) {
      const r = this.canvas.getBoundingClientRect();
      const X = (e.clientX - r.left - this.cam.ox) / this.cam.zoom;
      const Y = (e.clientY - r.top - this.cam.oy) / this.cam.zoom + lift;
      const a = (2 * X) / TW, b = (2 * Y) / TH;
      return { x: (a + b) / 2, y: (b - a) / 2 };
    }

    // Free floor right next to someone, to stand and talk.
    besideOf(mate) {
      const g = this.plan.grid;
      for (let d = 0.7; d < 4; d += 0.2) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + 0.3;
          const x = mate.x + Math.cos(a) * d, y = mate.y + Math.sin(a) * d;
          if (!g.blocked(x, y)) return { x, y };
        }
      }
      return this.freeSpot(mate.x, mate.y);
    }

    // The nearest spot nobody's furniture is standing on.
    freeSpot(x, y) {
      const g = this.plan.grid;
      if (!g.blocked(x, y)) return { x, y };
      for (let d = 0.25; d < 4; d += 0.25) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
          if (!g.blocked(nx, ny)) return { x: nx, y: ny };
        }
      }
      return { ...this.plan.door };
    }

    setRoam(v) {
      this.roam = v;
      for (const p of this.people.values()) if (p.mode === 'wander' && !p.held) { this.release(p); p.until = 0; p.path = []; }
    }

    setVisible(v) { this.visible = v; if (v) this.resize(); }

    // ------------------------------------------------------------ camera / input

    resize() {
      const r = this.root.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cw = Math.max(this.compact ? 1 : 200, r.width);
      this.ch = Math.max(this.compact ? 1 : 240, r.height);
      this.canvas.width = Math.round(this.cw * dpr);
      this.canvas.height = Math.round(this.ch * dpr);
      this.canvas.style.width = this.cw + 'px';
      this.canvas.style.height = this.ch + 'px';
      this.dpr = dpr;
    }

    fitCamera() {
      const { W, D } = this.plan;
      const left = this.iso(0, D, 0).x, right = this.iso(W, 0, 0).x;
      const top = this.iso(0, 0, WALL_H).y - 20, bottom = this.iso(W, D, 0).y + 10;
      const zoom = Math.min(this.cw / (right - left + 30), this.ch / (bottom - top + 30), 2);
      let want = { zoom, ox: this.cw / 2 - ((left + right) / 2) * zoom, oy: this.ch / 2 - ((top + bottom) / 2) * zoom };
      const sp = this.spotPerson();
      if (sp) {
        // About 7 x 7 tiles around them fill the part of the window you see.
        const f = this.spotFrame();
        const spanW = this.iso(7, 0, 0).x - this.iso(0, 7, 0).x, spanH = this.iso(7, 7, 0).y - this.iso(0, 0, 0).y + 60;
        const z = Math.max(zoom * 1.3, Math.min(f.w / spanW, f.h / spanH, 3.2));
        const at = this.iso(sp.x, sp.y, 0.5);
        want = { zoom: z, ox: f.x - at.x * z, oy: f.y - at.y * z };
      }
      // Eased by time, so it glides the same at any frame rate.
      const now = this.t || 0, dt = Math.min(0.1, Math.max(0, (now - (this.camAt || now)) / 1000));
      this.camAt = now;
      const k = 1 - Math.exp(-dt * (sp || this.spotBack ? 2.2 : 6));
      if (!this.cam) this.cam = want;
      else for (const key of ['zoom', 'ox', 'oy']) this.cam[key] += (want[key] - this.cam[key]) * k;
      // Coming back from a spotlight: ease until settled.
      if (sp) this.spotBack = true;
      else if (this.spotBack && Math.abs(this.cam.zoom - want.zoom) < 0.002) this.spotBack = false;
    }

    pointer(e, click) {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let found = null;
      for (let i = this.hit.length - 1; i >= 0; i--) {
        const h = this.hit[i];
        if (mx >= h.x0 && mx <= h.x1 && my >= h.y0 && my <= h.y1) { found = h; break; }
      }
      const key = found ? found.key : null;
      if (!this.held) this.canvas.style.cursor = key ? 'grab' : 'default';
      if (key !== this.hoverKey || click) {
        this.hoverKey = key;
        const p = key && this.people.get(key);
        this.onHover(p ? p.s : null, { x: e.clientX, y: e.clientY }, !!click);
      }
    }

    iso(x, y, z = 0) {
      return { x: (x - y) * TW / 2, y: (x + y) * TH / 2 - z * TH };
    }

    // ------------------------------------------------------------ primitives

    poly(pts, fill, stroke) {
      const c = this.ctx;
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
    }

    box(x, y, z, w, d, h, top, left, right) {
      const P = (a, b, cc) => this.iso(a, b, cc);
      const c = this.ctx;
      // Standing on the floor: a soft shadow spilling out in front.
      if (z === 0 && h > 0.15) {
        c.save(); c.globalAlpha = this.pal.dark ? 0.35 : 0.13; c.fillStyle = '#000';
        const e = Math.min(0.18, h * 0.12);
        c.beginPath(); for (const q of [P(x, y, 0), P(x + w + e, y, 0), P(x + w + e, y + d + e, 0), P(x, y + d + e, 0)]) c.lineTo(q.x, q.y); c.fill();
        c.restore();
      }
      this.poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], left);
      this.poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], right);
      this.poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top);
      // Light catching the front edges of the top.
      if (h > 0.04 && w > 0.12 && d > 0.12) {
        c.save(); c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 0.8;
        const a = P(x, y + d, z + h), b = P(x + w, y + d, z + h), cc = P(x + w, y, z + h);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(cc.x, cc.y); c.stroke();
        c.restore();
      }
    }

    shade(color, amt) {
      if (color[0] !== '#') return color;
      const n = parseInt(color.slice(1), 16);
      const f = (v) => clamp(Math.round(v + amt), 0, 255);
      return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
    }

    roundRect(x, y, w, h, r, fill, stroke) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
    }

    // Draw flat things on a wall: 'y0' = back wall (runs along x),
    // 'x0' = left wall (runs along y).
    onWall(dir, a, z, fn) {
      const c = this.ctx;
      const o = dir === 'y0' ? this.iso(a, 0, z) : this.iso(0, a, z);
      c.save();
      c.translate(o.x, o.y);
      c.transform(1, dir === 'y0' ? 0.5 : -0.5, 0, 1, 0, 0);
      fn(c);
      c.restore();
    }

    // ------------------------------------------------------------ room shell

    // One region of floor: wood planks, carpet, tiles, the work area's carpet
    // tiles, the play mat or a rug.
    floorPatch({ kind, x: fx, y: fy, w: fw, d: fd }) {
      const pal = this.pal;
      const P = (x, y, z) => this.iso(x, y, z);
      const X1 = fx + fw, Y1 = fy + fd;
      const rect = (x0, y0, x1, y1, fill, stroke) => this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], fill, stroke);
      const c = this.ctx;
      if (kind === 'wood') {
        for (let x = Math.floor(fx); x < X1; x++) for (let y = Math.floor(fy); y < Y1; y++) {
          rect(Math.max(fx, x), Math.max(fy, y), Math.min(X1, x + 1), Math.min(Y1, y + 1), (x + y) % 2 ? pal.wood1 : pal.wood2);
        }
        for (let y = fy + 0.5; y < Y1; y += 0.5) rect(fx, y, X1, y + 0.012, pal.woodLine);
        // Plank ends and wood grain.
        c.save(); c.strokeStyle = pal.woodLine; c.globalAlpha = 0.55; c.lineWidth = 0.7;
        for (let y = fy; y < Y1; y += 0.5) {
          for (let x = fx + ((y * 2.7) % 1.3); x < X1; x += 1.6) { const a = P(x, y), b = P(x, Math.min(Y1, y + 0.5)); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
        }
        c.globalAlpha = 0.18; c.lineWidth = 0.6;
        for (let y = fy + 0.17; y < Y1; y += 0.25) { const a = P(fx, y), b = P(X1, y); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
        c.restore();
      } else if (kind === 'carpet') {
        rect(fx, fy, X1, Y1, pal.carpet);
        for (let x = fx + 0.5; x < X1; x += 0.5) rect(x, fy, x + 0.015, Y1, pal.carpetLine);
        c.save();
        const n = Math.round(fw * fd * 12);
        for (let i = 0; i < n; i++) {
          const q = P(fx + ((i * 0.618) % 1) * fw, fy + ((i * 0.377 + (i % 7) * 0.13) % 1) * fd);
          c.fillStyle = i % 2 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.07)';
          c.fillRect(q.x, q.y, 1.2, 1.2);
        }
        c.restore();
      } else if (kind === 'tiles') {
        for (let i = 0; i < Math.ceil(fw * 2); i++) for (let j = 0; j < Math.ceil(fd * 2); j++) {
          const x = fx + i / 2, y = fy + j / 2, x1 = Math.min(X1, x + 0.5), y1 = Math.min(Y1, y + 0.5);
          rect(x, y, x1, y1, (i + j) % 2 ? pal.tileA : pal.tileB);
          rect(x, y, x1, y + 0.02, 'rgba(120,120,110,.25)');
          rect(x, y, x + 0.02, y1, 'rgba(120,120,110,.25)');
        }
      } else if (kind === 'work') {
        for (let x = fx; x < X1 - 0.01; x += 0.75) for (let y = fy; y < Y1 - 0.01; y += 0.75) {
          rect(x, y, Math.min(X1, x + 0.75), Math.min(Y1, y + 0.75), (Math.round((x - fx) / 0.75) + Math.round((y - fy) / 0.75)) % 2 ? pal.workA : pal.workB);
        }
        for (const a of this.plan.aisles || []) {
          rect(a.x, fy + 1.2, a.x + a.w, Y1 - 0.3, pal.runner);
          rect(a.x + 0.08, fy + 1.28, a.x + a.w - 0.08, Y1 - 0.38, null, pal.runnerEdge);
        }
      } else if (kind === 'mat') {
        rect(fx, fy, X1, Y1, pal.mat);
      } else if (kind === 'rug') {
        rect(fx, fy, X1, Y1, pal.rug);
        rect(fx + 0.2, fy + 0.2, X1 - 0.2, Y1 - 0.2, null, pal.rugEdge);
      }
    }

    // A coat rack by the door, and the lounge's armchair (2D).
    coatRack(x, y) {
      this.box(x - 0.15, y - 0.15, 0, 0.3, 0.3, 0.04, '#6e533b', '#5c4431', '#4c3826');
      this.box(x - 0.03, y - 0.03, 0.04, 0.06, 0.06, 1.65, '#a8825a', '#946f4b', '#7d5c3e');
      this.box(x - 0.12, y - 0.04, 1.45, 0.24, 0.08, 0.06, '#6e533b', '#5c4431', '#4c3826');
    }

    armchair(x, y) {
      const col = '#cd8a68', l = this.shade(col, -12), r = this.shade(col, -24);
      this.box(x + 0.05, y + 0.1, 0, 0.7, 0.65, 0.32, this.shade(col, 8), l, r);
      this.box(x + 0.05, y + 0.02, 0.32, 0.7, 0.16, 0.36, this.shade(col, 8), l, r);
      this.box(x, y + 0.1, 0.32, 0.12, 0.65, 0.16, this.shade(col, 8), l, r);
      this.box(x + 0.68, y + 0.1, 0.32, 0.12, 0.65, 0.16, this.shade(col, 8), l, r);
    }

    drawRoom() {
      const { W, D } = this.plan;
      const pal = this.pal;
      const P = (x, y, z) => this.iso(x, y, z);
      const t = this.t / 1000;

      // floors, region by region as the plan lays them out (plan.floors)
      for (const f of this.plan.floors || []) this.floorPatch(f);

      // walls
      this.poly([P(0, 0, 0), P(W, 0, 0), P(W, 0, WALL_H), P(0, 0, WALL_H)], pal.wallL);
      this.poly([P(0, 0, 0), P(0, D, 0), P(0, D, WALL_H), P(0, 0, WALL_H)], pal.wallR);
      this.poly([P(0, 0, WALL_H), P(W, 0, WALL_H), P(W, -0.15, WALL_H), P(-0.15, -0.15, WALL_H), P(-0.15, D, WALL_H), P(0, D, WALL_H)], pal.wallTop);
      this.poly([P(0, 0, 0), P(W, 0, 0), P(W, 0, 0.12), P(0, 0, 0.12)], pal.trim);
      this.poly([P(0, 0, 0), P(0, D, 0), P(0, D, 0.12), P(0, 0, 0.12)], pal.trim);

      // windows with the real sky outside
      const sky = skyColor();
      const wk = this.weatherKind();
      const grey = { cloudy: sky.night ? '#262c38' : '#9aa5b0', rain: sky.night ? '#1f2530' : '#7d8894', storm: sky.night ? '#181c26' : '#5e6874', fog: sky.night ? '#3a3f48' : '#c9cfd4' }[wk];
      // A flash of lightning now and then.
      const flash = wk === 'storm' && (t % 7.3) < 0.12;
      for (const x of this.plan.windows) {
        this.poly([P(x, 0, 0.45), P(x + 1.5, 0, 0.45), P(x + 1.5, 0, 2.15), P(x, 0, 2.15)], flash ? '#e8eef8' : grey || sky.sky);
        if (wk === 'rain' || wk === 'storm') {
          this.onWall('y0', x, 1.98, (c) => {
            c.strokeStyle = 'rgba(210,225,240,.7)'; c.lineWidth = 0.8;
            for (let i = 0; i < 12; i++) {
              const fx = ((i * 13 + t * 9) % 46) + 1, fy = ((i * 23 + t * 140) % 34);
              c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx - 1.2, fy + 5); c.stroke();
            }
          });
        }
        if (this.season === 'xmas' || wk === 'snow') {
          this.onWall('y0', x, 1.0, (c) => {
            c.fillStyle = 'rgba(255,255,255,.85)';
            for (let i = 0; i < 9; i++) {
              const fx = ((i * 17 + t * 6 * (1 + (i % 3) * 0.3)) % 46) + 1, fy = -((i * 11 + t * 12) % 36);
              c.fillRect(fx, fy, 1.6, 1.6);
            }
          });
        }
        if (sky.night && !grey) {
          this.onWall('y0', x + 0.3, 1.75, (c) => { c.fillStyle = '#f4f1d0'; c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill(); });
          this.onWall('y0', x + 1.1, 1.55, (c) => { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(0, 0, 1.5, 1.5); });
        } else {
          const cx = x + 0.25 + ((t * 0.02 + x * 0.37) % 1) * 1.0;
          if (wk !== 'clear') this.onWall('y0', x + 0.2 + ((t * 0.015 + x * 0.61) % 1) * 1.1, 1.82, (c) => {
            c.fillStyle = grey ? 'rgba(120,128,138,.75)' : 'rgba(255,255,255,.8)';
            c.beginPath(); c.ellipse(0, 0, 9, 3.5, 0, 0, Math.PI * 2); c.ellipse(-6, 1, 6, 3, 0, 0, Math.PI * 2); c.fill();
          });
          if (!grey || wk === 'cloudy') this.onWall('y0', cx, 1.65, (c) => {
            c.fillStyle = grey ? 'rgba(150,158,168,.85)' : 'rgba(255,255,255,.85)';
            c.beginPath(); c.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); c.ellipse(5, -2, 5, 3, 0, 0, Math.PI * 2); c.fill();
          });
        }
        this.poly([P(x + 0.74, 0, 0.45), P(x + 0.76, 0, 0.45), P(x + 0.76, 0, 2.15), P(x + 0.74, 0, 2.15)], pal.trim);
        this.poly([P(x, 0, 0.85), P(x + 1.5, 0, 0.85), P(x + 1.5, 0, 0.9), P(x, 0, 0.9)], pal.trim);
        this.poly([P(x, 0.05), P(x + 1.5, 0.05), P(x + 1.95, 1.2), P(x + 0.45, 1.2)], sky.night ? 'rgba(120,140,200,.06)' : 'rgba(255,250,230,.16)');
      }
      // meeting room whiteboard + sign (downstairs); a sign for the library upstairs
      const sign = this.plan.wallSign;
      if (sign) this.onWall('y0', sign.x, 2.2, (c) => {
        c.font = '700 9px ui-sans-serif, system-ui, sans-serif'; c.fillStyle = this.shade(pal.trim, -60); c.fillText(sign.text, 0, 0);
      });
      if (this.plan.whiteboard) {
      const wx = this.plan.whiteboard.x;
      this.poly([P(wx, 0, 0.8), P(wx + 2.6, 0, 0.8), P(wx + 2.6, 0, 1.95), P(wx, 0, 1.95)], '#fdfdfb', pal.trim);
      const pins = this.pins || [];
      if (pins.length) {
        // Pinned sessions, written on the whiteboard.
        this.onWall('y0', wx + 0.2, 1.8, (c) => {
          c.font = '700 7px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
          c.textBaseline = 'middle';
          pins.slice(0, 4).forEach((t, i) => {
            c.fillStyle = ['#c96442', '#3b8ee0', '#5f9a4c', '#8b6be6'][i];
            c.fillText('📌 ' + t, 0, i * 8.5);
          });
        });
      } else this.onWall('y0', wx + 0.25, 1.75, (c) => {
        c.lineWidth = 1.4;
        c.strokeStyle = '#3b8ee0';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(22, 0); c.moveTo(0, 7); c.lineTo(36, 7); c.stroke();
        c.strokeStyle = '#c96442';
        c.strokeRect(46, -2, 20, 12); c.strokeRect(80, 6, 20, 12);
        c.beginPath(); c.moveTo(66, 4); c.lineTo(80, 12); c.stroke();
        c.strokeStyle = '#5f9a4c';
        c.beginPath(); c.moveTo(0, 22); for (let i = 0; i < 8; i++) c.lineTo(i * 8, 22 - ((i * 37) % 13)); c.stroke();
      });
      }
      // unlocked: a neon sign over the windows
      const neon = this.plan.neon;
      if (neon) {
        this.onWall('y0', neon.x, 2.28, (c) => {
          const hue = (t * 40) % 360;
          c.font = '900 13px ui-sans-serif, system-ui, sans-serif';
          c.shadowColor = `hsl(${hue},100%,60%)`;
          c.shadowBlur = 8 + Math.sin(t * 6) * 3;
          c.fillStyle = `hsl(${hue},100%,${pal.dark ? 75 : 55}%)`;
          c.fillText(neon.text, 0, 0);
          c.shadowBlur = 0;
        });
      }
      // left wall: posters, clock, door
      for (const ps of this.plan.posters) {
        this.poly([P(0, ps.y, 0.95), P(0, ps.y + 0.9, 0.95), P(0, ps.y + 0.9, 1.95), P(0, ps.y, 1.95)], ps.color);
        this.onWall('x0', ps.y + 0.45, 1.4, (c) => {
          c.font = '800 8px ui-sans-serif, system-ui, sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(ps.text, 0, 0);
        });
      }
      this.onWall('x0', 1.0, 1.85, (c) => {
        c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fillStyle = pal.bubble; c.fill();
        c.lineWidth = 2; c.strokeStyle = pal.trim; c.stroke();
        const d = new Date();
        const hand = (ang, len, w) => { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(ang) * len, -Math.cos(ang) * len); c.lineWidth = w; c.strokeStyle = pal.bubbleInk; c.stroke(); };
        hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 5.5, 2);
        hand((d.getMinutes() / 60) * Math.PI * 2, 8, 1.4);
      });
      this.drawLift();
      this.drawLogo();
      this.drawBoard();
      if (this.plan.floor === 2) return;
      const dy = this.plan.door.y;
      this.poly([P(0, dy - 0.6, 0), P(0, dy + 0.6, 0), P(0, dy + 0.6, 1.8), P(0, dy - 0.6, 1.8)], pal.trim);
      this.poly([P(0, dy - 0.52, 0), P(0, dy + 0.52, 0), P(0, dy + 0.52, 1.72), P(0, dy - 0.52, 1.72)], this.shade(pal.deskL, -10));
      this.onWall('x0', dy - 0.25, 0.85, (c) => { c.fillStyle = '#d8c48a'; c.beginPath(); c.arc(0, 0, 1.8, 0, Math.PI * 2); c.fill(); });
      this.poly([P(0.05, dy - 0.6), P(0.9, dy - 0.6), P(0.9, dy + 0.6), P(0.05, dy + 0.6)], pal.dark ? '#5a3b2e' : '#b9654a');
    }

    // ------------------------------------------------------------ furniture

    plant(x, y) {
      const pal = this.pal;
      this.box(x - 0.18, y - 0.18, 0, 0.36, 0.36, 0.3, this.shade(pal.pot, 10), pal.pot, this.shade(pal.pot, -15));
      const c = this.ctx;
      const b = this.iso(x, y, 0.3);
      const sway = Math.sin(this.t / 1400 + x) * 0.05;
      c.fillStyle = pal.plant;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        c.beginPath();
        c.ellipse(b.x + Math.cos(a) * 6, b.y - 13 + Math.sin(a) * 3, 5.5, 13, a / 3 + sway, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = this.shade(pal.plant, 22);
      c.beginPath(); c.ellipse(b.x, b.y - 20, 5, 10, sway, 0, Math.PI * 2); c.fill();
    }

    serverRack(x, y) {
      this.box(x, y, 0, 0.7, 0.6, 1.9, '#3a3d44', '#24262b', '#1b1d21');
      const c = this.ctx;
      const busy = this.deskOf.size;
      // CI failed: a red glow on the floor round the rack, pulsing.
      if (this.alarmUntil > Date.now()) {
        const g = this.iso(x + 0.35, y + 0.9, 0), k = 0.5 + 0.5 * Math.sin(this.t / 150);
        c.save(); c.globalAlpha = 0.25 + 0.3 * k; c.fillStyle = '#ff3b30';
        c.beginPath(); c.ellipse(g.x, g.y, 60, 30, 0, 0, Math.PI * 2); c.fill(); c.restore();
      }
      for (let r = 0; r < 7; r++) {
        for (let k = 0; k < 4; k++) {
          const alarm = this.alarmUntil > Date.now();
          const on = alarm ? Math.sin(this.t / 120) > 0 : Math.sin(this.t / (180 + r * 37 + k * 53) + r * k) > 0.2 && (r * 4 + k) < Math.max(4, busy * 3);
          const p = this.iso(x + 0.12 + k * 0.13, y + 0.6, 1.7 - r * 0.22);
          c.fillStyle = on ? (alarm ? '#ff3b30' : k % 3 === 0 ? '#ffb347' : '#5cf08a') : '#2f3a33';
          c.fillRect(p.x - 1, p.y - 1, 2.5, 2);
        }
      }
    }

    printer(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 0.75, 0.55, 0.55, pal.deskTop, pal.deskL, pal.deskR);
      this.box(x + 0.05, y + 0.05, 0.55, 0.65, 0.45, 0.28, '#e8e8e8', '#c8c8c8', '#b3b3b3');
      this.box(x + 0.15, y + 0.35, 0.83, 0.45, 0.15, 0.02, '#ffffff', '#eee', '#ddd');
      // Jammed: a blinking red light and a crumpled sheet sticking out.
      if (this.jamUntil > Date.now()) {
        const c = this.ctx, l = this.iso(x + 0.6, y + 0.5, 0.84);
        if (Math.sin(this.t / 150) > 0) { c.fillStyle = '#ff3b30'; c.beginPath(); c.arc(l.x, l.y, 2.4, 0, Math.PI * 2); c.fill(); }
        this.box(x + 0.25, y + 0.5, 0.7, 0.25, 0.12, 0.08, '#f4f1e8', '#dedad0', '#cfcac0');
      }
    }

    pingpong(x, y) {
      for (const [lx, ly] of [[0.1, 0.1], [2.4, 0.1], [0.1, 1.2], [2.4, 1.2]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.7, '#333', '#333', '#222');
      this.box(x, y, 0.7, 2.6, 1.4, 0.06, '#2f7a52', '#245f40', '#1d4f35');
      const P = (a, b, c) => this.iso(a, b, c);
      this.poly([P(x + 0.04, y + 0.69, 0.765), P(x + 2.56, y + 0.69, 0.765), P(x + 2.56, y + 0.71, 0.765), P(x + 0.04, y + 0.71, 0.765)], '#ffffff');
      this.poly([P(x + 1.3, y - 0.05, 0.76), P(x + 1.3, y + 1.45, 0.76), P(x + 1.3, y + 1.45, 0.95), P(x + 1.3, y - 0.05, 0.95)], 'rgba(255,255,255,.55)', '#ddd');
    }

    meetingTable(x, y) {
      const pal = this.pal;
      this.box(x + 0.3, y + 0.5, 0, 0.12, 0.4, 0.7, pal.deskL, pal.deskL, pal.deskR);
      this.box(x + 2.6, y + 0.5, 0, 0.12, 0.4, 0.7, pal.deskL, pal.deskL, pal.deskR);
      this.box(x, y, 0.7, 3.0, 1.4, 0.08, this.shade(pal.deskTop, 12), pal.deskL, pal.deskR);
      this.box(x + 1.2, y + 0.45, 0.78, 0.5, 0.35, 0.03, '#2a2a2e', '#222', '#1a1a1a');
      this.box(x + 0.4, y + 0.3, 0.78, 0.2, 0.28, 0.02, '#fff', '#eee', '#ddd');
      this.box(x + 2.2, y + 0.8, 0.78, 0.12, 0.12, 0.12, '#f2f2f2', '#d0d0d0', '#bbb');
    }

    stool(x, y, h, color) {
      this.box(x - 0.04, y - 0.04, 0, 0.08, 0.08, h, '#555', '#444', '#333');
      this.box(x - 0.2, y - 0.2, h, 0.4, 0.4, 0.07, this.shade(color, 18), color, this.shade(color, -18));
    }

    roundTable(x, y) {
      const c = this.ctx;
      this.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.72, '#555', '#444', '#333');
      const p = this.iso(x, y, 0.75);
      c.fillStyle = this.shade(this.pal.deskTop, -15);
      c.beginPath(); c.ellipse(p.x, p.y + 3, 30, 15, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = this.shade(this.pal.deskTop, 15);
      c.beginPath(); c.ellipse(p.x, p.y, 30, 15, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(p.x + 8, p.y - 2, 5, 2.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e6b35c';
      c.beginPath(); c.arc(p.x + 8, p.y - 3, 2, 0, Math.PI * 2); c.fill();
      const now = Date.now();
      if (this.lunchUntil > now) {
        // Delivery bags and bento boxes.
        this.roundRect(p.x - 16, p.y - 12, 9, 10, 2, '#f2efe6', '#c9c3b4');
        this.roundRect(p.x - 6, p.y - 4, 10, 5, 1.5, '#c9773a');
        c.fillStyle = '#fff'; c.fillRect(p.x - 5, p.y - 5, 8, 1.5);
      }
      if (this.cakeUntil > now) {
        // A cake on a plate.
        c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(p.x - 6, p.y + 1, 9, 4.5, 0, 0, Math.PI * 2); c.fill();
        this.roundRect(p.x - 12, p.y - 8, 12, 8, 2, '#f5d7a1', '#d9b77c');
        c.fillStyle = '#fdf6ee'; c.fillRect(p.x - 12, p.y - 8, 12, 2.5);
        c.fillStyle = '#e0344b'; c.beginPath(); c.arc(p.x - 6, p.y - 9.5, 1.8, 0, Math.PI * 2); c.fill();
      }
    }

    coffeeMachine(x, y) {
      this.box(x, y, 0.9, 0.5, 0.45, 0.6, '#555b63', '#3a3f45', '#2e3237');
      this.box(x + 0.15, y + 0.42, 1.0, 0.2, 0.05, 0.15, '#222', '#111', '#111');
      const p = this.iso(x + 0.4, y + 0.45, 1.35);
      this.ctx.fillStyle = Math.sin(this.t / 400) > 0 ? '#ff6b4a' : '#7a3a2a';
      this.ctx.fillRect(p.x, p.y, 2.5, 2.5);
      this.box(x + 0.6, y + 0.1, 0.9, 0.14, 0.14, 0.14, '#fff', '#ddd', '#ccc');
    }

    sink(x, y) {
      this.box(x, y + 0.05, 0.9, 0.55, 0.4, 0.02, '#9aa3ad', '#7d858e', '#6c737b');
      this.box(x + 0.22, y + 0.02, 0.92, 0.06, 0.06, 0.3, this.pal.metal, this.pal.metal, '#888');
      this.box(x + 0.22, y + 0.02, 1.2, 0.06, 0.2, 0.04, this.pal.metal, this.pal.metal, '#888');
    }

    fridge(x, y) {
      this.box(x, y, 0, 0.85, 0.75, 1.95, '#eef1f4', '#cfd5db', '#bcc3ca');
      const P = (a, b, c) => this.iso(a, b, c);
      this.poly([P(x, y + 0.75, 1.25), P(x + 0.85, y + 0.75, 1.25), P(x + 0.85, y + 0.75, 1.27), P(x, y + 0.75, 1.27)], '#9aa3ad');
      this.poly([P(x + 0.7, y + 0.75, 1.4), P(x + 0.73, y + 0.75, 1.4), P(x + 0.73, y + 0.75, 1.75), P(x + 0.7, y + 0.75, 1.75)], '#888');
      for (const [mx, mz, col] of [[0.2, 1.6, '#c96442'], [0.4, 1.45, '#3b8ee0'], [0.3, 0.9, '#5f9a4c']]) {
        const p = P(x + mx, y + 0.75, mz);
        this.ctx.fillStyle = col; this.ctx.fillRect(p.x, p.y, 4, 4);
      }
    }

    waterCooler(x, y) {
      this.box(x, y, 0, 0.42, 0.42, 0.95, '#e8ecef', '#cfd5db', '#bcc3ca');
      const c = this.ctx;
      const p = this.iso(x + 0.21, y + 0.21, 0.95);
      c.fillStyle = 'rgba(120,180,240,.6)';
      c.beginPath(); c.ellipse(p.x, p.y - 9, 8, 11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(p.x - 4, p.y - 16, 2, 10);
      const k = (this.t / 1800) % 1;
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(p.x + 2, p.y - 2 - k * 16, 1.2, 0, Math.PI * 2); c.fill();
      const tap = this.iso(x + 0.21, y + 0.42, 0.65);
      c.fillStyle = '#3b8ee0'; c.fillRect(tap.x - 1.5, tap.y, 3, 3);
    }

    couch(x, y) {
      const pal = this.pal;
      this.box(x, y - 0.05, 0.32, 2.8, 0.25, 0.42, this.shade(pal.couch, 10), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x, y, 0, 2.8, 0.8, 0.32, pal.couch, pal.couchD, this.shade(pal.couchD, -12));
      this.box(x - 0.15, y - 0.05, 0, 0.18, 0.85, 0.52, this.shade(pal.couch, 6), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x + 2.8, y - 0.05, 0, 0.18, 0.85, 0.52, this.shade(pal.couch, 6), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x + 2.15, y + 0.12, 0.32, 0.35, 0.16, 0.28, '#e9c46a', '#d4ae52', '#c19c43');
    }

    coffeeTable(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 1.6, 0.7, 0.3, this.shade(pal.deskTop, -10), pal.deskL, pal.deskR);
      this.box(x + 0.2, y + 0.15, 0.3, 0.35, 0.25, 0.06, '#c96442', '#a85336', '#8f462e');
      this.box(x + 1.1, y + 0.3, 0.3, 0.12, 0.12, 0.12, '#fff', '#ddd', '#ccc');
    }

    beanbag(x, y, color) {
      const c = this.ctx;
      const p = this.iso(x, y, 0);
      c.fillStyle = this.shade(color, -25);
      c.beginPath(); c.ellipse(p.x, p.y - 4, 20, 11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = color;
      c.beginPath(); c.ellipse(p.x, p.y - 8, 18, 10, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = this.shade(color, 20);
      c.beginPath(); c.ellipse(p.x - 3, p.y - 14, 10, 6, -0.2, 0, Math.PI * 2); c.fill();
    }

    books(x0, x1, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const cols = this.pal.book;
      for (let shelf = 0; shelf < 3; shelf++) {
        const z = 0.12 + shelf * 0.45;
        let bx = x0 + 0.05;
        let i = Math.round(x0 * 7) + shelf * 5;
        while (bx < x1 - 0.1) {
          const bw = 0.07 + ((i * 13) % 5) * 0.015;
          const bh = 0.25 + ((i * 7) % 4) * 0.03;
          if (i % 7 !== 3) this.poly([P(bx, y, z), P(bx + bw, y, z), P(bx + bw, y, z + bh), P(bx, y, z + bh)], cols[i % cols.length]);
          bx += bw + 0.015;
          i++;
        }
        this.poly([P(x0, y, z - 0.02), P(x1, y, z - 0.02), P(x1, y, z), P(x0, y, z)], this.pal.deskR);
      }
    }

    arcade(x, y) {
      this.box(x, y, 0, 0.7, 0.7, 1.75, '#3a2a6a', '#2b1f52', '#221843');
      const P = (a, b, c) => this.iso(a, b, c);
      const hue = (this.t / 20) % 360;
      this.poly([P(x + 0.1, y + 0.7, 1.0), P(x + 0.6, y + 0.7, 1.0), P(x + 0.6, y + 0.7, 1.45), P(x + 0.1, y + 0.7, 1.45)], `hsl(${hue},70%,55%)`);
      const blip = this.iso(x + 0.25 + 0.2 * Math.sin(this.t / 300), y + 0.7, 1.2);
      this.ctx.fillStyle = '#fff'; this.ctx.fillRect(blip.x, blip.y, 3, 3);
      this.poly([P(x, y + 0.7, 1.55), P(x + 0.7, y + 0.7, 1.55), P(x + 0.7, y + 0.7, 1.72), P(x, y + 0.7, 1.72)], '#ffcf4a');
      this.box(x, y + 0.7, 0.8, 0.7, 0.2, 0.08, '#4a3a8a', '#3a2a6a', '#2b1f52');
      const j = this.iso(x + 0.25, y + 0.8, 0.88);
      this.ctx.fillStyle = '#e04a4a'; this.ctx.beginPath(); this.ctx.arc(j.x, j.y - 3, 2.5, 0, Math.PI * 2); this.ctx.fill();
    }

    // ---- the slot machine ---------------------------------------------------

    // Someone sitting at it pulls a spin every few seconds; the reels stop
    // one by one, and three or more alike along the middle row pay out.
    stepSlot(dt) {
      const q = this.plan.pois && this.plan.pois.find((o) => o.act === 'slot');
      if (!q) { this.slot = null; return; }
      const now = this.t;
      const sl = this.slot || (this.slot = { pos: [0, 3, 6, 9, 12], from: [0, 0, 0, 0, 0], to: [0, 3, 6, 9, 12], dur: [1, 1, 1, 1, 1], spinAt: -1e9, next: 0, win: 0, winUntil: 0, paid: true, jackpot: 88888, credit: 12340, player: null });
      let player = null;
      for (const p of this.people.values()) if (p.mode === 'wander' && p.poi === q && !p.path.length) { player = p; break; }
      sl.player = player ? player.key : null;
      const spinning = now - sl.spinAt < Math.max(...sl.dur);
      if (player && !spinning && now >= sl.next) {
        sl.spinAt = now;
        sl.paid = false;
        sl.credit -= 88;
        for (let i = 0; i < 5; i++) {
          sl.from[i] = sl.pos[i];
          sl.to[i] = Math.floor(sl.pos[i]) + 16 + i * 5 + Math.floor(Math.random() * 16);
          sl.dur[i] = 1100 + i * 280;
        }
        // Now and then a line comes in (the rest is luck).
        if (Math.random() < 0.25) {
          const sym = SLOT_STRIPS[0][(sl.to[0] + 1) % 16];
          const n = Math.random() < 0.15 ? 5 : Math.random() < 0.4 ? 4 : 3;
          for (let i = 1; i < n; i++) {
            for (let j = sl.to[i]; j < sl.to[i] + 16; j++) if (SLOT_STRIPS[i][(j + 1) % 16] === sym) { sl.to[i] = j; break; }
          }
        }
        sl.next = now + sl.dur[4] + 2200 + Math.random() * 1800;
      }
      for (let i = 0; i < 5; i++) {
        const k = Math.min(1, (now - sl.spinAt) / sl.dur[i]);
        sl.pos[i] = sl.from[i] + (sl.to[i] - sl.from[i]) * SLOT_EASE(k);
      }
      if (now - sl.spinAt >= Math.max(...sl.dur) && !sl.paid) {
        sl.paid = true;
        const line = sl.to.map((v, i) => SLOT_STRIPS[i][(v + 1) % 16]);
        let n = 1;
        while (n < 5 && line[n] === line[0]) n++;
        sl.win = n >= 3 ? SLOT_PAY[line[0]] * (n - 2) : 0;
        if (sl.win) { sl.winUntil = now + 2600; sl.credit += sl.win; sl.winLen = n; }
      }
      if (player) sl.jackpot += dt * 3.7;
    }

    // The slot machine's main screen on a canvas (w x h, portrait): used for
    // the 3D screen and, small, for the 2D one.
    slotScreen(c, w, h) {
      const sl = this.slot || { pos: [0, 3, 6, 9, 12], win: 0, winUntil: 0, credit: 12340, player: null };
      const now = this.t;
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a0f4a'); g.addColorStop(0.55, '#14103a'); g.addColorStop(1, '#0a1630');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // title
      const th = h * 0.13;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 ${th * 0.62}px ui-sans-serif, system-ui, sans-serif`;
      const tg = c.createLinearGradient(0, 0, 0, th);
      tg.addColorStop(0, '#fff3b0'); tg.addColorStop(1, '#e0a020');
      c.fillStyle = tg; c.fillText('★ LUCKY STAR ★', w / 2, th * 0.6);
      // the reels
      const top = th * 1.1, cols = 5, rows = 3, pad = w * 0.035;
      const cw = (w - pad * 2) / cols, ch = Math.min(cw * 1.35, (h - top - h * 0.17) / rows);
      const rh = ch * rows;
      c.fillStyle = '#d9a52b'; this.ctxRound(c, pad - 4, top - 4, w - pad * 2 + 8, rh + 8, 8); c.fill();
      c.fillStyle = '#0b0b1a'; this.ctxRound(c, pad - 1, top - 1, w - pad * 2 + 2, rh + 2, 6); c.fill();
      c.save();
      c.beginPath(); c.rect(pad, top, w - pad * 2, rh); c.clip();
      for (let i = 0; i < cols; i++) {
        const x0 = pad + i * cw;
        c.fillStyle = i % 2 ? '#fbf6ea' : '#f3ecdc';
        c.fillRect(x0 + 1, top, cw - 2, rh);
        const pos = sl.pos[i], base = Math.floor(pos), frac = pos - base;
        const moving = sl.spinAt != null && now - sl.spinAt < (sl.dur ? sl.dur[i] : 0);
        for (let r = -1; r <= rows; r++) {
          const sym = SLOT_STRIPS[i][(((base + r) % 16) + 16) % 16];
          const cy = top + (r - frac + 0.5) * ch;
          this.slotSymbol(c, sym, x0 + cw / 2, cy, ch * 0.62, moving);
        }
        if (moving) { c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x0 + 1, top, cw - 2, rh); }
      }
      // shade at the top and bottom of the window, like a curved reel
      const sh = c.createLinearGradient(0, top, 0, top + rh);
      sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(0.22, 'rgba(0,0,0,0)'); sh.addColorStop(0.78, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
      c.fillStyle = sh; c.fillRect(pad, top, w - pad * 2, rh);
      c.restore();
      // the middle line, lit up on a win
      const win = sl.winUntil > now;
      const ly = top + ch * 1.5;
      c.strokeStyle = win ? `hsl(${(now / 4) % 360},100%,60%)` : 'rgba(255,90,90,.55)';
      c.lineWidth = win ? 5 : 2;
      c.beginPath(); c.moveTo(pad - 6, ly); c.lineTo(w - pad + 6, ly); c.stroke();
      if (win) {
        for (let i = 0; i < (sl.winLen || 3); i++) {
          c.strokeStyle = '#ffe14d'; c.lineWidth = 4;
          this.ctxRound(c, pad + i * cw + 4, top + ch + 3, cw - 8, ch - 6, 6); c.stroke();
        }
      }
      // the bottom bar: credit, bet, win; or the call to play
      const by = top + rh + 8, bh = h - by - 4;
      if (win) {
        const pulse = 1 + 0.08 * Math.sin(now / 90);
        c.font = `900 ${Math.min(bh * 0.62, w * 0.14) * pulse}px ui-sans-serif, system-ui, sans-serif`;
        c.fillStyle = '#ffe14d'; c.fillText(`WIN ${sl.win.toLocaleString()}`, w / 2, by + bh / 2);
      } else if (!sl.player) {
        c.font = `800 ${Math.min(bh * 0.45, w * 0.1)}px ui-sans-serif, system-ui, sans-serif`;
        c.fillStyle = Math.sin(now / 300) > 0 ? '#ffffff' : '#8fd3ff';
        c.fillText('PRESS SPIN', w / 2, by + bh / 2);
      } else {
        c.font = `700 ${Math.min(bh * 0.32, w * 0.065)}px ui-sans-serif, system-ui, sans-serif`;
        c.fillStyle = '#9fe8ff';
        c.textAlign = 'left'; c.fillText(`CREDIT ${Math.round(sl.credit).toLocaleString()}`, pad, by + bh / 2);
        c.textAlign = 'right'; c.fillText('BET 88', w - pad, by + bh / 2);
        c.textAlign = 'center';
      }
    }

    // The topper over the main screen: the progressive jackpot.
    slotTopper(c, w, h) {
      const sl = this.slot || { jackpot: 88888, winUntil: 0 };
      const now = this.t;
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#5a0f2e'); g.addColorStop(0.5, '#a3123a'); g.addColorStop(1, '#5a0f2e');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 ${h * 0.26}px ui-sans-serif, system-ui, sans-serif`;
      c.fillStyle = '#ffd86b'; c.fillText('GRAND JACKPOT', w / 2, h * 0.27);
      c.font = `900 ${h * 0.42}px ui-sans-serif, system-ui, sans-serif`;
      c.fillStyle = sl.winUntil > now && Math.sin(now / 80) > 0 ? '#ffffff' : '#fff3b0';
      c.fillText(`$${Math.floor(sl.jackpot).toLocaleString()}`, w / 2, h * 0.68);
      // chasing lights along the edge
      for (let i = 0; i < 18; i++) {
        const on = (Math.floor(now / 120) + i) % 3 === 0;
        c.fillStyle = on ? '#fff6c8' : '#7a3a10';
        const x = (i + 0.5) * w / 18;
        c.beginPath(); c.arc(x, 3, 2.2, 0, Math.PI * 2); c.arc(x, h - 3, 2.2, 0, Math.PI * 2); c.fill();
      }
    }

    slotSymbol(c, sym, x, y, size, blur) {
      c.save();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (blur) c.globalAlpha = 0.75;
      if (sym === '7') {
        c.font = `900 ${size * 1.05}px ui-sans-serif, system-ui, sans-serif`;
        c.lineWidth = size * 0.1; c.strokeStyle = '#5a0a0a'; c.strokeText('7', x, y);
        c.fillStyle = '#e8262b'; c.fillText('7', x, y);
      } else if (sym === 'BAR') {
        c.fillStyle = '#1d1d24'; this.ctxRound(c, x - size * 0.55, y - size * 0.26, size * 1.1, size * 0.52, size * 0.1); c.fill();
        c.font = `900 ${size * 0.38}px ui-sans-serif, system-ui, sans-serif`;
        c.fillStyle = '#ffd34d'; c.fillText('BAR', x, y + 1);
      } else {
        c.font = `${size * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        c.fillText(sym, x, y + size * 0.05);
      }
      c.restore();
    }

    ctxRound(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    // Draw on the front face (facing +y) of something at plane y, from
    // (x, z) at the bottom-left; 1 world unit = TH px.
    onFront(x, y, z, fn) {
      const c = this.ctx, o = this.iso(x, y, z);
      c.save(); c.translate(o.x, o.y); c.transform(1, 0.5, 0, 1, 0, 0); fn(c); c.restore();
    }

    // 2D: the cabinet, its screens (drawn small from the same canvases as
    // in 3D), lit edges and the button deck.
    slotMachine(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      this.box(x, y, 0, 0.7, 0.7, 0.85, '#2a2d36', '#22242c', '#1b1d23');
      this.box(x, y, 0.85, 0.7, 0.45, 1.05, '#2a2d36', '#22242c', '#1b1d23');
      this.box(x + 0.02, y + 0.45, 0.85, 0.66, 0.25, 0.07, '#3a3e48', '#30333c', '#262830');
      this.box(x, y + 0.05, 1.9, 0.7, 0.35, 0.3, '#2a2d36', '#22242c', '#1b1d23');
      const cv = this.slotCanvas || (this.slotCanvas = Object.assign(document.createElement('canvas'), { width: 128, height: 160 }));
      const tv = this.slotTopCanvas || (this.slotTopCanvas = Object.assign(document.createElement('canvas'), { width: 128, height: 48 }));
      if (!this.slotDrawnAt || this.t - this.slotDrawnAt > 60) {
        this.slotDrawnAt = this.t;
        this.slotScreen(cv.getContext('2d'), cv.width, cv.height);
        this.slotTopper(tv.getContext('2d'), tv.width, tv.height);
      }
      this.onFront(x + 0.07, y + 0.45, 1.0, (c) => c.drawImage(cv, 0, -0.85 * TH, 0.56 * TH, 0.85 * TH));
      this.onFront(x + 0.05, y + 0.4, 1.93, (c) => c.drawImage(tv, 0, -0.24 * TH, 0.6 * TH, 0.24 * TH));
      const sl = this.slot, hue = sl && sl.winUntil > this.t ? (this.t / 3) % 360 : (this.t / 25) % 360;
      for (const ex of [x, x + 0.67]) this.poly([P(ex, y + 0.46, 0.88), P(ex + 0.03, y + 0.46, 0.88), P(ex + 0.03, y + 0.46, 1.9), P(ex, y + 0.46, 1.9)], `hsl(${hue},90%,62%)`);
      const b = this.iso(x + 0.5, y + 0.6, 0.93);
      this.ctx.fillStyle = sl && sl.player && Math.sin(this.t / 200) > 0 ? '#ff5a3c' : '#c0392b';
      this.ctx.beginPath(); this.ctx.ellipse(b.x, b.y, 3.2, 1.8, 0, 0, Math.PI * 2); this.ctx.fill();
    }

    // Upstairs: gym gear.
    treadmill(x, y) {
      const c = this.ctx;
      this.box(x + 0.05, y + 0.35, 0, 0.6, 1.05, 0.14, '#3a3a40', '#2a2a2e', '#323238');
      // the belt moves
      const k = (this.t / 120) % 1;
      for (let i = 0; i < 4; i++) {
        const yy = y + 0.4 + ((i + k) / 4) * 0.95;
        this.poly([this.iso(x + 0.1, yy, 0.141), this.iso(x + 0.6, yy, 0.141), this.iso(x + 0.6, yy + 0.02, 0.141), this.iso(x + 0.1, yy + 0.02, 0.141)], 'rgba(255,255,255,.18)');
      }
      this.box(x + 0.05, y + 0.25, 0, 0.06, 0.06, 1.0, '#888', '#777', '#999');
      this.box(x + 0.59, y + 0.25, 0, 0.06, 0.06, 1.0, '#888', '#777', '#999');
      this.box(x, y, 0.95, 0.7, 0.32, 0.12, '#2a2a2e', '#1f1f22', '#26262a');
      const d = this.iso(x + 0.35, y + 0.32, 1.02);
      c.fillStyle = '#5cf08a'; c.fillRect(d.x - 4, d.y - 2, 8, 3);
    }

    yogaMat(x, y, color) {
      this.box(x, y, 0, 0.7, 1.5, 0.02, color, this.shade(color, -25), this.shade(color, -15));
    }

    // The lift on the left wall: doors slide open when someone comes or goes.
    // The company's name on the back wall: a dark panel, a gold frame, the
    // name as big as fits, glowing a little; the floor underneath.
    drawLogo() {
      const L = this.plan.logo;
      if (!L || !this.company) return;
      const P = (x, y, z) => this.iso(x, y, z);
      const t = this.t / 1000;
      // High on the wall, above the desk dividers in front of it.
      this.poly([P(L.x, 0, 1.2), P(L.x + L.w, 0, 1.2), P(L.x + L.w, 0, 2.34), P(L.x, 0, 2.34)], '#c9a24c');
      this.poly([P(L.x + 0.06, 0, 1.26), P(L.x + L.w - 0.06, 0, 1.26), P(L.x + L.w - 0.06, 0, 2.28), P(L.x + 0.06, 0, 2.28)], '#1f2533');
      const px = P(L.x + L.w, 0, 0).x - P(L.x, 0, 0).x;
      this.onWall('y0', L.x + L.w / 2, 1.82, (c) => {
        c.textAlign = 'center'; c.textBaseline = 'middle';
        let size = 26;
        c.font = `900 ${size}px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif`;
        const fit = c.measureText(this.company).width;
        if (fit > px * 0.82) { size = Math.max(10, Math.floor(size * px * 0.82 / fit)); c.font = `900 ${size}px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif`; }
        c.shadowColor = '#ffcf6b';
        c.shadowBlur = 10 + Math.sin(t * 2) * 3;
        c.fillStyle = '#ffd98a';
        c.fillText(this.company, 0, 0);
        c.shadowBlur = 0;
        c.font = '700 8px ui-sans-serif, system-ui, sans-serif';
        c.fillStyle = 'rgba(255,217,138,.7)';
        c.fillText(this.plan.floor === 2 ? '2F  LOUNGE' : '1F  OFFICE', 0, size * 0.62 + 3);
      });
    }

    // Holiday decorations on free floor near the way in: a Christmas tree
    // with presents, pumpkins, or red lanterns hanging overhead.
    decorate({ W, D, OW, PY, grid, pois, prop, solid, add, entry, lift, seats = [], spots: given = null }) {
      const season = this.seasonOverride !== undefined ? this.seasonOverride : seasonOf();
      this.season = season;
      if (!season) return;
      const clear = (x, y, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([a, b]) => !grid.blocked(x + a, y + b))
        && pois.every((q) => Math.hypot(q.x - x, q.y - y) > 0.75)
        && seats.every((q) => Math.hypot(q.x - x, q.y - y) > 1.0)
        && Math.hypot(entry.x - x, entry.y - y) > 1.1 && Math.hypot(lift.x - x, lift.y - y) > 1.1;
      const spots = given || [[1.3, D - 2.3], [1.2, D - 0.6], [OW - 0.8, D - 1.7], [OW - 3.2, D - 0.6], [2.4, D - 0.6], [W - 0.9, PY - 0.5],
        [OW / 2, D - 0.6], [1.2, 2.2], [OW - 0.9, 3.4], [W - 0.8, D - 1.8]];
      const pick = (n, r) => {
        const out = [];
        for (const [x, y] of spots) if (out.length < n && clear(x, y, r) && out.every((o) => Math.hypot(o.x - x, o.y - y) > 1.2)) out.push({ x, y });
        return out;
      };
      if (season === 'xmas') {
        for (const at of pick(1, 0.45)) {
          prop('deco', { kind: 'tree', ...at });
          solid(at.x - 0.35, at.y - 0.35, 0.7, 0.7, 0.05);
          add(at.x + at.y + 0.3, () => this.xmasTree(at.x, at.y));
        }
      } else if (season === 'halloween') {
        for (const at of pick(3, 0.25)) {
          prop('deco', { kind: 'pumpkin', ...at });
          solid(at.x - 0.2, at.y - 0.2, 0.4, 0.4, 0.04);
          add(at.x + at.y, () => this.pumpkin(at.x, at.y));
        }
      } else if (season === 'lny') {
        // Lanterns hang over the floor: nothing to walk round.
        for (const at of pick(3, 0.2)) {
          prop('deco', { kind: 'lantern', ...at });
          add(at.x + at.y + 2, () => this.lantern(at.x, at.y));
        }
      }
    }

    xmasTree(x, y) {
      const c = this.ctx, t = this.t / 1000;
      this.box(x - 0.08, y - 0.08, 0, 0.16, 0.16, 0.25, '#7a5233', '#5e3f27', '#4c331f');
      const layers = [[0.25, 0.5, 0.95], [0.75, 0.38, 0.75], [1.15, 0.26, 0.55]];
      for (const [z, r, h] of layers) {
        const b = this.iso(x, y, z), top = this.iso(x, y, z + h);
        const rx = r * 32;
        c.fillStyle = '#2f7d46';
        c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(b.x - rx, b.y); c.quadraticCurveTo(b.x, b.y + rx * 0.45, b.x + rx, b.y); c.closePath(); c.fill();
        c.fillStyle = '#3e9a57';
        c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(b.x - rx * 0.15, b.y + rx * 0.2); c.lineTo(b.x + rx, b.y); c.closePath(); c.fill();
        for (let i = 0; i < 5; i++) {
          const k = (i + 0.5) / 5, ox = (k - 0.5) * rx * 1.6, oy = -Math.abs(k - 0.5) * 6;
          c.fillStyle = ['#e0344b', '#ffd23f', '#3b8ee0', '#ffffff', '#ff8c42'][(i + Math.floor(t * 2)) % 5];
          c.beginPath(); c.arc(b.x + ox, b.y - 4 + oy, 1.8, 0, Math.PI * 2); c.fill();
        }
      }
      const star = this.iso(x, y, 1.75);
      c.fillStyle = '#ffd23f';
      c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.5 : 6; c.lineTo(star.x + Math.cos(a) * r, star.y + Math.sin(a) * r); }
      c.closePath(); c.fill();
      // presents
      this.box(x + 0.25, y + 0.15, 0, 0.22, 0.22, 0.18, '#e0344b', '#c22a3e', '#a82234');
      this.box(x - 0.1, y + 0.32, 0, 0.18, 0.18, 0.14, '#3b8ee0', '#2f74bb', '#2862a0');
    }

    pumpkin(x, y) {
      const c = this.ctx, b = this.iso(x, y, 0.16);
      c.fillStyle = '#e8781e';
      for (const dx of [-5, 5, 0]) { c.beginPath(); c.ellipse(b.x + dx, b.y, 7, 6, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#c95f12';
      c.fillRect(b.x - 0.6, b.y - 6, 1.2, 12);
      c.fillStyle = '#4c7a2a'; c.fillRect(b.x - 1, b.y - 9, 2, 4);
      // A face that glows after dark.
      c.fillStyle = night() ? '#ffd23f' : '#5a2a10';
      c.beginPath(); c.moveTo(b.x - 5, b.y - 1); c.lineTo(b.x - 2.5, b.y - 3.5); c.lineTo(b.x - 1, b.y - 1); c.fill();
      c.beginPath(); c.moveTo(b.x + 1, b.y - 1); c.lineTo(b.x + 2.5, b.y - 3.5); c.lineTo(b.x + 5, b.y - 1); c.fill();
      c.beginPath(); c.moveTo(b.x - 4, b.y + 1.5); c.lineTo(b.x + 4, b.y + 1.5); c.lineTo(b.x, b.y + 4); c.fill();
    }

    lantern(x, y) {
      const c = this.ctx, t = this.t / 1000;
      const top = this.iso(x, y, WALL_H), b = this.iso(x, y, 1.75);
      const sway = Math.sin(t * 1.3 + x) * 1.5;
      c.strokeStyle = '#7a5233'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(b.x + sway, b.y - 8); c.stroke();
      c.fillStyle = '#d42a2a';
      c.beginPath(); c.ellipse(b.x + sway, b.y, 8, 7, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,220,120,.35)';
      c.beginPath(); c.ellipse(b.x + sway - 2, b.y - 1, 3, 5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e8b931';
      c.fillRect(b.x + sway - 4, b.y - 8, 8, 2); c.fillRect(b.x + sway - 4, b.y + 6, 8, 2);
      c.fillStyle = '#d42a2a'; c.fillRect(b.x + sway - 0.5, b.y + 8, 1, 6);
    }

    // Left wall (downstairs): the notice board.
    drawBoard() {
      const P = (x, y, z) => this.iso(x, y, z);
      const b = this.plan.board;
      if (!b) return;
      this.poly([P(0, b.y, 0.8), P(0, b.y + b.w, 0.8), P(0, b.y + b.w, 1.6), P(0, b.y, 1.6)], '#8a6a46');
      this.poly([P(0, b.y + 0.05, 0.85), P(0, b.y + b.w - 0.05, 0.85), P(0, b.y + b.w - 0.05, 1.55), P(0, b.y + 0.05, 1.55)], '#c9a26b');
      const n = Math.min(12, this.boardNotes || 0);
      const colors = ['#fff3a3', '#ffd0d8', '#c9f0d0', '#cfe3ff'];
      const fresh = Date.now() - (this.pinnedAt || 0) < 4000;
      for (let i = 0; i < n; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const ny = b.y + 0.13 + col * 0.36, nz = 1.42 - row * 0.22;
        const last = i === n - 1 && fresh;
        this.poly([P(0, ny, nz - 0.16), P(0, ny + 0.26, nz - 0.16), P(0, ny + 0.26, nz), P(0, ny, nz)], last ? '#ffffff' : colors[i % 4]);
      }
      this.onWall('x0', b.y + b.w / 2, 0.72, (c) => {
        c.font = '700 7px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
        c.fillStyle = this.pal.text; c.textAlign = 'center'; c.globalAlpha = 0.7;
        c.fillText(`佈告欄 ${this.boardNotes || 0}`, 0, 0);
      });
    }

    drawLift() {
      const L = this.plan.lift;
      if (!L) return;
      const P = (a, b, z) => this.iso(a, b, z);
      const y0 = L.y - 0.55, y1 = L.y + 0.55;
      this.poly([P(0, y0 - 0.08, 0), P(0, y1 + 0.08, 0), P(0, y1 + 0.08, 1.95), P(0, y0 - 0.08, 1.95)], '#8d939a');
      const since = Date.now() - (this.liftOpen || 0);
      const open = since < 1600 ? Math.sin(Math.min(1, since / 1600) * Math.PI) * 0.45 : 0;
      const mid = L.y;
      this.poly([P(0, mid - open, 0), P(0, mid + open, 0), P(0, mid + open, 1.85), P(0, mid - open, 1.85)], '#2a2a2e');
      this.poly([P(0, y0, 0), P(0, mid - open, 0), P(0, mid - open, 1.85), P(0, y0, 1.85)], '#c3c8ce', '#9aa0a8');
      this.poly([P(0, mid + open, 0), P(0, y1, 0), P(0, y1, 1.85), P(0, mid + open, 1.85)], '#c3c8ce', '#9aa0a8');
      this.onWall('x0', L.y, 2.15, (c) => {
        c.fillStyle = '#1c1c1e'; c.fillRect(-14, -7, 28, 12);
        c.fillStyle = '#ffb347'; c.font = '800 8px ui-sans-serif, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(this.floor === 2 ? '▼ 2F' : '▲ 1F', 0, -1);
      });
    }

    // Unlocked furniture.
    tv(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 1.1, 0.4, 0.42, this.shade(pal.deskTop, -5), pal.deskL, pal.deskR);
      this.box(x + 0.08, y + 0.14, 0.42, 0.94, 0.1, 0.62, '#222', '#1a1a1e', '#2a2a2e');
      // The picture changes now and then.
      const k = Math.floor(this.t / 2600) % 4;
      const col = ['#3b8ee0', '#5f9a4c', '#c96442', '#8b6be6'][k];
      const P = (a, b, z) => this.iso(a, b, z);
      const sy = y + 0.245;
      this.poly([P(x + 0.13, sy, 0.47), P(x + 0.97, sy, 0.47), P(x + 0.97, sy, 0.99), P(x + 0.13, sy, 0.99)], col);
      this.poly([P(x + 0.13, sy, 0.47), P(x + 0.55, sy, 0.47), P(x + 0.55, sy, 0.7), P(x + 0.13, sy, 0.7)], 'rgba(255,255,255,.18)');
    }

    trophyCase(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 0.45, 0.9, 1.25, this.shade(pal.deskTop, 5), pal.deskL, pal.deskR);
      const c = this.ctx;
      const t = this.t / 1000;
      for (let i = 0; i < 3; i++) {
        const b = this.iso(x + 0.22, y + 0.15 + i * 0.3, 1.25);
        const shine = 0.5 + 0.5 * Math.sin(t * 2 + i * 2);
        c.fillStyle = `rgb(${220 + shine * 30},${170 + shine * 40},40)`;
        c.beginPath(); c.moveTo(b.x - 4, b.y - 9); c.lineTo(b.x + 4, b.y - 9); c.lineTo(b.x + 2, b.y - 3); c.lineTo(b.x - 2, b.y - 3); c.closePath(); c.fill();
        c.fillRect(b.x - 0.8, b.y - 3, 1.6, 2.5);
        c.fillRect(b.x - 2.5, b.y - 1, 5, 1.5);
      }
    }

    floorLamp(x, y) {
      const c = this.ctx;
      const b = this.iso(x, y, 0), t = this.iso(x, y, 1.7);
      if (skyColor().night) {
        c.fillStyle = 'rgba(255,220,140,.14)';
        c.beginPath(); c.ellipse(b.x, b.y, 50, 25, 0, 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = '#333'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(t.x, t.y); c.stroke();
      c.fillStyle = '#333'; c.beginPath(); c.ellipse(b.x, b.y, 7, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f3e3b5';
      c.beginPath(); c.moveTo(t.x - 9, t.y + 4); c.lineTo(t.x + 9, t.y + 4); c.lineTo(t.x + 5, t.y - 8); c.lineTo(t.x - 5, t.y - 8); c.closePath(); c.fill();
    }

    vending(x, y, color) {
      this.box(x, y, 0, 0.7, 0.75, 1.85, this.shade(color, 15), this.shade(color, -10), color);
      const P = (a, b, c) => this.iso(a, b, c);
      const fx = x + 0.7;
      this.poly([P(fx, y + 0.08, 0.7), P(fx, y + 0.55, 0.7), P(fx, y + 0.55, 1.7), P(fx, y + 0.08, 1.7)], 'rgba(20,30,40,.75)');
      const cols = ['#f2d16b', '#5cf08a', '#ff8a65', '#81d4fa', '#ce93d8'];
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 3; k++) {
          const q = P(fx, y + 0.15 + k * 0.14, 1.55 - r * 0.23);
          this.ctx.fillStyle = cols[(r * 3 + k + Math.round(y)) % cols.length];
          this.ctx.fillRect(q.x - 1.5, q.y - 4, 3, 5);
        }
      }
      this.poly([P(fx, y + 0.1, 0.25), P(fx, y + 0.5, 0.25), P(fx, y + 0.5, 0.45), P(fx, y + 0.1, 0.45)], '#222');
      const glow = P(fx, y + 0.65, 1.2);
      this.ctx.fillStyle = Math.sin(this.t / 700 + y) > 0 ? '#9ef' : '#4ad';
      this.ctx.fillRect(glow.x - 1, glow.y - 3, 2, 6);
    }

    foosball(x, y) {
      for (const [lx, ly] of [[0.1, 0.1], [1.42, 0.1], [0.1, 0.62], [1.42, 0.62]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.6, '#5a4030', '#5a4030', '#4a3428');
      this.box(x, y, 0.6, 1.6, 0.8, 0.25, '#2f8a4a', '#6e533b', '#5c4431');
      const P = (a, b, c) => this.iso(a, b, c);
      const players = this.plan && this.plan.pois.filter((q) => q.pair === 'fb' && q.taken).length === 2;
      for (let k = 0; k < 6; k++) {
        const rx = x + 0.2 + k * 0.24;
        const shift = players ? Math.sin(this.t / 120 + k) * 0.06 : 0;
        const a = P(rx, y - 0.15, 0.82), b = P(rx, y + 0.95, 0.82);
        this.ctx.strokeStyle = '#c8ccd0'; this.ctx.lineWidth = 1.2;
        this.ctx.beginPath(); this.ctx.moveTo(a.x, a.y); this.ctx.lineTo(b.x, b.y); this.ctx.stroke();
        for (let m = 0; m < 2; m++) {
          const q = P(rx, y + 0.25 + m * 0.3 + shift, 0.82);
          this.ctx.fillStyle = k % 2 ? '#c0392b' : '#2f6fb0';
          this.ctx.fillRect(q.x - 1.5, q.y - 3, 3, 6);
        }
      }
    }

    booth(add, x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const pal = this.pal;
      const H = 2.0;
      // back walls (felt panels), then the stool, then glass front
      add(x + 0.65 + y + 0.05, () => {
        this.poly([P(x, y, 0), P(x + 1.3, y, 0), P(x + 1.3, y, H), P(x, y, H)], pal.dark ? '#3c4a5a' : '#9fb3c8');
        this.poly([P(x, y, 0), P(x, y + 1.3, 0), P(x, y + 1.3, H), P(x, y, H)], pal.dark ? '#34404e' : '#8ea3b8');
        this.poly([P(x + 0.02, y + 0.02), P(x + 1.28, y + 0.02), P(x + 1.28, y + 1.28), P(x + 0.02, y + 1.28)], pal.dark ? '#2a323b' : '#d8dee5');
        const lamp = P(x + 0.65, y + 0.65, H - 0.05);
        this.ctx.fillStyle = 'rgba(255,230,160,.9)';
        this.ctx.beginPath(); this.ctx.ellipse(lamp.x, lamp.y, 8, 4, 0, 0, Math.PI * 2); this.ctx.fill();
        this.stool(x + 0.65, y + 0.6, 0.43, '#c96442');
      });
      add(x + 1.3 + y + 0.65 + 0.3, () => {
        this.poly([P(x + 1.3, y, 0), P(x + 1.3, y + 1.3, 0), P(x + 1.3, y + 1.3, H), P(x + 1.3, y, H)], pal.glass, pal.glassEdge);
        this.poly([P(x, y + 1.3, 0), P(x + 1.3, y + 1.3, 0), P(x + 1.3, y + 1.3, H), P(x, y + 1.3, H)], pal.glass, pal.glassEdge);
        this.poly([P(x + 0.85, y + 1.3, 0), P(x + 0.87, y + 1.3, 0), P(x + 0.87, y + 1.3, H), P(x + 0.85, y + 1.3, H)], pal.glassEdge);
        this.box(x - 0.03, y - 0.03, H, 1.36, 1.36, 0.08, pal.dark ? '#4a5868' : '#b5c4d3', pal.trim, pal.trim);
      });
    }

    desk(dk, p) {
      const pal = this.pal;
      const { x, y } = dk;
      // The same desk as in 3D: an oak top on two white side panels, with a
      // little drawer unit.
      const panel = pal.panel, pL = this.shade(panel, -8), pR = this.shade(panel, -18);
      for (const lx of [0.04, 1.3]) this.box(x + lx, y + 0.06, 0, 0.06, 0.68, 0.72, panel, pL, pR);
      this.box(x + (dk.side === 's' ? 0.88 : 0.18), y + 0.12, 0.08, 0.34, 0.56, 0.5, panel, pL, pR);
      this.box(x, y, 0.72, 1.4, 0.8, 0.07, pal.deskTop, this.shade(pal.deskTop, -16), this.shade(pal.deskTop, -26));
      const worker = p && p.mode === 'work' ? p : null;
      if (dk.side === 's') {
        const mx = x + 0.42, my = y + 0.1, mz = 0.79;
        this.box(mx + 0.22, my + 0.04, mz, 0.1, 0.1, 0.18, pal.monitor, pal.monitor, pal.monitor);
        this.box(mx, my, mz + 0.18, 0.56, 0.08, 0.42, pal.monitor, pal.monitor, this.shade(pal.monitor, 10));
        this.screen(mx + 0.04, my + 0.08, mz + 0.22, 0.48, 0.34, worker);
        this.box(x + 0.48, y + 0.48, 0.79, 0.44, 0.16, 0.025, '#d8d8d8', '#aaa', '#999');
      } else {
        // We see this monitor from behind; a status LED on its back.
        const mx = x + 0.42, my = y + 0.6, mz = 0.79;
        this.box(x + 0.48, y + 0.16, 0.79, 0.44, 0.16, 0.025, '#d8d8d8', '#aaa', '#999');
        this.box(mx + 0.22, my - 0.02, mz, 0.1, 0.1, 0.18, pal.monitor, pal.monitor, pal.monitor);
        this.box(mx, my, mz + 0.18, 0.56, 0.08, 0.42, this.shade(pal.monitor, 15), this.shade(pal.monitor, 8), this.shade(pal.monitor, 12));
        if (worker) {
          const g = this.iso(mx + 0.28, my + 0.08, mz + 0.5);
          this.ctx.fillStyle = STATUS_COLOR[worker.s.status] || '#888';
          this.ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t / 400 + worker.phase);
          this.ctx.beginPath(); this.ctx.arc(g.x, g.y, 1.8, 0, Math.PI * 2); this.ctx.fill();
          this.ctx.globalAlpha = 1;
        }
      }
      // personal touches, stable per desk
      const h = hash(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (h % 3 === 0) this.box(x + 1.12, y + 0.3, 0.79, 0.12, 0.12, 0.13, '#f2f2f2', '#d0d0d0', '#bbb');
      if (h % 5 === 1) {
        this.box(x + 0.14, y + 0.24, 0.79, 0.12, 0.12, 0.08, pal.pot, pal.pot, this.shade(pal.pot, -15));
        const q = this.iso(x + 0.2, y + 0.3, 0.87);
        this.ctx.fillStyle = pal.plant;
        this.ctx.beginPath(); this.ctx.ellipse(q.x, q.y - 4, 4, 6, 0, 0, Math.PI * 2); this.ctx.fill();
      }
      if (h % 4 === 2) this.box(x + 0.12, y + 0.45, 0.79, 0.22, 0.15, 0.05, '#f2d16b', '#d9b84f', '#c4a33f');
    }

    screen(x, y, z, w, h, p) {
      const P = (a, b, cc) => this.iso(a, b, cc);
      const st = p ? p.s.status : 'off';
      const kind = p && this.plan.zones ? workKind(p.s) : null;
      const base = kind === 'shell' ? '#0b1510' : kind === 'read' ? '#d9d6cc' : kind === 'chat' ? '#1d2a3a'
        : { thinking: '#3a3160', tool: '#14324f', typing: '#123d2e', waiting: '#4d3510', error: '#4a1612' }[st] || this.pal.screenOff;
      const corners = [P(x, y, z), P(x + w, y, z), P(x + w, y, z + h), P(x, y, z + h)];
      this.poly(corners, base);
      if (!p) return;
      const c = this.ctx;
      c.save();
      c.beginPath();
      corners.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
      c.clip();
      const t = this.t / 1000;
      const col = STATUS_COLOR[st];
      const line = (zz, x0, len, color, lw = 1.5) => {
        const a = P(x + x0, y, zz), b = P(x + x0 + Math.min(len, w - x0 - 0.05), y, zz);
        c.strokeStyle = color; c.lineWidth = lw;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      };
      const rows = (speed, color) => {
        const scroll = (t * speed + p.phase) % 1;
        for (let i = -1; i < 6; i++) {
          const zz = z + h - 0.05 - ((i + scroll) * h) / 5;
          const len = 0.12 + ((p.h >> ((i + 8) & 15)) % 7) / 20;
          line(zz, 0.05, len, color(i));
        }
      };
      if (kind === 'shell') {
        // Terminal: green output streaming, a blinking cursor at the bottom.
        rows(longRun(p.s) ? 0.25 : 2.6, (i) => (i % 4 === 0 ? '#9dffb0' : 'rgba(80,220,120,.75)'));
        if (Math.sin(t * 6) > 0) line(z + 0.06, 0.06, 0.06, '#9dffb0', 2.5);
      } else if (kind === 'edit') {
        // Code: indented, colourful lines.
        const CODE = ['#c678dd', '#61afef', '#e5c07b', '#98c379', 'rgba(255,255,255,.7)'];
        const scroll = (t * 0.6 + p.phase) % 1;
        for (let i = -1; i < 6; i++) {
          const zz = z + h - 0.05 - ((i + scroll) * h) / 5;
          const indent = 0.05 + ((p.h >> (i & 7)) % 3) * 0.06;
          line(zz, indent, 0.08, CODE[(i + 5) % 5]);
          line(zz, indent + 0.1, 0.06 + ((p.h >> ((i + 3) & 15)) % 5) / 25, CODE[(i + 7) % 5]);
        }
      } else if (kind === 'read') {
        // A page being read: grey text, a highlight sliding down it.
        rows(0.35, () => 'rgba(60,60,60,.6)');
        const hl = ((t * 0.3 + p.phase) % 1) * h;
        line(z + h - 0.08 - hl, 0.04, w - 0.08, 'rgba(255,200,40,.55)', 3);
      } else if (kind === 'chat') {
        // Messages going back and forth.
        const n = Math.floor(t * 1.2 + p.phase) % 4;
        for (let i = 0; i < 4; i++) {
          const zz = z + h - 0.1 - (i * h) / 4.5;
          const mine = (i + n) % 2 === 0;
          line(zz, mine ? w * 0.45 : 0.06, w * 0.4, mine ? '#4fa3ff' : 'rgba(255,255,255,.75)', 3);
        }
      } else if (kind === 'plan') {
        // A checklist ticking off.
        const done = Math.floor(t * 0.8 + p.phase) % 5;
        for (let i = 0; i < 4; i++) {
          const zz = z + h - 0.12 - (i * h) / 4.5;
          line(zz, 0.06, 0.04, i < done ? '#5f9a4c' : 'rgba(255,255,255,.5)', 3);
          line(zz, 0.14, w * 0.45, 'rgba(255,255,255,.6)');
        }
      } else if (kind === 'agent') {
        // Handing work out: arrows going off to the side.
        const k = (t * 0.9 + p.phase) % 1;
        for (let i = 0; i < 3; i++) line(z + h * (0.25 + i * 0.25), 0.06 + k * (w - 0.3), 0.14, i === 1 ? col : 'rgba(255,255,255,.7)', 2.5);
      } else if (st === 'tool' || st === 'typing') {
        const scroll = (t * (st === 'tool' ? 2.2 : 1.2) + p.phase) % 1;
        for (let i = -1; i < 6; i++) {
          const zz = z + h - 0.05 - ((i + scroll) * h) / 5;
          const len = 0.12 + ((p.h >> ((i + 8) & 15)) % 7) / 20;
          const a = P(x + 0.05, y, zz), b = P(x + 0.05 + Math.min(len, w - 0.1), y, zz);
          c.strokeStyle = i % 3 === 0 ? col : 'rgba(255,255,255,.55)';
          c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
      } else {
        const m = P(x + w / 2, y, z + h / 2);
        c.fillStyle = col;
        c.globalAlpha = st === 'thinking' ? 0.5 + 0.4 * Math.sin(t * 3 + p.phase) : 0.9;
        c.font = '700 10px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText({ thinking: '…', waiting: '?', error: '!' }[st] || '', m.x, m.y);
      }
      c.restore();
      c.save();
      c.globalAlpha = 0.18;
      const g = P(x + w / 2, y + 0.35, 0.8);
      c.fillStyle = col;
      c.beginPath(); c.ellipse(g.x, g.y, 18, 7, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    chair(dk, p) {
      const pal = this.pal;
      const sx = dk.seat.x - 0.25, sy = dk.seat.y - 0.22;
      const seated = p && !p.path.length && p.pose === 'sit' && Math.hypot(p.x - dk.seat.x, p.y - dk.seat.y) < 0.05;
      const ox = seated ? 0 : 0.12, oy = seated ? 0 : dk.side === 's' ? 0.18 : -0.18;
      this.box(sx + 0.22 + ox, sy + 0.19 + oy, 0, 0.06, 0.06, 0.32, '#222', '#222', '#111');
      if (dk.side === 'n') this.box(sx + ox, sy + oy - 0.05, 0.4, 0.5, 0.07, 0.55, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
      this.box(sx + ox, sy + oy, 0.32, 0.5, 0.45, 0.08, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
      if (dk.side === 's' && !seated) this.box(sx + ox, sy + oy + 0.4, 0.4, 0.5, 0.07, 0.5, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
    }

    // ------------------------------------------------------------ people

    // Poked (double-clicked): a moment of reaction on top of whatever they do.
    stateOf(p) {
      const st = this.stateNow(p);
      if (p.poke && Date.now() < p.poke.until && !p.held && st.pose !== 'walk') return { ...st, act: st.pose === 'sit' && p.poke.act === 'dazed' ? 'wave' : p.poke.act };
      return st;
    }

    stateNow(p) {
      const s = p.s || {};
      if (p.visitor) {
        if (p.path.length) return { pose: 'walk', face: p.walkFace, act: null, sitZ: 0 };
        return { pose: 'stand', face: 'back', act: p.stage === 'talk' ? 'chat' : 'lookaround', sitZ: 0 };
      }
      if (p.me) {
        if (p.moving) return { pose: 'walk', face: p.walkFace, act: null, sitZ: 0 };
        if (p.seated) return { pose: 'sit', face: 'back', act: 'type', sitZ: 0.34 };
        return { pose: 'stand', face: 'front', act: 'lookaround', sitZ: 0 };
      }
      if (p.held) return { pose: 'held', face: 'front', act: 'held', sitZ: HOLD_Z };
      if (p.landed) return { pose: 'stand', face: 'front', act: 'dazed', sitZ: 0 };
      if (p.path.length) return { pose: 'walk', face: p.walkFace, act: (p.run && p.run.carry) || (p.poi && p.poi.carry) ? 'carry' : p.rush > Date.now() ? 'run' : null, sitZ: 0 };
      if (p.seeOff && !p.path.length) return { pose: 'stand', face: 'front', act: p.seeOff.stage === 'bye' ? 'wave' : 'lookaround', sitZ: 0 };
      // On the way to a meeting but stopped somewhere: standing, not sitting at a desk.
      if (p.meeting && !this.atSeat(p) && !p.path.length) return { pose: 'stand', face: 'front', act: 'lookaround', sitZ: 0 };
      if (p.meeting && this.atSeat(p)) {
        const m = p.meeting;
        return { pose: 'sit', face: m.seat.face, act: m.speaker === p.key ? 'chat' : m.start ? 'write' : 'lookaround', sitZ: m.seat.sit || 0.42 };
      }
      if (p.visit) {
        const mate = this.people.get(p.visit.mate);
        return { pose: 'stand', face: 'front', act: mate && mate.chatWith === p.key ? 'chat' : 'lookaround', sitZ: 0 };
      }
      if (p.errand) return { pose: 'stand', face: 'front', act: 'clipboard', sitZ: 0 };
      if (p.mode === 'work' && p.run) {
        const q = p.run.poi;
        if (p.run.trip) return { pose: q.sit ? 'sit' : 'stand', face: q.face === 'side' ? 'front' : q.face, act: p.run.act, sitZ: q.sit || 0 };
        return { pose: 'stand', face: q.face, act: q.act === 'water' ? 'water' : 'coffee', sitZ: 0 };
      }
      if (p.mode === 'work' && p.desk) {
        const face = p.desk.side === 'n' ? 'front' : 'back';
        // Not really working, but the boss is in: look busy.
        if (this.bossIn && this.plan.zones && zoneOf(s) !== 'work') {
          const t = (this.t || 0) / 1000;
          return { pose: 'sit', face, act: ['typefast', 'deskread', 'typefast', 'write', 'type'][Math.floor((t + p.phase * 3) / 3) % 5], sitZ: 0.34 };
        }
        if (s.status === 'waiting' || s.status === 'error') return { pose: 'stand', face, act: 'wave', sitZ: 0 };
        if (p.desk.pose === 'stand') return { pose: 'stand', face, act: 'station', sitZ: 0 };
        // Jumps up to cheer, or holds their head.
        if (p.react && Date.now() < p.react.until) return { pose: 'stand', face, act: p.react.act, sitZ: 0 };
        if (!this.plan.zones) return { pose: 'sit', face, act: s.status === 'tool' || s.status === 'typing' ? 'type' : 'think', sitZ: 0.34 };
        const kind = workKind(s);
        const t = this.t / 1000;
        let act;
        if (kind === 'think') act = ['think', 'chin', 'scratch', 'lookup'][Math.floor((t + p.phase * 3) / 4) % 4];
        else if ((kind === 'shell' || kind === 'agent') && longRun(s)) act = 'leanback';
        else if (s.task === 'test' || s.task === 'build') act = 'chin'; // watching it run
        else act = { reply: 'type', edit: 'typefast', shell: 'type', read: 'deskread', agent: 'point', chat: 'phone', plan: 'write' }[kind];
        // Someone came over to talk.
        const guest = p.chatWith && this.people.get(p.chatWith);
        if (guest && guest.visit && guest.visit.mate === p.key && !guest.path.length) return { pose: 'sit', face, act: 'chat', sitZ: 0.34 };
        // Nobody works without a break: a stretch, a sip, a neck roll now and then.
        const cyc = (t + p.phase * 5) % 26;
        const owl = this.traits(p).some((tr) => tr.owl);
        const breaks = lunch() ? ['eat', 'eat', 'sip'] : (night() && !owl) || (owl && hour() < 11) ? ['yawn', 'stretch', 'sip'] : ['stretch', 'sip', 'neck'];
        if (cyc < (lunch() ? 6 : 2.4) && kind !== 'reply') act = breaks[Math.floor((t + p.phase * 5) / 26) % 3];
        return { pose: 'sit', face, act, sitZ: 0.34 };
      }
      if (p.mode === 'wander' && p.poi && p.pretend && !p.path.length) {
        const q = p.poi;
        return { pose: q.sit ? 'sit' : 'stand', face: q.face === 'side' ? 'front' : q.face, act: p.pretendAct || 'clipboard', sitZ: q.sit || 0 };
      }
      if (p.mode === 'wander' && p.poi && p.standupSpot && !p.path.length) {
        const q = p.poi, talking = this.standup && this.standup.speaker === p.key;
        return { pose: q.sit ? 'sit' : 'stand', face: q.face, act: talking ? 'chat' : q.sit ? 'meeting' : 'lookaround', sitZ: q.sit || 0 };
      }
      if (p.mode === 'wander' && p.poi) {
        const q = p.poi;
        let act = q.act;
        if (q.sit && SEAT_ACTS[q.act]) act = this.seatAct(p, q);
        if (p.zone === 'wait' && q.act === 'meeting') act = 'tap';
        if (q.act === 'stool' && (lunch() || this.cakeUntil > Date.now())) act = 'eat';
        if (q.act === 'slot' && this.slot && this.slot.player === p.key && this.slot.winUntil > this.t) act = 'cheer';
        if (q.act === 'chat') {
          const mate = this.people.get(q.partner);
          if (!mate || mate.chatWith !== p.key) act = 'lookaround';
        }
        // Being talked to: turn to them and chat back.
        if (p.chatWith) {
          const mate = this.people.get(p.chatWith);
          if (mate && !mate.path.length && ((mate.poi && mate.poi.partner === p.key) || (mate.visit && mate.visit.mate === p.key))) act = 'chat';
        }
        if (p.zone === 'error') act = 'scratch';
        // In line: the one at the front knocks on your desk after 10 minutes.
        if (q.act === 'queue') act = p.queue === 0 && waitedMs(s) > KNOCK_MS ? 'knock' : 'lookaround';
        // Waiting a while: hold up a sign (unless talking or looking out the door).
        if (p.zone === 'wait' && act !== 'knock' && act !== 'chat' && act !== 'peek' && waitedMs(s) > SIGN_MS) act = 'sign';
        return { pose: q.sit ? 'sit' : 'stand', face: q.face === 'side' ? 'front' : q.face, act, sitZ: q.sit || q.lift || 0 };
      }
      return { pose: 'stand', face: 'front', act: null, sitZ: 0 };
    }

    // Hair in 2D, one of the thirteen styles. Called twice: `back` before the
    // head is drawn (what hangs behind it), then after (what sits on top).
    // `face`: seen from the front (otherwise the back of the head).
    hair2d(p, hy, R, face, back) {
      const c = this.ctx, st = p.hairStyle || 0;
      const blob = (x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill(); };
      const tri = (x, y, a, len, w) => { c.beginPath(); c.moveTo(x + Math.cos(a + Math.PI / 2) * w, y + Math.sin(a + Math.PI / 2) * w); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.lineTo(x - Math.cos(a + Math.PI / 2) * w, y - Math.sin(a + Math.PI / 2) * w); c.fill(); };
      c.fillStyle = p.hair;
      if (back) {
        if (st === 4) blob(R * 0.75, hy + R * 0.35, 3, 6.5, -0.4); // ponytail
        if (st === 5) for (const s of [-1, 1]) blob(s * (R + 1.5), hy + 3, 3.2, 7, s * 0.3); // twin tails
        if (st === 6) this.roundRect(-R - 1, hy - 2, R * 2 + 2, R + 7, 4, p.hair); // long hair down the back
        return;
      }
      if (st === 11) { // knitted beanie with a bobble
        const knit = this.shade(p.shirt, 28);
        c.fillStyle = knit;
        c.beginPath(); c.arc(0, hy - 1, R + 0.8, Math.PI, Math.PI * 2); c.fill();
        this.roundRect(-R - 1, hy - 3.5, R * 2 + 2, 3.5, 1.5, this.shade(knit, -18));
        c.fillStyle = '#f2ead8'; blob(0, hy - R - 2.5, 2.8, 2.8);
        if (!face) { c.fillStyle = p.hair; c.fillRect(-R + 1.5, hy, R * 2 - 3, 4); }
        return;
      }
      if (!face) { // the back of the head: all hair
        c.beginPath(); c.arc(0, hy - 0.5, R + 0.3, 0, Math.PI * 2); c.fill();
      } else {
        const thin = st === 10;
        c.beginPath(); c.arc(0, hy - 1.5, R + (thin ? 0 : 0.4), Math.PI * (thin ? 1.12 : 1.02), Math.PI * (thin ? 1.88 : 1.98)); c.fill();
        if (!thin) { blob(-R * 0.45, hy - R * 0.38, R * 0.42, 2.2, 0.25); blob(R * 0.4, hy - R * 0.4, R * 0.45, 2.2, -0.2); } // fringe
      }
      switch (st) {
        case 1: if (face) { c.fillRect(-R - 0.4, hy - 2.5, 3.2, 9); c.fillRect(R - 2.8, hy - 2.5, 3.2, 9); } else c.fillRect(-R + 0.5, hy, R * 2 - 1, 7); break; // bob
        case 2: blob(0, hy - R - 1.5, 3.8, 3.8); break; // bun
        case 3: for (let i = 0; i < 5; i++) tri(-6 + i * 3, hy - R + 1 + Math.abs(i - 2) * 1.2, -Math.PI / 2 + (i - 2) * 0.35, 5.5, 1.8); break; // spikes
        case 5: c.fillStyle = '#e0525a'; for (const s of [-1, 1]) blob(s * (R - 0.5), hy - 3.5, 1.5, 1.5); break; // twin tails' ties
        case 6: if (face) { c.fillRect(-R - 0.6, hy - 2.5, 3.4, 11); c.fillRect(R - 2.8, hy - 2.5, 3.4, 11); } break; // long
        case 7: for (let i = 0; i < 9; i++) { const a = Math.PI * (0.92 + i * 0.145); blob(Math.cos(a) * R, hy - 1 + Math.sin(a) * R, 3.2, 3.2); } break; // curly
        case 8: if (face) blob(-R * 0.35, hy - R * 0.55, 6.5, 3.2, -0.35); break; // side swoop
        case 9: for (const s of [-1, 1]) blob(s * R * 0.68, hy - R * 0.82, 3.4, 3.4); break; // space buns
        case 10: for (let i = 0; i < 5; i++) tri(0, hy - R + 2 + i * 0.2, -Math.PI / 2 + (i - 2) * 0.32, 6.5, 2); break; // mohawk
        case 12: for (const [x, a] of [[-5, -2.2], [-1, -1.7], [3, -1.2], [6, -0.7]]) tri(x, hy - R + 2 + Math.abs(x) * 0.3, a, 4.5, 1.6); break; // messy
        default: break;
      }
    }

    person(p) {
      const c = this.ctx;
      const t = this.t / 1000;
      const s = p.s || {};
      const st = this.stateOf(p);
      p.pose = st.pose;
      const moving = st.pose === 'walk' || st.act === 'run';
      const held = st.pose === 'held';
      const seated = st.pose === 'sit';
      const front = st.face !== 'back';
      const b = this.iso(p.x, p.y, st.sitZ);
      const step = moving ? Math.sin(t * (st.act === 'run' ? 18 : 12) + p.phase) : 0;
      const bob = moving ? Math.abs(step) * 1.5 : 0;

      const fb = this.iso(p.x, p.y, 0);
      c.fillStyle = this.pal.shadow;
      c.beginPath(); c.ellipse(fb.x, fb.y, held ? 7 : 10, held ? 3.5 : 5, 0, 0, Math.PI * 2); c.fill();
      // Roaming about: a ring at their feet in their state's colour.
      const ring = p.mode === 'wander' && { wait: STATUS_COLOR.waiting, error: STATUS_COLOR.error, done: STATUS_COLOR.done }[p.zone];
      if (ring && !held) {
        c.strokeStyle = ring;
        c.globalAlpha = 0.45 + 0.35 * Math.sin(t * 3 + p.phase);
        c.lineWidth = 2;
        c.beginPath(); c.ellipse(fb.x, fb.y, 12, 6, 0, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      }
      // Today's best: a gold ring at their feet.
      if (this.bestKey === p.key && !held) {
        c.strokeStyle = '#e8b931';
        c.lineWidth = 2.5;
        c.beginPath(); c.ellipse(fb.x, fb.y, 13 + Math.sin(t * 2) * 1, 6.5, 0, 0, Math.PI * 2); c.stroke();
      }
      if (this.dropOn === p.key) {
        c.strokeStyle = '#8b6be6';
        c.lineWidth = 3;
        const r = 16 + Math.sin(t * 8) * 2;
        c.beginPath(); c.ellipse(fb.x, fb.y, r, r / 2, 0, 0, Math.PI * 2); c.stroke();
      }
      if (this.hoverKey === p.key) {
        c.strokeStyle = STATUS_COLOR[s.status] || '#888';
        c.lineWidth = 2;
        c.beginPath(); c.ellipse(fb.x, fb.y, 14, 7, 0, 0, Math.PI * 2); c.stroke();
      }

      let x = b.x;
      const y = b.y - bob;
      if (st.act === 'pingpong') x += Math.sin(t * 7 + p.phase) * 4;
      if (st.act === 'foosball') x += Math.sin(t * 5 + p.phase) * 1.5;
      const sc = s.subagent ? 0.8 : 1;
      c.save();
      c.translate(x, y);
      c.scale(sc, sc);
      if (held) { c.translate(0, -30); c.rotate(Math.sin(t * 5 + p.phase) * 0.14); c.translate(0, 30); }
      // Landing: a little squash.
      if (p.landed && Date.now() - p.landed < 250) c.scale(1.12, 0.88);

      c.fillStyle = p.pants;
      if (seated) {
        c.fillRect(-5, -4, 4, 5);
        c.fillRect(1, -4, 4, 5);
      } else {
        // Dangling legs kick when held.
        const leg = held ? Math.sin(t * 11 + p.phase) * 2 : step * 2;
        c.fillRect(-5.5, -7, 5, 7 + leg);
        c.fillRect(0.5, -7, 5, 7 - leg);
        c.fillStyle = '#2a2a2a';
        c.fillRect(-6, -1.5 + leg, 6, 2.5);
        c.fillRect(0, -1.5 - leg, 6, 2.5);
      }
      const hip = seated ? -4 : -7;
      // Shirt with light from the upper left, and a soft outline.
      {
        const g = c.createLinearGradient(-8, hip - 13, 8, hip + 1);
        g.addColorStop(0, this.shade(p.shirt, 18)); g.addColorStop(1, this.shade(p.shirt, -14));
        this.roundRect(-8, hip - 13, 16, 14, 4.5, g);
        c.strokeStyle = 'rgba(43,36,32,.5)'; c.lineWidth = 0.9; c.stroke();
        c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(-7, hip - 1.5, 14, 1.5);
      }
      // What their level lets them wear: a lanyard, then a tie.
      const lv = s.level || 1;
      if (front && lv >= 4) {
        c.fillStyle = '#b03a2e';
        c.beginPath(); c.moveTo(-1.6, hip - 13); c.lineTo(1.6, hip - 13); c.lineTo(1.2, hip - 11.5); c.lineTo(2.2, hip - 4); c.lineTo(0, hip - 2); c.lineTo(-2.2, hip - 4); c.lineTo(-1.2, hip - 11.5); c.closePath(); c.fill();
      } else if (front && lv >= 2) {
        c.strokeStyle = '#3b8ee0'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(-3.5, hip - 13); c.lineTo(0, hip - 6.5); c.lineTo(3.5, hip - 13); c.stroke();
        c.fillStyle = '#fafafa'; c.fillRect(-2.2, hip - 7, 4.4, 5);
        c.fillStyle = '#3b8ee0'; c.fillRect(-2.2, hip - 7, 4.4, 1.2);
      }
      const arm = this.shade(p.shirt, -18);
      const hand = (hx, hy) => { c.fillStyle = p.skin; c.beginPath(); c.arc(hx, hy, 2.2, 0, Math.PI * 2); c.fill(); };
      c.fillStyle = arm;
      const sip = Math.sin(t * 0.9 + p.phase) > 0.6;
      switch (st.act) {
        case 'held': {
          // Arms flailing.
          const k = Math.sin(t * 13 + p.phase) * 3;
          c.fillRect(-13, hip - 24 + k, 3, 13);
          c.fillRect(10, hip - 24 - k, 3, 13);
          hand(-11.5, hip - 25 + k); hand(11.5, hip - 25 - k);
          break;
        }
        case 'clipboard': {
          // Holding up a clipboard with the news.
          c.fillRect(-9, hip - 14, 3, 8);
          c.fillRect(6, hip - 14, 3, 8);
          c.fillStyle = '#a7743f'; c.fillRect(-7, hip - 19, 14, 15);
          c.fillStyle = '#fafafa'; c.fillRect(-5.5, hip - 16, 11, 11);
          c.fillStyle = '#9aa0a8'; for (let i = 0; i < 4; i++) c.fillRect(-4, hip - 14 + i * 2.5, 8 - (i % 2) * 3, 1);
          c.fillStyle = '#6b6f76'; c.fillRect(-2.5, hip - 20, 5, 2);
          break;
        }
        case 'sign': {
          // Holding up a sign over their head, bobbing it.
          const k = Math.abs(Math.sin(t * 3 + p.phase)) * 2;
          c.fillRect(-12, hip - 30 - k, 3, 19 + k);
          c.fillRect(9, hip - 30 - k, 3, 19 + k);
          this.roundRect(-14, hip - 44 - k, 28, 14, 2, '#fffdf4', STATUS_COLOR.waiting);
          c.fillStyle = STATUS_COLOR.waiting;
          c.font = '800 8px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('等你！', 0, hip - 36.5 - k);
          break;
        }
        case 'knock': {
          // Knocking on the glass between you and them.
          const k = Math.sin(t * 9 + p.phase) > 0 ? 1 : 0;
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 21 + k * 2, 3, 10);
          hand(6.5, hip - 22 + k * 2);
          if (k) {
            c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1;
            c.beginPath(); c.arc(6.5, hip - 22, 4 + (t * 20 % 4), 0, Math.PI * 2); c.stroke();
          }
          break;
        }
        case 'yoga': {
          // Arms out to the sides, slowly rising and falling.
          const k = Math.sin(t * 0.8 + p.phase) * 3;
          c.fillRect(-17, hip - 13 - k, 10, 3);
          c.fillRect(7, hip - 13 - k, 10, 3);
          hand(-17, hip - 11.5 - k); hand(17, hip - 11.5 - k);
          break;
        }
        case 'stretch': {
          const k = Math.sin(t * 2 + p.phase) * 1;
          c.fillRect(-12, hip - 27 + k, 3, 15);
          c.fillRect(9, hip - 27 - k, 3, 15);
          hand(-10.5, hip - 28 + k); hand(10.5, hip - 28 - k);
          break;
        }
        case 'sip': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 16, 3, 7);
          c.fillStyle = '#fafafa'; c.fillRect(4, hip - 21, 5, 6);
          c.fillStyle = '#6b3f22'; c.fillRect(5, hip - 21, 3, 1.5);
          break;
        }
        case 'neck': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 22, 3, 11);
          hand(5, hip - 22);
          break;
        }
        case 'eat': {
          const k = Math.sin(t * 4 + p.phase) > 0.2 ? 1 : 0;
          c.fillRect(-9, hip - 11, 3, 8);
          c.fillRect(5, hip - 12 - k * 6, 3, 8);
          c.fillStyle = '#c9773a'; c.fillRect(-6, hip - 6, 12, 4);
          c.fillStyle = '#fff'; c.fillRect(-5, hip - 7, 10, 1.5);
          break;
        }
        case 'chat': {
          // Talking with their hands.
          const k = Math.sin(t * 5 + p.phase * 2);
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 13 + k * 2, 3, 8);
          hand(7.5 + Math.max(0, k) * 2, hip - 14 + k * 2);
          break;
        }
        case 'petcat': {
          const k = Math.sin(t * 4 + p.phase) * 1.5;
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6 + k, hip - 9, 3, 12);
          hand(7.5 + k, hip + 3);
          break;
        }
        case 'printer': {
          c.fillRect(-9, hip - 13, 3, 8);
          c.fillRect(6, hip - 13, 3, 8);
          c.fillStyle = '#fafafa'; c.fillRect(-6, hip - 14, 12, 7);
          break;
        }
        case 'wave': {
          const wave = Math.sin(t * 8 + p.phase) * 2;
          c.fillRect(6, hip - 26, 3, 14);
          hand(7.5 + wave * 0.5, hip - 27);
          c.fillStyle = arm; c.fillRect(-9, hip - 11, 3, 10);
          break;
        }
        case 'typefast': {
          const k1 = Math.sin(t * 30 + p.phase) > 0 ? 1 : 0;
          c.fillRect(-9, hip - 11 - k1 * 1.5, 3, 8);
          c.fillRect(6, hip - 11 - (1 - k1) * 1.5, 3, 8);
          break;
        }
        case 'deskread': {
          // One hand on the mouse, scrolling now and then.
          const k = Math.sin(t * 2 + p.phase) > 0.3 ? 1 : 0;
          c.fillRect(-9, hip - 11, 3, 9);
          c.fillRect(6, hip - 12 - k, 3, 8);
          break;
        }
        case 'write': {
          const k = Math.sin(t * 9 + p.phase);
          c.fillRect(-9, hip - 11, 3, 9);
          c.fillRect(6 + k, hip - 12, 3, 8);
          hand(7.5 + k, hip - 4);
          break;
        }
        case 'chin':
        case 'scratch': {
          // Hand at the chin, or scratching the head.
          c.fillRect(-9, hip - 11, 3, 10);
          const up = st.act === 'scratch' ? 25 + Math.sin(t * 9 + p.phase) * 1.2 : 18;
          c.fillRect(5, hip - up + 2, 3, up - 10);
          hand(st.act === 'scratch' ? 4 : 3, hip - up);
          break;
        }
        case 'lookup': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 11, 3, 10);
          break;
        }
        case 'leanback': {
          // Arms crossed, waiting for a long command; a sip of coffee now and then.
          c.fillRect(-8, hip - 9, 16, 3);
          if (sip) { c.fillStyle = '#fafafa'; c.fillRect(5, hip - 16, 5, 6); c.fillStyle = '#6b3f22'; c.fillRect(6, hip - 16, 3, 1.5); }
          break;
        }
        case 'point': {
          // Sending a helper off: arm out to the side.
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 12, 10, 3);
          hand(17, hip - 10.5);
          break;
        }
        case 'tap': {
          // Drumming fingers on the table.
          const k = Math.sin(t * 14 + p.phase) > 0 ? 1.5 : 0;
          c.fillRect(-9, hip - 11, 3, 9);
          c.fillRect(6, hip - 12 - k, 3, 8);
          break;
        }
        case 'peek': {
          // Hand over the eyes, looking out for you.
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 24, 3, 12);
          c.fillRect(-2, hip - 25, 9, 2.5);
          break;
        }
        case 'scroll': {
          // Phone held low, thumb going.
          const k = Math.sin(t * 6 + p.phase) > 0.4 ? 1 : 0;
          c.fillRect(-6, hip - 11, 3, 7);
          c.fillRect(3, hip - 11, 3, 7);
          c.fillStyle = '#1d1f24'; c.fillRect(-2.5, hip - 9, 5, 7);
          c.fillStyle = '#7fb3ff'; c.fillRect(-1.8, hip - 8.3 + k, 3.6, 4);
          hand(-0.5, hip - 3 - k);
          break;
        }
        case 'laptop': {
          // A laptop on the lap, typing.
          const k1 = Math.sin(t * 16 + p.phase) > 0 ? 1 : 0;
          c.fillStyle = '#9aa0a8'; c.fillRect(-8, hip - 4, 16, 2.5);
          c.fillStyle = '#3c4048'; c.fillRect(-7, hip - 13, 14, 9);
          c.fillStyle = '#8fd0ff'; c.fillRect(-6, hip - 12, 12, 7);
          c.fillStyle = arm;
          c.fillRect(-9, hip - 6 - k1, 3, 4);
          c.fillRect(6, hip - 6 - (1 - k1), 3, 4);
          break;
        }
        case 'laugh': {
          // Hands on the belly, shaking with it.
          const k = Math.sin(t * 14 + p.phase) * 0.8;
          c.fillRect(-8, hip - 10 + k, 3, 8);
          c.fillRect(5, hip - 10 - k, 3, 8);
          hand(-4, hip - 3 + k); hand(4, hip - 3 - k);
          break;
        }
        case 'watch': {
          // Leaning back, arms folded.
          c.fillRect(-8, hip - 9, 16, 3);
          hand(-7, hip - 8); hand(7, hip - 8);
          break;
        }
        case 'game': {
          // A handheld console, both thumbs.
          const k = Math.sin(t * 12 + p.phase) * 0.8;
          c.fillRect(-8, hip - 11, 3, 6);
          c.fillRect(5, hip - 11, 3, 6);
          c.fillStyle = '#c0392b'; this.roundRect(-6, hip - 9, 12, 5, 2, '#2c3e50');
          c.fillStyle = '#8fd0ff'; c.fillRect(-2, hip - 8.3, 4, 3.4);
          hand(-5, hip - 6.5 + k); hand(5, hip - 6.5 - k);
          break;
        }
        case 'cheer': {
          // Both arms up, bouncing.
          const k = Math.abs(Math.sin(t * 9 + p.phase)) * 3;
          c.fillRect(-13, hip - 27 - k, 3, 15);
          c.fillRect(10, hip - 27 - k, 3, 15);
          hand(-11.5, hip - 28 - k); hand(11.5, hip - 28 - k);
          break;
        }
        case 'facepalm': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(3, hip - 20, 3, 9);
          hand(2.5, hip - 22);
          break;
        }
        case 'yawn': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(4, hip - 19, 3, 8);
          hand(3, hip - 20);
          break;
        }
        case 'carry':
        case 'deliver':
        case 'unpack': {
          // Both hands out front holding a box (a bag for lunch).
          const k = st.act === 'unpack' ? Math.sin(t * 5 + p.phase) * 1.5 : 0;
          c.fillRect(-8, hip - 12, 3, 7);
          c.fillRect(5, hip - 12, 3, 7);
          if (front) this.roundRect(-7, hip - 13 + k, 14, 9, 1.5, '#c8a06a', '#9c7a4b');
          break;
        }
        case 'fix': {
          // Jiggling the printer.
          const k = Math.sin(t * 16 + p.phase) * 2;
          c.fillRect(-9 + k, hip - 12, 3, 9);
          c.fillRect(6 + k, hip - 12, 3, 9);
          break;
        }
        case 'refill': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 19, 3, 10);
          c.fillStyle = '#6b3f22'; c.fillRect(5, hip - 25, 6, 7);
          break;
        }
        case 'waterplant': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 13, 9, 3);
          c.fillStyle = '#4f9ad8'; c.fillRect(13, hip - 15, 6, 5);
          c.fillStyle = 'rgba(120,180,255,.8)';
          for (let i = 0; i < 3; i++) c.fillRect(19 + i, hip - 10 + ((t * 30 + i * 4) % 9), 1, 2);
          break;
        }
        case 'pin': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 25, 3, 14);
          hand(6.5, hip - 26);
          break;
        }
        case 'type': {
          const k1 = Math.sin(t * 18 + p.phase) > 0 ? 1 : 0;
          c.fillRect(-9, hip - 11 - k1, 3, 8);
          c.fillRect(6, hip - 11 - (1 - k1), 3, 8);
          break;
        }
        case 'coffee':
        case 'water': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, sip ? hip - 15 : hip - 11, 3, sip ? 7 : 10);
          const cupY = sip && front ? hip - 19 : hip - 4;
          c.fillStyle = st.act === 'water' ? 'rgba(170,215,255,.95)' : '#fafafa';
          c.fillRect(6, cupY, 5, 6);
          if (st.act === 'coffee') { c.fillStyle = '#6b3f22'; c.fillRect(7, cupY, 3, 1.5); }
          break;
        }
        case 'read': {
          c.fillRect(-8, hip - 11, 3, 7);
          c.fillRect(5, hip - 11, 3, 7);
          if (front) { c.fillStyle = pick(this.pal.book, p.h, 5); c.fillRect(-7, hip - 12, 14, 9); c.fillStyle = '#fff'; c.fillRect(-0.5, hip - 12, 1, 9); }
          break;
        }
        case 'whiteboard':
        case 'slot':
        case 'arcade': {
          const k = Math.sin(t * (st.act === 'arcade' ? 14 : st.act === 'slot' ? 5 : 3) + p.phase);
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 20 + k * 2, 3, 12);
          hand(7.5, hip - 21 + k * 2);
          break;
        }
        case 'pingpong': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(6, hip - 14, 3, 9);
          c.fillStyle = '#c0392b';
          c.beginPath(); c.arc(10, hip - 16, 4, 0, Math.PI * 2); c.fill();
          break;
        }
        case 'foosball': {
          const k1 = Math.sin(t * 16 + p.phase) * 1.5;
          c.fillRect(-9, hip - 12 + k1, 3, 7);
          c.fillRect(6, hip - 12 - k1, 3, 7);
          break;
        }
        case 'phone': {
          c.fillRect(-9, hip - 11, 3, 10);
          c.fillRect(5, hip - 22, 3, 12);
          c.fillStyle = '#222'; c.fillRect(5, hip - 25, 3, 6);
          break;
        }
        case 'nap': {
          c.fillRect(-9, hip - 13, 3, 6);
          c.fillRect(6, hip - 13, 3, 6);
          break;
        }
        default: {
          const sw = moving ? step * 2 : 0;
          c.fillRect(-9, hip - 11 + sw, 3, 10);
          c.fillRect(6, hip - 11 - sw, 3, 10);
        }
      }

      const napping = st.act === 'nap';
      const lean = { lookup: -1.5, leanback: -1, deskread: 1, typefast: 0.6, peek: -0.5, stretch: -1, neck: 1.2, petcat: 2, scroll: 1.5, laptop: 1, game: 1.2, read: 0.8, watch: -1 }[st.act] || 0;
      const R = 9.5; // head radius: about half their height
      const hy = hip - 20 + (napping ? 7 : 0) + lean + (st.act === 'think' || st.act === 'tap' ? Math.sin(t * 1.5 + p.phase) * 0.6 : 0)
        + (st.act === 'laugh' ? -Math.abs(Math.sin(t * 7 + p.phase)) * 1.4 : 0);
      const faceOn = front && !napping;
      this.hair2d(p, hy, R, faceOn, true);
      c.fillStyle = p.skin;
      c.beginPath(); c.arc(0, hy, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(43,36,32,.55)'; c.lineWidth = 0.9; c.stroke();
      this.hair2d(p, hy, R, faceOn, false);
      if (faceOn) {
        // The face, drawn a size up to suit the big head.
        c.save(); c.translate(0, hy + 1); c.scale(1.3, 1.3); c.translate(0, -hy);
        c.fillStyle = '#2a2018';
        const sleepy = s.status === 'idle' && !held;
        const blink = Math.sin(t * 0.7 + p.phase * 3) > 0.985;
        // Looking around: eyes glance left and right.
        const look = st.act === 'lookaround' || st.act === 'dazed' ? Math.round(Math.sin(t * 2.2 + p.phase) * 1.5) : 0;
        if (blink || sleepy) {
          c.fillRect(-3 + look, hy - 0.5, 1.6, 0.7);
          c.fillRect(1.6 + look, hy - 0.5, 1.6, 0.7);
        } else {
          // Eyes with a white and a glint.
          c.fillStyle = '#fff';
          c.beginPath(); c.ellipse(-2.2, hy + 0.4, 1.5, 1.7, 0, 0, Math.PI * 2); c.ellipse(2.4, hy + 0.4, 1.5, 1.7, 0, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#2a2018';
          c.beginPath(); c.arc(-2.2 + look * 0.6, hy + 0.6, 1, 0, Math.PI * 2); c.arc(2.4 + look * 0.6, hy + 0.6, 1, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff'; c.fillRect(-2.0 + look * 0.6, hy - 0.1, 0.5, 0.5); c.fillRect(2.6 + look * 0.6, hy - 0.1, 0.5, 0.5);
        }
        // Rosy cheeks, and a shine on the hair.
        c.fillStyle = 'rgba(240,120,110,.28)';
        c.beginPath(); c.arc(-4.2, hy + 2.6, 1.3, 0, Math.PI * 2); c.arc(4.4, hy + 2.6, 1.3, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.18)';
        c.beginPath(); c.ellipse(-2.5, hy - 5.6, 2.6, 1, -0.3, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2a2018';
        c.strokeStyle = '#2a2018'; c.lineWidth = 1;
        if (st.act === 'laugh') {
          // Eyes squeezed shut (^ ^), mouth wide open.
          c.fillStyle = p.skin; c.fillRect(-3.5, hy - 1.2, 7.5, 3.4);
          c.beginPath(); c.moveTo(-3, hy + 1); c.lineTo(-2.2, hy - 0.4); c.lineTo(-1.4, hy + 1); c.moveTo(1.6, hy + 1); c.lineTo(2.4, hy - 0.4); c.lineTo(3.2, hy + 1); c.stroke();
          c.fillStyle = '#5a2a22';
          c.beginPath(); c.arc(0, hy + 2.6, 2.2, 0, Math.PI); c.fill();
        } else if (st.act === 'nap') {
          c.fillStyle = p.skin; c.fillRect(-3.5, hy - 1.2, 7.5, 3.4);
          c.beginPath(); c.moveTo(-3, hy + 0.6); c.lineTo(-1.4, hy + 0.6); c.moveTo(1.6, hy + 0.6); c.lineTo(3.2, hy + 0.6); c.stroke();
          c.fillStyle = this.pal.text; c.font = '700 6px ui-sans-serif, system-ui, sans-serif';
          c.fillText('z', 8 + Math.sin(t * 2) * 1, hy - 8 - ((t * 3) % 4));
        } else if (st.act === 'scroll' || st.act === 'watch' || st.act === 'game' || st.act === 'eat') {
          c.beginPath(); c.arc(0, hy + 2.4, 1.8, 0.1 * Math.PI, 0.9 * Math.PI); c.stroke();
        } else if (held || st.act === 'chat') {
          // An open mouth: shouting, or talking.
          const o = held ? 1.8 : 0.6 + Math.abs(Math.sin(t * 9 + p.phase)) * 1.2;
          c.fillStyle = '#5a2a22';
          c.beginPath(); c.ellipse(0, hy + 3.2, 1.6, o, 0, 0, Math.PI * 2); c.fill();
        } else if (p.mode === 'wander' && !sleepy) {
          c.beginPath(); c.arc(0, hy + 2.2, 2, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
        } else if (s.status === 'error' && p.mode === 'work') {
          c.beginPath(); c.arc(0, hy + 4.5, 2, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke();
        }
        c.restore();
      }
      if (st.act === 'arcade' || st.act === 'beanbag' || (lv >= 3 && lv < 5)) {
        c.strokeStyle = lv >= 3 ? '#e2e2e6' : '#222'; c.lineWidth = 2;
        c.beginPath(); c.arc(0, hy, R + 1, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
        if (lv >= 3) { c.fillStyle = '#3a3a44'; c.fillRect(-R - 2.5, hy - 3, 3.5, 6); c.fillRect(R - 1, hy - 3, 3.5, 6); }
      }
      if (lv >= 5) {
        // A crown for the old hands.
        const cy = hy - R - (napping ? -1 : 1);
        c.fillStyle = '#f2c230';
        c.beginPath(); c.moveTo(-5, cy); c.lineTo(-5, cy - 4); c.lineTo(-2.5, cy - 2); c.lineTo(0, cy - 5.5); c.lineTo(2.5, cy - 2); c.lineTo(5, cy - 4); c.lineTo(5, cy); c.closePath(); c.fill();
        c.fillStyle = '#c0392b'; c.beginPath(); c.arc(0, cy - 1.4, 0.9, 0, Math.PI * 2); c.fill();
      }
      if (st.act === 'dazed') {
        // Seeing stars after being put down.
        c.fillStyle = '#f2c94c';
        c.font = '700 7px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        for (let i = 0; i < 3; i++) {
          const a = t * 5 + (i * Math.PI * 2) / 3;
          c.fillText('★', Math.cos(a) * 9, hy - 9 + Math.sin(a) * 3);
        }
      }
      c.restore();

      // Subagents at work: small helpers beside the desk.
      if (p.mode === 'work' && !moving) {
        const kids = this.helpers(s);
        kids.slice(0, 3).forEach((k, i) => this.helper(x + 17 + i * 11, fb.y - 2, k, p, i));
        if (kids.length > 3) {
          c.fillStyle = this.pal.text; c.font = '700 9px ui-sans-serif, system-ui, sans-serif'; c.textAlign = 'center';
          c.fillText(`+${kids.length - 3}`, x + 17 + 3 * 11, fb.y - 8);
        }
      }

      // Bubbles go above the sign when one is held up.
      const headTop = y + (st.act === 'sign' ? hip - 46 : hy - R - 1) * sc;
      if (!p.me && !p.visitor) this.hit.push({ key: p.key, x0: x - 13, x1: x + 13, y0: headTop - 22, y1: fb.y + 4 });
      return { x, y: headTop, act: st.act };
    }

    // A small helper figure (a running subagent), busy at the parent's side.
    helper(x, y, k, p, i) {
      const c = this.ctx;
      const t = this.t / 1000;
      const ph = p.phase + i * 1.7;
      c.save();
      c.translate(x, y + Math.abs(Math.sin(t * 6 + ph)) * -1);
      c.scale(0.55, 0.55);
      c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 2, 9, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = p.pants; c.fillRect(-5, -10, 4, 10); c.fillRect(1, -10, 4, 10);
      this.roundRect(-7, -23, 14, 14, 3, STATUS_COLOR[k.status] || p.shirt);
      c.fillStyle = this.shade(STATUS_COLOR[k.status] || p.shirt, -18);
      const a = Math.sin(t * 14 + ph) > 0 ? 1 : 0;
      c.fillRect(-9, -21 - a, 3, 8); c.fillRect(6, -21 - (1 - a), 3, 8);
      c.fillStyle = p.skin; c.beginPath(); c.arc(0, -30, 6.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = p.hair; c.beginPath(); c.arc(0, -31.5, 6.8, Math.PI * 1.05, Math.PI * 1.95); c.fill();
      c.restore();
    }

    bubble(p, at) {
      const c = this.ctx;
      const t = this.t / 1000;
      const s = p.s || {};
      const st = s.status;
      const pal = this.pal;
      const x = at.x, y = at.y - 6;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const font = (w, px) => `${w} ${px}px ui-sans-serif, system-ui, -apple-system, "PingFang TC", "Apple Color Emoji", sans-serif`;
      c.font = font(600, 10);

      const badge = this.showAgent && AGENT_BADGES[s.agent];
      const pill = (text, fg, bg, yy, alpha = 1, identify = false) => {
        c.globalAlpha = alpha;
        let tx = text;
        while (c.measureText(tx).width > 118 && tx.length > 2) tx = tx.slice(0, -2) + '…';
        const extra = badge && identify ? 26 : 0;
        const w = c.measureText(tx).width + 12 + extra;
        const height = extra ? 22 : 16;
        this.roundRect(x - w / 2, yy - height / 2, w, height, 8, bg);
        c.fillStyle = fg;
        c.fillText(tx, x + extra / 2, yy + 0.5);
        if (extra) this.agentBadge(badge, x - w / 2 + 13, yy);
        c.globalAlpha = 1;
        return yy - 8;
      };

      let top = y;
      if (p.held && this.dropAt) {
        top = pill('放開＝' + this.dropAt.hint, '#fff', '#8b6be6', y - 12);
      } else if (p.errand && !p.path.length) {
        top = pill('📋 ' + p.errand.text, '#fff', '#3b8ee0', y - 12);
      } else if (this.dropOn === p.key) {
        top = pill('放開＝把話轉給我', '#fff', '#8b6be6', y - 12);
      } else if (p.held) {
        // Held up: no status bubble, just the name and what they shout.
      } else if (p.visit && at.act === 'chat' && p.visit.text) {
        // What they came to say.
        top = pill('💬 ' + p.visit.text, pal.text, pal.bubble, y - 12);
      } else if (at.act === 'chat' && p.zone !== 'wait') {
        // Taking turns talking.
        const mine = Math.floor(t / 1.6 + (p.chatWith ? 0.5 : 0)) % 2 === 0;
        if (mine) {
          this.roundRect(x - 4, y - 24, 26, 15, 7, pal.bubble);
          c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x - 3, y - 4); c.lineTo(x + 5, y - 10); c.fillStyle = pal.bubble; c.fill();
          c.fillStyle = pal.text;
          for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x + 3 + i * 6, y - 16.5, 1.6, 0, Math.PI * 2); c.fill(); }
          top = y - 24;
        }
      } else if (p.mode === 'work' && p.run && !p.path.length) {
        top = pill('☕ 等指令跑完', '#fff', STATUS_COLOR.tool, y - 12);
      } else if (p.mode === 'work' && !p.path.length) {
        const col = STATUS_COLOR[st] || '#888';
        if (st === 'thinking') {
          c.fillStyle = pal.bubble;
          c.beginPath(); c.arc(x + 6, y - 2, 2, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(x + 10, y - 7, 3, 0, Math.PI * 2); c.fill();
          this.roundRect(x - 2, y - 26, 32, 16, 8, pal.bubble);
          for (let i = 0; i < 3; i++) {
            c.fillStyle = col;
            c.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 - i * 0.7));
            c.beginPath(); c.arc(x + 6 + i * 8, y - 18, 2.4, 0, Math.PI * 2); c.fill();
          }
          c.globalAlpha = 1;
          top = y - 26;
        } else if (st === 'typing') {
          this.roundRect(x - 2, y - 24, 34, 16, 5, col);
          c.beginPath(); c.moveTo(x + 2, y - 9); c.lineTo(x - 2, y - 3); c.lineTo(x + 8, y - 9); c.fillStyle = col; c.fill();
          const n = Math.floor(t * 4) % 4;
          c.fillStyle = '#fff';
          for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x + 7 + i * 8, y - 16, 2, 0, Math.PI * 2); c.fill(); }
          top = y - 24;
        } else if (st === 'tool') {
          top = pill('⚙ ' + this.doing(s), '#fff', col, y - 12);
        } else if (st === 'waiting' || st === 'error') {
          const jump = Math.abs(Math.sin(t * 4)) * 4;
          c.fillStyle = col;
          c.beginPath(); c.arc(x, y - 12 - jump, 9, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff';
          c.font = font(800, 12);
          c.fillText('!', x, y - 11.5 - jump);
          c.font = font(600, 10);
          top = y - 22 - jump;
        }
      } else if (at.act === 'knock' && !p.path.length) {
        // Knock knock: and how long it has been waiting.
        const k = Math.sin(t * 9 + p.phase) > 0;
        c.font = font(800, 11);
        top = pill(k ? '叩叩！在嗎？' : '叩叩…', '#fff', STATUS_COLOR.waiting, y - 12);
      } else if (p.mode === 'wander' && (p.zone === 'wait' || p.zone === 'error')) {
        // Waiting on you (!), left you a decision (?), or failed (red !).
        const col = STATUS_COLOR[p.zone === 'error' ? 'error' : 'waiting'];
        const jump = Math.abs(Math.sin(t * 4)) * 4;
        c.fillStyle = col;
        c.beginPath(); c.arc(x, y - 12 - jump, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff';
        c.font = font(800, 12);
        c.fillText(st === 'done' ? '?' : '!', x, y - 11.5 - jump);
        c.font = font(600, 10);
        top = y - 22 - jump;
      } else if (p.mode === 'wander' && p.zone === 'done') {
        // Finished: a check mark (paused sign if it was interrupted).
        const col = st === 'interrupted' ? STATUS_COLOR.interrupted : STATUS_COLOR.done;
        c.fillStyle = col;
        c.beginPath(); c.arc(x, y - 10, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff'; c.font = font(800, 9); c.fillText(st === 'interrupted' ? 'Ⅱ' : '✓', x, y - 9.5); c.font = font(600, 10);
        top = y - 18;
      } else if (p.mode === 'wander') {
        const justDone = st === 'done' && Date.now() - (s.lastEventAt || 0) < 3 * 60_000;
        const dozing = at.act === 'nap' || (st === 'idle' && (at.act === 'couch' || at.act === 'beanbag' || (p.poi && p.poi.sleepy)));
        if (justDone) {
          c.fillStyle = STATUS_COLOR.done;
          c.beginPath(); c.arc(x, y - 10, 7, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff'; c.font = font(800, 9); c.fillText('✓', x, y - 9.5); c.font = font(600, 10);
          top = y - 18;
        } else if (dozing && !p.path.length) {
          c.fillStyle = STATUS_COLOR.idle;
          c.font = font(700, 10);
          for (let i = 0; i < 3; i++) {
            const k = (t * 0.6 + i / 3) % 1;
            c.globalAlpha = 1 - k;
            c.fillText('z', x + 6 + k * 10, y - 4 - k * 18);
          }
          c.globalAlpha = 1;
          c.font = font(600, 10);
          top = y - 20;
        } else if (at.act && (ACT_EMOJI[at.act] || (p.poi && p.poi.emoji)) && !p.path.length) {
          const cycle = (t + p.phase * 3) % 9;
          if (cycle < 2.2) {
            c.globalAlpha = Math.min(1, cycle * 3, (2.2 - cycle) * 3);
            c.font = font(400, 13);
            c.fillText((p.poi && p.poi.emoji) || ACT_EMOJI[at.act], x, y - 10);
            c.globalAlpha = 1;
            c.font = font(600, 10);
            top = y - 18;
          }
        }
      }

      // Waiting a while: sweating it.
      if (p.mode === 'wander' && p.zone === 'wait' && waitedMs(s) > SIGN_MS && !p.held) {
        const k = (t * 0.8 + p.phase) % 1;
        c.globalAlpha = 1 - k;
        c.fillStyle = '#6cb6ff';
        const dx = x + 11, dy = y - 4 + k * 8;
        c.beginPath(); c.moveTo(dx, dy - 4); c.quadraticCurveTo(dx + 3, dy, dx, dy + 1.5); c.quadraticCurveTo(dx - 3, dy, dx, dy - 4); c.fill();
        c.globalAlpha = 1;
      }
      // Waiting a while: how long, under the bubble.
      if (p.mode === 'wander' && (p.zone === 'wait' || p.zone === 'error')) {
        const mins = Math.floor((Date.now() - (s.lastEventAt || Date.now())) / 60_000);
        if (mins >= 1) {
          c.font = font(700, 9);
          c.fillStyle = mins >= 15 ? STATUS_COLOR.error : pal.text;
          const place = p.queue != null ? `排第 ${p.queue + 1}・` : '';
          c.fillText(`${place}等了 ${mins >= 60 ? Math.floor(mins / 60) + ' 小時' : mins + ' 分'}`, x, y + 18);
          c.font = font(600, 10);
        }
      }
      // Going in circles: smoke over the head.
      if (s.stuck && p.mode === 'work') {
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.7 + i / 3) % 1;
          c.globalAlpha = 0.55 * (1 - k);
          c.fillStyle = '#8f8f8a';
          c.beginPath(); c.arc(x - 12 + i * 4 + Math.sin(t * 2 + i) * 2, top - 4 - k * 16, 3 + k * 4, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
      }

      const hover = this.hoverKey === p.key;
      const best = this.bestKey === p.key;
      if (p.me) {
        top = pill('🧑‍💼 你', '#fff', '#2f3a52', top - 11, 1, false);
        const near = this.meNear();
        if (near) top = pill(`空白鍵：找「${this.label(near.s).slice(0, 14)}」`, '#fff', '#8b6be6', top - 4, 1, false);
      } else if ((!s.subagent && p.zone !== 'idle') || hover || best) {
        const loud = p.mode === 'work' || p.zone === 'wait' || p.zone === 'error' || hover || best;
        top = pill((best ? '🏆 ' : '') + this.label(s), best ? '#5a4300' : pal.text, best ? '#ffd76a' : pal.tagBg, top - 11, loud ? 1 : 0.7, true);
      } else if (badge) {
        this.agentBadge(badge, x, top - 11);
      }
      // What just happened, floating up and fading out.
      if (p.event) {
        const age = (Date.now() - p.event.at) / 1000;
        const ttl = p.event.ttl || 4.5;
        if (age > ttl) p.event = null;
        else {
          const col = { work: STATUS_COLOR.tool, wait: STATUS_COLOR.waiting, error: STATUS_COLOR.error, done: STATUS_COLOR.done, held: '#8b6be6', level: '#c99a14' }[p.event.zone] || pal.text;
          c.globalAlpha = Math.min(1, (ttl - age) * 1.5);
          c.font = font(800, 12);
          const w = c.measureText(p.event.text).width + 14;
          const yy = top - 22 - age * 6;
          this.roundRect(x - w / 2, yy - 9, w, 18, 9, col);
          c.fillStyle = '#fff';
          c.fillText(p.event.text, x, yy + 0.5);
          c.globalAlpha = 1;
        }
      }
      c.restore();
    }

    agentBadge(badge, x, y) {
      const c = this.ctx;
      c.save();
      c.globalAlpha = 1;
      if (badge.image.complete && badge.image.naturalWidth > 0) {
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(badge.image, x - 9, y - 9, 18, 18);
      } else {
        c.fillStyle = this.pal.text;
        c.font = '800 10px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(badge.short, x, y + 0.5);
      }
      c.restore();
    }

    moveCat(dt, now, k = this.cat) {
      if (!k.path.length && now > k.until) {
        const { W, D, grid } = this.plan;
        let tx, ty, tries = 0;
        do { tx = rand(0.6, W - 0.6); ty = rand(1, D - 0.6); tries++; } while (grid.blocked(tx, ty) && tries < 30);
        k.path = grid.path(k.x, k.y, tx, ty);
        k.until = Infinity;
      }
      if (k.path.length) {
        const n = k.path[0];
        const dx = n.x - k.x, dy = n.y - k.y, d = Math.hypot(dx, dy), v = 1.2 * dt;
        if (d > 0.001) k.face = dx - dy >= 0 ? 1 : -1;
        if (d <= v) { k.x = n.x; k.y = n.y; k.path.shift(); if (!k.path.length) k.until = now + rand(4000, 12000); }
        else { k.x += (dx / d) * v; k.y += (dy / d) * v; }
      }
    }

    drawCat(k = this.cat) {
      const c = this.ctx;
      const p = this.iso(k.x, k.y, 0);
      const t = this.t / 1000;
      const walking = k.path.length > 0;
      c.save();
      c.translate(p.x, p.y);
      c.scale(k.face, 1);
      c.fillStyle = this.pal.shadow;
      c.beginPath(); c.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); c.fill();
      const col = k.color || '#e09a4a';
      c.fillStyle = col;
      if (walking) {
        const s = Math.sin(t * 14) * 1.5;
        c.fillRect(-5, -4, 2, 4 + s); c.fillRect(3, -4, 2, 4 - s);
      }
      c.beginPath(); c.ellipse(0, walking ? -6 : -4, 7, walking ? 4 : 5, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(6, walking ? -10 : -9, 3.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(4, -12); c.lineTo(5, -16); c.lineTo(7, -12.5); c.fill();
      c.beginPath(); c.moveTo(7, -12.5); c.lineTo(9, -15.5); c.lineTo(9.5, -11); c.fill();
      c.strokeStyle = col; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-6, -6); c.quadraticCurveTo(-12, -8 + Math.sin(t * 3) * 3, -10, -14); c.stroke();
      c.fillStyle = '#2a2018';
      c.fillRect(7, -10.5, 1.2, walking ? 1.2 : 0.6);
      c.restore();
    }

    pingPongBall() {
      const players = this.plan.pois
        .filter((q) => q.pair === 'pp' && q.taken)
        .map((q) => this.people.get(q.taken))
        .filter((p) => p && p.poi && p.poi.pair === 'pp' && !p.path.length);
      if (players.length < 2) return;
      const pp = this.plan.pp;
      const k = (this.t / 900) % 2;
      const f = k < 1 ? k : 2 - k;
      const x = pp.x0 + 0.3 + f * (pp.x1 - pp.x0 - 0.6);
      const z = 0.8 + Math.abs(Math.sin(f * Math.PI * 2)) * 0.45;
      const c = this.ctx;
      const sh = this.iso(x, pp.y, 0.77);
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.beginPath(); c.ellipse(sh.x, sh.y, 2.5, 1.2, 0, 0, Math.PI * 2); c.fill();
      const p = this.iso(x, pp.y, z);
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(p.x, p.y, 2.2, 0, Math.PI * 2); c.fill();
    }

    // ------------------------------------------------------------ frame

    frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t = now;
      if (!this.visible) return;
      this.step(dt);
      if (this.draw() !== false) {
        if (!this.first && ++this.framesShown === 3) this.markReady(true);
        // Capture immediately: a WebGL drawing buffer may be cleared after
        // this task. The overlay and the 3D canvas must be copied together.
        if (this.onFrame) this.onFrame(this);
      }
    }

    // ------------------------------------------------------------ broadcast
    //
    // One page (yours) runs the office; a public view (--public) replays it,
    // so everyone sees the same people in the same places. worldState() is
    // what the host sends (src/server.js /api/world filters it before anyone
    // else sees it); applyWorld() puts it on the viewer, whose step() then
    // only walks people along the paths they were given.

    // Plan objects by name ("pois.12", "desks.3.seat"), for references.
    planRefs() {
      if (this.refsFor === this.plan) return this.refs;
      const byObj = new Map(), byId = new Map();
      const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
      const put = (o, id) => { if (!byObj.has(o)) { byObj.set(o, id); byId.set(id, o); } };
      for (const [k, v] of Object.entries(this.plan)) {
        if (k === 'grid' || k === 'items') continue;
        const list = Array.isArray(v) ? v.map((x, i) => [x, `${k}.${i}`]) : [[v, k]];
        for (const [o, id] of list) {
          if (!plain(o)) continue;
          put(o, id);
          for (const [k2, v2] of Object.entries(o)) if (plain(v2)) put(v2, `${id}.${k2}`);
        }
      }
      this.refsFor = this.plan;
      this.refs = { byObj, byId };
      return this.refs;
    }

    worldState() {
      const { byObj } = this.planRefs();
      const enc = (v, d) => {
        if (v === Infinity) return { $inf: 1 };
        if (v == null || typeof v === 'boolean' || typeof v === 'string') return v;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v !== 'object') return undefined;
        if (byObj.has(v)) return { $ref: byObj.get(v) };
        if (v.key && this.people.get(v.key) === v) return { $p: v.key };
        if (d > 5) return undefined;
        if (Array.isArray(v)) return v.map((x) => { const e = enc(x, d + 1); return e === undefined ? null : e; });
        if (Object.getPrototypeOf(v) !== Object.prototype) return undefined; // meshes, canvases, Maps
        const o = {};
        for (const [k, x] of Object.entries(v)) { if (k === 's') continue; const e = enc(x, d + 1); if (e !== undefined) o[k] = e; }
        return o;
      };
      const person = (p) => {
        const o = {};
        for (const [k, x] of Object.entries(p)) { if (k === 's') continue; const e = enc(x, 1); if (e !== undefined) o[k] = e; }
        const s = p.s || {};
        o.sk = { agent: s.agent || 'claude', status: s.status || 'idle', visitor: !!s.visitor, subagent: !!s.subagent };
        return o;
      };
      return {
        t: this.t, wall: Date.now(), n: this.builtFor == null ? this.nWorking || 0 : this.builtFor, secKey: this.secKey || null,
        people: [...this.people.values()].map(person), me: this.me ? person(this.me) : null,
        visitors: [...(this.visitors || new Map()).values()].map(person),
        cat: enc(this.cat, 1), cat2: enc(this.cat2, 1), slot: enc(this.slot, 1), standup: enc(this.standup, 1),
        liftOpen: this.liftOpen || 0, confetti: enc(this.confetti, 1), alarmUntil: this.alarmUntil || 0, bossIn: !!this.bossIn,
        lunchUntil: this.lunchUntil || 0, cakeUntil: this.cakeUntil || 0, jamUntil: this.jamUntil || 0,
      };
    }

    // `sessions`: this page's sessions by key, for each person's name tag.
    applyWorld(w, sessions = new Map()) {
      this.remote = true;
      this.first = false;
      if (w.n !== this.builtFor && !this.plan.fixed) { this.builtFor = w.n; this.nWorking = w.n; this.rebuild(); }
      const { byId } = this.planRefs();
      const dec = (v) => {
        if (v == null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(dec);
        if (v.$inf) return Infinity;
        if (v.$ref != null) return byId.get(v.$ref) || null;
        if (v.$p != null) return { $p: v.$p }; // resolved below, once everyone exists
        const o = {};
        for (const [k, x] of Object.entries(v)) o[k] = dec(x);
        return o;
      };
      const fix = (o, d = 0) => {
        if (!o || typeof o !== 'object' || d > 6) return o;
        for (const [k, x] of Object.entries(o)) {
          if (x && typeof x === 'object' && x.$p != null && Object.keys(x).length === 1) o[k] = this.people.get(x.$p) || null;
          else if (x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype || Array.isArray(x)) fix(x, d + 1);
        }
        return o;
      };
      const tagOf = (key, sk) => sessions.get(key) || { key, agent: sk.agent, status: sk.status, visitor: sk.visitor, subagent: sk.subagent, title: sk.visitor ? '訪客' : null };
      const end = (a) => (a && a.length ? a[a.length - 1] : null);
      // What we get is a moment old: carry everyone on along their path for
      // that long, so we do not pull them back to walk a stretch again.
      const age = Math.min(3, Math.max(0, (Date.now() - (w.wall || Date.now())) / 1000));
      const ahead = (d) => {
        if (!d.path || !d.path.length || !age) return;
        let left = SPEED * age * (d.rush > Date.now() ? 2.3 : 1);
        while (left > 0 && d.path.length) {
          const n = d.path[0], g = Math.hypot(n.x - d.x, n.y - d.y);
          if (g <= left) { d.x = n.x; d.y = n.y; d.path.shift(); left -= g; }
          else { d.x += (n.x - d.x) / g * left; d.y += (n.y - d.y) / g * left; left = 0; }
        }
      };
      const assign = (p, r) => {
        const d = dec(r);
        const was = { x: d.x, y: d.y, path: d.path ? d.path.slice() : [] };
        ahead(d);
        // Close to where they should be: keep our own smooth position (and,
        // on the same way, our own path). Still near where they were when
        // this was sent (they just set off): walk the whole way from here, a
        // little faster until caught up. Only a real gap is a jump.
        const at = p.x != null;
        const near = at && Math.hypot(p.x - d.x, p.y - d.y) < 1.5;
        const behind = at && !near && Math.hypot(p.x - was.x, p.y - was.y) < 3.5;
        const e1 = end(p.path), e2 = end(d.path);
        const sameWay = (!e1 && !e2) || (e1 && e2 && Math.hypot(e1.x - e2.x, e1.y - e2.y) < 0.05);
        const keep = near ? { x: p.x, y: p.y, path: sameWay ? p.path : d.path }
          : behind ? { x: p.x, y: p.y, path: sameWay ? p.path : was.path, catchUp: Date.now() + 2500 } : null;
        for (const k of p.worldKeys || []) if (!(k in d)) delete p[k];
        Object.assign(p, d, keep || {});
        p.worldKeys = Object.keys(d);
        delete p.sk;
        return p;
      };
      const seen = new Set();
      for (const r of w.people || []) {
        if (!r || !r.key) continue;
        seen.add(r.key);
        let p = this.people.get(r.key);
        if (!p) { p = { key: r.key, path: [] }; this.people.set(r.key, p); }
        assign(p, r);
        p.s = tagOf(r.key, r.sk || {});
      }
      for (const k of [...this.people.keys()]) if (!seen.has(k)) this.people.delete(k);
      for (const p of this.people.values()) fix(p);
      if (w.me) {
        this.me = assign(this.me || { path: [] }, w.me);
        this.me.s = { key: 'me', agent: 'claude', status: 'idle', title: '老闆', level: 4 };
        this.meKeys = this.meKeys || new Set();
      } else this.me = null;
      const was = this.visitors || new Map();
      this.visitors = new Map();
      for (const r of w.visitors || []) {
        if (!r || !r.key) continue;
        const v = assign(was.get(r.key) || { key: r.key, path: [] }, r);
        v.s = { key: r.key, agent: 'claude', status: 'idle', title: '訪客', level: 2, visitor: true };
        this.visitors.set(r.key, fix(v));
      }
      this.secKey = w.secKey || null;
      // The slot keeps time on the host's page clock: move it onto ours.
      const off = this.t - (w.t || 0);
      const slot = dec(w.slot);
      if (slot) for (const k of ['spinAt', 'next', 'winUntil']) if (typeof slot[k] === 'number') slot[k] += off;
      this.slot = slot;
      for (const k of ['cat', 'cat2', 'standup', 'confetti']) this[k] = fix(dec(w[k]));
      for (const k of ['liftOpen', 'alarmUntil', 'lunchUntil', 'cakeUntil', 'jamUntil']) this[k] = w[k] || 0;
      this.bossIn = !!w.bossIn;
      this.worldAt = Date.now();
    }

    // Back to running the office here (the host went quiet).
    leaveWorld() { this.remote = false; }

    // A replaying page: walk along the given paths, nothing else is decided here.
    stepRemote(dt) {
      const wall = Date.now();
      const walk = (p, speed) => {
        if (!p || !p.path || !p.path.length) return;
        const n = p.path[0];
        const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
        const v = speed * dt;
        if (d > 0.001) { p.walkFace = dx + dy >= 0 ? 'front' : 'back'; if ('face' in p && typeof p.face === 'number') p.face = dx - dy >= 0 ? 1 : -1; }
        if (d <= v) { p.x = n.x; p.y = n.y; p.path.shift(); }
        else { p.x += (dx / d) * v; p.y += (dy / d) * v; }
      };
      for (const p of this.people.values()) walk(p, SPEED * (p.rush > wall ? 2.3 : 1) * (p.catchUp > wall ? 1.35 : 1));
      for (const v of (this.visitors || new Map()).values()) walk(v, SPEED);
      walk(this.cat, 1.2);
      walk(this.cat2, 1.2);
      const sl = this.slot;
      if (sl && sl.from && sl.to && sl.dur) {
        for (let i = 0; i < 5; i++) {
          const k = Math.min(1, (this.t - sl.spinAt) / sl.dur[i]);
          sl.pos[i] = sl.from[i] + (sl.to[i] - sl.from[i]) * SLOT_EASE(k);
        }
      }
    }

    // Advance people and the cat; shared by the 2D and 3D renderers.
    step(dt) {
      if (this.remote) { this.stepRemote(dt); return; }
      const wall = Date.now();
      for (const [k, p] of this.people) {
        if (p.held) continue;
        // Just put down: a moment to get their bearings, then carry on.
        if (p.landed) {
          if (wall - p.landed < 1100) continue;
          p.landed = 0;
          if (p.leaving) this.goTo(p, this.plan.door);
          else if (p.meeting) this.goTo(p, p.meeting.seat);
          else if (p.mode === 'work' && p.desk) this.goTo(p, p.desk.seat);
          else if (p.mode === 'wander') {
            p.poi = { x: p.x, y: p.y, act: 'lookaround', face: 'front' };
            p.until = wall + rand(2500, 4000);
          }
        }
        if (p.seeOff) this.stepSeeOff(p, wall);
        else if (p.meeting) this.stepMeeting(p, wall);
        else if (p.visit) this.stepVisit(p, wall);
        else if (p.mode === 'work' && p.desk && this.plan.zones && !this.bossIn && !this.trip(p, wall)) this.coffeeRun(p, wall);
        if (p.mode === 'wander' && !p.visit && !p.meeting) {
          if (p.poi && !p.path.length && p.until === Infinity) {
            p.until = wall + p.stay;
            if (p.poi.arrive) { this.lifeMark(p.poi.arrive, wall, p.stay, p); p.poi.arrive = null; }
          }
          this.wander(p, wall);
        }
        if (p.path.length) {
          const n = p.path[0];
          const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
          let v = SPEED * dt * (p.rush > wall ? 2.3 : 1);
          if (d > 0.001) p.walkFace = dx + dy >= 0 ? 'front' : 'back';
          if (d > 0.001) v = this.makeWay(p, dx / d, dy / d, v, dt);
          if (d <= v) { p.x = n.x; p.y = n.y; p.path.shift(); }
          else { p.x += (dx / d) * v; p.y += (dy / d) * v; }
        } else if (p.leaving) {
          if (p.viaLift) this.liftOpen = wall;
          this.people.delete(k);
        }
      }
      this.moveCat(dt, wall);
      if (this.cat2) this.moveCat(dt, wall, this.cat2);
      this.life(wall);
      this.stepStandup(wall);
      this.stepMe(dt);
      this.stepVisitors(dt);
      this.stepSlot(dt);
    }

    draw() {
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.cw, this.ch);
      this.fitCamera();
      c.translate(this.cam.ox, this.cam.oy);
      c.scale(this.cam.zoom, this.cam.zoom);

      this.drawRoom();
      const occupant = new Map();
      for (const p of this.people.values()) {
        if (p.mode === 'work' && p.desk) occupant.set(p.desk, p);
        else if (p.napDesk) occupant.set(p.napDesk, p);
      }
      const items = [...this.plan.items];
      for (const dk of [...this.plan.desks, ...(this.plan.sec ? [this.plan.sec, this.plan.boss] : [])]) {
        const p = occupant.get(dk);
        items.push({ depth: dk.x + 0.7 + dk.y + 0.4, draw: () => this.desk(dk, p) });
        items.push({ depth: dk.seat.x + dk.seat.y - 0.06, draw: () => this.chair(dk, p) });
      }
      if (this.me && this.me.seated && this.plan.boss) occupant.set(this.plan.boss, this.me);
      for (const p of this.bodies()) items.push({ depth: p.held ? 1e9 : p.x + p.y + 0.01, person: p });
      items.push({ depth: this.cat.x + this.cat.y, draw: () => this.drawCat() });
      if (this.cat2) items.push({ depth: this.cat2.x + this.cat2.y, draw: () => this.drawCat(this.cat2) });
      items.sort((a, b) => a.depth - b.depth);

      this.hit = [];
      const heads = [];
      for (const it of items) {
        if (it.person) heads.push([it.person, this.person(it.person)]);
        else it.draw();
      }
      if (this.closedNow) this.nightShade();
      this.pingPongBall();
      if (!this.compact) for (const dk of this.plan.desks) {
        const who = !occupant.get(dk) && this.leaveDesk(dk);
        if (who) { const at = this.iso(dk.x + 0.7, dk.y + 0.4, 1.25); this.leaveSign(at.x, at.y, who); }
      }
      if (!this.compact) for (const d of this.podDepts()) { const at = this.iso(d.x, d.y, d.z); this.deptPlaque(at.x, at.y, d.name, d.color); }
      if (!this.compact && this.roam === false) this.zoneSigns();
      this.deskSign();
      // Where a held person would be dropped onto furniture.
      if (this.dropAt) {
        const f = this.iso(this.dropAt.x, this.dropAt.y, 0);
        c.strokeStyle = '#8b6be6'; c.lineWidth = 3;
        const r = 20 + Math.sin(this.t / 120) * 3;
        c.beginPath(); c.ellipse(f.x, f.y, r, r / 2, 0, 0, Math.PI * 2); c.stroke();
      }
      if (this.compact) {
        // Keep labels readable when the room is scaled down for PiP.
        c.save();
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        for (const [p, at] of heads) this.bubble(p, {
          ...at, x: at.x * this.cam.zoom + this.cam.ox, y: at.y * this.cam.zoom + this.cam.oy,
        });
        c.restore();
      } else {
        for (const [p, at] of heads) this.bubble(p, at);
      }

      if (this.confetti && Date.now() - this.confetti.at < CONFETTI_MS) {
        const p = this.people.get(this.confetti.key);
        if (p) { const at = this.iso(p.x, p.y, 1); this.drawConfetti(at.x * this.cam.zoom + this.cam.ox, at.y * this.cam.zoom + this.cam.oy, Date.now() - this.confetti.at); }
      }
      if (this.offDuty > 0) {
        const d = this.iso(0.2, this.plan.door.y + 0.9, 0);
        c.font = '600 10px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
        c.textAlign = 'center';
        c.fillStyle = this.pal.text;
        c.globalAlpha = 0.65;
        c.fillText(`+${this.offDuty} ${this.offDutyLabel}`, d.x - 10, d.y + 14);
        c.globalAlpha = 1;
      }

      const z = this.cam.zoom;
      this.hit = this.hit.map((h) => ({
        key: h.key,
        x0: h.x0 * z + this.cam.ox, x1: h.x1 * z + this.cam.ox,
        y0: h.y0 * z + this.cam.oy, y1: h.y1 * z + this.cam.oy,
      }));
    }
  }

  // Which floor each session is on. Downstairs: the ones at work (up to
  // `cap`), waiting on you, failed, just finished, and the secretary.
  // Upstairs: the idle ones, and work beyond the downstairs desks. Someone
  // already working upstairs stays there until they stop, so nobody bounces
  // between floors. `prev`: key -> { floor, zone } from the last call.
  // Returns { floors: Map key -> { floor, zone }, moved: Set of keys that changed floor }.
  // Holidays the office dresses up for, by date: Halloween (late October),
  // Christmas (December), Lunar New Year (from ten days before to fifteen
  // after; the date moves, so a short table).
  const LNY = { 2026: [1, 17], 2027: [1, 6], 2028: [0, 26], 2029: [1, 13], 2030: [1, 3], 2031: [0, 23], 2032: [1, 11] };
  function seasonOf(d = new Date()) {
    const m = d.getMonth(), day = d.getDate();
    const ny = LNY[d.getFullYear()];
    if (ny) {
      const at = new Date(d.getFullYear(), ny[0], ny[1]).getTime(), DAY = 86_400_000;
      if (d.getTime() >= at - 10 * DAY && d.getTime() <= at + 15 * DAY) return 'lny';
    }
    if (m === 9 && day >= 20) return 'halloween';
    if (m === 11) return 'xmas';
    return null;
  }

  // Sitting down somewhere: face the table, coffee table or TV it belongs
  // to (a yaw for 3D, front/back for the 2D drawing).
  function orientSeats(pois, props) {
    const centres = props.filter((o) => /^(roundTable|meetingTable|coffeeTable|tv)$/.test(o.t)).map((o) => (
      o.t === 'roundTable' ? { x: o.x, y: o.y } : o.t === 'tv' ? { x: o.x + 0.55, y: o.y + 0.2 } : { x: o.x + (o.w || 0) / 2, y: o.y + (o.d || 0) / 2 }));
    for (const q of pois) {
      if (!q.sit || q.yaw != null || q.pair) continue;
      let best = null, bd = 2.4;
      for (const c of centres) { const d = Math.hypot(c.x - q.x, c.y - q.y); if (d < bd) { bd = d; best = c; } }
      if (!best) continue;
      // Sofas and chairs point one way: sit square on them, toward the
      // table's side. Round stools and beanbags turn to face it.
      if (q.act === 'couch' || q.act === 'meeting' || q.act === 'read') q.yaw = best.y >= q.y ? 0 : Math.PI;
      else q.yaw = Math.atan2(best.x - q.x, best.y - q.y);
      q.face = Math.cos(q.yaw) >= 0 ? 'front' : 'back';
    }
  }

  // A few idle ones stay downstairs and find something to do there (so the
  // office never feels empty); the rest go up to the lounge.
  const IDLE_DOWNSTAIRS = 4;
  function splitFloors(sessions, prev = new Map(), { cap = 12, isSecretary = null, allDown = false, idleDown = IDLE_DOWNSTAIRS } = {}) {
    const floors = new Map();
    const workers = [];
    // Only the newest matching session is the secretary (as in update()).
    const sec = isSecretary && sessions.filter((s) => !s.subagent && isSecretary(s)).sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))[0];
    for (const s of sessions) {
      if (s.subagent) continue;
      const zone = zoneOf(s);
      if (s === sec) floors.set(s.key, { floor: 1, zone });
      else if (zone === 'work') workers.push(s);
      else floors.set(s.key, { floor: zone === 'idle' ? 2 : 1, zone });
    }
    const was = (s) => prev.get(s.key);
    const stayUp = workers.filter((s) => was(s) && was(s).floor === 2 && was(s).zone === 'work');
    const rest = workers.filter((s) => !stayUp.includes(s))
      .sort((a, b) => (+!!(was(b) && was(b).floor === 1)) - (+!!(was(a) && was(a).floor === 1)) || (a.startedAt || 0) - (b.startedAt || 0));
    rest.forEach((s, i) => floors.set(s.key, { floor: i < cap ? 1 : 2, zone: 'work' }));
    for (const s of stayUp) floors.set(s.key, { floor: 2, zone: 'work' });
    // Idle ones that stay downstairs: the ones already down here first (no
    // trips up and down), then the most recently active.
    const idle = sessions.filter((s) => !s.subagent && s !== sec && zoneOf(s) === 'idle');
    const down = (s) => was(s) && was(s).floor === 1;
    idle.sort((a, b) => (+down(b)) - (+down(a)) || (b.lastEventAt || 0) - (a.lastEventAt || 0))
      .slice(0, idleDown).forEach((s) => floors.set(s.key, { floor: 1, zone: 'idle' }));
    // Helpers go wherever the session that sent them is.
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const s of sessions) {
      if (!s.subagent) continue;
      const parent = byId.get(s.parentId);
      floors.set(s.key, { floor: (parent && floors.get(parent.key) || { floor: 1 }).floor, zone: zoneOf(s) });
    }
    // Stand-up: everyone comes down to the meeting room.
    if (allDown) for (const v of floors.values()) v.floor = 1;
    const moved = new Set();
    for (const [k, v] of floors) if (prev.has(k) && prev.get(k).floor !== v.floor) moved.add(k);
    return { floors, moved };
  }

  window.Office = Office;
  window.OfficeFloors = { split: splitFloors, zoneOf };
  window.OfficeSeason = seasonOf;
  window.OfficeTraits = (key) => traitsOf(key).map((tr) => ({ id: tr.id, name: tr.name, emoji: tr.emoji }));

  // The replay: who was where at time T, from today's story (src/progress.js
  // track()), as sessions the office can show. `now` is the real clock (a
  // finished turn counts as just finished for 30 minutes of replayed time).
  function replayAt(spans, T, now = Date.now(), live = []) {
    const byKey = new Map(live.map((s) => [s.key, s]));
    const STATUS = { w: 'tool', q: 'waiting', e: 'error', d: 'done', i: 'idle' };
    const out = [];
    for (const [key, rec] of Object.entries(spans || {})) {
      let cur = null;
      for (const e of rec.s) { if (e[0] <= T) cur = e; else break; }
      if (!cur) continue;
      const base = byKey.get(key) || { key, agent: key.split(':')[0], id: key.slice(key.indexOf(':') + 1) };
      out.push({
        ...base, title: rec.title || base.title, status: STATUS[cur[1]], activity: cur[1] === 'w' ? '工作中' : null,
        task: null, outcome: null, ask: null, needs: null, question: null, talk: [], subagent: false,
        lastEventAt: now - (T - cur[0]), turnStartedAt: now - (T - cur[0]), startedAt: rec.s[0][0],
      });
    }
    return out;
  }
  window.OfficeReplay = { at: replayAt };
  window.OFFICE_UNLOCKS = UNLOCKS;
  window.OFFICE_LEVEL_TITLE = LEVEL_TITLE;
  window.OFFICE_AGENT_BADGES = AGENT_BADGES;
  window.OfficeGrid = Grid;
})();
