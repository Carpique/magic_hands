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
const MAX_SEGMENTS = MAX_HANDS * HAND_CONNECTIONS.length;

const THICKNESS_PX = 50; // full line width, CSS pixels
const LINE_COLOR = new THREE.Color(0xbcd8ff); // pale blue-white
const LINE_OPACITY = 0.4; // overall translucency

// Each connection is drawn as a screen-space quad (two triangles), fattened to
// THICKNESS_PX pixels and extended half a thickness past each end so joints stay
// continuous. The fragment shader measures distance to the true segment (a
// capsule) and fades smoothly to nothing, so with additive blending every line
// reads as a soft translucent glow with rounded ends and no hard edge anywhere.
// Coords below are in "half-width units" (hwu): 1 hwu = uThickness * 0.5 px.
const VERT = `
  uniform vec2 uResolution;
  uniform float uThickness;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aSide;   // -1 / +1  -> which long edge of the quad
  attribute float aEndSel; //  0 / 1   -> start or end of the segment
  varying float vAcross;   // perpendicular coord (quad long edges at +/-1)
  varying float vAlong;    // longitudinal coord (0 = segment centre)
  varying float vHalfLen;  // half the segment length, in half-width units
  void main() {
    vec4 clipStart = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
    vec4 clipEnd   = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

    // NDC delta -> pixels is (dndc * 0.5 * resolution)
    vec2 pxStart = (clipStart.xy / clipStart.w) * uResolution * 0.5;
    vec2 pxEnd   = (clipEnd.xy / clipEnd.w) * uResolution * 0.5;

    float hw = uThickness * 0.5; // half width, pixels
    vec2 seg = pxEnd - pxStart;
    float segLen = length(seg);
    vec2 dir = segLen > 0.0001 ? seg / segLen : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);

    vHalfLen = 0.5 * segLen / hw;
    float capSign = aEndSel < 0.5 ? -1.0 : 1.0;
    vAcross = aSide;
    vAlong = capSign * (vHalfLen + 1.0); // quad runs 1 hwu of cap past each true end

    vec4 clip = mix(clipStart, clipEnd, aEndSel);
    vec2 offsetPx = (perp * aSide + dir * capSign) * hw;
    clip.xy += offsetPx * 2.0 / uResolution * clip.w; // pixels -> NDC, pre-divide
    gl_Position = clip;
  }
`;

const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAcross;
  varying float vAlong;
  varying float vHalfLen;
  void main() {
    float over = max(0.0, abs(vAlong) - vHalfLen); // 0 within the segment, ramps in the caps
    float d = length(vec2(vAcross, over));          // distance to the capsule core, half-width units
    // flat-ish across the body, easing softly to nothing at the edge -- no hard boundary
    float body = 1.0 - smoothstep(0.0, 1.0, d);
    float glow = pow(1.0 - clamp(d, 0.0, 1.0), 3.0); // faint wide halo
    float a = clamp(body * 0.6 + glow * 0.25, 0.0, 1.0) * uOpacity;
    if (a <= 0.001) discard;
    gl_FragColor = vec4(uColor, a);                  // additive: contributes uColor * a
  }
`;

export function createHandOverlay() {
  const V = MAX_SEGMENTS * 6;
  const aStart = new Float32Array(V * 3);
  const aEnd = new Float32Array(V * 3);
  const aSide = new Float32Array(V);
  const aEndSel = new Float32Array(V);

  // static quad pattern: two triangles, (aEndSel, aSide) corners
  const SIDE = [-1, -1, 1, -1, 1, 1];
  const ENDSEL = [0, 1, 1, 0, 1, 0];
  for (let s = 0; s < MAX_SEGMENTS; s++) {
    for (let c = 0; c < 6; c++) {
      aSide[s * 6 + c] = SIDE[c];
      aEndSel[s * 6 + c] = ENDSEL[c];
    }
  }

  const geometry = new THREE.BufferGeometry();
  // `position` is required by three even though the shader ignores it.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  const startAttr = new THREE.BufferAttribute(aStart, 3);
  const endAttr = new THREE.BufferAttribute(aEnd, 3);
  startAttr.setUsage(THREE.DynamicDrawUsage);
  endAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aStart', startAttr);
  geometry.setAttribute('aEnd', endAttr);
  geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  geometry.setAttribute('aEndSel', new THREE.BufferAttribute(aEndSel, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uThickness: { value: THICKNESS_PX },
      uColor: { value: LINE_COLOR },
      uOpacity: { value: LINE_OPACITY },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  // Its own scene, drawn as a pass after the bloom composite.
  const scene = new THREE.Scene();
  scene.add(mesh);

  let visible = false;

  // `worldPoints` is a flat THREE.Vector3[] of mapped landmark positions, in
  // groups of 21 per hand (straight from `particles.getHandTargets()`).
  function update(worldPoints) {
    if (!visible) return;

    const handCount = Math.min(
      MAX_HANDS,
      Math.floor(worldPoints.length / LANDMARKS_PER_HAND)
    );

    let seg = 0;
    for (let h = 0; h < handCount; h++) {
      const base = h * LANDMARKS_PER_HAND;
      for (let ci = 0; ci < HAND_CONNECTIONS.length; ci++) {
        const a = worldPoints[base + HAND_CONNECTIONS[ci][0]];
        const b = worldPoints[base + HAND_CONNECTIONS[ci][1]];
        const o = seg * 18;
        for (let c = 0; c < 6; c++) {
          const p = o + c * 3;
          aStart[p] = a.x; aStart[p + 1] = a.y; aStart[p + 2] = a.z;
          aEnd[p] = b.x; aEnd[p + 1] = b.y; aEnd[p + 2] = b.z;
        }
        seg++;
      }
    }

    startAttr.needsUpdate = true;
    endAttr.needsUpdate = true;
    geometry.setDrawRange(0, seg * 6);
  }

  function setVisible(next) {
    visible = next;
  }

  function setSize(width, height) {
    material.uniforms.uResolution.value.set(width, height);
  }

  return {
    scene,
    update,
    setVisible,
    setSize,
    get visible() {
      return visible;
    },
  };
}
