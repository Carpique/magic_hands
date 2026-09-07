import * as THREE from 'three';

// MediaPipe's 21-point hand skeleton, as landmark index pairs.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // index
  [5, 9], [9, 10], [10, 11], [11, 12],   // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                               // palm
];
const LANDMARKS_PER_HAND = 21;
const MAX_HANDS = 2;

// A gray wireframe of every tracked hand, drawn in the same world space the
// particles are attracted to -- so you can see exactly how MediaPipe's
// normalized landmarks get scaled and placed in the scene.
export function createHandOverlay() {
  const maxVerts = MAX_HANDS * HAND_CONNECTIONS.length * 2;
  const positions = new Float32Array(maxVerts * 3);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    depthTest: false,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;

  // Its own scene, drawn as a crisp pass *after* the bloom composite so the
  // debug skeleton stays sharp instead of glowing.
  const scene = new THREE.Scene();
  scene.add(lines);

  let visible = false;

  // `worldPoints` is a flat THREE.Vector3[] of mapped landmark positions, in
  // groups of 21 per hand (straight from `particles.getHandTargets()`).
  function update(worldPoints) {
    if (!visible) return;

    const handCount = Math.min(
      MAX_HANDS,
      Math.floor(worldPoints.length / LANDMARKS_PER_HAND)
    );

    let v = 0;
    for (let h = 0; h < handCount; h++) {
      const base = h * LANDMARKS_PER_HAND;
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = worldPoints[base + a];
        const pb = worldPoints[base + b];
        positions[v++] = pa.x; positions[v++] = pa.y; positions[v++] = pa.z;
        positions[v++] = pb.x; positions[v++] = pb.y; positions[v++] = pb.z;
      }
    }

    geometry.setDrawRange(0, v / 3);
    positionAttribute.needsUpdate = true;
  }

  function setVisible(next) {
    visible = next;
  }

  return {
    scene,
    update,
    setVisible,
    get visible() {
      return visible;
    },
  };
}
