// The casino decor's pieces, built in Node with three.js (no GPU: canvases
// are stand-ins): what they are made of and how they light up.
const assert = require('node:assert/strict');
const test = require('node:test');

function fakeCanvas() {
  const cv = { width: 0, height: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({ canvas: cv }, {
    get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => grad : k === 'measureText' ? () => ({ width: 0 }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  cv.getContext = () => ctx;
  return cv;
}
globalThis.document = { createElement: () => fakeCanvas() };

const load = () => import('../web/decor.js').then((m) => m.decorOf('vegas'));
const jackpot = () => import('../web/decor.js').then((m) => m.jackpotAmount);
const casino = () => ({ casinoWheels: [], casinoLamps: [], casinoSpin: [], casinoDice: [], casinoSlots: [], casinoPools: [], plan: { floor: 2, W: 16, D: 16 }, room: { add() {} } });
const meshes = (g) => { let n = 0; g.traverse((m) => { if (m.isMesh) n++; }); return n; };

test('a bank of slot machines: each has its own lit topper, and the static parts are merged into a handful of draws', async () => {
  const V = await load(), o = casino();
  const bank = V.build({ t: 'slotBank', x: 2, y: 3, n: 4, step: 0.7 }, o);
  assert.ok(meshes(bank) <= 22, `merged: ${meshes(bank)} meshes for 4 machines`);
  assert.ok(o.casinoSlots.length >= 9, 'the toppers and belly glass of 4 different machines, and the jackpot board, light up');
  const one = V.build({ t: 'arcade', x: 1, y: 1 }, casino());
  assert.ok(meshes(one) <= 14, `a single machine is baked too: ${meshes(one)}`);
});

test('the progressive jackpot creeps up, and the casino goes dim after hours', async () => {
  const V = await load(), o = casino(), amount = await jackpot();
  const now = Date.now();
  assert.ok(amount(now + 60_000) > amount(now) && amount(now) > 1_000_000);
  V.build({ t: 'slotBank', x: 2, y: 3, n: 3, step: 0.7 }, o);
  V.build({ t: 'roulette', x: 5, y: 5, w: 1.6, d: 0.8 }, o);
  assert.equal(o.casinoPools.length, 1, 'a pool of light on the roulette table');
  const fx = { bulbs: { setColorAt() {}, instanceColor: {} }, n: 0, signs: [], step: -1, col: new (require('three').Color)() };
  V.animate(fx, 10, false, o);
  for (const m of o.casinoSlots) assert.ok(m.color.r >= 0.8, 'lit in opening hours');
  assert.ok(o.casinoPools[0].material.opacity > 0.3);
  V.animate(fx, 11, true, o);
  for (const m of o.casinoSlots) assert.ok(m.color.r < 0.3, 'dim after hours');
  assert.ok(o.casinoPools[0].material.opacity < 0.1);
});

test('downstairs the roulette bets lie on the felt as stacks of chips (yours gold), and the big six stops with the slot that came up under its pointer', async () => {
  const V = await load(), o = casino();
  o.plan.floor = 1;
  const THREE = require('three');
  V.build({ t: 'roulette', x: 5, y: 5, w: 1.6, d: 0.8 }, o);
  V.build({ t: 'bigSix', x: 2, y: 2 }, o);
  const fx = { bulbs: { setColorAt() {}, instanceColor: {} }, n: 0, signs: [], step: -1, col: new THREE.Color() };
  o.roulette = { stage: 'bets', at: Date.now(), number: null, bets: [{ key: 'me', on: 'red', amount: 20 }, { key: 'claude:x', on: 17, amount: 50 }, { key: 'claude:y', on: 'red', amount: 10 }], pay: {} };
  V.animate(fx, 1, false, o);
  const w = o.casinoWheels[0], shown = w.chips.filter((c) => c.visible);
  assert.equal(shown.length, 3);
  assert.equal(shown[0].material.color.getHex(), 0xffd23f, 'yours are gold');
  assert.notDeepEqual(shown[0].position.toArray(), shown[1].position.toArray(), 'red and 17 are different places');
  assert.ok(shown[1].scale.y > shown[0].scale.y, 'a bigger bet, a taller stack');
  o.roulette.stage = 'show'; o.roulette.number = 17; o.roulette.pay = { 'claude:x': 1750 };
  V.animate(fx, 2, false, o);
  assert.equal(w.chips.filter((c) => c.visible).length, 1, 'once it has come up, only the winning bet stays');
  const sw = o.casinoSpin[0];
  for (const seg of [0, 5, 11, 23]) {
    o.bigSix = { stage: 'show', at: Date.now(), seg, pay: {} };
    V.animate(fx, 3, false, o);
    // slot seg is drawn from angle seg/24 of a turn on the face (clockwise on the canvas);
    // turned by rotation.z, its middle is now straight up, under the pointer
    const up = -(((seg + 0.5) / 24) * Math.PI * 2) + sw.face.rotation.z;
    assert.ok(Math.abs(Math.sin(up) - 1) < 1e-9, `slot ${seg} under the pointer`);
  }
  o.bigSix = { stage: 'spin', at: Date.now() - 1000, seg: 4, pay: {}, spinMs: 6000 };
  V.animate(fx, 4, false, o);
  assert.ok(sw.face.rotation.z > Math.PI / 2 + (4.5 / 24) * Math.PI * 2 + 1, 'still turning: well short of where it stops');
});
