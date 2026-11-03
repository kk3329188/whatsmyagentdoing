// public/ambient.js: the office soundscape's keyboards.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The same "random" every run (the sounds are made up as they go).
function seeded(seed = 7) {
  let a = seed >>> 0;
  const random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Object.assign(Object.create(Math), { random });
}
function load(seed) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ambient.js'), 'utf8'), { window, Math: seeded(seed), setInterval, clearInterval, setTimeout });
  return window.OfficeAmbient;
}

test('people typing sound like people typing: bursts of keys, pauses between words, a space bar now and then', () => {
  const { Ambient } = load();
  const a = new Ambient();
  const keys = [];
  a.key = (at, space) => keys.push({ at, space });
  a.scene = { typing: 2 };
  for (let t = 0; t < 4; t += 0.09) a.typeTick(t);
  assert.ok(keys.length >= 25 && keys.length <= 90, `${keys.length} keys in 4 s from two people`);
  assert.ok(keys.some((k) => k.space), 'a space bar');
  // Nobody typing: silence.
  a.scene = { typing: 0 };
  const before = keys.length;
  for (let t = 4; t < 6; t += 0.09) a.typeTick(t);
  assert.equal(keys.length, before);
});

test('one person typing pauses between bursts (not an even drizzle)', () => {
  const { Ambient } = load();
  const a = new Ambient();
  const at = [];
  a.key = (t) => at.push(t);
  a.scene = { typing: 1 };
  for (let t = 0; t < 6; t += 0.09) a.typeTick(t);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  assert.ok(gaps.some((g) => g < 0.17), 'quick keys inside a word');
  assert.ok(gaps.some((g) => g > 0.33), 'a pause between words');
});

test('background music: a bar at a time, scheduled ahead; off means no new notes', () => {
  const { Ambient } = load();
  const a = new Ambient();
  const bars = [];
  a.playBar = (at, n) => bars.push({ at, n });
  a.music = {};
  a.musicAt = 0.5; a.bar = 0;
  for (let t = 0; t < 10; t += 0.09) a.musicTick(t);
  assert.ok(bars.length >= 3 && bars.length <= 5, `${bars.length} bars in 10 s at 72 bpm`);
  assert.deepEqual(bars.map((b) => b.n), bars.map((_, i) => i), 'one chord after another');
  const gaps = bars.slice(1).map((b, i) => +(b.at - bars[i].at).toFixed(3));
  assert.ok(gaps.every((g) => g === gaps[0]), 'steady');
  a.musicOn = false;
  const n = bars.length;
  for (let t = 10; t < 20; t += 0.09) a.musicTick(t);
  assert.equal(bars.length, n);
});

test('people talking sound like a conversation: cartoon-animal words, two voices taking turns', () => {
  const { Ambient } = load();
  const a = new Ambient();
  const said = [];
  a.word = (at, f0, n) => { said.push({ at, f0, n }); return at + n * 0.1; };
  a.laugh = () => {};
  a.scene = { chat: 2 };
  for (let t = 0; t < 12; t += 0.09) a.talkTick(t);
  assert.ok(said.length > 8, `${said.length} words in 12 s`);
  assert.ok(said.every((w) => w.n >= 2 && w.n <= 4), 'two to four syllables a word');
  const voices = new Set(said.map((x) => (x.f0 < 160 ? 'low' : 'high')));
  assert.equal(voices.size, 2, 'two voices');
  const gaps = said.slice(1).map((x, i) => x.at - (said[i].at + said[i].n * 0.1));
  assert.ok(gaps.some((g) => g > 0.45), 'pauses between turns');
  a.scene = { chat: 0 };
  const n = said.length;
  for (let t = 12; t < 20; t += 0.09) a.talkTick(t);
  assert.equal(said.length, n, 'nobody talking: silence');
});

test('a cartoon-animal word: short high syllables, each bending up and back, from where the speaker is', () => {
  const window = {};
  const made = [];
  const param = (name) => ({ value: 0, ramps: [], setValueAtTime(v, t) { this.ramps.push(['set', v, t]); }, exponentialRampToValueAtTime(v, t) { this.ramps.push(['exp', v, t]); }, linearRampToValueAtTime(v, t) { this.ramps.push(['lin', v, t]); }, setTargetAtTime(v) { this.value = v; } });
  const node = (kind) => { const n = { kind, connect(to) { n.to = to; }, disconnect() {}, frequency: param(), gain: param(), Q: param(), start() {}, stop() {} }; made.push(n); return n; };
  const ctx = { currentTime: 0, createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'),
    createPanner: () => Object.assign(node('panner'), { positionX: param(), positionY: param(), positionZ: param() }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ambient.js'), 'utf8'), { window, Math: seeded(3), setInterval, clearInterval, setTimeout });
  const a = new window.OfficeAmbient.Ambient();
  a.ctx = ctx; a.far = node('far'); a.master = node('master');
  let end;
  a.from('voice0.0', { pan: -0.8, near: 0.6 }, () => { end = a.word(1, 120, 3); });
  const oscs = made.filter((n) => n.kind === 'osc');
  assert.equal(oscs.length, 3, 'one note a syllable');
  for (const o of oscs) {
    const f = o.frequency.ramps.map((r) => r[1]);
    assert.ok(f[1] > 240, `high and cute (up to ${Math.round(f[1])} Hz from a 120 Hz voice)`);
    assert.ok(f[1] > f[0] && f[2] < f[1], 'bends up and back');
  }
  assert.ok(end - 1 < 0.45, `quick (${(end - 1).toFixed(2)} s for three syllables)`);
  const pn = made.find((n) => n.kind === 'panner');
  assert.ok(pn && pn.positionX.value < 0, 'from the left, where the speaker stands');
  const outs = made.filter((n) => n.kind === 'gain' && n.to === pn);
  assert.equal(outs.length, 3, 'every syllable goes out through that spot');
});

test('footsteps while people walk; ping-pong in time with the ball; machines sound once per phase', () => {
  const { Ambient } = load();
  const a = new Ambient();
  const steps = [], poks = [], sounds = [];
  a.step = (at) => steps.push(at);
  a.pok = (at, bat) => poks.push({ at, bat });
  a.thunk = (at, f) => sounds.push(['thunk', f]);
  a.hum = (at, len) => sounds.push(['hum', len]);
  a.bell = () => sounds.push(['bell']);
  a.scene = { walking: 2 };
  for (let t = 0; t < 3; t += 0.09) a.stepTick(t);
  assert.ok(steps.length >= 10 && steps.length <= 18, `${steps.length} steps from two walkers in 3 s`);
  // ping-pong: page time 10 000 ms is audio time 5 s; hits every 450 ms
  for (let t = 5; t < 7; t += 0.09) a.pingTick(t, { on: true, t: 10000 + (t - 5) * 1000 });
  const at = poks.map((p) => +(p.at - 5).toFixed(2));
  assert.ok(at.length >= 4);
  assert.ok(at.every((x, i) => i === 0 || Math.abs(x - at[i - 1] - 0.45) < 0.01), 'every 0.45 s');
  assert.ok(poks.some((p) => p.bat) && poks.some((p) => !p.bat), 'bat and table');
  const m = { kind: 'microwave', id: 'mw@1', phase: 'cook', left: 4 };
  a.machineSounds([m], 1); a.machineSounds([m], 1.1);
  a.machineSounds([{ ...m, phase: 'ding' }], 6);
  assert.deepEqual(sounds.map((x) => x[0]), ['hum', 'thunk', 'bell'], 'hum once, then the door and the ding');
});

test('the recorded voice is cut where it pauses: each stretch of sound a slice, too-short blips left out', () => {
  const { sliceVoice } = load();
  const rate = 1000, d = new Float32Array(rate); // one second
  const burst = (a, b, v) => { for (let i = a * rate; i < b * rate; i++) d[i] = Math.sin(i) * v; };
  burst(0.1, 0.3, 0.02); burst(0.4, 0.5, 0.015); burst(0.7, 0.72, 0.02); // the last one only 20 ms
  const { slices, gain } = sliceVoice(d, rate);
  assert.equal(slices.length, 2);
  assert.ok(Math.abs(slices[0].start - 0.1) < 0.011 && Math.abs(slices[0].len - 0.2) < 0.021, JSON.stringify(slices[0]));
  assert.ok(Math.abs(slices[1].start - 0.4) < 0.011, JSON.stringify(slices[1]));
  assert.ok(gain > 40, 'a quiet recording is brought up');
  // the file itself ships with its credit (public domain)
  const dir = path.join(__dirname, '../assets/sounds');
  assert.ok(fs.statSync(path.join(dir, 'phone-voice.mp3')).size > 10_000);
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /Creative Commons 0/);
});

test('people talk in the recorded cartoon voice once it is loaded: slices one after another, a pitch per speaker, from where they stand', () => {
  const window = {};
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; } });
  const node = (kind) => { const n = { kind, connect(to) { n.to = to; }, disconnect() {}, gain: param(), playbackRate: param(), start(...a) { n.started = a; }, stop() {} }; made.push(n); return n; };
  const ctx = { currentTime: 0, createBufferSource: () => node('src'), createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => Object.assign(node('filter'), { frequency: param(), Q: param() }),
    createPanner: () => Object.assign(node('panner'), { positionX: param(), positionY: param(), positionZ: param() }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ambient.js'), 'utf8'), { window, Math: seeded(5), setInterval, clearInterval, setTimeout });
  const a = new window.OfficeAmbient.Ambient();
  a.ctx = ctx; a.far = node('far'); a.master = node('master');
  a.voice = { buf: { id: 'voice' }, slices: [{ start: 0.08, len: 0.17 }, { start: 0.5, len: 0.34 }, { start: 1.1, len: 0.12 }], gain: 40 };
  let end;
  a.from('voice0.1', { pan: 0.6, near: 0.5 }, () => { end = a.word(2, 220, 3); });
  const srcs = made.filter((n) => n.kind === 'src');
  assert.ok(srcs.length >= 4 && srcs.length <= 6, `${srcs.length} slices in a sentence`);
  assert.ok(!made.some((n) => n.kind === 'osc'), 'no synthesized chirps');
  let t = 2;
  for (const s of srcs) {
    assert.equal(s.buffer.id, 'voice');
    assert.ok(s.started[0] >= t - 1e-9, 'one after another');
    const rate = s.playbackRate.value;
    assert.ok(rate > 1.1 && rate < 1.25, `the higher voice, about 1.18x (${rate.toFixed(2)})`);
    t = s.started[0] + s.started[2] / rate;
  }
  assert.ok(end >= t && end - 2 < 2, `ends after the last slice (${(end - 2).toFixed(2)} s)`);
  const pn = made.find((n) => n.kind === 'panner');
  assert.ok(pn && pn.positionX.value > 0, 'from the right, where that speaker stands');
  assert.ok(made.filter((n) => n.kind === 'gain' && n.to === pn).length === srcs.length, 'every slice through that spot');
});
