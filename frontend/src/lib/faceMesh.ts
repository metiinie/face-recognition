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
  const cw = Math.max(92, Math.min(210, w));
  const ch = Math.max(112, Math.min(255, h));
  const cx = Math.max(10, Math.min(640 - cw - 10, x));
  const cy = Math.max(10, Math.min(480 - ch - 10, y));
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

  // Path B: Facial-Core Chrominance + Feature-Gradient Window Locator (80x60 sample)
  const imgData = ctx.getImageData(0, 0, W, H).data;
  const COLS = 20;
  const ROWS = 15;
  const CELL = 8; // 8px per cell in 160x120
  const cellHits = new Uint16Array(COLS * ROWS);
  const cellGradSum = new Float32Array(COLS * ROWS);
  const cellSumX = new Float32Array(COLS * ROWS);
  const cellSumY = new Float32Array(COLS * ROWS);
  const cellSumXSq = new Float32Array(COLS * ROWS);
  const cellSumYSq = new Float32Array(COLS * ROWS);
  const cellLumSum = new Float32Array(COLS * ROWS);
  const cellLumSqSum = new Float32Array(COLS * ROWS);

  let totalSkinPts = 0;
  for (let py = 2; py < H - 2; py += 2) {
    const rowOffset = py * W;
    const cellR = (py / CELL) | 0;
    for (let px = 2; px < W - 2; px += 2) {
      const idx = (rowOffset + px) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      const maxCh = r > g ? (r > b ? r : b) : g > b ? g : b;
      const minCh = r < g ? (r < b ? r : b) : g < b ? g : b;
      if (maxCh < 28) continue;
      const sat = (maxCh - minCh) / maxCh;
      if (sat < 0.14) continue;

      const yLum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (yLum < 22 || yLum > 242) continue;

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 78 && cb <= 132 && cr >= 133 && cr <= 178 && cr - cb >= 16 && r > b) {
        // Compute local facial edge gradient (eyes, brows, nostrils, lips vs flat wall)
        const leftIdx = (rowOffset + (px - 2)) * 4;
        const upIdx = ((py - 2) * W + px) * 4;
        const leftLum = 0.299 * imgData[leftIdx] + 0.587 * imgData[leftIdx + 1] + 0.114 * imgData[leftIdx + 2];
        const upLum = 0.299 * imgData[upIdx] + 0.587 * imgData[upIdx + 1] + 0.114 * imgData[upIdx + 2];
        const grad = Math.abs(yLum - leftLum) + Math.abs(yLum - upLum);

        const cellC = (px / CELL) | 0;
        const cIdx = cellR * COLS + cellC;
        cellHits[cIdx] += 1;
        cellGradSum[cIdx] += grad;
        cellSumX[cIdx] += px;
        cellSumY[cIdx] += py;
        cellSumXSq[cIdx] += px * px;
        cellSumYSq[cIdx] += py * py;
        cellLumSum[cIdx] += yLum;
        cellLumSqSum[cIdx] += yLum * yLum;
        totalSkinPts += 1;
      }
    }
  }

  if (totalSkinPts < 28) {
    return null;
  }

  // Score each 8x8 cell combining skin density + facial edge gradient (flat walls score near 0)
  const cellScore = new Float32Array(COLS * ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    const h = cellHits[i];
    if (h >= 2) {
      const avgGrad = cellGradSum[i] / h;
      const lumMean = cellLumSum[i] / h;
      const lumVar = Math.max(0, cellLumSqSum[i] / h - lumMean * lumMean);
      // Require either internal texture contrast or clear facial gradient
      const featureWeight = lumVar > 22 || avgGrad > 5.5 ? 1 + Math.min(3.5, avgGrad * 0.14) : 0.2;
      cellScore[i] = h * featureWeight;
    }
  }

  // Locate peak 5x6 anatomical face window (~160x192 viewBox px) instead of merging full-room blobs
  const WIN_W = 5;
  const WIN_H = 6;
  let bestWinScore = 0;
  let bestR0 = 0;
  let bestC0 = 0;
  for (let r0 = 0; r0 <= ROWS - WIN_H; r0++) {
    for (let c0 = 0; c0 <= COLS - WIN_W; c0++) {
      let winScore = 0;
      let winHits = 0;
      for (let r = r0; r < r0 + WIN_H; r++) {
        for (let c = c0; c < c0 + WIN_W; c++) {
          const i = r * COLS + c;
          winScore += cellScore[i];
          winHits += cellHits[i];
        }
      }
      if (winHits >= 26 && winScore > bestWinScore) {
        bestWinScore = winScore;
        bestR0 = r0;
        bestC0 = c0;
      }
    }
  }

  if (bestWinScore <= 0) {
    return null;
  }

  // Compute tight centroid & spread inside the winning facial core window
  let hits = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXSq = 0;
  let sumYSq = 0;
  let lumSum = 0;
  let lumSqSum = 0;

  for (let r = bestR0; r < bestR0 + WIN_H; r++) {
    for (let c = bestC0; c < bestC0 + WIN_W; c++) {
      const i = r * COLS + c;
      const h = cellHits[i];
      if (h === 0) continue;
      hits += h;
      sumX += cellSumX[i];
      sumY += cellSumY[i];
      sumXSq += cellSumXSq[i];
      sumYSq += cellSumYSq[i];
      lumSum += cellLumSum[i];
      lumSqSum += cellLumSqSum[i];
    }
  }

  if (hits < 26) {
    return null;
  }

  const meanLum = lumSum / hits;
  const lumVariance = Math.max(0, lumSqSum / hits - meanLum * meanLum);
  if (lumVariance < 55) {
    return null;
  }

  const cx = sumX / hits;
  const cy = sumY / hits;
  const stdX = Math.sqrt(Math.max(16, sumXSq / hits - cx * cx));
  const stdY = Math.sqrt(Math.max(20, sumYSq / hits - cy * cy));

  const rawW = Math.max(108, Math.min(168, stdX * 3.5 * 4));
  const rawH = Math.max(132, Math.min(205, Math.max(rawW * 1.22, stdY * 3.6 * 4)));
  const rawX = cx * 4 - rawW * 0.5;
  const rawY = cy * 4 - rawH * 0.48;
  const displayX = mirrored ? 640 - rawX - rawW : rawX;

  return clampViewBoxRect(displayX, rawY, rawW, rawH, 0.85, "skin_cluster");
}
