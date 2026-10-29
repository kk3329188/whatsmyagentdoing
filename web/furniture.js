// The office's furniture, made here (no imported models), in the same
// look as the people: soft rounded shapes, three-tone cartoon shading and a
// thin dark outline. One calm palette (oak, warm white, charcoal, sage,
// terracotta, mustard, dusty blue) ties every piece together.
//
// makeFurniture() returns { name: group } for every piece the office uses.
// Each piece stands on y = 0 with its front facing +z and is built at its
// real size; Office3D.place() then fits it to its spot on the floor plan.
// A monitor's screen is the mesh marked userData.screen.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OUTLINE } from './chibi.js';

const C = {
  oak: 0xc9a47e, oakDark: 0x8d6a4c, white: 0xe9e3d7, cream: 0xf3ecdf, char: 0x3a3e45, ink: 0x23262b,
  steel: 0xa3a9b0, sage: 0x8fb08c, terra: 0xcd8a68, mustard: 0xd7b260, blue: 0x7f9dbf, blush: 0xd8a6a2,
  leaf: 0x5e9a5b, leafDark: 0x447a46, pot: 0xd8c8b0, glass: 0x9fc4dd,
};

// Cartoon shading, softer than the people's so big surfaces never go muddy.
let ramp = null;
const mats = new Map();
export function soft(c) {
  const key = new THREE.Color(c).getHex();
  if (mats.has(key)) return mats.get(key);
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  const m = new THREE.MeshToonMaterial({ color: key, gradientMap: ramp });
  mats.set(key, m);
  return m;
}
const mat = soft;
const T = 0.009; // outline thickness

// One shape with its outline; dims come from the geometry's own bounds.
function piece(g, geo, color, x, y, z, { rx = 0, ry = 0, rz = 0, outline = true, m = null } = {}) {
  const grp = new THREE.Group();
  const mesh = new THREE.Mesh(geo, m || mat(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  grp.add(mesh);
  if (outline) {
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.set(1 + 2 * T / Math.max(s.x, 0.01), 1 + 2 * T / Math.max(s.y, 0.01), 1 + 2 * T / Math.max(s.z, 0.01));
    grp.add(o);
  }
  grp.position.set(x, y, z);
  grp.rotation.set(rx, ry, rz);
  g.add(grp);
  return mesh;
}

// Rounded box with its bottom-centre at (x, y, z).
const rb = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
function box(g, w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  return piece(g, rb(w, h, d, opts.r ?? 0.02), color, x, y + h / 2, z, opts);
}
function cyl(g, rt, rbot, h, color, x = 0, y = 0, z = 0, opts = {}) {
  return piece(g, new THREE.CylinderGeometry(rt, rbot, h, opts.seg || 16), color, x, y + h / 2, z, opts);
}
function ball(g, r, color, x, y, z, s = [1, 1, 1], opts = {}) {
  const m = piece(g, new THREE.SphereGeometry(r, 14, 10), color, x, y, z, opts);
  m.parent.scale.set(...s);
  return m;
}

// ---- the pieces ------------------------------------------------------------

const B = {
  // Work desk, 1.4 × 0.8 × 0.6: oak top on two white panel legs, a modesty
  // panel at the back and a little drawer unit.
  desk(g) {
    box(g, 1.4, 0.04, 0.8, C.oak, 0, 0.56, 0, { r: 0.015 });
    for (const s of [-1, 1]) box(g, 0.04, 0.56, 0.72, C.white, s * 0.65, 0, 0, { r: 0.01 });
    box(g, 1.26, 0.28, 0.03, C.white, 0, 0.26, -0.33, { r: 0.008 });
    box(g, 0.34, 0.4, 0.6, C.white, 0.42, 0.14, -0.04, { r: 0.015 });
    for (const y of [0.2, 0.34]) box(g, 0.08, 0.015, 0.012, C.char, 0.42, y, 0.265, { outline: false });
  },
  // Monitor, 0.6 × 0.2 × 0.5: round foot, stand, slim screen facing +z.
  computerScreen(g) {
    cyl(g, 0.09, 0.1, 0.015, C.char, 0, 0, -0.02);
    box(g, 0.05, 0.2, 0.03, C.char, 0, 0.01, -0.05, { r: 0.01 });
    box(g, 0.6, 0.36, 0.035, C.char, 0, 0.14, -0.02, { r: 0.02 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.31), new THREE.MeshStandardMaterial({ color: 0x1b1e24 }));
    screen.position.set(0, 0.32, 0.0);
    screen.userData.screen = true;
    g.add(screen);
  },
  computerKeyboard(g) {
    box(g, 0.5, 0.025, 0.15, C.white, 0, 0, 0, { r: 0.01 });
    for (let r = 0; r < 3; r++) box(g, 0.44, 0.01, 0.03, C.steel, 0, 0.025, -0.045 + r * 0.045, { r: 0.004, outline: false });
  },
  computerMouse(g) {
    ball(g, 0.04, C.white, 0, 0.012, 0, [0.85, 0.45, 1.3]);
  },
  // Laptop, opened, screen facing +z.
  laptop(g) {
    box(g, 0.45, 0.018, 0.32, C.steel, 0, 0, 0, { r: 0.01 });
    box(g, 0.45, 0.3, 0.015, C.steel, 0, 0.0, -0.17, { r: 0.01, rx: -0.25 });
    box(g, 0.38, 0.005, 0.14, C.char, 0, 0.018, 0.03, { r: 0.002, outline: false });
  },
  plantSmall1(g) { // round succulent
    cyl(g, 0.11, 0.08, 0.13, C.terra, 0, 0, 0);
    for (let i = 0; i < 7; i++) { const a = i * 0.9; ball(g, 0.05, i % 2 ? C.sage : C.leaf, Math.cos(a) * 0.05, 0.16 + (i % 3) * 0.02, Math.sin(a) * 0.05, [1, 0.7, 1]); }
  },
  plantSmall2(g) { // little cactus
    cyl(g, 0.1, 0.08, 0.12, C.cream, 0, 0, 0);
    piece(g, new THREE.CapsuleGeometry(0.045, 0.14, 4, 10), C.leafDark, 0, 0.23, 0);
    piece(g, new THREE.CapsuleGeometry(0.025, 0.05, 4, 8), C.leafDark, 0.06, 0.24, 0, { rz: -0.7 });
    ball(g, 0.018, C.blush, 0, 0.33, 0);
  },
  plantSmall3(g) { // leafy sprig
    cyl(g, 0.1, 0.085, 0.12, C.blue, 0, 0, 0);
    for (let i = 0; i < 6; i++) { const a = i * 1.05; piece(g, new THREE.SphereGeometry(0.06, 10, 8), C.leaf, Math.cos(a) * 0.05, 0.2, Math.sin(a) * 0.05, { rx: Math.sin(a) * 0.6, rz: -Math.cos(a) * 0.6 }).parent.scale.set(0.45, 1.4, 0.2); }
  },
  // Floor plant: a fat pot, a stem and a crown of big leaves.
  pottedPlant(g) {
    cyl(g, 0.24, 0.18, 0.36, C.pot, 0, 0, 0);
    cyl(g, 0.22, 0.22, 0.02, C.oakDark, 0, 0.35, 0, { outline: false });
    cyl(g, 0.02, 0.025, 0.4, C.oakDark, 0, 0.36, 0, { outline: false });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, y = 0.62 + (i % 3) * 0.12, r = 0.12 + (i % 2) * 0.06;
      piece(g, new THREE.SphereGeometry(0.13, 12, 8), i % 3 ? C.leaf : C.leafDark, Math.cos(a) * r, y, Math.sin(a) * r, { rx: Math.sin(a) * 0.8, rz: -Math.cos(a) * 0.8 }).parent.scale.set(0.75, 1.2, 0.25);
    }
  },
  // Desk lamp: round foot, bent arm, a cone shade with a warm glow.
  lampSquareTable(g) {
    cyl(g, 0.07, 0.08, 0.02, C.char, 0, 0, 0);
    box(g, 0.02, 0.22, 0.02, C.mustard, 0, 0.02, 0, { r: 0.008, rz: 0.2 });
    cyl(g, 0.03, 0.08, 0.09, C.mustard, 0.06, 0.22, 0.03, { rx: 0.5 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 1.2 }));
    bulb.position.set(0.06, 0.22, 0.05);
    g.add(bulb);
  },
  // Office chair: five-spoke base on casters, gas lift, cushioned seat,
  // a rounded back at -z and armrests.
  chairDesk(g) {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      box(g, 0.05, 0.03, 0.26, C.char, Math.sin(a) * 0.12, 0.04, Math.cos(a) * 0.12, { ry: a, r: 0.012 });
      ball(g, 0.03, C.ink, Math.sin(a) * 0.24, 0.03, Math.cos(a) * 0.24, [1, 1, 1], { outline: false });
    }
    cyl(g, 0.025, 0.025, 0.3, C.steel, 0, 0.06, 0, { outline: false });
    box(g, 0.5, 0.08, 0.48, C.terra, 0, 0.36, 0.02, { r: 0.035 });
    box(g, 0.46, 0.4, 0.07, C.terra, 0, 0.46, -0.24, { r: 0.04, rx: -0.12 });
    for (const s of [-1, 1]) {
      box(g, 0.03, 0.18, 0.03, C.char, s * 0.24, 0.42, 0.0, { r: 0.01 });
      box(g, 0.05, 0.03, 0.26, C.char, s * 0.24, 0.6, 0.02, { r: 0.012 });
    }
  },
  // Meeting chair: a soft shell on four oak legs.
  chairModernCushion(g) {
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(g, 0.035, 0.42, 0.035, C.oakDark, x, 0, z, { r: 0.012 });
    box(g, 0.52, 0.08, 0.5, C.sage, 0, 0.42, 0, { r: 0.04 });
    box(g, 0.52, 0.36, 0.08, C.sage, 0, 0.48, -0.22, { r: 0.04, rx: -0.1 });
  },
  // Long table (meeting room): thick oak top on two trestles.
  table(g) {
    box(g, 2.4, 0.06, 1.2, C.oak, 0, 0.69, 0, { r: 0.025 });
    for (const s of [-1, 1]) {
      box(g, 0.08, 0.66, 0.08, C.char, s * 1.0, 0.03, 0, { r: 0.02 });
      box(g, 0.1, 0.05, 0.9, C.char, s * 1.0, 0, 0, { r: 0.02 });
      box(g, 0.08, 0.05, 0.9, C.char, s * 1.0, 0.64, 0, { r: 0.02 });
    }
  },
  tableRound(g) {
    cyl(g, 0.45, 0.45, 0.05, C.oak, 0, 0.7, 0, { seg: 28 });
    cyl(g, 0.05, 0.06, 0.66, C.char, 0, 0.04, 0);
    cyl(g, 0.25, 0.28, 0.04, C.char, 0, 0, 0, { seg: 24 });
  },
  tableCoffee(g) {
    box(g, 1.2, 0.05, 0.6, C.oak, 0, 0.3, 0, { r: 0.025 });
    box(g, 1.1, 0.03, 0.5, C.oakDark, 0, 0.1, 0, { r: 0.012 });
    for (const [x, z] of [[-0.54, -0.24], [0.54, -0.24], [-0.54, 0.24], [0.54, 0.24]]) box(g, 0.04, 0.3, 0.04, C.oakDark, x, 0, z, { r: 0.015 });
  },
  // Bar stool: round mustard seat on a steel stem and foot ring.
  stoolBar(g) {
    cyl(g, 0.17, 0.17, 0.06, C.mustard, 0, 0.44, 0, { seg: 20 });
    cyl(g, 0.025, 0.025, 0.44, C.steel, 0, 0, 0, { outline: false });
    cyl(g, 0.16, 0.18, 0.025, C.char, 0, 0, 0, { seg: 20 });
    piece(g, new THREE.TorusGeometry(0.12, 0.012, 6, 20), C.steel, 0, 0.2, 0, { rx: Math.PI / 2, outline: false });
  },
  // Kitchen base cabinet with a worktop (0.7 × 0.6 × 0.9).
  kitchenCabinet(g) {
    box(g, 0.7, 0.84, 0.58, C.white, 0, 0, -0.01, { r: 0.012 });
    box(g, 0.72, 0.05, 0.62, C.oak, 0, 0.84, 0, { r: 0.012 });
    box(g, 0.64, 0.74, 0.02, C.sage, 0, 0.06, 0.28, { r: 0.01 });
    box(g, 0.12, 0.02, 0.02, C.char, 0, 0.7, 0.3, { r: 0.008, outline: false });
  },
  kitchenSink(g) {
    B.kitchenCabinet(g);
    box(g, 0.48, 0.02, 0.38, C.steel, 0, 0.885, 0.02, { r: 0.01, outline: false });
    cyl(g, 0.015, 0.015, 0.2, C.steel, 0, 0.89, -0.22, { outline: false });
    box(g, 0.025, 0.025, 0.14, C.steel, 0, 1.07, -0.16, { r: 0.01, outline: false });
  },
  kitchenMicrowave(g) {
    box(g, 0.55, 0.32, 0.4, C.white, 0, 0, 0, { r: 0.025 });
    box(g, 0.34, 0.22, 0.01, C.ink, -0.06, 0.05, 0.2, { r: 0.006, outline: false });
    for (let i = 0; i < 3; i++) cyl(g, 0.02, 0.02, 0.01, C.char, 0.19, 0.08 + i * 0.07, 0.2, { rx: Math.PI / 2, outline: false });
  },
  toaster(g) {
    box(g, 0.3, 0.18, 0.2, C.blush, 0, 0, 0, { r: 0.05 });
    for (const x of [-0.06, 0.06]) box(g, 0.05, 0.01, 0.13, C.ink, x, 0.18, 0, { r: 0.004, outline: false });
  },
  kitchenCoffeeMachine(g) {
    box(g, 0.45, 0.06, 0.4, C.char, 0, 0, 0, { r: 0.02 });
    box(g, 0.45, 0.5, 0.18, C.char, 0, 0, -0.11, { r: 0.03 });
    box(g, 0.45, 0.1, 0.4, C.char, 0, 0.4, 0, { r: 0.03 });
    cyl(g, 0.05, 0.04, 0.08, C.cream, 0, 0.06, 0.07);
    cyl(g, 0.03, 0.03, 0.04, C.steel, 0, 0.36, 0.07, { outline: false });
    cyl(g, 0.07, 0.07, 0.12, C.terra, -0.12, 0.5, -0.08);
  },
  // Tall two-door fridge, sage, with long handles.
  kitchenFridgeLarge(g) {
    box(g, 0.85, 1.95, 0.75, C.sage, 0, 0, 0, { r: 0.05 });
    box(g, 0.83, 0.01, 0.01, C.ink, 0, 1.25, 0.376, { r: 0.003, outline: false });
    for (const [y, h] of [[0.8, 0.35], [1.38, 0.3]]) box(g, 0.03, h, 0.04, C.steel, -0.34, y, 0.38, { r: 0.012 });
  },
  // Open bookcase: oak frame, four shelves (the books are added on top).
  bookcaseOpen(g) {
    for (const s of [-1, 1]) box(g, 0.04, 1.45, 0.4, C.oak, s * 0.43, 0, 0, { r: 0.01 });
    box(g, 0.9, 1.45, 0.02, C.oakDark, 0, 0, -0.19, { r: 0.006, outline: false });
    for (const y of [0, 0.47, 0.94, 1.41]) box(g, 0.84, 0.04, 0.38, C.oak, 0, y, 0, { r: 0.01 });
  },
  // A row of books, a few colours, one leaning.
  books(g) {
    const cols = [C.terra, C.blue, C.mustard, C.sage, C.blush, C.char];
    let x = -0.11;
    for (let i = 0; i < 6; i++) {
      const w = 0.03 + (i % 3) * 0.007, h = 0.15 + ((i * 7) % 4) * 0.012;
      box(g, w, h, 0.18, cols[i], x + w / 2, 0, 0, { r: 0.004, rz: i === 5 ? -0.3 : 0 });
      x += w + 0.004;
    }
    g.traverse((o) => { o.receiveShadow = false; }); // keep their colours inside the dark shelves
  },
  // Sofa (stretched to fit): a plump seat, a back at -z, round arms and two
  // cushions.
  loungeSofa(g) {
    box(g, 2.0, 0.12, 0.8, C.oakDark, 0, 0.04, 0, { r: 0.03 });
    for (const [x, z] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) cyl(g, 0.025, 0.02, 0.05, C.oakDark, x, 0, z, { outline: false });
    box(g, 1.7, 0.18, 0.66, C.blue, 0, 0.16, 0.06, { r: 0.06 });
    box(g, 1.9, 0.6, 0.2, C.blue, 0, 0.16, -0.3, { r: 0.08 });
    for (const s of [-1, 1]) box(g, 0.16, 0.4, 0.8, C.blue, s * 0.92, 0.12, 0, { r: 0.07 });
    for (const s of [-1, 1]) box(g, 0.3, 0.26, 0.1, s < 0 ? C.mustard : C.blush, s * 0.62, 0.34, -0.16, { r: 0.05, rx: -0.2, rz: s * 0.1 });
  },
  loungeChairRelax(g) {
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) box(g, 0.035, 0.18, 0.035, C.oakDark, x, 0, z, { r: 0.012 });
    box(g, 0.75, 0.16, 0.75, C.terra, 0, 0.16, 0.02, { r: 0.06 });
    box(g, 0.75, 0.42, 0.16, C.terra, 0, 0.2, -0.3, { r: 0.07, rx: -0.15 });
    for (const s of [-1, 1]) box(g, 0.12, 0.3, 0.7, C.terra, s * 0.33, 0.16, 0, { r: 0.05 });
  },
  // Rug: a woven mat with a border.
  rugRectangle(g) {
    box(g, 2.0, 0.012, 1.4, C.mustard, 0, 0, 0, { r: 0.005, outline: false });
    box(g, 1.8, 0.004, 1.2, C.cream, 0, 0.012, 0, { r: 0.002, outline: false });
    for (let i = 0; i < 3; i++) box(g, 1.5, 0.002, 0.06, C.terra, 0, 0.016, -0.3 + i * 0.3, { r: 0.001, outline: false });
  },
  // Floor lamp: weighted foot, slim pole, a drum shade glowing warm.
  lampRoundFloor(g) {
    cyl(g, 0.16, 0.18, 0.04, C.char, 0, 0, 0, { seg: 20 });
    cyl(g, 0.015, 0.015, 1.4, C.char, 0, 0.04, 0, { outline: false });
    const shade = cyl(g, 0.17, 0.23, 0.28, C.cream, 0, 1.4, 0, { seg: 20, m: new THREE.MeshToonMaterial({ color: C.cream, emissive: 0xffd9a0, emissiveIntensity: 0.35, gradientMap: soft(C.cream).gradientMap }) });
    shade.material.side = THREE.DoubleSide;
  },
  cabinetTelevision(g) {
    box(g, 1.1, 0.34, 0.4, C.oak, 0, 0.08, 0, { r: 0.02 });
    for (const x of [-0.5, 0.5]) box(g, 0.04, 0.08, 0.04, C.char, x, 0, 0, { r: 0.012 });
    for (const x of [-0.28, 0.28]) box(g, 0.5, 0.28, 0.015, C.oakDark, x, 0.11, 0.2, { r: 0.006 });
  },
  televisionModern(g) {
    box(g, 0.3, 0.02, 0.16, C.char, 0, 0, 0, { r: 0.008 });
    box(g, 0.05, 0.1, 0.03, C.char, 0, 0.02, -0.02, { r: 0.01 });
    box(g, 0.9, 0.5, 0.04, C.ink, 0, 0.1, 0, { r: 0.02 });
  },
  trashcan(g) {
    cyl(g, 0.15, 0.12, 0.35, C.char, 0, 0, 0);
    cyl(g, 0.155, 0.155, 0.03, C.steel, 0, 0.35, 0, { outline: false });
  },
  coatRackStanding(g) {
    cyl(g, 0.2, 0.22, 0.03, C.oakDark, 0, 0, 0);
    cyl(g, 0.025, 0.03, 1.7, C.oak, 0, 0.03, 0);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; box(g, 0.02, 0.14, 0.02, C.oakDark, Math.sin(a) * 0.06, 1.55, Math.cos(a) * 0.06, { r: 0.008, rx: Math.cos(a) * 0.7, rz: -Math.sin(a) * 0.7 }); }
  },
  radio(g) {
    box(g, 0.3, 0.18, 0.12, C.terra, 0, 0, 0, { r: 0.04 });
    cyl(g, 0.05, 0.05, 0.01, C.cream, -0.06, 0.09 - 0.0, 0.06, { rx: Math.PI / 2 });
    box(g, 0.08, 0.04, 0.01, C.cream, 0.08, 0.1, 0.06, { r: 0.006, outline: false });
    box(g, 0.004, 0.18, 0.004, C.steel, 0.12, 0.18, -0.02, { r: 0.001, outline: false, rz: -0.4 });
  },
  speaker(g) {
    box(g, 0.25, 0.4, 0.22, C.char, 0, 0, 0, { r: 0.03 });
    for (const [y, r] of [[0.27, 0.05], [0.12, 0.08]]) cyl(g, r, r, 0.01, C.ink, 0, y, 0.11, { rx: Math.PI / 2, outline: false });
  },
  cardboardBoxClosed(g) {
    box(g, 0.5, 0.34, 0.45, 0xc8a06a, 0, 0, 0, { r: 0.01 });
    box(g, 0.08, 0.005, 0.46, 0xe8d6b0, 0, 0.34, 0, { r: 0.002, outline: false });
  },
};

// A thin dark outline around a mesh (as its child), as on the furniture.
export function outlineOf(mesh) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  const o = new THREE.Mesh(geo, OUTLINE);
  o.scale.set(1 + 2 * T / Math.max(s.x, 0.01), 1 + 2 * T / Math.max(s.y, 0.01), 1 + 2 * T / Math.max(s.z, 0.01));
  mesh.add(o);
  return o;
}

export { rb as roundedBox };

export function makeFurniture() {
  const out = {};
  for (const [name, build] of Object.entries(B)) {
    const g = new THREE.Group();
    build(g);
    g.userData.made = true;
    out[name] = g;
  }
  return out;
}

export const FURNITURE_NAMES = Object.keys(B);
