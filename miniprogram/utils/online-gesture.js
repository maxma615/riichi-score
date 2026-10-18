// Coordinates are viewport pixels, matching touch.clientX/Y and boundingClientRect.
function touchPoint(t) {
  return t && Number.isFinite(t.clientX) && Number.isFinite(t.clientY)
    ? { x: t.clientX, y: t.clientY }
    : null;
}
function validRect(r) {
  return (
    r &&
    [r.left, r.right, r.top, r.bottom].every(Number.isFinite) &&
    r.right > r.left &&
    r.bottom > r.top
  );
}
function contains(p, r, inset = 0) {
  return (
    validRect(r) &&
    p.x >= r.left + inset &&
    p.x <= r.right - inset &&
    p.y >= r.top + inset &&
    p.y <= r.bottom - inset
  );
}
function dropOnTable(point, geometry, projected = null) {
  return Boolean(
    point &&
      geometry &&
      (projected == null ? contains(point, geometry.table, 8) : projected === true) &&
      Array.isArray(geometry.excluded) &&
      !geometry.excluded.some((r) => contains(point, r)),
  );
}
module.exports = { touchPoint, dropOnTable };
