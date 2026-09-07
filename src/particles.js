import * as THREE from 'three';

const PARTICLE_COUNT = 500;

// Constant-speed, straight-line-with-gentle-steering motion. No velocity/force
// accumulation anywhere -- each particle's speed is fixed for its lifetime and
// only its *direction* changes, so nothing can ever build up and "explode."
const MIN_SPEED = 1.5; // world units / second
const MAX_SPEED = 5;
const TURN_RATE = 0.6; // how fast the travel direction meanders

// Short-range steering-away from crowding -- nudges direction, never speed.
const REPEL_RADIUS = 0.6;
const REPEL_INFLUENCE = 1.2;

// Hand-tracking attraction: when landmark targets are present, every particle
// bends its heading toward the nearest one. Like everything else here this only
// nudges *direction* -- each particle keeps its fixed speed, so the field
// rushes toward the hand without ever changing pace. As soon as the targets go
// away (hand out of frame / tracking off) this term vanishes and particles fall
// straight back to their default meander.
const ATTRACT_INFLUENCE = 20;

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
  const directions = [];
  const speeds = new Float32Array(count);
  const repelAccum = [];

  // World-space points the particles steer toward -- refilled every frame from
  // the hand tracker (empty whenever the camera is off or no hand is visible).
  let attractTargets = [];
  const toTarget = new THREE.Vector3(); // scratch, reused each particle

  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3(
      (Math.random() * 2 - 1) * halfWidth,
      (Math.random() * 2 - 1) * halfHeight,
      (Math.random() * 2 - 1) * DEPTH_RANGE
    );
    positions.push(p);
    directions.push(randomUnitVector());
    repelAccum.push(new THREE.Vector3());
    speeds[i] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);

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

  // Short-range mutual steer-away: O(n^2) but with only 500 particles and an
  // early squared-distance reject, this is trivially cheap per frame.
  function applyRepulsion() {
    for (let i = 0; i < count; i++) repelAccum[i].set(0, 0, 0);

    for (let i = 0; i < count; i++) {
      const pi = positions[i];
      for (let j = i + 1; j < count; j++) {
        const pj = positions[j];
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dz = pi.z - pj.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > REPEL_RADIUS * REPEL_RADIUS || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        const falloff = 1 - dist / REPEL_RADIUS; // 1 at contact, 0 at the edge
        const invDist = 1 / dist;
        const px = dx * invDist * falloff;
        const py = dy * invDist * falloff;
        const pz = dz * invDist * falloff;

        repelAccum[i].x += px;
        repelAccum[i].y += py;
        repelAccum[i].z += pz;
        repelAccum[j].x -= px;
        repelAccum[j].y -= py;
        repelAccum[j].z -= pz;
      }
    }
  }

  function update(delta) {
    applyRepulsion();

    for (let i = 0; i < count; i++) {
      const p = positions[i];
      const dir = directions[i];
      dir.add(randomUnitVector().multiplyScalar(TURN_RATE * delta));

      const repel = repelAccum[i];
      if (repel.lengthSq() > 1e-8) {
        dir.addScaledVector(repel, REPEL_INFLUENCE * delta);
      }

      // Steer toward the closest hand landmark, if any are being tracked.
      if (attractTargets.length > 0) {
        let nearest = attractTargets[0];
        let nearestDistSq = p.distanceToSquared(nearest);
        for (let k = 1; k < attractTargets.length; k++) {
          const distSq = p.distanceToSquared(attractTargets[k]);
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearest = attractTargets[k];
          }
        }
        if (nearestDistSq > 1e-6) {
          toTarget.subVectors(nearest, p).multiplyScalar(1 / Math.sqrt(nearestDistSq));
          dir.addScaledVector(toTarget, ATTRACT_INFLUENCE * delta);
        }
      }

      // Direction is always renormalized to length 1 -- speed is entirely
      // determined by the fixed per-particle `speeds[i]`, so nothing here
      // can ever accumulate into a runaway velocity.
      if (dir.lengthSq() > 1e-8) dir.normalize();

      p.addScaledVector(dir, speeds[i] * delta);

      // Wrap left/right and top/bottom, so the field always fills the screen.
      if (p.x > halfWidth) p.x -= 2 * halfWidth;
      else if (p.x < -halfWidth) p.x += 2 * halfWidth;
      if (p.y > halfHeight) p.y -= 2 * halfHeight;
      else if (p.y < -halfHeight) p.y += 2 * halfHeight;

      // Depth is a shallow range just for a bit of parallax -- bounce
      // instead of wrap, since a depth "pop" would be more noticeable.
      if (p.z > DEPTH_RANGE) {
        p.z = DEPTH_RANGE;
        dir.z *= -1;
      } else if (p.z < -DEPTH_RANGE) {
        p.z = -DEPTH_RANGE;
        dir.z *= -1;
      }

      const i3 = i * 3;
      positionsArr[i3] = p.x;
      positionsArr[i3 + 1] = p.y;
      positionsArr[i3 + 2] = p.z;
    }

    positionAttribute.needsUpdate = true;
  }

  // Call after the camera's aspect changes (window resize) so the wrap
  // boundaries keep matching the actual visible area.
  function setDomain(cam) {
    const d = computeScreenDomain(cam);
    halfWidth = d.halfWidth;
    halfHeight = d.halfHeight;
  }

  // `landmarks` is a flat list of { x, y } normalized to [0, 1] in image space
  // (origin top-left), straight from MediaPipe. They're mapped into the particle
  // field's world box and mirrored horizontally, so the on-screen pull tracks
  // the hand like a mirror. Pass an empty array to release the particles.
  function setHandLandmarks(landmarks) {
    attractTargets = landmarks.map(({ x, y }) => new THREE.Vector3(
      (0.5 - x) * 2 * halfWidth,
      (0.5 - y) * 2 * halfHeight,
      0
    ));
  }

  return { points, update, setDomain, setHandLandmarks };
}
