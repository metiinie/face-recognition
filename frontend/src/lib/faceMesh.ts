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
