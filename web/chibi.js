// The office's people, made here (no imported models): chibi figures — a big
// round head on a small body — with real joints (shoulders, elbows, hips,
// knees, neck), a face drawn on a texture that changes with their mood, and
// every move computed in code: walking, sitting, typing, waving, laughing…
// Poses blend smoothly into each other, so nobody snaps from one to the next.
//
// makeChibi(look) builds one; animateChibi(rig, state, t, dt) moves it.
// The figure stands with its feet at the origin facing +z; sitting puts the
// seat of the trousers at the origin (the caller lifts it onto the chair).
import * as THREE from 'three';

const H = { hip: 0.3, thigh: 0.15, shin: 0.13, torso: 0.26, head: 0.2, upper: 0.12, fore: 0.1 };

// Three-tone shading, the cartoon look.
let toonRamp = null;
function ramp() {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: ramp() });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x2b2420, side: THREE.BackSide });

// A part with a dark outline (the same shape, a little bigger, inside out).
function part(geo, mat, outline = 1.06) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  g.add(m);
  if (outline) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(outline);
    g.add(o);
  }
  g.userData.mesh = m;
  return g;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

// ---- the face: eyes, brows, mouth and cheeks on a canvas -------------------

function drawFace(c, expr, blink, mouth, look) {
  c.clearRect(0, 0, 256, 256);
  const ink = '#2b2420', eyeY = 120, ex = [86, 170];
  c.lineCap = 'round'; c.lineJoin = 'round';
  const closed = (y = eyeY, up = true) => { c.strokeStyle = ink; c.lineWidth = 9; for (const x of ex) { c.beginPath(); c.arc(x, y + (up ? 8 : -6), 15, up ? Math.PI * 1.15 : Math.PI * 0.15, up ? Math.PI * 1.85 : Math.PI * 0.85); c.stroke(); } };
  const eyes = (r = 17, dx = 0, dy = 0, squash = 1) => {
    for (const x of ex) {
      c.fillStyle = ink; c.beginPath(); c.ellipse(x + dx, eyeY + dy, r * 0.8, r * squash, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x + dx + r * 0.25, eyeY + dy - r * 0.35 * squash, r * 0.28, 0, Math.PI * 2); c.fill();
    }
  };
  const brows = (tilt = 0, y = 84) => { c.strokeStyle = ink; c.lineWidth = 6; for (const [i, x] of ex.entries()) { const s = i ? -1 : 1; c.beginPath(); c.moveTo(x - 15, y + tilt * s); c.lineTo(x + 15, y - tilt * s); c.stroke(); } };
  // eyes
  const sleepy = expr === 'sleep' || expr === 'yawn';
  if (sleepy || expr === 'happy' || expr === 'laugh') closed(eyeY, expr === 'happy' || expr === 'laugh');
  else if (blink) { c.strokeStyle = ink; c.lineWidth = 8; for (const x of ex) { c.beginPath(); c.moveTo(x - 14, eyeY); c.lineTo(x + 14, eyeY); c.stroke(); } }
  else if (expr === 'surprised') eyes(20, 0, 0, 1.15);
  else if (expr === 'dizzy') { c.strokeStyle = ink; c.lineWidth = 5; for (const x of ex) { c.beginPath(); for (let a = 0; a < 12; a += 0.4) c.lineTo(x + Math.cos(a) * a * 1.4, eyeY + Math.sin(a) * a * 1.4); c.stroke(); } }
  else if (expr === 'sleepy' || expr === 'bored') eyes(15, 0, 4, 0.55);
  else if (expr === 'focus') eyes(15, 0, 3, 0.8);
  else if (expr === 'think') eyes(15, 8, -8);
  else if (expr === 'look') eyes(16, look * 10, 0);
  else eyes(16, look * 6, 0);
  // brows
  if (expr === 'sad' || expr === 'worried') brows(-7, 82);
  else if (expr === 'focus') brows(5, 90);
  else if (expr === 'surprised') brows(0, 72);
  else if (expr === 'think' || expr === 'puzzled') { brows(expr === 'puzzled' ? 6 : 0, 84); }
  // cheeks
  c.fillStyle = 'rgba(255,120,120,.35)';
  for (const x of [62, 194]) { c.beginPath(); c.ellipse(x, 158, 18, 11, 0, 0, Math.PI * 2); c.fill(); }
  // mouth
  c.strokeStyle = ink; c.fillStyle = '#7a2e2a'; c.lineWidth = 7;
  const my = 175;
  if (expr === 'laugh') { c.beginPath(); c.moveTo(103, my - 6); c.quadraticCurveTo(128, my + 40, 153, my - 6); c.closePath(); c.fill(); c.fillStyle = '#ff8a8a'; c.beginPath(); c.ellipse(128, my + 14, 12, 7, 0, 0, Math.PI * 2); c.fill(); }
  else if (expr === 'yawn' || expr === 'surprised') { c.beginPath(); c.ellipse(128, my + 6, expr === 'yawn' ? 16 : 11, expr === 'yawn' ? 22 : 14, 0, 0, Math.PI * 2); c.fill(); }
  else if (expr === 'talk' || expr === 'eat') { const o = mouth; c.beginPath(); c.ellipse(128, my + 2, 14, 3 + o * 11, 0, 0, Math.PI * 2); c.fill(); }
  else if (expr === 'sad' || expr === 'worried') { c.beginPath(); c.arc(128, my + 18, 16, Math.PI * 1.2, Math.PI * 1.8); c.stroke(); }
  else if (expr === 'happy' || expr === 'smile') { c.beginPath(); c.arc(128, my - 8, 20, Math.PI * 0.18, Math.PI * 0.82); c.stroke(); }
  else if (expr === 'think' || expr === 'puzzled' || expr === 'bored') { c.beginPath(); c.moveTo(114, my + 2); c.lineTo(142, my - 2); c.stroke(); }
  else if (expr === 'sleep') { c.beginPath(); c.ellipse(128, my + 2, 7, 5, 0, 0, Math.PI * 2); c.fill(); }
  else { c.beginPath(); c.arc(128, my - 2, 12, Math.PI * 0.2, Math.PI * 0.8); c.stroke(); }
}

// ---- building one ----------------------------------------------------------

const hexOf = (c) => (typeof c === 'string' ? new THREE.Color(c) : new THREE.Color(c || 0x888888));

// look: { skin, hair, shirt, pants, hairStyle (0-4), shoe }
export function makeChibi(look = {}) {
  const skin = toon(hexOf(look.skin || '#f3cfb0'));
  const hair = toon(hexOf(look.hair || '#3a2a20'));
  const shirt = toon(hexOf(look.shirt || '#c96442'));
  const sleeve = toon(hexOf(look.shirt || '#c96442').multiplyScalar(0.92));
  const pants = toon(hexOf(look.pants || '#34405a'));
  const shoe = toon(hexOf(look.shoe || '#2a2a2e'));

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = H.hip;
  root.add(hips);
  const pelvis = part(new THREE.SphereGeometry(0.105, 14, 10), pants);
  pelvis.scale.set(1, 0.6, 0.85);
  hips.add(pelvis);

  // legs
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.058, -0.02, 0);
    const thigh = part(capsule(0.05, H.thigh - 0.06), pants);
    thigh.position.y = -H.thigh / 2;
    const knee = new THREE.Group();
    knee.position.y = -H.thigh;
    const shin = part(capsule(0.045, H.shin - 0.06), pants);
    shin.position.y = -H.shin / 2;
    const foot = part(new THREE.SphereGeometry(0.055, 12, 8), shoe);
    foot.scale.set(0.95, 0.55, 1.45);
    foot.position.set(0, -H.shin + 0.005, 0.03);
    knee.add(shin, foot);
    hip.add(thigh, knee);
    hips.add(hip);
    return { hip, knee };
  };
  const legR = leg(-1), legL = leg(1);

  // body
  const torso = new THREE.Group();
  hips.add(torso);
  const body = part(capsule(0.11, 0.1), shirt);
  body.scale.set(1.05, 1, 0.82);
  body.position.y = 0.13;
  torso.add(body);
  const front = new THREE.Group(); // things worn on the chest
  front.position.set(0, 0.16, 0.095);
  torso.add(front);

  // arms
  const arm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.125, 0.215, 0);
    const upper = part(capsule(0.038, H.upper - 0.05), sleeve);
    upper.position.y = -H.upper / 2;
    const elbow = new THREE.Group();
    elbow.position.y = -H.upper;
    const fore = part(capsule(0.034, H.fore - 0.05), skin);
    fore.position.y = -H.fore / 2;
    const hand = new THREE.Group();
    hand.position.y = -H.fore - 0.01;
    const mitt = part(new THREE.SphereGeometry(0.042, 12, 8), skin);
    hand.add(mitt);
    elbow.add(fore, hand);
    sh.add(upper, elbow);
    torso.add(sh);
    return { sh, elbow, hand };
  };
  const armR = arm(-1), armL = arm(1);

  // head
  const neck = new THREE.Group();
  neck.position.y = H.torso;
  torso.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  const skull = part(new THREE.SphereGeometry(H.head, 24, 18), skin, 1.04);
  skull.scale.set(1.04, 0.95, 0.96);
  skull.position.y = H.head * 0.95;
  head.add(skull);
  // ears
  for (const s of [-1, 1]) {
    const ear = part(new THREE.SphereGeometry(0.04, 10, 8), skin, 1.08);
    ear.scale.set(0.6, 1, 0.8);
    ear.position.set(s * H.head * 1.02, H.head * 0.9, 0);
    head.add(ear);
  }
  // face (drawn on a canvas, mapped onto the front of the head)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const faceTex = new THREE.CanvasTexture(cv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(H.head * 1.005, 24, 18, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.28, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }),
  );
  face.scale.copy(skull.scale);
  face.position.copy(skull.position);
  face.renderOrder = 2;
  head.add(face);
  // hair
  const style = (look.hairStyle ?? 0) % 5;
  const cap = part(new THREE.SphereGeometry(H.head * 1.06, 22, 14, 0, Math.PI * 2, 0, Math.PI * (style === 1 ? 0.62 : 0.5)), hair, 1.03);
  cap.position.y = H.head * 0.98;
  cap.rotation.x = -0.55; // front edge up off the forehead, back edge down the nape
  head.add(cap);
  const bangs = part(new THREE.SphereGeometry(H.head * 1.02, 16, 8, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.22, Math.PI * 0.14), hair, 0);
  bangs.position.y = H.head * 0.98;
  head.add(bangs);
  if (style === 1) { // bob: hair down the sides and back
    const back = part(new THREE.SphereGeometry(H.head * 1.08, 18, 12, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.35, Math.PI * 0.35), hair, 1.03);
    back.position.y = H.head * 0.95; back.scale.set(1, 1, 0.95);
    head.add(back);
  } else if (style === 2) { // bun on top
    const bun = part(new THREE.SphereGeometry(0.075, 14, 10), hair);
    bun.position.set(0, H.head * 2.02, -0.04);
    head.add(bun);
  } else if (style === 3) { // spikes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = part(new THREE.ConeGeometry(0.05, 0.11, 6), hair, 0);
      sp.position.set(Math.cos(a) * 0.11, H.head * 1.78, Math.sin(a) * 0.11 - 0.02);
      sp.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      head.add(sp);
    }
  } else if (style === 4) { // ponytail
    const tail = part(capsule(0.045, 0.14), hair);
    tail.position.set(0, H.head * 1.2, -H.head * 1.0);
    tail.rotation.x = 0.5;
    head.add(tail);
  }

  // things they can hold or wear
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
  const held = {
    cup: new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 12), mat(0xffffff)),
    book: new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), mat(0xc96442)),
    phone: new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.01), mat(0x1d1f24, { emissive: 0x2a4f88, emissiveIntensity: 0.5 })),
    pad: new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.025), mat(0x2c3e50)),
    paddle: new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), mat(0xc0392b)),
    can: new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 10), mat(0x4f9ad8)),
  };
  held.cup.position.set(0, -0.03, 0.03);
  held.book.position.set(-0.04, -0.03, 0.05); held.book.rotation.set(-0.5, 0, 0);
  held.phone.position.set(0, -0.02, 0.04); held.phone.rotation.x = -0.6;
  held.pad.position.set(-0.04, -0.02, 0.05); held.pad.rotation.x = -0.6;
  held.paddle.position.set(0, -0.07, 0.02); held.paddle.rotation.x = Math.PI / 2;
  held.can.position.set(0, -0.03, 0.04);
  for (const m of Object.values(held)) { m.visible = false; m.castShadow = true; armR.hand.add(m); }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.18), mat(0xc8a06a));
  box.position.set(0, -0.06, 0.13);
  box.visible = false;
  front.add(box);
  // level outfits: lanyard (2+), headphones (3, 4), tie (4+), crown (5)
  const lanyard = new THREE.Group();
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 18, Math.PI), mat(0x3b8ee0));
  strap.rotation.z = Math.PI; strap.position.y = 0.06;
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 0.01), mat(0xfafafa));
  card.position.y = -0.02;
  lanyard.add(strap, card);
  front.add(lanyard);
  const tie = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.13, 4), mat(0xb03a2e));
  tie.rotation.x = Math.PI; tie.position.set(0, 0, 0.006);
  front.add(tie);
  const phones = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(H.head * 1.1, 0.012, 6, 20, Math.PI), mat(0xe2e2e6, { metalness: 0.3 }));
  band.position.y = H.head * 0.95;
  phones.add(band);
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 14), mat(0x3a3a44)); ear.rotation.z = Math.PI / 2; ear.position.set(s * H.head * 1.1, H.head * 0.95, 0); phones.add(ear); }
  head.add(phones);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.07, 8, 1, true), mat(0xf2c230, { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
  crown.position.y = H.head * 2.02;
  head.add(crown);
  for (const o of [lanyard, tie, phones, crown]) o.visible = false;
  // the "waiting on you" sign, held up over the head
  const sign = new THREE.Group();
  sign.position.set(0, H.torso + H.head * 2 + 0.12, 0.04);
  sign.visible = false;
  torso.add(sign);

  const joints = {
    hips, torso, neck, shR: armR.sh, elR: armR.elbow, shL: armL.sh, elL: armL.elbow,
    hipR: legR.hip, knR: legR.knee, hipL: legL.hip, knL: legL.knee,
  };
  const rig = {
    root, joints, head, held, box, sign, cv, faceTex, front,
    outfit: { lanyard, tie, phones, crown },
    cur: null, faceKey: '', blinkAt: 0, level: 0,
  };
  setFace(rig, 'neutral', false, 0, 0);
  return rig;
}

function setFace(rig, expr, blink, mouth, look) {
  const key = `${expr}|${blink ? 1 : 0}|${Math.round(mouth * 3)}|${Math.round(look * 2)}`;
  if (key === rig.faceKey) return;
  rig.faceKey = key;
  drawFace(rig.cv.getContext('2d'), expr, blink, mouth, look);
  rig.faceTex.needsUpdate = true;
}

// Lanyard, headphones, tie, crown as their level goes up.
export function dressChibi(rig, level) {
  if (rig.level === level) return;
  rig.level = level;
  const o = rig.outfit;
  o.lanyard.visible = level >= 2 && level < 4;
  o.tie.visible = level >= 4;
  o.phones.visible = level === 3 || level === 4;
  o.crown.visible = level >= 5;
}

// ---- moving one ------------------------------------------------------------

const S = Math.sin;
const up = (x) => Math.max(0, Math.sin(x));
const PI = Math.PI;

// Arm: [shoulder forward(-)/back(+), shoulder in(+)/out(-), elbow bend (-)].
// Leg: [hip forward(-)/back(+), knee bend (+)]. Head: [down(+), turn, tilt].
// The left arm's sideways angle is mirrored for you (give the right one).
const REST = { R: [0.08, -0.12, -0.18], L: [0.08, -0.12, -0.18] };

// Upper-body moves by what they are doing (t: seconds, own phase added).
function act(name, t) {
  switch (name) {
    case 'type': return { R: [-0.95, 0.38, -1.0 + 0.14 * S(t * 17)], L: [-0.95, 0.38, -1.0 + 0.14 * S(t * 17 + PI)], head: [0.14, 0.05 * S(t * 0.6), 0], lean: 0.08, face: 'focus' };
    case 'typefast': case 'station': return { R: [-0.98, 0.38, -1.0 + 0.2 * S(t * 26)], L: [-0.98, 0.38, -1.0 + 0.2 * S(t * 26 + PI)], head: [0.18, 0, 0], lean: 0.12, face: 'focus' };
    case 'deskread': return { R: [-0.9, 0.15, -0.9 + 0.05 * S(t * 2.2)], L: [-0.6, 0.25, -0.8], head: [0.06, 0.18 * S(t * 0.5), 0], face: 'neutral' };
    case 'write': return { R: [-0.8, 0.3, -1.1 + 0.12 * S(t * 9)], L: [-0.6, 0.3, -0.8], head: [0.32, 0, 0], lean: 0.1, face: 'focus' };
    case 'think': case 'chin': return { R: [-1.15, 0.5, -2.0], L: [-0.55, 0.55, -1.3], head: [-0.06, 0.12 * S(t * 0.4), 0.1], face: 'think' };
    case 'scratch': return { R: [-2.7, 0.35, -1.4 + 0.25 * S(t * 9)], head: [0.06, 0, -0.12], face: 'puzzled' };
    case 'lookup': return { R: [-0.5, 0.2, -0.8], L: [-0.5, 0.2, -0.8], head: [-0.32, 0.25 * S(t * 0.5), 0], face: 'think' };
    case 'leanback': return { R: [-2.55, -0.55, -2.3], L: [-2.55, -0.55, -2.3], lean: -0.16, head: [-0.12, 0.1 * S(t * 0.3), 0], face: 'neutral' };
    case 'point': return { R: [-1.45, -0.35, -0.1], head: [0, -0.3, 0], face: 'talk' };
    case 'stretch': return { R: [-3.0, 0.15, -0.25], L: [-3.0, 0.15, -0.25], lean: -0.12, head: [-0.28, 0, 0], face: 'happy' };
    case 'neck': return { R: [-2.3, 0.6, -2.0], head: [0.2 * S(t * 1.5), 0, 0.32 * S(t * 1.5)], face: 'sleepy' };
    case 'sip': case 'coffee': case 'water': {
      const drink = S(t * 0.9) > 0.55;
      return { R: drink ? [-1.6, 0.55, -2.15] : [-0.65, 0.35, -1.25], head: drink ? [-0.18, 0, 0] : [0.05, 0, 0], face: drink ? 'happy' : 'smile', hold: 'cup' };
    }
    case 'eat': return { R: [-0.95 - 0.6 * up(t * 3), 0.45, -1.7], L: [-0.6, 0.2, -0.9], face: 'eat', hold: null };
    case 'phone': return { R: [-1.1, 0.65, -2.4], head: [0, 0, 0.18], face: 'talk', hold: 'phone' };
    case 'scroll': return { R: [-0.95, 0.45, -1.25], L: [-0.95, 0.45, -1.25], head: [0.38, 0, 0], face: 'smile', hold: 'phone' };
    case 'laptop': return { R: [-0.65, 0.35, -0.75 + 0.12 * S(t * 16)], L: [-0.65, 0.35, -0.75 + 0.12 * S(t * 16 + PI)], head: [0.32, 0, 0], face: 'focus' };
    case 'read': case 'clipboard': return { R: [-0.95, 0.45, -1.35], L: [-0.95, 0.45, -1.35], head: [0.3, 0.05 * S(t * 0.5), 0], face: 'neutral', hold: 'book' };
    case 'game': return { R: [-0.95, 0.5, -1.3 + 0.1 * S(t * 12)], L: [-0.95, 0.5, -1.3 + 0.1 * S(t * 11)], head: [0.3, 0, 0], face: 'focus', hold: 'pad' };
    case 'laugh': return { R: [-0.55, 0.45, -1.3], L: [-0.55, 0.45, -1.3], lean: -0.14 + 0.08 * Math.abs(S(t * 8)), head: [-0.3, 0, 0.06 * S(t * 8)], face: 'laugh' };
    case 'chat': case 'meeting-talk': return { R: [-0.55 - 0.45 * up(t * 4), 0.2 + 0.18 * S(t * 3), -0.95 - 0.35 * up(t * 5)], L: [-0.25, 0.15, -0.55], head: [0.06 * S(t * 5), 0.16 * S(t * 1.3), 0], face: 'talk' };
    case 'watch': case 'tv': return { R: [-0.45, 0.25, -0.95], L: [-0.45, 0.25, -0.95], lean: -0.12, head: [-0.1, 0, 0], face: 'smile' };
    case 'cheer': return { R: [-3.0 + 0.2 * S(t * 9), -0.3, -0.25], L: [-3.0 + 0.2 * S(t * 9 + 1), -0.3, -0.25], bounce: 0.05 * Math.abs(S(t * 9)), face: 'happy' };
    case 'facepalm': return { R: [-1.35, 0.65, -2.3], head: [0.32, 0, 0], lean: 0.1, face: 'sad' };
    case 'wave': return { R: [-2.6, -0.45 + 0.4 * S(t * 10), -0.55], head: [0, 0, 0.1], face: 'smile' };
    case 'dazed': return { head: [0.1 * S(t * 7), 0, 0.28 * S(t * 5)], lean: 0.06 * S(t * 5), R: [-0.3, -0.5, -0.4], L: [-0.3, -0.5, -0.4], face: 'dizzy' };
    case 'yawn': return { R: [-1.45, 0.55, -2.1], head: [-0.32, 0, 0], face: 'yawn' };
    case 'nap': return { head: [0.62, 0, 0.12], lean: 0.22, R: [-0.35, 0.25, -0.7], L: [-0.35, 0.25, -0.7], face: 'sleep' };
    case 'knock': return { R: [-1.45, 0.1, -0.8 + 0.45 * up(t * 9)], face: 'worried' };
    case 'sign': return { R: [-2.95, 0.12, -0.35], L: [-2.95, 0.12, -0.35], bounce: 0.02 * Math.abs(S(t * 3)), face: 'worried', sign: true };
    case 'carry': case 'deliver': return { R: [-0.95, 0.38, -0.95], L: [-0.95, 0.38, -0.95], face: 'focus', box: true };
    case 'unpack': return { R: [-0.95, 0.38, -0.95 + 0.15 * S(t * 5)], L: [-0.95, 0.38, -0.95 + 0.15 * S(t * 5 + 1)], face: 'smile', box: true };
    case 'fix': return { R: [-1.15 + 0.18 * S(t * 16), 0.25, -0.6], L: [-1.15 + 0.18 * S(t * 16 + 2), 0.25, -0.6], lean: 0.28, face: 'focus' };
    case 'refill': return { R: [-2.0, 0.3, -0.8], L: [-1.0, 0.3, -0.9], face: 'neutral' };
    case 'waterplant': return { R: [-1.1, -0.3, -0.4], lean: 0.12, head: [0.22, 0, 0], face: 'smile', hold: 'can' };
    case 'pin': return { R: [-2.65, 0.2, -0.45], face: 'smile' };
    case 'whiteboard': return { R: [-2.1 + 0.28 * S(t * 3), 0.12 * S(t * 2), -0.6], face: 'focus' };
    case 'printer': return { R: [-0.95, 0.3, -1.0], L: [-0.95, 0.3, -1.0], lean: 0.16, face: 'neutral' };
    case 'peek': return { R: [-2.45, 0.6, -2.25], head: [-0.1, 0.45 * S(t * 0.8), 0], face: 'look', look: S(t * 0.8) };
    case 'tap': return { R: [-0.7, 0.3, -0.95 + 0.16 * up(t * 14)], L: [-0.6, 0.3, -0.9], face: 'bored' };
    case 'lookaround': return { head: [0, 0.5 * S(t * 0.9), 0], face: 'look', look: S(t * 0.9) };
    case 'meeting': return { R: [-0.65, 0.35, -0.95], L: [-0.65, 0.35, -0.95], head: [0.08, 0.1 * S(t * 0.6), 0], face: 'neutral' };
    case 'yoga': return { R: [-0.1, -1.5 + 0.2 * S(t * 0.8), 0], L: [-0.1, -1.5 + 0.2 * S(t * 0.8), 0], head: [-0.05, 0, 0], face: 'sleep' };
    case 'pingpong': return { R: [-1.0 + 0.65 * S(t * 7), -0.25, -0.8], twist: 0.25 * S(t * 7), face: 'happy', hold: 'paddle' };
    case 'foosball': return { R: [-0.95 + 0.22 * S(t * 16), 0.2, -0.9], L: [-0.95 + 0.22 * S(t * 15), 0.2, -0.9], lean: 0.26, face: 'focus' };
    case 'arcade': return { R: [-1.05, 0.3, -1.0 + 0.22 * S(t * 14)], L: [-1.05, 0.3, -1.0 + 0.22 * S(t * 11)], face: 'focus' };
    case 'vending': case 'fridge': case 'sink': return { R: [-1.35, 0.2, -0.6 + 0.2 * S(t * 4)], face: 'neutral' };
    case 'trophy': return { head: [-0.18, 0, 0], face: 'happy' };
    case 'petcat': return { R: [-0.6, 0.2, -0.4 + 0.2 * S(t * 4)], lean: 0.4, head: [0.3, 0, 0], face: 'happy' };
    case 'held': return { R: [-2.4 + 0.6 * S(t * 13), -0.65, -0.4], L: [-2.4 + 0.6 * S(t * 13 + PI), -0.65, -0.4], face: 'surprised', kick: true };
    default: return {};
  }
}

// Target pose for a state; walking and running get their stride here.
function target(st, t, speed) {
  const p = { hipY: H.hip, lean: 0, twist: 0, bounce: 0, head: [0, 0, 0], R: REST.R, L: REST.L, legR: [0, 0], legL: [0, 0], face: 'neutral', look: 0 };
  const breathe = 0.015 * S(t * 1.6);
  if (st.pose === 'walk' || st.act === 'run') {
    const run = st.act === 'run' || speed > 3;
    const f = run ? 15 : 10, a = run ? 0.85 : 0.55;
    const s = S(t * f);
    p.legR = [-a * s, Math.max(0, a * s) * 1.1 + 0.1];
    p.legL = [a * s, Math.max(0, -a * s) * 1.1 + 0.1];
    p.R = [a * 0.8 * s, -0.12, run ? -1.4 : -0.35];
    p.L = [-a * 0.8 * s, -0.12, run ? -1.4 : -0.35];
    p.bounce = Math.abs(S(t * f)) * (run ? 0.035 : 0.02);
    p.lean = run ? 0.2 : 0.05;
    p.twist = 0.08 * s;
    p.face = run ? 'focus' : 'neutral';
    if (st.act === 'carry') Object.assign(p, { R: [-0.95, 0.38, -0.95], L: [-0.95, 0.38, -0.95], box: true });
    if (st.act === 'run' && st.pose !== 'walk') p.face = 'focus';
    return p;
  }
  if (st.pose === 'sit') {
    p.hipY = 0.035;
    p.legR = [-1.5, 1.45 + 0.05 * S(t * 0.7)];
    p.legL = [-1.5, 1.45 + 0.05 * S(t * 0.7 + 1)];
    p.lean = 0.04;
    p.R = [-0.45, 0.2, -0.9];
    p.L = [-0.45, 0.2, -0.9];
  } else {
    p.lean = breathe * 0.5;
    p.twist = 0.03 * S(t * 0.37); // shifting weight
  }
  const a = act(st.act, t);
  if (a.R) p.R = a.R;
  if (a.L) p.L = a.L;
  if (a.head) p.head = a.head;
  if (a.lean != null) p.lean += a.lean;
  if (a.twist) p.twist += a.twist;
  if (a.bounce) p.bounce += a.bounce;
  if (a.face) p.face = a.face;
  if (a.look != null) p.look = a.look;
  p.hold = a.hold || null;
  p.box = !!a.box;
  p.sign = !!a.sign;
  if (a.kick) { p.legR = [-0.4 + 0.6 * S(t * 11), 0.6]; p.legL = [-0.4 - 0.6 * S(t * 11), 0.6]; }
  p.head = [p.head[0] + breathe, p.head[1], p.head[2]];
  return p;
}

const lerp = (a, b, k) => a + (b - a) * k;

// Move the rig toward the pose for `st` (state from Office.stateOf), blinking
// now and then. t: seconds (with the person's own phase), dt: frame time,
// speed: how fast they move across the floor (tiles/s).
export function animateChibi(rig, st, t, dt, speed = 0) {
  const p = target(st, t, speed);
  const walking = st.pose === 'walk' || st.act === 'run';
  const k = 1 - Math.exp(-dt * (walking ? 20 : 9));
  if (!rig.cur) rig.cur = JSON.parse(JSON.stringify(p));
  const c = rig.cur;
  c.hipY = lerp(c.hipY, p.hipY, st.pose === 'sit' || c.hipY < 0.2 ? Math.min(1, k * 1.5) : k);
  c.lean = lerp(c.lean, p.lean, k); c.twist = lerp(c.twist, p.twist, k); c.bounce = lerp(c.bounce, p.bounce, k);
  for (const key of ['head', 'R', 'L', 'legR', 'legL']) for (let i = 0; i < p[key].length; i++) c[key][i] = lerp(c[key][i], p[key][i], k);
  const j = rig.joints;
  j.hips.position.y = c.hipY + c.bounce;
  j.torso.rotation.set(c.lean, c.twist, 0);
  rig.head.rotation.set(c.head[0], c.head[1], c.head[2]);
  // Right arm on the -x side; its "in" turns toward +x. The left mirrors it.
  j.shR.rotation.set(c.R[0], 0, c.R[1]);
  j.elR.rotation.set(c.R[2], 0, 0);
  j.shL.rotation.set(c.L[0], 0, -c.L[1]);
  j.elL.rotation.set(c.L[2], 0, 0);
  j.hipR.rotation.set(c.legR[0], 0, 0); j.knR.rotation.set(c.legR[1], 0, 0);
  j.hipL.rotation.set(c.legL[0], 0, 0); j.knL.rotation.set(c.legL[1], 0, 0);
  // what they hold
  for (const [name, m] of Object.entries(rig.held)) m.visible = p.hold === name;
  rig.box.visible = !!p.box;
  rig.sign.visible = !!p.sign;
  // the face: a blink every few seconds; a moving mouth while talking or eating
  const now = t;
  if (now > rig.blinkAt + 0.14 && Math.random() < dt * 0.35) rig.blinkAt = now;
  const blink = now - rig.blinkAt < 0.12 && !['sleep', 'happy', 'laugh', 'yawn', 'dizzy'].includes(p.face);
  const mouth = p.face === 'talk' || p.face === 'eat' ? Math.abs(S(t * (p.face === 'eat' ? 6 : 11))) : 0;
  setFace(rig, p.face, blink, mouth, p.look);
}

export const CHIBI = { H };
