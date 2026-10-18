// Page width can rotate before DevTools' window-info snapshot does.
function horizontalInsets(info, pageWidth) {
  const area = info?.safeArea;
  const sw = info?.screenWidth;
  const sh = info?.screenHeight;
  if (!area || ![pageWidth, sw, sh].every(Number.isFinite) || pageWidth <= 0)
    return { left: 0, right: 0 };
  const rotatedPortrait =
    sw < sh && pageWidth > sw && Math.abs(pageWidth - sh) < 2;
  // A stale portrait snapshot does not say which way the device rotated.
  const rotatedInset = Math.max(area.top || 0, sh - area.bottom || 0);
  const left = rotatedPortrait ? rotatedInset : area.left;
  const right = rotatedPortrait ? rotatedInset : sw - area.right;
  const clamp = (n) =>
    Number.isFinite(n) ? Math.max(0, Math.min(n, pageWidth / 4)) : 0;
  return { left: clamp(left), right: clamp(right) };
}
module.exports = { horizontalInsets };
