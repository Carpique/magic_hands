import * as THREE from 'three';

const PARTICLE_COUNT = 1000;

// Pure gravitational n-body. Every particle is a point mass; every hand landmark
// is a much heavier point mass fixed wherever the tracker puts it. The only
// force in the system is Newtonian gravity between all of these points -- no
// drag, no repulsion, no steering, no special-casing the nearest landmark. The
// particles just fall through the field and whatever happens, happens.
//
//   a_i = G * Sum_j  m_j * (r_j - r_i) / (|r_j - r_i|^2 + eps^2)^(3/2)
//
// The eps^2 (Plummer softening) keeps close passes from turning into infinite
// slingshots. Landmarks are never integrated -- they don't feel gravity back,
// they're just heavy attractors that move when your hand moves.

const MIN_SPEED = 1.5; // initial speed range (world units / second)
const MAX_SPEED = 5;

// Gravitational constant. Only ever multiplies a mass, so this is also the
// single "scale the masses" / "scale time" knob: the whole simulation's speed
// goes as sqrt(G). At the domain size and particle count here, the 1000
// particles' *own* combined self-gravity is what sets the pace -- too high and
// the cloud free-falls into a single point in under a second (that's not a bug,
// just runaway infall); 0.15 gives a slow breathing drift with a hand still
// able to gather the field over a few seconds.
const G = 0.15;
const LANDMARK_MASS_RATIO = 50; // each landmark's mass vs. the mean particle
const SOFTENING = 1.2; // particle <-> particle, world units
const LANDMARK_SOFTENING = 1.6; // landmark <-> particle, world units
const MAX_VELOCITY = 45; // world units / s -- numeric safety clamp, not physics
const WALL_RESTITUTION = 0.9; // energy kept on a wall bounce (1 = perfectly elastic)

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
  const masses = new Float32Array(count); // proportional to point area (pi r^2)
  const accel = new Float32Array(count * 3); // gravity accumulator, rebuilt each frame

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
    const radius = sizes[i] * 0.5;
    masses[i] = Math.PI * radius * radius;
  }

  // Normalize particle masses to a mean of 1, so G and the landmark ratio stay
  // meaningful regardless of the size range above.
  let massSum = 0;
  for (let i = 0; i < count; i++) massSum += masses[i];
  const meanMass = massSum / count;
  for (let i = 0; i < count; i++) masses[i] /= meanMass;
  const landmarkMass = LANDMARK_MASS_RATIO; // = ratio * normalized mean (1)

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

  const SOFT2 = SOFTENING * SOFTENING;
  const LANDMARK_SOFT2 = LANDMARK_SOFTENING * LANDMARK_SOFTENING;

  // O(n^2) gravity between every pair of particles, plus O(n * landmarks) for
  // the hand. Fine for ~1000 particles; drop PARTICLE_COUNT if your machine
  // struggles.
  function accumulateGravity() {
    accel.fill(0);

    for (let i = 0; i < count; i++) {
      const pi = positions[i];
      const pix = pi.x;
      const piy = pi.y;
      const piz = pi.z;
      const mi = masses[i];
      const i3 = i * 3;

      // particle <-> particle (Newton's third law: update both sides once)
      for (let j = i + 1; j < count; j++) {
        const pj = positions[j];
        const dx = pj.x - pix;
        const dy = pj.y - piy;
        const dz = pj.z - piz;
        const distSq = dx * dx + dy * dy + dz * dz + SOFT2;
        const inv = 1 / Math.sqrt(distSq);
        const invCube = (inv * inv * inv) * G; // G / (distSq)^1.5
        const fj = invCube * masses[j];
        const fi = invCube * mi;
        const j3 = j * 3;
        accel[i3] += dx * fj;
        accel[i3 + 1] += dy * fj;
        accel[i3 + 2] += dz * fj;
        accel[j3] -= dx * fi;
        accel[j3 + 1] -= dy * fi;
        accel[j3 + 2] -= dz * fi;
      }

      // landmarks -> particle (landmarks are fixed, so no reaction on them)
      for (let k = 0; k < attractTargets.length; k++) {
        const t = attractTargets[k];
        const dx = t.x - pix;
        const dy = t.y - piy;
        const dz = t.z - piz;
        const distSq = dx * dx + dy * dy + dz * dz + LANDMARK_SOFT2;
        const inv = 1 / Math.sqrt(distSq);
        const f = (inv * inv * inv) * G * landmarkMass;
        accel[i3] += dx * f;
        accel[i3 + 1] += dy * f;
        accel[i3 + 2] += dz * f;
      }
    }
  }

  function update(delta) {
    // Guard the integrator against long frames (tab was backgrounded, etc).
    const dt = Math.min(delta, 0.033);

    accumulateGravity();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const p = positions[i];
      const v = velocities[i];

      // semi-implicit Euler
      v.x += accel[i3] * dt;
      v.y += accel[i3 + 1] * dt;
      v.z += accel[i3 + 2] * dt;

      if (v.lengthSq() > MAX_VELOCITY * MAX_VELOCITY) v.setLength(MAX_VELOCITY);

      p.addScaledVector(v, dt);

      // Bounce off the screen box so the field stays visible. Slightly inelastic
      // so gravitational infall doesn't heat the system up without bound.
      if (p.x > halfWidth) { p.x = halfWidth; v.x = -Math.abs(v.x) * WALL_RESTITUTION; }
      else if (p.x < -halfWidth) { p.x = -halfWidth; v.x = Math.abs(v.x) * WALL_RESTITUTION; }
      if (p.y > halfHeight) { p.y = halfHeight; v.y = -Math.abs(v.y) * WALL_RESTITUTION; }
      else if (p.y < -halfHeight) { p.y = -halfHeight; v.y = Math.abs(v.y) * WALL_RESTITUTION; }
      if (p.z > DEPTH_RANGE) { p.z = DEPTH_RANGE; v.z = -Math.abs(v.z) * WALL_RESTITUTION; }
      else if (p.z < -DEPTH_RANGE) { p.z = -DEPTH_RANGE; v.z = Math.abs(v.z) * WALL_RESTITUTION; }

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
