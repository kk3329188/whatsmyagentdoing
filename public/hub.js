// Hub edition additions: who each person is, what
// they are doing in plain words, and a side panel to look inside a session
// and steer it (jump to it in the desktop app, send it a message, stop it).
// Uses the page's globals at call time: L, state, esc, dur, ago, resumeCmd.
(() => {
  'use strict';

  const ACTIVE = new Set(['thinking', 'tool', 'typing']);
  const cut = (t, n) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // ---- what they are doing, in words

  const MCP = {
    'ccd_turn · update_plan': '更新進度',
    'ccd_turn · wrap_up': '收尾整理',
    'session-board · progress': '回報進度',
    'session-board · relay': '換班接手',
    'ccd_session · start_session': '開新 session',
    'ccd_session_mgmt · send_message': '傳話給其他 session',
    'ccd_session_mgmt · list_sessions': '看其他 session',
  };
  function words(activity) {
    const a = String(activity || '');
    if (!a) return '';
    if (MCP[a]) return MCP[a];
    let m;
    if ((m = a.match(/^(?:Bash|Shell): (.*)$/))) return `跑指令：${m[1]}`;
    if ((m = a.match(/^(?:Read) (.*)$/))) return `讀 ${m[1]}`;
    if ((m = a.match(/^(?:Edit|MultiEdit|NotebookEdit) (.*)$/))) return `改 ${m[1]}`;
    if ((m = a.match(/^Write (.*)$/))) return `寫 ${m[1]}`;
    if ((m = a.match(/^Grep (.*)$/))) return `搜尋 ${m[1]}`;
    if ((m = a.match(/^Glob (.*)$/))) return `找檔案 ${m[1]}`;
    if ((m = a.match(/^WebFetch ?(.*)$/))) return `看網頁 ${m[1]}`;
    if ((m = a.match(/^WebSearch (.*)$/))) return `上網查 ${m[1]}`;
    if ((m = a.match(/^Subagent: (.*)$/))) return `派助手：${m[1]}`;
    if ((m = a.match(/^Skill (.*)$/))) return `用技能 ${m[1]}`;
    if (a === 'AskUserQuestion') return '問你問題';
    if (a === 'ExitPlanMode') return '等你批准計畫';
    if (a === 'Updating todo list') return '更新待辦';
    const PLAIN = {
      SendMessage: '傳話給子代理／session', TaskStop: '停掉背景工作', Monitor: '盯背景工作', ToolSearch: '載入工具',
      ScheduleWakeup: '排定稍後回來', CronCreate: '建排程', Artifact: '發布網頁', ReadNotifications: '看通知',
      EnterPlanMode: '進入規劃', EnterWorktree: '開工作分支', ExitWorktree: '離開工作分支',
    };
    if (PLAIN[a]) return PLAIN[a];
    if ((m = a.match(/^(\S+) · (.*)$/))) {
      const [, server, tool] = m;
      if (/browser/i.test(server)) return `操作瀏覽器（${tool}）`;
      if (/chrome/i.test(server)) return `操作 Chrome（${tool}）`;
      if (/^slack_/.test(tool)) return `Slack：${tool.replace(/^slack_/, '')}`;
      if (server === 'ccd_session_mgmt' || server === 'ccd_session') return `管理 session（${tool}）`;
      return `用工具 ${tool}`;
    }
    return a;
  }

  // The short line in the bubble above a working person.
  function doing(s) {
    if (s.status === 'waiting') return '等你';
    return cut(words(s.activity) || '工作中', 16);
  }

  function steps(s) {
    if (s.plan && s.plan.length) {
      const done = s.plan.filter((x) => x.status === 'completed').length;
      const cur = s.plan.find((x) => x.status === 'in_progress');
      return { done, total: s.plan.length, step: cur ? cur.content : '' };
    }
    if (s.progress) return { done: s.progress.done, total: s.progress.total, step: s.progress.step };
    return null;
  }

  function name(s) {
    return s.title || s.project || s.agent;
  }

  // The name tag: the session's own title, plus how far through its steps.
  function label(s) {
    const p = steps(s);
    const busy = ACTIVE.has(s.status) || s.status === 'waiting';
    return cut(name(s), 16) + (p && busy && p.done < p.total ? ` · ${p.done}/${p.total}` : '');
  }

  // Sessions that need you: blocked on a question, failed, or a finished
  // turn that left you a decision.
  function needsYou(s) {
    if (s.subagent) return null;
    if (s.stuck) return `可能卡住：${s.stuck}`;
    if (s.status === 'waiting') return s.question || words(s.activity) || '在等你回覆';
    if (s.status === 'error') return s.error || '出錯了';
    if (s.status === 'done' && (s.ask || s.needs)) return s.ask || s.needs;
    return null;
  }

  // ---- side panel

  let openKey = null;
  let draft = '';
  let flash = '';
  let relayFrom = null; // key of the session whose reply is being passed on
  let opts = {};

  const panel = document.createElement('aside');
  panel.className = 'hub-panel';
  panel.hidden = true;
  const bar = document.createElement('div');
  bar.className = 'hub-needs';
  bar.hidden = true;

  function mount(o = {}) {
    opts = o;
    let { roam = true, onRoam } = o;
    document.body.appendChild(panel);
    document.body.appendChild(toastEl);
    const wrap = document.getElementById('officeWrap');
    wrap.parentNode.insertBefore(bar, wrap);
    // What you can read off a person, and a switch between roaming freely
    // and keeping to their state's room.
    const key = document.createElement('div');
    key.className = 'legend hub-zones';
    const draw = () => {
      const items = roam ? [
        ['var(--tool)', '坐在工作桌＝正在做（☕＝等長指令跑完去倒咖啡）'],
        ['var(--waiting)', '頭上 ! ＝等你回覆、? ＝留了決定給你（腳下橘圈）'],
        ['var(--error)', '抓頭＋紅圈＝出錯'],
        ['var(--done)', '✓ 綠圈＝30 分鐘內剛做完（Ⅱ＝被中斷）'],
        ['var(--idle)', '沒圈＝閒置，到處晃'],
      ] : [
        ['var(--tool)', '坐在工作桌＝正在做'],
        ['var(--waiting)', '會議室舉 ! ＝等你回覆、? ＝留了決定給你'],
        ['var(--error)', '機房前＝出錯'],
        ['var(--done)', '茶水間 ✓＝30 分鐘內剛做完（Ⅱ＝被中斷）'],
        ['var(--idle)', '休息區＝閒置；坐不下就走出門＝下班'],
      ];
      key.innerHTML = items.map(([c, t]) => `<span><span class="dot" style="color:${c}"></span>${t}</span>`).join('')
        + `<span class="hub-roam">按住人物拖到別處；丟到別人身上＝把他最後的回覆轉過去・<button type="button" data-k="roam">${roam ? '改成依狀態分區' : '改成自由走動'}</button>`
        + `<button type="button" data-k="sound">${Sound.on ? '🔔 音效開' : '🔕 音效關'}</button></span>`;
      key.querySelector('[data-k=roam]').onclick = () => { roam = !roam; draw(); if (onRoam) onRoam(roam); };
      key.querySelector('[data-k=sound]').onclick = () => { Sound.set(!Sound.on); draw(); if (Sound.on) Sound.play('done'); };
    };
    Sound.on = o.sound !== false;
    Sound.onChange = o.onSound;
    draw();
    wrap.appendChild(key);
    wrap.appendChild(xpEl);
  }

  // ---- sounds: made on the fly, no files

  const Sound = {
    on: true,
    ctx: null,
    last: 0,
    set(v) { this.on = v; if (this.onChange) this.onChange(v); },
    // Browsers only allow sound after you have clicked or typed on the page.
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch {}
    },
    tone(at, freq, len, { type = 'sine', vol = 0.18, to = null } = {}) {
      const c = this.ctx;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, at + len);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(c.destination);
      o.start(at); o.stop(at + len + 0.02);
    },
    // done: a two-note ding · error: a short alarm · wait: knock knock · level: a little fanfare
    play(kind) {
      if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
      const now = performance.now();
      if (now - this.last < 1200) return;
      this.last = now;
      const t = this.ctx.currentTime + 0.02;
      if (kind === 'done') { this.tone(t, 880, 0.35); this.tone(t + 0.13, 1320, 0.5); }
      else if (kind === 'error') { for (let i = 0; i < 3; i++) this.tone(t + i * 0.22, i % 2 ? 330 : 440, 0.18, { type: 'square', vol: 0.07 }); }
      else if (kind === 'wait') { this.tone(t, 190, 0.09, { type: 'triangle', vol: 0.5, to: 90 }); this.tone(t + 0.16, 190, 0.09, { type: 'triangle', vol: 0.5, to: 90 }); }
      else if (kind === 'level') { [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, f, 0.25, { type: 'triangle', vol: 0.12 })); }
    },
  };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => Sound.unlock(), { capture: true });

  const isWait = (s) => s.status === 'waiting' || (s.status === 'done' && !!(s.ask || s.needs));
  const BUSY = new Set(['thinking', 'tool', 'typing']);
  const seen = new Map(); // key -> { status, wait, level, reminded }
  // Called with each snapshot: a ding when a turn finishes, an alarm on an
  // error, a knock when one starts waiting on you (and again after 10 minutes).
  function chime(sessions, first) {
    let sound = null;
    const rank = { level: 1, done: 2, wait: 3, error: 4 };
    const want = (k) => { if (!sound || rank[k] > rank[sound]) sound = k; };
    for (const s of sessions) {
      if (s.subagent) continue;
      const b = seen.get(s.key);
      const now = { status: s.status, wait: isWait(s), level: s.level || 1, reminded: b ? b.reminded : false };
      if (!now.wait) now.reminded = false;
      if (b && !first) {
        if (s.status === 'error' && b.status !== 'error') want('error');
        else if (now.wait && !b.wait) want('wait');
        else if (s.status === 'done' && BUSY.has(b.status)) want('done');
        if (now.level > b.level) want('level');
        if (now.wait && !now.reminded && Date.now() - state.skew - (s.lastEventAt || 0) > 10 * 60_000) { now.reminded = true; want('wait'); }
      } else if (now.wait && Date.now() - state.skew - (s.lastEventAt || 0) > 10 * 60_000) now.reminded = true;
      seen.set(s.key, now);
    }
    if (sound) Sound.play(sound);
  }

  // ---- experience and unlocks

  const xpEl = document.createElement('div');
  xpEl.className = 'legend hub-xp';
  xpEl.hidden = true;
  const toastEl = document.createElement('div');
  toastEl.className = 'hub-toast';
  toastEl.hidden = true;
  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 5000);
  }
  function progress(office, fresh) {
    if (!office) { xpEl.hidden = true; return; }
    const list = window.OFFICE_UNLOCKS || [];
    const have = list.filter((u) => office.turns >= u.at);
    const next = list.find((u) => office.turns < u.at);
    xpEl.hidden = false;
    xpEl.innerHTML = `<span>🏢 辦公室累積完成 <b>${office.turns}</b> 輪</span>`
      + `<span>已解鎖：${have.length ? have.map((u) => esc(u.name)).join('、') : '還沒有'}</span>`
      + (next ? `<span>下一個：${esc(next.name)}（再 ${next.at - office.turns} 輪）</span>` : '<span>全部解鎖了 🎉</span>')
      + '<span class="hub-muted">每個人：做一個動作 +1、做完一輪 +5 經驗，升等會換裝（識別證→耳機→領帶→皇冠）</span>';
    if (fresh && fresh.length) { toast(`🎉 辦公室解鎖：${fresh.join('、')}`); Sound.play('level'); }
  }

  const LV_MIN = [0, 0, 60, 200, 600, 1500];
  function levelLine(s) {
    if (!s.level) return '';
    const title = (window.OFFICE_LEVEL_TITLE || [])[s.level] || '';
    const span = s.next ? s.next - LV_MIN[s.level] : 0;
    const pct = s.next ? Math.round(((s.xp - LV_MIN[s.level]) / span) * 100) : 100;
    return `<div class="hub-lv"><b>Lv${s.level} ${esc(title)}</b><span class="hub-bar"><i style="width:${pct}%"></i></span><span class="hub-muted">${s.next ? `經驗 ${s.xp}/${s.next}` : `經驗 ${s.xp}・滿級`}</span></div>`;
  }

  // Dropped one person on another in the office: pass the first one's last
  // reply on to the second, after you have looked it over.
  function relay(from, to) {
    if (PRIVATE || !from || !to || from.key === to.key) return;
    if (!to.controllable) { toast('只能把話轉給 Claude Code 的 session'); return; }
    const said = from.recap || from.reply || from.ask || '';
    const head = `〔轉自「${cut(name(from), 30)}」〕`;
    open(to.key);
    relayFrom = from.key;
    draft = said ? `${head}\n${cut(said, 3800)}` : `${head}\n`;
    render();
    focusBox();
  }

  async function post(action, body) {
    try {
      const r = await fetch(`/api/hub/${action}`, {
        method: 'POST',
        headers: { 'x-whatsmyagentdoing': 'hub', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await r.json().catch(() => ({ ok: r.ok }));
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  const ACK = {
    sent: '已送出', queued: '已排隊：這輪結束後送出', stopped: '已中斷',
    'skipped:idle': '沒中斷：它當時沒在跑', 'skipped:stale': '沒送：指令放太久（超過 10 分鐘）',
    'skipped:unverified': '沒送：核對不到 Touch ID 的授權（myoffice 要開在 4545 埠）',
  };
  function ackText(a) {
    if (!a) return '';
    const what = a.kind === 'stop' ? '中斷' : '訊息';
    return `上一個${what}：${ACK[a.outcome] || a.outcome}（${ago(a.at, Date.now() - state.skew)}）`;
  }

  const PERM = { bypassPermissions: '全權限', acceptEdits: '自動改檔', plan: '規劃模式', default: '每步詢問', auto: '自動判斷' };
  // What this session can do, and what it has left lying around.
  function badges(s) {
    const b = [];
    if (s.permission) b.push([PERM[s.permission] || s.permission, s.permission === 'bypassPermissions' ? 'warn' : '']);
    if (s.model) b.push([s.model.replace(/^claude-/, '') + (s.effort ? ` · ${s.effort}` : ''), '']);
    const g = s.git;
    if (g && g.branch) b.push([`分支 ${g.branch}`, '']);
    if (g && g.dirty) b.push([`${g.dirty} 檔未 commit`, 'warn']);
    if (g && g.ahead) b.push([`${g.ahead} commit 未推`, 'warn']);
    if (g && g.branch && !g.upstream) b.push(['分支沒有遠端', '']);
    return b.length ? `<div class="hub-badges">${b.map(([t, k]) => `<span class="hub-badge ${k}">${esc(t)}</span>`).join('')}</div>` : '';
  }

  // The subagents it has running right now.
  function helperList(s, now) {
    const kids = state.data.sessions.filter((k) => k.subagent && k.parentId === s.id && (ACTIVE.has(k.status) || now - (k.lastEventAt || 0) < 10 * 60_000));
    if (!kids.length) return '';
    return `<div class="hub-sec"><h4>它派出的助手 ${kids.length}</h4><ul class="hub-recent">${kids.map((k) =>
      `<li><time>${esc(L[k.status] || k.status)}</time>${esc(cut(k.title || k.prompt || '助手', 60))}${k.activity ? `<span class="hub-muted">　${esc(words(k.activity))}</span>` : ''}</li>`).join('')}</ul></div>`;
  }

  function statusLine(s, now) {
    const st = L[s.status] || s.status;
    if ((ACTIVE.has(s.status) || s.status === 'waiting') && s.turnStartedAt) return `${st} · 這輪已 ${dur(now - s.turnStartedAt)}`;
    return s.lastEventAt ? `${st} · ${ago(s.lastEventAt, now)}` : st;
  }

  function render() {
    renderBar();
    if (!openKey) { panel.hidden = true; return; }
    const s = state.data.sessions.find((x) => x.key === openKey);
    if (!s) { close(); return; }
    // Don't rebuild while you type: it would drop focus and the caret.
    const box = panel.querySelector('textarea');
    const typing = box && document.activeElement === box && panel.dataset.key === s.key;
    if (typing && box.value) { updateLive(s); return; }
    const now = Date.now() - state.skew;
    const p = steps(s);
    const need = needsYou(s);
    const active = ACTIVE.has(s.status);
    const where = [s.project, s.branch, (s.model || '').replace(/^claude-/, '')].filter(Boolean).join(' · ');
    const plan = s.plan && s.plan.length
      ? `<ol class="hub-plan">${s.plan.map((x) => `<li data-st="${esc(x.status)}"><span>${x.status === 'completed' ? '✓' : x.status === 'in_progress' ? '▶' : '○'}</span>${esc(x.content)}</li>`).join('')}</ol>`
      : p ? `<p class="hub-muted">${esc(p.step || '')}</p>` : '<p class="hub-muted">這個 session 沒有列步驟。</p>';
    const recent = (s.recent || []).slice().reverse()
      .map((r) => `<li><time>${esc(r.at ? ago(r.at, now) : '')}</time>${esc(words(r.text))}</li>`).join('');
    const canSay = s.controllable && !PRIVATE;
    panel.dataset.key = s.key;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="hub-head">
        <div>
          <h3 title="${esc(name(s))}">${esc(name(s))}</h3>
          <div class="hub-status" data-s="${esc(s.status)}"><span class="dot" style="color:var(--s)"></span><span id="hubStatus">${esc(statusLine(s, now))}</span></div>
          <div class="hub-muted" title="${esc(s.cwd || '')}">${esc(where)}</div>
        </div>
        <button class="hub-x" aria-label="關閉">×</button>
      </div>
      ${levelLine(s)}
      ${relayFrom && canSay ? `<div class="hub-relay">↪ 轉話：把「${esc(cut(name(state.data.sessions.find((x) => x.key === relayFrom) || {}), 24))}」的最後回覆轉給這個 session。可以先改內容，按 Enter 送出。<button class="hub-btn" data-act="unrelay">不轉了</button></div>` : ''}
      ${need ? `<div class="hub-need"><b>${s.stuck ? '可能卡住' : '等你處理'}</b>${esc(s.stuck || need)}
        ${s.choices && canSay ? `<div class="hub-row hub-choices">${s.choices.map((c, i) => `<button class="hub-btn primary" data-choice="${i}" title="${esc(c.message)}">${esc(c.label)}</button>`).join('')}</div>` : ''}
        ${s.options ? `<div class="hub-row hub-choices">${s.options.map((o) => `<span class="hub-chip">${esc(o)}</span>`).join('')}</div><p class="hub-muted">選擇題要切過去才能回答。</p>` : ''}
        ${s.stuck && canSay ? '<div class="hub-row hub-choices"><button class="hub-btn" data-say="你好像卡住了：先停下，用一兩句話說明現在卡在哪、試過什麼，再等我指示。">問它卡在哪</button></div>' : ''}
      </div>` : ''}
      ${badges(s)}
      ${helperList(s, now)}
      ${active && s.activity ? `<div class="hub-sec"><h4>正在做</h4><p id="hubDoing">${esc(words(s.activity))}</p></div>` : ''}
      <div class="hub-sec"><h4>進度${p ? ` <span class="hub-count">${p.done}/${p.total}</span>` : ''}</h4>
        ${p ? `<div class="hub-bar"><i style="width:${Math.round((p.done / Math.max(1, p.total)) * 100)}%"></i></div>` : ''}
        ${plan}
      </div>
      ${s.summary ? `<div class="hub-sec"><h4>App 摘要</h4><p>${esc(s.summary)}</p></div>` : ''}
      ${recent ? `<div class="hub-sec"><h4>最近動作</h4><ul class="hub-recent">${recent}</ul></div>` : ''}
      ${s.prompt ? `<div class="hub-sec"><h4>你最後說</h4><p class="hub-quote">${esc(s.prompt)}</p></div>` : ''}
      ${s.recap || s.reply ? `<div class="hub-sec"><h4>它最後回</h4><p class="hub-quote">${esc(s.recap || s.reply)}</p></div>` : ''}
      <div class="hub-sec hub-actions">
        <h4>操作</h4>
        <div class="hub-row">
          ${s.ccdId ? '<button class="hub-btn primary" data-act="open">切到這個 session</button>' : ''}
          ${canSay && active ? '<button class="hub-btn danger" data-act="stop">中斷這一輪</button>' : ''}
          <button class="hub-btn" data-copy="${esc(resumeCmd(s))}">${esc(L.copy)}</button>
        </div>
        ${canSay ? `
        <textarea rows="3" placeholder="傳話給這個 session：打完按 Enter 送出（Shift+Enter 換行）">${esc(draft)}</textarea>
        <div class="hub-row"><button class="hub-btn primary" data-act="say">送出</button><span class="hub-muted" id="hubAck">${esc(flash || (s.pending ? `排隊中（${s.pending}）：等 session 收件` : ackText(s.ack)))}</span></div>
        <p class="hub-muted hub-note">第一次送出或中斷要按一次 Touch ID，之後 8 小時這個瀏覽器免按。訊息以你的身分出現在該 session，開頭標〔myoffice〕；它正在跑就排到這輪結束才送。中斷只結束這一輪，當時正在跑的指令會轉到背景跑完。</p>` : ''}
      </div>`;
    if (typing) focusBox();
  }

  // Refresh only the moving parts while you type in the box.
  function updateLive(s) {
    const now = Date.now() - state.skew;
    const st = panel.querySelector('#hubStatus');
    if (st) st.textContent = statusLine(s, now);
    const d = panel.querySelector('#hubDoing');
    if (d) d.textContent = words(s.activity);
    const a = panel.querySelector('#hubAck');
    if (a) a.textContent = flash || (s.pending ? `排隊中（${s.pending}）：等 session 收件` : ackText(s.ack));
  }

  function renderBar() {
    const list = state.data.sessions.map((s) => [s, needsYou(s)]).filter(([, n]) => n);
    bar.hidden = !list.length || PRIVATE;
    bar.innerHTML = list.length
      ? `<b>等你處理／待你決定 ${list.length}</b>` + list.map(([s, n]) =>
        `<button data-open="${esc(s.key)}" data-s="${esc(s.status)}" title="${esc(n)}"><span class="dot" style="color:var(--s)"></span>${esc(cut(name(s), 18))}<small>${esc(cut(n, 40))}</small></button>`).join('')
      : '';
  }

  // Opening a session puts the caret in its message box: just type and press Enter.
  function focusBox() {
    const box = panel.querySelector('textarea');
    if (box && document.activeElement !== box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
  function open(key) {
    if (openKey !== key) { draft = ''; flash = ''; relayFrom = null; }
    openKey = key;
    render();
    focusBox();
  }
  function close() {
    openKey = null;
    relayFrom = null;
    panel.hidden = true;
    panel.innerHTML = '';
  }

  async function act(kind, preset) {
    const s = state.data.sessions.find((x) => x.key === openKey);
    if (!s) return;
    let r;
    if (kind !== 'open' && kind !== 'unrelay') { flash = '送出中…（這個瀏覽器第一次用要按 Touch ID）'; updateLive(s); }
    if (kind === 'unrelay') {
      relayFrom = null; draft = '';
      const box = panel.querySelector('textarea');
      if (box) box.value = '';
      render(); focusBox();
      return;
    }
    if (kind === 'say') {
      const box = panel.querySelector('textarea');
      const text = (preset != null ? preset : box ? box.value : draft).trim();
      if (!text) return;
      r = await post('say', { key: s.key, text });
      if (r.ok && preset == null) { draft = ''; if (box) box.value = ''; }
      if (r.ok && relayFrom && preset == null) {
        if (opts.onRelayed) opts.onRelayed(relayFrom, s.key, text);
        relayFrom = null;
      }
    } else {
      r = await post(kind, { key: s.key });
    }
    flash = r.ok ? (kind === 'open' ? '已在桌面 app 打開' : '已交給 session，約 2 秒內收件') : `失敗：${r.error || '未知錯誤'}`;
    if (panel.querySelector('textarea')) panel.querySelector('textarea').blur();
    render();
    if (kind === 'say') focusBox();
    setTimeout(() => { flash = ''; render(); }, 5000);
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('.hub-x')) return close();
    const b = e.target.closest('[data-act]');
    if (b) return act(b.dataset.act);
    const c = e.target.closest('[data-choice]');
    if (c) {
      const s = state.data.sessions.find((x) => x.key === openKey);
      const pick = s && s.choices && s.choices[Number(c.dataset.choice)];
      if (pick) return act('say', pick.message);
    }
    const q = e.target.closest('[data-say]');
    if (q) act('say', q.dataset.say);
  });
  panel.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') draft = e.target.value; });
  panel.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'TEXTAREA') return;
    // Enter sends; Shift+Enter is a new line. Enter that confirms a Chinese
    // input method's candidate is left alone.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); act('say'); }
    if (e.key === 'Escape' && !e.target.value) close();
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) open(b.dataset.open);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openKey && document.activeElement?.tagName !== 'TEXTAREA') close();
  });

  let PRIVATE = false;
  window.Hub = {
    mount, render, open, close, label, doing, words, steps, name, relay, chime, progress, toast,
    setPrivate(v) { PRIVATE = !!v; },
    get openKey() { return openKey; },
  };
})();
