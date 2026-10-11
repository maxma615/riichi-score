/** Center an integer 16:9 table inside the physical viewport, without scaling
 * tile gestures. Rotation swaps the available axes before fitting. */
export function fitTableViewport(viewportWidth: number, viewportHeight: number, rotated: boolean) {
  if (![viewportWidth, viewportHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const availableWidth = rotated ? viewportHeight : viewportWidth;
  const availableHeight = rotated ? viewportWidth : viewportHeight;
  const width = Math.floor(Math.min(availableWidth, availableHeight * 16 / 9));
  const height = Math.floor(Math.min(availableHeight, availableWidth * 9 / 16));
  if (!width || !height) return null;
  return { width, height, rotated };
}
