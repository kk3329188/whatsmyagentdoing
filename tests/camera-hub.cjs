// 3D camera helpers (web/camera.mjs): wheel intent, keeping the pivot over the room, arrow keys, glide.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'web', 'camera.mjs')).href);

test('a sideways swipe slides, a pinch or a plain wheel zooms', async () => {
  const { wheelIntent } = await load();
  assert.equal(wheelIntent({ deltaX: 30, deltaY: 4 }), 'pan');
  assert.equal(wheelIntent({ deltaX: -12, deltaY: 0 }), 'pan');
  assert.equal(wheelIntent({ deltaX: 0, deltaY: 100 }), 'zoom');
  assert.equal(wheelIntent({ deltaX: 2, deltaY: 40 }), 'zoom');
  assert.equal(wheelIntent({ deltaX: 50, deltaY: 1, ctrlKey: true }), 'zoom');
});

test('the pivot is pulled back over the room, never further', async () => {
  const { clampShift } = await load();
  assert.deepEqual(clampShift({ x: 5, y: 0.6, z: 4 }, 20, 12), { x: 0, y: 0, z: 0 });
  const s = clampShift({ x: 30, y: 9, z: -6 }, 20, 12);
  assert.equal(s.x, 21 - 30);
  assert.equal(s.y, 4 - 9);
  assert.equal(s.z, -1 - -6);
});

test('arrow keys slide the view, other keys do nothing', async () => {
  const { keyPan, PAN_STEP } = await load();
  assert.deepEqual(keyPan('ArrowRight'), [PAN_STEP, 0]);
  assert.deepEqual(keyPan('ArrowLeft'), [-PAN_STEP, 0]);
  assert.deepEqual(keyPan('ArrowUp'), [0, -PAN_STEP]);
  assert.equal(keyPan('a'), null);
});

test('a glide eases from 0 to 1 and stays there', async () => {
  const { glide } = await load();
  assert.equal(glide(1000, 1000), 0);
  assert.ok(glide(1000, 1100) > 0.4);
  assert.equal(glide(1000, 1450), 1);
  assert.equal(glide(1000, 9999), 1);
});

test('the glide back from a spotlight eases in and out', async () => {
  const { glide } = await load();
  assert.ok(glide(0, 100, 1000, true) < 0.01, 'starts slowly');
  assert.equal(glide(0, 500, 1000, true), 0.5);
  assert.ok(glide(0, 900, 1000, true) > 0.98, 'settles gently');
  assert.equal(glide(0, 1000, 1000, true), 1);
});
