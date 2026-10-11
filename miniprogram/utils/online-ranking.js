const { rankingRowAt, rankingReadyAt } = require("./online-ranking-timing");

function rankingPresentation(game, seats, ownSeat, age) {
  if (!game?.ranking) return null;
  const rows = game.ranking.slice().sort((a, b) => a.rank - b.rank);
  const readyAt = rankingReadyAt(rows.length);
  // Old snapshots have no authoritative ranking clock: show the complete result.
  const elapsed = age ?? game.rankingFlow?.elapsedMs ?? readyAt;
  return {
    ready: elapsed >= readyAt,
    rows: rows.map((row, index) => ({
      ...row,
      name: seats.find((seat) => seat.seat === row.seat)?.name || "牌友",
      self: row.seat === ownSeat,
      scoreLabel: String(row.score).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
      visible: elapsed >= rankingRowAt(index),
    })),
  };
}
module.exports = { rankingPresentation };
