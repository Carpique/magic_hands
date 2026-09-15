import * as THREE from 'three';

const PARTICLE_COUNT = 1000;

// Particles are free-floating points -- they carry a velocity and nothing acts
// on them at all until a hand appears. There is NO gravity between particles.
//
// While hand landmarks are tracked, each one is a fixed heavy attractor and
// pulls every particle with softened Newtonian gravity:
//
//   a_i = LANDMARK_G * Sum_k  (r_k - r_i) / (|r_k - r_i|^2 + eps^2)^(3/2)
//
// (particle mass cancels out of gravitational acceleration, so it plays no role
// here). The eps^2 (Plummer softening) keeps close passes from slingshotting to
// infinity. When the hand leaves, the pull just stops -- particles keep whatever
// velocity they had and drift on.

const MIN_SPEED = 1.5; // initial speed range (world units / second)
const MAX_SPEED = 5;

// Strength of a single landmark's pull (this is G * landmark_mass rolled into
// one). ~21 landmarks per hand stack up, so the effective well is far deeper
// than this suggests. Bigger -> particles gather harder and faster. Just a
// construction-time placeholder -- settings.js's DEFAULTS.gravity overwrites
// it via setLandmarkGravity before the first frame renders, and that's the
// one place to change the actual default.
const LANDMARK_G = 50;
const LANDMARK_SOFTENING = 1.6; // world units -- radius of the softened core
const MAX_VELOCITY = 45; // world units / s -- numeric safety clamp, not physics

// A fast hand makes the attractors teleport frame to frame, and a close/fast
// encounter with the softened well can inject a big velocity kick in a single
// frame -- that's the "thrown away" feeling. Particle mass wouldn't fix this
// even if it were modeled: gravity's acceleration is mass-independent (mass
// cancels out of a = F/m), so a uniform mass would just be a second G knob.
// This clamp caps the combined per-particle pull from all landmarks instead,
// so no single frame can inject more than MAX_ACCEL * dt of velocity.
const MAX_ACCEL = 60; // world units / s^2 -- hard per-particle clamp

// The x/y plane wraps at the screen edges (a torus), so particles glide straight
// through instead of ping-ponging off walls -- much smoother, and energy is
// perfectly conserved. Gravity is measured to the nearest wrapped image of each
// landmark so nothing jumps at the seam. With no wall to absorb energy, this
// soft cap is the only sink: anything faster than CALM_SPEED eases back toward it
// (direction untouched) so a hand can't slowly heat the whole field. Free
// drifters sit well below CALM_SPEED and never feel it.
const CALM_SPEED = 6; // world units / s
const CALM_RELAX = 0.6; // 1/s -- rate the excess above CALM_SPEED bleeds off

// Non-physical: the whole velocity bleeds toward zero on this timescale, so an
// undisturbed field slowly comes to rest over several seconds (~1/SPEED_DECAY).
// Gravity keeps feeding energy in while a hand is present, so it never fully
// stops then -- it just settles to a slower drift.
const SPEED_DECAY = 0.15; // 1/s

const DEPTH_RANGE = 20; // particles live within [-DEPTH_RANGE, DEPTH_RANGE] on z

const MIN_POINT_SIZE = 4;
const MAX_POINT_SIZE = 20; // px, hard cap

function randomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), z);
}

// Bright, standard "rainbow" palette: random hue at high saturation and
// mid-high lightness in HSL -- vivid, with nothing muddy or near-black.
function randomBrightColor() {
  const hue = Math.random();
  const saturation = 0.75 + Math.random() * 0.25;
  const lightness = 0.55 + Math.random() * 0.15;
  return new THREE.Color().setHSL(hue, saturation, lightness);
}

// How wide/tall the visible area is at z=0, given the camera -- used so the
// particle field's box matches the screen instead of some arbitrary size.
function computeScreenDomain(camera) {
  const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const viewWidth = viewHeight * camera.aspect;
  return { halfWidth: viewWidth / 2, halfHeight: viewHeight / 2 };
}

const VERTEX_SHADER = `
  attribute float size;
  attribute vec3 color;
  uniform float pixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // gl_PointSize is in device pixels -- multiply the requested CSS-pixel
    // size by the pixel ratio so it reads as a consistent size on hi-dpi screens.
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float alpha = smoothstep(0.5, 0.0, dist);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// A trail behind each particle: connected line segments through its last N
// positions, fading to black toward the oldest end. The fade is computed per
// vertex in the shader from a static "slot" attribute and a `cursor` uniform
// -- nothing about a vertex's own data changes frame to frame, only which
// slot currently counts as "newest" does. So update() only has to write this
// frame's new sample (one GPU buffer slice, count * 3 floats) instead of
// re-deriving and re-uploading every particle's whole trail every frame,
// which is what made longer trails cost more CPU and bandwidth than they
// needed to.
const TRAIL_VERTEX_SHADER = `
  attribute vec3 color;
  attribute float slot;
  uniform float cursor;
  uniform float len;
  varying vec3 vColor;
  void main() {
    // Age in samples since this slot was written, counting from the slot
    // right after cursor (oldest retained, about to be overwritten next) to
    // cursor itself (just written this frame, brightest).
    float age = mod(slot - cursor - 1.0 + len, len);
    float fade = len > 1.0 ? age / (len - 1.0) : 1.0;
    vColor = color * fade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// Construction-time placeholder -- settings.js's DEFAULTS.trailLength
// overwrites it via setTrailLength before the first frame renders, and
// that's the one place to change the actual default.
const DEFAULT_TRAIL_LENGTH = 30; // history samples kept per particle, including the current one

export function createFloatingParticles(renderer, camera, count = PARTICLE_COUNT) {
  let { halfWidth, halfHeight } = computeScreenDomain(camera);

  const positionsArr = new Float32Array(count * 3);
  const colorsArr = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const positions = [];
  const velocities = [];
  const accel = new Float32Array(count * 3); // landmark-gravity accumulator, rebuilt each frame

  // Hand landmarks in world space -- heavy, fixed attractors. Refilled from the
  // tracker every frame, empty whenever no hand is visible.
  let attractTargets = [];

  let landmarkG = LANDMARK_G;

  // When true the x/y plane wraps at the screen edges (a torus). When false,
  // particles instead bounce off a hidden bound one screen width outside the
  // visible area in every direction -- far enough to be off-screen, close enough
  // that nothing coasts out of the gravity well forever.
  let wrapEdges = true;

  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3(
      (Math.random() * 2 - 1) * halfWidth,
      (Math.random() * 2 - 1) * halfHeight,
      (Math.random() * 2 - 1) * DEPTH_RANGE
    );
    positions.push(p);

    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    velocities.push(randomUnitVector().multiplyScalar(speed));

    const i3 = i * 3;
    positionsArr[i3] = p.x;
    positionsArr[i3 + 1] = p.y;
    positionsArr[i3 + 2] = p.z;

    const color = randomBrightColor();
    colorsArr[i3] = color.r;
    colorsArr[i3 + 1] = color.g;
    colorsArr[i3 + 2] = color.b;

    sizes[i] = MIN_POINT_SIZE + Math.random() * (MAX_POINT_SIZE - MIN_POINT_SIZE);
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positionsArr, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      pixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);

  // Builds a fresh ring buffer + line geometry for a given trail length.
  // Vertices are laid out slot-major -- index(slot, i) = slot * count + i --
  // so "this frame's new sample, for every particle" is one contiguous run
  // in the position buffer, letting update() upload it with a single cheap
  // addUpdateRange instead of re-uploading the whole thing. `color` and
  // `slot` are per-vertex but never change after this runs, so they're
  // uploaded once here and never touched again. Length 0 or 1 has no segment
  // to draw -- trails.visible just goes false. Called once at startup and
  // again whenever the settings panel changes the length (which resets every
  // particle's trail rather than trying to resample the old history into the
  // new length).
  //
  // The index buffer connects every physically-adjacent slot pair (s, s+1
  // mod len) -- a full closed ring per particle, len segments, not len - 1.
  // Physical-slot adjacency is chronological adjacency for every pair
  // *except* (cursor, cursor+1): that one would connect this frame's newest
  // sample straight back to the oldest one, a chord slicing across whatever
  // shape the trail traces (invisible for a particle moving in a straight
  // line, very visible as a second stray line for one moving in a curve or
  // orbit). setSeamPair() collapses exactly that one pair to a zero-length
  // segment each frame and restores the pair that was collapsed last frame
  // -- an O(count) fix-up, not the O(count * len) rebuild this design exists
  // to avoid.
  function buildTrailState(len) {
    const history = new Float32Array(count * len * 3);
    const colorAttr = new Float32Array(count * len * 3);
    const slotAttr = new Float32Array(count * len);
    for (let i = 0; i < count; i++) {
      const ci3 = i * 3;
      for (let s = 0; s < len; s++) {
        const v = s * count + i;
        const v3 = v * 3;
        history[v3] = positionsArr[ci3];
        history[v3 + 1] = positionsArr[ci3 + 1];
        history[v3 + 2] = positionsArr[ci3 + 2];
        colorAttr[v3] = colorsArr[ci3];
        colorAttr[v3 + 1] = colorsArr[ci3 + 1];
        colorAttr[v3 + 2] = colorsArr[ci3 + 2];
        slotAttr[v] = s;
      }
    }

    // trailIndices[s] (per particle) is the pair (slot s, slot (s+1)%len),
    // stored s-major so "every particle's pair at slot s" is one contiguous
    // run -- same trick as the position buffer, for the same reason.
    const trailIndices = new Uint32Array(count * len * 2);
    const indexAttribute = new THREE.BufferAttribute(trailIndices, 1);
    indexAttribute.setUsage(THREE.DynamicDrawUsage);

    function setSeamPair(s, collapsed) {
      const base = s * count * 2;
      for (let i = 0; i < count; i++) {
        const e = base + i * 2;
        trailIndices[e] = s * count + i;
        trailIndices[e + 1] = collapsed ? (s * count + i) : (((s + 1) % len) * count + i);
      }
      indexAttribute.addUpdateRange(base, count * 2);
    }

    if (len >= 2) {
      for (let s = 0; s < len; s++) setSeamPair(s, false);
      setSeamPair(0, true); // matches cursor: 0 below -- (0,1) starts collapsed
    }

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(history, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    geometry.setAttribute('slot', new THREE.BufferAttribute(slotAttr, 1));
    geometry.setIndex(indexAttribute);

    return {
      len,
      history,
      positionAttribute,
      indexAttribute,
      setSeamPair,
      geometry,
      cursor: 0, // physical ring-buffer slot holding the newest sample
    };
  }

  let trail = buildTrailState(DEFAULT_TRAIL_LENGTH);

  const trailMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cursor: { value: trail.cursor },
      len: { value: trail.len },
    },
    vertexShader: TRAIL_VERTEX_SHADER,
    fragmentShader: TRAIL_FRAGMENT_SHADER,
  });
  const trails = new THREE.LineSegments(trail.geometry, trailMaterial);
  // Positions move every frame without a recomputed bounding volume -- don't
  // let a stale one cull the trail.
  trails.frustumCulled = false;
  trails.visible = trail.len >= 2;

  // Trail length, in history samples (0 disables the trail entirely).
  // Rebuilding is O(count * len) -- trivial, and this only runs when the
  // user drags the settings-panel slider.
  function setTrailLength(len) {
    len = Math.max(0, Math.round(len));
    if (len === trail.len) return;
    trail.geometry.dispose();
    trail = buildTrailState(len);
    trails.geometry = trail.geometry;
    trails.visible = trail.len >= 2;
    trailMaterial.uniforms.cursor.value = trail.cursor;
    trailMaterial.uniforms.len.value = trail.len;
  }

  const LANDMARK_SOFT2 = LANDMARK_SOFTENING * LANDMARK_SOFTENING;

  // O(particles * landmarks). Zero when no hand is visible -- particles simply
  // coast on whatever velocity they already have.
  function accumulateLandmarkGravity() {
    accel.fill(0);
    if (attractTargets.length === 0) return;

    const wrapX = 2 * halfWidth;
    const wrapY = 2 * halfHeight;

    for (let i = 0; i < count; i++) {
      const pi = positions[i];
      const pix = pi.x;
      const piy = pi.y;
      const piz = pi.z;
      const i3 = i * 3;

      for (let k = 0; k < attractTargets.length; k++) {
        const t = attractTargets[k];
        // nearest wrapped image of the landmark in x/y (only when wrapping is
        // on); z never wraps
        let dx = t.x - pix;
        let dy = t.y - piy;
        if (wrapEdges) {
          dx -= wrapX * Math.round(dx / wrapX);
          dy -= wrapY * Math.round(dy / wrapY);
        }
        const dz = t.z - piz;
        const distSq = dx * dx + dy * dy + dz * dz + LANDMARK_SOFT2;
        const inv = 1 / Math.sqrt(distSq);
        const f = (inv * inv * inv) * landmarkG; // landmarkG / (distSq)^1.5
        accel[i3] += dx * f;
        accel[i3 + 1] += dy * f;
        accel[i3 + 2] += dz * f;
      }

      // Clamp the combined pull from all landmarks so a burst of close/fast
      // encounters can't inject a single huge velocity kick in one frame.
      const ax = accel[i3];
      const ay = accel[i3 + 1];
      const az = accel[i3 + 2];
      const aMagSq = ax * ax + ay * ay + az * az;
      if (aMagSq > MAX_ACCEL * MAX_ACCEL) {
        const scale = MAX_ACCEL / Math.sqrt(aMagSq);
        accel[i3] *= scale;
        accel[i3 + 1] *= scale;
        accel[i3 + 2] *= scale;
      }
    }
  }

  function update(delta) {
    // Guard the integrator against long frames (tab was backgrounded, etc).
    const dt = Math.min(delta, 0.033);

    // This frame's position goes into the ring buffer's next slot; prevSlot
    // (last frame's) is only needed for the wrap-seam fix below. Trail length
    // 0 or 1 has no ring buffer to write into. anyWrapped tracks whether the
    // prevSlot block needs re-uploading too (only when at least one particle
    // wrapped this frame).
    const trailLen = trail.len;
    const hasTrail = trailLen >= 2;
    const prevSlot = trail.cursor;
    const writeSlot = hasTrail ? (trail.cursor + 1) % trailLen : 0;
    let anyWrapped = false;

    accumulateLandmarkGravity();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const p = positions[i];
      const v = velocities[i];

      // semi-implicit Euler (accel is all zeros when no hand is tracked)
      v.x += accel[i3] * dt;
      v.y += accel[i3 + 1] * dt;
      v.z += accel[i3 + 2] * dt;

      // Non-physical global decay: the speed vector slowly bleeds toward zero.
      v.multiplyScalar(Math.max(0, 1 - SPEED_DECAY * dt));

      // Soft speed cap: bleed off only the excess above CALM_SPEED, keeping the
      // heading. This is the system's one energy sink now that walls are gone.
      const sp = v.length();
      if (sp > CALM_SPEED) {
        v.multiplyScalar(1 - CALM_RELAX * dt * (1 - CALM_SPEED / sp));
      }
      if (v.lengthSq() > MAX_VELOCITY * MAX_VELOCITY) v.setLength(MAX_VELOCITY);

      p.addScaledVector(v, dt);

      // x/y either wrap around the screen edges, or bounce off a hidden bound
      // one screen width outside the visible area. z is a shallow parallax slab,
      // so it always bounces (a z wrap would pop particles in the perspective
      // projection).
      const prevH3 = hasTrail ? (prevSlot * count + i) * 3 : 0;
      if (wrapEdges) {
        // A wrap teleports the particle, so naively appending this position
        // to its trail would draw a line clear across the screen. Collapse
        // just the wrapped axis's previous history sample onto the post-wrap
        // position instead, so that one joint has zero length there -- one
        // skipped frame per wrap is invisible.
        if (p.x > halfWidth) { p.x -= 2 * halfWidth; if (hasTrail) { trail.history[prevH3] = p.x; anyWrapped = true; } }
        else if (p.x < -halfWidth) { p.x += 2 * halfWidth; if (hasTrail) { trail.history[prevH3] = p.x; anyWrapped = true; } }
        if (p.y > halfHeight) { p.y -= 2 * halfHeight; if (hasTrail) { trail.history[prevH3 + 1] = p.y; anyWrapped = true; } }
        else if (p.y < -halfHeight) { p.y += 2 * halfHeight; if (hasTrail) { trail.history[prevH3 + 1] = p.y; anyWrapped = true; } }
      } else {
        const boundX = 3 * halfWidth; // visible half + one full screen width
        const boundY = 3 * halfHeight;
        if (p.x > boundX) { p.x = boundX; v.x = -Math.abs(v.x); }
        else if (p.x < -boundX) { p.x = -boundX; v.x = Math.abs(v.x); }
        if (p.y > boundY) { p.y = boundY; v.y = -Math.abs(v.y); }
        else if (p.y < -boundY) { p.y = -boundY; v.y = Math.abs(v.y); }
      }
      if (p.z > DEPTH_RANGE) { p.z = DEPTH_RANGE; v.z = -Math.abs(v.z); }
      else if (p.z < -DEPTH_RANGE) { p.z = -DEPTH_RANGE; v.z = Math.abs(v.z); }

      positionsArr[i3] = p.x;
      positionsArr[i3 + 1] = p.y;
      positionsArr[i3 + 2] = p.z;

      if (hasTrail) {
        const h3 = (writeSlot * count + i) * 3;
        trail.history[h3] = p.x;
        trail.history[h3 + 1] = p.y;
        trail.history[h3 + 2] = p.z;
      }
    }

    positionAttribute.needsUpdate = true;
    if (hasTrail) {
      trail.cursor = writeSlot;
      trailMaterial.uniforms.cursor.value = writeSlot;
      // Slot-major layout means "every particle's new sample" is one
      // contiguous run -- upload just that (and, on the rare frame where a
      // wrap collapsed a joint, the previous slot's run too) instead of the
      // whole buffer.
      trail.positionAttribute.addUpdateRange(writeSlot * count * 3, count * 3);
      if (anyWrapped) trail.positionAttribute.addUpdateRange(prevSlot * count * 3, count * 3);
      trail.positionAttribute.needsUpdate = true;

      // The ring's closing seam moved forward by one slot: restore the pair
      // that used to be the seam (prevSlot) to a normal segment, and
      // collapse the new seam (writeSlot) so newest-to-oldest doesn't draw
      // as a stray chord across the trail.
      trail.setSeamPair(prevSlot, false);
      trail.setSeamPair(writeSlot, true);
      trail.indexAttribute.needsUpdate = true;
    }
  }

  // Call after the camera's aspect changes (window resize) so the wall
  // boundaries keep matching the actual visible area.
  function setDomain(cam) {
    const d = computeScreenDomain(cam);
    halfWidth = d.halfWidth;
    halfHeight = d.halfHeight;
  }

  // `landmarks` is a flat list of { x, y } normalized to [0, 1] in image space
  // (origin top-left), straight from MediaPipe. Mapped into the particle field's
  // world box and mirrored horizontally so the pull tracks the hand like a
  // mirror. Pass an empty array to remove the attractors.
  function setHandLandmarks(landmarks) {
    attractTargets = landmarks.map(({ x, y }) => new THREE.Vector3(
      (0.5 - x) * 2 * halfWidth,
      (0.5 - y) * 2 * halfHeight,
      0
    ));
  }

  // The current hand landmarks in world space (groups of 21 per hand) -- the
  // heavy attractors -- handy for drawing an overlay.
  function getHandTargets() {
    return attractTargets;
  }

  // Pull strength of a single landmark (settings panel: 10-100).
  function setLandmarkGravity(value) {
    landmarkG = value;
  }

  // true -> x/y plane wraps at the screen edges; false -> particles bounce off a
  // hidden bound one screen width beyond the visible area.
  function setWrapEdges(enabled) {
    wrapEdges = enabled;
  }

  return {
    points,
    trails,
    update,
    setDomain,
    setHandLandmarks,
    getHandTargets,
    setLandmarkGravity,
    setWrapEdges,
    setTrailLength,
  };
}
