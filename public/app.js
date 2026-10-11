import { roundStatus, settlementView } from "./settlement-view.js";
import { lookup } from "./lookup.js";
import { calculateFu } from "./fu.js";
import { points, FU } from "./scoring.js";
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
  $(".hero").hidden = true;
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
function renderQuick() {
  const view = lookup(quick);
  const amount = (c) =>
    `<span class="cell-main">${c.main}</span>${c.sub ? `<span class="cell-sub">${c.sub}</span>` : ""}`;
  const cellButton = (c) =>
    `<button class="point-cell ${c.selected ? "chosen" : ""}" data-fu="${c.fu}" data-han="${c.han}" data-yakuman="${c.yakuman}" ${c.valid ? "" : "disabled"} aria-pressed="${c.selected}" aria-label="${c.yakuman ? c.title : `${c.han}番${c.fu}符`} ${c.main}${c.sub ? " / " + c.sub : ""}">${amount(c)}</button>`;
  $("#quick").innerHTML =
    `<div class="card lookup-card"><div class="lookup-heading"><h2>符番速查</h2><span class="lookup-mark" aria-hidden="true">点数</span></div>
    <div class="quick-context"><div><span class="context-label">桌型</span>${chips(
      "players",
      [
        [4, "四人"],
        [3, "三人"],
      ],
    )}</div><div><span class="context-label">本场</span><div class="counter" aria-label="调整本场"><button id="honba-minus" aria-label="减少一本场" ${quick.honba === 0 ? "disabled" : ""}>−</button><strong>${quick.honba} 本场</strong><button id="honba-plus" aria-label="增加一本场" ${quick.honba === 100 ? "disabled" : ""}>＋</button></div></div></div>
    <div class="lookup-switches">${chips("dealer", [
      [false, "闲家"],
      [true, "庄家"],
    ])}${chips("method", [
      ["ron", "荣和"],
      ["tsumo", "自摸"],
    ])}</div>
    <div class="result lookup-result" aria-live="polite">${view.result ? `<div class="selection-label">${quick.dealer ? "庄家" : "闲家"} · ${view.result.selection}</div><strong>${view.result.totalText}<small> 点</small></strong><p>${view.result.payment}</p>` : `<p>${esc(view.error)}</p>`}</div>
    <div class="table-caption"><span>${view.legend}</span><span>${quick.players}人 · ${quick.honba}本场</span></div>
    <table class="point-matrix"><thead><tr><th>符 / 番</th>${view.columns.map((c) => `<th class="${c.selected ? "axis-selected" : ""}">${c.han}番</th>`).join("")}</tr></thead><tbody>${view.rows.map((row) => `<tr><th class="${row.selected ? "axis-selected" : ""}">${row.fu}符</th>${row.cells.map((c) => `<td class="${!quick.yakuman && quick.han <= 4 && (quick.fu === c.fu || quick.han === c.han) ? "axis-tint" : ""}">${cellButton(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <h3 class="limit-heading">5番及以上 · 满贯与役满</h3><table class="limit-matrix"><tbody>${view.limits.map((c) => `<tr class="${c.selected ? "limit-selected" : ""}"><th>${c.title}</th><td>${c.label}</td><td>${cellButton(c)}</td></tr>`).join("")}</tbody></table>
    <details class="lookup-more" ${quick.yakuman ? "open" : ""}><summary>多倍役满</summary><table class="limit-matrix"><tbody>${view.yakumans.map((c) => `<tr class="${c.selected ? "limit-selected" : ""}"><th>${c.title}</th><td>${cellButton(c)}</td></tr>`).join("")}</tbody></table></details>
</div>`;
  $("#quick")
    .querySelectorAll("[data-key]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const { key, value } = b.dataset;
          quick[key] =
            key === "players"
              ? Number(value)
              : key === "dealer"
                ? value === "true"
                : value;
          if (key === "method" && !lookup(quick).result) quick.fu = 30;
          renderQuick();
        }),
    );
  $("#quick")
    .querySelectorAll("[data-han]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          quick.fu = Number(b.dataset.fu);
          quick.han = Number(b.dataset.han);
          quick.yakuman = Number(b.dataset.yakuman);
          renderQuick();
        }),
    );
  for (const [id, step] of [
    ["honba-minus", -1],
    ["honba-plus", 1],
  ])
    $("#" + id).onclick = () => {
      quick.honba = Math.max(0, Math.min(100, quick.honba + step));
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
  const status = roundStatus(room);
  $("#room").innerHTML =
    `<div class="card"><div class="row"><div><p class="eyebrow">${n === 4 ? "四人日麻" : "三人日麻 · 自摸损"}</p><h2>${room.finished ? "牌局已结束" : roundLabel(room.hand, n)} </h2></div><button id="share">扫码入桌</button></div><div class="round-status"><strong>${room.honba}<small> 本场</small></strong><div><b>${esc(status.label)}</b><span>庄家 · ${esc(status.dealerName)}</span></div></div><p class="muted">供托 ${room.pot} 根 · ${room.rules.kiriage ? "切上满贯" : "不切上满贯"} · ${room.rules.kazoe ? "累计役满" : "13番起三倍满"}${room.isOwner ? " · 你是桌主" : " · 由桌主记分"}</p><div class="score-grid">${room.scores.map((score, s) => `<div class="seat ${room.dealer === s ? "dealer" : ""}"><p>${esc(seatName(s))}${room.dealer === s ? '<span class="badge">庄</span>' : ""}${s === room.mySeat ? " · 你" : ""}</p><strong>${score.toLocaleString()}</strong><span class="${score >= room.rules.start ? "positive" : "negative"}">${score - room.rules.start >= 0 ? "+" : ""}${(score - room.rules.start).toLocaleString()}</span>${!room.members[s] && room.isOwner ? `<button data-add="${s}">填写玩家</button>` : ""}</div>`).join("")}</div>${room.isOwner ? `<div class="actions">${room.finished ? "" : '<button id="record" class="primary">记一局</button>'}${room.history.length ? '<button id="undo">撤回最近记录</button>' : ""}${room.finished ? "" : '<button id="finish">结束牌局</button>'}</div>` : ""}</div><div class="card"><h2>每圈收支</h2><div class="scroll"><table><thead><tr><th>圈</th>${room.members.map((m, s) => `<th>${esc(seatName(s))}</th>`).join("")}</tr></thead><tbody>${circleRows()}</tbody></table></div></div><div class="card"><h2>逐局记录</h2>${
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
    body: `<div class="record-status"><b>${room.honba} 本场</b><span>${esc(roundStatus(room).label)} · 庄家 ${esc(roundStatus(room).dealerName)}</span></div><form id="record-form"><label>结果<select id="kind"><option value="tsumo">自摸</option><option value="ron">荣和（可多人）</option><option value="draw">荒牌流局</option><option value="abort">途中流局</option></select></label><div id="record-fields"></div><div class="divider"><p class="muted">本局实际交出立直棒的玩家（每人扣1000）</p>${room.members.map((m, s) => `<label class="check"><input type="checkbox" name="riichi" value="${s}">${esc(seatName(s))}</label>`).join("")}</div><div id="preview"></div><div class="actions"><button class="primary" data-submit>确认记分</button></div></form>`,
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
  return `<div class="winner divider" data-seat="${s}" data-han="3" data-fu="30">${check ? `<label class="check"><input type="checkbox" name="winner" value="${s}">${esc(seatName(s))} 和牌</label>` : ""}<div class="record-label">番数</div><div class="counter record-counter"><button type="button" data-han-step="-1" aria-label="减少一番">−</button><output class="han">3 番</output><button type="button" data-han-step="1" aria-label="增加一番">＋</button></div><div class="record-label">符数</div><div class="fu-choices">${FU.map((f) => `<button type="button" data-fu-choice="${f}" aria-pressed="${f === 30}" class="${f === 30 ? "selected" : ""}">${f}符</button>`).join("")}</div><label>役满<select class="yakuman"><option value="0">普通符番</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}倍役满</option>`).join("")}</select></label></div>`;
}
function refreshWinnerControls() {
  const method = $("#kind").value;
  if (!["tsumo", "ron"].includes(method)) return;
  $("#record-fields")
    .querySelectorAll(".winner")
    .forEach((el) => {
      const han = Number(el.dataset.han),
        fu = Number(el.dataset.fu);
      const valid = (f) => {
        try {
          points({ han, fu: f, method });
          return true;
        } catch {
          return false;
        }
      };
      if (!valid(fu)) el.dataset.fu = "30";
      el.querySelector(".han").textContent = `${han} 番`;
      el.querySelectorAll("[data-han-step]").forEach(
        (b) =>
          (b.disabled = Number(b.dataset.hanStep) < 0 ? han <= 1 : han >= 100),
      );
      el.querySelectorAll("[data-fu-choice]").forEach((b) => {
        const selected = Number(b.dataset.fuChoice) === Number(el.dataset.fu);
        b.disabled = !valid(Number(b.dataset.fuChoice));
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
        b.onclick = () => {
          el.dataset.fu = b.dataset.fuChoice;
          refreshWinnerControls();
          previewEvent();
        };
      });
      el.querySelectorAll("[data-han-step]").forEach(
        (b) =>
          (b.onclick = () => {
            el.dataset.han = String(
              Math.max(1, Math.min(100, han + Number(b.dataset.hanStep))),
            );
            refreshWinnerControls();
            previewEvent();
          }),
      );
    });
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
  refreshWinnerControls();
  previewEvent();
}
function previewEvent() {
  try {
    const view = settlementView(room, readEvent());
    const num = (x) => x.toLocaleString();
    $("#preview").innerHTML =
      `${view.winning ? `<h3>每人最终支付</h3><table class="payment-table"><thead><tr><th>玩家</th><th>基础点数</th><th>本场加点</th><th>最终支付</th></tr></thead><tbody>${view.rows.map((r) => `<tr><th>${esc(r.name)}</th><td>${num(r.base)}</td><td>+${num(r.bonus)}</td><td><b>${num(r.total)}</b></td></tr>`).join("")}</tbody></table>${view.transfers.map((t) => `<p class="payment-transfer">${esc(t.fromName)} → ${esc(t.toName)}：${num(t.base)} + ${num(t.bonus)} = <b>${num(t.total)}</b></p>`).join("")}${view.potIncome ? `<p>供托收入：${num(view.potIncome)} 点</p>` : ""}` : ""}<h3>本局收支</h3>${view.rows.map((r) => `<div class="line"><span>${esc(r.name)}${r.riichi ? ` · 立直支出 ${num(r.riichi)}` : ""}</span><b class="${r.positive ? "positive" : "negative"}">${r.value > 0 ? "+" : ""}${num(r.value)}</b></div>`).join("")}<div class="next-round">记分后：${roundLabel(view.next.hand, room.rules.players)} · <b>${view.next.honba} 本场</b><br>${esc(view.next.dealerName)} · ${view.next.label}</div>`;
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
      han: Number(el.dataset.han),
      fu: Number(el.dataset.fu),
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
        ? `<h3>雀头（对子）</h3>${choices("pair", [
            [0, "非役牌 +0符"],
            [2, "役牌 +2符"],
            [4, "连风（自风＋场风） +4符"],
          ])}<h3>听牌形</h3>${choices("wait", [
            [0, "两面 / 双碰 +0符"],
            [2, "边张 / 嵌张 / 单骑 +2符"],
          ])}<h3>刻子与杠子</h3>${fuForm.melds
            .map(
              (m, i) =>
                `<div class="row"><label>刻子／杠子<select data-meld="${i}">${[
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
                  )}</select></label><label class="check"><input type="checkbox" data-terminal="${i}" ${m.terminal ? "checked" : ""}>幺九牌／字牌</label><button data-remove="${i}">移除</button></div>`,
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
      quick.yakuman = 0;
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
