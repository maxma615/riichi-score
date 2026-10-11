import type { RoomView } from "../domain/types";
import type { HandReflowTile } from "./hand-reflow";

/** Only a consecutive authoritative public extraction can initiate movement. */
export function acceptedNukiEvent(before: RoomView | null, after: RoomView): { seat: number; index: number; id: string } | null {
  const oldGame = before?.game, game = after.game;
  if (!before || !oldGame || !game || before.status !== "playing" || after.status !== "playing"
    || before.variant !== "sanma" || after.variant !== "sanma" || before.id !== after.id
    || after.version !== before.version + 1 || before.mySeat !== after.mySeat
    || !oldGame.gameInstanceId || oldGame.gameInstanceId !== game.gameInstanceId
    || !Number.isInteger(oldGame.handId) || oldGame.handId !== game.handId
    || !oldGame.decisionId || !game.decisionId || oldGame.decisionId === game.decisionId || oldGame.settlement || game.settlement
    || !["zimo", "nukizimo", "gangzimo", "nuki"].includes(oldGame.phase) || game.phase !== "nukizimo") return null;
  if (oldGame.players.length !== 3 || game.players.length !== 3
    || new Set(oldGame.players.map(player => player.seat)).size !== 3
    || new Set(game.players.map(player => player.seat)).size !== 3) return null;

  let event: { seat: number; index: number; id: string } | null = null;
  for (const oldPlayer of oldGame.players) {
    const player = game.players.find(player => player.seat === oldPlayer.seat);
    if (!player || JSON.stringify(oldPlayer.discards) !== JSON.stringify(player.discards)
      || JSON.stringify(oldPlayer.melds) !== JSON.stringify(player.melds)) return null;
    const previousCount = oldPlayer.nuki ?? 0, count = player.nuki ?? 0;
    if (!Number.isInteger(previousCount) || previousCount < 0 || !Number.isInteger(count) || count < 0 || count > 4) return null;
    if (count !== previousCount) {
      if (event || count !== previousCount + 1 || oldPlayer.seat !== oldGame.turnSeat || oldPlayer.seat !== game.turnSeat) return null;
      event = { seat: oldPlayer.seat, index: previousCount, id: `nuki:${after.id}:${game.gameInstanceId}:${game.handId}:${oldPlayer.seat}:${previousCount}` };
    }
  }
  if (event?.seat === after.mySeat) {
    if (!game.drawnTile || oldGame.hand.filter(tile => tile === "z4").length < 1) return null;
    const survivors = oldGame.hand.slice();
    survivors.splice(survivors.indexOf("z4"), 1);
    const closed = game.hand.at(-1) === game.drawnTile ? game.hand.slice(0, -1) : game.hand;
    if (JSON.stringify(survivors.sort()) !== JSON.stringify([...closed].sort())) return null;
  }
  return event;
}

export function uniqueOwnNorthInstance(tiles: readonly HandReflowTile[]): string | null {
  const north = tiles.filter(tile => tile.face === "z4");
  return north.length === 1 && north[0].instanceId ? north[0].instanceId : null;
}
