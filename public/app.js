import { points, FU, settle } from "./scoring.js";
const base = document.querySelector("meta[name=app-base]").content;
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let quick = {
    fu: 30,
    han: 1,
    method: "ron",
    dealer: false,
    players: 4,
    honba: 0,
    yakuman: 0,
  },
  room = null,
  user = null,
  busy = false,
  past = [];
const notice = (s) => {
  $("#notice").textContent = s;
};
async function api(url, body) {
  const r = await fetch(base + url, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    credentials: "same-origin",
  });
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.error ?? "请求失败");
    error.status = r.status;
    throw error;
  }
  return data;
}
async function task(fn) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll("[data-submit]")
    .forEach((b) => (b.disabled = true));
  try {
    notice("");
    await fn();
  } catch (e) {
    notice(e.message);
    const error = $("#modal-error");
    if (error) {
      error.textContent = e.message;
      if (e.status === 409) {
        $("#modal").dataset.stale = "true";
        const button = document.createElement("button");
        button.textContent = "关闭并刷新牌桌";
        button.onclick = () =>
          task(async () => {
            $("#modal").close();
            if (room) remember(await api("/api/rooms/" + room.id));
          });
        error.append(document.createElement("br"), button);
      }
    }
  } finally {
    busy = false;
    document
      .querySelectorAll("[data-submit]")
      .forEach(
        (b) => (b.disabled = b.closest("dialog")?.dataset.stale === "true"),
      );
  }
}
function tab(name) {
  $("#quick").hidden = name !== "quick";
  $("#room").hidden = name !== "room";
  $("#quick-tab").classList.toggle("active", name === "quick");
  $("#room-tab").classList.toggle("active", name === "room");
  $(".hero").hidden = name === "room";
}
$("#quick-tab").onclick = () => tab("quick");
$("#room-tab").onclick = () => {
  tab("room");
  renderRoom();
};
function chips(key, items) {
  return `<div class="choice-row">${items.map(([value, label]) => `<button data-key="${key}" data-value="${value}" class="${quick[key] === value ? "selected" : ""}" aria-pressed="${quick[key] === value}">${label}</button>`).join("")}</div>`;
}
function result(p, options) {
  return `${p.label ? `<p>${p.label}</p>` : ""}<strong>${p.total.toLocaleString()}<small> 点</small></strong><p>${options.method === "ron" ? `放铳者支付 ${p.ron.toLocaleString()} 点` : options.dealer ? `每家支付 ${p.child.toLocaleString()} 点` : `庄家 ${p.parent.toLocaleString()} 点 · 闲家 ${p.child.toLocaleString()} 点`}</p>`;
}
function limitTable() {
  const rows = [
    [5, "5番", "满贯"],
    [6, "6–7番", "跳满"],
    [8, "8–10番", "倍满"],
    [11, "11–12番", "三倍满"],
    [13, "13番及以上", "累计役满"],
  ];
  const payment = (x) =>
    quick.method === "ron"
      ? x.ron.toLocaleString()
      : quick.dealer
        ? `${x.child.toLocaleString()} ALL`
        : `${x.child.toLocaleString()} / ${x.parent.toLocaleString()}`;
  return `<div class="card"><h2>5番及以上 · 满贯与役满</h2><p class="muted">达到满贯后，点数按番数档位计算，不再随符数变化。${quick.players === 3 ? "三麻自摸损；显示每家支付额。" : ""}</p><div class="scroll"><table><thead><tr><th>番数 / 役</th><th>名称</th><th>${quick.dealer ? "庄家" : "闲家"}支付点数</th></tr></thead><tbody>${rows.map(([han, title, label]) => `<tr><th>${title}</th><td>${label}</td><td>${payment(points({ ...quick, fu: 30, han, yakuman: 0 }))}</td></tr>`).join("")}${[1, 2, 3, 4, 5, 6].map((yakuman) => `<tr><th>${yakuman === 1 ? "役满" : `${yakuman}倍役满`}</th><td>役满役</td><td>${payment(points({ ...quick, yakuman }))}</td></tr>`).join("")}</tbody></table></div><p class="muted">自摸“闲家 / 庄家”；ALL 表示每家。含 ${quick.honba} 本场，不含供托；累计役满按本工具速查默认规则。</p></div>`;
}
function renderQuick() {
  let p, error;
  try {
    p = points(quick);
  } catch (e) {
    error = e.message;
  }
  $("#quick").innerHTML =
    `<div class="grid"><div class="card"><h2>符番速查</h2><div class="result">${p ? result(p, quick) : `<p>${esc(error)}</p>`}</div><span class="muted">座位与和牌方式</span>${chips(
      "players",
      [
        [4, "四人"],
        [3, "三人"],
      ],
    )}${chips("dealer", [
      [false, "闲家"],
      [true, "庄家"],
    ])}${chips("method", [
      ["ron", "荣和"],
      ["tsumo", "自摸"],
    ])}<span class="muted">番数</span>${chips(
      "han",
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => [n, `${n}番`]),
    )}<span class="muted">符数</span>${chips(
      "fu",
      FU.map((n) => [n, `${n}符`]),
    )}<div class="grid"><label>本场<input id="quick-honba" type="number" min="0" max="100" value="${quick.honba}"></label><label>役满<select id="quick-yakuman"><option value="0">普通符番</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${quick.yakuman === n ? "selected" : ""}>${n}倍役满</option>`).join("")}</select></label></div><p class="muted">结果含本场，不含立直供托。三麻采用自摸损；切上满贯关闭，累计役满开启。</p></div><div class="card"><h2>算符时看这里</h2><details open><summary>基本符与常见例外</summary><p>普通和牌以20符起算；门前荣和加10符，自摸加2符。最后向上取整到十符。平和自摸固定20符；七对子固定25符；副露平和形荣和至少30符。</p></details><details><summary>刻子与杠子</summary><p>明刻：中张2符、幺九字牌4符。暗刻：中张4符、幺九字牌8符。明杠：中张8符、幺九字牌16符。暗杠：中张16符、幺九字牌32符。荣和补成的刻子按明刻算符。</p></details><details><summary>雀头与等待</summary><p>三元牌、场风或自风雀头各加2符；连风雀头按约定确认2符或4符。嵌张、边张、单骑等待加2符，两面和双碰不加。输入已经确认的符番；本工具不自动判役，宝牌不能单独构成役。</p></details><p class="muted">规则可在开桌时固定。包牌、流局满贯与错和罚分暂不支持，请勿用普通和牌替代。</p></div></div><div class="card"><h2>${quick.dealer ? "庄家" : "闲家"} · ${quick.method === "ron" ? "荣和支付" : "自摸支付"}速查表</h2><div class="scroll"><table><thead><tr><th>符 / 番</th>${[1, 2, 3, 4].map((n) => `<th>${n}番</th>`).join("")}</tr></thead><tbody>${FU.map(
      (fu) =>
        `<tr><th>${fu}符</th>${[1, 2, 3, 4]
          .map((han) => {
            try {
              const x = points({ ...quick, fu, han, yakuman: 0 });
              return `<td>${quick.method === "ron" ? x.ron : quick.dealer ? `${x.child} ALL` : `${x.child} / ${x.parent}`}</td>`;
            } catch {
              return "<td>—</td>";
            }
          })
          .join("")}</tr>`,
    ).join(
      "",
    )}</tbody></table></div><p class="muted">自摸“闲家 / 庄家”；ALL 表示每家。当前本场：${quick.honba}。</p></div>${limitTable()}`;
  $("#quick")
    .querySelectorAll("[data-key]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const key = b.dataset.key,
            value = b.dataset.value;
          quick[key] = ["fu", "han", "players"].includes(key)
            ? Number(value)
            : key === "dealer"
              ? value === "true"
              : value;
          renderQuick();
        }),
    );
  $("#quick-honba").onchange = (e) => {
    quick.honba = Number(e.target.value);
    renderQuick();
  };
  $("#quick-yakuman").onchange = (e) => {
    quick.yakuman = Number(e.target.value);
    renderQuick();
  };
}
const roundLabel = (hand, n) =>
  `${["东", "南", "西", "北"][Math.floor(hand / n) % 4]}${(hand % n) + 1}局${hand >= n * 4 ? `（第${Math.floor(hand / (n * 4)) + 1}场）` : ""}`;
const seatName = (s) => room?.members[s]?.name ?? `座位 ${s + 1}`;
function selectSeats(id, chosen = 0) {
  return `<select id="${id}">${room.members.map((m, s) => `<option value="${s}" ${s === chosen ? "selected" : ""}>${esc(seatName(s))}${room.dealer === s ? "（庄）" : ""}</option>`).join("")}</select>`;
}
function modal(html) {
  delete $("#modal").dataset.stale;
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${html.title}</h2><button id="close-modal" aria-label="关闭">×</button></div>${html.body}<p id="modal-error" role="alert"></p>`;
  $("#close-modal").onclick = () => $("#modal").close();
  if (!$("#modal").open) $("#modal").showModal();
}
function remember(r) {
  room = r;
  localStorage.setItem("riichi-room", r.id);
  renderRoom();
}
function renderRoom() {
  if (!room) {
    const join = new URLSearchParams(location.search).get("join");
    $("#room").innerHTML =
      `<div class="card"><h2>${join ? "加入朋友的牌桌" : "开一张线下牌桌"}</h2><p class="muted">不需要注册，填写昵称即可。成员用自己的手机扫码加入，或者由桌主填写线下玩家。</p><form id="entry"><div class="grid"><label>你的昵称<input id="name" maxlength="24" required value="${esc(user?.name ?? "")}" ${user ? "readonly" : ""}></label>${join ? '<label>选择座位<select id="join-seat"><option value="1">初始南家</option><option value="2">初始西家</option><option value="3">初始北家（四人桌）</option></select></label>' : '<label>桌型<select id="players"><option value="4">四人日麻 · 25000 起点</option><option value="3">三人日麻 · 35000 起点</option></select></label>'}</div>${join ? "" : '<label class="check"><input id="kiriage" type="checkbox">切上满贯（4番30符 / 3番60符）</label><label class="check"><input id="kazoe" type="checkbox" checked>累计役满（13番起）</label>'}<div class="actions"><button class="primary" data-submit>${join ? "加入牌桌" : "创建牌桌"}</button></div></form></div>`;
    $("#entry").onsubmit = (e) => {
      e.preventDefault();
      task(async () => {
        if (!user) {
          const data = await api("/api/session", { name: $("#name").value });
          user = data.user;
        }
        remember(
          join
            ? await api("/api/join", {
                code: join,
                seat: Number($("#join-seat").value),
              })
            : await api("/api/rooms", {
                players: Number($("#players").value),
                kiriage: $("#kiriage").checked,
                kazoe: $("#kazoe").checked,
              }),
        );
        history.replaceState(null, "", base + "/");
      });
    };
    if (past.length) {
      const list = document.createElement("div");
      list.className = "card";
      list.innerHTML =
        "<h2>最近的牌桌</h2>" +
        past
          .map(
            (r) =>
              `<button data-open="${r.id}">${esc(r.names.join(" / "))} · ${r.finished ? "已结束" : roundLabel(r.hand, r.players)}</button>`,
          )
          .join(" ");
      $("#room").append(list);
      list
        .querySelectorAll("[data-open]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              task(async () =>
                remember(await api("/api/rooms/" + b.dataset.open)),
              )),
        );
    }
    return;
  }
  const n = room.rules.players;
  $("#room").innerHTML =
    `<div class="card"><div class="row"><div><p class="eyebrow">${n === 4 ? "四人日麻" : "三人日麻 · 自摸损"}</p><h2>${room.finished ? "牌局已结束" : roundLabel(room.hand, n)} <span class="muted">${room.honba} 本场</span></h2></div><button id="share">扫码入桌</button></div><p class="muted">供托 ${room.pot} 根 · ${room.rules.kiriage ? "切上满贯" : "不切上满贯"} · ${room.rules.kazoe ? "累计役满" : "13番起三倍满"}${room.isOwner ? " · 你是桌主" : " · 由桌主记分"}</p><div class="score-grid">${room.scores.map((score, s) => `<div class="seat ${room.dealer === s ? "dealer" : ""}"><p>${esc(seatName(s))}${room.dealer === s ? '<span class="badge">庄</span>' : ""}${s === room.mySeat ? " · 你" : ""}</p><strong>${score.toLocaleString()}</strong><span class="${score >= room.rules.start ? "positive" : "negative"}">${score - room.rules.start >= 0 ? "+" : ""}${(score - room.rules.start).toLocaleString()}</span>${!room.members[s] && room.isOwner ? `<button data-add="${s}">填写玩家</button>` : ""}</div>`).join("")}</div>${room.isOwner ? `<div class="actions">${room.finished ? "" : '<button id="record" class="primary">记一局</button>'}${room.history.length ? '<button id="undo">撤回最近记录</button>' : ""}${room.finished ? "" : '<button id="finish">结束牌局</button>'}</div>` : ""}</div><div class="card"><h2>每圈收支</h2><div class="scroll"><table><thead><tr><th>圈</th>${room.members.map((m, s) => `<th>${esc(seatName(s))}</th>`).join("")}</tr></thead><tbody>${circleRows()}</tbody></table></div></div><div class="card"><h2>逐局记录</h2>${
      room.history.length
        ? `<div class="scroll"><table><thead><tr><th>局 / 本场</th><th>结果</th>${room.members.map((m, s) => `<th>${esc(seatName(s))}</th>`).join("")}</tr></thead><tbody>${[
            ...room.history,
          ]
            .reverse()
            .map(
              (h) =>
                `<tr><th>${roundLabel(h.hand, n)} · ${h.honba}</th><td>${esc(h.description)}</td>${h.delta.map((d) => `<td class="${d >= 0 ? "positive" : "negative"}">${d > 0 ? "+" : ""}${d.toLocaleString()}</td>`).join("")}</tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<p class="muted">每局结束后记一次。累计点数与供托分开显示。</p>'
    }</div><button id="new-room">另开一桌</button>`;
  $("#share").onclick = () => {
    modal({
      title: "邀请朋友入桌",
      body: `<img class="qr" src="${base}/api/rooms/${room.id}/qr" alt="牌桌加入二维码"><p class="muted">朋友扫码填写昵称并选座位。若对方没有手机，桌主可直接填写玩家。</p><p class="share-url">${esc(location.origin + base + "/?join=" + room.code)}</p><button id="copy-link">复制邀请链接</button>`,
    });
    $("#copy-link").onclick = () =>
      task(async () => {
        await navigator.clipboard.writeText(
          location.origin + base + "/?join=" + room.code,
        );
        $("#copy-link").textContent = "已复制";
      });
  };
  $("#room")
    .querySelectorAll("[data-add]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          modal({
            title: "填写线下玩家",
            body: '<form id="add-player"><label>玩家昵称<input id="player-name" maxlength="24" required></label><div class="actions"><button class="primary" data-submit>保存</button></div></form>',
          });
          $("#add-player").onsubmit = (e) => {
            e.preventDefault();
            task(async () => {
              await command({
                action: "add-player",
                seat: Number(b.dataset.add),
                name: $("#player-name").value,
              });
              $("#modal").close();
            });
          };
        }),
    );
  if ($("#record")) $("#record").onclick = () => openRecord();
  if ($("#undo"))
    $("#undo").onclick = () =>
      confirmAction(
        "撤回最近记录？",
        "恢复这一条记录之前的点数、本场、庄家和供托。",
        "undo",
      );
  if ($("#finish"))
    $("#finish").onclick = () =>
      confirmAction(
        "结束这一场？",
        "保留所有记录和点数。未领走的立直供托仍单独显示，结束操作可以撤回。",
        "finish",
      );
  $("#new-room").onclick = () => {
    modal({
      title: "另开一张牌桌？",
      body: '<p class="muted">当前牌桌和记录会保留。请收藏当前邀请链接，之后仍可回到这桌。</p><button id="confirm-new">另开一桌</button>',
    });
    $("#confirm-new").onclick = () =>
      task(async () => {
        past = await api("/api/rooms");
        room = null;
        localStorage.removeItem("riichi-room");
        $("#modal").close();
        renderRoom();
      });
  };
}
function circleRows() {
  const grouped = new Map();
  for (const h of room.history) {
    if (h.kind === "finish") continue;
    const index = Math.floor(h.hand / room.rules.players);
    if (!grouped.has(index))
      grouped.set(index, Array(room.rules.players).fill(0));
    h.delta.forEach((d, s) => (grouped.get(index)[s] += d));
  }
  return (
    [...grouped]
      .map(
        ([i, d]) =>
          `<tr><th>${["东", "南", "西", "北"][i % 4]}圈${i >= 4 ? ` · 第${Math.floor(i / 4) + 1}场` : ""}</th>${d.map((x) => `<td class="${x >= 0 ? "positive" : "negative"}">${x > 0 ? "+" : ""}${x.toLocaleString()}</td>`).join("")}</tr>`,
      )
      .join("") || "<tr><td>尚无记录</td></tr>"
  );
}
async function command(body) {
  remember(
    await api(`/api/rooms/${room.id}/events`, {
      ...body,
      version: room.version,
      nonce: crypto.randomUUID(),
    }),
  );
}
function confirmAction(title, text, action) {
  modal({
    title,
    body: `<p class="muted">${text}</p><button id="confirm-action" data-submit class="primary">确认</button>`,
  });
  $("#confirm-action").onclick = () =>
    task(async () => {
      await command({ action });
      $("#modal").close();
    });
}
function openRecord() {
  modal({
    title: `${roundLabel(room.hand, room.rules.players)} · 记一局`,
    body: `<form id="record-form"><label>结果<select id="kind"><option value="tsumo">自摸</option><option value="ron">荣和（可多人）</option><option value="draw">荒牌流局</option><option value="abort">途中流局</option></select></label><div id="record-fields"></div><div class="divider"><p class="muted">本局实际交出立直棒的玩家（每人扣1000）</p>${room.members.map((m, s) => `<label class="check"><input type="checkbox" name="riichi" value="${s}">${esc(seatName(s))}</label>`).join("")}</div><div id="preview" class="muted"></div><div class="actions"><button class="primary" data-submit>确认记分</button></div></form>`,
  });
  $("#kind").onchange = recordFields;
  $("#record-form").oninput = previewEvent;
  recordFields();
  $("#record-form").onsubmit = (e) => {
    e.preventDefault();
    task(async () => {
      await command({ action: "record", event: readEvent() });
      $("#modal").close();
    });
  };
}
function winnerInputs(s, check = false) {
  return `<div class="winner divider" data-seat="${s}">${check ? `<label class="check"><input type="checkbox" name="winner" value="${s}">${esc(seatName(s))} 和牌</label>` : ""}<div class="grid"><label>番数<input class="han" type="number" min="1" max="100" value="3"></label><label>符数<select class="fu">${FU.map((f) => `<option ${f === 30 ? "selected" : ""}>${f}</option>`).join("")}</select></label><label>役满<select class="yakuman"><option value="0">普通符番</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}倍役满</option>`).join("")}</select></label></div></div>`;
}
function recordFields() {
  const kind = $("#kind").value;
  $("#record-fields").innerHTML =
    kind === "tsumo"
      ? `<label>自摸玩家${selectSeats("tsumo-seat")}</label>${winnerInputs(0)}`
      : kind === "ron"
        ? `<label>放铳玩家${selectSeats("loser")}</label>${room.members.map((m, s) => winnerInputs(s, true)).join("")}`
        : kind === "draw"
          ? `<p class="muted">勾选流局时听牌的玩家</p>${room.members.map((m, s) => `<label class="check"><input type="checkbox" name="tenpai" value="${s}">${esc(seatName(s))}</label>`).join("")}`
          : '<p class="muted">途中流局不交换点数，保留供托、庄家并增加一本场。</p>';
  previewEvent();
}
function previewEvent() {
  try {
    const { delta } = settle(room, readEvent());
    $("#preview").textContent =
      "本局收支：" +
      delta
        .map((d, s) => seatName(s) + " " + (d > 0 ? "+" : "") + d)
        .join(" · ");
    $("#record-form [data-submit]").disabled = false;
  } catch (e) {
    $("#preview").textContent = e.message;
    $("#record-form [data-submit]").disabled = true;
  }
}
function readEvent() {
  const kind = $("#kind").value,
    riichi = [...document.querySelectorAll("[name=riichi]:checked")].map((x) =>
      Number(x.value),
    );
  if (kind === "draw")
    return {
      kind,
      riichi,
      tenpai: [...document.querySelectorAll("[name=tenpai]:checked")].map((x) =>
        Number(x.value),
      ),
    };
  if (kind === "abort") return { kind, riichi };
  const winners = [...document.querySelectorAll(".winner")]
    .filter(
      (el) => kind === "tsumo" || el.querySelector("[name=winner]").checked,
    )
    .map((el) => ({
      seat:
        kind === "tsumo"
          ? Number($("#tsumo-seat").value)
          : Number(el.dataset.seat),
      han: Number(el.querySelector(".han").value),
      fu: Number(el.querySelector(".fu").value),
      yakuman: Number(el.querySelector(".yakuman").value),
    }));
  return {
    kind: "win",
    method: kind,
    winners,
    riichi,
    ...(kind === "ron" ? { loser: Number($("#loser").value) } : {}),
  };
}
renderQuick();
renderRoom();
await task(async () => {
  user = (await api("/api/session")).user;
  if (user) past = await api("/api/rooms");
  renderRoom();
  const code = new URLSearchParams(location.search).get("join");
  if (code) {
    tab("room");
    renderRoom();
    return;
  }
  const id = localStorage.getItem("riichi-room");
  if (id) {
    try {
      remember(await api(`/api/rooms/${id}`));
      tab("room");
    } catch {
      localStorage.removeItem("riichi-room");
      renderRoom();
    }
  }
});
setInterval(async () => {
  if (!room || busy || $("#modal").open || document.hidden) return;
  try {
    const latest = await api(`/api/rooms/${room.id}`);
    if (latest.version !== room.version) remember(latest);
  } catch {}
}, 5000);
