const { tile, meld } = require("./online");
// Concealed hand strings contain multiple suits; they are not individual melds.
function closedTiles(value) {
  return (String(value || "").match(/[mpsz][0-9]+/g) || []).flatMap((group) =>
    group
      .slice(1)
      .split("")
      .map((rank) => tile(group[0] + rank)),
  );
}
function hanLabel(value) {
  const text = String(value ?? ""),
    count = (text.match(/\*+/)?.[0] || "").length;
  return count
    ? (count > 1 ? count + "倍" : "") + "役满"
    : /役満|役满/.test(text)
      ? text.replace("役満", "役满")
      : text + "番";
}
function winning(settlement) {
  const [closed = "", ...sets] = (settlement.hand || "").split(",");
  const hand = closedTiles(closed),
    exposed = sets.filter(Boolean).map(meld);
  const t = settlement.winningTile,
    expected = 14 - exposed.length * 3;
  if (/^(?:[mps][0-9]|z[1-7])$/.test(t || "")) {
    if (hand.length === expected - 1)
      return { hand, exposed, winningTile: tile(t) };
    const index = hand.map((v) => v.key).lastIndexOf(t);
    if (hand.length === expected && index >= 0) {
      hand.splice(index, 1);
      return { hand, exposed, winningTile: tile(t) };
    }
  }
  return { hand, exposed, winningTile: null };
}
const {
  confirmationAt,
  detailValueAt,
  drawSummaryAt,
  drawRevealAt,
  abortBaseAt,
  displayedScores,
  AUTO_CONFIRM_MS,
} = require("./online-timing");
function presentation(
  game,
  seats,
  rawAge = game?.settlementFlow?.elapsedMs || 0,
  baselineAge = 0,
) {
  const s = game?.settlement;
  if (!s || game.ranking) return null;
  const flow = game.settlementFlow,
    stage = flow?.stage || "legacy";
  const title =
    stage === "scores"
      ? "点数结算"
      : s.kind === "win"
        ? s.winMethod === "tsumo"
          ? "自摸"
          : "荣和"
        : s.drawInfo?.kind === "nagashi"
          ? "流满贯"
          : s.name;
  const yakuman = (s.yaku || []).reduce(
    (count, y) => count + (String(y.han).match(/\*+/)?.[0].length || 0),
    0,
  );
  const mainYakuman = String(s.han ?? "").match(/\*+/)?.[0].length || 0;
  const totalYakuman = Math.max(yakuman, mainYakuman);
  const intro =
    flow?.stage === "detail" &&
    flow.detailIndex === 0 &&
    s.kind === "win" &&
    flow.winDeclarations?.length
      ? 1200
      : 0;
  const age = Math.max(0, rawAge - intro);
  const readyAt = flow ? confirmationAt(flow, s) : 0;
  const scores = flow ? displayedScores(flow, age, false) : [];
  const tableReveals = {};
  if (s.drawInfo && (stage !== "draw" || age >= drawRevealAt(s))) {
    for (const revealed of s.drawInfo.revealedHands || []) {
      if (!seats.some((p) => p.seat === revealed.seat)) continue;
      tableReveals[revealed.seat] = {
        key: `${flow?.id || game.decisionId}:${revealed.seat}`,
        hand: closedTiles(revealed.hand.split(",")[0]),
        animate:
          stage === "draw" &&
          baselineAge < drawRevealAt(s) &&
          age < drawRevealAt(s) + 300,
      };
    }
  }
  const drawDeclarations = [];
  const metadata = s.drawInfo?.abortPresentation;
  if (stage === "draw" && s.drawInfo?.kind === "abort" && metadata) {
    const candidates = [];
    if (metadata.riichiSeat !== undefined)
      candidates.push({
        seat: metadata.riichiSeat,
        text: "立直",
        start: 300,
        end: 1000,
      });
    if (s.name === "三家和")
      for (const seat of metadata.ronSeats || [])
        candidates.push({
          seat,
          text: "荣和",
          start: abortBaseAt(s) + 300,
          end: abortBaseAt(s) + 1200,
        });
    for (const c of candidates) {
      const player = seats.find((p) => p.seat === c.seat);
      if (player && age >= c.start && age < c.end)
        drawDeclarations.push({ ...c, name: player.name, edge: player.edge });
    }
  }
  const declarations = [...drawDeclarations];
  if (intro && rawAge < intro)
    for (const win of flow.winDeclarations || []) {
      const player = seats.find((p) => p.seat === win.seat);
      if (player && ["ron", "tsumo"].includes(win.winMethod))
        declarations.push({
          seat: win.seat,
          name: player.name,
          edge: player.edge,
          text: win.winMethod === "ron" ? "荣和" : "自摸",
        });
    }
  return {
    ...s,
    ...winning(s),
    stage,
    title,
    tableReveals,
    drawDeclarations,
    declarations,
    visible: rawAge >= intro && (stage !== "draw" || age >= drawSummaryAt(s)),
    ready: age >= readyAt,
    countdown: Math.max(0, Math.ceil((readyAt + AUTO_CONFIRM_MS - age) / 1000)),
    autoAt: readyAt + AUTO_CONFIRM_MS + intro,
    intro,
    pointsVisible: stage !== "detail" || age >= detailValueAt(s),
    phaseKey: flow
      ? `${flow.id}:${stage}:${flow.detailIndex}`
      : game.decisionId,
    winner: seats.find((p) => p.seat === s.winnerSeat)?.name || "",
    hanLabel: totalYakuman
      ? hanLabel("*".repeat(totalYakuman))
      : hanLabel(s.han),
    progress:
      stage === "detail" && flow.detailCount > 1
        ? `第${flow.detailIndex + 1}位 · 共${flow.detailCount}位`
        : "",
    yaku: (s.yaku || []).map((y, i) => ({
      ...y,
      label: hanLabel(y.han),
      visible: stage !== "detail" || age >= 300 + Math.min(i, 14) * 180,
    })),
    dora: (game.doraIndicators || []).map(tile),
    ura: (s.uraIndicators || []).map(tile),
    changes: seats.map((p) => ({
      seat: p.seat,
      name: p.name,
      before: flow?.oldScores[p.seat] ?? p.score,
      value: flow?.delta[p.seat] ?? s.delta[p.seat] ?? 0,
      after: scores[p.seat] ?? p.score + (s.delta[p.seat] || 0),
    })),
    drawPlayers: seats.map((p) => {
      const reveal = s.drawInfo?.revealedHands.find((v) => v.seat === p.seat);
      const [closed = "", ...sets] = (reveal?.hand || "").split(",");
      return {
        seat: p.seat,
        name: p.name,
        tenpai: (s.tenpaiSeats || []).includes(p.seat),
        hand: closedTiles(closed),
        exposed: sets.filter(Boolean).map(meld),
        waits: (reveal?.waits || []).map(tile),
      };
    }),
  };
}
module.exports = { hanLabel, winning, presentation };
