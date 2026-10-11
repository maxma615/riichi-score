import Majiang from "@kobalab/majiang-core";

// Published DefaultDetailGameRule3 continuance-counter points (configuration
// evidence; vendor server packet parity has not been observed).
export const SANMA_HONBA_POINTS = 200;

export const sanmaRule = Majiang.rule({
  "赤牌": {
    m: 0,
    p: 1,
    s: 1
  },
  "延長戦方式": 0
});

export function sanmaBase(fu: number, han: number, yakuman = 0) {
  return yakuman ? 8000 * yakuman
    : han >= 13 ? 8000
    : han >= 11 ? 6000
    : han >= 8 ? 4000
    : han >= 6 ? 3000
    : Math.min(2000, fu * 2 ** (han + 2));
}

type Payment = {
  base: number;
  winner: number;
  dealer: number;
  loser?: number;
  honba?: number;
  sticks?: number;
  pao?: {
    seat: number;
    base: number
  }[]
};

export function sanmaPayment({
  base,
  winner,
  dealer,
  loser,
  honba = 0,
  sticks = 0,
  pao = []
}: Payment): number[] {
  const delta = [0, 0, 0],
    factor = winner === dealer ? 6 : 4;
  const pay = (seat: number, amount: number) => {
    delta[seat] -= amount;
    delta[winner] += amount;
  };
  for (const liability of pao) {
    const portion = liability.base;
    if (loser === undefined) {
      pay(liability.seat, portion * factor);
      base -= portion;
    } else {
      pay(liability.seat, portion * factor / 2);
      base -= portion / 2;
    }
  }
  if (loser !== undefined)
    pay(loser, Math.ceil(base * factor / 100) * 100 + honba * SANMA_HONBA_POINTS);
  else if (base === 0 && pao.length)
    pay(pao[0].seat, honba * 200);
  else
    for (let s = 0; s < 3; s++)
      if (s !== winner)
        pay(s, Math.ceil(base * (winner === dealer || s === dealer ? 2 : 1) / 100) * 100 + honba * 100);
  delta[winner] += sticks * 1000;
  return delta;
}

export function tenpaiPayment(seats: number[]): number[] {
  if (seats.length === 0 || seats.length === 3) return [0, 0, 0];
  return [0, 1, 2].map(s => seats.includes(s) ? 3000 / seats.length : -3000 / (3 - seats.length));
}

export type SanmaScoreOptions = Parameters<typeof Majiang.Util.hule_param>[0] & {
  nuki?: number
};

export function scoreSanma(
  hand: InstanceType<typeof Majiang.Shoupai>,
  ron: string | null,
  options: SanmaScoreOptions
) {
  // Feed a synthetic predecessor only into the scorer, never into the wall or
  // hand. The pinned four-suit tool then counts 9m for our 1m indicator.
  const correct = (tiles: string[] | undefined) => tiles?.map(p => p === "m1" ? "m8" : p);
  const result = Majiang.Util.hule(hand, ron, Majiang.Util.hule_param({
    ...options,
    rule: sanmaRule,
    baopai: correct(options.baopai),
    fubaopai: correct(options.fubaopai)
  }));
  if (!result?.hupai?.length) return null; // Bonus tiles never establish a yaku.
  const bonus = (options.nuki ?? 0) *
    (1 + [...(options.baopai ?? []), ...(options.fubaopai ?? [])].filter(p => p === "z3").length);
  const yaku = result.hupai.map(y => ({
    ...y
  }));
  if (bonus && !result.damanguan) yaku.push({
    name: "抜きドラ",
    fanshu: bonus
  });
  const han = result.damanguan ? undefined : (result.fanshu ?? 0) + bonus;
  return {
    yaku,
    fu: result.fu,
    han,
    base: sanmaBase(result.fu ?? 0, han ?? 0, result.damanguan),
    yakuman: result.damanguan ?? 0
  };
}
