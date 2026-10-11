export function monthlyStats(rooms, userId, month, profile = () => null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("月份无效");
  const result = {
      month,
      hands: 0,
      wins: 0,
      tsumo: 0,
      ron: 0,
      dealin: 0,
      hit: 0,
      net: 0,
      peers: [],
      maxGain: 0,
      maxLoss: 0,
    },
    peers = new Map();
  const ym = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  });
  for (const room of rooms) {
    const seat = room.members.findIndex((m) => m?.id === userId);
    if (seat < 0) continue;
    for (const h of room.history) {
      if (h.kind === "finish" || ym.format(new Date(h.createdAt)) !== month)
        continue;
      result.hands++;
      result.net += h.delta[seat];
      result.maxGain = Math.max(result.maxGain, h.delta[seat]);
      result.maxLoss = Math.min(result.maxLoss, h.delta[seat]);
      const event = h.event;
      if (event?.kind === "win") {
        const winner = event.winners.some((w) => w.seat === seat);
        if (winner) {
          result.wins++;
          result[event.method]++;
        }
        if (event.method === "ron" && event.loser === seat) {
          result.dealin++;
          result.hit += event.winners.length;
        }
        if (event.method === "tsumo" && !winner) result.hit++;
      }
      for (const [s, m] of room.members.entries()) {
        if (!m || s === seat) continue;
        let peer = peers.get(m.id);
        if (!peer) {
          const p = profile(m.id);
          peer = {
            id: m.id,
            name: p?.name ?? m.name,
            avatar: p?.avatar ?? "",
            hands: 0,
            net: 0,
          };
          peers.set(m.id, peer);
        }
        peer.hands++;
        peer.net += h.delta[seat];
      }
    }
  }
  result.peers = [...peers.values()].sort(
    (a, b) => b.net - a.net || a.name.localeCompare(b.name),
  );
  result.winRate = result.hands
    ? Math.round((result.wins * 1000) / result.hands) / 10
    : 0;
  result.dealinRate = result.hands
    ? Math.round((result.dealin * 1000) / result.hands) / 10
    : 0;
  result.summary = result.hands
    ? `本月打了${result.hands}局，和牌率${result.winRate}%，放铳率${result.dealinRate}%。单局最高收入${result.maxGain.toLocaleString()}点，最高支出${(-result.maxLoss).toLocaleString()}点。`
    : "本月还未开桌，记下第一局吧。";
  result.best = result.peers.filter((p) => p.net > 0)[0] ?? null;
  result.worst = [...result.peers].reverse().find((p) => p.net < 0) ?? null;
  return result;
}
