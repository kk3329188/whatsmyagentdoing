// The sound of the office, made on the fly (no recordings): keyboards when
// people type, the coffee machine when someone is at it, a murmur when people
// chat, rain and thunder from the real weather, and a quiet room tone under
// it all. `update(scene)` says what is going on; it follows smoothly.
(() => {
  class Ambient {
    constructor() {
      this.ctx = null;
      this.on = false;
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
      const clicks = Math.min(6, s.typing) * 0.35;
      for (let i = 0; i < 3; i++) if (Math.random() < clicks / 3) this.key(now + Math.random() * 0.09);
      if (s.flash && !this.flashed) this.thunder(now + 0.4 + Math.random() * 1.2);
      this.flashed = s.flash;
    }

    // One key press: a short, bright tick.
    key(at) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 1800; f.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.18 + Math.random() * 0.12, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(at, Math.random() * 1.5, 0.05);
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
    return { typing, coffee, chat, weather, flash: weather === 'storm' && (t % 7.3) < 0.12 };
  }

  window.OfficeAmbient = { Ambient, sceneOf };
})();
