import type { GameView, RoomView } from "../domain/types";

type MotionGameView = GameView & { gameInstanceId?: string; handId?: number };
type MotionRoomView = Omit<RoomView, "game"> & { game: MotionGameView | null };

export type MotionRect = Readonly<{ left: number; top: number; width: number; height: number }>;
export type MotionPoint = Readonly<{ x: number; y: number }>;
export type MotionQuad = Readonly<{
  topLeft: MotionPoint;
  topRight: MotionPoint;
  bottomRight: MotionPoint;
  bottomLeft: MotionPoint;
}>;
export type MotionNormal = Readonly<{
  depth: number;
  topLeft: MotionPoint;
  topRight: MotionPoint;
}>;
export type MotionTilePaint = Readonly<{
  background: string; border: string; borderRadius: string; padding: string;
  boxShadow: string; outline: string; outlineOffset: string; filter: string;
}>;

export type MotionSourceGeometry = Readonly<{ width: number; height: number; angle: number; scale: number; quad?: MotionQuad; depth?: number; normal?: MotionNormal }>;

function validQuad(quad: MotionQuad) {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  return Number.isFinite(area) && Math.abs(area) > 1;
}

function validNormal(normal: MotionNormal) {
  return Number.isFinite(normal.depth) && normal.depth > 0
    && [normal.topLeft.x, normal.topLeft.y, normal.topRight.x, normal.topRight.y].every(Number.isFinite);
}

export type DiscardMotionIntent = Readonly<{
  roomId: string;
  roomVersion: number;
  gameInstanceId: string;
  handId: number;
  decisionId: string;
  seat: number;
  choiceId: string;
  tileValue: string;
  sourceTileId: string;
  sourceRect: MotionRect;
  sourceGeometry: MotionSourceGeometry;
  sourcePaint?: MotionTilePaint;
  environmentEpoch: number;
}>;

export type DiscardEventIdentity = Readonly<{
  roomId: string;
  gameInstanceId: string;
  handId: number;
  seat: number;
  index: number;
}>;

export type DiscardMotionEvent = DiscardEventIdentity & Readonly<{ id: string; tile: string }>;

export type DiscardMotionFlight = Readonly<{
  event: DiscardMotionEvent;
  source: "own" | "opponent";
  sourceTileId?: string;
  sourceRect?: MotionRect;
  sourceGeometry?: MotionSourceGeometry;
  sourcePaint?: MotionTilePaint;
}>;

export type DiscardMotionResult = Readonly<{
  newEvents: DiscardMotionEvent[];
  flight: DiscardMotionFlight | null;
  cancelledEventIds: string[];
  reset: boolean;
}>;

type Baseline = {
  roomId: string;
  roomVersion: number;
  gameInstanceId: string;
  handId: number;
  decisionId: string;
  mySeat: number;
  choices: MotionGameView["choices"];
  players: Map<number, string[]>;
};

const emptyResult = (reset = false): DiscardMotionResult => ({ newEvents: [], flight: null, cancelledEventIds: [], reset });
const hasClaimMarker = (tile: string) => /[+\-=]$/.test(tile);
const discardTileValue = (tile: string) => tile.replace(/[+\-=_*]+$/g, "");

export function createDiscardEventId(identity: DiscardEventIdentity) {
  return `discard:${identity.roomId}:${identity.gameInstanceId}:${identity.handId}:${identity.seat}:${identity.index}`;
}

/** Diffs accepted public snapshots without replaying baselines or guessing gaps. */
export class DiscardMotionTracker {
  private baseline: Baseline | null = null;
  private seen = new Set<string>();

  reset() {
    this.baseline = null;
    this.seen.clear();
  }

  observe(room: MotionRoomView | null, options: { canAnimate: boolean; intent?: DiscardMotionIntent | null }): DiscardMotionResult {
    const game = room?.game;
    const gameInstanceId = game?.gameInstanceId;
    const handId = game?.handId;
    if (!room || room.status !== "playing" || !game) {
      const hadBaseline = this.baseline !== null;
      this.reset();
      return emptyResult(hadBaseline);
    }

    // Legacy/partial fixtures are safe to render, but cannot prove event identity.
    if (!gameInstanceId || !Number.isInteger(handId) || handId! < 1) {
      this.reset();
      return emptyResult(true);
    }

    const next = this.makeBaseline(room, game, gameInstanceId, handId!);
    const before = this.baseline;
    if (!before) {
      this.baseline = next;
      this.seedSeen(next);
      return emptyResult();
    }

    if (before.roomId !== next.roomId || before.gameInstanceId !== next.gameInstanceId || before.handId !== next.handId) {
      this.baseline = next;
      this.seen.clear();
      this.seedSeen(next);
      return emptyResult(true);
    }

    if (room.version <= before.roomVersion) {
      if (room.version < before.roomVersion || !this.sameDiscards(before, next)) {
        this.baseline = next;
        return emptyResult(true);
      }
      return emptyResult();
    }

    const newEvents: DiscardMotionEvent[] = [];
    const cancelledEventIds: string[] = [];
    let unexpectedRewrite = false;
    let additionCount = 0;

    for (const [seat, oldTiles] of before.players) {
      const currentTiles = next.players.get(seat) ?? [];
      if (currentTiles.length < oldTiles.length) {
        unexpectedRewrite = true;
        continue;
      }

      for (let index = 0; index < oldTiles.length; index++) {
        const oldTile = oldTiles[index];
        const tile = currentTiles[index];
        if (oldTile === tile) continue;
        if (!hasClaimMarker(oldTile) && hasClaimMarker(tile) && discardTileValue(oldTile) === discardTileValue(tile)) {
          cancelledEventIds.push(createDiscardEventId({ roomId: next.roomId, gameInstanceId: next.gameInstanceId, handId: next.handId, seat, index }));
        } else {
          unexpectedRewrite = true;
        }
      }

      for (let index = oldTiles.length; index < currentTiles.length; index++) {
        additionCount++;
        const identity = { roomId: next.roomId, gameInstanceId: next.gameInstanceId, handId: next.handId, seat, index };
        const id = createDiscardEventId(identity);
        if (this.seen.has(id)) continue;
        newEvents.push({ ...identity, id, tile: currentTiles[index] });
        this.remember(id);
      }
    }

    this.baseline = next;
    const continuousSingleEvent = !unexpectedRewrite
      && room.version === before.roomVersion + 1
      && additionCount === 1
      && newEvents.length === 1;
    if (!options.canAnimate || !continuousSingleEvent) {
      return { newEvents, flight: null, cancelledEventIds, reset: unexpectedRewrite };
    }

    const event = newEvents[0];
    if (event.seat === room.mySeat) {
      const intent = options.intent;
      const choice = before.choices.find(item => item.id === intent?.choiceId);
      const validIntent = intent
        && intent.roomId === room.id
        && intent.roomVersion === before.roomVersion
        && intent.gameInstanceId === before.gameInstanceId
        && intent.handId === before.handId
        && intent.decisionId === before.decisionId
        && intent.seat === room.mySeat
        && intent.seat === event.seat
        && choice
        && (choice.type === "discard" || choice.type === "riichi")
        && choice.value
        && discardTileValue(choice.value) === discardTileValue(intent.tileValue)
        && discardTileValue(choice.value) === discardTileValue(event.tile)
        && intent.sourceTileId.length > 0
        && intent.sourceRect.width > 0
        && intent.sourceRect.height > 0
        && intent.sourceGeometry.width > 0
        && intent.sourceGeometry.height > 0
        && Number.isFinite(intent.sourceGeometry.angle)
        && intent.sourceGeometry.scale > 0
        && (!intent.sourceGeometry.quad || validQuad(intent.sourceGeometry.quad))
        && (!intent.sourceGeometry.normal || validNormal(intent.sourceGeometry.normal));
      return {
        newEvents,
        flight: validIntent ? {
          event,
          source: "own",
          sourceTileId: intent.sourceTileId,
          sourceRect: intent.sourceRect,
          sourceGeometry: intent.sourceGeometry,
          sourcePaint: intent.sourcePaint,
        } : null,
        cancelledEventIds,
        reset: false,
      };
    }

    return { newEvents, flight: { event, source: "opponent" }, cancelledEventIds, reset: false };
  }

  private makeBaseline(room: MotionRoomView, game: MotionGameView, gameInstanceId: string, handId: number): Baseline {
    return {
      roomId: room.id,
      roomVersion: room.version,
      gameInstanceId,
      handId,
      decisionId: game.decisionId,
      mySeat: room.mySeat,
      choices: game.choices,
      players: new Map(game.players.map(player => [player.seat, player.discards.slice()])),
    };
  }

  private sameDiscards(left: Baseline, right: Baseline) {
    if (left.players.size !== right.players.size) return false;
    for (const [seat, tiles] of left.players) {
      const current = right.players.get(seat);
      if (!current || current.length !== tiles.length || tiles.some((tile, index) => tile !== current[index])) return false;
    }
    return true;
  }

  private seedSeen(snapshot: Baseline) {
    for (const [seat, tiles] of snapshot.players) {
      tiles.forEach((tile, index) => this.remember(createDiscardEventId({ roomId: snapshot.roomId, gameInstanceId: snapshot.gameInstanceId, handId: snapshot.handId, seat, index })));
    }
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
  }
}
