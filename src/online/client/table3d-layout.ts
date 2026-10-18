import Majiang from '@kobalab/majiang-core';
import type { RoomView } from '../domain/types';
import { openingTileCount } from '../domain/round-opening';
import { createDiscardEventId } from './discard-motion';
import { parseMeld } from './mahjong-meld-model';

/** Actual cuboid dimensions in world units; no camera projection is baked in. */
export const TILE = { width: .95, height: 1.35, depth: .6 } as const;
export const TABLE = { width: 34, depth: 26 } as const;
export type TablePiece = {
  id: string;
  seat: number;
  kind: 'concealed' | 'river' | 'meld' | 'nuki' | 'revealed';
  value?: string;
  faceDown: boolean;
  position: [number, number, number];
  /** Radians, using Three's default XYZ Euler order. */
  rotation: [number, number, number];
  eventId?: string;
  index?: number;
  meldIndex?: number;
  slotIndex?: number;
  layer?: 'called' | 'added';
};
type Options = {
  hiddenEventIds?: ReadonlySet<string>;
  openingAge?: number | null;
  revealedHands?: ReadonlyArray<{ seat: number; hand: string }>;
};
type Edge = { x: number; z: number; yaw: number };
type CoreHand = { _bingpai: Record<string, number[]> };
const GAP = .04;
const GROUP_GAP = .4;

function edgeAt(offset: number, capacity: number): Edge {
  if (offset === 0) return { x: 0, z: 10.5, yaw: 0 };
  if (offset === 1) return { x: 13, z: 0, yaw: Math.PI / 2 };
  if (offset === 2 && capacity === 4) return { x: 0, z: -10.5, yaw: Math.PI };
  return { x: -13, z: 0, yaw: -Math.PI / 2 };
}
/** u goes right along the owner's edge, v goes inward toward the table. */
function position(edge: Edge, u: number, v: number, y: number): TablePiece['position'] {
  const c = Math.round(Math.cos(edge.yaw)), s = Math.round(Math.sin(edge.yaw));
  return [edge.x + u * c - v * s, y, edge.z - u * s - v * c];
}
function flatRotation(yaw: number, sideways = false, back = false): TablePiece['rotation'] {
  // Rx(-PI/2) maps the face's +Z normal to +Y. The final local-Z turn
  // rotates the tile within that plane while keeping a single world camera.
  return back ? [Math.PI / 2, 0, -yaw] : [-Math.PI / 2, 0, yaw + (sideways ? Math.PI / 2 : 0)];
}
function closedFaces(encoded: string): string[] {
  const hand = Majiang.Shoupai.fromString(encoded) as unknown as CoreHand;
  const faces: string[] = [];
  for (const suit of ['m', 'p', 's', 'z']) {
    const counts = hand._bingpai[suit];
    for (let rank = 1; rank < counts.length; rank++) {
      if (rank === 5 && suit !== 'z') {
        for (let n = 0; n < counts[0]; n++) faces.push(`${suit}0`);
      }
      const count = counts[rank] - (rank === 5 && suit !== 'z' ? counts[0] : 0);
      for (let n = 0; n < count; n++) faces.push(`${suit}${rank}`);
    }
  }
  return faces;
}

/** Derive only public physical tiles. Own concealed tiles stay interactive DOM. */
export function table3dLayout(room: RoomView, ownSeat: number, options: Options = {}): TablePiece[] {
  const game = room.game;
  if (!game) return [];
  const capacity = room.variant === 'sanma' ? 3 : 4;
  const pieces: TablePiece[] = [];
  for (const player of game.players) {
    const offset = (player.seat - ownSeat + capacity) % capacity;
    const edge = edgeAt(offset, capacity);
    const reveal = options.revealedHands?.find(hand => hand.seat === player.seat);
    const faces = reveal ? closedFaces(reveal.hand) : null;
    const count = Math.min(14, Math.max(0, faces ? faces.length : player.handCount));
    const drawnGap = !faces && player.hasDrawnTile && count > 1 ? .3 : 0;
    const handWidth = count ? count * TILE.width + (count - 1) * GAP + drawnGap : 0;
    const melds = player.melds.map((value, index) => ({ parsed: parseMeld(value), index }))
      .filter(item => item.parsed !== null);
    const groupWidths = melds.map(({ parsed }) => parsed!.slots.reduce((width, slot, index) =>
      width + (slot.type === 'stack' || slot.type === 'tile' && slot.sideways ? TILE.height : TILE.width) + (index ? GAP : 0), 0));
    const meldWidth = groupWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, melds.length - 1) * GROUP_GAP;
    const totalWidth = handWidth + meldWidth + (handWidth && meldWidth ? GROUP_GAP : 0);
    let cursor = -totalWidth / 2;
    if (player.seat !== ownSeat) {
      const visibleCount = faces ? count : openingTileCount(options.openingAge ?? null, count);
      for (let index = 0; index < visibleCount; index++) {
        const u = cursor + TILE.width / 2 + index * (TILE.width + GAP) + (index === count - 1 ? drawnGap : 0);
        pieces.push({
          id: `${player.seat}:${faces ? 'revealed' : 'concealed'}:${index}`,
          seat: player.seat, index, kind: faces ? 'revealed' : 'concealed',
          ...(faces ? { value: faces[index] } : {}), faceDown: !faces,
          position: position(edge, u, 0, faces ? TILE.depth / 2 : TILE.height / 2),
          rotation: faces ? flatRotation(edge.yaw) : [0, edge.yaw, 0],
        });
      }
    }
    cursor += handWidth + (handWidth && meldWidth ? GROUP_GAP : 0);
    melds.forEach(({ parsed, index: meldIndex }) => {
      parsed!.slots.forEach((slot, slotIndex) => {
        const sideways = slot.type === 'stack' || slot.type === 'tile' && slot.sideways;
        const width = sideways ? TILE.height : TILE.width;
        const u = cursor + width / 2;
        const add = (value: string | undefined, back: boolean, layer: number) => pieces.push({
          id: `${player.seat}:meld:${meldIndex}:${slotIndex}:${layer}`,
          seat: player.seat, kind: 'meld', meldIndex, slotIndex,
          ...(slot.type === 'stack' ? { layer: layer === 1 ? 'added' as const : 'called' as const } : {}),
          ...(value ? { value } : {}), faceDown: back,
          position: position(edge, u, 0, TILE.depth * (layer + .5)),
          rotation: flatRotation(edge.yaw, sideways, back),
        });
        if (slot.type === 'stack') { add(slot.called, false, 0); add(slot.added, false, 1); }
        else if (slot.type === 'back') add(undefined, true, 0);
        else add(slot.value, false, 0);
        cursor += width + GAP;
      });
      cursor += GROUP_GAP - GAP;
    });

    // Separate public North pieces occupy a second, inward row at the right
    // corner, leaving the entire combined hand/meld footprint available.
    const nuki = Math.min(4, Math.max(0, player.nuki ?? 0));
    for (let index = 0; index < nuki; index++) pieces.push({
      id: `${player.seat}:nuki:${index}`, seat: player.seat, index, kind: 'nuki', value: 'z4', faceDown: false,
      position: position(edge, 8 + index * (TILE.width + GAP) - (nuki - 1) * (TILE.width + GAP) / 2, 1.8, TILE.depth / 2),
      rotation: flatRotation(edge.yaw),
    });

    let riichi = false;
    const visible: { value: string; index: number; sideways: boolean }[] = [];
    player.discards.forEach((tile, index) => {
      if (tile.includes('*')) riichi = true;
      if (/[+\-=]$/.test(tile)) return;
      visible.push({ value: tile.slice(0, 2), index, sideways: riichi });
      riichi = false;
    });
    for (let row = 0; row * 6 < visible.length; row++) {
      const tiles = visible.slice(row * 6, row * 6 + 6);
      // Keep all six positions even while one mesh is hidden for its flight.
      // A sideways declaration consumes its actual 1.35-unit footprint.
      let u = -3 * (TILE.width + GAP);
      for (const tile of tiles) {
        const width = tile.sideways ? TILE.height : TILE.width;
        const eventId = game.gameInstanceId && Number.isInteger(game.handId)
          ? createDiscardEventId({ roomId: room.id, gameInstanceId: game.gameInstanceId, handId: game.handId!, seat: player.seat, index: tile.index }) : undefined;
        if (!eventId || !options.hiddenEventIds?.has(eventId)) pieces.push({
          id: eventId ?? `${player.seat}:river:${tile.index}`, seat: player.seat, index: tile.index, kind: 'river', value: tile.value,
          faceDown: false, position: position(edge, u + width / 2, 6.3 - row * (TILE.height + .1), TILE.depth / 2),
          rotation: flatRotation(edge.yaw, tile.sideways), ...(eventId ? { eventId } : {}),
        });
        u += width + GAP;
      }
    }
  }
  return pieces;
}
