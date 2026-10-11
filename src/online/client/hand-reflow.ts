import type { DiscardMotionIntent } from "./discard-motion";
import type { RoomView } from "../domain/types";

export type HandReflowRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type HandReflowTile = Readonly<{ instanceId: string; face: string; rect: HandReflowRect }>;
export type HandReflowOccurrence = Readonly<{
  sourceInstanceId: string;
  targetInstanceId: string;
  face: string;
  from: HandReflowRect;
  to: HandReflowRect;
}>;

const discardValue = (value: string) => value.replace(/[+\-=_*]+$/g, "");
const validRect = (rect: HandReflowRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  && rect.width > 0 && rect.height > 0;

/** Match each sorted destination with the exact pre-discard physical occurrence. */
export function matchHandReflowOccurrences(
  source: readonly HandReflowTile[],
  target: readonly HandReflowTile[],
  discardedInstanceId: string,
): HandReflowOccurrence[] {
  if (!discardedInstanceId || source.length !== target.length + 1) return [];
  if (new Set(source.map(tile => tile.instanceId)).size !== source.length
    || new Set(target.map(tile => tile.instanceId)).size !== target.length
    || source.some(tile => !tile.instanceId || !tile.face || !validRect(tile.rect))
    || target.some(tile => !tile.instanceId || !tile.face || !validRect(tile.rect))) return [];

  const discardedCount = source.filter(tile => tile.instanceId === discardedInstanceId).length;
  if (discardedCount !== 1) return [];

  const sourcesByFace = new Map<string, HandReflowTile[]>();
  for (const tile of source) {
    if (tile.instanceId === discardedInstanceId) continue;
    const occurrences = sourcesByFace.get(tile.face) ?? [];
    occurrences.push(tile);
    sourcesByFace.set(tile.face, occurrences);
  }

  const matches: HandReflowOccurrence[] = [];
  for (const destination of target) {
    const occurrence = sourcesByFace.get(destination.face)?.shift();
    if (!occurrence) return [];
    matches.push({
      sourceInstanceId: occurrence.instanceId,
      targetInstanceId: destination.instanceId,
      face: destination.face,
      from: occurrence.rect,
      to: destination.rect,
    });
  }

  if ([...sourcesByFace.values()].some(remaining => remaining.length > 0)) return [];
  return matches;
}

/** Prove that a single server version accepted this exact local hand discard. */
export function isAcceptedOwnHandDiscard(
  before: RoomView | null,
  after: RoomView,
  intent: DiscardMotionIntent | null,
): boolean {
  if (!before || !intent || before.status !== "playing" || after.status !== "playing") return false;
  const previousGame = before.game, nextGame = after.game;
  if (!previousGame || !nextGame
    || before.id !== after.id || before.id !== intent.roomId
    || before.version !== intent.roomVersion || after.version !== before.version + 1
    || before.mySeat !== intent.seat || after.mySeat !== intent.seat
    || previousGame.gameInstanceId !== intent.gameInstanceId || nextGame.gameInstanceId !== previousGame.gameInstanceId
    || previousGame.handId !== intent.handId || nextGame.handId !== previousGame.handId
    || previousGame.decisionId !== intent.decisionId || nextGame.decisionId === previousGame.decisionId) return false;

  const choice = previousGame.choices.find(candidate => candidate.id === intent.choiceId);
  if (!choice || (choice.type !== "discard" && choice.type !== "riichi") || !choice.value
    || discardValue(choice.value) !== discardValue(intent.tileValue)
    || !intent.sourceTileId || intent.sourceRect.width <= 0 || intent.sourceRect.height <= 0
    || intent.sourceGeometry.width <= 0 || intent.sourceGeometry.height <= 0) return false;

  const oldPlayers = new Map(previousGame.players.map(player => [player.seat, player]));
  const newPlayers = new Map(nextGame.players.map(player => [player.seat, player]));
  if (oldPlayers.size === 0 || oldPlayers.size !== newPlayers.size) return false;
  for (const [seat, oldPlayer] of oldPlayers) {
    const newPlayer = newPlayers.get(seat);
    if (!newPlayer) return false;
    if (seat === intent.seat) {
      const oldDiscards = oldPlayer.discards, newDiscards = newPlayer.discards;
      if (newDiscards.length !== oldDiscards.length + 1
        || oldDiscards.some((tile, index) => newDiscards[index] !== tile)
        || discardValue(newDiscards[oldDiscards.length]) !== discardValue(choice.value)) return false;
    } else if (oldPlayer.discards.length !== newPlayer.discards.length
      || oldPlayer.discards.some((tile, index) => newPlayer.discards[index] !== tile)) return false;
  }
  return true;
}
