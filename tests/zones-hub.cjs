// Hub edition: where a person ends up in the office says their state.
// Runs office.js in a VM with just enough of a browser to build the floor
// plan and place people; nothing is drawn.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(roam = false) {
  const window = {};
  const ctx = { window, Math, Date, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/office.js'), 'utf8'), ctx);
  const Office = window.Office;
  const o = Object.create(Office.prototype);
  o.pal = new Proxy({}, { get: () => '#808080' });
  o.people = new Map();
  o.deskOf = new Map();
  o.first = true;
  o.plan = o.buildPlan(0);
  o.cat = { x: o.plan.W - 3, y: o.plan.D - 2, path: [], until: 0, face: 1 };
  o.roam = roam;
  return o;
}

const MIN = 60_000;
const at = (status, extra = {}) => ({ key: `claude:${status}${extra.n ?? ''}`, agent: 'claude', status, lastEventAt: Date.now() - (extra.ago || 0), ...extra });

function settle(o, sessions) {
  o.update(sessions);
  for (const p of o.people.values()) if (p.mode === 'wander') o.wander(p, Date.now());
  return (key) => o.people.get(key);
}

test('working sessions sit at a desk; nobody else does', () => {
  const o = load();
  const who = settle(o, [at('thinking'), at('tool'), at('typing'), at('waiting'), at('error'), at('done')]);
  for (const k of ['claude:thinking', 'claude:tool', 'claude:typing']) assert.equal(who(k).mode, 'work', k);
  for (const k of ['claude:waiting', 'claude:error', 'claude:done']) assert.notEqual(who(k).mode, 'work', k);
});

test('each state goes to its own room', () => {
  const o = load();
  const who = settle(o, [
    at('waiting'),
    at('done', { n: 'ask', ask: '要推嗎？' }),
    at('error'),
    at('done', { n: 'fresh', ago: 5 * MIN }),
    at('interrupted', { ago: 5 * MIN }),
    at('done', { n: 'old', ago: 3 * 60 * MIN }),
    at('idle', { ago: 60 * MIN }),
  ]);
  const zone = (k) => who(k).poi && who(k).poi.zone;
  assert.equal(zone('claude:waiting'), 'wait');
  assert.equal(zone('claude:doneask'), 'wait', 'a finished turn that left you a decision waits in the meeting room');
  assert.equal(zone('claude:error'), 'error');
  assert.equal(zone('claude:donefresh'), 'done');
  assert.equal(zone('claude:interrupted'), 'done');
  assert.equal(zone('claude:doneold'), 'idle');
  assert.equal(zone('claude:idle'), 'idle');
});

test('a finished session that starts working again leaves the pantry for a desk', () => {
  const o = load();
  let who = settle(o, [at('done', { n: 'x' })]);
  assert.equal(who('claude:donex').poi.zone, 'done');
  who = settle(o, [{ ...at('tool'), key: 'claude:donex' }]);
  assert.equal(who('claude:donex').mode, 'work');
  assert.equal(who('claude:donex').poi, null);
});

test('rooms that are full send the rest home, but waiting and errors always show', () => {
  const o = load();
  const idleSeats = o.plan.zones.idle.length;
  const many = (status, n, extra = {}) => Array.from({ length: n }, (_, i) => at(status, { n: i, ...extra }));
  const who = settle(o, [...many('idle', idleSeats + 5, { ago: 90 * MIN }), ...many('waiting', 9)]);
  assert.equal(o.offDuty, 5);
  for (let i = 0; i < 9; i++) assert.ok(who(`claude:waiting${i}`), `waiting ${i} shown`);
});

test('desk pose follows the kind of work; changing zone pops a message', () => {
  const o = load();
  o.t = 0;
  const pose = (activity, extra = {}) => {
    const s = { ...at('tool'), activity, ...extra };
    const who = settle(o, [s]);
    return o.stateOf(who('claude:tool')).act;
  };
  assert.equal(pose('Edit index.js'), 'typefast');
  assert.equal(pose('Read a.js'), 'deskread');
  assert.equal(pose('Bash: 跑測試'), 'type');
  assert.equal(pose('Bash: 跑測試', { lastEventAt: Date.now() - 5 * MIN }), 'leanback');
  assert.equal(pose('Subagent: 查資料'), 'point');

  const o2 = load();
  settle(o2, [at('tool', { activity: 'Read a.js' })]);
  o2.first = false;
  const who = settle(o2, [{ ...at('done'), key: 'claude:tool' }]);
  assert.equal(who('claude:tool').event.text, '做完了 ✓');
});

// ---- roaming freely, life around the office, picking people up

test('roaming: off-duty people get about the whole office, not just their room', () => {
  const o = load(true);
  const who = settle(o, [at('done', { n: 'x' }), at('waiting'), at('tool')]);
  assert.equal(who('claude:tool').mode, 'work');
  assert.ok(who('claude:waiting'), 'waiting still shown');
  const p = who('claude:donex');
  const places = new Set();
  for (let i = 0; i < 300; i++) {
    o.release(p); p.path = []; p.until = 0; p.lastPoi = null;
    o.roamTo(p);
    if (p.poi) places.add(p.poi.zone || p.poi.act);
  }
  assert.ok(places.has('done'), 'still likes the pantry');
  assert.ok(places.size >= 5, `goes to many kinds of places: ${[...places]}`);
});

test('roaming: someone standing about gets company and both chat', () => {
  const o = load(true);
  const who = settle(o, [at('idle', { n: 'a', ago: 60 * MIN }), at('idle', { n: 'b', ago: 60 * MIN })]);
  const a = who('claude:idlea'), b = who('claude:idleb');
  o.release(a);
  const spot = o.plan.pois.find((q) => !q.sit && !q.zone && !q.pair && !q.taken);
  spot.taken = a.key; a.poi = spot; a.x = spot.x; a.y = spot.y; a.path = []; a.until = Date.now() + 10_000;
  let chat = null;
  for (let i = 0; i < 400 && !chat; i++) {
    o.release(b); b.path = []; b.until = 0; b.lastPoi = null;
    o.roamTo(b);
    if (b.poi && b.poi.act === 'chat') chat = b.poi;
  }
  assert.ok(chat, 'went over to chat');
  assert.equal(chat.partner, a.key);
  assert.equal(a.chatWith, b.key);
  b.x = chat.x; b.y = chat.y; b.path = [];
  assert.equal(o.stateOf(b).act, 'chat');
  assert.equal(o.stateOf(a).act, 'chat');
  o.release(b);
  assert.equal(a.chatWith, null, 'walking off ends the chat');
});

test('a worker waiting on a long command fetches a coffee and hurries back when it moves on', () => {
  const o = load(true);
  const s = { ...at('tool'), activity: 'Bash: 跑測試', lastEventAt: Date.now() - 5 * MIN };
  const p = settle(o, [s])('claude:tool');
  p.x = p.desk.seat.x; p.y = p.desk.seat.y; p.path = []; p.nextRun = 0;
  o.coffeeRun(p, Date.now());
  assert.ok(p.run, 'went for a coffee');
  assert.match(p.run.poi.act, /coffee|water|vending/);
  p.x = p.run.poi.x; p.y = p.run.poi.y; p.path = [];
  assert.equal(o.stateOf(p).pose, 'stand');
  p.s = { ...s, lastEventAt: Date.now() };
  o.coffeeRun(p, Date.now());
  assert.equal(p.run, null);
  assert.ok(p.path.length, 'walking back to the desk');
});

function canvasFor(o) {
  o.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {}, setPointerCapture() {} };
  o.cam = { ox: 300, oy: 100, zoom: 1 };
  o.onHover = () => {};
  o.hoverKey = null;
}
const ev = (x, y) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

test('press and drag picks a person up; letting go puts them down on free floor and they go back to work', () => {
  const o = load(true);
  canvasFor(o);
  const p = settle(o, [at('tool', { activity: 'Read a.js' })])('claude:tool');
  o.hit = [{ key: p.key, x0: 0, x1: 1000, y0: 0, y1: 1000 }];
  o.grab(ev(100, 100));
  o.drag(ev(102, 101));
  assert.equal(p.held, undefined, 'a tiny wobble is still a click');
  o.drag(ev(160, 140));
  assert.equal(p.held, true);
  assert.equal(o.stateOf(p).pose, 'held');
  // Feet follow the pointer.
  const f = o.toFloor(ev(160, 140), 28 + 0.55 * 32);
  assert.ok(Math.abs(p.x - f.x) < 1e-9 && Math.abs(p.y - f.y) < 1e-9);
  const back = o.iso(f.x, f.y, 0);
  assert.ok(Math.abs(back.x + 300 - 160) < 1e-6 && Math.abs(back.y + 100 - (140 + 28 + 0.55 * 32)) < 1e-6, 'toFloor inverts iso');
  // Drop it right on a desk: lands on the nearest free spot.
  const desk = o.plan.desks[5];
  const pt = o.iso(desk.x + 0.7, desk.y + 0.4, 0);
  o.drag(ev(pt.x + 300, pt.y + 100 - 28 - 0.55 * 32));
  o.drop(ev(0, 0));
  assert.equal(p.held, false);
  assert.equal(o.plan.grid.blocked(p.x, p.y), false);
  assert.ok(o.dropped, 'the click that follows does not open the panel');
  assert.equal(o.stateOf(p).act, 'dazed');
  p.landed = Date.now() - 2000;
  o.step(0.016);
  assert.equal(p.landed, 0);
  assert.ok(p.path.length, 'heading back to the desk');
});

test('a dropped wanderer looks around where they landed, then carries on', () => {
  const o = load(true);
  canvasFor(o);
  const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
  o.hit = [{ key: p.key, x0: 0, x1: 1000, y0: 0, y1: 1000 }];
  o.grab(ev(100, 100));
  o.drag(ev(200, 200));
  assert.equal(p.poi, null, 'let go of their seat');
  o.drop(ev(0, 0));
  p.landed = Date.now() - 2000;
  o.step(0.016);
  assert.equal(o.stateOf(p).act, 'lookaround');
});

test('a session that messages another walks over, they chat, then it goes back to its desk', () => {
  const o = load(true);
  o.label = (s) => s.key;
  const now = Date.now();
  let who = settle(o, [at('tool', { activity: 'SendMessage' }), at('idle', { ago: 60 * MIN })]);
  const me = who('claude:tool'), mate = who('claude:idle');
  me.x = me.desk.seat.x; me.y = me.desk.seat.y; me.path = [];
  mate.path = []; mate.x = mate.poi.x; mate.y = mate.poi.y; mate.until = now + 5000;
  o.first = false;
  who = settle(o, [at('tool', { activity: 'SendMessage', talk: [{ key: 'claude:idle', dir: 'out', at: now, text: '幫我看一下' }] }), at('idle', { ago: 60 * MIN })]);
  assert.ok(me.visit, 'heading over');
  assert.equal(me.visit.mate, 'claude:idle');
  assert.ok(me.path.length, 'walking');
  assert.ok(Math.hypot(me.visit.x - mate.x, me.visit.y - mate.y) < 1.2, 'to a spot beside them');
  me.x = me.visit.x; me.y = me.visit.y; me.path = [];
  o.stepVisit(me, now);
  assert.equal(o.stateOf(me).act, 'chat');
  assert.equal(o.stateOf(mate).act, 'chat', 'they talk back');
  // The same message does not send them over again.
  o.update([at('tool', { activity: 'SendMessage', talk: [{ key: 'claude:idle', dir: 'out', at: now, text: '幫我看一下' }] }), at('idle', { ago: 60 * MIN })]);
  o.stepVisit(me, me.visit.until + 1);
  assert.equal(me.visit, null);
  assert.ok(me.path.length, 'back to the desk');
  assert.equal(mate.chatWith, null);
});

test('a message received does not make the receiver walk; the sender comes to a desk worker who chats from their chair', () => {
  const o = load(true);
  const now = Date.now();
  let who = settle(o, [at('tool', { activity: 'Read a.js' }), at('done', { n: 'x' })]);
  const worker = who('claude:tool'), sender = who('claude:donex');
  worker.x = worker.desk.seat.x; worker.y = worker.desk.seat.y; worker.path = [];
  o.first = false;
  o.label = (s) => s.key;
  o.update([at('tool', { activity: 'Read a.js', talk: [{ key: 'claude:donex', dir: 'in', at: now }] }),
    at('done', { n: 'x', talk: [{ key: 'claude:tool', dir: 'out', at: now, text: 'hi' }] })]);
  assert.equal(worker.visit, undefined);
  assert.ok(sender.visit);
  sender.x = sender.visit.x; sender.y = sender.visit.y; sender.path = [];
  o.stepVisit(sender, now);
  const st = o.stateOf(worker);
  assert.equal(st.pose, 'sit');
  assert.equal(st.act, 'chat');
});
