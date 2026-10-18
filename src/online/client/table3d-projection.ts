import type { MotionPoint, MotionRect, MotionSourceGeometry } from './discard-motion';

/** Published coordinates are viewport CSS pixels; corners retain tile-local order. */
export type ProjectedTile = Readonly<{ rect: MotionRect; geometry: MotionSourceGeometry }>;
export type ProjectedTable = Readonly<{ felt: readonly MotionPoint[]; blocked: readonly (readonly MotionPoint[])[] }>;
export type ProjectedRect = MotionRect & Readonly<{ x: number; y: number; right: number; bottom: number }>;
type Scene = { frame: string; projection?: ProjectedTable };
const scenes = new WeakMap<HTMLElement, Scene>();
const tiles = new WeakMap<HTMLElement, { table: HTMLElement; scene: Scene; tile: ProjectedTile }>();

function frame(table: HTMLElement) {
  const r = table.getBoundingClientRect(), view = table.ownerDocument.defaultView;
  const game = table.closest<HTMLElement>('.mahjong-game');
  return [r.left, r.top, r.width, r.height, game?.dataset.tableRotated,
    view?.innerWidth, view?.innerHeight, view?.visualViewport?.width, view?.visualViewport?.height,
    view?.visualViewport?.offsetLeft, view?.visualViewport?.offsetTop, view?.visualViewport?.scale].join(':');
}

function sceneFor(table: HTMLElement, create = false) {
  if (!table.isConnected) return null;
  const current = frame(table);
  let scene = scenes.get(table);
  if (scene && scene.frame !== current) { scenes.delete(table); scene = undefined; }
  if (!scene && create) { scene = { frame: current }; scenes.set(table, scene); }
  return scene ?? null;
}

export function clearProjectedTable(table: HTMLElement) { scenes.delete(table); }

export function publishProjectedTile(element: HTMLElement, value: ProjectedTile) {
  const table = element.closest<HTMLElement>('.mahjong-table');
  const scene = table && sceneFor(table, true);
  if (!table || !scene) return;
  const { rect, geometry } = value;
  if (![rect.left, rect.top, rect.width, rect.height, geometry.width, geometry.height, geometry.angle, geometry.scale].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || geometry.width <= 0 || geometry.height <= 0) { tiles.delete(element); return; }
  const quad = geometry.quad && {
    topLeft: { ...geometry.quad.topLeft }, topRight: { ...geometry.quad.topRight },
    bottomRight: { ...geometry.quad.bottomRight }, bottomLeft: { ...geometry.quad.bottomLeft },
  };
  const normal = geometry.normal && { ...geometry.normal, topLeft: { ...geometry.normal.topLeft }, topRight: { ...geometry.normal.topRight } };
  tiles.set(element, { table, scene, tile: { rect: { ...rect }, geometry: { ...geometry, ...(quad ? {quad} : {}), ...(normal ? {normal} : {}) } } });
}

export function readProjectedTile(element: HTMLElement): ProjectedTile | null {
  const saved = tiles.get(element);
  if (!saved || !element.isConnected || !saved.table.contains(element) || sceneFor(saved.table) !== saved.scene) return null;
  return saved.tile;
}

/** Wrappers use the union of their registered mesh faces for action placement. */
export function projectedRect(element: Element): ProjectedRect | null {
  const direct = readProjectedTile(element as HTMLElement);
  const rects = direct ? [direct.rect] : [...element.querySelectorAll<HTMLElement>('.mahjong-tile, [data-motion-surface]')]
    .map(child => readProjectedTile(child)?.rect).filter((r): r is MotionRect => Boolean(r));
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.left + r.width)), bottom = Math.max(...rects.map(r => r.top + r.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top };
}

function validPolygon(points: readonly MotionPoint[]) {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const area = points.reduce((sum, p, i) => { const next = points[(i + 1) % points.length]; return sum + p.x * next.y - next.x * p.y; }, 0);
  return Math.abs(area) > 1e-6;
}

export function publishProjectedTable(table: HTMLElement, projection: ProjectedTable) {
  const scene = sceneFor(table, true);
  if (!scene) return;
  if (!validPolygon(projection.felt) || projection.blocked.some(p => !validPolygon(p))) { scene.projection = undefined; return; }
  scene.projection = { felt: projection.felt.map(p => ({...p})), blocked: projection.blocked.map(p => p.map(point => ({...point}))) };
}

function contains(polygon: readonly MotionPoint[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-6 && x >= Math.min(a.x,b.x) && x <= Math.max(a.x,b.x)
      && y >= Math.min(a.y,b.y) && y <= Math.max(a.y,b.y)) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** null means no current WebGL projection; callers may use their DOM fallback. */
export function projectedDiscardTarget(table: HTMLElement, x: number, y: number): boolean | null {
  const projection = sceneFor(table)?.projection;
  if (!projection) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return contains(projection.felt, x, y) && !projection.blocked.some(p => contains(p, x, y));
}
