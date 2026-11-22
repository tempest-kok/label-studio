/**
 * Pure geometry helpers for the "trace neighbour contour" tool.
 *
 * No dependencies on the editor, MobX or Konva: everything works on plain arrays,
 * so it can be unit-tested in isolation and ported between Label Studio versions.
 *
 * Conventions:
 *  - A point is `[x, y]`.
 *  - "pct" points are in image percent (0..100), the way the editor stores polygons.
 *  - "px" points are in pixels of the original image.
 *  - A ring is an array of points describing a closed polygon
 *    (the first point is NOT repeated at the end).
 */

export const DEFAULT_GAP_PX = 2;
export const DEFAULT_MITER_LIMIT = 4;
export const PATH_MODE = { SHORT: "short", LONG: "long" };

const EPS = 1e-9;

/** percent (0..100) -> original image pixels */
export function toPixels(points, width, height) {
  return points.map(([x, y]) => [(x * width) / 100, (y * height) / 100]);
}

/** original image pixels -> percent (0..100) */
export function toPercent(points, width, height) {
  return points.map(([x, y]) => [(x / width) * 100, (y / height) * 100]);
}

/** Signed area (shoelace). Sign depends on the ring orientation; only the sign matters here. */
export function signedArea(ring) {
  let sum = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];

    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function polygonArea(ring) {
  return Math.abs(signedArea(ring));
}

/** Ray casting. Points exactly on the border may go either way. */
export function pointInPolygon(point, ring) {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Nearest vertex of the ring to the point.
 * @returns {{index: number, distance: number} | null} null if nothing is closer than maxDistance
 */
export function nearestVertex(ring, point, maxDistance = Number.POSITIVE_INFINITY) {
  let best = null;

  ring.forEach(([x, y], index) => {
    const distance = Math.hypot(x - point[0], y - point[1]);

    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { index, distance };
    }
  });
  return best;
}

/** Indices of a ring walked from `from` to `to` (both included) with step +1 or -1, wrapping around. */
export function arcIndices(n, from, to, step) {
  const result = [from];
  let i = from;

  while (i !== to) {
    i = (i + step + n) % n;
    result.push(i);
  }
  return result;
}

/** Length of the polyline made of ring vertices taken in the given index order. */
export function pathLength(ring, indices) {
  let length = 0;

  for (let i = 1; i < indices.length; i++) {
    const [x1, y1] = ring[indices[i - 1]];
    const [x2, y2] = ring[indices[i]];

    length += Math.hypot(x2 - x1, y2 - y1);
  }
  return length;
}

/**
 * Pick one of the two arcs of the ring between vertices `from` and `to`.
 *  - SHORT: the arc with fewer vertices (ties are broken by geometric length, then by forward direction)
 *  - LONG: the other arc
 * Indices are ordered from `from` to `to`.
 * @returns {number[] | null} null for degenerate input (ring < 3 vertices, bad or equal indices)
 */
export function choosePath(ring, from, to, mode) {
  const n = ring.length;
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < n;

  if (n < 3 || !valid(from) || !valid(to) || from === to) return null;

  const forward = arcIndices(n, from, to, 1);
  const backward = arcIndices(n, from, to, -1);
  let forwardIsShort;

  if (forward.length !== backward.length) {
    forwardIsShort = forward.length < backward.length;
  } else {
    forwardIsShort = pathLength(ring, forward) <= pathLength(ring, backward);
  }

  const shortPath = forwardIsShort ? forward : backward;
  const longPath = forwardIsShort ? backward : forward;

  return mode === PATH_MODE.LONG ? longPath : shortPath;
}

/**
 * Offset every vertex of the ring OUTWARD by `distance` (miter join).
 * Works for both ring orientations and for concave corners.
 * The offset at sharp corners is limited to `distance * miterLimit`.
 * @returns {number[][]} new ring, same length and order
 */
export function offsetRing(ring, distance, miterLimit = DEFAULT_MITER_LIMIT) {
  const n = ring.length;
  const orientation = signedArea(ring) >= 0 ? 1 : -1;

  // outward unit normal of every edge i -> i+1 (null for zero-length edges)
  const normals = ring.map(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % n];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    if (length < EPS) return null;
    return [(orientation * dy) / length, (-orientation * dx) / length];
  });

  return ring.map(([x, y], i) => {
    let n1 = normals[(i - 1 + n) % n];
    let n2 = normals[i];

    if (!n1 && !n2) return [x, y];
    if (!n1) n1 = n2;
    if (!n2) n2 = n1;

    const mx = n1[0] + n2[0];
    const my = n1[1] + n2[1];
    const mLength = Math.hypot(mx, my);

    // the contour turns back on itself (180 degrees): no meaningful bisector
    if (mLength < EPS) return [x + n1[0] * distance, y + n1[1] * distance];

    const bx = mx / mLength;
    const by = my / mLength;
    const cosHalfAngle = bx * n1[0] + by * n1[1];
    const factor = Math.min(1 / Math.max(cosHalfAngle, EPS), miterLimit);

    return [x + bx * distance * factor, y + by * distance * factor];
  });
}

/**
 * Main entry point: the points that repeat the contour of a neighbour polygon
 * between its vertices `from` and `to`, shifted outward by `gapPx` image pixels.
 *
 * @param {Object} params
 * @param {number[][]} params.ring neighbour polygon in percent (0..100)
 * @param {number} params.width original image width, px
 * @param {number} params.height original image height, px
 * @param {number} params.from index of the start vertex
 * @param {number} params.to index of the end vertex
 * @param {"short"|"long"} params.mode which of the two arcs to take
 * @param {number} [params.gapPx] gap between the polygons, image px
 * @param {number} [params.miterLimit]
 * @param {boolean} [params.clampToImage] keep points inside the image
 * @returns {{indices: number[], points: number[][]} | null} points in percent, ordered from `from` to `to`
 */
export function traceContour({
  ring,
  width,
  height,
  from,
  to,
  mode = PATH_MODE.SHORT,
  gapPx = DEFAULT_GAP_PX,
  miterLimit = DEFAULT_MITER_LIMIT,
  clampToImage = true,
}) {
  const px = toPixels(ring, width, height);
  const indices = choosePath(px, from, to, mode);

  if (!indices) return null;

  const shifted = offsetRing(px, gapPx, miterLimit);
  let points = indices.map((i) => shifted[i]);

  if (clampToImage) {
    const clamp = (value, max) => Math.min(Math.max(value, 0), max);

    points = points.map(([x, y]) => [clamp(x, width), clamp(y, height)]);
  }

  return { indices, points: toPercent(points, width, height) };
}
