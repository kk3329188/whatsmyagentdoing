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

export const DECORS = { modern: MODERN, tech: TECH };
export const DECOR_LIST = [{ id: 'default', label: '預設' }, { id: 'modern', label: MODERN.label }, { id: 'tech', label: TECH.label }];
export function decorOf(id) { return DECORS[id] || null; }
