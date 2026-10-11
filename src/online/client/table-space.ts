import type { PlacementRect } from './action-placement';

/** A frozen coordinate frame for the full-screen DOM table. Hit testing still
 * uses physical client coordinates; only layout and tile translations are local. */
export type TableSpace = Readonly<{ rotated: boolean; left: number; top: number; right: number; width: number; height: number }>;
export function tableSpace(element: HTMLElement): TableSpace {
  const r = element.getBoundingClientRect();
  const rotated = element.dataset.tableRotated === 'true';
  return { rotated, left: r.left, top: r.top, right: r.right, width: rotated ? r.height : r.width, height: rotated ? r.width : r.height };
}
export function tablePoint(space: TableSpace, x: number, y: number) {
  return space.rotated ? { x: y - space.top, y: space.right - x } : { x: x - space.left, y: y - space.top };
}
export function tableDelta(space: TableSpace, x: number, y: number) {
  return space.rotated ? { x: y, y: -x } : { x, y };
}
export function tableRect(space: TableSpace, r: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>): PlacementRect {
  const a = tablePoint(space, r.left, r.top), b = tablePoint(space, r.right, r.bottom);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: space.rotated ? r.height : r.width, h: space.rotated ? r.width : r.height };
}
