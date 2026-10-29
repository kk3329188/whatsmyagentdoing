// Camera helpers for the 3D office that need no WebGL (tests import them).

// What a wheel event should do. A pinch on a trackpad arrives as a wheel
// event with ctrlKey set and zooms; a mostly sideways swipe (two fingers on a
// trackpad, a tilt wheel, Shift + wheel) slides the view; anything else is a
// plain wheel turn and zooms as before.
export function wheelIntent(e) {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return 'pan';
  return 'zoom';
}

// How far the point the camera orbits around must move to stay over the
// room (with a margin), so panning can't lose the office off screen.
export function clampShift(t, W, D, margin = 1) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(t.x, -margin, W + margin) - t.x,
    y: clamp(t.y, -1, 4) - t.y,
    z: clamp(t.z, -margin, D + margin) - t.z,
  };
}

// Arrow keys (and the on-screen pad) slide the view this many pixels.
export const PAN_STEP = 90;
export function keyPan(key) {
  return { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] }[key] || null;
}

// Eased position of a camera glide, 0..1 over `ms`: ease-out, or
// ease-in-out (`inOut`) for the slower glide back from a spotlight.
export function glide(t0, now, ms = 450, inOut = false) {
  const k = Math.min(1, Math.max(0, (now - t0) / ms));
  if (inOut) return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  return 1 - Math.pow(1 - k, 3);
}
