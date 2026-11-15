/**
 * Shared 26-node normalized anatomical face mesh [0..1 x 0..1] and
 * articulated spider-crawler kinematics used across kiosk, enrollment,
 * and gate camera overlays.
 */

export interface NormalizedFaceNode {
  x: number;
  y: number;
  anchor?: boolean;
}

export const FACE_MESH_NODES: readonly NormalizedFaceNode[] = [
  // Forehead & temples (0-4)
  { x: 0.5, y: 0.08, anchor: true },
  { x: 0.29, y: 0.14 },
  { x: 0.71, y: 0.14 },
  { x: 0.11, y: 0.27 },
  { x: 0.89, y: 0.27 },
  // Brows & glabella (5-9)
  { x: 0.2, y: 0.27 },
  { x: 0.39, y: 0.28 },
  { x: 0.5, y: 0.3, anchor: true },
  { x: 0.61, y: 0.28 },
  { x: 0.8, y: 0.27 },
  // Eyes (10-13)
  { x: 0.23, y: 0.37, anchor: true },
  { x: 0.4, y: 0.38 },
  { x: 0.6, y: 0.38 },
  { x: 0.77, y: 0.37, anchor: true },
  // Cheekbones & nose (14-17)
  { x: 0.14, y: 0.53 },
  { x: 0.5, y: 0.45 },
  { x: 0.5, y: 0.56, anchor: true },
  { x: 0.86, y: 0.53 },
  // Mouth & mid-jaw (18-22)
  { x: 0.19, y: 0.7 },
  { x: 0.37, y: 0.71 },
  { x: 0.5, y: 0.72 },
  { x: 0.63, y: 0.71 },
  { x: 0.81, y: 0.7 },
  // Lower jaw & chin (23-25)
  { x: 0.29, y: 0.85 },
  { x: 0.5, y: 0.94, anchor: true },
  { x: 0.71, y: 0.85 },
];

export const FACE_MESH_EDGES: readonly [number, number][] = [
  // Forehead & upper web
  [0, 1], [0, 2], [1, 3], [2, 4], [1, 5], [2, 9], [0, 7], [1, 6], [2, 8], [3, 5], [4, 9],
  // Brow & orbital loop
  [5, 6], [6, 7], [7, 8], [8, 9], [5, 10], [6, 11], [7, 15], [8, 12], [9, 13],
  [10, 11], [11, 15], [15, 12], [12, 13], [1, 7], [2, 7],
  // Cheek & nasal web
  [3, 14], [10, 14], [11, 16], [12, 16], [15, 16], [4, 17], [13, 17],
  [14, 19], [17, 21], [16, 19], [16, 20], [16, 21], [11, 14], [12, 17],
  // Lower jaw & chin contour
  [14, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 17],
  [18, 23], [19, 23], [20, 24], [21, 25], [22, 25],
  [23, 24], [24, 25], [19, 24], [21, 24],
];

/**
 * Smooth multi-frequency Lissajous path traversing all facial zones
 * (forehead, eyes, temples, nose, cheeks, mouth, chin) in normalized [0..1] coords.
 */
export function getNormalizedSpiderPos(phaseRad: number): { x: number; y: number } {
  const envelope = 0.72 + 0.28 * Math.cos(phaseRad * 0.65);
  const nx = 0.5 + Math.sin(phaseRad * 1.85) * 0.34 * envelope;
  const ny = 0.51 + Math.sin(phaseRad * 1.12 + 0.55) * 0.38;
  return { x: nx, y: ny };
}

/**
 * Compute an articulated knee point between spider body (sx, sy) and landmark (tx, ty).
 */
export function getSpiderKneePoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  legIndex: number,
  maxBend = 14
): { kx: number; ky: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    return { kx: tx, ky: ty };
  }
  const mx = (sx + tx) * 0.5;
  const my = (sy + ty) * 0.5;
  const side = legIndex % 2 === 0 ? 1 : -1;
  const bend = Math.min(maxBend, dist * 0.28) * side;
  return {
    kx: mx + (-dy / dist) * bend,
    ky: my + (dx / dist) * bend,
  };
}

export interface DetectedFaceBox {
  /** ViewBox coordinates in 640x480 space (already accounting for horizontal mirroring when mirrored=true) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Normalized [0..1] coordinates in displayed 640x480 frame */
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  confidence: number;
  source: "native_detector" | "skin_cluster" | "backend";
}

interface NativeFaceDetectorInstance {
  detect: (input: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
}

let cachedNativeDetector: NativeFaceDetectorInstance | null = null;
let nativeDetectorChecked = false;
let nativeDetectorFailed = false;

function getNativeFaceDetector(): NativeFaceDetectorInstance | null {
  if (nativeDetectorFailed) return null;
  if (!nativeDetectorChecked) {
    nativeDetectorChecked = true;
    try {
      const win = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
      const Ctor = win?.FaceDetector as
        | (new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetectorInstance)
        | undefined;
      if (typeof Ctor === "function") {
        cachedNativeDetector = new Ctor({ fastMode: true, maxDetectedFaces: 1 });
      }
    } catch {
      nativeDetectorFailed = true;
      cachedNativeDetector = null;
    }
  }
  return cachedNativeDetector;
}

function clampViewBoxRect(
  x: number,
  y: number,
  w: number,
  h: number,
  confidence: number,
  source: DetectedFaceBox["source"]
): DetectedFaceBox {
  const cw = Math.max(88, Math.min(440, w));
  const ch = Math.max(110, Math.min(440, h));
  const cx = Math.max(12, Math.min(640 - cw - 12, x));
  const cy = Math.max(12, Math.min(480 - ch - 12, y));
  return {
    x: cx,
    y: cy,
    w: cw,
    h: ch,
    normX: Number((cx / 640).toFixed(4)),
    normY: Number((cy / 480).toFixed(4)),
    normW: Number((cw / 640).toFixed(4)),
    normH: Number((ch / 480).toFixed(4)),
    confidence,
    source,
  };
}

/**
 * Convert a backend normalized bbox (in raw captured video frame space) into 640x480 viewBox space,
 * compensating for `object-cover` / `xMidYMid slice` aspect cropping and optional horizontal mirroring.
 */
export function backendBboxToViewBox(
  bbox: { x: number; y: number; w: number; h: number },
  mirrored: boolean,
  videoWidth = 640,
  videoHeight = 480
): DetectedFaceBox {
  const vw = videoWidth || 640;
  const vh = videoHeight || 480;
  const targetAspect = 640 / 480;
  const srcAspect = vw / vh;

  let normX = bbox.x;
  let normY = bbox.y;
  let normW = bbox.w;
  let normH = bbox.h;

  if (srcAspect > targetAspect + 0.01) {
    const visibleFracW = targetAspect / srcAspect;
    const cropLeft = (1 - visibleFracW) * 0.5;
    normX = (normX - cropLeft) / visibleFracW;
    normW = normW / visibleFracW;
  } else if (srcAspect < targetAspect - 0.01) {
    const visibleFracH = srcAspect / targetAspect;
    const cropTop = (1 - visibleFracH) * 0.5;
    normY = (normY - cropTop) / visibleFracH;
    normH = normH / visibleFracH;
  }

  const rawX = normX * 640;
  const rawY = normY * 480;
  const rawW = normW * 640;
  const rawH = normH * 480;
  const displayX = mirrored ? 640 - rawX - rawW : rawX;
  return clampViewBoxRect(displayX, rawY, rawW, rawH, 0.96, "backend");
}

/**
 * Real-time client-side face localization from a live HTMLVideoElement frame.
 * Uses native Shape Detection `FaceDetector` when supported, falling back cleanly
 * to a fast YCbCr skin-locus + luminance-variance connected-cluster tracker on a 160x120 buffer.
 * Returned coordinates are in `640x480` viewBox space and respect `mirrored` horizontal flipping.
 */
export async function detectFaceInVideoFrame(
  video: HTMLVideoElement,
  scratchCanvas: HTMLCanvasElement,
  mirrored: boolean
): Promise<DetectedFaceBox | null> {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const W = 160;
  const H = 120;
  if (scratchCanvas.width !== W) scratchCanvas.width = W;
  if (scratchCanvas.height !== H) scratchCanvas.height = H;

  const ctx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Slice-crop identically to CSS `object-cover` + SVG `xMidYMid slice`
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const targetAspect = 640 / 480;
  const srcAspect = vw / vh;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (srcAspect > targetAspect) {
    sw = vh * targetAspect;
    sx = (vw - sw) * 0.5;
  } else if (srcAspect < targetAspect) {
    sh = vw / targetAspect;
    sy = (vh - sh) * 0.5;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);

  // Path A: Native Chromium Shape Detection FaceDetector API
  const detector = getNativeFaceDetector();
  if (detector) {
    try {
      const detected = await detector.detect(scratchCanvas);
      if (detected && detected.length > 0) {
        let best = detected[0];
        let bestArea = best.boundingBox.width * best.boundingBox.height;
        for (let i = 1; i < detected.length; i++) {
          const area = detected[i].boundingBox.width * detected[i].boundingBox.height;
          if (area > bestArea) {
            best = detected[i];
            bestArea = area;
          }
        }
        const scaleX = 640 / W;
        const scaleY = 480 / H;
        const rawW = best.boundingBox.width * scaleX;
        const rawH = best.boundingBox.height * scaleY;
        const rawX = best.boundingBox.x * scaleX;
        const rawY = best.boundingBox.y * scaleY;
        const displayX = mirrored ? 640 - rawX - rawW : rawX;
        return clampViewBoxRect(displayX, rawY, rawW, rawH, 0.98, "native_detector");
      }
      // Native FaceDetector returned zero faces reliably
      return null;
    } catch {
      nativeDetectorFailed = true;
      cachedNativeDetector = null;
    }
  }

  // Path B: Universal YCbCr chrominance + internal facial contrast cluster detector (80x60 sample)
  const imgData = ctx.getImageData(0, 0, W, H).data;
  const COLS = 20;
  const ROWS = 15;
  const CELL = 8; // 8px per cell in 160x120
  const cellHits = new Uint16Array(COLS * ROWS);
  const cellSumX = new Float32Array(COLS * ROWS);
  const cellSumY = new Float32Array(COLS * ROWS);
  const cellLumSum = new Float32Array(COLS * ROWS);
  const cellLumSqSum = new Float32Array(COLS * ROWS);

  let totalSkinPts = 0;
  for (let py = 0; py < H; py += 2) {
    const rowOffset = py * W;
    const cellR = (py / CELL) | 0;
    for (let px = 0; px < W; px += 2) {
      const idx = (rowOffset + px) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      const yLum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (yLum < 24 || yLum > 246) continue;

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 74 && cb <= 138 && cr >= 129 && cr <= 180 && r >= b) {
        const cellC = (px / CELL) | 0;
        const cIdx = cellR * COLS + cellC;
        cellHits[cIdx] += 1;
        cellSumX[cIdx] += px;
        cellSumY[cIdx] += py;
        cellLumSum[cIdx] += yLum;
        cellLumSqSum[cIdx] += yLum * yLum;
        totalSkinPts += 1;
      }
    }
  }

  if (totalSkinPts < 42) {
    return null;
  }

  // BFS connected dense skin cells (threshold >= 3 hits out of 16 samples in 8x8 cell)
  const visited = new Uint8Array(COLS * ROWS);
  let bestClusterCells: number[] = [];
  let bestClusterScore = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const start = r * COLS + c;
      if (visited[start] || cellHits[start] < 3) continue;

      const queue = [start];
      visited[start] = 1;
      const cluster: number[] = [];
      let clusterHits = 0;

      while (queue.length > 0) {
        const cur = queue.pop()!;
        cluster.push(cur);
        clusterHits += cellHits[cur];
        const cr = (cur / COLS) | 0;
        const cc = cur % COLS;

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
            const nIdx = nr * COLS + nc;
            if (!visited[nIdx] && cellHits[nIdx] >= 3) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      if (cluster.length >= 4 && clusterHits > bestClusterScore) {
        bestClusterScore = clusterHits;
        bestClusterCells = cluster;
      }
    }
  }

  if (bestClusterCells.length < 4 || bestClusterScore < 34) {
    return null;
  }

  // Compute centroid & tight bounding extent of the primary cluster, rejecting flat low-contrast walls
  let hits = 0;
  let sumX = 0;
  let sumY = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let minPx = W;
  let maxPx = 0;
  let minPy = H;
  let maxPy = 0;

  for (const cIdx of bestClusterCells) {
    const hCount = cellHits[cIdx];
    hits += hCount;
    sumX += cellSumX[cIdx];
    sumY += cellSumY[cIdx];
    lumSum += cellLumSum[cIdx];
    lumSqSum += cellLumSqSum[cIdx];
    const cr = (cIdx / COLS) | 0;
    const cc = cIdx % COLS;
    const px0 = cc * CELL;
    const py0 = cr * CELL;
    if (px0 < minPx) minPx = px0;
    if (px0 + CELL > maxPx) maxPx = px0 + CELL;
    if (py0 < minPy) minPy = py0;
    if (py0 + CELL > maxPy) maxPy = py0 + CELL;
  }

  const meanLum = lumSum / hits;
  const lumVariance = Math.max(0, lumSqSum / hits - meanLum * meanLum);
  // Real faces contain eye/brow/mouth contrast (std dev >= ~9 luminance units)
  if (lumVariance < 75) {
    return null;
  }

  const cx = sumX / hits;
  const cy = sumY / hits;
  const clusterW = maxPx - minPx;
  const clusterH = maxPy - minPy;

  // Reject degenerate frame-filling illumination blobs
  if (clusterW >= W * 0.9 && clusterH >= H * 0.9) {
    return null;
  }

  // Scale to 640x480 viewBox; keep head-proportioned box focused on upper cluster centroid if neck included
  const rawW = Math.max(120, Math.min(340, clusterW * 4 * 0.96));
  const rawH = Math.max(145, Math.min(390, Math.min(clusterH * 4, rawW * 1.26)));
  const rawX = cx * 4 - rawW * 0.5;
  const rawY = Math.max(minPy * 4, cy * 4 - rawH * 0.52);
  const displayX = mirrored ? 640 - rawX - rawW : rawX;

  return clampViewBoxRect(displayX, rawY, rawW, rawH, 0.85, "skin_cluster");
}
