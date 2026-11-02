// Decors: the office redone in another style, not just other colours —
// other materials (textures made here on canvases, how rough or metal each
// surface is), other furniture shapes and other lights. The default decor is
// the cartoon look in furniture.js and office3d.js; a decor only says what
// changes. Picked on the page (wmad.decor) and passed to Office3D as
// opts.decor.
//
// Cheap on purpose: every texture is drawn once per page and shared, every
// material is made once per colour, there are no outlines (each is a second
// mesh) and no live reflections — the gloss comes from the room light that
// is already there (scene.environment).
import * as THREE from 'three';

// ---- textures, drawn once -------------------------------------------------

const texCache = new Map();
function canvasTex(key, size, draw, { color = true, repeat = true } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
// A repeatable pseudo-random (the same picture every time).
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// Soft blotches, tiling: for plaster, stone and the like.
function blotches(c, s, n, rgba, rMin, rMax, seed) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, rad = rMin + r() * (rMax - rMin);
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      g.addColorStop(0, rgba); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
}
function specks(c, s, n, colors, size, seed) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) { c.fillStyle = colors[i % colors.length]; c.fillRect(r() * s, r() * s, size * (0.5 + r()), size * (0.5 + r())); }
}

// Wood veneer: long grain lines that wander, a few darker streaks.
function grain(key, base, line, seed) {
  return canvasTex(key, 256, (c, s) => {
    c.fillStyle = base; c.fillRect(0, 0, s, s);
    const r = rnd(seed);
    for (let i = 0; i < 70; i++) {
      const y0 = r() * s, a = 0.04 + r() * 0.1, f = 1 + Math.floor(r() * 3), ph = r() * 6.28;
      c.strokeStyle = line.replace('A', a.toFixed(3)); c.lineWidth = 0.6 + r() * 1.6;
      c.beginPath();
      for (let x = 0; x <= s; x += 8) { const y = y0 + Math.sin((x / s) * 6.283 * f + ph) * 3; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
  });
}
// Woven fabric as a bump map: a fine grid of threads, a little uneven.
const weave = () => canvasTex('weave', 128, (c, s) => {
  c.fillStyle = '#808080'; c.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 4) {
    c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(i, 0, 2, s);
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, i, s, 2);
  }
  specks(c, s, 500, ['rgba(255,255,255,.2)', 'rgba(0,0,0,.2)'], 1.5, 7);
}, { color: false });

// ---- the modern decor -----------------------------------------------------

// Floors: large porcelain tiles (thin grout, faint veins), carpet tiles laid
// quarter-turned, wool felt, terrazzo.
function porcelain(dark) {
  return canvasTex(`porcelain${dark}`, 512, (c, s) => {
    c.fillStyle = dark ? '#3b3c3e' : '#dedbd5'; c.fillRect(0, 0, s, s);
    blotches(c, s, 26, dark ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.12)', 30, 110, 11);
    blotches(c, s, 18, dark ? 'rgba(0,0,0,.04)' : 'rgba(120,110,100,.025)', 20, 90, 12);
    // a few long veins
    const r = rnd(13);
    c.strokeStyle = dark ? 'rgba(255,255,255,.035)' : 'rgba(140,130,120,.09)'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { c.beginPath(); let x = r() * s, y = 0; c.moveTo(x, y); while (y < s) { y += 12; x += (r() - 0.5) * 14; c.lineTo(x, y); } c.stroke(); }
    // two tiles of 1.2 × 0.6 per picture; grout lines
    c.fillStyle = dark ? 'rgba(0,0,0,.5)' : 'rgba(150,145,138,.55)';
    c.fillRect(0, 0, s, 1.5); c.fillRect(0, s / 2, s, 1.5); c.fillRect(0, 0, 1.5, s / 2); c.fillRect(s / 2, s / 2, 1.5, s / 2);
  });
}
function carpetTiles(dark) {
  return canvasTex(`ctile${dark}`, 256, (c, s) => {
    const h = s / 2;
    for (let q = 0; q < 4; q++) {
      const x = (q % 2) * h, y = Math.floor(q / 2) * h;
      c.fillStyle = dark ? (q % 3 ? '#2c2e31' : '#313337') : (q % 3 ? '#8d8f92' : '#96989b'); c.fillRect(x, y, h, h);
      // tufted rows, turned a quarter on every other tile
      c.fillStyle = dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.12)';
      for (let k = 0; k < h; k += 3) (q === 0 || q === 3) ? c.fillRect(x, y + k, h, 1) : c.fillRect(x + k, y, 1, h);
    }
    specks(c, s, 900, dark ? ['rgba(255,255,255,.05)', 'rgba(0,0,0,.2)'] : ['rgba(255,255,255,.18)', 'rgba(0,0,0,.12)'], 1.6, 21);
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, 0, s, 1); c.fillRect(0, h, s, 1); c.fillRect(0, 0, 1, s); c.fillRect(h, 0, 1, s);
  });
}
function felt(dark) {
  return canvasTex(`felt${dark}`, 256, (c, s) => {
    c.fillStyle = dark ? '#34373b' : '#c4c3bf'; c.fillRect(0, 0, s, s);
    blotches(c, s, 20, dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.18)', 15, 50, 31);
    specks(c, s, 1800, dark ? ['rgba(255,255,255,.04)', 'rgba(0,0,0,.15)'] : ['rgba(255,255,255,.2)', 'rgba(60,60,60,.1)'], 1.4, 32);
  });
}
function terrazzo(dark) {
  return canvasTex(`terrazzo${dark}`, 256, (c, s) => {
    c.fillStyle = dark ? '#47484a' : '#ece9e3'; c.fillRect(0, 0, s, s);
    specks(c, s, 420, dark ? ['#5a5b5e', '#3a3b3d', '#6a5d52'] : ['#c9c3b8', '#a9a49b', '#d8b9a0', '#9fa7a6', '#ffffff'], 3.2, 41);
    specks(c, s, 900, dark ? ['rgba(255,255,255,.05)'] : ['rgba(0,0,0,.06)'], 1.2, 42);
  });
}
// Walls: microcement, softly mottled, with the trowel's sweeps.
function microcement(dark) {
  return canvasTex(`micro${dark}`, 512, (c, s) => {
    c.fillStyle = dark ? '#3c3d40' : '#ecebe7'; c.fillRect(0, 0, s, s);
    blotches(c, s, 40, dark ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.1)', 40, 140, 51);
    blotches(c, s, 30, dark ? 'rgba(0,0,0,.03)' : 'rgba(130,125,118,.025)', 30, 120, 52);
    const r = rnd(53);
    c.strokeStyle = dark ? 'rgba(255,255,255,.012)' : 'rgba(255,255,255,.08)'; c.lineWidth = 6;
    for (let i = 0; i < 18; i++) { const x = r() * s, y = r() * s, rad = 40 + r() * 80, a = r() * 6.28; c.beginPath(); c.arc(x, y, rad, a, a + 0.9); c.stroke(); }
  });
}

// The furniture's colours, by what the piece is made of.
const MODERN_C = {
  oak: 0xd9c8ac, oakDark: 0x6e5646, white: 0xf3f2ef, cream: 0xebe8e2, char: 0x2a2c2f, ink: 0x18191b,
  steel: 0xc3c6ca, sage: 0x8e998d, terra: 0x5b6169, mustard: 0xb98e5c, blue: 0xd2cec7, blush: 0xd8cfc5,
  leaf: 0x5a8a57, leafDark: 0x3f6a42, pot: 0xe7e4df, glass: 0x9fc4dd,
};
const ROLE = new Map([
  [MODERN_C.oak, 'ash'], [MODERN_C.oakDark, 'walnut'], [MODERN_C.white, 'lacquer'], [MODERN_C.cream, 'lacquer'],
  [MODERN_C.char, 'metal'], [MODERN_C.ink, 'metal'], [MODERN_C.steel, 'alu'], [MODERN_C.sage, 'fabric'],
  [MODERN_C.terra, 'fabric'], [MODERN_C.blue, 'boucle'], [MODERN_C.blush, 'fabric'], [MODERN_C.mustard, 'leather'],
  [MODERN_C.pot, 'ceramic'],
]);
const matCache = new Map();
function modernMat(color) {
  const hex = new THREE.Color(color).getHex();
  if (matCache.has(hex)) return matCache.get(hex);
  const role = ROLE.get(hex);
  const o = { color: hex, roughness: 0.7, metalness: 0 };
  if (role === 'ash') Object.assign(o, { color: 0xffffff, map: grain('ash', '#dccbaf', 'rgba(120,90,55,A)', 61), roughness: 0.55 });
  else if (role === 'walnut') Object.assign(o, { color: 0xffffff, map: grain('walnut', '#6e5646', 'rgba(30,18,10,A)', 62), roughness: 0.5 });
  else if (role === 'lacquer') Object.assign(o, { roughness: 0.4 });
  else if (role === 'metal') Object.assign(o, { roughness: 0.45, metalness: 0.55 });
  else if (role === 'alu') Object.assign(o, { roughness: 0.3, metalness: 0.85 });
  else if (role === 'fabric') Object.assign(o, { roughness: 0.95, bumpMap: weave(), bumpScale: 0.6 });
  else if (role === 'boucle') Object.assign(o, { roughness: 1, bumpMap: weave(), bumpScale: 1.4 });
  else if (role === 'leather') Object.assign(o, { roughness: 0.5 });
  else if (role === 'ceramic') Object.assign(o, { roughness: 0.6 });
  const m = new THREE.MeshStandardMaterial(o);
  matCache.set(hex, m);
  return m;
}

// Furniture made the modern way: thin tops, slim black steel frames, sled
// and pedestal legs, an ergonomic mesh chair, a low modular sofa, an arc
// lamp. H is furniture.js's kit: { box, cyl, ball, piece, C, THREE }.
const PIECES = {
  desk(g, { box, C }) {
    box(g, 1.4, 0.025, 0.78, C.white, 0, 0.575, 0, { r: 0.006 });
    // a rectangular steel frame each side, a beam between, a cable tray
    for (const s of [-1, 1]) {
      box(g, 0.035, 0.55, 0.035, C.char, s * 0.64, 0.02, -0.33, { r: 0.004 });
      box(g, 0.035, 0.55, 0.035, C.char, s * 0.64, 0.02, 0.33, { r: 0.004 });
      box(g, 0.035, 0.02, 0.7, C.char, s * 0.64, 0, 0, { r: 0.004 });
      box(g, 0.035, 0.03, 0.7, C.char, s * 0.64, 0.545, 0, { r: 0.004 });
    }
    box(g, 1.26, 0.04, 0.03, C.char, 0, 0.5, -0.3, { r: 0.004 });
    box(g, 1.0, 0.08, 0.14, C.char, 0, 0.47, -0.25, { r: 0.004 });
  },
  chairDesk(g, { box, cyl, ball, piece, C, THREE }) {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      box(g, 0.035, 0.025, 0.28, C.steel, Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13, { ry: a, r: 0.008 });
      ball(g, 0.025, C.ink, Math.sin(a) * 0.26, 0.025, Math.cos(a) * 0.26);
    }
    cyl(g, 0.022, 0.022, 0.32, C.steel, 0, 0.07, 0);
    box(g, 0.48, 0.06, 0.46, C.terra, 0, 0.38, 0.02, { r: 0.025 });
    // the back: a slim frame holding a mesh panel, curved a little
    box(g, 0.44, 0.5, 0.025, C.char, 0, 0.47, -0.25, { r: 0.012, rx: -0.1 });
    const mesh = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9, transparent: true, opacity: 0.85 });
    piece(g, new THREE.BoxGeometry(0.38, 0.42, 0.01), C.char, 0, 0.73, -0.24, { rx: -0.1, m: mesh });
    for (const s of [-1, 1]) {
      box(g, 0.025, 0.2, 0.025, C.char, s * 0.23, 0.42, 0, { r: 0.008 });
      box(g, 0.05, 0.025, 0.24, C.char, s * 0.23, 0.62, 0.02, { r: 0.01 });
    }
  },
  chairModernCushion(g, { box, piece, C, THREE }) {
    // a moulded shell on a black steel sled
    for (const s of [-1, 1]) {
      box(g, 0.025, 0.02, 0.46, C.char, s * 0.2, 0, 0, { r: 0.008 });
      box(g, 0.025, 0.42, 0.025, C.char, s * 0.2, 0.01, 0.2, { r: 0.008 });
      box(g, 0.025, 0.42, 0.025, C.char, s * 0.2, 0.01, -0.2, { r: 0.008 });
    }
    box(g, 0.5, 0.05, 0.48, C.sage, 0, 0.42, 0, { r: 0.022 });
    piece(g, new THREE.CylinderGeometry(0.27, 0.27, 0.36, 24, 1, true, Math.PI * 0.65, Math.PI * 0.7), C.sage, 0, 0.64, 0.02, { m: (() => { const m = modernMat(C.sage).clone(); m.side = THREE.DoubleSide; return m; })() });
  },
  table(g, { box, C }) {
    box(g, 2.4, 0.03, 1.15, C.white, 0, 0.72, 0, { r: 0.008 });
    // two slim panel legs, set in
    for (const s of [-1, 1]) box(g, 0.04, 0.72, 0.8, C.char, s * 0.85, 0, 0, { r: 0.004 });
  },
  tableRound(g, { cyl, C }) {
    cyl(g, 0.45, 0.45, 0.025, C.white, 0, 0.72, 0, { seg: 40 });
    cyl(g, 0.035, 0.035, 0.7, C.char, 0, 0.02, 0, { seg: 12 });
    cyl(g, 0.26, 0.28, 0.02, C.char, 0, 0, 0, { seg: 32 });
  },
  tableCoffee(g, { box, C }) {
    box(g, 1.2, 0.025, 0.6, C.oak, 0, 0.32, 0, { r: 0.012 });
    for (const [x, z] of [[-0.56, -0.26], [0.56, -0.26], [-0.56, 0.26], [0.56, 0.26]]) box(g, 0.025, 0.32, 0.025, C.char, x, 0, z, { r: 0.004 });
    box(g, 1.1, 0.012, 0.5, C.char, 0, 0.12, 0, { r: 0.003 });
  },
  stoolBar(g, { cyl, C, piece, THREE }) {
    cyl(g, 0.17, 0.16, 0.05, C.mustard, 0, 0.66, 0, { seg: 28 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      cyl(g, 0.012, 0.012, 0.68, C.char, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12, { seg: 6, rx: Math.cos(a) * 0.12, rz: -Math.sin(a) * 0.12 });
    }
    piece(g, new THREE.TorusGeometry(0.13, 0.008, 6, 24), C.char, 0, 0.26, 0, { rx: Math.PI / 2 });
  },
  kitchenCabinet(g, { box, C }) {
    // handle-less flat fronts, a thin stone worktop with a shadow gap below
    box(g, 0.7, 0.8, 0.58, C.white, 0, 0.06, -0.01, { r: 0.004 });
    box(g, 0.7, 0.06, 0.52, C.ink, 0, 0, -0.03, { r: 0.002 });
    box(g, 0.72, 0.03, 0.62, C.char, 0, 0.87, 0, { r: 0.004 });
    box(g, 0.7, 0.006, 0.01, C.char, 0, 0.82, 0.28, { r: 0.001 });
  },
  kitchenSink(g, H) {
    PIECES.kitchenCabinet(g, H);
    const { box, cyl, C } = H;
    box(g, 0.48, 0.01, 0.38, C.steel, 0, 0.9, 0.02, { r: 0.006 });
    cyl(g, 0.012, 0.012, 0.28, C.char, 0, 0.9, -0.22, { seg: 8 });
    box(g, 0.02, 0.02, 0.16, C.char, 0, 1.17, -0.15, { r: 0.006 });
  },
  kitchenFridgeLarge(g, { box, C }) {
    box(g, 0.85, 1.95, 0.72, C.white, 0, 0, 0, { r: 0.01 });
    box(g, 0.85, 0.008, 0.01, C.char, 0, 1.25, 0.362, { r: 0.002 });
    box(g, 0.012, 1.1, 0.02, C.steel, -0.405, 0.75, 0.37, { r: 0.004 });
  },
  bookcaseOpen(g, { box, C }) {
    // a black steel grid with ash shelves
    for (const s of [-1, 0, 1]) box(g, 0.02, 1.45, 0.36, C.char, s * 0.44, 0, 0, { r: 0.003 });
    for (const y of [0, 0.47, 0.94, 1.41]) box(g, 0.88, 0.025, 0.34, C.oak, 0, y, 0, { r: 0.004 });
  },
  loungeSofa(g, { box, C }) {
    // low and square: a plinth, deep seat blocks, a low back, slim arms
    box(g, 2.0, 0.08, 0.84, C.char, 0, 0.02, 0, { r: 0.01 });
    for (const x of [-0.45, 0.45]) box(g, 0.88, 0.2, 0.68, C.blue, x, 0.1, 0.06, { r: 0.05 });
    box(g, 1.96, 0.36, 0.2, C.blue, 0, 0.1, -0.31, { r: 0.06 });
    for (const s of [-1, 1]) box(g, 0.12, 0.32, 0.84, C.blue, s * 0.94, 0.1, 0, { r: 0.04 });
    box(g, 0.34, 0.3, 0.1, C.terra, -0.6, 0.3, -0.17, { r: 0.04, rx: -0.15 });
  },
  loungeChairRelax(g, { box, cyl, C }) {
    cyl(g, 0.26, 0.28, 0.02, C.char, 0, 0, 0, { seg: 28 });
    cyl(g, 0.02, 0.02, 0.2, C.char, 0, 0.02, 0, { seg: 8 });
    box(g, 0.72, 0.14, 0.7, C.blue, 0, 0.2, 0.02, { r: 0.06 });
    box(g, 0.72, 0.4, 0.14, C.blue, 0, 0.26, -0.3, { r: 0.06, rx: -0.12 });
    for (const s of [-1, 1]) box(g, 0.1, 0.24, 0.62, C.blue, s * 0.33, 0.24, 0, { r: 0.04 });
  },
  lampRoundFloor(g, { cyl, piece, C, THREE }) {
    // an arc lamp: a heavy round foot, a steel arc, a dome over the seat
    cyl(g, 0.17, 0.18, 0.05, C.char, 0, 0, 0, { seg: 28 });
    piece(g, new THREE.TorusGeometry(0.55, 0.012, 6, 28, Math.PI * 0.62), C.steel, 0.55, 0.05, 0, { rz: Math.PI * 0.38 });
    const dome = piece(g, new THREE.SphereGeometry(0.18, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.char, 0.97, 1.42, 0, {});
    dome.material = dome.material.clone(); dome.material.side = THREE.DoubleSide;
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    bulb.rotation.x = Math.PI / 2; bulb.position.set(0.97, 1.42, 0); g.add(bulb);
  },
  cabinetTelevision(g, { box, C }) {
    box(g, 1.2, 0.3, 0.38, C.oakDark, 0, 0.1, 0, { r: 0.006 });
    box(g, 1.2, 0.006, 0.01, C.ink, 0, 0.25, 0.19, { r: 0.001 });
    for (const x of [-0.55, 0.55]) box(g, 0.025, 0.1, 0.025, C.char, x, 0, 0, { r: 0.004 });
  },
  pottedPlant(g, { cyl, piece, C, THREE }) {
    // a tall matte planter and a fiddle-leaf crown
    cyl(g, 0.2, 0.17, 0.44, C.pot, 0, 0, 0, { seg: 24 });
    cyl(g, 0.018, 0.022, 0.5, C.oakDark, 0, 0.42, 0, { seg: 6 });
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4, y = 0.7 + (i % 4) * 0.11, r = 0.1 + (i % 3) * 0.05;
      piece(g, new THREE.SphereGeometry(0.12, 10, 6), i % 3 ? C.leaf : C.leafDark, Math.cos(a) * r, y, Math.sin(a) * r, { rx: Math.sin(a) * 0.9, rz: -Math.cos(a) * 0.9 }).parent.scale.set(0.8, 1.15, 0.18);
    }
  },
};
const MODERN = {
  name: 'modern',
  label: '極簡現代',
  furniture: { palette: MODERN_C, material: modernMat, outline: false, pieces: PIECES },
  // Plain boxes (walls, partitions, counters made in office3d.js).
  material: (color) => modernMat(color),
  floors(dark) {
    return { wood: [porcelain(dark), 2.4, 0.32], work: [carpetTiles(dark), 1.2, 1], carpet: [felt(dark), 1.5, 1], tiles: [terrazzo(dark), 1.5, 0.45] };
  },
  wall(dark) { return new THREE.MeshStandardMaterial({ map: microcement(dark), roughness: 0.9 }); },
  runner: false, // no carpet runners down the aisles
  light: { exposure: 1.12, hemi: 0xffffff, sun: 0xfff7ef, env: 0.45 },
  // The lamp over each pod: a slim linear LED bar on two wires.
  pendant(THREE_, dark) {
    const g = new THREE.Group();
    const metal = modernMat(MODERN_C.char);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.55, 3), metal);
      w.position.set(s * 0.45, 0.3, 0); g.add(w);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.07), metal);
    g.add(bar);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.035), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
    glow.rotation.x = Math.PI / 2; glow.position.y = -0.021; g.add(glow);
    return { group: g, glow };
  },
};

export const DECORS = { modern: MODERN };
export const DECOR_LIST = [{ id: 'default', label: '預設' }, { id: 'modern', label: MODERN.label }];
export function decorOf(id) { return DECORS[id] || null; }
