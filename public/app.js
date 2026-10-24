import { mountAccountName } from "./account-name.js";
import { roundStatus, settlementView } from "./settlement-view.js";
import { searchYaku } from "./yaku.js";
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
let followRoom = localStorage.getItem("riichi-room-mode") !== "history";
let entryOptions = {players:4, rounds:2, kiriage:false, kazoe:true};
let ronWinners = new Set();
let recordLoser = -1;
let recordKind = "win";
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
    `<div class="card lookup-card"><div class="lookup-heading"><h2>符番速查</h2><button id="open-yaku" type="button">查役种</button></div>
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
  $("#open-yaku").onclick = renderYaku;
  for (const [id, step] of [
    ["honba-minus", -1],
    ["honba-plus", 1],
  ])
    $("#" + id).onclick = () => {
      quick.honba = Math.max(0, Math.min(100, quick.honba + step));
      renderQuick();
    };
}
function renderYaku() {
  $("#quick").innerHTML =
    `<div class="card"><div class="lookup-heading"><h2>役种查番</h2><button id="back-points">查点数</button></div><label>搜索役名或条件<input id="yaku-query" type="search" placeholder="例如：门清、三色、字牌"></label><div class="choice-row" id="yaku-groups">${["全部", "1番", "2番", "3番", "6番", "役满"].map((g) => `<button data-group="${g}" aria-pressed="${g === "全部"}" class="${g === "全部" ? "selected" : ""}">${g}</button>`).join("")}</div><div id="yaku-list"></div><p class="muted">宝牌、赤宝牌、里宝牌、拔北宝牌各加1番，和牌须另有役。</p></div>`;
  let group = "全部";
  const refresh = () => {
    const items = searchYaku($("#yaku-query").value, group);
    $("#yaku-list").innerHTML =
      items
        .map(
          (y) =>
            `<article class="yaku-item"><div><h3>${esc(y.name)}</h3><span>门清 ${esc(y.closedLabel)} · ${y.open === null ? esc(y.openLabel) : `副露 ${esc(y.openLabel)}`}</span></div><p>${esc(y.description)}</p></article>`,
        )
        .join("") || "<p>没有找到，换个关键词试试。</p>";
    document.querySelectorAll("[data-group]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.group === group);
      b.setAttribute("aria-pressed", String(b.dataset.group === group));
    });
  };
  $("#yaku-query").oninput = refresh;
  document.querySelectorAll("[data-group]").forEach(
    (b) =>
      (b.onclick = () => {
        group = b.dataset.group;
        refresh();
      }),
  );
  $("#back-points").onclick = renderQuick;
  refresh();
  window.scrollTo(0, 0);
}
const roundLabel = (hand, n) =>
  `${["东", "南", "西", "北"][Math.floor(hand / n) % 4]}${(hand % n) + 1}局${hand >= n * 4 ? `（第${Math.floor(hand / (n * 4)) + 1}场）` : ""}`;
const seatName = (s) => room?.members[s]?.name ?? `座位 ${s + 1}`;
function modal(html) {
  delete $("#modal").dataset.stale;
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${html.title}</h2><button id="close-modal" aria-label="关闭">×</button></div>${html.body}<p id="modal-error" role="alert"></p>`;
  $("#close-modal").onclick = () => $("#modal").close();
  if (!$("#modal").open) $("#modal").showModal();
}
function remember(r, follow = followRoom) {
  followRoom = follow;
  localStorage.setItem("riichi-room-mode",follow?"live":"history");
  room = r;
  localStorage.setItem("riichi-room", r.id);
  renderRoom();
}
function renderRoom() {
  if (!room) {
    const join = new URLSearchParams(location.search).get("join");
    const nameDraft = $("#entry #name")?.value ?? user?.name ?? "";
    const choices=(key,values)=>`<div class="choice-row entry-choices">${values.map(([value,label])=>`<button type="button" data-entry-key="${key}" data-entry-value="${value}" class="${entryOptions[key]===value?'selected':''}" aria-pressed="${entryOptions[key]===value}">${label}</button>`).join("")}</div>`;
    $("#room").innerHTML = `<div class="card"><h2>${join?"加入朋友的牌桌":"开一张线下牌桌"}</h2><p class="muted">填写用户名，开桌或扫码入桌。</p><form id="entry"><label>用户名 / 昵称<input id="name" maxlength="24" required value="${esc(user?.name??nameDraft)}" ${user?'readonly':''}></label>${join?'':`<h3>桌型</h3>${choices('players',[[4,'四人日麻 · 25000起点'],[3,'三人日麻 · 35000起点']])}<h3>场长</h3>${choices('rounds',[[1,'东风场'],[2,'半庄 · 东南场']])}<div class="rule-options">${[['kiriage','切上满贯','4番30符 / 3番60符'],['kazoe','累计役满','13番起']].map(([key,name,note])=>`<button type="button" class="rule-option ${entryOptions[key]?'is-on':''}" data-entry-key="${key}" data-entry-value="${!entryOptions[key]}" aria-pressed="${entryOptions[key]}"><span class="rule-copy"><span class="rule-name">${name}</span><span class="rule-note">${note}</span></span><span class="rule-switch">${entryOptions[key]?'开启':'关闭'}<span class="switch-track"></span></span></button>`).join("")}</div>`}<div class="actions"><button class="primary" data-submit>${join?'加入牌桌':'创建牌桌'}</button></div></form></div>`;
    $("#entry").querySelectorAll('[data-entry-key]').forEach(b=>b.onclick=()=>{entryOptions[b.dataset.entryKey]=JSON.parse(b.dataset.entryValue);renderRoom();});
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
              })
            : await api("/api/rooms", {
                players: entryOptions.players,
                rounds: entryOptions.rounds,
                chooseDealer: true,
                kiriage: entryOptions.kiriage,
                kazoe: entryOptions.kazoe,
              }),
          true,
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
                remember(await api("/api/rooms/" + b.dataset.open + "?follow=1"), true),
              )),
        );
    }
    return;
  }
  const n = room.rules.players;
  const status = roundStatus(room);
  const settingUp = !room.finished && !room.history.length;
  const ranking = room.members.map((m, seat) => ({name:m?.name||"空位",score:room.scores[seat],net:room.scores[seat]-room.rules.start,seat})).sort((a,b)=>b.score-a.score||a.seat-b.seat);
  $("#room").innerHTML = `
    <div class="card ${room.finished ? "finished-summary" : ""}">
      <div class="row"><div><p class="eyebrow">${n===4?"四人日麻":"三人日麻 · 自摸损"} · ${room.rules.rounds===1?"东风场":room.rules.rounds===2?"半庄":"自由场"}</p><h2>${room.finished?"牌局已结束 · 本场结算":roundLabel(room.hand,n)}</h2></div><div class="actions"><button id="back-home">回到主页</button>${room.finished?"":'<button id="share">扫码入桌</button>'}</div></div>
      ${room.finished ? `<div class="final-ranking">${ranking.map((r,i)=>`<div class="ranking-row"><span class="rank-number">${i+1}</span><b>${esc(r.name)}</b><span>${r.score.toLocaleString()}<small>总点数</small></span><strong class="${r.net>=0?'positive':'negative'}">${r.net>0?'+':''}${r.net.toLocaleString()}<small>净点数</small></strong></div>`).join("")}</div><button id="rematch" class="primary rematch-button" data-submit>${room.nextRoomId?"进入下一场牌桌":"原班人马再开一场"}</button><p class="muted">${esc(room.members.map(m=>m?.name||"空位").join(" / "))}</p>${room.pot?`<p>未领取供托 ${room.pot} 根</p>`:""}` : `
      <div class="round-status"><strong>${room.honba}<small> 本场</small></strong><div><b>${esc(status.label)}</b><span>${room.dealerSelected===false?"待选择起庄玩家":"庄家 · "+esc(status.dealerName)}</span></div></div>
      <p class="muted">供托 ${room.pot} 根 · ${room.rules.kiriage?"切上满贯":"不切上满贯"} · ${room.rules.kazoe?"累计役满":"13番起三倍满"}</p>
      <div class="score-grid">${room.scores.map((score,seat)=>`<div class="seat ${room.dealerSelected!==false&&room.dealer===seat?"dealer":""}"><p>${esc(seatName(seat))}${room.dealerSelected!==false&&room.dealer===seat?'<span class="badge">庄</span>':""}${seat===room.mySeat?" · 你":""}</p><strong>${score.toLocaleString()}</strong><span class="${score>=room.rules.start?"positive":"negative"}">${score>=room.rules.start?"+":""}${(score-room.rules.start).toLocaleString()}</span>${settingUp?(!room.members[seat]?`<button data-add="${seat}">填写玩家</button>`:seat!==room.mySeat?`<button class="quiet-button" data-remove="${seat}">更换玩家</button>`:""):""}</div>`).join("")}</div>
      ${settingUp?`<div class="pre-game"><div class="choice-row"><button data-length="1" aria-pressed="${room.rules.rounds===1}" class="${room.rules.rounds===1?'selected':''}">东风场</button><button data-length="2" aria-pressed="${room.rules.rounds===2}" class="${room.rules.rounds===2?'selected':''}">半庄 · 东南场</button></div><div class="actions"><button id="sort-seats">拖动调整顺序</button></div></div>`:""}
      <div class="actions"><button id="record" class="primary">记一局</button><button id="finish">结束牌局</button></div>`}
    </div>
    <div class="card"><h2>每圈收支</h2><div class="scroll"><table><thead><tr><th>圈</th>${room.members.map((m,seat)=>`<th>${esc(seatName(seat))}</th>`).join("")}</tr></thead><tbody>${circleRows()}</tbody></table></div></div>
    <div class="card"><h2>逐局记录</h2>${room.history.length?`<div class="scroll"><table><thead><tr><th>局 / 本场</th><th>结果</th>${room.members.map((m,seat)=>`<th>${esc(seatName(seat))}</th>`).join("")}</tr></thead><tbody>${[...room.history].reverse().map(h=>`<tr><th>${roundLabel(h.hand,n)} · ${h.honba}</th><td>${esc(h.description)}</td>${h.delta.map(d=>`<td class="${d>=0?'positive':'negative'}">${d>0?'+':''}${d.toLocaleString()}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`:'<p class="muted">每局结束后记一次。</p>'}</div>
    <div class="card room-management"><h2>牌局管理</h2><div class="actions">${room.history.length?'<button id="undo">撤回最近记录</button>':""}<button id="delete-room" class="delete-button">删除牌局</button></div></div>`;
  $("#back-home").onclick=()=>task(goHome);
  $("#delete-room").onclick=()=>deleteGame(room);
  if($("#rematch"))$("#rematch").onclick=()=>task(async()=>{await command({action:"rematch"});window.scrollTo(0,0);});
  if($("#sort-seats"))$("#sort-seats").onclick=openSeatOrder;
  $("#room").querySelectorAll("[data-length]").forEach(b=>b.onclick=()=>task(()=>command({action:"set-length",rounds:Number(b.dataset.length)})));
  $("#room").querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>confirmAction("更换这位玩家？",`移出 ${esc(room.members[Number(b.dataset.remove)].name)} 后，可以扫码加入或填写新玩家。`,{action:"remove-player",seat:Number(b.dataset.remove)}));
  if($("#share"))$("#share").onclick = () => {
    modal({
      title: "邀请朋友入桌",
      body: `<img class="qr" src="${base}/api/rooms/${room.id}/qr" alt="牌桌加入二维码"><p class="muted">朋友扫码自动入座，开局前可调整顺序。也可以直接填写线下玩家。</p><p class="share-url">${esc(location.origin + base + "/?join=" + room.code)}</p><button id="copy-link">复制邀请链接</button>`,
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
  if (!room.finished && !room.history.length) {
    const b = document.createElement("button");
    b.textContent = room.dealerSelected === false ? "选择起庄玩家" : "更改起庄玩家";
    $("#room .pre-game .actions").append(b);
    b.onclick = () => {
      modal({title:"选择起庄玩家",body:room.members.map((m,i)=>m?`<button data-dealer="${i}">${esc(m.name)}</button>`:"").join("")});
      $("#modal").querySelectorAll("[data-dealer]").forEach(el=>el.onclick=()=>task(async()=>{
        await command({action:"set-dealer",seat:Number(el.dataset.dealer)});
        $("#modal").close();
      }));
    };
  }
  if ($("#record")) {
    $("#record").disabled = room.dealerSelected === false;
    $("#record").onclick = () => openRecord();
  }
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

}
async function goHome() {
  room=null; followRoom=true;
  localStorage.removeItem("riichi-room"); localStorage.removeItem("riichi-room-mode");
  history.replaceState(null,"",base+"/");
  past=user?await api("/api/rooms"):[];
  tab("room");renderRoom();
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
async function command(body, version = room.version) {
  remember(
    await api(`/api/rooms/${room.id}/events`, {
      ...body,
      version,
      nonce: crypto.randomUUID(),
    }),
    body.action === "rematch" ? true : followRoom,
  );
}
function confirmAction(title, text, action) {
  modal({
    title,
    body: `<p class="muted">${text}</p><button id="confirm-action" data-submit class="primary">确认</button>`,
  });
  $("#confirm-action").onclick = () =>
    task(async () => {
      await command(typeof action === "string" ? { action } : action);
      $("#modal").close();
    });
}
function deleteGame(target) {
  modal({title:"删除这张牌局？",body:`<p>${target.history.length?"整桌逐局记录和相关统计将一并删除，所有成员都将看不到这张桌。":"这张空桌将从所有成员的牌桌列表中移除。"}删除后不能恢复。</p><button id="confirm-delete" data-submit>删除牌局</button>`});
  $("#confirm-delete").onclick=()=>task(async()=>{
    await api("/api/rooms/"+target.id+"/events",{action:"delete",version:target.version,nonce:crypto.randomUUID()});
    if(room?.id===target.id){room=null;localStorage.removeItem("riichi-room");}
    past=await api("/api/rooms");renderRoom();await renderMe();$("#modal").close();
  });
}
function openSeatOrder(){
  const version=room.version, members=[...room.members];let order=members.map((_,i)=>i), drag=null;
  modal({title:"调整座位顺序",body:'<p class="muted">按出牌顺序排列，拖动整行，保存后选择起庄玩家。</p><div id="seat-order"></div><button id="save-seat-order" data-submit class="primary">保存顺序</button>'});
  const list=$("#seat-order");
  const draw=()=>{
    list.innerHTML=order.map((seat,i)=>`<div class="order-seat" data-position="${i}" data-seat="${seat}"><span class="order-number">${i+1}</span><span>${esc(members[seat]?.name||"空位")}</span><span class="drag-seat" aria-hidden="true">⠿<small>拖动</small></span><button type="button" data-up="${i}" ${i===0?'disabled':''} aria-label="上移${esc(members[seat]?.name||"空位")}">↑</button></div>`).join("");
    list.querySelectorAll("[data-up]").forEach(b=>b.onclick=()=>{if(drag)return;const i=Number(b.dataset.up);[order[i-1],order[i]]=[order[i],order[i-1]];draw();});
  };
  const move=e=>{
    if(!drag||e.pointerId!==drag.pointer)return;
    const dy=Math.max(drag.rects[0].top-drag.rects[drag.from].top,Math.min(e.clientY-drag.y,drag.rects.at(-1).top-drag.rects[drag.from].top));
    const center=(drag.rects[drag.from].top+drag.rects[drag.from].bottom)/2+dy;
    drag.to=drag.rects.reduce((best,r,i)=>Math.abs((r.top+r.bottom)/2-center)<Math.abs((drag.rects[best].top+drag.rects[best].bottom)/2-center)?i:best,0);
    drag.rows.forEach((row,i)=>{
      let offset=0;
      if(i===drag.from)offset=dy;
      else if(drag.from<drag.to&&i>drag.from&&i<=drag.to)offset=drag.rects[i-1].top-drag.rects[i].top;
      else if(drag.from>drag.to&&i>=drag.to&&i<drag.from)offset=drag.rects[i+1].top-drag.rects[i].top;
      row.style.transform=`translateY(${offset}px)`;
    });
  };
  const end=(e,cancel=false)=>{
    if(!drag||e.pointerId!==drag.pointer)return;
    const {from,to,pointer}=drag;drag=null;
    if(list.hasPointerCapture(pointer))list.releasePointerCapture(pointer);
    if(!cancel&&from!==to){const [seat]=order.splice(from,1);order.splice(to,0,seat);}
    list.classList.remove("is-dragging");draw();
  };
  list.onpointerdown=e=>{
    if(e.target.closest("button")||!e.isPrimary||e.button!==0)return;
    const row=e.target.closest(".order-seat");if(!row)return;
    e.preventDefault();const rows=[...list.children],from=rows.indexOf(row);
    drag={from,to:from,y:e.clientY,pointer:e.pointerId,rows,rects:rows.map(r=>r.getBoundingClientRect())};
    row.classList.add("dragging");list.classList.add("is-dragging");list.setPointerCapture(e.pointerId);
  };
  list.onpointermove=move;list.onpointerup=e=>end(e);list.onpointercancel=e=>end(e,true);list.onlostpointercapture=e=>end(e,true);
  draw();
  $("#save-seat-order").onclick=()=>{if(!drag)task(async()=>{await command({action:"reorder",order},version);$("#modal").close();});};
}
function openRecord() {
  const recordVersion = room.version;
  ronWinners = new Set();
  recordLoser = -1;
  recordKind = "win";
  modal({
    title: `${roundLabel(room.hand, room.rules.players)} · 记一局`,
    body: `<div class="record-status"><b>${room.honba} 本场</b><span>${esc(roundStatus(room).label)} · 庄家 ${esc(roundStatus(room).dealerName)}</span></div><form id="record-form"><div class="choice-row result-types"><button type="button" data-result="win">和牌</button><button type="button" data-result="draw">荒牌流局</button><button type="button" data-result="abort">途中流局</button></div><div id="record-fields"></div><div class="divider"><p class="muted">本局立直 · 每人1000点</p><div class="player-checks">${room.members.map((m, s) => `<button type="button" class="player-toggle" data-riichi-seat="${s}" aria-pressed="false">${esc(seatName(s))}</button>`).join("")}</div></div><div id="preview"></div><div class="actions"><button class="primary" data-submit>确认记分</button></div></form>`,
  });
  document.querySelectorAll("[data-result]").forEach(b=>b.onclick=()=>{
    recordKind=b.dataset.result;
    recordFields();
  });
  document.querySelectorAll("[data-riichi-seat]").forEach(b=>b.onclick=()=>togglePlayer(b));
  $("#record-form").oninput = previewEvent;
  recordFields();
  $("#record-form").onsubmit = (e) => {
    e.preventDefault();
    task(async () => {
      await command({ action: "record", event: readEvent() }, recordVersion);
      $("#modal").close();
    });
  };
}
function winnerInputs(s, selectable = false) {
  return `<div class="winner divider" data-seat="${s}" data-han="3" data-fu="30" ${selectable ? "hidden" : ""}>${selectable ? `<h3>${esc(seatName(s))} · 荣和</h3>` : ""}<div class="record-label">番数</div><div class="counter record-counter"><button type="button" data-han-step="-1" aria-label="减少一番">−</button><output class="han">3 番</output><button type="button" data-han-step="1" aria-label="增加一番">＋</button></div><div class="record-label">符数</div><div class="fu-choices">${FU.map((f) => `<button type="button" data-fu-choice="${f}" aria-pressed="${f === 30}" class="${f === 30 ? "selected" : ""}">${f}符</button>`).join("")}</div><div class="record-label">役满</div><input class="yakuman" type="hidden" value="0"><div class="fu-choices">${[0,1,2,3,4,5,6].map(n=>`<button type="button" data-yakuman-choice="${n}" aria-pressed="${n===0}" class="${n===0?'selected':''}">${n===0?'普通符番':n===1?'役满':n+'倍役满'}</button>`).join("")}</div></div>`;
}
function refreshWinnerControls() {
  const method = recordKind;
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
      el.querySelectorAll("[data-yakuman-choice]").forEach(b=>{
        const selected=b.dataset.yakumanChoice===el.querySelector(".yakuman").value;
        b.classList.toggle("selected",selected);b.setAttribute("aria-pressed",String(selected));
        b.onclick=()=>{el.querySelector(".yakuman").value=b.dataset.yakumanChoice;refreshWinnerControls();previewEvent();};
      });
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
  const kind = recordKind;
  const forms = new Map([...document.querySelectorAll(".winner")].map(el=>[Number(el.dataset.seat), {han:el.dataset.han,fu:el.dataset.fu,yakuman:el.querySelector(".yakuman").value}]));
  const win = ["win","tsumo","ron"].includes(kind);
  document.querySelectorAll("[data-result]").forEach(b=>{
    const selected=b.dataset.result===(win?"win":kind);
    b.classList.toggle("selected",selected);b.setAttribute("aria-pressed",String(selected));
  });
  $("#record-fields").innerHTML = win
    ? `<h2 class="record-question">谁和牌了？</h2><div class="choice-row winner-picker">${room.members.map((m,s)=>`<button type="button" data-winner-seat="${s}" aria-pressed="false">${esc(seatName(s))}</button>`).join("")}</div><div id="method-choice"><h3>怎么和的？</h3><div class="choice-row"><button type="button" data-method="tsumo">自摸</button><button type="button" data-method="ron">荣和</button></div></div><div id="loser-choice"><h3>谁放铳了？</h3><div class="choice-row winner-picker">${room.members.map((m,s)=>`<button type="button" data-loser-seat="${s}">${esc(seatName(s))}</button>`).join("")}</div></div><div id="winning-details">${room.members.map((m,s)=>winnerInputs(s,true)).join("")}</div>`
    : kind === "draw"
      ? `<h2 class="record-question">谁听牌了？</h2><div class="player-checks">${room.members.map((m,s)=>`<button type="button" class="player-toggle" data-tenpai-seat="${s}" aria-pressed="false">${esc(seatName(s))}</button>`).join("")}</div>`
      : '<h2 class="record-question">途中流局</h2><p>保留供托与庄家，增加一本场。</p>';
  if (win) {
    forms.forEach((v,seat)=>{const el=document.querySelector(`.winner[data-seat="${seat}"]`);el.dataset.han=v.han;el.dataset.fu=v.fu;el.querySelector(".yakuman").value=v.yakuman;});
    document.querySelectorAll("[data-winner-seat]").forEach(b=>b.onclick=()=>{
      const seat=Number(b.dataset.winnerSeat);
      if(ronWinners.has(seat))ronWinners.delete(seat);else ronWinners.add(seat);
      if(ronWinners.has(recordLoser))recordLoser=-1;
      if(ronWinners.size>1 && recordKind==="tsumo") recordKind="ron";
      syncRecordChoices();
    });
    document.querySelectorAll("[data-method]").forEach(b=>b.onclick=()=>{recordKind=b.dataset.method;syncRecordChoices();});
    document.querySelectorAll("[data-loser-seat]").forEach(b=>b.onclick=()=>{recordLoser=Number(b.dataset.loserSeat);syncRecordChoices();});
    syncRecordChoices();
  } else {document.querySelectorAll("[data-tenpai-seat]").forEach(b=>b.onclick=()=>togglePlayer(b));previewEvent();}
}
function togglePlayer(button) {
  const selected=button.getAttribute("aria-pressed")!=="true";
  button.setAttribute("aria-pressed",String(selected));button.classList.toggle("selected",selected);previewEvent();
}
function syncRecordChoices() {
  const method=recordKind;
  document.querySelectorAll("[data-winner-seat]").forEach(b=>{
    const seat=Number(b.dataset.winnerSeat),selected=ronWinners.has(seat);
    b.disabled=!selected&&ronWinners.size>=2;
    b.classList.toggle("selected",selected);b.setAttribute("aria-pressed",String(selected));
    const form=document.querySelector(`.winner[data-seat="${seat}"]`);
    form.hidden=!selected;
    form.querySelector("h3").textContent=seatName(seat)+(method==="tsumo"?" · 自摸":" · 荣和");
  });
  $("#method-choice").hidden=!ronWinners.size;
  document.querySelectorAll("[data-method]").forEach(b=>{
    b.disabled=b.dataset.method==="tsumo"&&ronWinners.size>1;
    b.classList.toggle("selected",b.dataset.method===method);b.setAttribute("aria-pressed",String(b.dataset.method===method));
  });
  $("#loser-choice").hidden=method!=="ron"||!ronWinners.size;
  document.querySelectorAll("[data-loser-seat]").forEach(b=>{
    const seat=Number(b.dataset.loserSeat);
    b.disabled=ronWinners.has(seat);b.classList.toggle("selected",seat===recordLoser);b.setAttribute("aria-pressed",String(seat===recordLoser));
  });
  $("#winning-details").hidden=!ronWinners.size||method==="win"||(method==="ron"&&recordLoser<0);
  refreshWinnerControls();previewEvent();
}
function previewEvent() {
  try {
    const view = settlementView(room, readEvent());
    const num = (x) => x.toLocaleString();
    $("#preview").innerHTML =
      `${view.winning ? `<h3>每人最终支付</h3><table class="payment-table"><thead><tr><th>玩家</th><th>基础点数</th><th>本场加点</th><th>最终支付</th></tr></thead><tbody>${view.rows.map((r) => `<tr><th>${esc(r.name)}</th><td>${num(r.base)}</td><td>+${num(r.bonus)}</td><td><b>${num(r.total)}</b></td></tr>`).join("")}</tbody></table>${view.transfers.map((t) => `<p class="payment-transfer">${esc(t.fromName)} → ${esc(t.toName)}：${num(t.base)} + ${num(t.bonus)} = <b>${num(t.total)}</b></p>`).join("")}${view.potIncome ? `<p>供托收入：${num(view.potIncome)} 点</p>` : ""}` : ""}<h3>本局收支</h3>${view.rows.map((r) => `<div class="line"><span>${esc(r.name)}${r.riichi ? ` · 立直支出 ${num(r.riichi)}` : ""}</span><b class="${r.positive ? "positive" : "negative"}">${r.value > 0 ? "+" : ""}${num(r.value)}</b></div>`).join("")}<div class="next-round">${view.next.finished?"记分后：本场结束，查看总成绩":"记分后："+roundLabel(view.next.hand, room.rules.players)+" · <b>"+view.next.honba+" 本场</b><br>"+esc(view.next.dealerName)+" · "+view.next.label}</div>`;
    $("#record-form [data-submit]").disabled = false;
  } catch (e) {
    $("#preview").textContent = e.message;
    $("#record-form [data-submit]").disabled = true;
  }
}
function readEvent() {
  const kind = recordKind,
    riichi = [...document.querySelectorAll('[data-riichi-seat][aria-pressed="true"]')].map((x) =>
      Number(x.dataset.riichiSeat),
    );
  if (kind === "draw")
    return {
      kind,
      riichi,
      tenpai: [...document.querySelectorAll('[data-tenpai-seat][aria-pressed="true"]')].map((x) =>
        Number(x.dataset.tenpaiSeat),
      ),
    };
  if (kind === "abort") return { kind, riichi };
  if (!ronWinners.size) throw Error("请选择和牌玩家");
  if (kind === "win") throw Error("请选择自摸或荣和");
  if (kind === "tsumo" && ronWinners.size !== 1) throw Error("自摸只能选择一人");
  if (kind === "ron" && recordLoser < 0) throw Error("请选择放铳玩家");
  const winners = [...document.querySelectorAll(".winner")]
    .filter((el) => ronWinners.has(Number(el.dataset.seat)))
    .map((el) => ({
      seat: Number(el.dataset.seat),
      han: Number(el.dataset.han),
      fu: Number(el.dataset.fu),
      yakuman: Number(el.querySelector(".yakuman").value),
    }));
  return {
    kind: "win",
    method: kind,
    winners,
    riichi,
    ...(kind === "ron" ? { loser: recordLoser } : {}),
  };
}
renderQuick();
tab("room");
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
      remember(await api(`/api/rooms/${id}${followRoom?"?follow=1":""}`));
      tab("room");
    } catch {
      localStorage.removeItem("riichi-room");
      renderRoom();
    }
  }
});
let refreshingRoom=false;
async function refreshActiveRoom(){
  if(!room||busy||refreshingRoom||$("#modal").open||document.hidden)return;
  const id=room.id,follow=followRoom;
  refreshingRoom=true;
  try{
    const latest=await api(`/api/rooms/${id}${follow?"?follow=1":""}`);
    if(room?.id!==id||followRoom!==follow)return;
    if(latest.id!==id||latest.version>room.version)remember(latest,follow);
  }catch(e){
    if(e.status===404&&room?.id===id){room=null;localStorage.removeItem("riichi-room");past=await api("/api/rooms");renderRoom();}
  }finally{refreshingRoom=false;}
}
setInterval(refreshActiveRoom,2000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshActiveRoom();});
window.addEventListener("focus",refreshActiveRoom);

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
    `<div class="fu-summary fu-result" aria-live="polite">${r ? `<div><strong>${r.fu}符</strong><p>${r.raw}符 · ${fuForm.special === "normal" ? "向上取整" : "固定符数"}</p></div><button id="use-fu" class="primary">用这个符数查点</button>` : esc(error)}</div><div class="grid"><div class="card"><h2>选择牌型</h2>${choices(
      "method",
      [
        ["ron", "荣和"],
        ["tsumo", "自摸 +2符"],
      ],
    )}${choices("closed", [
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
                `<div class="fu-meld"><h3>第${i+1}组</h3><div class="choice-grid">${[["openTriplet","明刻 2/4符"],["closedTriplet","暗刻 4/8符"],["openKan","明杠 8/16符"],["closedKan","暗杠 16/32符"]].map(([value,label])=>`<button data-meld="${i}" data-value="${value}" class="${m.type===value?'selected':''}" aria-pressed="${m.type===value}">${label}</button>`).join("")}</div><div class="choice-row"><button data-terminal="${i}" data-value="false" class="${!m.terminal?'selected':''}" aria-pressed="${!m.terminal}">中张 · 二至八</button><button data-terminal="${i}" data-value="true" class="${m.terminal?'selected':''}" aria-pressed="${m.terminal}">幺九牌／字牌</button><button data-remove="${i}">移除这组</button></div></div>`,
            )
            .join(
              "",
            )}<button id="add-meld" ${fuForm.melds.length === 4 ? "disabled" : ""}>添加刻子 / 杠子</button>`
        : ""
    }</div><div class="card"><h2>符数明细</h2>${r ? `${r.items.map((x) => `<div class="line"><span>${x.label}</span><strong>+${x.value}符</strong></div>`).join("")}` : esc(error)}</div></div>`;
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
        (b.onclick = () => {
          fuForm.melds[Number(b.dataset.meld)].type = b.dataset.value;
          if (["openTriplet", "openKan"].includes(b.dataset.value))
            fuForm.closed = false;
          renderFu();
        }),
    );
  $("#fu")
    .querySelectorAll("[data-terminal]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          fuForm.melds[Number(b.dataset.terminal)].terminal = JSON.parse(b.dataset.value);
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
    mountAccountName($("#me"), { api, changed: accountNameChanged });
    $("#me-entry").onclick = () => {
      tab("room");
      renderRoom();
    };
    return;
  }
  const [p, s, games] = await Promise.all([
    api("/api/profile"),
    api("/api/stats?month=" + month),
    api("/api/rooms"),
  ]);
  $("#me").innerHTML =
    `<div class="card"><h2>${esc(p.name)} · 我的牌谱</h2><div class="counter month-counter"><button data-month-step="-1" aria-label="上个月">‹</button><output id="stats-month">${month}</output><button data-month-step="1" aria-label="下个月">›</button></div><div class="score-grid">${[
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
      )}</div><p class="monthly-summary">${esc(s.summary)}</p></div><div class="card"><h2>本月牌缘</h2><div class="fortune-grid"><div><h3>带福之人</h3><p>${s.best ? `${esc(s.best.name)} <strong class="positive">+${s.best.net.toLocaleString()}</strong>` : "还未遇到"}</p></div><div><h3>带负之人</h3><p>${s.worst ? `${esc(s.worst.name)} <strong class="negative">${s.worst.net.toLocaleString()}</strong>` : "还未遇到"}</p></div></div><p class="muted">与你同桌时的净收支</p></div><div class="card"><h2>同桌收支</h2>${s.best ? `<p>赢得最多 · ${esc(s.best.name)} <strong class="positive">+${s.best.net.toLocaleString()}</strong></p>` : ""}${s.worst ? `<p>输得最多 · ${esc(s.worst.name)} <strong class="negative">${s.worst.net.toLocaleString()}</strong></p>` : ""}${s.peers.map((p) => `<div class="line"><span>${esc(p.name)} · ${p.hands}局</span><strong class="${p.net >= 0 ? "positive" : "negative"}">${p.net >= 0 ? "+" : ""}${p.net.toLocaleString()}</strong></div>`).join("") || "<p>这个月还没有牌局</p>"}</div>`;
  mountAccountName($("#me"), { name: p.name, api, changed: accountNameChanged });
  const historyCard = document.createElement("section");
  historyCard.className = "card game-history";
  historyCard.innerHTML = `<h2>对局历史记录</h2>${games.map(g=>`<div class="history-entry"><button class="history-game" data-history-room="${esc(g.id)}"><span class="line"><b>${g.players}人桌 · ${g.finished?"已结束":"进行中"}</b><strong class="${g.net>=0?"positive":"negative"}">${g.net>0?"+":""}${g.net.toLocaleString()} 点</strong></span><span class="history-names">${esc(g.names.join(" / "))}</span><span class="history-meta">${g.updatedAt?esc(new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(g.updatedAt)))+" · ":""}${g.hands}局记录 · 查看牌谱 →</span></button></div>`).join("") || '<p class="empty">还没有对局记录，开桌或扫码入桌后会显示在这里。</p>'}`;
  $("#me").append(historyCard);
  historyCard.querySelectorAll("[data-history-room]").forEach(b=>b.onclick=()=>task(async()=>{
    remember(await api("/api/rooms/"+b.dataset.historyRoom), false);
    tab("room");
  }));
  $("#me").querySelectorAll("[data-month-step]").forEach(b=>b.onclick=()=>task(()=>{const [year,m]=month.split("-").map(Number);const d=new Date(Date.UTC(year,m-1+Number(b.dataset.monthStep),1));return renderMe(d.toISOString().slice(0,7));}));
}

async function accountNameChanged(profile) {
  user = { name: profile.name };
  past = await api("/api/rooms");
  const id = localStorage.getItem("riichi-room");
  if (id && past.some(r => r.id === id)) remember(await api("/api/rooms/" + id));
  else { room = null; localStorage.removeItem("riichi-room"); renderRoom(); }
  await renderMe();
}
