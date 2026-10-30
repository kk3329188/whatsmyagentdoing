// public/ambient.js: the office soundscape's keyboards.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ambient.js'), 'utf8'), { window, Math, setInterval, clearInterval, setTimeout });
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
