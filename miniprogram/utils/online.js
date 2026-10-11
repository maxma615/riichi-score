const { parseMeld } = require("./online-motion");
const {
  handRack,
  openingTileCount,
  ROUND_OPENING,
} = require("./online-opening");
const winds = ["东", "南", "西", "北"],
  names = {
    z1: "东风",
    z2: "南风",
    z3: "西风",
    z4: "北风",
    z5: "白板",
    z6: "发财",
    z7: "红中",
  },
  honors = {
    z1: "Ton",
    z2: "Nan",
    z3: "Shaa",
    z4: "Pei",
    z5: "Haku",
    z6: "Hatsu",
    z7: "Chun",
  },
  suits = { m: "Man", p: "Pin", s: "Sou" };
const labels = {
  discard: "切牌",
  riichi: "立直",
  chi: "吃",
  pon: "碰",
  kan: "杠",
  tsumo: "自摸",
  ron: "荣和",
  abort: "九种九牌",
  pass: "过",
  ack: "继续",
  nuki: "拔北",
};
function callArt(label) {
  const name = {
    立直: "Riichi",
    自摸: "Tsumo",
    荣和: "Ron",
    吃: "Chi",
    碰: "Pon",
    杠: "Kan",
    拔北: "Nuki",
  }[label];
  return name ? "/assets/calligraphy/" + name + ".png" : "";
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
function tile(value) {
  const key = String(value || "").slice(0, 2),
    n = Number(key[1]),
    file =
      honors[key] ||
      (suits[key[0]] ? suits[key[0]] + (n === 0 ? "5-Dora" : n) : "Blank");
  return {
    value,
    key,
    name:
      names[key] ||
      (n === 0 ? "赤五" : n) + ({ m: "万", p: "筒", s: "索" }[key[0]] || "牌"),
    src: "/assets/tiles/" + file + ".png",
  };
}
function meld(value) {
  const parsed = parseMeld(String(value || ""));
  if (!parsed) return [];
  const out = [],
    added = [];
  parsed.slots.forEach((slot, index) => {
    if (slot.type === "stack") {
      out.push({
        ...tile(slot.called),
        called: true,
        back: false,
        added: false,
      });
      added.push({
        ...tile(slot.added),
        called: false,
        back: false,
        added: true,
        stackStyle: `left:${index * 18}px;`,
      });
    } else
      out.push({
        ...tile(slot.value),
        back: slot.type === "back",
        called: slot.type === "tile" && Boolean(slot.called),
        added: false,
      });
  });
  return [...out, ...added];
}
// Claimed tiles remain in engine history for furiten, but leave the visible river.
function river(values) {
  let declaration = false;
  const visible = [];
  for (const [rawIndex, value] of (values || []).entries()) {
    if (value.includes("*")) declaration = true;
    if (/[+\-=]$/.test(value)) continue;
    visible.push({ ...tile(value), rawIndex, sideways: declaration });
    declaration = false;
  }
  return visible;
}
// Only compare public events within the same hand; a reconnect is not a new call.
function feedback(before, after) {
  if (
    !before ||
    !after ||
    before.handId !== after.handId ||
    before.gameInstanceId !== after.gameInstanceId
  )
    return null;
  const declarations = after.settlementFlow?.winDeclarations || [];
  const oldDeclarations = before.settlementFlow?.winDeclarations || [];
  const win = declarations.find(
    (d) =>
      !oldDeclarations.some(
        (old) => old.seat === d.seat && old.winMethod === d.winMethod,
      ),
  );
  if (win)
    return {
      seat: win.seat,
      text: win.winMethod === "tsumo" ? "自摸" : "荣和",
    };
  for (const p of after.players || []) {
    const old = before.players.find((v) => v.seat === p.seat);
    if (!old) continue;
    if ((p.nuki || 0) > (old.nuki || 0)) return { seat: p.seat, text: "拔北" };
    if (p.riichi && !old.riichi) return { seat: p.seat, text: "立直" };
    const changed = p.melds.find((m, i) => m !== old.melds[i]);
    if (changed) {
      const tiles = meld(changed);
      return {
        seat: p.seat,
        text:
          tiles.length === 4
            ? "杠"
            : tiles.every(
                  (t) =>
                    t.key.replace("0", "5") === tiles[0].key.replace("0", "5"),
                )
              ? "碰"
              : "吃",
      };
    }
  }
  return null;
}
function snapshot(
  response,
  riichiMode = false,
  openingAge = null,
  liveOpening = false,
) {
  const room = response.room;
  if (!room)
    return {
      room: null,
      game: null,
      seats: [],
      hand: [],
      actions: [],
      riichiMode: false,
      canRiichi: false,
      openingHolding: false,
      doraVisible: true,
      host: false,
      ready: false,
      serviceRunning: response.serviceRunning,
    };
  const game = room.game,
    capacity = room.variant === "sanma" ? 3 : 4;
  const seats = Array.from({ length: capacity }, (_, seat) => {
    const member = room.members.find((m) => m.seat === seat),
      p = game?.players.find((p) => p.seat === seat),
      visibleRiver = river(p?.discards).map((t) => ({
        ...t,
        nodeId: `river-${seat}-${t.rawIndex}`,
      }));
    return {
      seat,
      name: member?.displayName || "空位",
      kind: member?.kind,
      connected: member?.connected,
      ready: member?.ready,
      self: seat === room.mySeat,
      wind: winds[p?.wind ?? seat],
      score: p?.score,
      riichi: p?.riichi,
      nuki: p?.nuki || 0,
      hasKan: (p?.melds || []).some((value) => meld(value).length === 4),
      hidden: Array.from({ length: p?.handCount || 0 }, (_, i) => i),
      visibleCount: openingTileCount(openingAge, p?.handCount || 0),
      river: visibleRiver,
      riverRows: Array.from(
        { length: Math.ceil(visibleRiver.length / 6) },
        (_, row) => visibleRiver.slice(row * 6, row * 6 + 6),
      ),
      melds: (p?.melds || []).map((value, group) =>
        meld(value).map((t, index) => ({
          ...t,
          nodeId: `meld-${seat}-${group}-${index}`,
        })),
      ),
      position: (seat - room.mySeat + capacity) % capacity,
      edge: ["bottom", "right", ...(capacity === 4 ? ["top"] : []), "left"][
        (seat - room.mySeat + capacity) % capacity
      ],
      north: Array.from({ length: p?.nuki || 0 }, (_, i) => ({
        ...tile("z4"),
        nodeId: `north-${seat}-${i}`,
      })),
      active: game?.turnSeat === seat,
    };
  });
  const choices = game?.choices || [],
    raw = game?.hand || [],
    closed =
      game?.drawnTile && raw[raw.length - 1] === game.drawnTile
        ? raw.slice(0, -1)
        : raw;
  const canRiichi = choices.some((c) => c.type === "riichi");
  riichiMode = riichiMode && canRiichi;
  const choiceType = riichiMode ? "riichi" : "discard";
  const hand = (
    game
      ? handRack({ ...game, hand: game.hand || [] }, openingAge, liveOpening)
      : []
  ).map((entry, i) => {
    const v = entry.value,
      t = tile(v),
      drawn = entry.logicalDraw;
    const choice =
      choices.find(
        (c) => c.type === choiceType && c.value === (drawn ? v + "_" : v),
      ) ||
      (drawn && !closed.includes(v)
        ? choices.find((c) => c.type === choiceType && c.value === v)
        : null);
    return {
      ...t,
      id: i,
      physicalKey: entry.key,
      choiceId: choice?.id || "",
      choiceType: choice?.type || "",
      decisionId: game.decisionId,
      drawn: entry.separated,
      dealVisible: i < openingTileCount(openingAge, (game?.hand || []).length),
    };
  });
  return {
    room,
    game,
    seats,
    hand,
    riichiMode,
    canRiichi,
    openingHolding:
      openingAge !== null && openingAge < ROUND_OPENING.operationsMs,
    doraVisible:
      openingAge === null || openingAge >= ROUND_OPENING.doraAndSortMs,
    actions: choices
      .filter((c) => c.type !== "discard" && c.type !== "riichi")
      .map((c) => ({ ...c, label: labels[c.type], tiles: meld(c.value) })),
    host:
      room.hostUserId ===
      room.members.find((m) => m.seat === room.mySeat)?.userId,
    ready: !!room.members.find((m) => m.seat === room.mySeat)?.ready,
    allReady:
      room.members.length === capacity && room.members.every((m) => m.ready),
    serviceRunning: response.serviceRunning,
    dora: (game?.doraIndicators || []).map(tile),
    round: game ? `${winds[game.roundWind]}${game.roundNumber}局` : "",
    settlement: game?.settlement
      ? {
          ...game.settlement,
          changes: game.settlement.delta.map((value, seat) => ({
            seat,
            name: seats[seat].name,
            value,
          })),
        }
      : null,
  };
}
module.exports = { uuid, tile, meld, river, snapshot, feedback, callArt };
