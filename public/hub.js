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
    loadLocal();
    let { roam = true, onRoam } = o;
    document.body.appendChild(panel);
    document.body.appendChild(toastEl);
    document.body.appendChild(modalEl);
    const wrap = document.getElementById('officeWrap');
    wrap.parentNode.insertBefore(bar, wrap);
    wrap.parentNode.insertBefore(pinsEl, wrap);
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
    wrap.appendChild(toolsEl);
    renderTools();
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
        const at = Date.now();
        const log = (kind) => { eventLog.push({ key: s.key, kind, at }); if (eventLog.length > 300) eventLog.shift(); };
        if (s.status === 'error' && b.status !== 'error') { want('error'); log('error'); }
        else if (now.wait && !b.wait) { want('wait'); log('wait'); }
        else if (s.status === 'done' && BUSY.has(b.status)) { want('done'); log('done'); }
        if (now.level > b.level) { want('level'); log('level'); }
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
  function toast(text, action) {
    toastEl.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { toastEl.hidden = true; action.fn(); };
      toastEl.appendChild(b);
    }
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
    renderPins();
    renderTools();
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
          ${s.agent === 'claude' ? `<button class="hub-btn" data-act="secretary">${isSecretary(s) ? '不當秘書了' : '設為秘書'}</button>` : ''}
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
    if (kind !== 'open' && kind !== 'unrelay' && kind !== 'secretary') { flash = '送出中…（這個瀏覽器第一次用要按 Touch ID）'; updateLive(s); }
    if (kind === 'secretary') {
      if (isSecretary(s)) { store.set('secretary', '\u0000'); toast('已取消秘書'); }
      else { const pat = secretaryPattern(s); store.set('secretary', pat); toast(`標題含「${cut(pat, 20)}」的 session 會當你的秘書`); }
      if (opts.onChange) opts.onChange();
      render();
      return;
    }
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

  // ---- a dialog for summaries, reports and confirmations

  const modalEl = document.createElement('div');
  modalEl.className = 'hub-modal';
  modalEl.hidden = true;
  let modalDone = null, modalYes = null, modalText = '';
  function modal(html, { onClose = null, onYes = null, text = '' } = {}) {
    modalEl.innerHTML = `<div class="hub-card" role="dialog">${html}</div>`;
    modalEl.hidden = false;
    modalDone = onClose; modalYes = onYes; modalText = text;
  }
  function closeModal() {
    if (modalEl.hidden) return;
    modalEl.hidden = true;
    modalEl.innerHTML = '';
    const f = modalDone;
    modalDone = modalYes = null;
    if (f) f();
  }
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl || e.target.closest('[data-m=close]')) return closeModal();
    const o = e.target.closest('[data-open]');
    if (o) { const k = o.dataset.open; closeModal(); open(k); return; }
    if (e.target.closest('[data-m=copy]')) { copy(modalText, '已複製'); return; }
    if (e.target.closest('[data-m=yes]')) { const f = modalYes; modalYes = null; closeModal(); if (f) f(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalEl.hidden) closeModal(); });

  function copy(text, done) {
    const fallback = () => modal(`<h3>複製這段</h3><textarea class="hub-copy" rows="12" readonly>${esc(text)}</textarea><div class="hub-row"><button class="hub-btn" data-m="close">關閉</button></div>`);
    try {
      navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    } catch { fallback(); }
  }

  const byKey = (k) => state.data.sessions.find((x) => x.key === k);
  const nameOf = (k) => { const s = byKey(k); return s ? name(s) : '（已關閉的 session）'; };
  const mins = (ms) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)} 小時` : `${Math.max(1, Math.round(ms / 60_000))} 分`);

  // ---- dropped on furniture

  // One session as plain text: what to paste into a chat or a ticket.
  function sessionReport(s) {
    const lines = [`【${name(s)}】${L[s.status] || s.status}`];
    const p = steps(s);
    if (s.plan && s.plan.length) {
      lines.push(`進度 ${p.done}/${p.total}`);
      for (const x of s.plan) lines.push(`${x.status === 'completed' ? '✓' : x.status === 'in_progress' ? '▶' : '○'} ${x.content}`);
    } else if (p) lines.push(`進度 ${p.done}/${p.total}${p.step ? `：${p.step}` : ''}`);
    const need = needsYou(s);
    if (need) lines.push(`等你處理：${need}`);
    if (s.recap || s.reply) lines.push('', `最後回覆：${s.recap || s.reply}`);
    const g = s.git;
    if (g && (g.branch || g.dirty || g.ahead)) lines.push('', [g.branch && `分支 ${g.branch}`, g.dirty && `${g.dirty} 檔未 commit`, g.ahead && `${g.ahead} commit 未推`].filter(Boolean).join('・'));
    return lines.join('\n');
  }

  let pins = [];
  let hidden = {};
  function loadLocal() { pins = store.get('pins', []); hidden = store.get('hidden', {}); }

  function togglePin(s) {
    if (pins.includes(s.key)) { pins = pins.filter((k) => k !== s.key); toast(`已從白板拿下「${cut(name(s), 20)}」`); }
    else { pins = [...pins, s.key].slice(-6); toast(`📌 已把「${cut(name(s), 20)}」釘到白板`); }
    store.set('pins', pins);
    renderPins();
  }
  function pinNames() { return pins.map((k) => byKey(k)).filter(Boolean).map((s) => cut(name(s), 14)); }

  const pinsEl = document.createElement('div');
  pinsEl.className = 'hub-pins';
  pinsEl.hidden = true;
  function renderPins() {
    const list = pins.map((k) => byKey(k)).filter(Boolean);
    pinsEl.hidden = !list.length || PRIVATE;
    pinsEl.innerHTML = list.length ? '<b>📌 白板</b>' + list.map((s) => {
      const p = steps(s);
      return `<span class="hub-pin" data-s="${esc(s.status)}"><button data-open="${esc(s.key)}"><span class="dot" style="color:var(--s)"></span>${esc(cut(name(s), 18))}`
        + `${p ? `<small>${p.done}/${p.total}${p.step ? ' ' + esc(cut(p.step, 18)) : ''}</small>` : `<small>${esc(L[s.status] || s.status)}</small>`}</button>`
        + `<button class="hub-unpin" data-unpin="${esc(s.key)}" aria-label="拿下">×</button></span>`;
    }).join('') : '';
  }
  pinsEl.addEventListener('click', (e) => {
    const u = e.target.closest('[data-unpin]');
    if (u) { pins = pins.filter((k) => k !== u.dataset.unpin); store.set('pins', pins); renderPins(); return; }
    const o = e.target.closest('[data-open]');
    if (o) open(o.dataset.open);
  });

  // Dropped at the door: off the page until it does something new.
  function isHidden(s) {
    const h = hidden[s.key];
    if (h == null) return false;
    if ((s.lastEventAt || 0) > h) { delete hidden[s.key]; store.set('hidden', hidden); return false; }
    return true;
  }
  function hide(s) {
    hidden[s.key] = s.lastEventAt || 0;
    store.set('hidden', hidden);
    if (openKey === s.key) close();
    toast(`🚪「${cut(name(s), 20)}」先不顯示，它有新動靜會自己回來`, { label: '復原', fn: () => { delete hidden[s.key]; store.set('hidden', hidden); renderTools(); if (opts.onChange) opts.onChange(); } });
    renderTools();
    if (opts.onChange) opts.onChange();
  }

  function askStop(s) {
    if (!s.controllable) return toast('只能停 Claude Code 的 session');
    if (!ACTIVE.has(s.status)) return toast(`「${cut(name(s), 20)}」現在沒在跑，不用停`);
    modal(`<h3>要中斷「${esc(cut(name(s), 30))}」這一輪嗎？</h3><p class="hub-muted">只結束這一輪；當時正在跑的指令會轉到背景跑完。這個瀏覽器 8 小時內第一次用要按 Touch ID。</p>
      <div class="hub-row"><button class="hub-btn danger" data-m="yes">中斷</button><button class="hub-btn" data-m="close">取消</button></div>`, {
      onYes: async () => {
        toast('送出中…');
        const r = await post('stop', { key: s.key });
        toast(r.ok ? `已叫「${cut(name(s), 20)}」停下這一輪` : `沒停成：${r.error || '未知錯誤'}`);
      },
    });
  }

  function command(kind, s) {
    if (PRIVATE || !s || s.secretary) return;
    if (kind === 'printer') return copy(sessionReport(s), `🖨 已把「${cut(name(s), 20)}」的報告複製到剪貼簿`);
    if (kind === 'whiteboard') return togglePin(s);
    if (kind === 'coffee') return askStop(s);
    if (kind === 'door') return hide(s);
  }

  // ---- the secretary: which session it is, and the welcome-back summary

  // The secretary: sessions whose title contains what you picked with
  // 「設為秘書」 (dates left out, so tomorrow's one with the same name counts
  // too), or by default one titled secretary.
  const SECRETARY = /秘書|總機|secretary/i;
  function isSecretary(s) {
    if (s.agent !== 'claude' || s.subagent) return false;
    const pat = store.get('secretary', null);
    return pat ? (s.title || '').includes(pat) : SECRETARY.test(s.title || '');
  }
  const secretaryPattern = (s) => name(s).replace(/\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}/g, '').trim() || name(s);

  const AWAY_MS = 10 * 60_000;
  const eventLog = []; // { key, kind, at }
  let lastActive = Date.now(), awayFrom = null, lastSummary = null;
  function active() {
    const now = Date.now();
    if (now - lastActive < 1000 && awayFrom == null) return;
    if (awayFrom == null && now - lastActive > AWAY_MS) awayFrom = lastActive;
    lastActive = now;
    if (awayFrom != null) { const from = awayFrom; awayFrom = null; if (now - from >= AWAY_MS) welcome(from, now); }
    maybeReport();
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'focus']) window.addEventListener(ev, active, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (awayFrom == null) awayFrom = Date.now(); } else active();
  });

  // What happened while you were away, in one card; the secretary brings it over.
  function welcome(from, now) {
    if (PRIVATE || !state.data) return;
    const latest = new Map();
    for (const e of eventLog) if (e.at >= from) latest.set(e.key + e.kind, e);
    const of = (kind) => [...latest.values()].filter((e) => e.kind === kind && byKey(e.key));
    const needs = state.data.sessions.map((s) => [s, needsYou(s)]).filter(([, n]) => n);
    const done = of('done').filter((e) => !needs.some(([s]) => s.key === e.key));
    const errors = of('error'), levels = of('level');
    if (!needs.length && !done.length && !errors.length && !levels.length) return;
    const row = (k, small) => `<li><button data-open="${esc(k)}">${esc(cut(nameOf(k), 30))}</button>${small ? `<small>${esc(cut(small, 70))}</small>` : ''}</li>`;
    const sec = state.data.sessions.filter(isSecretary).sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))[0];
    const html = `<h3>📋 ${sec ? `秘書「${esc(cut(name(sec), 16))}」：` : ''}你離開了 ${mins(now - from)}</h3>`
      + (needs.length ? `<h4>等你處理 ${needs.length}</h4><ul class="hub-list">${needs.map(([s, n]) => row(s.key, n)).join('')}</ul>` : '')
      + (errors.length ? `<h4>出錯 ${errors.length}</h4><ul class="hub-list">${errors.map((e) => row(e.key, byKey(e.key).error)).join('')}</ul>` : '')
      + (done.length ? `<h4>做完了 ${done.length}</h4><ul class="hub-list">${done.map((e) => { const s = byKey(e.key); return row(e.key, s.recap || s.reply); }).join('')}</ul>` : '')
      + (levels.length ? `<h4>升等</h4><ul class="hub-list">${levels.map((e) => row(e.key, `Lv${byKey(e.key).level}`)).join('')}</ul>` : '')
      + '<div class="hub-row"><button class="hub-btn primary" data-m="close">知道了</button></div>';
    lastSummary = html;
    const short = [needs.length && `${needs.length} 個等你`, errors.length && `${errors.length} 個出錯`, done.length && `${done.length} 個做完`].filter(Boolean).join('、');
    if (opts.onAway) opts.onAway(`你不在時：${short || '有新消息'}，點我看`);
    showAway();
  }
  function showAway() {
    if (!lastSummary) return;
    modal(lastSummary, { onClose: () => { if (opts.onAwayDone) opts.onAwayDone(); } });
  }

  // ---- end-of-day report

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function maybeReport() {
    const o = state.data && state.data.office;
    if (PRIVATE || PIP_PAGE || !o || !o.today || new Date().getHours() < 18) return;
    if (store.get('reportDay', null) === today() || !modalEl.hidden) return;
    store.set('reportDay', today());
    report();
  }
  function report() {
    const o = state.data && state.data.office;
    if (!o || !o.today) return toast('還沒有今天的資料');
    const t = o.today;
    const now = Date.now() - state.skew;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const busy = t.top.filter((r) => r.turns || r.tools).slice(0, 5);
    // Loose ends: unfinished steps, uncommitted or unpushed work, things waiting on you.
    // Code is per folder (many sessions share one), so it is listed once per folder.
    const ends = [];
    const repos = new Map();
    for (const s of state.data.sessions) {
      if (s.subagent || (s.lastEventAt || 0) < midnight.getTime() || isHidden(s)) continue;
      const items = [];
      const p = steps(s);
      if (p && p.done < p.total) items.push(`還有 ${p.total - p.done} 步${p.step ? `（目前：${cut(p.step, 30)}）` : ''}`);
      const n = needsYou(s);
      if (n) items.push(`等你：${cut(n, 40)}`);
      if (items.length) ends.push([s, items]);
      if (s.git && (s.git.dirty || s.git.ahead) && s.cwd) repos.set(s.cwd, s);
    }
    // A folder inside another one with the same branch is the same repository.
    const code = [];
    const kept = [];
    for (const [cwd, s] of [...repos].sort((x, y) => x[0].length - y[0].length)) {
      const g = s.git;
      if (kept.some(([c, k]) => cwd.startsWith(c + '/') && k.branch === g.branch && k.ahead === g.ahead)) continue;
      kept.push([cwd, g]);
      code.push(`${s.project || cwd}${g.branch ? `（${g.branch}）` : ''}：${[g.dirty && `${g.dirty} 檔未 commit`, g.ahead && `${g.ahead} commit 未推`].filter(Boolean).join('、')}`);
    }
    const lines = [`${t.date} 日報`, `今天完成 ${t.turns} 輪、${t.tools} 個動作`];
    if (t.answered) lines.push(`你回覆了 ${t.answered} 次，平均 ${mins(t.avgWaitMs)}${t.longest[0] ? `；等最久：${nameOf(t.longest[0].key)} ${mins(t.longest[0].ms)}` : ''}`);
    if (busy.length) lines.push('', '最忙：', ...busy.map((r) => `- ${nameOf(r.key)}：${r.turns} 輪、${r.tools} 個動作`));
    if (ends.length) lines.push('', '明天要記得：', ...ends.map(([s, items]) => `- ${name(s)}：${items.join('；')}`));
    if (code.length) lines.push('', '還沒收的程式碼：', ...code.map((c) => `- ${c}`));
    const html = `<h3>📋 ${esc(t.date)} 日報</h3>
      <p>今天完成 <b>${t.turns}</b> 輪、<b>${t.tools}</b> 個動作${t.answered ? `；你回覆了 ${t.answered} 次，平均 <b>${mins(t.avgWaitMs)}</b>` : ''}</p>
      ${t.longest[0] ? `<p class="hub-muted">等你最久：${t.longest.map((w) => `${esc(cut(nameOf(w.key), 16))} ${mins(w.ms)}`).join('、')}</p>` : ''}
      ${busy.length ? `<h4>最忙</h4><ul class="hub-list">${busy.map((r) => `<li><button data-open="${esc(r.key)}">${esc(cut(nameOf(r.key), 30))}</button><small>${r.turns} 輪・${r.tools} 個動作</small></li>`).join('')}</ul>` : ''}
      ${ends.length ? `<h4>明天要記得 ${ends.length}</h4><ul class="hub-list">${ends.map(([s, items]) => `<li><button data-open="${esc(s.key)}">${esc(cut(name(s), 30))}</button><small>${esc(items.join('；'))}</small></li>`).join('')}</ul>` : ''}
      ${code.length ? `<h4>還沒收的程式碼 ${code.length}</h4><ul class="hub-list">${code.map((c) => `<li><small>${esc(c)}</small></li>`).join('')}</ul>` : ''}
      ${!ends.length && !code.length ? '<p class="hub-muted">沒有留下沒收的尾巴 👍</p>' : ''}
      <p class="hub-muted">只算儀表板開著時看到的動作；回覆時間從它開始等你算到你回。</p>
      <div class="hub-row"><button class="hub-btn primary" data-m="copy">複製成文字</button><button class="hub-btn" data-m="close">關閉</button></div>`;
    modal(html, { text: lines.join('\n') });
    void now;
  }

  // The row under the legend: the report, and who is kept off the page.
  const toolsEl = document.createElement('div');
  toolsEl.className = 'legend hub-tools';
  function renderTools() {
    const n = state.data ? state.data.sessions.filter((s) => hidden[s.key] != null && isHidden(s)).length : 0;
    const sig = `${n}|${PRIVATE}`;
    if (toolsEl.dataset.sig === sig) return;
    toolsEl.dataset.sig = sig;
    toolsEl.innerHTML = PRIVATE ? '' : '<button type="button" data-tool="report">📋 今日日報</button>'
      + (n ? `<button type="button" data-tool="unhide">🚪 ${n} 個先不顯示・全部叫回來</button>` : '')
      + '<span class="hub-muted">拖到印表機＝複製報告、白板＝釘選、咖啡機＝叫它停下、門口＝先不顯示</span>';
  }
  toolsEl.addEventListener('click', (e) => {
    const b = e.target.closest("[data-tool]");
    if (!b) return;
    if (b.dataset.tool === 'report') report();
    if (b.dataset.tool === 'unhide') { hidden = {}; store.set('hidden', hidden); renderTools(); if (opts.onChange) opts.onChange(); }
  });

  const PIP_PAGE = new URLSearchParams(location.search).get('pip') === '1';

  let PRIVATE = false;
  window.Hub = {
    mount, render, open, close, label, doing, words, steps, name, relay, chime, progress, toast,
    command, isHidden, isSecretary, pinNames, report, showAway, welcome,
    setPrivate(v) { PRIVATE = !!v; },
    get openKey() { return openKey; },
  };
})();
