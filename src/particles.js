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
// than this suggests. Bigger -> particles gather harder and faster.
const LANDMARK_G = 50;
const LANDMARK_SOFTENING = 1.6; // world units -- radius of the softened core
const MAX_VELOCITY = 45; // world units / s -- numeric safety clamp, not physics

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

const DEPTH_RANGE = 2; // particles live within [-DEPTH_RANGE, DEPTH_RANGE] on z

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
        // nearest wrapped image of the landmark in x/y; z doesn't wrap
        let dx = t.x - pix;
        dx -= wrapX * Math.round(dx / wrapX);
        let dy = t.y - piy;
        dy -= wrapY * Math.round(dy / wrapY);
        const dz = t.z - piz;
        const distSq = dx * dx + dy * dy + dz * dz + LANDMARK_SOFT2;
        const inv = 1 / Math.sqrt(distSq);
        const f = (inv * inv * inv) * LANDMARK_G; // LANDMARK_G / (distSq)^1.5
        accel[i3] += dx * f;
        accel[i3 + 1] += dy * f;
        accel[i3 + 2] += dz * f;
      }
    }
  }

  function update(delta) {
    // Guard the integrator against long frames (tab was backgrounded, etc).
    const dt = Math.min(delta, 0.033);

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

      // x/y wrap around the screen edges; z is a shallow parallax slab, so it
      // bounces (a z wrap would pop particles in the perspective projection).
      if (p.x > halfWidth) p.x -= 2 * halfWidth;
      else if (p.x < -halfWidth) p.x += 2 * halfWidth;
      if (p.y > halfHeight) p.y -= 2 * halfHeight;
      else if (p.y < -halfHeight) p.y += 2 * halfHeight;
      if (p.z > DEPTH_RANGE) { p.z = DEPTH_RANGE; v.z = -Math.abs(v.z); }
      else if (p.z < -DEPTH_RANGE) { p.z = -DEPTH_RANGE; v.z = Math.abs(v.z); }

      positionsArr[i3] = p.x;
      positionsArr[i3 + 1] = p.y;
      positionsArr[i3 + 2] = p.z;
    }

    positionAttribute.needsUpdate = true;
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

  return { points, update, setDomain, setHandLandmarks, getHandTargets };
}
