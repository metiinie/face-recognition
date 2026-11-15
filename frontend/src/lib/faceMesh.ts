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
 * Compute continuous multi-harmonic Lissajous crawler coordinates in [0..1 x 0..1]
 * normalized face space so the spider visits eyes, nose, cheeks, forehead, and jaw.
 */
export function getNormalizedSpiderPos(phaseRad: number): { x: number; y: number } {
  const nx = 0.5 + Math.sin(phaseRad * 1.15) * 0.25 + Math.cos(phaseRad * 2.45) * 0.1;
  const ny = 0.5 + Math.cos(phaseRad * 0.9) * 0.28 + Math.sin(phaseRad * 1.95) * 0.1;
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
  const bend = Math.min(maxBend, dist * 0.24) * side;
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

function meanGridRect(
  grid: Float32Array,
  cols: number,
  rStart: number,
  rEnd: number,
  cStart: number,
  cEnd: number
): number {
  let sum = 0;
  let count = 0;
  for (let r = rStart; r < rEnd; r++) {
    const rowOff = r * cols;
    for (let c = cStart; c < cEnd; c++) {
      sum += grid[rowOff + c];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Real-time client-side face localization from a live HTMLVideoElement frame.
 * Uses native Shape Detection `FaceDetector` when supported, falling back cleanly
 * to a lighting-adaptive multi-cue 40x30 facial-core detector on a 160x120 buffer.
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

  // Path B: Lighting-adaptive multi-cue 40x30 facial-core detector on 160x120 frame
  const imgData = ctx.getImageData(0, 0, W, H).data;
  const N = W * H;
  const yArr = new Float32Array(N);
  const cbArr = new Float32Array(N);
  const crArr = new Float32Array(N);
  const rbArr = new Float32Array(N);
  const warmthArr = new Float32Array(N);
  const warmthSamples: number[] = [];

  for (let p = 0; p < N; p++) {
    const idx = p * 4;
    const r = imgData[idx];
    const g = imgData[idx + 1];
    const b = imgData[idx + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const rb = r - b;
    const warmth = (cr - cb) + 0.35 * (rb > 0 ? rb : 0);

    yArr[p] = lum;
    cbArr[p] = cb;
    crArr[p] = cr;
    rbArr[p] = rb;
    warmthArr[p] = warmth;
    if ((p & 15) === 0) {
      warmthSamples.push(warmth);
    }
  }

  warmthSamples.sort((a, b) => a - b);
  const bgWarmth = warmthSamples.length > 0 ? warmthSamples[(warmthSamples.length / 2) | 0] : 0;
  const minWarmth = Math.max(3.0, bgWarmth + 1.1);

  const skinMask = new Uint8Array(N);
  const gradArr = new Float32Array(N);

  const CELL = 4;
  const GW = W / CELL; // 40
  const GH = H / CELL; // 30
  const invCellPixels = 1 / (CELL * CELL);
  const cSkin = new Float32Array(GW * GH);
  const cGrad = new Float32Array(GW * GH);
  const cY = new Float32Array(GW * GH);

  let totalSkinPts = 0;
  for (let py = 0; py < H; py++) {
    const rowOff = py * W;
    const cellR = (py / CELL) | 0;
    const cellRowOff = cellR * GW;
    for (let px = 0; px < W; px++) {
      const p = rowOff + px;
      const lum = yArr[p];
      const cb = cbArr[p];
      const cr = crArr[p];
      const rb = rbArr[p];
      const warmth = warmthArr[p];

      const gx = px > 0 ? Math.abs(lum - yArr[p - 1]) : 0;
      const gy = py > 0 ? Math.abs(lum - yArr[p - W]) : 0;
      const grad = gx + 1.2 * gy;
      gradArr[p] = grad;

      const isSkin =
        lum >= 16 &&
        lum <= 242 &&
        cb >= 74 &&
        cb <= 136 &&
        cr >= 127.5 &&
        cr <= 182 &&
        cr - cb >= 2.2 &&
        rb >= 3.0 &&
        (warmth >= minWarmth || cr - cb >= 12);

      const cIdx = cellRowOff + ((px / CELL) | 0);
      if (isSkin) {
        skinMask[p] = 1;
        cSkin[cIdx] += invCellPixels;
        totalSkinPts += 1;
      }
      cGrad[cIdx] += grad * invCellPixels;
      cY[cIdx] += lum * invCellPixels;
    }
  }

  if (totalSkinPts < 32) {
    return null;
  }

  const candidateWindows: ReadonlyArray<[number, number]> = [
    [7, 9],
    [8, 11],
    [10, 13],
    [12, 15],
  ];

  let bestScore = -1e9;
  let bestWin: { r0: number; c0: number; ww: number; wh: number } | null = null;

  for (let wIdx = 0; wIdx < candidateWindows.length; wIdx++) {
    const [ww, wh] = candidateWindows[wIdx];
    for (let r0 = 1; r0 < GH - wh - 1; r0++) {
      for (let c0 = 1; c0 < GW - ww - 1; c0++) {
        const coreSkin = meanGridRect(cSkin, GW, r0 + 1, r0 + wh - 1, c0 + 1, c0 + ww - 1);
        if (coreSkin < 0.18) continue;

        const coreGrad = meanGridRect(cGrad, GW, r0 + 1, r0 + wh - 1, c0 + 1, c0 + ww - 1);
        if (coreGrad < 8.5) continue;

        const eyeGrad = meanGridRect(
          cGrad,
          GW,
          r0 + Math.floor(wh * 0.2),
          r0 + Math.floor(wh * 0.65),
          c0 + 1,
          c0 + ww - 1
        );
        const crownY = meanGridRect(
          cY,
          GW,
          r0,
          r0 + Math.max(2, Math.floor(wh / 4)),
          c0 + 1,
          c0 + ww - 1
        );
        const leftSkin = c0 >= 2 ? meanGridRect(cSkin, GW, r0, r0 + wh, c0 - 2, c0) : 0;
        const rightSkin = c0 + ww + 2 <= GW ? meanGridRect(cSkin, GW, r0, r0 + wh, c0 + ww, c0 + ww + 2) : 0;
        const topY = meanGridRect(cY, GW, Math.max(0, r0 - 2), r0, c0, c0 + ww);
        const surroundSkin = 0.5 * (leftSkin + rightSkin);
        const contrastBonus = Math.max(0, topY - crownY) * 0.4;

        const score = coreSkin * (coreGrad + 0.8 * eyeGrad + contrastBonus) * (1.2 - 0.7 * surroundSkin);
        if (score > bestScore) {
          bestScore = score;
          bestWin = { r0, c0, ww, wh };
        }
      }
    }
  }

  if (!bestWin) {
    return null;
  }

  // Refine exact facial center via skin * (2 + grad) weighted centroid inside winning window
  const x0 = bestWin.c0 * CELL;
  const y0 = bestWin.r0 * CELL;
  const pw = bestWin.ww * CELL;
  const ph = bestWin.wh * CELL;
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let py = y0; py < y0 + ph; py++) {
    const rowOff = py * W;
    for (let px = x0; px < x0 + pw; px++) {
      const p = rowOff + px;
      if (!skinMask[p]) continue;
      const wgt = 2 + gradArr[p];
      sumW += wgt;
      sumX += px * wgt;
      sumY += py * wgt;
    }
  }

  const cx = sumW > 0 ? sumX / sumW : x0 + pw * 0.5;
  const cy = sumW > 0 ? sumY / sumW : y0 + ph * 0.5;

  const rawW = bestWin.ww * CELL * 4;
  const rawH = Math.max(Math.round(rawW * 1.28), bestWin.wh * CELL * 4);
  const rawX = cx * 4 - rawW * 0.5;
  const rawY = cy * 4 - rawH * 0.48;
  const displayX = mirrored ? 640 - rawX - rawW : rawX;

  return clampViewBoxRect(displayX, rawY, rawW, rawH, 0.9, "skin_cluster");
}
