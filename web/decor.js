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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
// What each material looks like, by what it is made of.
const LOOKS = {
  ash: () => ({ color: 0xffffff, map: grain('ash', '#dccbaf', 'rgba(120,90,55,A)', 61), roughness: 0.55 }),
  birch: () => ({ color: 0xffffff, map: grain('birch', '#e9dfcc', 'rgba(150,120,80,A)', 63), roughness: 0.5 }),
  walnut: () => ({ color: 0xffffff, map: grain('walnut', '#6e5646', 'rgba(30,18,10,A)', 62), roughness: 0.5 }),
  lacquer: () => ({ roughness: 0.4 }),
  laminate: () => ({ roughness: 0.32 }),
  metal: () => ({ roughness: 0.45, metalness: 0.55 }),
  alu: () => ({ roughness: 0.3, metalness: 0.85 }),
  plastic: () => ({ roughness: 0.28 }),
  fabric: () => ({ roughness: 0.95, bumpMap: weave(), bumpScale: 0.6 }),
  knit: () => ({ roughness: 0.9, bumpMap: weave(), bumpScale: 1.0 }),
  boucle: () => ({ roughness: 1, bumpMap: weave(), bumpScale: 1.4 }),
  leather: () => ({ roughness: 0.5 }),
  ceramic: () => ({ roughness: 0.6 }),
  marble: () => ({ color: 0xffffff, map: marble(false), roughness: 0.18 }),
  brass: () => ({ roughness: 0.28, metalness: 1 }),
  gloss: () => ({ roughness: 0.22 }),
  velvet: () => ({ roughness: 1, bumpMap: velvetNap(), bumpScale: 0.5 }),
};
// A decor's materials: one per colour, its look from the colour's role.
function materials(roles) {
  const cache = new Map();
  return (color) => {
    const hex = new THREE.Color(color).getHex();
    if (cache.has(hex)) return cache.get(hex);
    const look = LOOKS[roles.get(hex)];
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0, ...(look ? look() : {}) });
    cache.set(hex, m);
    return m;
  };
}
const modernMat = materials(new Map([
  [MODERN_C.oak, 'ash'], [MODERN_C.oakDark, 'walnut'], [MODERN_C.white, 'lacquer'], [MODERN_C.cream, 'lacquer'],
  [MODERN_C.char, 'metal'], [MODERN_C.ink, 'metal'], [MODERN_C.steel, 'alu'], [MODERN_C.sage, 'fabric'],
  [MODERN_C.terra, 'fabric'], [MODERN_C.blue, 'boucle'], [MODERN_C.blush, 'fabric'], [MODERN_C.mustard, 'leather'],
  [MODERN_C.pot, 'ceramic'],
]));

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
  // worldUV: the picture is laid in metres along the wall, not stretched per box.
  wall(dark) { const m = new THREE.MeshStandardMaterial({ map: microcement(dark), roughness: 0.9 }); m.userData.worldUV = 4; return m; },
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

// ---- the tech start-up decor ----------------------------------------------

// Floors: glossy epoxy with a fine fleck, carpet tiles in greys with a few
// bright ones, a bold blue carpet with rings, soft-teal rubber.
function epoxy(dark, key = 'epoxy', base = null) {
  return canvasTex(`${key}${dark}`, 256, (c, s) => {
    c.fillStyle = base || (dark ? '#33373d' : '#d8dbdf'); c.fillRect(0, 0, s, s);
    blotches(c, s, 14, dark ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.1)', 30, 90, 71);
    specks(c, s, 1400, dark ? ['rgba(255,255,255,.06)', 'rgba(0,0,0,.18)'] : ['rgba(255,255,255,.35)', 'rgba(70,80,90,.12)'], 1.1, 72);
  });
}
function brightTiles(dark) {
  return canvasTex(`btile${dark}`, 512, (c, s) => {
    const n = 4, h = s / n, r = rnd(81);
    const greys = dark ? ['#2c3036', '#30353b', '#272b30'] : ['#9aa0a7', '#a6abb1', '#8f959c'];
    const pops = ['#2fb5a3', '#4c6fff', '#ff7a45', '#ffc845'];
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * h, y = Math.floor(i / n) * h;
      c.fillStyle = r() < 0.16 ? pops[Math.floor(r() * pops.length)] : greys[i % greys.length];
      c.fillRect(x, y, h, h);
      c.fillStyle = 'rgba(255,255,255,.08)';
      for (let k = 0; k < h; k += 3) (i % 2) ? c.fillRect(x, y + k, h, 1) : c.fillRect(x + k, y, 1, h);
    }
    specks(c, s, 2200, ['rgba(255,255,255,.12)', 'rgba(0,0,0,.14)'], 1.6, 82);
    c.fillStyle = 'rgba(0,0,0,.22)';
    for (let k = 0; k <= n; k++) { c.fillRect(k * h, 0, 1, s); c.fillRect(0, k * h, s, 1); }
  });
}
function ringCarpet(dark) {
  return canvasTex(`rings${dark}`, 256, (c, s) => {
    c.fillStyle = dark ? '#22305a' : '#3d5bd9'; c.fillRect(0, 0, s, s);
    c.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.18)'; c.lineWidth = 5;
    for (const [x, y] of [[s / 4, s / 4], [3 * s / 4, 3 * s / 4]]) for (const rad of [22, 46, 70]) { c.beginPath(); c.arc(x, y, rad, 0, 6.283); c.stroke(); }
    specks(c, s, 1600, ['rgba(255,255,255,.08)', 'rgba(0,0,0,.15)'], 1.4, 91);
  });
}
// Walls: acoustic felt in hexagons, a few in the brand colours; a bump map
// makes each hexagon stand out from the wall with a groove round it.
function hexFelt(dark, bump) {
  return canvasTex(`hex${dark}${bump}`, 512, (c, s) => {
    const R = s / 8, w = Math.sqrt(3) * R, r = rnd(101);
    c.fillStyle = bump ? '#202020' : (dark ? '#2a2e34' : '#c9ccd0'); c.fillRect(0, 0, s, s);
    const pops = dark ? ['#1f6f66', '#33489e', '#9a4d2e'] : ['#2fb5a3', '#4c6fff', '#ff7a45', '#ffc845'];
    const greys = dark ? ['#3a3f46', '#363a41', '#40454c'] : ['#e4e6e8', '#dcdfe2', '#eceef0'];
    for (let row = -1; row <= s / (1.5 * R) + 1; row++) for (let col = -1; col <= s / w + 1; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * 1.5 * R;
      c.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const px = cx + Math.cos(a) * (R - 3), py = cy + Math.sin(a) * (R - 3); k ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.closePath();
      c.fillStyle = bump ? '#d0d0d0' : (r() < 0.12 ? pops[Math.floor(r() * pops.length)] : greys[Math.floor(r() * greys.length)]);
      c.fill();
    }
    if (!bump) specks(c, s, 3000, ['rgba(255,255,255,.07)', 'rgba(0,0,0,.07)'], 1.4, 102);
  }, { color: !bump });
}
// Moss: a wall of green tufts, framed.
const moss = () => canvasTex('moss', 256, (c, s) => {
  c.fillStyle = '#3f6b34'; c.fillRect(0, 0, s, s);
  const r = rnd(111), greens = ['#5c8f45', '#4d7d3a', '#77a552', '#355d2c', '#8fb85e'];
  for (let i = 0; i < 900; i++) { c.fillStyle = greens[i % greens.length]; c.beginPath(); c.arc(r() * s, r() * s, 2 + r() * 6, 0, 6.283); c.fill(); }
}, { repeat: false });

const TECH_C = {
  oak: 0xe9dfcc, oakDark: 0x2b2f36, white: 0xf5f6f7, cream: 0xeef0f2, char: 0x323844, ink: 0x1c2028,
  steel: 0xb8bec6, sage: 0x2fb5a3, terra: 0xff7a45, mustard: 0xffc845, blue: 0x4c6fff, blush: 0xff8fb1,
  leaf: 0x4f9a4a, leafDark: 0x377a3c, pot: 0x2e333b, glass: 0x9fc4dd,
};
const techMat = materials(new Map([
  [TECH_C.oak, 'birch'], [TECH_C.oakDark, 'metal'], [TECH_C.white, 'laminate'], [TECH_C.cream, 'laminate'],
  [TECH_C.char, 'metal'], [TECH_C.ink, 'metal'], [TECH_C.steel, 'alu'], [TECH_C.sage, 'knit'],
  [TECH_C.terra, 'knit'], [TECH_C.mustard, 'plastic'], [TECH_C.blue, 'knit'], [TECH_C.blush, 'knit'],
  [TECH_C.pot, 'ceramic'],
]));

// Furniture for a start-up: sit-stand desks on T-legs, knit task chairs in
// the brand colours, one-piece plastic shell chairs, a capsule meeting table,
// colourful modular sofas, beanbags, a glowing stick lamp.
const TECH_PIECES = {
  desk(g, { box, C }) {
    box(g, 1.4, 0.03, 0.76, C.white, 0, 0.57, 0, { r: 0.02 });
    for (const s of [-1, 1]) {
      box(g, 0.07, 0.5, 0.05, C.char, s * 0.6, 0.06, -0.05, { r: 0.006 }); // lifting column
      box(g, 0.08, 0.04, 0.7, C.char, s * 0.6, 0, 0, { r: 0.012 });        // foot
      box(g, 0.05, 0.03, 0.6, C.char, s * 0.6, 0.54, 0, { r: 0.006 });     // bracket
    }
    box(g, 1.1, 0.04, 0.05, C.char, 0, 0.5, -0.05, { r: 0.006 });
    box(g, 0.08, 0.02, 0.05, C.sage, 0.6, 0.6, 0.36, { r: 0.006 });        // up/down keypad
  },
  chairDesk(g, { box, cyl, ball, C }) {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      box(g, 0.04, 0.03, 0.28, C.char, Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13, { ry: a, r: 0.01 });
      ball(g, 0.026, C.ink, Math.sin(a) * 0.26, 0.026, Math.cos(a) * 0.26);
    }
    cyl(g, 0.024, 0.024, 0.32, C.char, 0, 0.07, 0);
    box(g, 0.5, 0.08, 0.48, C.blue, 0, 0.37, 0.02, { r: 0.04 });
    box(g, 0.46, 0.56, 0.07, C.blue, 0, 0.46, -0.25, { r: 0.05, rx: -0.12 });
    box(g, 0.2, 0.06, 0.05, C.char, 0, 0.52, -0.3, { r: 0.02, rx: -0.12 }); // lumbar knob
    for (const s of [-1, 1]) box(g, 0.05, 0.22, 0.2, C.char, s * 0.25, 0.42, 0.02, { r: 0.02 });
  },
  chairModernCushion(g, { box, cyl, C }) {
    for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) cyl(g, 0.012, 0.012, 0.44, C.char, x, 0, z, { seg: 6 });
    box(g, 0.48, 0.05, 0.46, C.mustard, 0, 0.43, 0, { r: 0.024 });
    box(g, 0.48, 0.38, 0.05, C.mustard, 0, 0.46, -0.22, { r: 0.024, rx: -0.14 });
  },
  table(g, { box, cyl, C }) {
    // a capsule top: a slab with half-round ends
    box(g, 1.8, 0.035, 1.1, C.white, 0, 0.7, 0, { r: 0.012 });
    for (const s of [-1, 1]) cyl(g, 0.55, 0.55, 0.035, C.white, s * 0.9, 0.7, 0, { seg: 32 });
    for (const s of [-1, 1]) { cyl(g, 0.05, 0.05, 0.68, C.char, s * 0.6, 0.02, 0, { seg: 12 }); cyl(g, 0.3, 0.32, 0.02, C.char, s * 0.6, 0, 0, { seg: 28 }); }
    box(g, 0.3, 0.012, 0.12, C.sage, 0, 0.735, 0, { r: 0.004 }); // power and HDMI
  },
  tableRound(g, { cyl, C }) {
    cyl(g, 0.45, 0.45, 0.03, C.white, 0, 0.71, 0, { seg: 36 });
    cyl(g, 0.04, 0.04, 0.7, C.char, 0, 0.02, 0, { seg: 12 });
    cyl(g, 0.3, 0.3, 0.02, C.char, 0, 0, 0, { seg: 28 });
  },
  tableCoffee(g, { box, C }) {
    box(g, 1.2, 0.04, 0.6, C.oak, 0, 0.3, 0, { r: 0.08 });
    box(g, 1.0, 0.3, 0.4, C.sage, 0, 0, 0, { r: 0.06 });
  },
  stoolBar(g, { cyl, C, piece, THREE }) {
    cyl(g, 0.17, 0.17, 0.05, C.mustard, 0, 0.66, 0, { seg: 28 });
    cyl(g, 0.03, 0.03, 0.66, C.char, 0, 0, 0, { seg: 10 });
    cyl(g, 0.2, 0.22, 0.02, C.char, 0, 0, 0, { seg: 28 });
    piece(g, new THREE.TorusGeometry(0.13, 0.01, 6, 24), C.char, 0, 0.26, 0, { rx: Math.PI / 2 });
  },
  kitchenCabinet(g, { box, C }) {
    box(g, 0.7, 0.8, 0.58, C.white, 0, 0.06, -0.01, { r: 0.006 });
    box(g, 0.66, 0.74, 0.02, C.sage, 0, 0.09, 0.28, { r: 0.006 });
    box(g, 0.7, 0.06, 0.52, C.ink, 0, 0, -0.03, { r: 0.002 });
    box(g, 0.72, 0.035, 0.62, C.oak, 0, 0.86, 0, { r: 0.006 });
  },
  kitchenSink(g, H) {
    TECH_PIECES.kitchenCabinet(g, H);
    const { box, cyl, C } = H;
    box(g, 0.48, 0.01, 0.38, C.steel, 0, 0.9, 0.02, { r: 0.006 });
    cyl(g, 0.014, 0.014, 0.28, C.char, 0, 0.9, -0.22, { seg: 8 });
    box(g, 0.022, 0.022, 0.16, C.char, 0, 1.17, -0.15, { r: 0.006 });
  },
  kitchenFridgeLarge(g, { box, C }) {
    box(g, 0.85, 1.95, 0.72, C.char, 0, 0, 0, { r: 0.02 });
    box(g, 0.6, 1.0, 0.01, 0x9fc4dd, 0, 0.8, 0.362, { r: 0.004 }); // a glass door: drinks inside
    box(g, 0.014, 1.0, 0.03, C.steel, -0.38, 0.8, 0.37, { r: 0.004 });
  },
  bookcaseOpen(g, { box, C }) {
    box(g, 0.9, 1.45, 0.03, C.char, 0, 0, -0.17, { r: 0.004 }); // pegboard back
    for (const s of [-1, 1]) box(g, 0.025, 1.45, 0.36, C.oak, s * 0.44, 0, 0, { r: 0.006 });
    for (const y of [0, 0.47, 0.94, 1.41]) box(g, 0.86, 0.025, 0.34, C.oak, 0, y, 0, { r: 0.006 });
  },
  loungeSofa(g, { box, C }) {
    // modular blocks in two colours, a low base
    box(g, 2.0, 0.08, 0.84, C.char, 0, 0.02, 0, { r: 0.02 });
    box(g, 0.98, 0.22, 0.7, C.sage, -0.48, 0.1, 0.06, { r: 0.07 });
    box(g, 0.98, 0.22, 0.7, C.terra, 0.48, 0.1, 0.06, { r: 0.07 });
    box(g, 0.98, 0.38, 0.18, C.sage, -0.48, 0.1, -0.32, { r: 0.07 });
    box(g, 0.98, 0.38, 0.18, C.terra, 0.48, 0.1, -0.32, { r: 0.07 });
    box(g, 0.32, 0.3, 0.1, C.mustard, 0.1, 0.3, -0.18, { r: 0.05, rx: -0.15 });
  },
  loungeChairRelax(g, { ball, C }) {
    // a beanbag, slumped
    ball(g, 0.42, C.terra, 0, 0.22, 0, [1, 0.55, 1]);
    ball(g, 0.32, C.terra, 0, 0.38, -0.2, [1, 0.8, 0.7]);
  },
  lampRoundFloor(g, { cyl, C, THREE }) {
    cyl(g, 0.12, 0.13, 0.03, C.char, 0, 0, 0, { seg: 24 });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 12), new THREE.MeshBasicMaterial({ color: 0x9ff0e4 }));
    glow.position.y = 0.75; g.add(glow);
  },
  pottedPlant(g, { cyl, piece, C, THREE }) {
    cyl(g, 0.21, 0.21, 0.42, C.pot, 0, 0, 0, { seg: 24 });
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, y = 0.5 + (i % 4) * 0.1, r = 0.06 + (i % 3) * 0.06;
      piece(g, new THREE.SphereGeometry(0.13, 10, 6), i % 3 ? C.leaf : C.leafDark, Math.cos(a) * r, y, Math.sin(a) * r, { rx: Math.sin(a) * 1.1, rz: -Math.cos(a) * 1.1 }).parent.scale.set(0.5, 1.5, 0.15);
    }
  },
};

const TECH = {
  name: 'tech',
  label: '科技新創',
  furniture: { palette: TECH_C, material: techMat, outline: false, pieces: TECH_PIECES },
  material: (color) => techMat(color),
  floors(dark) {
    return { wood: [epoxy(dark), 2.5, 0.22], work: [brightTiles(dark), 2.0, 1], carpet: [ringCarpet(dark), 1.5, 1], tiles: [epoxy(dark, 'rubber', dark ? '#24403d' : '#a9d6cf'), 1.5, 0.6] };
  },
  wall(dark) {
    const m = new THREE.MeshStandardMaterial({ map: hexFelt(dark, false), bumpMap: hexFelt(dark, true), bumpScale: 2, roughness: 1 });
    m.userData.worldUV = 1.6;
    return m;
  },
  runner: false,
  light: { exposure: 1.1, hemi: 0xf2f6ff, sun: 0xffffff, env: 0.42 },
  // Over each pod: an LED ring on three wires.
  pendant(THREE_, dark) {
    const g = new THREE.Group();
    const metal = techMat(TECH_C.char);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094, w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.55, 3), metal);
      w.position.set(Math.cos(a) * 0.38, 0.28, Math.sin(a) * 0.38); g.add(w);
    }
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
    glow.rotation.x = Math.PI / 2; g.add(glow);
    return { group: g, glow };
  },
  // The prints between the back windows become framed moss panels.
  art(x, y, w, h) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), techMat(TECH_C.oak));
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: moss(), bumpMap: moss(), bumpScale: 3, roughness: 1 }));
    pic.position.z = 0.026;
    g.add(frame, pic);
    g.position.set(x, y, 0.03);
    return g;
  },
};

// ---- the modern luxury decor ----------------------------------------------

// Marble: a pale stone with long soft veins (dark: a black marble with gold
// ones); slabs with fine joints.
function marble(dark, joints = false) {
  return canvasTex(`marble${dark}${joints}`, 512, (c, s) => {
    c.fillStyle = dark ? '#1f1d1c' : '#efebe5'; c.fillRect(0, 0, s, s);
    blotches(c, s, 24, dark ? 'rgba(255,255,255,.025)' : 'rgba(200,190,178,.12)', 40, 140, 121);
    const r = rnd(122);
    for (let i = 0; i < 9; i++) {
      let x = r() * s, y = -10, a = (r() - 0.5) * 1.2;
      const wide = 1 + r() * 2.5;
      for (const [wd, al] of [[wide * 4, 0.05], [wide, dark ? 0.35 : 0.28]]) {
        c.strokeStyle = dark ? `rgba(196,158,92,${al})` : `rgba(120,112,104,${al})`; c.lineWidth = wd;
        c.beginPath(); let px = x, py = y; c.moveTo(px, py);
        const rr = rnd(130 + i);
        while (py < s + 10) { a += (rr() - 0.5) * 0.5; px += Math.sin(a) * 10; py += 10; c.lineTo(px, py); }
        c.stroke();
      }
    }
    if (joints) { c.fillStyle = dark ? 'rgba(0,0,0,.6)' : 'rgba(150,142,132,.5)'; c.fillRect(0, 0, s, 1.2); c.fillRect(0, 0, 1.2, s); }
  });
}
// Black and white marble squares, laid on the diagonal of the room.
function checker(dark) {
  return canvasTex(`checker${dark}`, 256, (c, s) => {
    const h = s / 2;
    c.fillStyle = dark ? '#d8d2c8' : '#f2eee8'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#1c1a19'; c.fillRect(0, 0, h, h); c.fillRect(h, h, h, h);
    blotches(c, s, 16, 'rgba(255,255,255,.06)', 20, 60, 141);
    c.fillStyle = 'rgba(176,141,87,.6)'; c.fillRect(0, 0, s, 1); c.fillRect(0, h, s, 1); c.fillRect(0, 0, 1, s); c.fillRect(h, 0, 1, s);
  });
}
// A deep wool carpet: a small diamond pattern in the pile.
function luxCarpet(dark, key, base, line) {
  return canvasTex(`lux${key}${dark}`, 256, (c, s) => {
    c.fillStyle = base; c.fillRect(0, 0, s, s);
    c.strokeStyle = line; c.lineWidth = 1.5;
    for (let k = -s; k <= s; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + s, s); c.stroke(); c.beginPath(); c.moveTo(k + s, 0); c.lineTo(k, s); c.stroke(); }
    specks(c, s, 2400, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.12)'], 1.4, 151);
  });
}
// Fluted walnut panels: upright half-round reeds, light catching each one.
function fluted(dark, bump) {
  return canvasTex(`flute${dark}${bump}`, 256, (c, s) => {
    const n = 16, w = s / n;
    for (let i = 0; i < n; i++) {
      const g = c.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      if (bump) { g.addColorStop(0, '#202020'); g.addColorStop(0.5, '#e0e0e0'); g.addColorStop(1, '#202020'); }
      else {
        const base = dark ? [58, 38, 28] : [122, 86, 60];
        const sh = (k) => `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
        g.addColorStop(0, sh(0.62)); g.addColorStop(0.45, sh(1.08)); g.addColorStop(1, sh(0.7));
      }
      c.fillStyle = g; c.fillRect(i * w, 0, w, s);
    }
    if (!bump) {
      const r = rnd(161);
      c.strokeStyle = 'rgba(30,18,10,.12)'; c.lineWidth = 1;
      for (let i = 0; i < 50; i++) { const x = r() * s; c.beginPath(); c.moveTo(x, 0); for (let y = 0; y <= s; y += 16) c.lineTo(x + Math.sin(y / 30 + i) * 1.5, y); c.stroke(); }
    }
  }, { color: !bump });
}
// Velvet: a fine nap as a bump map.
const velvetNap = () => canvasTex('velvet', 128, (c, s) => {
  c.fillStyle = '#808080'; c.fillRect(0, 0, s, s);
  blotches(c, s, 30, 'rgba(255,255,255,.12)', 6, 20, 171);
  specks(c, s, 1500, ['rgba(255,255,255,.15)', 'rgba(0,0,0,.15)'], 1, 172);
}, { color: false });

const LUX_C = {
  oak: 0x8a6246, oakDark: 0x4a3226, white: 0xf1ece4, cream: 0xe8dccb, char: 0xb08d57, ink: 0x1d1a18,
  steel: 0xc9a96e, sage: 0x2f5d50, terra: 0x7a2e3a, mustard: 0x9c6438, blue: 0x23324f, blush: 0xd2b2a2,
  leaf: 0x4f7f4a, leafDark: 0x355e36, pot: 0xece7df, glass: 0x9fc4dd,
};
const luxMat = materials(new Map([
  [LUX_C.oak, 'walnut'], [LUX_C.oakDark, 'walnut'], [LUX_C.white, 'marble'], [LUX_C.cream, 'leather'],
  [LUX_C.char, 'brass'], [LUX_C.ink, 'gloss'], [LUX_C.steel, 'brass'], [LUX_C.sage, 'velvet'],
  [LUX_C.terra, 'velvet'], [LUX_C.mustard, 'leather'], [LUX_C.blue, 'velvet'], [LUX_C.blush, 'velvet'],
  [LUX_C.pot, 'marble'],
]));

// Furniture for a hotel lobby of an office: walnut and marble, brass feet,
// a tufted leather desk chair, velvet dining chairs and a Chesterfield,
// barrel armchairs, a brass arc lamp with an opal globe.
const LUX_PIECES = {
  desk(g, { box, C }) {
    box(g, 1.44, 0.045, 0.8, C.oak, 0, 0.555, 0, { r: 0.01 });
    box(g, 1.44, 0.012, 0.8, C.char, 0, 0.545, 0, { r: 0.004 }); // a brass edge under the top
    for (const s of [-1, 1]) {
      box(g, 0.06, 0.53, 0.72, C.oakDark, s * 0.66, 0.015, 0, { r: 0.006 });
      box(g, 0.07, 0.015, 0.74, C.char, s * 0.66, 0, 0, { r: 0.004 });
    }
    box(g, 1.26, 0.3, 0.025, C.oakDark, 0, 0.25, -0.33, { r: 0.004 });
  },
  chairDesk(g, { box, cyl, ball, C }) {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      box(g, 0.035, 0.025, 0.28, C.steel, Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13, { ry: a, r: 0.01 });
      ball(g, 0.024, C.ink, Math.sin(a) * 0.26, 0.024, Math.cos(a) * 0.26);
    }
    cyl(g, 0.024, 0.024, 0.32, C.steel, 0, 0.07, 0);
    box(g, 0.52, 0.1, 0.5, C.mustard, 0, 0.36, 0.02, { r: 0.05 });
    box(g, 0.5, 0.72, 0.1, C.mustard, 0, 0.42, -0.26, { r: 0.06, rx: -0.1 });
    // tufting: a grid of buttons on the back
    for (let r2 = 0; r2 < 3; r2++) for (let k = -1; k <= 1; k++) ball(g, 0.012, C.oakDark, k * 0.13, 0.62 + r2 * 0.16, -0.2 - r2 * 0.016);
    for (const s of [-1, 1]) box(g, 0.07, 0.2, 0.42, C.mustard, s * 0.27, 0.4, 0.02, { r: 0.03 });
  },
  chairModernCushion(g, { box, cyl, C, piece, THREE }) {
    for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) cyl(g, 0.014, 0.01, 0.42, C.char, x, 0, z, { seg: 8 });
    box(g, 0.5, 0.08, 0.48, C.sage, 0, 0.42, 0, { r: 0.035 });
    // a rounded back hugging the seat
    piece(g, new THREE.CylinderGeometry(0.26, 0.26, 0.34, 28, 1, true, Math.PI * 0.62, Math.PI * 0.76), C.sage, 0, 0.66, 0.03, { m: (() => { const m = luxMat(C.sage).clone(); m.side = THREE.DoubleSide; return m; })() });
  },
  table(g, { box, cyl, C }) {
    box(g, 2.4, 0.05, 1.15, C.white, 0, 0.7, 0, { r: 0.015 });
    for (const s of [-1, 1]) {
      cyl(g, 0.11, 0.14, 0.66, C.oakDark, s * 0.75, 0.04, 0, { seg: 24 });
      cyl(g, 0.3, 0.32, 0.04, C.char, s * 0.75, 0, 0, { seg: 32 });
    }
  },
  tableRound(g, { cyl, C }) {
    cyl(g, 0.46, 0.46, 0.04, C.white, 0, 0.7, 0, { seg: 40 });
    cyl(g, 0.04, 0.16, 0.66, C.char, 0, 0.04, 0, { seg: 24 });
    cyl(g, 0.28, 0.3, 0.04, C.char, 0, 0, 0, { seg: 32 });
  },
  tableCoffee(g, { cyl, C, piece, THREE }) {
    const top = cyl(g, 0.5, 0.5, 0.05, C.white, 0, 0.32, 0, { seg: 40 });
    top.parent.scale.set(1.2, 1, 0.6);
    piece(g, new THREE.TorusGeometry(0.5, 0.012, 6, 40), C.char, 0, 0.3, 0, { rx: Math.PI / 2 }).parent.scale.set(1.15, 0.55, 1);
    for (const [x, z] of [[-0.45, 0], [0.45, 0], [0, -0.22], [0, 0.22]]) cyl(g, 0.012, 0.012, 0.3, C.char, x, 0, z, { seg: 6 });
  },
  stoolBar(g, { cyl, C, piece, THREE }) {
    cyl(g, 0.18, 0.17, 0.08, C.blue, 0, 0.64, 0, { seg: 28 });
    cyl(g, 0.025, 0.025, 0.64, C.char, 0, 0, 0, { seg: 10 });
    cyl(g, 0.2, 0.22, 0.02, C.char, 0, 0, 0, { seg: 28 });
    piece(g, new THREE.TorusGeometry(0.13, 0.009, 6, 24), C.char, 0, 0.26, 0, { rx: Math.PI / 2 });
  },
  kitchenCabinet(g, { box, C }) {
    box(g, 0.7, 0.8, 0.58, C.oakDark, 0, 0.06, -0.01, { r: 0.006 });
    box(g, 0.7, 0.06, 0.52, C.ink, 0, 0, -0.03, { r: 0.002 });
    box(g, 0.72, 0.04, 0.62, C.white, 0, 0.86, 0, { r: 0.006 });
    box(g, 0.3, 0.015, 0.02, C.char, 0, 0.72, 0.29, { r: 0.006 });
  },
  kitchenSink(g, H) {
    LUX_PIECES.kitchenCabinet(g, H);
    const { box, cyl, C } = H;
    box(g, 0.46, 0.01, 0.36, C.ink, 0, 0.905, 0.02, { r: 0.006 });
    cyl(g, 0.014, 0.014, 0.28, C.char, 0, 0.9, -0.22, { seg: 10 });
    box(g, 0.022, 0.022, 0.16, C.char, 0, 1.17, -0.15, { r: 0.008 });
  },
  kitchenFridgeLarge(g, { box, C }) {
    box(g, 0.85, 1.95, 0.72, C.oakDark, 0, 0, 0, { r: 0.01 });
    box(g, 0.85, 0.008, 0.01, C.ink, 0, 1.25, 0.362, { r: 0.002 });
    box(g, 0.016, 0.9, 0.03, C.char, -0.38, 0.75, 0.37, { r: 0.006 });
  },
  bookcaseOpen(g, { box, C }) {
    for (const s of [-1, 1]) box(g, 0.04, 1.45, 0.38, C.oakDark, s * 0.43, 0, 0, { r: 0.008 });
    box(g, 0.9, 1.45, 0.02, C.oakDark, 0, 0, -0.18, { r: 0.004 });
    for (const y of [0, 0.47, 0.94, 1.41]) { box(g, 0.84, 0.035, 0.36, C.oak, 0, y, 0, { r: 0.006 }); box(g, 0.84, 0.01, 0.01, C.char, 0, y + 0.012, 0.18, { r: 0.002 }); }
  },
  loungeSofa(g, { box, cyl, ball, C }) {
    // a Chesterfield: deep buttoned back, rolled arms, brass feet
    for (const [x, z] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) cyl(g, 0.025, 0.018, 0.08, C.char, x, 0, z, { seg: 8 });
    box(g, 2.0, 0.24, 0.84, C.sage, 0, 0.08, 0, { r: 0.05 });
    box(g, 1.7, 0.12, 0.62, C.sage, 0, 0.3, 0.08, { r: 0.05 });
    box(g, 2.0, 0.46, 0.2, C.sage, 0, 0.3, -0.32, { r: 0.06 });
    for (let k = -3; k <= 3; k++) for (let r = 0; r < 2; r++) ball(g, 0.014, C.oakDark, k * 0.26 + (r ? 0.13 : 0), 0.5 + r * 0.14, -0.215);
    for (const s of [-1, 1]) { box(g, 0.18, 0.38, 0.84, C.sage, s * 0.91, 0.08, 0, { r: 0.06 }); cyl(g, 0.11, 0.11, 0.84, C.sage, s * 0.91, 0.44, 0, { seg: 16, rx: Math.PI / 2 }); }
    box(g, 0.32, 0.3, 0.1, C.terra, 0.55, 0.4, -0.15, { r: 0.05, rx: -0.15 });
  },
  loungeChairRelax(g, { cyl, piece, C, THREE }) {
    // a barrel armchair in blush velvet on a brass ring
    piece(g, new THREE.TorusGeometry(0.3, 0.012, 6, 32), C.char, 0, 0.04, 0, { rx: Math.PI / 2 });
    cyl(g, 0.34, 0.32, 0.22, C.blush, 0, 0.06, 0, { seg: 32 });
    const back = piece(g, new THREE.CylinderGeometry(0.36, 0.36, 0.42, 32, 1, true, Math.PI * 0.55, Math.PI * 0.9), C.blush, 0, 0.47, 0, {});
    back.material = back.material.clone(); back.material.side = THREE.DoubleSide;
  },
  lampRoundFloor(g, { cyl, piece, C, THREE }) {
    cyl(g, 0.17, 0.18, 0.05, C.white, 0, 0, 0, { seg: 28 });
    piece(g, new THREE.TorusGeometry(0.55, 0.012, 6, 28, Math.PI * 0.62), C.char, 0.55, 0.05, 0, { rz: Math.PI * 0.38 });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff0d8 }));
    globe.position.set(0.97, 1.36, 0); g.add(globe);
  },
  cabinetTelevision(g, { box, C }) {
    box(g, 1.2, 0.32, 0.4, C.oak, 0, 0.08, 0, { r: 0.008 });
    box(g, 1.2, 0.01, 0.4, C.char, 0, 0.4, 0, { r: 0.003 });
    for (const x of [-0.55, 0.55]) box(g, 0.03, 0.08, 0.03, C.char, x, 0, 0, { r: 0.006 });
  },
  pottedPlant(g, { cyl, piece, C, THREE }) {
    cyl(g, 0.2, 0.16, 0.42, C.pot, 0, 0.04, 0, { seg: 24 });
    cyl(g, 0.17, 0.17, 0.04, C.char, 0, 0, 0, { seg: 24 });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, y = 0.72 + (i % 3) * 0.14, r = 0.08 + (i % 2) * 0.07;
      piece(g, new THREE.SphereGeometry(0.15, 10, 6), i % 3 ? C.leaf : C.leafDark, Math.cos(a) * r, y, Math.sin(a) * r, { rx: Math.sin(a) * 0.7, rz: -Math.cos(a) * 0.7 }).parent.scale.set(0.6, 1.4, 0.15);
    }
  },
};

const LUX = {
  name: 'lux',
  label: '現代奢華',
  furniture: { palette: LUX_C, material: luxMat, outline: false, pieces: LUX_PIECES },
  material: (color) => luxMat(color),
  floors(dark) {
    return {
      wood: [marble(dark, true), 2.4, 0.16],
      work: [luxCarpet(dark, 'work', dark ? '#2b2826' : '#5a5450', dark ? 'rgba(176,141,87,.18)' : 'rgba(176,141,87,.35)'), 1.2, 1],
      carpet: [luxCarpet(dark, 'navy', dark ? '#161d30' : '#25335a', 'rgba(201,169,110,.4)'), 1.0, 1],
      tiles: [checker(dark), 1.2, 0.2],
    };
  },
  wall(dark) {
    const m = new THREE.MeshStandardMaterial({ map: fluted(dark, false), bumpMap: fluted(dark, true), bumpScale: 2.5, roughness: 0.55 });
    m.userData.worldUV = 1.0;
    return m;
  },
  runner: false,
  light: { exposure: 1.04, hemi: 0xfff0dc, sun: 0xffe7c8, env: 0.4 },
  // Over each pod: an opal glass globe on a brass rod.
  pendant(THREE_, dark) {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), luxMat(LUX_C.char));
    rod.position.y = 0.38; g.add(rod);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.05, 16), luxMat(LUX_C.char));
    cap.position.y = 0.14; g.add(cap);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
    g.add(glow);
    return { group: g, glow };
  },
};

// ---- the Las Vegas casino decor --------------------------------------------

// The casino carpet: a deep ground under a big, quiet repeat: tone-on-tone
// scrolls and a thin muted-gold medallion on a diagonal lattice (two a
// picture). One accent colour, low contrast, so a whole floor of it still
// reads as casino without shouting.
function casinoCarpet(dark, key, ground) {
  return canvasTex(`casino${key}${dark}`, 512, (c, s) => {
    c.fillStyle = ground; c.fillRect(0, 0, s, s);
    const h = s / 2, Q = Math.PI / 2;
    const tiled = (x, y, draw) => { for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) draw(x + dx, y + dy); };
    // scrolls in the ground's own colour, a shade lighter, between the medallions
    c.lineWidth = 7; c.lineCap = 'round';
    c.strokeStyle = dark ? 'rgba(255,240,220,.06)' : 'rgba(255,240,220,.1)';
    for (const [x0, y0] of [[h, 0], [0, h]]) tiled(x0, y0, (x, y) => {
      for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + Math.cos(k * Q) * 50, y + Math.sin(k * Q) * 50, 44, k * Q + Math.PI * 0.6, k * Q + Math.PI * 1.4); c.stroke(); }
    });
    // the medallions: two thin rings and a four-point star
    const gold = dark ? 'rgba(214,170,80,.36)' : 'rgba(224,180,90,.48)';
    c.strokeStyle = gold; c.fillStyle = gold;
    for (const [x0, y0] of [[0, 0], [h, h]]) tiled(x0, y0, (x, y) => {
      c.lineWidth = 3; c.beginPath(); c.arc(x, y, 60, 0, 6.283); c.stroke();
      c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 50, 0, 6.283); c.stroke();
      c.beginPath(); c.moveTo(x, y - 28); c.lineTo(x + 8, y - 8); c.lineTo(x + 28, y); c.lineTo(x + 8, y + 8); c.lineTo(x, y + 28); c.lineTo(x - 8, y + 8); c.lineTo(x - 28, y); c.lineTo(x - 8, y - 8); c.closePath(); c.fill();
    });
    // little florets between them, teal and red, the busy casino floor
    for (const [x0, y0, col] of [[h, 0, 'rgba(63,190,180,.3)'], [0, h, 'rgba(63,190,180,.3)'], [h / 2, h / 2, 'rgba(220,70,80,.32)'], [h * 1.5, h * 1.5, 'rgba(220,70,80,.32)'], [h * 1.5, h / 2, 'rgba(232,192,96,.3)'], [h / 2, h * 1.5, 'rgba(232,192,96,.3)']]) tiled(x0, y0, (x, y) => {
      c.fillStyle = col;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + Math.cos(k * Q) * 9, y + Math.sin(k * Q) * 9, 8, 4, k * Q, 0, 6.283); c.fill(); }
      c.beginPath(); c.arc(x, y, 3.5, 0, 6.283); c.fill();
    });
    specks(c, s, 3000, ['rgba(255,255,255,.03)', 'rgba(0,0,0,.12)'], 1.6, 191);
  });
}
// Walls: burgundy damask over a dark wainscot with a gold rail (laid in
// metres: the rail runs at the same height along the whole wall).
function damask(dark) {
  return canvasTex(`damask${dark}`, 256, (c, s) => {
    c.fillStyle = dark ? '#3a1219' : '#6b1d2a'; c.fillRect(0, 0, s, s);
    c.fillStyle = dark ? 'rgba(214,170,74,.14)' : 'rgba(232,190,110,.22)';
    for (const [x, y] of [[s / 4, s / 4], [3 * s / 4, 3 * s / 4], [3 * s / 4, s / 4 - s / 2 + s], [s / 4, 3 * s / 4]]) {
      c.beginPath(); c.moveTo(x, y - 28); c.bezierCurveTo(x + 20, y - 10, x + 20, y + 10, x, y + 28); c.bezierCurveTo(x - 20, y + 10, x - 20, y - 10, x, y - 28); c.fill();
      c.beginPath(); c.arc(x, y, 6, 0, 6.283); c.fill();
    }
    specks(c, s, 800, ['rgba(0,0,0,.12)', 'rgba(255,255,255,.04)'], 1.4, 201);
  });
}
// Green baize, a little lighter in the middle, with the gold racetrack line.
function baize(key, w, h, line) {
  return canvasTex(key, 256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s * 0.6);
    g.addColorStop(0, '#2f8a55'); g.addColorStop(1, '#1d5e39');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    specks(c, s, 2000, ['rgba(255,255,255,.04)', 'rgba(0,0,0,.08)'], 1.2, 211);
    if (line) { c.strokeStyle = 'rgba(232,192,96,.8)'; c.lineWidth = 3; c.beginPath(); c.ellipse(s / 2, s / 2, s * 0.36, s * 0.3, 0, 0, 6.283); c.stroke(); }
  }, { repeat: false });
}
// The roulette layout: zero, three rows of red and black numbers.
const rouletteFelt = () => canvasTex('rlayout', 256, (c, s) => {
  c.fillStyle = '#1f6a40'; c.fillRect(0, 0, s, s);
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const x0 = s * 0.42, cw = (s * 0.55) / 12, ch = s * 0.22, y0 = s * 0.17;
  c.fillStyle = '#1f8a4c'; c.fillRect(x0 - cw * 1.2, y0, cw * 1.2, ch * 3);
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const n = col * 3 + (3 - row);
    c.fillStyle = RED.has(n) ? '#b3262f' : '#16181b';
    c.fillRect(x0 + col * cw + 1, y0 + row * ch + 1, cw - 2, ch - 2);
  }
  c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.strokeRect(x0 - cw * 1.2, y0, cw * 13.2, ch * 3);
}, { repeat: false });
// The wheel's pockets in their real order (office.js OfficeRoulette.WHEEL):
// pocket i is drawn from angle i/37 of a turn, so the ball can be sent there.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const wheelFace = () => canvasTex('rwheel', 256, (c, s) => {
  const n = 37, R = s / 2;
  for (let i = 0; i < n; i++) {
    const num = WHEEL[i];
    c.fillStyle = num === 0 ? '#1f8a4c' : REDS.has(num) ? '#b3262f' : '#16181b';
    c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, (i / n) * 6.283, ((i + 1) / n) * 6.283); c.closePath(); c.fill();
    c.save(); c.translate(R, R); c.rotate(((i + 0.5) / n) * 6.283); c.fillStyle = '#fff'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(num), R * 0.86, 0); c.restore();
  }
  c.fillStyle = '#6b3a1e'; c.beginPath(); c.arc(R, R, R * 0.55, 0, 6.283); c.fill();
  c.strokeStyle = '#d9b25a'; c.lineWidth = 4; c.beginPath(); c.arc(R, R, R * 0.55, 0, 6.283); c.stroke();
}, { repeat: false });
// A neon sign: the words in a coloured glow on black glass.
function neonSign(text, color, w, h) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.round(512 * h / w);
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(10,8,14,.92)'; c.fillRect(0, 0, cv.width, cv.height);
  c.font = `800 ${Math.round(cv.height * 0.55)}px ui-sans-serif, system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [blur, a] of [[28, 0.9], [12, 1]]) { c.shadowColor = color; c.shadowBlur = blur; c.fillStyle = color; c.globalAlpha = a; c.fillText(text, cv.width / 2, cv.height / 2); }
  c.shadowBlur = 0; c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = `800 ${Math.round(cv.height * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  c.fillText(text, cv.width / 2, cv.height / 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  // its glow on the wall round it (added light: brighter, never darker)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.45, h * 2.6), new THREE.MeshBasicMaterial({ map: glowTex(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.position.z = -0.004;
  sign.add(glow);
  sign.userData.glow = glow;
  return sign;
}
// A soft round glow, white in the middle (tinted by the material's colour).
const glowTex = () => canvasTex('glow', 128, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, s, s);
}, { repeat: false });
// A pool of warm light on a table, as if a spot shone on it from above.
function lightPool(o, w, d, y) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffd9a0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 3;
  o.casinoPools.push(m);
  return m;
}

// Static pieces merged by material: a bank of slot machines is a handful of
// draws, not a hundred (the parts that move or light up are left apart:
// userData.live). Call it before the group is placed.
function bake(g) {
  g.updateMatrixWorld(true);
  const by = new Map(), drop = [];
  g.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.userData.live || m.children.length) return;
    let list = by.get(m.material);
    if (!list) by.set(m.material, (list = []));
    list.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
    drop.push(m);
  });
  for (const m of drop) m.parent.remove(m);
  for (const [mat, geos] of by) {
    const mm = new THREE.Mesh(mergeGeometries(geos), mat);
    mm.castShadow = mm.receiveShadow = true;
    g.add(mm);
  }
  return g;
}

// The slot machines' own looks: each has a name on its lit topper and a
// sunburst on its belly glass, chrome down its sides, lit strips on its
// front edges (the colours run round, vegasAnimate) and four lit buttons.
const SLOT_THEMES = [['777', '#b3122a', '#ffd23f'], ['JACKPOT', '#5a1aa8', '#ffd23f'], ['WILD', '#0d6f80', '#fff1a8'], ['DIAMOND', '#1a3aa8', '#bfe9ff'], ['LUCKY 8', '#a8122a', '#ffe08a'], ['BAR', '#1f7a3a', '#ffe08a']];
const SLOT = {};
function slotParts() {
  if (SLOT.chrome) return SLOT;
  SLOT.chrome = new THREE.MeshStandardMaterial({ color: 0xe3e6ec, metalness: 0.9, roughness: 0.22 });
  SLOT.led = new THREE.MeshBasicMaterial({ color: 0xff3fa4, toneMapped: false });
  SLOT.buttons = [0xff3b3b, 0xffd23f, 0x3bdc6a, 0x3fa0ff].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  SLOT.reels = new THREE.MeshBasicMaterial({ map: slotReels(), toneMapped: false });
  SLOT.top = SLOT_THEMES.map((th, k) => new THREE.MeshBasicMaterial({ map: topperTex(k), toneMapped: false }));
  SLOT.belly = SLOT_THEMES.map((th, k) => new THREE.MeshBasicMaterial({ map: bellyTex(k), toneMapped: false }));
  return SLOT;
}
// (drawn on a square canvas for a plane 1.9 times as wide: squeezed to suit)
const topperTex = (k) => canvasTex(`topper${k}`, 256, (c, s) => {
  const [text, bg, ink] = SLOT_THEMES[k], W = s * 1.9;
  c.scale(1 / 1.9, 1);
  const g = c.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#fff6'); g.addColorStop(0.12, bg); g.addColorStop(1, '#14080c');
  c.fillStyle = bg; c.fillRect(0, 0, W, s); c.fillStyle = g; c.fillRect(0, 0, W, s);
  // a row of bulbs round the edge
  for (let x = 14; x < W; x += 26) for (const y of [12, s - 12]) { c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(x, y, 6, 0, 6.283); c.fill(); }
  c.font = `900 ${text.length > 4 ? 92 : 128}px ui-sans-serif, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = 14; c.strokeStyle = '#2a0a10'; c.strokeText(text, W / 2, s / 2 + 6);
  c.shadowColor = ink; c.shadowBlur = 18; c.fillStyle = ink; c.fillText(text, W / 2, s / 2 + 6);
  c.shadowBlur = 0; c.fillStyle = '#fff'; c.globalAlpha = 0.45; c.fillText(text, W / 2, s / 2 + 2);
}, { repeat: false });
const bellyTex = (k) => canvasTex(`belly${k}`, 128, (c, s) => {
  const [, bg, ink] = SLOT_THEMES[k];
  c.fillStyle = bg; c.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(255,240,190,.22)';
  for (let a = 0; a < 16; a++) { c.beginPath(); c.moveTo(s / 2, s * 0.62); c.arc(s / 2, s * 0.62, s, (a / 16) * 6.283, ((a + 0.5) / 16) * 6.283); c.closePath(); c.fill(); }
  c.fillStyle = ink; c.font = '900 44px ui-sans-serif, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.strokeStyle = '#2a0a10'; c.lineWidth = 6; c.strokeText('$', s / 2, s * 0.6); c.fillText('$', s / 2, s * 0.6);
  c.strokeStyle = ink; c.lineWidth = 4; c.strokeRect(4, 4, s - 8, s - 8);
}, { repeat: false });
// The progressive jackpot over a bank of slots: the amount in red LED
// figures, creeping up (one picture for every bank, redrawn a few times a second).
let jackpotCanvas = null;
const JACKPOT_AT = Date.UTC(2026, 0, 1);
export function jackpotAmount(now = Date.now()) { return 1_234_567.89 + ((now - JACKPOT_AT) / 1000 % 864000) * 1.37; }
function drawJackpot(c, now) {
  const w = c.canvas.width, h = c.canvas.height;
  c.fillStyle = '#0b0608'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#d9b25a'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#ffd23f'; c.font = '800 30px ui-sans-serif, system-ui, sans-serif'; c.fillText('PROGRESSIVE JACKPOT', w / 2, 34);
  const amt = '$' + jackpotAmount(now).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  c.font = '800 66px ui-monospace, Menlo, monospace'; c.shadowColor = '#ff2a2a'; c.shadowBlur = 16; c.fillStyle = '#ff4a3a';
  c.fillText(amt, w / 2, 92); c.shadowBlur = 0;
}
function jackpotBoard(o, width) {
  if (!jackpotCanvas) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    jackpotCanvas = cv.getContext('2d'); drawJackpot(jackpotCanvas, Date.now());
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    texCache.set('jackpot', t);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texCache.get('jackpot'), toneMapped: false }));
  m.userData.live = true;
  if (!o.casinoSlots.includes(m.material)) o.casinoSlots.push(m.material); // dimmed after hours like the slots
  return m;
}

// The meeting room's table, as a baccarat table: mahogany with a green top
// and a gold edge, on two pedestals.
function baccarat(g, { box, cyl, C }) {
  box(g, 2.4, 0.06, 1.15, C.oak, 0, 0.66, 0, { r: 0.02 });
  box(g, 2.2, 0.012, 0.98, C.sage, 0, 0.72, 0, { r: 0.006 });
  for (const [w, d, x, z] of [[2.4, 0.03, 0, -0.56], [2.4, 0.03, 0, 0.56], [0.03, 1.15, -1.19, 0], [0.03, 1.15, 1.19, 0]]) box(g, w, 0.02, d, C.char, x, 0.72, z, { r: 0.004 });
  for (const s of [-1, 1]) { cyl(g, 0.1, 0.13, 0.62, C.oakDark, s * 0.75, 0.04, 0, { seg: 20 }); cyl(g, 0.28, 0.3, 0.04, C.char, s * 0.75, 0, 0, { seg: 28 }); }
}

const VEGAS_C = {
  oak: 0x7a2f22, oakDark: 0x141215, white: 0xf0e6d2, cream: 0xe9dcc0, char: 0xc9a04a, ink: 0x101012,
  steel: 0xd4b05c, sage: 0x1e6b45, terra: 0x8e1b2b, mustard: 0xc9a04a, blue: 0x1f2e6b, blush: 0xcdae8c,
  leaf: 0x4f7f4a, leafDark: 0x355e36, pot: 0x141215, glass: 0x9fc4dd,
};
const vegasMat = materials(new Map([
  [VEGAS_C.oak, 'mahogany'], [VEGAS_C.oakDark, 'gloss'], [VEGAS_C.white, 'leather'], [VEGAS_C.cream, 'leather'],
  [VEGAS_C.char, 'brass'], [VEGAS_C.ink, 'gloss'], [VEGAS_C.steel, 'brass'], [VEGAS_C.sage, 'velvet'],
  [VEGAS_C.terra, 'velvet'], [VEGAS_C.blue, 'velvet'], [VEGAS_C.blush, 'velvet'], [VEGAS_C.pot, 'gloss'],
]));
LOOKS.mahogany = () => ({ color: 0xffffff, map: grain('mahogany', '#7a2f22', 'rgba(25,8,4,A)', 64), roughness: 0.32 });

// The casino's tables, built for the casino layout (office.js): a Texas
// hold'em table under its lamp, the seats round it, a roulette table.
function vegasBuild(p, o) {
  const M = vegasMat, C = VEGAS_C;
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  if (p.t === 'pokerTable') {
    const g = new THREE.Group(), rx = p.w / 2, rz = p.d / 2;
    const oval = (r, h, mat, y) => { const m = mesh(new THREE.CylinderGeometry(1, 1, h, 48), mat, 0, y, 0); m.scale.set(r * rx, 1, r * rz); return m; };
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.66, 24), M(C.oakDark), 0, 0.33, 0));
    g.add(oval(1.0, 0.1, M(C.oak), 0.7));                                   // the wooden apron
    const rail = mesh(new THREE.TorusGeometry(1, 0.07, 10, 64), M(C.ink), 0, 0.77, 0);
    rail.rotation.x = Math.PI / 2; rail.scale.set(rx * 0.97, rz * 0.94, 1); g.add(rail);  // padded leather rail
    const felt = oval(0.9, 0.02, new THREE.MeshStandardMaterial({ map: baize('pokerfelt', 1, 1, true), roughness: 1 }), 0.76);
    g.add(felt);
    g.add(lightPool(o, p.w * 1.1, p.d * 1.3, 0.775));
    // The game being played (office.js stepPoker) shows here: the board,
    // two cards in front of each player (yours face up), the pot, the dealer
    // button. Updated by vegasAnimate when the game changes.
    const cardGeo = new THREE.PlaneGeometry(0.09, 0.13);
    const flat = (x, z, rot = 0) => { const m = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.6 })); m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, 0.773, z); m.visible = false; g.add(m); return m; };
    const board = [0, 1, 2, 3, 4].map((k) => flat(-0.24 + k * 0.12, 0));
    // (the two far seats sit wider apart: the dealer's chair is between them)
    const HOLE = [[-0.72, -0.3], [0.72, -0.3], [-0.6, 0.34], [0.6, 0.34], [-0.86, 0], [0.86, 0]];
    const hole = HOLE.map(([x, z]) => [flat(x - 0.05, z, 0.15), flat(x + 0.05, z, -0.15)]);
    const potMat = new THREE.MeshStandardMaterial({ color: 0xb3262f, roughness: 0.5 });
    const pot = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 16), potMat, 0, 0.78, 0.17); pot.visible = false; g.add(pot);
    const button = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), 0, 0.776, 0); button.visible = false; g.add(button);
    o.casinoPoker = { board, hole, pot, button, HOLE, sig: '', at: { x: p.x + rx, z: p.y + rz } };
    // a stack is one cylinder with stripes painted round it (cheap to draw)
    const chipMats = [0xb3262f, 0x1f4fb3, 0x16181b, 0x1f8a4c, 0xf0e6d2].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    const chip = (x, z, n, col) => g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.009 * n, 14), chipMats[Math.abs(col) % 5], x, 0.772 + 0.0045 * n, z));
    chip(0, 0.18, 7, 0); chip(0.07, 0.2, 4, 1);
    for (const [x, z] of [[-0.8, -0.34], [0.8, -0.34], [-0.6, 0.36], [0.6, 0.36], [-0.95, 0], [0.95, 0]]) chip(x * 0.85, z * 0.85, 3 + Math.round(Math.abs(x * 5)) % 4, Math.round((x + z) * 7));
    // in front of the dealer's chair: his chip tray and the deck
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.08), M(C.ink), 0, 0.78, -0.45));
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.BoxGeometry(0.05, 0.022, 0.06), chipMats[k], -0.12 + k * 0.06, 0.79, -0.45));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.025, 0.1), new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.6 }), -0.24, 0.785, -0.38));
    // the lamp over the table: a green shade, glowing underneath (short
    // enough that the far seats and the dealer show past it)
    const shade = mesh(new THREE.BoxGeometry(0.9, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x1e5a3a, roughness: 0.5 }), 0, 1.85, 0);
    shade.castShadow = false; g.add(shade);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.25), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    under.rotation.x = Math.PI / 2; under.position.set(0, 1.77, 0); g.add(under);
    (o.casinoLamps || (o.casinoLamps = [])).push(under);
    for (const x of [-0.36, 0.36]) g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 4), M(C.char), x, 2.17, 0));
    g.position.set(p.x + rx, 0, p.y + rz);
    return g;
  }
  if (p.t === 'pokerSeat') {
    const g = new THREE.Group();
    for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) g.add(mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.42, 8), M(C.char), x, 0.21, z));
    const seat = mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.1, 24), M(C.terra), 0, 0.46, 0); g.add(seat);
    const back = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 24, 1, true, Math.PI * 0.65, Math.PI * 0.7), M(C.terra).clone(), 0, 0.66, 0);
    back.material.side = THREE.DoubleSide; g.add(back);
    g.rotation.y = p.yaw || 0;
    g.position.set(p.x, 0, p.y);
    return g;
  }
  if (p.t === 'roulette') {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(p.w, 0.8, p.d), M(C.oak), 0, 0.4, 0));
    const top = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.1, p.d - 0.1), new THREE.MeshStandardMaterial({ map: rouletteFelt(), roughness: 1 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.805; g.add(top);
    g.add(lightPool(o, p.w * 1.2, p.d * 1.6, 0.81));
    // the wheel at the left end: a bowl, the turning numbers, a gold turret
    const wx = -p.w / 2 + 0.36;
    g.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.1, 32), M(C.oak), wx, 0.85, 0));
    const wheel = new THREE.Mesh(new THREE.CircleGeometry(0.29, 37), new THREE.MeshStandardMaterial({ map: wheelFace(), roughness: 0.35 }));
    wheel.rotation.x = -Math.PI / 2; wheel.position.set(wx, 0.905, 0); g.add(wheel);
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.08, 12), M(C.char), wx, 0.94, 0));
    // the ball rides on the wheel (its child): sent round, it settles in the pocket that came up
    const ball = mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }), 0, 0, 0.014);
    ball.castShadow = false; wheel.add(ball);
    g.position.set(p.x + p.w / 2, 0, p.y + p.d / 2);
    g.userData.roulette = { wheel, ball, wx };
    (o.casinoWheels || (o.casinoWheels = [])).push(g.userData.roulette);
    return g;
  }
  if (p.t === 'bigSix') {
    // A money wheel standing upright, facing the room: 24 slots of 1, 2, 5,
    // 10, 20 and the two stars, a ring of bulbs, a leather pointer on top.
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), M(C.oak), 0, 0.45, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10), M(C.char), 0, 1.1, -0.05));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.MeshStandardMaterial({ map: bigSixFace(), roughness: 0.4 }));
    face.position.set(0, 1.62, 0.02); g.add(face);
    const rim = mesh(new THREE.TorusGeometry(0.52, 0.03, 8, 48), M(C.char), 0, 1.62, 0.02); g.add(rim);
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.12, 4), M(C.terra), 0, 2.17, 0.06));
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 20);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; mm.makeTranslation(Math.cos(a) * 0.56, 1.62 + Math.sin(a) * 0.56, 0.05); bulbs.setMatrixAt(i, mm); bulbs.setColorAt(i, new THREE.Color(0xffd77a)); }
    g.add(bulbs);
    g.position.set(p.x + 0.35, 0, p.y + 0.35);
    o.casinoSpin.push({ face, bulbs, n: 20 });
    return g;
  }
  if (p.t === 'blackjack') {
    // A half-moon table: the dealer stands at the straight back edge, the
    // players sit round the curve; "BLACKJACK PAYS 3 TO 2" on the felt.
    const g = new THREE.Group(), r = p.w / 2;
    const half = (rad, h, mat, y) => { const m = mesh(new THREE.CylinderGeometry(rad, rad, h, 40, 1, false, -Math.PI / 2, Math.PI), mat, 0, y, 0); m.scale.set(1, 1, (p.d * 1.6) / p.w); return m; };
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.66, 0.3), M(C.oakDark), 0, 0.33, 0.1));
    g.add(half(r, 0.1, M(C.oak), 0.7));
    g.add(half(r * 0.92, 0.02, new THREE.MeshStandardMaterial({ map: blackjackFelt(), roughness: 1 }), 0.76));
    { const lp = lightPool(o, p.w * 1.1, p.d * 2, 0.775); lp.position.z = 0.3; g.add(lp); }
    const rail = mesh(new THREE.TorusGeometry(r * 0.97, 0.05, 8, 40, Math.PI), M(C.ink), 0, 0.77, 0);
    rail.rotation.x = Math.PI / 2; rail.rotation.z = Math.PI; rail.scale.set(1, (p.d * 1.6) / p.w, 1); g.add(rail);
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.04, 0.12), M(C.ink), 0, 0.79, 0.04));     // the chip tray
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), M(C.terra), 0.42, 0.81, 0.08)); // the shoe
    const card = new THREE.MeshStandardMaterial({ color: 0xfaf8f2, roughness: 0.6 });
    for (const [x, z] of [[-0.45, 0.42], [0, 0.6], [0.45, 0.42], [0, 0.22]]) { g.add(mesh(new THREE.BoxGeometry(0.08, 0.004, 0.11), card, x - 0.03, 0.775, z)); g.add(mesh(new THREE.BoxGeometry(0.08, 0.004, 0.11), card, x + 0.04, 0.778, z + 0.02)); }
    g.position.set(p.x + p.w / 2, 0, p.y);
    return g;
  }
  if (p.t === 'craps') {
    // A long tub with padded walls and the craps layout on its floor; the dice
    // tumble now and then.
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(p.w, 0.72, p.d), M(C.oak), 0, 0.36, 0));
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.16, p.d - 0.16), new THREE.MeshStandardMaterial({ map: crapsFelt(), roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.73; g.add(bed);
    g.add(lightPool(o, p.w * 1.1, p.d * 1.5, 0.735));
    for (const [w, d, x, z] of [[p.w, 0.08, 0, -p.d / 2 + 0.04], [p.w, 0.08, 0, p.d / 2 - 0.04], [0.08, p.d, -p.w / 2 + 0.04, 0], [0.08, p.d, p.w / 2 - 0.04, 0]]) g.add(mesh(new THREE.BoxGeometry(w, 0.2, d), M(C.ink), x, 0.82, z));
    const die = new THREE.MeshStandardMaterial({ color: 0xc0262f, roughness: 0.3 });
    const dice = [0, 1].map((k) => { const d = mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), die, 0.2 + k * 0.08, 0.76, 0); g.add(d); return d; });
    g.position.set(p.x + p.w / 2, 0, p.y + p.d / 2);
    o.casinoDice.push({ dice, w: p.w, d: p.d });
    return g;
  }
  // A slot machine (k: which one, SLOT_THEMES): a black cabinet with chrome
  // sides and lit edges, reels in a gold frame, a lit topper with its name, a
  // chrome crown, the belly glass, a deck of lit buttons and a pull handle;
  // facing +z, its middle at the origin. Baked by the caller.
  const cabinet = (k = 0) => {
    const S = slotParts(), g = new THREE.Group();
    k %= SLOT_THEMES.length;
    const flat = (w, h, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); g.add(m); return m; };
    g.add(mesh(new THREE.BoxGeometry(0.62, 1.45, 0.6), M(C.ink), 0, 0.72, 0));
    for (const sd of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.035, 1.52, 0.62), S.chrome, sd * 0.33, 0.76, 0));
      g.add(mesh(new THREE.BoxGeometry(0.024, 1.36, 0.024), S.led, sd * 0.3, 0.8, 0.305));
    }
    g.add(mesh(new THREE.BoxGeometry(0.56, 0.44, 0.02), M(C.char), 0, 1.06, 0.297));
    flat(0.5, 0.36, S.reels, 0, 1.06, 0.309);
    flat(0.5, 0.42, S.belly[k], 0, 0.4, 0.302);
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.36, 0.44), M(C.ink), 0, 1.66, -0.03));
    flat(0.62, 0.32, S.top[k], 0, 1.66, 0.192);
    const crown = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.68, 18), S.chrome, 0, 1.84, -0.03);
    crown.rotation.z = Math.PI / 2; crown.scale.set(0.5, 1, 1); g.add(crown);
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.06, 0.22), M(C.char), 0, 0.78, 0.38));
    S.buttons.forEach((b, i) => g.add(mesh(new THREE.BoxGeometry(0.075, 0.018, 0.05), b, -0.21 + i * 0.14, 0.818, 0.42)));
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.05, 0.012), M(C.oakDark), 0.18, 0.6, 0.302)); // the note slot
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), S.chrome, 0.37, 1.05, 0.1));
    g.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), M(C.terra), 0.37, 1.24, 0.1));
    for (const m of [S.top[k], S.belly[k]]) if (!o.casinoSlots.includes(m)) o.casinoSlots.push(m);
    return g;
  };
  if (p.t === 'arcade') {
    // In the casino the arcade cabinet is a slot machine.
    const g = bake(cabinet(Math.round(p.x + p.y * 3)));
    // 2F's cabinets stand by the right wall, turned to the room (their players stand at -x).
    if (o.plan.floor === 2) g.rotation.y = -Math.PI / 2;
    g.position.set(p.x + 0.35, 0, p.y + 0.35);
    return g;
  }
  if (p.t === 'slotBank') {
    // Upstairs (office.js casinoPit): slot machines side by side, their
    // toppers in turn pink, gold, cyan.
    const g = new THREE.Group();
    for (let k = 0; k < p.n; k++) {
      const c = cabinet(k + Math.round(p.x + p.y));
      c.position.set(p.step * (k + 0.5), 0, 0.31);
      g.add(c);
    }
    bake(g);
    // the progressive jackpot over them, on two brass posts at the back
    const bw = Math.min(1.7, p.step * p.n * 0.8);
    for (const sd of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), M(C.char), p.step * p.n / 2 + sd * bw * 0.4, 2.08, 0.06));
    const board = jackpotBoard(o, bw);
    board.position.set(p.step * p.n / 2, 2.2, 0.08);
    g.add(board);
    g.position.set(p.x, 0, p.y);
    return g;
  }
  if (p.t === 'sicbo') {
    // Sic bo: a table with the bets laid out on its felt and three dice under
    // a glass dome in the middle, shaken now and then (vegasAnimate).
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(p.w, 0.74, p.d), M(C.oak), 0, 0.37, 0));
    g.add(mesh(new THREE.BoxGeometry(p.w + 0.08, 0.05, p.d + 0.08), M(C.ink), 0, 0.76, 0));
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.12, p.d - 0.12), new THREE.MeshStandardMaterial({ map: sicboFelt(), roughness: 1 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.787; g.add(felt);
    g.add(lightPool(o, p.w * 1.2, p.d * 1.6, 0.79));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 28), M(C.char), 0, 0.8, 0));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false }));
    dome.position.y = 0.82; g.add(dome);
    const die = new THREE.MeshStandardMaterial({ color: 0xfaf8f2, roughness: 0.3 });
    const dice = [0, 1, 2].map((k) => { const d = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), die, -0.07 + k * 0.07, 0.85, (k % 2) * 0.05 - 0.02); g.add(d); return d; });
    g.position.set(p.x + p.w / 2, 0, p.y + p.d / 2);
    o.casinoDice.push({ dice, shake: dice.map((d) => d.position.clone()) });
    return g;
  }
  if (p.t === 'booth') {
    // The phone booth becomes the cashier's cage: a mahogany counter, gold
    // bars, a "CASHIER" sign (the phone is still inside).
    const g = new THREE.Group(), { x, y } = p;
    const add = (w, h, d, mat, px, py, pz) => g.add(mesh(new THREE.BoxGeometry(w, h, d), mat, px, py, pz));
    add(1.3, 2.0, 0.06, M(C.oak), 0.65, 1.0, -0.02);           // back
    add(0.06, 2.0, 1.3, M(C.oak), -0.02, 1.0, 0.65);           // left
    add(0.06, 1.0, 1.3, M(C.oak), 1.28, 0.5, 0.65);            // right, counter height
    add(0.85, 1.0, 0.06, M(C.oak), 0.43, 0.5, 1.28);           // front, counter height
    add(1.4, 0.05, 0.12, M(C.white), 0.65, 1.02, 1.28);        // marble ledges
    add(0.12, 0.05, 1.4, M(C.white), 1.28, 1.02, 0.65);
    for (let k = 0; k <= 8; k++) { add(0.015, 0.95, 0.015, M(C.char), 0.05 + k * 0.1, 1.5, 1.28); add(0.015, 0.95, 0.015, M(C.char), 1.28, 1.5, 0.05 + k * 0.15); }
    add(1.4, 0.08, 1.4, M(C.char), 0.65, 2.0, 0.65);
    const sign = neonSign('CASHIER', '#ffd23f', 1.0, 0.24);
    sign.position.set(0.65, 2.2, 1.32); g.add(sign);
    o.place('stoolBar', 0.45, 0.4, 0.4, 0.4, { h: 0.5, group: g });
    g.position.set(x, 0, y);
    return g;
  }
  return null;
}
// Playing cards: one small picture per card, drawn when first needed.
const SUIT_CH = '♠♥♦♣', RANK_CH = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function cardFace(c) {
  return canvasTex(`card${c}`, 64, (g, s) => {
    const red = Math.floor(c / 13) === 1 || Math.floor(c / 13) === 2;
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, s, s);
    g.fillStyle = red ? '#c0262f' : '#16181b';
    g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(RANK_CH[c % 13], s / 2, s * 0.32);
    g.font = '28px sans-serif'; g.fillText(SUIT_CH[Math.floor(c / 13)], s / 2, s * 0.72);
  }, { repeat: false });
}
const cardBack = () => canvasTex('cardback', 64, (g, s) => {
  g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#8e1b2b'; g.fillRect(4, 4, s - 8, s - 8);
  g.strokeStyle = 'rgba(255,215,130,.8)'; g.lineWidth = 2;
  for (let k = -s; k < s; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + s, s); g.stroke(); }
}, { repeat: false });

// The big six's face: 24 coloured slots with their payouts.
const bigSixFace = () => canvasTex('bigsix', 256, (c, s) => {
  const R = s / 2, n = 24, vals = ['1', '2', '1', '5', '1', '2', '10', '1', '2', '1', '5', '★', '1', '2', '1', '5', '1', '20', '2', '1', '5', '1', '2', '★'];
  const cols = { 1: '#f2e6c9', 2: '#4c7fd9', 5: '#e14c4c', 10: '#3fb36b', 20: '#9b5de5', '★': '#ffd23f' };
  for (let i = 0; i < n; i++) {
    c.fillStyle = cols[vals[i]]; c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, (i / n) * 6.283, ((i + 1) / n) * 6.283); c.closePath(); c.fill();
    c.save(); c.translate(R, R); c.rotate(((i + 0.5) / n) * 6.283); c.fillStyle = '#16181b'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; c.fillText(vals[i], R * 0.78, 6); c.restore();
  }
  c.strokeStyle = '#7a5a20'; c.lineWidth = 2;
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.283; c.beginPath(); c.moveTo(R, R); c.lineTo(R + Math.cos(a) * R, R + Math.sin(a) * R); c.stroke(); }
  c.fillStyle = '#c9a04a'; c.beginPath(); c.arc(R, R, R * 0.3, 0, 6.283); c.fill();
}, { repeat: false });
const blackjackFelt = () => canvasTex('bjfelt', 256, (c, s) => {
  const g = c.createRadialGradient(s / 2, 0, 10, s / 2, 0, s); g.addColorStop(0, '#2f8a55'); g.addColorStop(1, '#1d5e39');
  c.fillStyle = g; c.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(232,192,96,.9)'; c.font = 'bold 15px serif'; c.textAlign = 'center';
  c.fillText('BLACKJACK PAYS 3 TO 2', s / 2, s * 0.62);
  c.strokeStyle = 'rgba(232,192,96,.7)'; c.lineWidth = 2; c.beginPath(); c.arc(s / 2, 0, s * 0.42, 0, Math.PI); c.stroke();
}, { repeat: false });
// Sic bo's layout: SMALL and BIG at the ends, the triples and totals between.
const sicboFelt = () => canvasTex('sicbo', 256, (c, s) => {
  c.fillStyle = '#123f2a'; c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(255,215,130,.85)'; c.lineWidth = 3; c.strokeRect(8, 8, s - 16, s - 16);
  c.fillStyle = '#8e1b2b'; c.fillRect(14, 14, 60, s - 28); c.fillRect(s - 74, 14, 60, s - 28);
  c.fillStyle = '#ffe2a8'; c.font = 'bold 24px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.translate(44, s / 2); c.rotate(-Math.PI / 2); c.fillText('小 SMALL', 0, 0); c.restore();
  c.save(); c.translate(s - 44, s / 2); c.rotate(Math.PI / 2); c.fillText('大 BIG', 0, 0); c.restore();
  c.font = 'bold 15px sans-serif'; c.lineWidth = 1.5;
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
    const x = 84 + k * 22, y = 40 + r * 64;
    c.strokeRect(x, y, 20, 52);
    c.fillText(String(4 + r * 4 + k), x + 10, y + 26);
  }
}, { repeat: false });
const crapsFelt = () => canvasTex('craps', 256, (c, s) => {
  c.fillStyle = '#1f6a40'; c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2;
  c.strokeRect(8, 8, s - 16, s - 16); c.strokeRect(s * 0.3, s * 0.3, s * 0.4, s * 0.4);
  c.fillStyle = 'rgba(255,255,255,.85)'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center';
  c.fillText('PASS LINE', s / 2, s * 0.2); c.fillText('COME', s / 2, s * 0.52); c.fillText("DON'T PASS", s / 2, s * 0.86);
  c.fillStyle = '#b3262f'; c.fillText('FIELD 2·3·4·9·10·11·12', s / 2, s * 0.68);
}, { repeat: false });
// One picture of three reels for every slot cabinet (a little shine moves over them).
let reelCanvas = null;
const slotReels = () => canvasTex('reels', 128, (c, s) => {
  reelCanvas = c;
  drawReels(c, s, 0);
}, { repeat: false });
function drawReels(c, s, t) {
  const sym = ['7', '🍒', 'BAR', '🔔', '💎', '🍋'];
  c.fillStyle = '#fbf6e8'; c.fillRect(0, 0, s, s);
  for (let k = 0; k < 3; k++) {
    const x = k * s / 3;
    c.fillStyle = k % 2 ? '#f3ead2' : '#fbf6e8'; c.fillRect(x, 0, s / 3, s);
    const off = (t * (2 + k) * 40) % (s / 3);
    c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let r = -1; r < 4; r++) { const i = (r + Math.floor(t * (2 + k) * 1.2) + k * 2) % sym.length; c.fillStyle = sym[(i + sym.length) % sym.length] === '7' ? '#c0262f' : '#2a2a2e'; c.fillText(sym[(i + sym.length) % sym.length], x + s / 6, r * s / 3 + s / 6 + off - s / 3); }
  }
  c.fillStyle = 'rgba(192,38,47,.8)'; c.fillRect(0, s / 2 - 1, s, 2);
}

// Lights: a row of marquee bulbs chasing along the top of both walls (one
// instanced mesh, its colours stepped ten times a second), neon signs.
function vegasExtras(o) {
  const { W, D } = o.plan, H = 2.4;
  const spots = [];
  for (let x = 0.3; x < W - 0.1; x += 0.32) spots.push([x, H - 0.12, 0.03]);
  for (let z = 0.3; z < D - 0.1; z += 0.32) spots.push([0.03, H - 0.12, z]);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z], i) => { m.makeTranslation(x, y, z); bulbs.setMatrixAt(i, m); bulbs.setColorAt(i, new THREE.Color(0xffd77a)); });
  o.room.add(bulbs);
  const signs = [];
  if (o.plan.floor !== 2) {
    const add = (text, color, w, h, x, y, z, ry) => { const s = neonSign(text, color, w, h); s.position.set(x, y, z); s.rotation.y = ry; o.room.add(s); signs.push(s); };
    add("TEXAS HOLD'EM", '#ff3fa4', 1.8, 0.36, 3.4, 2.15, 5.05, 0); // on the meeting room's glass, over the table
    add('JACKPOT', '#ffd23f', 1.2, 0.3, 0.02, 2.1, 9.7, Math.PI / 2);
  } else {
    const add = (text, color, w, h, x, y, z, ry) => { const s = neonSign(text, color, w, h); s.position.set(x, y, z); s.rotation.y = ry; o.room.add(s); signs.push(s); };
    add('VIP LOUNGE', '#3fd0ff', 1.6, 0.34, 0.02, 1.9, Math.max(2, D - 5), Math.PI / 2);
    add('SLOTS', '#ff3fa4', 1.0, 0.32, 0.02, 1.95, Math.max(2, D - 9), Math.PI / 2);
  }
  return { bulbs, n: spots.length, signs, step: -1, col: new THREE.Color() };
}
function vegasAnimate(fx, t, closed, o) {
  // marquee: every third bulb lit, the pattern running along; dark after hours
  const step = closed ? -2 : Math.floor(t * 9);
  if (step !== fx.step) {
    fx.step = step;
    for (let i = 0; i < fx.n; i++) {
      const on = !closed && (i + step) % 3 === 0;
      fx.bulbs.setColorAt(i, fx.col.setHex(closed ? 0x2a2418 : on ? 0xfff0b8 : 0x8a6a2a));
    }
    fx.bulbs.instanceColor.needsUpdate = true;
  }
  // neon: a steady glow with a flicker now and then; low after hours
  for (const [k, s] of fx.signs.entries()) {
    const flick = !closed && Math.sin(t * 23 + k * 5) > 0.985 ? 0.4 : 1;
    s.material.opacity = closed ? 0.3 : 0.95 * flick;
    if (s.userData.glow) s.userData.glow.material.opacity = closed ? 0.06 : 0.5 * flick;
  }
  // the big six wheels turn slowly; their bulbs chase
  for (const w of o.casinoSpin || []) {
    if (!closed) w.face.rotation.z = -t * 0.6;
    for (let i = 0; i < w.n; i++) w.bulbs.setColorAt(i, fx.col.setHex(closed ? 0x2a2418 : (i + Math.floor(t * 8)) % 2 ? 0xfff0b8 : 0x8a6a2a));
    w.bulbs.instanceColor.needsUpdate = true;
  }
  // the dice: a throw every few seconds, tumbling for half a second
  for (const d of o.casinoDice || []) {
    const ph = t % 6;
    if (d.shake) {
      // sic bo: the dome is shaken, the dice rattle inside it and settle
      const sh = (t + 2.5) % 7;
      d.dice.forEach((die, k) => {
        const at = d.shake[k];
        if (!closed && sh < 0.9) { die.rotation.set(t * 19 + k, t * 15 + k, t * 9); die.position.set(at.x + Math.sin(t * 31 + k * 2) * 0.03, at.y + Math.abs(Math.sin(t * 27 + k)) * 0.07, at.z + Math.cos(t * 29 + k) * 0.03); }
        else if (sh < 0.93) { die.rotation.set(0, k * 0.7, 0); die.position.copy(at); }
      });
      continue;
    }
    d.dice.forEach((die, k) => {
      if (!closed && ph < 0.6) { die.rotation.set(t * 17 + k, t * 13, t * 11 + k); die.position.set(-d.w / 2 + 0.3 + ph * 2.6 + k * 0.08, 0.76 + Math.abs(Math.sin(ph * 12)) * 0.08, Math.sin(ph * 5 + k) * 0.2); }
      else if (ph < 0.62) die.rotation.set(0, k, 0);
    });
  }
  // the slot cabinets: reels spin (one shared picture), toppers glow; dark after hours
  if (reelCanvas && (!fx.reelAt || t - fx.reelAt > 0.12)) {
    fx.reelAt = t;
    drawReels(reelCanvas, reelCanvas.canvas.width, closed ? 0 : t);
    texCache.get('reels').needsUpdate = true;
  }
  for (const [k, m] of (o.casinoSlots || []).entries()) m.color.setScalar(closed ? 0.22 : 0.8 + 0.2 * Math.max(0, Math.sin(t * 2.5 + k * 1.3)));
  if (SLOT.led) SLOT.led.color.setHSL(closed ? 0.9 : (t * 0.12) % 1, 0.9, closed ? 0.06 : 0.55);
  for (const m of o.casinoPools || []) m.material.opacity = closed ? 0.05 : 0.32;
  if (jackpotCanvas && (!fx.jpAt || t - fx.jpAt > 0.25)) {
    fx.jpAt = t;
    drawJackpot(jackpotCanvas, Date.now());
    texCache.get('jackpot').needsUpdate = true;
  }
  // the hold'em table shows the game (office.js stepPoker): only redrawn when it changes
  const P = o.casinoPoker, game = o.poker;
  if (P) {
    const sig = (o.dealer ? 'D|' : '') + (!game || !game.hands ? 'none' : `${game.stage}|${game.board.length}|${[...game.folded].join()}|${Object.keys(game.hands).join()}|${game.pot}|${(game.seats || []).join()}`);
    if (sig !== P.sig) {
      P.sig = sig;
      const show = game && game.hands && game.stage !== 'idle';
      P.board.forEach((m, k) => {
        m.visible = !!show && k < game.board.length;
        if (m.visible) m.material.map = cardFace(game.board[k]), m.material.needsUpdate = true;
      });
      P.hole.forEach((pair, i) => {
        const key = show ? (game.seats || [])[i] : null, cards = key && game.hands[key];
        const inHand = !!cards && !game.folded.has(key);
        pair.forEach((m, k) => {
          m.visible = inHand;
          if (!inHand) return;
          const up = key === 'me' || game.stage === 'done';
          m.material.map = up ? cardFace(cards[k]) : cardBack(); m.material.needsUpdate = true;
        });
      });
      P.pot.visible = !!show && game.pot > 0;
      if (P.pot.visible) { const h = Math.min(0.2, 0.01 + game.pot / 2000); P.pot.scale.y = h; P.pot.position.y = 0.772 + h / 2; }
      // The dealer button: in front of Chuck when he's at the table (he
      // deals every hand), else by whoever deals this hand.
      const d = show && game.order && game.order.length ? (game.seats || []).indexOf(game.order[game.order.length - 1]) : -1;
      P.button.visible = !!o.dealer || d >= 0;
      if (o.dealer) P.button.position.set(Math.max(-0.5, Math.min(0.5, o.dealer.x - P.at.x)) + 0.2, 0.776, -0.36);
      else if (d >= 0) P.button.position.set(P.HOLE[d][0] * 0.75 + 0.12, 0.776, P.HOLE[d][1] * 0.75);
    }
  }
  // the lamp over the poker table: off after hours, like the rest
  for (const l of o.casinoLamps || []) l.material.color.setHex(closed ? 0x2a2418 : 0xffe2a8);
  // the roulette wheel follows the game (office.js stepRoulette): turning
  // slowly while bets are open, fast when spun; the ball runs round the other
  // way, slows and drops into the pocket of the number that came up
  const rl = o.roulette;
  for (const w of o.casinoWheels || []) {
    const dt = Math.min(0.1, t - (w.lt ?? t)); w.lt = t;
    const spinMs = 5000, k = rl && rl.stage === 'spin' ? Math.min(1, (Date.now() - rl.at) / spinMs) : 1;
    w.rot = (w.rot || 0) + dt * (rl && rl.stage === 'spin' ? 0.4 + 5 * (1 - k) * (1 - k) : 0.35);
    w.wheel.rotation.z = w.rot;
    const idx = rl && rl.number != null ? WHEEL.indexOf(rl.number) : 0;
    const home = -((idx + 0.5) / 37) * Math.PI * 2;
    const a = rl && rl.stage === 'spin' ? home + (1 - k) * (1 - k) * 46 : home;
    const rad = rl && rl.stage === 'spin' ? 0.27 - 0.045 * k * k : 0.225;
    w.ball.position.set(Math.cos(a) * rad, Math.sin(a) * rad, 0.014);
    w.ball.visible = !!(rl && rl.number != null);
  }
}

const VEGAS = {
  name: 'vegas',
  label: '拉斯維加斯',
  layout: 'casino',
  furniture: { palette: VEGAS_C, material: vegasMat, outline: false, pieces: { ...LUX_PIECES, table: baccarat } },
  material: (color) => vegasMat(color),
  floors(dark) {
    return {
      wood: [casinoCarpet(dark, 'red', dark ? '#36121a' : '#561a24'), 3.2, 1],
      work: [casinoCarpet(dark, 'navy', dark ? '#11152c' : '#1d2448'), 3.2, 1],
      carpet: [casinoCarpet(dark, 'royal', dark ? '#1c132b' : '#2b1f48'), 2.8, 1],
      tiles: [marble(true, true), 2.4, 0.16],
      mat: [casinoCarpet(dark, 'green', dark ? '#0f281c' : '#173d2b'), 2.8, 1],
    };
  },
  wall(dark) {
    const m = new THREE.MeshStandardMaterial({ map: damask(dark), roughness: 0.8 });
    m.userData.worldUV = 1.2;
    return m;
  },
  runner: false,
  light: { exposure: 1.0, hemi: 0xffe2c4, sun: 0xffd6a0, env: 0.32 },
  // Over each pod: a small gold chandelier, its crystals lit together.
  pendant(THREE_, dark) {
    const g = new THREE.Group();
    const gold = vegasMat(VEGAS_C.char);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45, 5), gold);
    rod.position.y = 0.4; g.add(rod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 28), gold);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; g.add(ring);
    const lit = new THREE.MeshBasicMaterial({ color: 0xffe7b0 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), lit);
    g.add(glow);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), lit);
      drop.position.set(Math.cos(a) * 0.22, 0.02, Math.sin(a) * 0.22); g.add(drop);
    }
    return { group: g, glow };
  },
  handles: ['pokerTable', 'pokerSeat', 'roulette', 'bigSix', 'blackjack', 'craps', 'arcade', 'booth', 'slotBank', 'sicbo'],
  build: vegasBuild,
  extras: vegasExtras,
  animate: vegasAnimate,
};

export const DECORS = { modern: MODERN, tech: TECH, lux: LUX, vegas: VEGAS };
export const DECOR_LIST = [{ id: 'default', label: '預設' }, { id: 'modern', label: MODERN.label }, { id: 'tech', label: TECH.label }, { id: 'lux', label: LUX.label }, { id: 'vegas', label: VEGAS.label }];
export function decorOf(id) { return DECORS[id] || null; }
