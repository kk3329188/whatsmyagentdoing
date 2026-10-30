// The sound of the office, made on the fly (no recordings): keyboards when
// people type, the coffee machine when someone is at it, a murmur when people
// chat, rain and thunder from the real weather, and a quiet room tone under
// it all. `update(scene)` says what is going on; it follows smoothly.
(() => {
  // The music: 72 beats a minute, four beats a bar, four seventh chords
  // (MIDI notes): Fmaj7, Em7, Dm7, Cmaj7.
  const BEAT = 60 / 72, BAR = BEAT * 4, MUSIC_LEVEL = 0.22;
  // How loud the keyboards are, heard from where the camera is.
  const KEY_LEVEL = 0.5;
  const PROG = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];

  class Ambient {
    constructor() {
      this.ctx = null;
      this.on = false;
      this.musicOn = true;
      this.scene = { typing: 0, coffee: 0, chat: 0, weather: null, flash: false };
    }

    start() {
      if (this.on) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = this.ctx || new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.gain.linearRampToValueAtTime(0.5, c.currentTime + 1.5);
      this.master.connect(c.destination);
      // Two seconds of noise, reused by every layer.
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const loop = (filters, gain) => {
        const src = c.createBufferSource();
        src.buffer = this.noise; src.loop = true;
        let node = src;
        for (const [type, freq, q] of filters) { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; node.connect(f); node = f; }
        const g = c.createGain(); g.gain.value = gain;
        node.connect(g); g.connect(this.master);
        src.start();
        return { src, g };
      };
      this.room = loop([['lowpass', 180]], 0.05);
      this.coffee = loop([['bandpass', 420, 2], ['lowpass', 900]], 0);
      this.rain = loop([['highpass', 400], ['lowpass', 2600]], 0);
      this.murmur = loop([['bandpass', 520, 1.4]], 0);
      this.makeKeyBus();
      // Background music: its own level, under everything else.
      this.music = c.createGain();
      this.music.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
      this.music.connect(this.master);
      this.musicAt = c.currentTime + 0.6;
      this.bar = 0;
      this.on = true;
      this.timer = setInterval(() => this.tick(), 90);
    }

    stop() {
      if (!this.on) return;
      this.on = false;
      clearInterval(this.timer);
      const c = this.ctx, m = this.master;
      m.gain.cancelScheduledValues(c.currentTime);
      m.gain.setValueAtTime(m.gain.value, c.currentTime);
      m.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
      setTimeout(() => { for (const l of [this.room, this.coffee, this.rain, this.murmur]) try { l.src.stop(); } catch {} m.disconnect(); }, 800);
    }

    // Everything that happens in the room (keyboards, voices, steps, the
    // machines) is across the room, not at your elbow: quieter, the bright
    // edge softened, and a little of the room in it.
    makeKeyBus() {
      const c = this.ctx;
      this.far = c.createGain();
      this.far.gain.value = KEY_LEVEL;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      this.far.connect(lp);
      lp.connect(this.master);
      // a short, soft room: noise dying away over 0.6 s
      const len = Math.floor(c.sampleRate * 0.6), ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      const room = c.createConvolver(); room.buffer = ir;
      const wet = c.createGain(); wet.gain.value = 0.35;
      lp.connect(room); room.connect(wet); wet.connect(this.master);
    }

    // Background music on or off (it fades).
    setMusic(v) {
      this.musicOn = !!v;
      if (!this.on || !this.music) return;
      const c = this.ctx;
      this.music.gain.cancelScheduledValues(c.currentTime);
      this.music.gain.setTargetAtTime(this.musicOn ? MUSIC_LEVEL : 0, c.currentTime, 0.4);
      if (this.musicOn) this.musicAt = Math.max(this.musicAt, c.currentTime + 0.2);
    }

    // Soft lo-fi, made up as it goes: a warm chord a bar, a bass note on the
    // beat, a few piano notes picked from the chord. Four chords round.
    musicTick(now) {
      if (!this.musicOn || !this.music) return;
      while (this.musicAt < now + 0.4) { this.playBar(this.musicAt, this.bar++); this.musicAt += BAR; }
    }

    playBar(at, n) {
      const c = this.ctx, chord = PROG[n % PROG.length];
      const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
      // the pad: the chord, slow in and out, through a soft filter
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(this.music);
      for (const m of chord) {
        for (const [type, det] of [['triangle', -6], ['sine', 5]]) {
          const o = c.createOscillator(), g = c.createGain();
          o.type = type; o.frequency.value = hz(m); o.detune.value = det;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(0.05, at + 0.9);
          g.gain.setValueAtTime(0.05, at + BAR - 0.6);
          g.gain.linearRampToValueAtTime(0.0001, at + BAR + 0.3);
          o.connect(g); g.connect(lp);
          o.start(at); o.stop(at + BAR + 0.4);
        }
      }
      // the bass, on beats one and three
      for (const b of [0, 2]) {
        const t = at + b * BEAT, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = hz(chord[0] - 12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 1.6);
        o.connect(g); g.connect(this.music);
        o.start(t); o.stop(t + BEAT * 1.7);
      }
      // a few piano notes on the off-beats, from the chord, an octave up
      for (let i = 0; i < 8; i++) {
        if (Math.random() > (i % 2 ? 0.45 : 0.25)) continue;
        const t = at + i * BEAT / 2 + (Math.random() - 0.5) * 0.02;
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = hz(chord[Math.floor(Math.random() * chord.length)] + 12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g); g.connect(this.music);
        o.start(t); o.stop(t + 1);
      }
    }

    update(scene) { this.scene = { ...this.scene, ...scene }; }

    // Every 90 ms: layer levels follow the scene; keyboards click at random.
    tick() {
      const c = this.ctx, s = this.scene, now = c.currentTime;
      const to = (layer, v) => layer.g.gain.setTargetAtTime(v, now, 0.6);
      to(this.coffee, s.coffee || (s.machines || []).some((m) => m.kind === 'coffee' && m.phase === 'brew') ? 0.12 : 0);
      const wet = s.weather === 'storm' ? 0.22 : s.weather === 'rain' ? 0.14 : 0;
      to(this.rain, wet);
      // A murmur that rises and falls like voices.
      to(this.murmur, s.chat ? Math.min(0.03, 0.01 + s.chat * 0.006) : 0);
      this.typeTick(now);
      this.musicTick(now);
      this.talkTick(now);
      this.stepTick(now);
      this.pingTick(now, s.pingpong);
      this.machineSounds(s.machines, now);
      if (s.flash && !this.flashed) this.thunder(now + 0.4 + Math.random() * 1.2);
      this.flashed = s.flash;
      this.slotSounds(s.slot, now);
    }

    // The slot machine, from the spin now playing (office.slotEvents): the
    // symbols land, wins pop, orbs ring as they add up, a jingle for the win,
    // a fanfare for free spins. Each sound is scheduled once, on time.
    slotSounds(ev, now) {
      if (!ev || !ev.list) return;
      if (ev.id !== this.spinHeard) { this.spinHeard = ev.id; this.slotDone = new Set(); }
      ev.list.forEach((e, i) => {
        if (this.slotDone.has(i)) return;
        const at = (e.at - ev.t) / 1000;
        if (at < -0.05 || at > 0.4) return; // not yet (or long gone)
        this.slotDone.add(i);
        const t = now + Math.max(0, at);
        if (e.k === 'drop') this.whirr(t, 0.35);
        else if (e.k === 'burst') for (let k = 0; k < 3 + e.n; k++) this.clack(t + k * 0.045, k + 4);
        else if (e.k === 'mult') this.jingle(t, 3);
        else if (e.k === 'win') this.jingle(t, e.n || 3);
        else if (e.k === 'bonus') { this.jingle(t, 5); this.jingle(t + 0.9, 5); }
      });
    }

    whirr(at, len) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 4;
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.07, at + 0.08);
      g.gain.setValueAtTime(0.07, at + Math.max(0.1, len - 0.15));
      g.gain.linearRampToValueAtTime(0, at + len);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(at); src.stop(at + len + 0.05);
    }

    clack(at, i) {
      const c = this.ctx;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(320 + i * 40, at); o.frequency.exponentialRampToValueAtTime(120, at + 0.06);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(g); g.connect(this.master);
      o.start(at); o.stop(at + 0.1);
    }

    jingle(at, n) {
      const c = this.ctx;
      const notes = [523, 659, 784, 1047, 1319].slice(0, Math.max(3, n));
      notes.concat(notes.slice().reverse().slice(1)).forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), t = at + i * 0.09;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + 0.22);
      });
    }

    // Everyone typing (up to six) types like a person: a burst of keys, a
    // pause between words, the space bar now and then. Keys are scheduled a
    // little ahead of the 90 ms tick so the rhythm holds.
    typeTick(now) {
      const n = Math.min(6, this.scene.typing || 0);
      const ts = this.typists || (this.typists = []);
      while (ts.length < n) ts.push({ next: now + Math.random() * 0.6, left: 0, k: 0 });
      ts.length = n;
      for (const t of ts) {
        if (t.next < now) t.next = now + Math.random() * 0.05;
        while (t.next < now + 0.1) {
          t.k++;
          this.key(t.next, t.k % 7 === 0);
          if (--t.left <= 0) { t.left = 3 + Math.floor(Math.random() * 7); t.next += 0.35 + Math.random() * 0.9; }
          else t.next += 0.07 + Math.random() * 0.09;
        }
      }
    }

    // One key press: a bright click and the key bottoming out (a low thock);
    // the space bar is deeper and longer.
    key(at, space = false) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = space ? 900 : 1800 + Math.random() * 1200;
      const g = c.createGain();
      const v = (space ? 0.35 : 0.45) * (0.75 + Math.random() * 0.5);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, at + (space ? 0.045 : 0.02));
      src.connect(hp); hp.connect(g); g.connect(this.far || this.master);
      src.start(at, Math.random() * 1.5, 0.06);
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'triangle';
      const f0 = space ? 120 : 190 + Math.random() * 90;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, at + 0.04);
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(space ? 0.3 : 0.2, at + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0001, at + (space ? 0.07 : 0.045));
      o.connect(og); og.connect(this.far || this.master);
      o.start(at); o.stop(at + 0.08);
    }

    // ---- voices: people talking, heard from across the room --------------
    // Not words, just the sound of them: syllables on a voice (a pitch and
    // two vowel resonances that move), strung into words, two people taking
    // turns with pauses; a laugh now and then.
    talkTick(now) {
      const pairs = Math.min(3, Math.ceil((this.scene.chat || 0) / 2));
      const ts = this.talks || (this.talks = []);
      while (ts.length < pairs) ts.push({ next: now + 0.3 + Math.random(), who: 0, words: 0, base: [100 + Math.random() * 40, 190 + Math.random() * 50] });
      ts.length = pairs;
      for (const t of ts) {
        if (t.next < now) t.next = now + 0.05;
        while (t.next < now + 0.15) {
          if (t.words <= 0) { // a turn: the other one speaks
            t.who = 1 - t.who; t.words = 1 + Math.floor(Math.random() * 4);
            if (Math.random() < 0.12) { this.laugh(t.next, t.base[t.who]); t.next += 1.0; continue; }
          }
          const n = 2 + Math.floor(Math.random() * 3);
          let at = t.next;
          for (let i = 0; i < n; i++) { const len = 0.09 + Math.random() * 0.12; this.syllable(at, t.base[t.who] * (0.9 + Math.random() * 0.25), len); at += len + 0.02; }
          t.words--;
          t.next = at + (t.words > 0 ? 0.12 + Math.random() * 0.2 : 0.5 + Math.random() * 1.1);
        }
      }
    }

    syllable(at, f0, len) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, at);
      o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.3), at + len);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.45, at + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      // two vowel resonances, moving a little through the syllable
      const f1 = 350 + Math.random() * 450, f2 = 900 + Math.random() * 1300;
      for (const [f, q, v] of [[f1, 5, 1], [f2, 8, 0.6]]) {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
        bp.frequency.setValueAtTime(f, at); bp.frequency.linearRampToValueAtTime(f * (0.8 + Math.random() * 0.4), at + len);
        const fg = c.createGain(); fg.gain.value = v;
        o.connect(bp); bp.connect(fg); fg.connect(g);
      }
      g.connect(this.far || this.master);
      o.start(at); o.stop(at + len + 0.02);
    }

    laugh(at, f0) {
      for (let i = 0; i < 4; i++) this.syllable(at + i * 0.17, f0 * (1.35 - i * 0.06), 0.11);
    }

    // ---- footsteps: someone walking, soft on the floor --------------------
    stepTick(now) {
      const n = Math.min(4, this.scene.walking || 0);
      const ws = this.walkers || (this.walkers = []);
      while (ws.length < n) ws.push({ next: now + Math.random() * 0.5 });
      ws.length = n;
      for (const w of ws) {
        if (w.next < now) w.next = now + Math.random() * 0.1;
        while (w.next < now + 0.15) { this.step(w.next); w.next += 0.42 + Math.random() * 0.08; }
      }
    }

    step(at) {
      const c = this.ctx, src = c.createBufferSource();
      src.buffer = this.noise;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + Math.random() * 300;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
      src.connect(lp); lp.connect(g); g.connect(this.far || this.master);
      src.start(at, Math.random() * 1.5, 0.09);
    }

    // ---- ping-pong: the ball off a bat every 0.9 s, off the table between -
    // (in time with the ball drawn: office.js pingPongBall)
    pingTick(now, pp) {
      if (!pp || !pp.on) { this.pingNext = null; return; }
      // page time -> audio time
      const toAudio = (ms) => now + (ms - pp.t) / 1000;
      let k = this.pingNext && this.pingNext > pp.t ? this.pingNext : Math.ceil(pp.t / 450) * 450;
      while (toAudio(k) < now + 0.2) {
        this.pok(toAudio(k), Math.round(k / 450) % 2 === 0);
        k += 450;
      }
      this.pingNext = k;
    }

    pok(at, bat) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(bat ? 1500 : 1100, at); o.frequency.exponentialRampToValueAtTime(bat ? 900 : 700, at + 0.03);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(bat ? 0.22 : 0.14, at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      o.connect(g); g.connect(this.far || this.master);
      o.start(at); o.stop(at + 0.08);
    }

    // ---- the machines people use (office.js applianceAt) -------------------
    // A sound when a phase starts: doors, the microwave humming then its
    // ding, a can dropping, the printer going; each played once.
    machineSounds(list, now) {
      if (!list) return;
      const heard = this.machineHeard || (this.machineHeard = new Map());
      for (const m of list) {
        const key = `${m.id}:${m.phase}`;
        if (heard.has(key)) continue;
        heard.set(key, now);
        const left = m.left == null ? 1 : m.left;
        if (m.kind === 'microwave') {
          if (m.phase === 'open' || m.phase === 'ding') this.thunk(now, 900, 0.12);
          if (m.phase === 'close' || m.phase === 'shut') this.thunk(now, 600, 0.16);
          if (m.phase === 'cook') this.hum(now, left, 120);
          if (m.phase === 'ding') this.bell(now);
        } else if (m.kind === 'fridge') {
          if (m.phase === 'open') this.thunk(now, 300, 0.18);
          if (m.phase === 'reach') this.hum(now, Math.min(2, left), 60);
          if (m.phase === 'close') this.thunk(now, 220, 0.25);
        } else if (m.kind === 'vending') {
          if (m.phase === 'press') this.thunk(now, 1400, 0.08);
          if (m.phase === 'drop') { this.thunk(now + 0.25, 260, 0.3); this.thunk(now + 0.45, 320, 0.18); }
        } else if (m.kind === 'printer' && m.phase === 'print') {
          for (let i = 0; i < 3; i++) this.hum(now + i * 1.3, 0.9, 230);
        }
      }
      // forget old ones
      if (heard.size > 200) for (const [k, t] of heard) if (now - t > 60) heard.delete(k);
    }

    thunk(at, freq, vol) {
      const c = this.ctx, src = c.createBufferSource();
      src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      src.connect(bp); bp.connect(g); g.connect(this.far || this.master);
      src.start(at, Math.random() * 1.5, 0.15);
    }

    hum(at, len, freq) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = freq;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = freq * 3;
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.035, at + 0.1);
      g.gain.setValueAtTime(0.035, at + Math.max(0.15, len - 0.15)); g.gain.linearRampToValueAtTime(0.0001, at + len);
      o.connect(lp); lp.connect(g); g.connect(this.far || this.master);
      o.start(at); o.stop(at + len + 0.05);
    }

    bell(at) {
      const c = this.ctx;
      for (const [f, v] of [[1760, 0.12], [3520, 0.04]]) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.2);
        o.connect(g); g.connect(this.far || this.master);
        o.start(at); o.stop(at + 1.3);
      }
    }

    // A roll of thunder, a moment after the flash.
    thunder(at) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.7, at + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, at + 3.2);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(at); src.stop(at + 3.3);
    }
  }

  // What the floor you are looking at sounds like right now.
  function sceneOf(office) {
    if (!office) return {};
    let typing = 0, coffee = 0, chat = 0, walking = 0;
    for (const p of office.bodies ? office.bodies() : []) {
      if (p.path && p.path.length) { walking++; continue; }
      const act = office.stateOf(p).act;
      if (act === 'type' || act === 'typefast' || act === 'laptop') typing++;
      if (act === 'coffee' || act === 'refill') coffee++;
      if (act === 'chat' || act === 'laugh') chat++;
    }
    const weather = office.weatherKind ? office.weatherKind() : null;
    const t = (office.t || 0) / 1000;
    const slot = office.slotEvents ? office.slotEvents() : null;
    // ping-pong: two at the table, playing
    const pois = (office.plan && office.plan.pois) || [];
    const at = pois.filter((q) => q.pair === 'pp' && q.taken).map((q) => office.people && office.people.get(q.taken)).filter((p) => p && p.poi && p.poi.pair === 'pp' && !(p.path && p.path.length));
    const pingpong = { on: at.length >= 2, t: office.t || 0 };
    // the machines in use, and the phase each is in
    const machines = [];
    if (office.applianceAt) {
      for (const q of pois) {
        const m = office.applianceAt(q);
        if (!m) continue;
        const user = [...office.people.values()].find((p) => p.useOf === q);
        machines.push({ kind: q.act, phase: m.phase, id: `${q.act}@${Math.round(q.x * 10)},${Math.round(q.y * 10)}@${user ? user.useAt : 0}`, left: phaseLeft(q.act, m) });
      }
    }
    return { typing, coffee, chat, walking, weather, flash: weather === 'storm' && (t % 7.3) < 0.12, slot, pingpong, machines };
  }

  // How long (s) is left of a machine's phase.
  const PHASE_LEN = { microwave: { cook: 5, reach: 2 }, fridge: { reach: 2 }, printer: { print: 3 } };
  function phaseLeft(kind, m) {
    const len = PHASE_LEN[kind] && PHASE_LEN[kind][m.phase];
    if (!len) return null;
    return Math.max(0.2, len * (1 - (m.k || 0)));
  }

  window.OfficeAmbient = { Ambient, sceneOf };
})();
