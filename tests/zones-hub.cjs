// Hub edition: where a person ends up in the office says their state.
// Runs office.js in a VM with just enough of a browser to build the floor
// plan and place people; nothing is drawn.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(roam = false, clock = Date) {
  const window = {};
  const ctx = { window, Math, Date: clock, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} };
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

test('dropping one person on another passes the first one\'s reply on and lands them side by side', () => {
  const o = load(true);
  canvasFor(o);
  o.label = (s) => s.key;
  const relays = [];
  o.onRelay = (from, to) => relays.push([from.key, to.key]);
  const who = settle(o, [at('done', { n: 'a', reply: '查好了' }), at('tool', { activity: 'Read a.js' })]);
  const a = who('claude:donea'), b = who('claude:tool');
  b.x = b.desk.seat.x; b.y = b.desk.seat.y; b.path = [];
  o.hit = [{ key: a.key, x0: 0, x1: 1000, y0: 0, y1: 1000 }];
  o.grab(ev(100, 100));
  o.drag(ev(200, 200));
  // Hold them right over the desk worker.
  const pt = o.iso(b.x, b.y, 0);
  o.drag(ev(pt.x + 300, pt.y + 100 - 28 - 0.55 * 32));
  assert.equal(o.dropOn, b.key, 'the one underneath is highlighted');
  assert.equal(o.mateUnder(a), b);
  o.drop(ev(0, 0));
  assert.deepEqual(relays, [['claude:donea', 'claude:tool']]);
  assert.equal(o.dropOn, null);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1.5, 'landed next to them');
  assert.equal(o.plan.grid.blocked(a.x, a.y), false);
  // Once the message is sent they walk over and talk.
  o.relayed(a.key, b.key, '〔轉自「a」〕\n查好了');
  assert.ok(a.visit);
  assert.match(a.visit.text, /^轉話：查好了/);
});

test('dropping far from anyone does not relay', () => {
  const o = load(true);
  canvasFor(o);
  const relays = [];
  o.onRelay = (from, to) => relays.push([from, to]);
  const who = settle(o, [at('done', { n: 'a' }), at('tool', { activity: 'Read a.js' })]);
  const a = who('claude:donea');
  o.hit = [{ key: a.key, x0: 0, x1: 1000, y0: 0, y1: 1000 }];
  o.grab(ev(100, 100));
  o.held = a; a.held = true;
  a.x = 0.5; a.y = o.plan.D - 0.5;
  o.dropOn = o.mateUnder(a) ? 'x' : null;
  assert.equal(o.dropOn, null);
  o.drop(ev(0, 0));
  assert.equal(relays.length, 0);
});

test('waiting on you: in line at your desk, sign after 3 minutes, the first knocks after 10, overflow knocks at the front', () => {
  for (const roam of [true, false]) {
    const o = load(roam);
    assert.ok(o.plan.boss && o.plan.queue.length >= 4, 'your desk with room for a line');
    for (const q of o.plan.queue) {
      assert.equal(o.plan.grid.blocked(q.x, q.y), false);
      assert.ok(o.plan.grid.path(o.plan.door.x, o.plan.door.y, q.x, q.y).length, 'reachable');
    }
    let who = settle(o, [at('waiting', { ago: 30_000 })]);
    let p = who('claude:waiting');
    assert.equal(p.queue, 0);
    assert.equal(p.poi.act, 'queue');
    p.path = []; p.x = p.poi.x; p.y = p.poi.y;
    assert.equal(o.stateOf(p).act, 'lookaround', 'just waiting');

    const many = Array.from({ length: 8 }, (_, i) => at('waiting', { n: i, ago: (20 - i) * MIN }));
    const o2 = load(roam);
    who = settle(o2, many);
    const slots = o2.plan.queue.length;
    for (let i = 0; i < 8; i++) {
      const k = who(`claude:waiting${i}`);
      k.path = []; k.x = k.poi.x; k.y = k.poi.y;
      if (i < slots) {
        assert.equal(k.queue, i, 'longest wait first');
        assert.equal(o2.stateOf(k).act, i === 0 ? 'knock' : 'sign', `${roam} ${i}`);
      } else {
        assert.equal(k.queue, null);
        assert.equal(k.poi.act, 'knock', 'no room in line: knock at the front');
      }
    }
    assert.equal(o2.queueCount, 8);
    // The first one gets an answer: everyone moves up.
    o2.first = false;
    o2.update(many.slice(1));
    assert.equal(who('claude:waiting1').queue, 0);
  }
});

test('the secretary session sits beside your desk and brings you news', () => {
  const o = load(true);
  o.isSecretary = (s) => /總機/.test(s.title || '');
  const who = settle(o, [at('done', { n: 'd', title: '2026-10-28 總機' }), at('idle', { ago: 60 * MIN })]);
  const sec = who('claude:doned');
  assert.equal(o.secKey, sec.key);
  assert.equal(sec.mode, 'work');
  assert.equal(sec.desk, o.plan.sec);
  assert.equal(o.deskOf.has(sec.key), false, 'not on a regular desk');
  sec.x = sec.desk.seat.x; sec.y = sec.desk.seat.y; sec.path = [];
  assert.equal(o.stateOf(sec).pose, 'sit');
  assert.equal(o.deliver('你不在時有 3 件事'), true);
  assert.ok(sec.path.length, 'walking to your desk');
  sec.path = [];
  assert.equal(o.stateOf(sec).act, 'clipboard');
  o.endErrand();
  assert.equal(sec.errand, null);
  assert.ok(sec.path.length, 'back to their desk');
  // Working: still at their own desk.
  o.update([at('tool', { n: 'd', key: 'claude:doned', title: '2026-10-28 總機', activity: 'Read a' })]);
  assert.equal(sec.desk, o.plan.sec);
});

test('no secretary: deliver does nothing', () => {
  const o = load(true);
  settle(o, [at('idle', { ago: 60 * MIN })]);
  assert.equal(o.deliver('x'), false);
});

test('dropping someone on the printer, whiteboard, coffee machine or door runs that command', () => {
  for (const id of ['printer', 'whiteboard', 'coffee', 'door']) {
    const o = load(true);
    canvasFor(o);
    o.label = (s) => s.key;
    const got = [];
    o.onRelay = () => got.push('relay');
    o.onCommand = (kind, s) => got.push([kind, s.key]);
    const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
    o.hit = [{ key: p.key, x0: 0, x1: 1000, y0: 0, y1: 1000 }];
    o.grab(ev(100, 100));
    o.drag(ev(200, 200));
    const t = o.plan.targets.find((x) => x.id === id);
    const pt = o.iso(t.x, t.y, 0);
    o.drag(ev(pt.x + 300, pt.y + 100 - 28 - 0.55 * 32));
    assert.equal(o.dropAt && o.dropAt.id, id);
    o.drop(ev(0, 0));
    assert.deepEqual(got, [[id, 'claude:idle']]);
    assert.equal(o.dropAt, null);
    assert.equal(o.plan.grid.blocked(p.x, p.y), false);
  }
});

test('the office unlocks furniture as finished turns add up', () => {
  const o = load(true);
  o.cat = { x: o.plan.W - 3, y: o.plan.D - 2, path: [], until: 0, face: 1 };
  assert.equal(o.setProgress({ turns: 0 }).length, 0, 'first call reports nothing new');
  assert.ok(!o.plan.props.some((q) => q.t === 'tv'));
  const plants = o.plan.props.filter((q) => q.t === 'plant').length;
  assert.equal(o.setProgress({ turns: 0 }).length, 0);
  const fresh = o.setProgress({ turns: 130 });
  assert.equal(fresh.length, 3, fresh.join());
  assert.ok(o.plan.props.filter((q) => q.t === 'plant').length > plants, 'more plants');
  assert.ok(o.plan.props.some((q) => q.t === 'tv'), 'a TV in the lounge');
  assert.ok(o.plan.pois.some((q) => q.act === 'tv'), 'something to watch');
  assert.ok(o.cat2, 'a second cat');
  assert.ok(!o.plan.props.some((q) => q.t === 'trophy'));
  o.setProgress({ turns: 600 });
  assert.ok(o.plan.props.some((q) => q.t === 'trophy'));
  assert.ok(o.plan.neon);
  // The new furniture blocks none of the spots people go to (one plant spot was already blocked).
  const blocked = (plan) => plan.pois.filter((q) => !q.sit && plan.grid.blocked(q.x, q.y)).map((q) => `${q.act}@${q.x},${q.y}`).join();
  assert.equal(blocked(o.plan), blocked(load(true).plan));
  for (const d of o.plan.desks) assert.ok(o.plan.grid.path(o.plan.door.x, o.plan.door.y, d.seat.x, d.seat.y).length, 'desks reachable');
});

test('levelling up shows above their head', () => {
  const o = load(true);
  settle(o, [at('tool', { activity: 'Read a.js', level: 2 })]);
  o.first = false;
  o.update([at('tool', { activity: 'Read a.js', level: 3 })]);
  const p = o.people.get('claude:tool');
  assert.match(p.event.text, /升等！Lv3 資深/);
  assert.equal(p.event.zone, 'level');
});

function loadFloor(n, roam = true) {
  const o = load(roam);
  o.floor = n;
  o.plan = o.buildPlan(0);
  return o;
}
const floorsOf = (src) => {
  const window = {};
  vm.runInNewContext(src, { window, Math, Date, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} });
  return window.OfficeFloors;
};
const Floors = floorsOf(fs.readFileSync(path.join(__dirname, '../public/office.js'), 'utf8'));

test('two floors: work and anything that needs you downstairs, idle ones upstairs, overflow work upstairs and it stays', () => {
  const sec = (s) => /總機/.test(s.title || '');
  const ss = [
    at('waiting'), at('error'), at('done', { n: 'fresh', ago: 5 * MIN }), at('idle', { ago: 60 * MIN }),
    at('done', { n: 'old', ago: 3 * 60 * MIN }), at('idle', { n: 'desk', title: '總機', ago: 90 * MIN }),
    ...Array.from({ length: 4 }, (_, i) => at('tool', { n: i, startedAt: i })),
    { key: 'claude:kid', id: 'kid', subagent: true, parentId: 'p', status: 'tool' },
  ];
  ss.push({ ...at('idle', { n: 'p', ago: 60 * MIN }), id: 'p' });
  const { floors, moved } = Floors.split(ss, new Map(), { cap: 3, isSecretary: sec });
  const f = (k) => floors.get(k).floor;
  for (const k of ['claude:waiting', 'claude:error', 'claude:donefresh', 'claude:idledesk', 'claude:tool0', 'claude:tool1', 'claude:tool2']) assert.equal(f(k), 1, k);
  for (const k of ['claude:idle', 'claude:doneold', 'claude:tool3', 'claude:idlep']) assert.equal(f(k), 2, k);
  assert.equal(f('claude:kid'), 2, 'a helper goes where its session is');
  assert.equal(moved.size, 0, 'nobody moved on the first look');
  // A desk frees up downstairs: the one working upstairs keeps working there.
  const next = Floors.split(ss.filter((s) => s.key !== 'claude:tool0'), floors, { cap: 3, isSecretary: sec });
  assert.equal(next.floors.get('claude:tool3').floor, 2);
  // The idle one starts working: comes downstairs (moved).
  const woke = ss.map((s) => (s.key === 'claude:idle' ? { ...s, status: 'tool', lastEventAt: Date.now() } : s)).filter((s) => s.key !== 'claude:tool0');
  const third = Floors.split(woke, next.floors, { cap: 3, isSecretary: sec });
  assert.equal(third.floors.get('claude:idle').floor, 1);
  assert.ok(third.moved.has('claude:idle'));
});

test('upstairs: no desk of yours or queue, a gym, a library, a lift instead of the street door; everything reachable', () => {
  const o = loadFloor(2);
  const p = o.plan;
  assert.equal(p.floor, 2);
  assert.equal(p.boss, null);
  assert.equal(p.queue.length, 0);
  for (const t of ['treadmill', 'yoga', 'shelf', 'tv', 'arcade', 'lift']) assert.ok(p.props.some((q) => q.t === t), t);
  assert.deepEqual([p.door.x, p.door.y], [p.lift.x, p.lift.y]);
  for (const q of p.pois) if (!q.sit) {
    assert.equal(p.grid.blocked(q.x, q.y), false, `${q.act}`);
    assert.ok(p.grid.path(p.door.x, p.door.y, q.x, q.y).length, `${q.act} reachable`);
  }
  assert.ok(p.zones.idle.length > 20, 'lots to do upstairs');
  // Same footprint as downstairs.
  const down = loadFloor(1).plan;
  assert.equal(p.W, down.W);
  assert.equal(p.D, down.D);
  assert.deepEqual([p.lift.x, p.lift.y], [down.lift.x, down.lift.y]);
});

test('changing floors: leave by the lift, arrive by the lift', () => {
  const down = loadFloor(1), up = loadFloor(2);
  const s = at('idle', { ago: 60 * MIN });
  settle(down, [s]);
  down.first = false; up.first = false;
  const moved = new Set([s.key]);
  down.update([], { moved });
  const leaver = down.people.get(s.key);
  assert.equal(leaver.viaLift, true);
  const end = leaver.path[leaver.path.length - 1];
  assert.ok(Math.hypot(end.x - down.plan.lift.x, end.y - down.plan.lift.y) < 0.3, 'walks to the lift, not the door');
  up.update([s], { moved });
  const arrived = up.people.get(s.key);
  assert.ok(Math.hypot(arrived.x - up.plan.lift.x, arrived.y - up.plan.lift.y) < 0.01, 'steps out of the lift');
  assert.match(arrived.event.text, /上樓/);
  // Someone leaving for home still uses the door downstairs.
  const t = at('done', { n: 'h', ago: 5 * MIN });
  settle(down, [t]);
  down.update([]);
  const home = down.people.get(t.key);
  const last = home.path[home.path.length - 1];
  assert.ok(Math.hypot(last.x - down.plan.door.x, last.y - down.plan.door.y) < 0.3);
});

test('on the treadmill they stand on the belt and run', () => {
  const o = loadFloor(2);
  const q = o.plan.pois.find((x) => x.act === 'run');
  const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
  o.release(p); p.poi = q; p.path = []; p.x = q.x; p.y = q.y;
  const st = o.stateOf(p);
  assert.equal(st.act, 'run');
  assert.equal(st.pose, 'stand');
  assert.ok(st.sitZ > 0.1);
});

// A Date whose "now" (new Date()) is the given local time today; Date.now stays real.
function clockAt(h) {
  const fixed = new Date(); fixed.setHours(h, 0, 0, 0);
  return class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed.getTime()); } static now() { return Date.now(); } };
}
const seat = (p) => { p.x = p.desk.seat.x; p.y = p.desk.seat.y; p.path = []; };

test('departments: sessions in the same repository sit in the same pod, and it gets their name', () => {
  const o = load(true);
  const w = (n, cwd) => ({ ...at('tool', { n }), cwd, startedAt: n });
  settle(o, [w(1, '/r/alpha'), w(2, '/r/beta'), w(3, '/r/alpha/.claude/worktrees/x-1'), w(4, '/r/beta'), w(5, '/r/alpha')]);
  const pod = (n) => o.plan.desks[o.deskOf.get(`claude:tool${n}`)].pod;
  assert.equal(pod(1), pod(3), 'a worktree counts as its repository');
  assert.equal(pod(1), pod(5));
  assert.equal(pod(2), pod(4));
  assert.notEqual(pod(1), pod(2));
  assert.equal(o.podDepts().map((d) => d.name).sort().join(), 'alpha,beta');
});

test('a push carries a box to the server rack and back; the same push only once', () => {
  const o = load(true);
  const s = { ...at('tool'), task: 'push' };
  const p = settle(o, [s])('claude:tool');
  seat(p);
  const now = Date.now();
  assert.equal(o.trip(p, now), true);
  assert.equal(p.run.poi.act, 'rack');
  assert.equal(o.stateOf(p).act, 'carry', 'carrying the box on the way');
  assert.match(p.event.text, /機房/);
  p.x = p.run.poi.x; p.y = p.run.poi.y; p.path = [];
  o.trip(p, now);
  assert.equal(o.stateOf(p).act, 'deliver');
  o.trip(p, now + 10_000);
  assert.equal(p.run, null);
  assert.ok(p.path.length, 'walking back to the desk');
  seat(p);
  assert.equal(o.trip(p, now + 20_000), false);
});

test('reading up for a while goes to the bookshelf', () => {
  const o = load(true);
  const p = settle(o, [{ ...at('tool'), task: 'web' }])('claude:tool');
  seat(p);
  const now = Date.now();
  assert.equal(o.trip(p, now), false, 'not straight away');
  assert.equal(o.trip(p, now + 21_000), true);
  assert.equal(p.run.poi.act, 'read');
  assert.equal(p.run.act, 'read');
});

test('a test run that fails gets a facepalm, one that passes a cheer; old results do not count', () => {
  const o = load(true);
  const s = at('tool', { task: 'test' });
  const p = settle(o, [s])('claude:tool');
  seat(p);
  o.first = false;
  o.update([{ ...s, outcome: { at: Date.now(), task: 'test', ok: false } }]);
  assert.equal(o.stateOf(p).act, 'facepalm');
  assert.equal(p.event.text, '測試沒過…');
  o.update([{ ...s, outcome: { at: Date.now() + 1, task: 'test', ok: true } }]);
  assert.equal(o.stateOf(p).act, 'cheer');
  assert.equal(o.stateOf(p).pose, 'stand', 'jumps up from the chair');
  const late = { ...at('tool', { n: 'late' }), outcome: { at: Date.now() - 1000, task: 'test', ok: true } };
  o.update([s, late]);
  assert.equal(o.people.get(late.key).react, undefined, 'a result from before they showed up is old news');
});

test('finishing a piece of work: walk to the notice board and pin a note', () => {
  const o = load(true);
  const s = at('tool');
  const p = settle(o, [s])('claude:tool');
  o.first = false;
  o.update([{ ...s, status: 'done', lastEventAt: Date.now() }]);
  assert.equal(p.chores.length, 1);
  o.wander(p, Date.now());
  assert.equal(p.poi.act, 'pin');
  assert.equal(p.event.text, '做完了 ✓', 'the finish message stays up while walking over');
  p.x = p.poi.x; p.y = p.poi.y; p.path = [];
  o.step(0.016);
  assert.equal(p.event.text, '貼上佈告欄 📌');
  assert.ok(o.pinnedAt > 0);
});

test('chores: whoever is free fixes a jammed printer, fetches lunch at noon, brings cake at three', () => {
  const o = load(true);
  o.floor = 1;
  const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
  o.first = false;
  assert.equal(o.chore('jam'), true);
  assert.equal(p.chores[0].act, 'fix');
  assert.equal(o.jamUntil, Infinity, 'jammed until someone gets there');
  p.chores = null;
  const noon = new Date(); noon.setHours(11, 50, 0, 0);
  o.nextLife = Infinity;
  o.life(noon.getTime());
  assert.equal(p.chores[0].text, '外送到了！');
  assert.equal(p.chores[1].carry, true);
  p.chores = null;
  o.life(noon.getTime() + 60_000);
  assert.equal(p.chores, null, 'one delivery a day');
  o.lifeMark('lunch', Date.now(), 0, p);
  assert.ok(o.lunchUntil > Date.now());
  const three = new Date(); three.setHours(15, 5, 0, 0);
  o.life(three.getTime());
  assert.equal(p.chores.at(-1).arrive, 'cake');
  // Nobody free (everyone working): nothing happens.
  const busy = load(true);
  settle(busy, [at('tool')]);
  busy.first = false;
  assert.equal(busy.chore('jam'), false);
});

test('breaks at the desk follow the clock: lunch at noon, yawning at night', () => {
  const actAt = (h) => {
    const o = load(true, clockAt(h));
    const p = settle(o, [at('thinking')])('claude:thinking');
    seat(p);
    o.t = (78 - p.phase * 5) * 1000 + 100;
    return o.stateOf(p).act;
  };
  assert.equal(actAt(12), 'eat');
  assert.equal(actAt(22), 'yawn');
  assert.equal(actAt(10), 'stretch');
});

test('spotlight: starting or finishing work brings the camera in on them, one at a time, not twice a minute', () => {
  const o = load(true);
  o.visible = true; o.cw = 800; o.ch = 600;
  const a = at('done', { n: 'a' }), b = at('done', { n: 'b' }), sub = at('done', { n: 'sub', subagent: true });
  settle(o, [a, b, sub]);
  o.first = false;
  o.update([{ ...a, status: 'tool' }, b, { ...sub, status: 'tool' }]);
  assert.equal(o.spotQ.join(), a.key, 'starting work: queued (helpers are not)');
  const p = o.spotPerson();
  assert.equal(p.key, a.key);
  o.cam = null; o.fitCamera();
  const at2 = o.iso(p.x, p.y, 0.5);
  assert.ok(Math.abs(at2.x * o.cam.zoom + o.cam.ox - 400) < 1 && Math.abs(at2.y * o.cam.zoom + o.cam.oy - 300) < 1, 'centred on them');
  const close = o.cam.zoom;
  o.update([{ ...a, status: 'tool' }, { ...b, status: 'tool' }, { ...sub, status: 'tool' }]);
  o.update([{ ...a, status: 'done', lastEventAt: Date.now() }, { ...b, status: 'tool' }, { ...sub, status: 'tool' }]);
  assert.equal(o.spotQ.join(), b.key, 'a finished again within a minute: not again');
  o.spot.until = 0;
  assert.equal(o.spotPerson().key, b.key, 'next in line');
  o.spotCancel();
  assert.equal(o.spotPerson(), null);
  o.cam = null; o.fitCamera();
  assert.ok(o.cam.zoom < close, 'back to the whole room');
  o.follow = false;
  o.spotlight('claude:x');
  assert.equal(o.spotQ.length, 0, 'turned off in settings');
});
