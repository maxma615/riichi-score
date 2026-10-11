import type { MotionQuad } from "./discard-motion";

/** The two top corners measured after the same positive local Z translation. */
export type ProjectedNormal = Readonly<{
  depth: number;
  topLeft: MotionQuad["topLeft"];
  topRight: MotionQuad["topRight"];
}>;

/**
 * Maps a local border-box rectangle to four viewport points. The optional
 * layout offset lets a fixed portal keep its existing center-based left/top
 * coordinates while the matrix itself is relative to that layout origin.
 */
export function quadToMatrix3d(width: number, height: number, quad: MotionQuad, offsetX = 0, offsetY = 0, normal?: ProjectedNormal) {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)
    || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)
    || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;

  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = topRight.x - topLeft.x + g * topRight.x;
  const b = bottomLeft.x - topLeft.x + h * bottomLeft.x;
  const c = topRight.y - topLeft.y + g * topRight.y;
  const d = bottomLeft.y - topLeft.y + h * bottomLeft.y;

  const m14 = g / width;
  const m24 = h / height;
  let zX = 0, zY = 0, zPerspective = 0;
  if (normal) {
    const { depth, topLeft: raisedLeft, topRight: raisedRight } = normal;
    if (!(depth > 0) || !Number.isFinite(depth)
      || [raisedLeft.x, raisedLeft.y, raisedRight.x, raisedRight.y].some(value => !Number.isFinite(value))) return null;
    const dx = raisedRight.x - raisedLeft.x;
    const dy = raisedRight.y - raisedLeft.y;
    const distanceSquared = dx * dx + dy * dy;
    const faceWidthSquared = (topRight.x - topLeft.x) ** 2 + (topRight.y - topLeft.y) ** 2;
    // A nearly collapsed measured edge cannot reliably determine the Z column.
    if (distanceSquared < Math.max(1e-8, faceWidthSquared * 1e-4)) return null;

    // The four face corners determine the X/Y plane homography. Two corners
    // on a parallel measured plane determine the missing Z column. Retain
    // perspective in that column, rather than drawing side walls in a flat
    // viewport plane. Their lower endpoints then remain on the actual felt.
    const leftX = (raisedLeft.x - topLeft.x) / depth;
    const leftY = (raisedLeft.y - topLeft.y) / depth;
    const rightX = (raisedRight.x * (g + 1) - a - topLeft.x) / depth;
    const rightY = (raisedRight.y * (g + 1) - c - topLeft.y) / depth;
    zPerspective = -(dx * (rightX - leftX) + dy * (rightY - leftY)) / distanceSquared;
    zX = leftX + raisedLeft.x * zPerspective;
    zY = leftY + raisedLeft.y * zPerspective;
    const rightW = 1 + g + zPerspective * depth;
    // Validate the whole tile volume, including its lower face, before allowing
    // a projective denominator to cross the camera plane.
    for (const z of [-depth, 0, depth]) {
      for (const planeW of [1, 1 + g, 1 + h, 1 + g + h]) {
        const w = planeW + zPerspective * z;
        if (!Number.isFinite(w) || w <= 1e-8) return null;
      }
    }
    const residual = Math.hypot(
      (a + topLeft.x + zX * depth) / rightW - raisedRight.x,
      (c + topLeft.y + zY * depth) / rightW - raisedRight.y,
    );
    if (!Number.isFinite(residual) || residual > .5) return null;
  }
  const values = [
    a / width - offsetX * m14,
    c / width - offsetY * m14,
    0,
    m14,
    b / height - offsetX * m24,
    d / height - offsetY * m24,
    0,
    m24,
    zX - offsetX * zPerspective,
    zY - offsetY * zPerspective,
    1,
    zPerspective,
    topLeft.x - offsetX,
    topLeft.y - offsetY,
    0,
    1,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;
  return `matrix3d(${values.map((value) => Number(value.toFixed(8))).join(", ")})`;
}
