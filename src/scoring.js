export class ValidationError extends Error {
  status = 400;
}
export const FU = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
export function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new ValidationError(`${label}无效`);
  return value;
}
export function points({
  fu = 30,
  han = 1,
  yakuman = 0,
  dealer = false,
  method = "ron",
  players = 4,
  honba = 0,
  kiriage = false,
  kazoe = true,
}) {
  integer(players, 3, 4, "人数");
  integer(honba, 0, 100, "本场");
  integer(yakuman, 0, 6, "役满倍数");
  if (!["ron", "tsumo"].includes(method))
    throw new ValidationError("和牌方式无效");
  let base,
    label = "";
  if (yakuman) {
    base = 8000 * yakuman;
    label = yakuman === 1 ? "役满" : `${yakuman}倍役满`;
  } else {
    integer(han, 1, 100, "翻数");
    if (!FU.includes(fu)) throw new ValidationError("符数无效");
    if (
      (fu === 20 && (method === "ron" || han < 2)) ||
      (fu === 25 && (han < 2 || (method === "tsumo" && han < 3))) ||
      (fu === 110 && method === "tsumo" && han < 2)
    )
      throw new ValidationError("这个符翻组合不能用于此和牌方式");
    base =
      han >= 13 && kazoe
        ? 8000
        : han >= 11
          ? 6000
          : han >= 8
            ? 4000
            : han >= 6
              ? 3000
              : Math.min(2000, fu * 2 ** (han + 2));
    if (kiriage && ((han === 4 && fu === 30) || (han === 3 && fu === 60)))
      base = 2000;
    label =
      base === 8000
        ? "累计役满"
        : base === 6000
          ? "三倍满"
          : base === 4000
            ? "倍满"
            : base === 3000
              ? "跳满"
              : base === 2000
                ? "满贯"
                : "";
  }
  const ceil = (n) => Math.ceil(n / 100) * 100;
  const ron =
    ceil(base * (dealer ? 6 : 4)) + honba * (players === 3 ? 200 : 300);
  const child = ceil(base * (dealer ? 2 : 1)) + honba * 100,
    parent = ceil(base * 2) + honba * 100;
  return {
    base,
    label,
    ron,
    child,
    parent,
    total:
      method === "ron"
        ? ron
        : dealer
          ? child * (players - 1)
          : parent + child * (players - 2),
  };
}
export function defaults(players = 4) {
  integer(players, 3, 4, "人数");
  return {
    players,
    start: players === 4 ? 25000 : 35000,
    kiriage: false,
    kazoe: true,
  };
}
const seats = (value, n, label) => {
  if (!Array.isArray(value) || new Set(value).size !== value.length)
    throw new ValidationError(`${label}无效`);
  value.forEach((s) => integer(s, 0, n - 1, label));
  return value;
};
export function settle(state, event) {
  const next = structuredClone(state),
    n = state.rules.players,
    delta = Array(n).fill(0),
    paid = seats(event.riichi ?? [], n, "立直座位");
  paid.forEach((s) => {
    if (state.scores[s] < 1000)
      throw new ValidationError("点数不足1000，不能立直");
    delta[s] -= 1000;
  });
  let pot = state.pot + paid.length,
    keep = false,
    description = "";
  const transfer = (from, to, value) => {
    delta[from] -= value;
    delta[to] += value;
  };
  if (event.kind === "win") {
    if (
      !["ron", "tsumo"].includes(event.method) ||
      !Array.isArray(event.winners) ||
      event.winners.length < 1 ||
      event.winners.length >= n
    )
      throw new ValidationError("和牌输入无效");
    const wins = seats(
      event.winners.map((w) => w.seat),
      n,
      "和牌座位",
    );
    if (n === 4 && wins.length === 3)
      throw new ValidationError("三家荣和请按途中流局记录");
    if (event.method === "tsumo" && wins.length !== 1)
      throw new ValidationError("自摸只能有一位赢家");
    if (event.method === "ron") {
      integer(event.loser, 0, n - 1, "放铳座位");
      if (wins.includes(event.loser))
        throw new ValidationError("赢家不能同时放铳");
    }
    const recipient =
      event.method === "ron"
        ? [...wins].sort(
            (a, b) => ((a - event.loser + n) % n) - ((b - event.loser + n) % n),
          )[0]
        : wins[0];
    for (const w of event.winners) {
      const p = points({
        ...w,
        method: event.method,
        players: n,
        dealer: w.seat === state.dealer,
        honba: state.honba,
        kiriage: state.rules.kiriage,
        kazoe: state.rules.kazoe,
      });
      if (event.method === "ron") transfer(event.loser, w.seat, p.ron);
      else
        for (let s = 0; s < n; s++)
          if (s !== w.seat)
            transfer(s, w.seat, s === state.dealer ? p.parent : p.child);
    }
    delta[recipient] += pot * 1000;
    pot = 0;
    keep = wins.includes(state.dealer);
    description = event.method === "ron" ? "荣和" : "自摸";
    next.honba = keep ? state.honba + 1 : 0;
  } else if (event.kind === "draw") {
    const tenpai = seats(event.tenpai ?? [], n, "听牌座位");
    keep = tenpai.includes(state.dealer);
    if (tenpai.length && tenpai.length < n)
      for (let s = 0; s < n; s++)
        delta[s] += tenpai.includes(s)
          ? 3000 / tenpai.length
          : -3000 / (n - tenpai.length);
    next.honba++;
    description = "荒牌流局";
  } else if (event.kind === "abort") {
    keep = true;
    next.honba++;
    description = "途中流局";
  } else throw new ValidationError("结算类型无效");
  if (!keep) {
    next.dealer = (state.dealer + 1) % n;
    next.hand++;
  }
  next.scores = state.scores.map((s, i) => s + delta[i]);
  next.pot = pot;
  if (
    next.scores.reduce((a, b) => a + b, 0) + pot * 1000 !==
    n * state.rules.start
  )
    throw new ValidationError("点数不守恒");
  return { next, delta, description };
}
