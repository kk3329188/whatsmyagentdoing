// The sound of the office, made on the fly (no recordings): keyboards when
// people type, the coffee machine when someone is at it, a murmur when people
// chat, rain and thunder from the real weather, and a quiet room tone under
// it all. `update(scene)` says what is going on; it follows smoothly.
(() => {
  // The music: 72 beats a minute, four beats a bar, four seventh chords
  // (MIDI notes): Fmaj7, Em7, Dm7, Cmaj7.
  const BEAT = 60 / 72, BAR = BEAT * 4, MUSIC_LEVEL = 0.22;
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
      to(this.coffee, s.coffee ? 0.12 : 0);
      const wet = s.weather === 'storm' ? 0.22 : s.weather === 'rain' ? 0.14 : 0;
      to(this.rain, wet);
      // A murmur that rises and falls like voices.
      to(this.murmur, s.chat ? Math.min(0.09, 0.03 + s.chat * 0.02) * (0.6 + 0.4 * Math.sin(now * 5.3) * Math.sin(now * 2.1)) : 0);
      this.typeTick(now);
      this.musicTick(now);
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
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(at, Math.random() * 1.5, 0.06);
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'triangle';
      const f0 = space ? 120 : 190 + Math.random() * 90;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, at + 0.04);
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(space ? 0.3 : 0.2, at + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0001, at + (space ? 0.07 : 0.045));
      o.connect(og); og.connect(this.master);
      o.start(at); o.stop(at + 0.08);
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
    let typing = 0, coffee = 0, chat = 0;
    for (const p of office.bodies ? office.bodies() : []) {
      if (p.path && p.path.length) continue;
      const act = office.stateOf(p).act;
      if (act === 'type' || act === 'typefast' || act === 'laptop') typing++;
      if (act === 'coffee' || act === 'refill') coffee++;
      if (act === 'chat' || act === 'laugh') chat++;
    }
    const weather = office.weatherKind ? office.weatherKind() : null;
    const t = (office.t || 0) / 1000;
    const slot = office.slotEvents ? office.slotEvents() : null;
    return { typing, coffee, chat, weather, flash: weather === 'storm' && (t % 7.3) < 0.12, slot };
  }

  window.OfficeAmbient = { Ambient, sceneOf };
})();
