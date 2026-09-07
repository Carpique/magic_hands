// MediaPipe's WASM runtime and the pre-trained hand-landmark model. Both are
// fetched from a CDN on first start and then cached by the browser, so nothing
// binary needs to live in the repo.
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Hand Landmarker returns 21 landmarks per detected hand, each normalized to
// [0, 1] in image space with the origin at the top-left corner.
export function createHandTracker({ numHands = 2 } = {}) {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;

  let landmarker = null;
  let stream = null;
  let running = false;
  let lastVideoTime = -1;
  let points = []; // flat list of { x, y } across every detected hand

  async function ensureLandmarker() {
    if (landmarker) return;
    // Loaded on demand -- keeps the ~600 kB MediaPipe bundle out of the initial
    // page load for anyone who never turns hand tracking on.
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      // Some machines/browsers can't spin up the GPU delegate -- fall back to CPU.
      options.baseOptions.delegate = 'CPU';
      landmarker = await HandLandmarker.createFromOptions(fileset, options);
    }
  }

  async function start() {
    if (running) return;
    await ensureLandmarker();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
  }

  function stop() {
    running = false;
    points = [];
    lastVideoTime = -1;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  // Call once per animation frame. Runs detection only when the camera has
  // produced a new frame, and always returns the latest landmark list (empty
  // when tracking is off or no hand is in view).
  function update() {
    if (!running || !landmarker || video.readyState < 2) return points;

    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      const next = [];
      for (const hand of result.landmarks) {
        for (const lm of hand) next.push({ x: lm.x, y: lm.y });
      }
      points = next;
    }
    return points;
  }

  return {
    start,
    stop,
    update,
    video,
    get running() {
      return running;
    },
  };
}
