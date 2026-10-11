export function calculateFu({
  closed = true,
  method = "ron",
  special = "normal",
  pair = 0,
  wait = 0,
  melds = [],
} = {}) {
  if (
    !["ron", "tsumo"].includes(method) ||
    !["normal", "chiitoitsu", "pinfu"].includes(special) ||
    typeof closed !== "boolean" ||
    ![0, 2, 4].includes(pair) ||
    ![0, 2].includes(wait) ||
    !Array.isArray(melds) ||
    melds.length > 4
  )
    throw Error("算符选择无效");
  if (!closed && ["chiitoitsu", "pinfu"].includes(special))
    throw Error("此牌型需要门前清");
  if (closed && melds.some((m) => ["openTriplet", "openKan"].includes(m.type)))
    throw Error("门前清不包含明刻或明杠");
  if (special === "chiitoitsu")
    return { fu: 25, raw: 25, items: [{ label: "七对子", value: 25 }] };
  if (special === "pinfu") {
    if (!closed) throw Error("平和需要门前清");
    return method === "tsumo"
      ? { fu: 20, raw: 20, items: [{ label: "平和自摸", value: 20 }] }
      : {
          fu: 30,
          raw: 30,
          items: [
            { label: "基本符", value: 20 },
            { label: "门前清荣和", value: 10 },
          ],
        };
  }
  const items = [{ label: "基本符", value: 20 }];
  if (closed && method === "ron")
    items.push({ label: "门前清荣和", value: 10 });
  if (method === "tsumo") items.push({ label: "自摸", value: 2 });
  if (pair)
    items.push({ label: pair === 4 ? "连风雀头" : "役牌雀头", value: pair });
  if (wait) items.push({ label: "边张 / 嵌张 / 单骑听牌", value: 2 });
  const types = { openTriplet: 2, closedTriplet: 4, openKan: 8, closedKan: 16 };
  for (const m of melds) {
    if (!Object.hasOwn(types, m.type) || typeof m.terminal !== "boolean")
      throw Error("刻子／杠子选择无效");
    const value = types[m.type] * (m.terminal ? 2 : 1);
    items.push({
      label:
        {
          openTriplet: "明刻",
          closedTriplet: "暗刻",
          openKan: "明杠",
          closedKan: "暗杠",
        }[m.type] + (m.terminal ? " · 幺九牌／字牌" : " · 中张牌"),
      value,
    });
  }
  let raw = items.reduce((n, x) => n + x.value, 0),
    fu = Math.ceil(raw / 10) * 10;
  if (!closed && method === "ron" && fu === 20) {
    fu = 30;
    items.push({ label: "副露荣和最低30符", value: 10 });
    raw = 30;
  }
  return { fu, raw, items };
}
