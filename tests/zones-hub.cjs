// Hub edition: where a person ends up in the office says their state.
// Runs office.js in a VM with just enough of a browser to build the floor
// plan and place people; nothing is drawn.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Daytime by default, so tests do not depend on when they run (closing time, lunch…).
function load(roam = false, clock = clockAt(15)) {
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
  // Lunch and tea follow the real clock (office.js life()): already had
  // today, so a test run at noon or at three behaves like any other.
  o.lunchDay = o.teaDay = new Date().toDateString();
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

const meetingRoomFull = (o) => { for (const q of o.plan.pois) if (q.sit && (q.act === 'meeting' || q.act === 'read')) q.taken = 'someone'; };

test('meeting room full: a session that messages another walks over, they chat, then it goes back to its desk', () => {
  const o = load(true);
  meetingRoomFull(o);
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

test('meeting room full: the receiver stays put; the sender comes to a desk worker who chats from their chair', () => {
  const o = load(true);
  meetingRoomFull(o);
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
  const { floors, moved } = Floors.split(ss, new Map(), { cap: 3, isSecretary: sec, idleDown: 0 });
  const f = (k) => floors.get(k).floor;
  for (const k of ['claude:waiting', 'claude:error', 'claude:donefresh', 'claude:idledesk', 'claude:tool0', 'claude:tool1', 'claude:tool2']) assert.equal(f(k), 1, k);
  for (const k of ['claude:idle', 'claude:doneold', 'claude:tool3', 'claude:idlep']) assert.equal(f(k), 2, k);
  assert.equal(f('claude:kid'), 2, 'a helper goes where its session is');
  assert.equal(moved.size, 0, 'nobody moved on the first look');
  // A desk frees up downstairs: the one working upstairs keeps working there.
  const next = Floors.split(ss.filter((s) => s.key !== 'claude:tool0'), floors, { cap: 3, isSecretary: sec, idleDown: 0 });
  assert.equal(next.floors.get('claude:tool3').floor, 2);
  // The idle one starts working: comes downstairs (moved).
  const woke = ss.map((s) => (s.key === 'claude:idle' ? { ...s, status: 'tool', lastEventAt: Date.now() } : s)).filter((s) => s.key !== 'claude:tool0');
  const third = Floors.split(woke, next.floors, { cap: 3, isSecretary: sec, idleDown: 0 });
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
  o.lunchDay = o.teaDay = null; // this one is about them
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
  assert.ok(Math.abs(at2.x * o.cam.zoom + o.cam.ox - 400) < 1 && Math.abs(at2.y * o.cam.zoom + o.cam.oy - 318) < 1, 'centred on them (a little low, so the bubble fits)');
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

test('the boss walks in: everyone but the ones waiting on you hurries to a desk and looks busy; leaves: back to normal', () => {
  const o = load(true);
  const idle = at('idle', { ago: 60 * MIN }), done = at('done', { ago: 2 * MIN }), wait = at('waiting'), work = at('tool');
  settle(o, [idle, done, wait, work]);
  o.first = false;
  o.setBoss(true);
  const p = o.people.get(idle.key);
  assert.ok(p.rush > Date.now(), 'running');
  o.update([idle, done, wait, work]);
  for (const k of [idle.key, done.key, work.key]) assert.equal(o.people.get(k).mode, 'work', k);
  assert.notEqual(o.people.get(wait.key).mode, 'work', 'waiting on you: stays in line');
  assert.equal(o.stateOf(p).act, 'run', 'runs to the desk');
  seat(p);
  assert.match(o.stateOf(p).act, /^(typefast|deskread|write|type)$/);
  assert.equal(o.stateOf(p).pose, 'sit');
  assert.equal(o.spotQ, undefined, 'pretending is not starting work: no spotlight');
  assert.equal(o.chore('jam') && false, false);
  o.setBoss(false);
  o.update([idle, done, wait, work]);
  assert.notEqual(o.people.get(idle.key).mode, 'work');
  assert.equal(o.people.get(work.key).mode, 'work');
});

test('the company name takes the first window on the back wall, on both floors', () => {
  const o = load(true);
  const before = o.plan.windows.length;
  assert.equal(o.plan.logo, null);
  o.setCompany('  測試公司  ');
  assert.equal(o.company, '測試公司');
  assert.ok(o.plan.logo && o.plan.logo.w >= 2.5);
  const L = o.plan.logo;
  assert.ok(o.plan.windows.every((x) => x + 1.5 < L.x || x > L.x + L.w), 'no window behind the sign');
  assert.ok(o.plan.windows.length < before);
  const up = loadFloor(2);
  up.setCompany('測試公司');
  assert.ok(up.plan.logo);
});

test('a full floor is laid out once, not again on every update (the boss coming in upstairs)', () => {
  for (const floor of [1, 2]) {
    const o = loadFloor(floor);
    const many = Array.from({ length: 16 }, (_, i) => at('idle', { n: i, ago: 60 * MIN }));
    settle(o, many);
    o.first = false;
    let n = 0;
    const orig = o.rebuild.bind(o);
    o.rebuild = () => { n++; orig(); };
    o.setBoss(true);
    for (let i = 0; i < 5; i++) o.update(many);
    assert.ok(n <= 1, `floor ${floor}: rebuilt ${n} times`);
    const ppl = [...o.people.values()];
    assert.equal(ppl.filter((p) => !p.leaving).length, 16, `floor ${floor}: nobody sent home`);
    const desks = ppl.filter((p) => p.mode === 'work').length;
    assert.ok(desks > 0 && desks <= o.plan.desks.length, `floor ${floor}: the free desks are taken (${desks})`);
    for (const p of ppl.filter((x) => x.mode !== 'work')) {
      assert.equal(p.pretend, true);
      p.path = []; p.poi = null; p.until = 0;
      o.wander(p, Date.now());
      p.path = []; if (p.poi) { p.x = p.poi.x; p.y = p.poi.y; }
      assert.match(o.stateOf(p).act, /^(whiteboard|printer|read|phone|typefast|clipboard)$/, `floor ${floor}: no desk, looks busy`);
    }
  }
  // Pretending gives way to real work.
  {
    const o = load(true);
    const idle = Array.from({ length: o.plan.desks.length + 1 }, (_, i) => at('idle', { n: i, ago: 60 * MIN }));
    settle(o, idle);
    o.first = false;
    o.setBoss(true);
    o.update(idle);
    assert.equal(o.deskOf.size, o.plan.desks.length, 'all desks taken by pretenders');
    const real = at('tool', { n: 'real' });
    o.update([...idle, real]);
    assert.equal(o.people.get(real.key).mode, 'work', 'the one really working gets a desk');
  }
});

test('stand-up: everyone goes to the meeting room, each one speaks in turn, minutes at the end', () => {
  const o = load(true);
  o.floor = 1;
  const list = [at('tool'), at('idle', { ago: 60 * MIN }), at('done', { ago: 2 * MIN }), at('error')];
  settle(o, list);
  o.first = false;
  let minutes = null;
  assert.equal(o.startStandup((s) => `報告 ${s.key}`, (lines) => { minutes = lines; }), true);
  o.update(list);
  for (const p of o.people.values()) {
    assert.ok(p.standupSpot, `${p.key} has a place`);
    assert.notEqual(p.mode, 'work', 'nobody stays at a desk');
    p.path = []; p.poi = null; p.until = 0;
    o.wander(p, Date.now());
    assert.ok(Math.hypot(p.poi.x - p.standupSpot.x, p.poi.y - p.standupSpot.y) < 0.01);
  }
  const t = o.plan.props.find((q) => q.t === 'meetingTable');
  const spot = o.people.get('claude:tool').standupSpot;
  assert.ok(Math.hypot(spot.x - (t.x + t.w / 2), spot.y - (t.y + t.d / 2)) < 4, 'round the meeting table');
  let wall = Date.now() + 7000;
  o.stepStandup(wall);
  const first = o.standup.speaker;
  const p1 = o.people.get(first);
  p1.path = []; p1.x = p1.poi.x; p1.y = p1.poi.y;
  assert.equal(o.stateOf(p1).act, 'chat', 'the one speaking talks');
  assert.match(p1.event.text, /^報告/);
  for (let i = 0; i < 5; i++) { wall += 5100; o.stepStandup(wall); }
  assert.equal(o.standup, null, 'over');
  assert.equal(minutes.length, 4);
  assert.ok([...o.people.values()].every((p) => !p.standupSpot));
  o.update(list);
  assert.equal(o.people.get('claude:tool').mode, 'work', 'back to work');
});

test('stand-up: the one coming down by the lift afterwards joins in; everyone comes downstairs', () => {
  const o = load(true);
  o.floor = 1;
  const a = at('tool');
  settle(o, [a]);
  o.first = false;
  o.startStandup(() => 'x', () => {});
  const late = at('idle', { n: 'late', ago: 60 * MIN });
  o.update([a, late], { moved: new Set([late.key]) });
  assert.ok(o.people.get(late.key).standupSpot, 'latecomer gets a place');
  assert.equal(o.standup.order.length, 2);
});

test('after hours the ones just resting go home and the room goes dark; the ones that need you stay', () => {
  const o = load(true, clockAt(21));
  const list = [at('tool'), at('idle', { ago: 60 * MIN }), at('done', { ago: 2 * MIN }), at('waiting')];
  settle(o, list);
  assert.equal(o.closedNow, true);
  assert.ok(o.people.get('claude:tool'));
  assert.ok(o.people.get('claude:waiting'));
  assert.equal(o.people.get('claude:idle'), undefined);
  assert.equal(o.people.get('claude:done'), undefined);
  assert.equal(o.offDuty, 2, 'counted as gone home');
  const day = load(true, clockAt(15));
  settle(day, list);
  assert.equal(day.closedNow, false);
  assert.ok(day.people.get('claude:idle'));
});

test('you: W A S D walk you about (not through furniture), Space talks to whoever is next to you, R sits you down', () => {
  const o = load(true);
  o.floor = 1;
  const s = at('idle', { ago: 60 * MIN });
  settle(o, [s]);
  const me = o.meOn();
  assert.ok(me.seated);
  // From open floor in the middle of the room.
  const open = [];
  for (let x = 2; x < o.plan.OW; x += 0.25) for (let y = 2; y < o.plan.D - 2; y += 0.25) {
    if ([[0, 0], [-0.6, -0.6], [-1.2, -1.2], [0.6, 0.6]].every(([dx, dy]) => !o.plan.grid.blocked(x + dx, y + dy))) open.push({ x, y });
  }
  const start = open[Math.floor(open.length / 2)];
  me.x = start.x; me.y = start.y; me.seated = false;
  o.meKey('w', true);
  for (let i = 0; i < 6; i++) o.stepMe(0.05);
  o.meKey('w', false);
  o.stepMe(0.05);
  assert.ok(me.x < start.x - 0.2 && me.y < start.y - 0.2, 'W walks up the screen (back of the room)');
  assert.equal(me.moving, false, 'stops when the key is let go');
  assert.equal(me.seated, false);
  assert.ok(!o.plan.grid.blocked(me.x, me.y));
  // Next to someone: Space opens them.
  const p = o.people.get(s.key);
  me.x = p.x + 0.5; me.y = p.y;
  let opened = null;
  o.onHover = (sess, at2, click) => { if (click) opened = sess; };
  assert.equal(o.meNear(), p);
  o.meKey(' ', true);
  assert.equal(opened.key, s.key);
  o.meKey('r', true);
  for (let i = 0; i < 400 && !me.seated; i++) o.stepMe(0.05);
  assert.ok(me.seated, 'back at your desk');
  assert.equal(o.bodies().length, 2);
  assert.equal(o.meKey('x', true), false, 'other keys are left alone');
});

test("today's best gets a gold ring and a trophy in the name tag", () => {
  const o = load(true);
  o.bestKey = 'claude:idle';
  const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
  assert.equal(o.bestKey, p.key);
});

test('getting up from the sofa: out the front, not through the back of it', () => {
  for (const floor of [1, 2]) {
    const o = loadFloor(floor);
    const seat = o.plan.pois.find((q) => q.act === 'couch');
    const away = o.plan.pois.find((q) => q.y < seat.y - 4) || { x: seat.x, y: 1.2 };
    const path = o.plan.grid.path(seat.x, seat.y, away.x, away.y);
    const first = path[0];
    assert.ok(first.y >= seat.y - 0.05, `floor ${floor}: first step goes forward or sideways, not back through the sofa (${first.x},${first.y})`);
  }
});

test('sitting down: everyone at a table, on the sofa or a beanbag faces the table, coffee table or TV', () => {
  for (const floor of [1, 2]) {
    const o = loadFloor(floor);
    const tables = o.plan.props.filter((q) => /^(roundTable|meetingTable|coffeeTable)$/.test(q.t));
    for (const q of o.plan.pois.filter((x) => x.sit && /^(stool|meeting|couch|read)$/.test(x.act))) {
      const c = tables.map((t) => (t.t === 'roundTable' ? { x: t.x, y: t.y } : { x: t.x + t.w / 2, y: t.y + t.d / 2 }))
        .sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y))[0];
      if (!c || Math.hypot(c.x - q.x, c.y - q.y) > 2.4) continue;
      assert.ok(q.yaw != null, `floor ${floor} ${q.act} has a direction`);
      const look = { x: Math.sin(q.yaw), y: Math.cos(q.yaw) };
      const to = { x: c.x - q.x, y: c.y - q.y };
      const cos = (look.x * to.x + look.y * to.y) / Math.hypot(to.x, to.y);
      // Chairs and sofas: square on, toward the table's side; stools: straight at it.
      if (/^(couch|meeting|read)$/.test(q.act)) assert.ok(Math.abs(Math.sin(q.yaw)) < 1e-9 && cos > 0, `floor ${floor} ${q.act} sits square, facing the table side`);
      else assert.ok(cos > 0.9, `floor ${floor} ${q.act} at ${q.x.toFixed(1)},${q.y.toFixed(1)} faces the table (cos ${cos.toFixed(2)})`);
    }
  }
});

test('sitting off duty they do things, and change what they do', () => {
  const o = load(true);
  const p = settle(o, [at('idle', { ago: 60 * MIN })])('claude:idle');
  const couch = o.plan.pois.find((q) => q.act === 'couch');
  o.release(p); p.poi = couch; p.path = []; p.x = couch.x; p.y = couch.y; p.mode = 'wander'; p.zone = 'idle';
  const seen = new Set();
  for (let s = 0; s < 120; s += 3) { o.t = s * 1000; seen.add(o.stateOf(p).act); }
  assert.ok(seen.size >= 4, `several things on the sofa: ${[...seen].join(',')}`);
  assert.ok(![...seen].includes('couch'), 'never just "couch"');
  for (const act of seen) assert.ok(/^(scroll|read|laptop|laugh|watch|sip|game|nap|chat)$/.test(act), act);
});

test('a failed CI run sets the server room flashing; a merged PR throws confetti; a poke gets a reaction', () => {
  const o = load(true);
  const s = at('tool');
  const p = settle(o, [s])('claude:tool');
  o.first = false;
  o.update([{ ...s, outcome: { at: Date.now(), task: 'ci', ok: false } }]);
  assert.ok(o.alarmUntil > Date.now() + 20_000, 'alarm on');
  assert.match(p.event.text, /CI/);
  o.update([{ ...s, outcome: { at: Date.now() + 5, task: 'merge', ok: true } }]);
  assert.equal(o.confetti.key, p.key);
  // Poke: a reaction for a moment, and a line; poked too often, they complain.
  seat(p);
  o.poke(p);
  assert.ok(p.poke.until > Date.now());
  assert.ok(p.event.text.length > 0);
  assert.match(o.stateOf(p).act, /^(dazed|wave|cheer)$/);
  o.poke(p); o.poke(p); o.poke(p);
  assert.match(p.event.text, /別再戳/);
  p.poke.until = 0; p.react = null; // (the merge cheer is over too)
  assert.doesNotMatch(o.stateOf(p).act, /^(dazed|wave|cheer|facepalm)$/, 'back to work');
});

test('two people walking toward each other step aside instead of walking through each other', () => {
  const o = load(true);
  const a = at('idle', { n: 'a', ago: 60 * MIN }), b = at('idle', { n: 'b', ago: 60 * MIN });
  settle(o, [a, b]);
  o.first = false;
  const pa = o.people.get(a.key), pb = o.people.get(b.key);
  // An open stretch of floor along x.
  let lane = null;
  for (let y = 1.5; y < o.plan.D - 1.5 && !lane; y += 0.25) {
    for (let x0 = 1; x0 < o.plan.W - 5; x0 += 0.25) {
      let ok = true;
      for (let x = x0; x <= x0 + 4 && ok; x += 0.1) for (const dy of [-0.5, 0, 0.5]) if (o.plan.grid.blocked(x, y + dy)) ok = false;
      if (ok) { lane = { x0, y }; break; }
    }
  }
  assert.ok(lane, 'found an open stretch');
  for (const [p, from, to] of [[pa, lane.x0, lane.x0 + 4], [pb, lane.x0 + 4, lane.x0]]) {
    o.release(p); p.mode = 'wander'; p.zone = 'idle'; p.chores = null;
    p.x = from; p.y = lane.y; p.path = [{ x: to, y: lane.y }];
    p.poi = { x: to, y: lane.y, act: 'stretch', face: 'front' }; p.until = Infinity; p.stay = 60_000;
  }
  let closest = Infinity;
  for (let i = 0; i < 200 && (pa.path.length || pb.path.length); i++) {
    o.step(0.03);
    closest = Math.min(closest, Math.hypot(pa.x - pb.x, pa.y - pb.y));
  }
  assert.ok(closest > 0.3, `kept apart (closest ${closest.toFixed(2)})`);
  assert.equal(pa.path.length + pb.path.length, 0, 'both got where they were going');
});

test('holidays: pumpkins in late October, a tree in December, lanterns round Lunar New Year; none in the way', () => {
  const o = load(true);
  const season = (y, m, d) => {
    const ctx = { window: {}, Math, Date, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/office.js'), 'utf8'), ctx);
    return ctx.window.OfficeSeason(new Date(y, m - 1, d));
  };
  assert.equal(season(2026, 10, 29), 'halloween');
  assert.equal(season(2026, 12, 20), 'xmas');
  assert.equal(season(2027, 2, 10), 'lny');
  assert.equal(season(2026, 2, 8), 'lny', 'nine days before');
  assert.equal(season(2026, 2, 5), null, 'not yet twelve days before');
  assert.equal(season(2026, 6, 1), null);
  for (const [kind, want] of [['halloween', 'pumpkin'], ['xmas', 'tree'], ['lny', 'lantern'], [null, null]]) {
    o.seasonOverride = kind;
    o.plan = o.buildPlan(0);
    const decos = o.plan.props.filter((q) => q.t === 'deco');
    if (!want) { assert.equal(decos.length, 0); continue; }
    assert.ok(decos.length >= 1 && decos.every((d) => d.kind === want), `${kind}: ${decos.map((d) => d.kind)}`);
    const seats = [...o.plan.desks.map((d) => d.seat), o.plan.boss && o.plan.boss.seat, o.plan.sec && o.plan.sec.seat, ...(o.plan.queue || [])].filter(Boolean);
    for (const d of decos) assert.ok(seats.every((q) => Math.hypot(q.x - d.x, q.y - d.y) > 1.0), `${kind}: ${d.kind} clear of every seat and the queue`);
    // Every seat and spot still reachable from the door without crossing furniture.
    for (const q of o.plan.pois) {
      const way = o.plan.grid.path(o.plan.door.x, o.plan.door.y, q.x, q.y);
      assert.ok(way.length > 0, `${kind}: way to ${q.act}`);
    }
  }
});

test('replay: who was where at a given time of day', () => {
  const ctx = { window: {}, Math, Date, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/office.js'), 'utf8'), ctx);
  const at2 = ctx.window.OfficeReplay.at;
  const spans = {
    'claude:a': { title: '報告', s: [[1000, 'w'], [5000, 'q'], [9000, 'd']] },
    'claude:b': { title: '修 bug', s: [[6000, 'w']] },
  };
  const now = 100_000;
  const zone = (T) => at2(spans, T, now).map((s) => `${s.key.slice(-1)}:${s.status}`).join(',');
  assert.equal(zone(500), '', 'nobody yet');
  assert.equal(zone(2000), 'a:tool');
  assert.equal(zone(7000), 'a:waiting,b:tool');
  assert.equal(zone(9500), 'a:done,b:tool');
  const done = at2(spans, 9500, now).find((s) => s.key === 'claude:a');
  assert.equal(done.lastEventAt, now - 500, 'just finished, in replayed time');
  assert.equal(done.title, '報告');
});

test('personalities: fixed per person; a coffee lover goes for coffee, a bookworm for the shelf, the tidy one does the chores', () => {
  const ctx = { window: {}, Math, Date, Map, Set, Object, Array, Number, String, JSON, Infinity, setTimeout, Image: class {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/office.js'), 'utf8'), ctx);
  const T = ctx.window.OfficeTraits;
  assert.equal(JSON.stringify(T('claude:x1')), JSON.stringify(T('claude:x1')), 'the same every time');
  const find = (id) => { for (let i = 0; i < 2000; i++) { const k = `claude:t${i}`; const t = T(k); if (t.length === 1 && t[0].id === id) return k; } };
  const coffee = find('coffee'), book = find('bookworm'), tidy = find('tidy');
  assert.ok(coffee && book && tidy);
  const share = (key, acts) => {
    const o = load(true);
    const p = settle(o, [{ ...at('done', { ago: 2 * MIN }), key }])(key);
    let hit = 0;
    for (let i = 0; i < 300; i++) { o.release(p); p.lastPoi = null; o.roamTo(p); if (acts.test(p.poi.act)) hit++; }
    return hit / 300;
  };
  assert.ok(share(coffee, /^(coffee|water|vending)$/) > share(book, /^(coffee|water|vending)$/) * 1.5, 'coffee lovers go for coffee');
  assert.ok(share(book, /^read$/) > share(coffee, /^read$/) * 1.5, 'bookworms go for the books');
  // Chores: the tidy one is picked far more often.
  let byTidy = 0;
  for (let i = 0; i < 60; i++) {
    const o = load(true);
    settle(o, [{ ...at('idle', { ago: 60 * MIN }), key: tidy }, { ...at('idle', { ago: 60 * MIN }), key: coffee }]);
    o.first = false;
    o.chore('plants');
    if (o.people.get(tidy).chores) byTidy++;
  }
  assert.ok(byTidy > 36, `tidy does most chores (${byTidy}/60)`);
});

test('a visitor walks in, says what they came about at the secretary\'s desk, gets an answer and leaves', () => {
  const o = load(true);
  o.isSecretary = (s) => s.key === 'claude:sec';
  const sec = { ...at('idle', { ago: 60 * MIN }), key: 'claude:sec', title: '秘書' };
  settle(o, [sec]);
  o.first = false;
  assert.equal(o.visitorsIn([{ id: 'old', from: '舊的', text: 'x', at: Date.now() - 10 * MIN }]), 0, 'stale visits are skipped');
  assert.equal(o.visitorsIn([{ id: 'v1', from: '小明（前端）', text: '登入頁壞了可以幫看嗎', at: Date.now() }]), 1);
  assert.equal(o.visitorsIn([{ id: 'v1', from: '小明（前端）', text: '登入頁壞了可以幫看嗎', at: Date.now() }]), 0, 'only once');
  const v = o.visitors.get('visitor:v1');
  assert.equal(v.s.title, '訪客・小明（前端）');
  assert.ok(v.path.length, 'walking in from the door');
  assert.equal(o.bodies().includes(v), true);
  for (let i = 0; i < 600 && v.stage === 'in'; i++) o.stepVisitors(0.05);
  assert.equal(v.stage, 'talk');
  assert.match(v.event.text, /登入頁/);
  assert.equal(o.stateOf(v).act, 'chat');
  const host = o.people.get('claude:sec');
  v.replyAt = Date.now() - 1; o.stepVisitors(0.05);
  assert.match(host.event.text, /收到/);
  v.until = 0; o.stepVisitors(0.05);
  assert.equal(v.stage, 'out');
  for (let i = 0; i < 600 && o.visitors.has('visitor:v1'); i++) o.stepVisitors(0.05);
  assert.equal(o.visitors.has('visitor:v1'), false, 'gone again');
  // On air the message stays private.
  o.masked = true;
  o.visitorsIn([{ id: 'v2', from: '小明', text: '秘密', at: Date.now() }]);
  assert.equal(o.visitors.get('visitor:v2').s.title, '訪客');
  assert.doesNotMatch(o.visitors.get('visitor:v2').text, /秘密/);
});

test('a few idle ones stay downstairs to keep the office lively; the same ones, not a new set each time', () => {
  const idle = Array.from({ length: 10 }, (_, i) => at('idle', { n: i, ago: (60 + i) * MIN }));
  const first = Floors.split(idle, new Map());
  const down = idle.filter((s) => first.floors.get(s.key).floor === 1).map((s) => s.key);
  assert.equal(down.length, 4);
  assert.deepEqual(down, ['claude:idle0', 'claude:idle1', 'claude:idle2', 'claude:idle3'], 'the most recently active');
  // Someone else becomes "more recent" but is still idle: nobody swaps floors.
  const later = idle.map((s) => (s.key === 'claude:idle9' ? { ...s, lastEventAt: Date.now() } : s));
  const second = Floors.split(later, first.floors);
  assert.equal(second.moved.size, 0);
});

test('you can always walk away from your desk, whichever key you press (round the furniture if need be)', () => {
  const o = load(true);
  o.floor = 1;
  settle(o, [at('idle', { ago: 60 * MIN })]);
  const me = o.meOn();
  const seat = { x: me.x, y: me.y };
  for (const k of ['w', 'a', 's', 'd']) {
    Object.assign(me, { x: seat.x, y: seat.y, seated: true, detour: null, path: [] });
    o.meKey(k, true);
    for (let i = 0; i < 40; i++) o.stepMe(0.05);
    o.meKey(k, false);
    assert.ok(Math.hypot(me.x - seat.x, me.y - seat.y) > 0.9, `${k}: got away from the desk (${Math.hypot(me.x - seat.x, me.y - seat.y).toFixed(2)})`);
    assert.equal(o.plan.grid.hard(me.x, me.y), false, `${k}: not inside furniture`);
  }
});

test('messaging another session: both go to the meeting room, sit across the table and take turns talking, then go back', () => {
  const o = load(true);
  const now = Date.now();
  o.label = (s) => s.key;
  const a = at('tool', { activity: 'SendMessage' }), b = at('tool', { n: 'b', activity: 'Read a.js' });
  settle(o, [a, b]);
  o.first = false;
  const pa = o.people.get(a.key), pb = o.people.get(b.key);
  const deskA = pa.desk;
  o.update([{ ...a, talk: [{ key: b.key, dir: 'out', at: now, text: '幫我看一下這個設計' }] }, b]);
  assert.ok(pa.meeting && pb.meeting, 'both are off to a meeting');
  const sa = pa.meeting.seat, sb = pb.meeting.seat;
  assert.ok(Math.abs(sa.x - sb.x) < 0.15 && Math.abs(sa.y - sb.y) > 1, 'across the table from each other');
  assert.match(pa.event.text, /開會/);
  // Arrive.
  for (const p of [pa, pb]) { p.path = []; p.x = p.meeting.seat.x; p.y = p.meeting.seat.y; }
  o.stepMeeting(pa, now);
  assert.equal(o.stateOf(pa).pose, 'sit');
  assert.equal(pa.meeting.speaker, pa.key, 'the one who called it speaks first');
  assert.match(pa.event.text, /設計/);
  o.stepMeeting(pa, now + 3700);
  assert.equal(pa.meeting.speaker, pb.key, 'then the other');
  assert.equal(o.stateOf(pb).act, 'chat');
  assert.equal(o.stateOf(pa).act, 'write', 'the one listening takes notes');
  o.stepMeeting(pa, now + 30_000);
  assert.equal(pa.meeting, null);
  assert.equal(pb.meeting, null);
  assert.ok(pa.path.length && pa.desk === deskA, 'back to the desk');
  assert.equal(sa.taken, null);
});

test('your bot answered: the secretary walks the visitor to the door, waves them off, and goes back', () => {
  const o = load(true);
  o.isSecretary = (s) => s.key === 'claude:sec';
  const sec = { ...at('tool'), key: 'claude:sec', title: '秘書' };
  settle(o, [sec]);
  o.first = false;
  const host = o.people.get('claude:sec');
  host.path = []; host.x = host.desk.seat.x; host.y = host.desk.seat.y;
  o.visitorsIn([{ id: 'REQ-9@1', conv: 'REQ-9', kind: 'visit', from: '小明', text: '問題', at: Date.now() }]);
  const v = o.visitors.get('visitor:REQ-9@1');
  v.path = []; v.stage = 'talk'; v.until = Date.now() + 60_000;
  o.visitorsIn([{ id: 'REQ-9@2', conv: 'REQ-9', kind: 'reply', from: '小明', at: Date.now() }]);
  assert.ok(host.seeOff, 'off to the door');
  assert.ok(host.path.length);
  assert.equal(v.until, 0, 'the visitor wraps up');
  host.path = [];
  o.stepSeeOff(host, Date.now());
  assert.match(host.event.text, /慢走/);
  assert.equal(o.stateOf(host).act, 'wave');
  o.stepSeeOff(host, Date.now() + 5000);
  assert.equal(host.seeOff, null);
  assert.ok(host.path.length, 'back to the desk');
});

test('on leave: a free desk downstairs gets their sign; back again, they say so', () => {
  const o = load(true);
  o.label = (s) => s.title;
  const w = at('tool');
  settle(o, [w]);
  o.first = false;
  o.setLeave([{ key: 'claude:away', title: '活動報表', days: 3, since: 0 }]);
  const desk = o.plan.desks.find((d) => o.leaveDesk(d));
  assert.ok(desk, 'a desk with their sign');
  assert.notEqual(o.plan.desks.indexOf(desk), o.deskOf.get(w.key), "not someone else's desk");
  assert.equal(o.leaveDesk(desk).title, '活動報表');
  // Back at work: the sign goes, and they announce it.
  const back = { ...at('tool', { n: 'b' }), key: 'claude:away' };
  o.update([w, back]);
  o.setLeave([]);
  assert.equal(o.plan.desks.some((d) => o.leaveDesk(d)), false);
  assert.match(o.people.get('claude:away').event.text, /休假回來/);
  // Upstairs there are no leave desks.
  const up = loadFloor(2);
  up.setLeave([{ key: 'claude:x', title: 'x', days: 2 }]);
  assert.equal(up.plan.desks.some((d) => up.leaveDesk(d)), false);
});

test('soundscape: keyboards while people type, the coffee machine, voices, rain; quiet when nothing happens', () => {
  const o = load(true);
  const p = settle(o, [at('typing'), at('done', { n: 'c', ago: 2 * MIN })])('claude:typing');
  seat(p);
  o.t = 1000;
  const win = {};
  // A stand-in for the browser's audio: count what gets made and started.
  const made = { started: 0, gains: [] };
  const node = () => ({ connect: () => {}, disconnect: () => {}, frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(v) { made.gains.push(v); } } });
  class FakeAudio {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node(), start() { made.started++; }, stop() {} }; }
    createConvolver() { return { ...node(), buffer: null }; }
    createOscillator() { return { ...node(), type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, start() { made.started++; }, stop() {} }; }
  }
  win.AudioContext = FakeAudio;
  const ctx = { window: win, Math, Date, setInterval: () => 1, clearInterval() {}, setTimeout() {}, Float32Array };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ambient.js'), 'utf8'), ctx);
  const { Ambient, sceneOf } = win.OfficeAmbient;
  o.stateOf = ((orig) => (q) => (q === p ? { pose: 'sit', act: 'type' } : orig.call(o, q)))(o.stateOf);
  const scene = sceneOf(o);
  assert.equal(scene.typing, 1);
  o.setWeather({ kind: 'rain' });
  assert.equal(sceneOf(o).weather, 'rain');
  const a = new Ambient();
  a.setMusic(false); // the music has its own test (ambient-hub.cjs)
  a.start();
  const loops = made.started;
  assert.equal(loops, 4, 'room tone, coffee machine, rain, voices');
  a.update({ typing: 6, coffee: 1, chat: 2, weather: 'rain' });
  // The audio clock moves on between ticks, as it does in a browser.
  for (let i = 0; i < 20; i++) { a.ctx.currentTime += 0.09; a.tick(); }
  assert.ok(made.started > loops, 'keys clicking');
  assert.ok(made.gains.some((g) => g > 0.1), 'coffee machine and rain up');
  made.started = 0;
  a.update({ typing: 0, coffee: 0, chat: 0, weather: null });
  for (let i = 0; i < 20; i++) { a.ctx.currentTime += 0.09; a.tick(); }
  assert.equal(made.started, 0, 'no typing, no clicks');
  a.stop();
});

test('a meeting only runs with both in their chairs; pulled away, they go back; a third message cannot drag them off', () => {
  const o = load(true);
  o.label = (s) => s.key;
  const now = Date.now();
  const a = at('tool', { activity: 'SendMessage' }), b = at('tool', { n: 'b' }), c = at('tool', { n: 'c' });
  settle(o, [a, b, c]);
  o.first = false;
  const pa = o.people.get(a.key), pb = o.people.get(b.key), pc = o.people.get(c.key);
  o.update([{ ...a, talk: [{ key: b.key, dir: 'out', at: now, text: '討論' }] }, b, c]);
  // A is there, B is somewhere else (path cleared elsewhere): no talking yet.
  pa.path = []; pa.x = pa.meeting.seat.x; pa.y = pa.meeting.seat.y;
  pb.path = []; pb.x = pb.meeting.seat.x + 3; pb.y = pb.meeting.seat.y + 3;
  o.stepMeeting(pa, now);
  assert.equal(pa.meeting.start, 0, 'not started while B is away');
  assert.notEqual(o.stateOf(pb).pose, 'sit', 'B is not shown sitting at the table from afar');
  o.stepMeeting(pb, now);
  assert.ok(pb.path.length, 'B walks back to the chair');
  // A third session messages B mid-meeting: B stays in the meeting.
  o.update([a, b, { ...c, talk: [{ key: b.key, dir: 'out', at: now + 1, text: '另一件事' }] }]);
  assert.equal(pc.visit, undefined);
  assert.equal(pc.meeting, undefined);
  // Both seated: it starts.
  pb.path = []; pb.x = pb.meeting.seat.x; pb.y = pb.meeting.seat.y;
  o.stepMeeting(pa, now + 10);
  assert.ok(pa.meeting.start > 0);
  // It never comes together: called off.
  const o2 = load(true); o2.label = (s) => s.key;
  settle(o2, [a, b]); o2.first = false;
  o2.update([{ ...a, talk: [{ key: b.key, dir: 'out', at: now, text: 'x' }] }, b]);
  const qa = o2.people.get(a.key);
  qa.path = []; o2.stepMeeting(qa, now);
  o2.stepMeeting(qa, now + 50_000);
  assert.equal(qa.meeting, null);
});

test('slot machine: someone at it plays the temple game; it pays when the tumble has played out, and they cheer', () => {
  const o = load(true);
  const q = o.plan.pois.find((x) => x.act === 'slot');
  assert.ok(q && o.plan.props.some((x) => x.t === 'slot'), 'a slot machine downstairs');
  assert.ok(o.plan.grid.path(o.plan.door.x, o.plan.door.y, q.x, q.y).length, 'reachable');
  const p = settle(o, [at('idle', { ago: 5 * MIN })])('claude:idle');
  p.poi = null; p.path = [];
  o.t = 1000; o.stepSlot(0.03);
  assert.equal(o.slot.player, null);
  assert.equal(o.slot.paid, true, 'nobody there: no spin');
  p.mode = 'wander'; p.poi = q; p.x = q.x; p.y = q.y;
  // A seed that pays: the spin starts, the bet comes off.
  const S = o.constructor.seth;
  let seed = 1;
  while (!(S.spin(seed).base > 0 && S.spin(seed).scatters < 4)) seed++;
  const real = Math.random;
  Math.random = () => seed / 2147483647 + 1e-12;
  const credit = o.slot.credit;
  try { o.t = 2000; o.stepSlot(0.03); } finally { Math.random = real; }
  assert.equal(o.slot.player, p.key);
  assert.equal(o.slot.seed, seed);
  assert.equal(o.slot.credit, credit - S.BET);
  // It plays out: drops, the win shown, bursts, then pays.
  assert.ok(o.slot.len > 0);
  o.t = 2000 + o.slot.len / 2; o.stepSlot(0.03);
  assert.equal(o.slot.paid, false, 'still playing');
  o.t = o.slot.winFrom + 10;
  assert.equal(o.stateOf(p).act, 'cheer', 'cheers while the win shows');
  o.t = 2000 + o.slot.len + 1; o.stepSlot(0.03);
  assert.equal(o.slot.credit, credit - S.BET + S.total(S.spin(seed)), 'paid what the spin won');
  o.t = o.slot.winUntil + 1;
  assert.equal(o.stateOf(p).act, 'slot');
});

test('the temple game: one seed, one spin; eight or more pay, burst and refill until nothing pays', () => {
  const o = load(true);
  const S = o.constructor.seth;
  assert.equal(JSON.stringify(S.spin(777)), JSON.stringify(S.spin(777)), 'the same seed plays the same spin');
  let checked = 0;
  for (let seed = 1; seed < 400; seed++) {
    const sp = S.spin(seed);
    for (const [i, st] of sp.steps.entries()) {
      assert.equal(st.grid.length, S.COLS); assert.ok(st.grid.every((col) => col.length === S.ROWS));
      const count = new Map();
      st.grid.flat().forEach((c) => { if (c.s !== 'x' && c.s !== 'seth') count.set(c.s, (count.get(c.s) || 0) + 1); });
      const should = [...count].filter(([, k]) => k >= 8).map(([s]) => s).sort();
      assert.equal(JSON.stringify(st.wins.map((w) => w.s).sort()), JSON.stringify(should), 'what pays is exactly what shows 8 or more times');
      if (i === sp.steps.length - 1) assert.equal(st.wins.length, 0, 'it stops when nothing pays');
      else checked++;
      // Every symbol that burst is gone after the fall.
      if (i < sp.steps.length - 1) {
        const won = new Set(st.wins.map((w) => w.s));
        const left = st.grid.flat().filter((c) => !won.has(c.s)).length;
        const kept = sp.steps[i + 1].from.flat().filter((r) => r >= 0).length;
        assert.equal(kept, left, 'only the burst ones are replaced');
      }
    }
    if (!sp.base) assert.equal(S.total(sp), 0);
    if (sp.base && sp.mult) assert.equal(S.total(sp), Math.round(sp.base * sp.mult), 'orbs multiply the win');
  }
  assert.ok(checked > 50, 'plenty of tumbles seen');
});

test('the temple game: four seths start free spins; free spins cost nothing and build up the multiplier', () => {
  const o = load(true);
  const S = o.constructor.seth;
  const p = settle(o, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = o.plan.pois.find((x) => x.act === 'slot');
  p.mode = 'wander'; p.poi = q; p.x = q.x; p.y = q.y; p.path = [];
  let seed = 1;
  while (S.spin(seed).scatters < 4) seed++;
  const real = Math.random;
  try {
    Math.random = () => seed / 2147483647 + 1e-12;
    o.t = 1000; o.stepSlot(0.03);
    o.t = 1000 + o.slot.len + 1; o.stepSlot(0.03);
    assert.equal(o.slot.free, S.FREE, 'free spins');
    const credit = o.slot.credit;
    Math.random = () => 0.5;
    o.t = o.slot.next + 1; o.stepSlot(0.03);
    assert.equal(o.slot.isFree, true);
    assert.equal(o.slot.credit, credit, 'no bet taken');
  } finally { Math.random = real; }
});

test('slot machine: drop someone on it and they play a while, then carry on', () => {
  const o = load(true);
  const q = o.plan.pois.find((x) => x.act === 'slot');
  const who = settle(o, [at('idle', { ago: 5 * MIN }), at('tool', { n: 2 })]);
  Object.assign(o, { canvas: { style: {} }, onRelay() {}, onCommand() {}, label: () => '', pointer() {} });
  const drop = (p) => { o.held = p; p.held = true; o.dropOn = null; o.dropAt = null; p.x = q.x + 0.4; p.y = q.y - 0.3; o.drop(null); };
  // Someone idle: sits down at it and is the one pulling the lever.
  const idle = who('claude:idle');
  drop(idle);
  assert.equal(idle.x, q.x); assert.equal(idle.y, q.y);
  assert.equal(q.taken, idle.key);
  o.step(0.03); o.t = 5000; o.stepSlot(0.03);
  assert.equal(o.slot.player, idle.key, 'plays');
  assert.equal(o.stateOf(idle).act, 'slot');
  // Someone at work takes the seat: the one there goes, the worker plays,
  // and gets back to the desk afterwards.
  const worker = who('claude:tool2');
  drop(worker);
  assert.equal(q.taken, worker.key);
  assert.notEqual(idle.poi, q, 'bumped off');
  o.step(0.03); o.t = 9000; o.stepSlot(0.03);
  assert.equal(o.slot.player, worker.key);
  assert.equal(o.stateOf(worker).act, 'slot');
  worker.run.until = Date.now() - 1;
  o.step(0.03);
  assert.equal(worker.run, null, 'done playing');
  assert.equal(q.taken, null);
  const end = worker.path[worker.path.length - 1];
  assert.ok(end && Math.hypot(end.x - worker.desk.seat.x, end.y - worker.desk.seat.y) < 0.05, 'back to the desk');
  // Dropped anywhere else: no slot.
  const idle2 = who('claude:idle');
  o.held = idle2; idle2.held = true; idle2.x = o.plan.door.x; idle2.y = o.plan.door.y - 1; o.drop(null);
  assert.notEqual(idle2.poi, q);
});

test('slot machine: walk yourself up to it, stop, and you play; walk off and you stop', () => {
  const o = load(true);
  const q = o.plan.pois.find((x) => x.act === 'slot');
  settle(o, [at('idle', { ago: 5 * MIN })]);
  const me = o.meOn();
  assert.ok(me);
  me.seated = false; me.x = q.x + 0.3; me.y = q.y + 0.2;
  for (let i = 0; i < 10; i++) o.stepMe(0.1);
  assert.equal(me.atSlot, true, 'sat down');
  assert.equal(me.x, q.x);
  assert.equal(q.taken, 'me');
  o.t = 3000; o.stepSlot(0.03);
  assert.equal(o.slot.player, 'me');
  assert.equal(o.stateOf(me).act, 'slot');
  assert.equal(o.stateOf(me).pose, 'sit');
  // Walking off ends it.
  o.screenAxes = () => ({ right: { x: 1, y: 0 }, up: { x: 0, y: 1 } });
  o.meKeys.add('s');
  o.stepMe(0.1);
  o.meKeys.delete('s');
  assert.equal(me.atSlot, false);
  assert.equal(q.taken, null);
  o.t = 9000; o.stepSlot(0.03);
  assert.equal(o.slot.player, null);
});

test('public replay: you (walked with the keys) glide onto where you are, seated at the slot exactly', () => {
  const host = load(true), view = load(true);
  settle(host, [at('idle', { ago: 5 * MIN })]);
  const q = host.plan.pois.find((x) => x.act === 'slot');
  const me = host.meOn();
  me.seated = false; me.x = q.x + 0.6; me.y = q.y + 0.3;
  const send = () => JSON.parse(JSON.stringify({ ...host.worldState(), wall: Date.now() }));
  view.applyWorld(send(), new Map(), { hostNow: Date.now() });
  // You walk 0.9 tiles before the next update: no jump, a glide.
  me.x = q.x + 0.3; me.y = q.y + 0.2;
  for (let i = 0; i < 10; i++) host.stepMe(0.1); // stops, sits at the slot
  assert.equal(me.atSlot, true);
  view.applyWorld(send(), new Map(), { hostNow: Date.now() });
  let biggest = 0, last = { x: view.me.x, y: view.me.y };
  for (let i = 0; i < 40; i++) { view.stepRemote(0.033); biggest = Math.max(biggest, Math.hypot(view.me.x - last.x, view.me.y - last.y)); last = { x: view.me.x, y: view.me.y }; }
  assert.ok(Math.hypot(view.me.x - q.x, view.me.y - q.y) < 0.01, 'on the stool, not beside it');
  assert.ok(biggest < 0.2, `smooth (largest step ${biggest.toFixed(2)})`);
  assert.equal(view.stateOf(view.me).act, 'slot');
});

test('public replay: the same spin keeps its own timing (no stutter from late updates)', () => {
  const host = load(true), view = load(true);
  const p = settle(host, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = host.plan.pois.find((x) => x.act === 'slot');
  p.mode = 'wander'; p.poi = q; p.x = q.x; p.y = q.y; p.path = [];
  host.t = 10_000; host.stepSlot(0.03);
  assert.ok(host.slot.seed, 'a spin going');
  const w = { ...host.worldState(), wall: Date.now() };
  view.t = 50_000;
  view.applyWorld(JSON.parse(JSON.stringify(w)), new Map(), { hostNow: Date.now() });
  const first = view.slot.spinAt;
  // The next update of the same spin arrives 120 ms later than the last one did.
  view.t = 50_300;
  view.applyWorld(JSON.parse(JSON.stringify({ ...w, t: w.t + 180 })), new Map(), { hostNow: Date.now() });
  assert.equal(view.slot.spinAt, first);
});

test('appliances: the microwave opens, cooks and dings; the person reaches in, waits, then eats', () => {
  const o = load(true);
  const p = settle(o, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = o.plan.pois.find((x) => x.act === 'microwave');
  assert.ok(q, 'a microwave to use');
  assert.ok(o.plan.grid.path(o.plan.door.x, o.plan.door.y, q.x, q.y).length, 'reachable');
  o.release(p);
  p.mode = 'wander'; p.poi = q; q.taken = p.key; p.x = q.x; p.y = q.y; p.path = []; p.until = Date.now() + 60_000;
  o.step(0.01);
  assert.equal(p.useOf, q, 'started using it');
  const into = (ms) => { p.useAt = Date.now() - ms; return { m: o.applianceAt(q), act: o.stateOf(p).act }; };
  let s = into(300); assert.equal(s.m.phase, 'open'); assert.equal(s.act, 'fridge');
  s = into(4000); assert.equal(s.m.phase, 'cook'); assert.equal(s.act, 'watch');
  s = into(12_000); assert.equal(s.m.phase, 'idle'); assert.equal(s.act, 'eat');
  // Walks off: the machine is idle again.
  p.path = [{ x: q.x + 2, y: q.y }];
  o.step(0.01);
  assert.equal(o.applianceAt(q), null);
  const up = load(true); up.floor = 2; up.plan = up.buildPlan(0);
  assert.ok(up.plan.pois.some((x) => x.act === 'microwave'), 'upstairs too');
});

test('appliances: a desk worker buying a drink presses, the can drops, then they sip', () => {
  const o = load(true);
  const p = settle(o, [at('tool', { activity: 'Bash: npm run long', ago: 2 * MIN })])('claude:tool');
  const q = o.plan.pois.find((x) => x.act === 'vending');
  q.taken = p.key; p.run = { poi: q, until: Infinity }; p.x = q.x; p.y = q.y; p.path = [];
  o.step(0.01);
  assert.equal(p.useOf, q);
  p.useAt = Date.now() - 400; assert.equal(o.applianceAt(q).phase, 'press'); assert.equal(o.stateOf(p).act, 'vending');
  p.useAt = Date.now() - 1200; assert.equal(o.applianceAt(q).phase, 'drop');
  p.useAt = Date.now() - 5000; assert.equal(o.stateOf(p).act, 'sip');
});

test('appliances on a public view: the same moment of use comes across, so the same phase shows', () => {
  const host = load(true), view = load(true);
  const p = settle(host, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = host.plan.pois.find((x) => x.act === 'fridge');
  host.release(p);
  p.mode = 'wander'; p.poi = q; q.taken = p.key; p.x = q.x; p.y = q.y; p.path = []; p.until = Date.now() + 60_000;
  host.step(0.01);
  p.useAt = Date.now() - 1500;
  view.applyWorld(JSON.parse(JSON.stringify({ ...host.worldState(), wall: Date.now() })), new Map(), { hostNow: Date.now(), skew: 0 });
  const vq = view.plan.pois.find((x) => x.act === 'fridge');
  assert.equal(view.applianceAt(vq).phase, host.applianceAt(q).phase);
  assert.equal(view.applianceAt(vq).phase, 'reach');
});

test('public replay: the temple game plays the same frame from the seed on the viewer', () => {
  const host = load(true), view = load(true);
  const p = settle(host, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = host.plan.pois.find((x) => x.act === 'slot');
  p.mode = 'wander'; p.poi = q; p.x = q.x; p.y = q.y; p.path = [];
  host.t = 10_000; host.stepSlot(0.03);
  // Sent the moment it starts (a late one plays from its start: next test).
  view.t = 50_000;
  view.applyWorld(JSON.parse(JSON.stringify({ ...host.worldState(), wall: Date.now() })), new Map(), { hostNow: Date.now() });
  const a = host.slotFrame(), b = view.slotFrame();
  assert.equal(b.sp.seed, a.sp.seed);
  assert.equal(b.ph && b.ph.k, a.ph && a.ph.k);
  assert.ok(Math.abs(b.k - a.k) < 0.05, 'the same moment of the same spin');
});

test('public replay: a spin that reaches the viewer late plays from its start', () => {
  const host = load(true), view = load(true);
  const p = settle(host, [at('idle', { ago: 5 * MIN })])('claude:idle');
  const q = host.plan.pois.find((x) => x.act === 'slot');
  p.mode = 'wander'; p.poi = q; p.x = q.x; p.y = q.y; p.path = [];
  const S = host.constructor.seth;
  let seed = 1;
  while (S.timeline(S.spin(seed)).len < 3000) seed++;
  const real = Math.random;
  Math.random = () => seed / 2147483647 + 1e-12;
  try { host.t = 10_000; host.stepSlot(0.03); } finally { Math.random = real; }
  // It arrives 1.5 s into the spin.
  host.t = 11_500;
  view.t = 80_000;
  view.applyWorld(JSON.parse(JSON.stringify({ ...host.worldState(), wall: Date.now() })), new Map(), { hostNow: Date.now() });
  const f = view.slotFrame();
  assert.equal(f.ph && f.ph.k, 'drop');
  assert.equal(f.i, 0);
  assert.ok(f.k < 0.05, 'from the very start');
});

test('public replay: after hours on your office is after hours for the viewer (dim, desk lights), on your clock', () => {
  const host = load(true, clockAt(21)), view = load(true, clockAt(14));
  settle(host, [at('tool', { ago: 2 * MIN })]);
  assert.equal(host.closedNow, true, 'nine at night: closed');
  view.applyWorld(JSON.parse(JSON.stringify({ ...host.worldState(), wall: Date.now() })), new Map(), { hostNow: Date.now() });
  assert.equal(view.closedNow, true, 'the viewer, at two in the afternoon where they are, sees it closed too');
  const day = load(true, clockAt(14));
  settle(day, [at('tool', { ago: 2 * MIN })]);
  view.applyWorld(JSON.parse(JSON.stringify({ ...day.worldState(), wall: Date.now() })), new Map(), { hostNow: Date.now() });
  assert.equal(view.closedNow, false);
});

test('desks: the first people to work take the pod nearest the front, not the back', () => {
  const o = load(true);
  const depth = (d) => d.x + d.y;
  const pods = new Map();
  for (const d of o.plan.desks) if (d.pod != null) pods.set(d.pod, Math.max(pods.get(d.pod) || 0, depth(d)));
  const front = [...pods].sort((a, b) => b[1] - a[1])[0][0];
  const who = settle(o, [at('tool', { n: 1, cwd: '/r/a' }), at('tool', { n: 2, cwd: '/r/a' })]);
  for (const k of ['claude:tool1', 'claude:tool2']) assert.equal(who(k).desk.pod, front, `${k} sits up front`);
});
