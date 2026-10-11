import { calculateFu } from "./fu.js";
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
  for (const key of ["quick", "room", "fu", "me"]) {
    $("#" + key).hidden = key !== name;
    $("#" + key + "-tab").classList.toggle("active", key === name);
    const button = $("#" + key + "-tab");
    if (key === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("#quick-tab").classList.toggle("active", name === "quick");
  $("#room-tab").classList.toggle("active", name === "room");
  $(".hero").hidden = name !== "quick";
  window.scrollTo(0, 0);
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
    )}<div class="grid"><label>本场<input id="quick-honba" type="number" min="0" max="100" value="${quick.honba}"></label><label>役满<select id="quick-yakuman"><option value="0">普通符番</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${quick.yakuman === n ? "selected" : ""}>${n}倍役满</option>`).join("")}</select></label></div></div><div class="card"><h2>算符</h2><p>门前清荣和 +10符</p><p>自摸 +2符</p><p>边张 / 嵌张 / 单骑 +2符</p><p>七对子 25符 · 平和自摸 20符</p><button id="open-fu">选择牌型算符</button></div></div><div class="card"><h2>${quick.dealer ? "庄家" : "闲家"} · ${quick.method === "ron" ? "荣和支付" : "自摸支付"}速查表</h2><div class="scroll"><table><thead><tr><th>符 / 番</th>${[1, 2, 3, 4].map((n) => `<th>${n}番</th>`).join("")}</tr></thead><tbody>${FU.map(
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
    )}</tbody></table></div><p class="muted">自摸：闲家 / 庄家；ALL：每家。本场 ${quick.honba}。</p></div>${limitTable()}`;
  $("#open-fu").onclick = () => {
    tab("fu");
    renderFu();
  };
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
      `<div class="card"><h2>${join ? "加入朋友的牌桌" : "开一张线下牌桌"}</h2><p class="muted">填写昵称，开桌或扫码入桌。</p><form id="entry"><div class="grid"><label>你的昵称<input id="name" maxlength="24" required value="${esc(user?.name ?? "")}" ${user ? "readonly" : ""}></label>${join ? '<label>选择座位<select id="join-seat"><option value="1">初始南家</option><option value="2">初始西家</option><option value="3">初始北家（四人桌）</option></select></label>' : '<label>桌型<select id="players"><option value="4">四人日麻 · 25000 起点</option><option value="3">三人日麻 · 35000 起点</option></select></label>'}</div>${join ? "" : '<label class="check"><input id="kiriage" type="checkbox">切上满贯（4番30符 / 3番60符）</label><label class="check"><input id="kazoe" type="checkbox" checked>累计役满（13番起）</label>'}<div class="actions"><button class="primary" data-submit>${join ? "加入牌桌" : "创建牌桌"}</button></div></form></div>`;
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

let fuForm = {
  closed: true,
  method: "ron",
  special: "normal",
  pair: 0,
  wait: 0,
  melds: [],
};
$("#fu-tab").onclick = () => {
  tab("fu");
  renderFu();
};
function renderFu() {
  let r, error;
  try {
    r = calculateFu(fuForm);
  } catch (e) {
    error = e.message;
  }
  const choices = (key, values) =>
    `<div class="choice-row">${values.map(([v, label]) => `<button data-fu-key="${key}" data-fu-value='${JSON.stringify(v)}' class="${fuForm[key] === v ? "selected" : ""}" aria-pressed="${fuForm[key] === v}">${label}</button>`).join("")}</div>`;
  $("#fu").innerHTML =
    `<div class="grid"><div class="card"><h2>选择牌型</h2>${choices("method", [
      ["ron", "荣和"],
      ["tsumo", "自摸 +2符"],
    ])}${choices("closed", [
      [true, fuForm.method === "ron" ? "门前清荣和 +10符" : "门前清"],
      [false, "副露"],
    ])}${choices("special", [
      ["normal", "普通牌型"],
      ["chiitoitsu", "七对子 25符"],
      ["pinfu", fuForm.method === "tsumo" ? "平和自摸 20符" : "平和荣和 30符"],
    ])}${
      fuForm.special === "normal"
        ? `<h3>雀头</h3>${choices("pair", [
            [0, "非役牌 +0"],
            [2, "役牌 +2"],
            [4, "连风 +4"],
          ])}<h3>等待</h3>${choices("wait", [
            [0, "两面 / 双碰 +0"],
            [2, "边张 / 嵌张 / 单骑 +2"],
          ])}<h3>刻子与杠子</h3>${fuForm.melds
            .map(
              (m, i) =>
                `<div class="row"><label>面子<select data-meld="${i}">${[
                  ["openTriplet", "明刻 2/4符"],
                  ["closedTriplet", "暗刻 4/8符"],
                  ["openKan", "明杠 8/16符"],
                  ["closedKan", "暗杠 16/32符"],
                ]
                  .map(
                    ([v, l]) =>
                      `<option value="${v}" ${m.type === v ? "selected" : ""}>${l}</option>`,
                  )
                  .join(
                    "",
                  )}</select></label><label class="check"><input type="checkbox" data-terminal="${i}" ${m.terminal ? "checked" : ""}>幺九字牌</label><button data-remove="${i}">移除</button></div>`,
            )
            .join(
              "",
            )}<button id="add-meld" ${fuForm.melds.length === 4 ? "disabled" : ""}>添加刻子 / 杠子</button>`
        : ""
    }</div><div class="card"><h2>符数明细</h2>${r ? `${r.items.map((x) => `<div class="line"><span>${x.label}</span><strong>+${x.value}符</strong></div>`).join("")}<div class="result fu-result"><p>${r.raw}符 · ${fuForm.special === "normal" ? "向上取整" : "固定符数"}</p><strong>${r.fu}符</strong></div><button id="use-fu" class="primary">用这个符数查点</button>` : esc(error)}</div></div>`;
  $("#fu")
    .querySelectorAll("[data-fu-key]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          fuForm[b.dataset.fuKey] = JSON.parse(b.dataset.fuValue);
          renderFu();
        }),
    );
  $("#fu")
    .querySelectorAll("[data-meld]")
    .forEach(
      (b) =>
        (b.onchange = () => {
          fuForm.melds[Number(b.dataset.meld)].type = b.value;
          if (["openTriplet", "openKan"].includes(b.value))
            fuForm.closed = false;
          renderFu();
        }),
    );
  $("#fu")
    .querySelectorAll("[data-terminal]")
    .forEach(
      (b) =>
        (b.onchange = () => {
          fuForm.melds[Number(b.dataset.terminal)].terminal = b.checked;
          renderFu();
        }),
    );
  $("#fu")
    .querySelectorAll("[data-remove]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          fuForm.melds.splice(Number(b.dataset.remove), 1);
          renderFu();
        }),
    );
  const add = $("#add-meld");
  if (add)
    add.onclick = () => {
      if (fuForm.melds.length < 4) {
        fuForm.closed = false;
        fuForm.melds.push({ type: "openTriplet", terminal: false });
      }
      renderFu();
    };
  const use = $("#use-fu");
  if (use)
    use.onclick = () => {
      quick.fu = r.fu;
      quick.method = fuForm.method;
      quick.han = Math.max(
        quick.han,
        r.fu === 25 ? (fuForm.method === "tsumo" ? 3 : 2) : r.fu === 20 ? 2 : 1,
      );
      tab("quick");
      renderQuick();
    };
}
$("#me-tab").onclick = () => {
  tab("me");
  task(() => renderMe());
};
async function renderMe(
  month = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()),
) {
  if (!user) {
    $("#me").innerHTML =
      '<div class="card"><h2>我的牌谱</h2><p>开桌或扫码入桌后，查看每月记录。</p><button id="me-entry">进入牌桌</button></div>';
    $("#me-entry").onclick = () => {
      tab("room");
      renderRoom();
    };
    return;
  }
  const [p, s] = await Promise.all([
    api("/api/profile"),
    api("/api/stats?month=" + month),
  ]);
  $("#me").innerHTML =
    `<div class="card"><h2>${esc(p.name)} · 我的牌谱</h2><label>月份<input id="stats-month" type="month" value="${month}"></label><div class="score-grid">${[
      ["净点数", s.net],
      ["参与局数", s.hands],
      ["和牌次数", s.wins],
      ["被胡次数", s.hit],
      ["放铳局数", s.dealin],
    ]
      .map(
        ([label, n]) =>
          `<div class="seat"><p>${label}</p><strong>${n.toLocaleString()}</strong></div>`,
      )
      .join(
        "",
      )}</div></div><div class="card"><h2>同桌收支</h2>${s.best ? `<p>赢得最多 · ${esc(s.best.name)} <strong class="positive">+${s.best.net.toLocaleString()}</strong></p>` : ""}${s.worst ? `<p>输得最多 · ${esc(s.worst.name)} <strong class="negative">${s.worst.net.toLocaleString()}</strong></p>` : ""}${s.peers.map((p) => `<div class="line"><span>${esc(p.name)} · ${p.hands}局</span><strong class="${p.net >= 0 ? "positive" : "negative"}">${p.net >= 0 ? "+" : ""}${p.net.toLocaleString()}</strong></div>`).join("") || "<p>这个月还没有牌局</p>"}</div>`;
  $("#stats-month").onchange = (e) => {
    if (e.target.value) task(() => renderMe(e.target.value));
  };
}
