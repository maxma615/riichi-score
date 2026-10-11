import { FU, points } from "./scoring.js";
const number = (n) => n.toLocaleString("en-US");
export function lookup(quick) {
  const payment = (p) =>
    quick.method === "ron"
      ? { main: number(p.ron), sub: "" }
      : quick.dealer
        ? { main: number(p.child), sub: "每家" }
        : { main: number(p.child), sub: number(p.parent) };
  const cell = (fu, han, yakuman = 0) => {
    const selected = yakuman
      ? quick.yakuman === yakuman
      : !quick.yakuman && quick.fu === fu && quick.han === han;
    try {
      const p = points({ ...quick, fu, han, yakuman });
      return {
        fu,
        han,
        yakuman,
        selected,
        valid: true,
        ...payment(p),
        label: p.label,
      };
    } catch {
      return {
        fu,
        han,
        yakuman,
        selected: false,
        valid: false,
        main: "—",
        sub: "",
        label: "",
      };
    }
  };
  let result = null,
    error = "";
  try {
    const p = points(quick);
    result = {
      ...p,
      totalText: number(p.total),
      selection: quick.yakuman
        ? p.label
        : quick.han >= 5
          ? `${quick.han}番 · ${p.label}`
          : `${quick.han}番${quick.fu}符${p.label ? " · " + p.label : ""}`,
      payment:
        quick.method === "ron"
          ? `放铳者支付 ${number(p.ron)} 点`
          : quick.dealer
            ? `每家支付 ${number(p.child)} 点`
            : `闲家各付 ${number(p.child)} 点 · 庄家付 ${number(p.parent)} 点`,
    };
  } catch (e) {
    error = e.message;
  }
  return {
    result,
    error,
    columns: [1, 2, 3, 4].map((han) => ({
      han,
      selected: !quick.yakuman && quick.han === han,
    })),
    rows: FU.map((fu) => ({
      fu,
      selected: !quick.yakuman && quick.han <= 4 && quick.fu === fu,
      cells: [1, 2, 3, 4].map((han) => cell(fu, han)),
    })),
    limits: [
      [5, "5番", "满贯"],
      [6, "6–7番", "跳满"],
      [8, "8–10番", "倍满"],
      [11, "11–12番", "三倍满"],
      [13, "13番及以上", "累计役满"],
    ].map(([han, title, label]) => ({
      ...cell(30, han),
      title,
      label,
      selected:
        !quick.yakuman &&
        quick.han >= han &&
        quick.han <
          (han === 5
            ? 6
            : han === 6
              ? 8
              : han === 8
                ? 11
                : han === 11
                  ? 13
                  : 101),
    })),
    yakumans: [1, 2, 3, 4, 5, 6].map((n) => ({
      ...cell(30, 13, n),
      title: n === 1 ? "役满" : `${n}倍役满`,
    })),
    legend:
      quick.method === "ron"
        ? "荣和 · 放铳者支付"
        : quick.dealer
          ? "自摸 · 每家支付"
          : "自摸 · 上行闲家 / 下行庄家",
  };
}
