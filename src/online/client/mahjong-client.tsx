"use client";
import { mahjongTerm } from "../../yaku.js";
import {acceptedRoundOpening,openingTileCount,openingKey,isOpeningGame} from "../domain/round-opening";
import {handRack,validOpeningDeal} from "./hand-rack";
import {useOpeningSort} from "./use-opening-sort";
import {useRoundOpening} from "./use-round-opening";

import {blankTableAction} from "./blank-table-action";
import {useHandHover} from "./use-hand-hover";
import {TableclothPicker, useTablecloth} from "./tablecloth";
import {useDoraSheenClock} from "./use-dora-sheen-clock";
import {useBlankTableDoubleTap} from "./use-blank-table-double-tap";
import {useAutomaticPlay} from "./use-automatic-play";
import {tableSpace, tablePoint, tableDelta, tableRect, type TableSpace} from "./table-space";
import {useMahjongActionPlacement} from "./use-action-placement";
import {WaitPeekButton} from "./wait-peek-button";
import {currentWaits,discardWaits,singleDiscardWaits} from "./discard-waits";
import { MahjongFinalRanking } from "./mahjong-final-ranking";

import { MahjongCallOption } from "./mahjong-call-option";

import Link from "./link";
import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight, Check, CircleHelp, Clock3, Copy, Crown, Dices, DoorOpen, Expand, LoaderCircle, Radio, RefreshCw, Sparkles, Swords, Smartphone, Volume2, VolumeX, Wifi, WifiOff, X } from "lucide-react";

import { apiRequest, errorMessage, asset } from "./api-client";
import { SessionProvider, useSession } from "./session";
import type { Choice, GameMode, GameVariant, GameView, MahjongCommand, MahjongResponse, PublicPlayer, RoomMember, RoomView } from "../domain/types";
import { usePublicCallMotion } from "./use-public-call-motion";
import { DiscardFlightLayer, measureDiscardElement, useDiscardMotion } from "./use-discard-motion";
import { useNukiMotion } from "./use-nuki-motion";
import { useHandReflow } from "./use-hand-reflow";
import type { DiscardMotionIntent } from "./discard-motion";
import { MahjongRules } from "./mahjong-rules";
import { TileFace, tileKey, tileName, tileMatchKey, indicatorBonus, visibleDoraFamilies } from "./mahjong-tile";
import { MahjongRiver as River } from "./mahjong-river";
import { MahjongMeld as MeldView } from "./mahjong-meld";
import { useTableAudio, type TableAudioControls } from "./use-table-audio";
import { useTableScreen } from "./use-table-screen";
import { useTableFeedback } from "./use-table-feedback";
import { MahjongAbortAnnouncements } from "./mahjong-abort-announcements";
import { MahjongDeclarations } from "./mahjong-declarations";
import { MahjongYakumanOpportunity } from "./mahjong-yakuman-opportunity";
import { MahjongCallAnnouncement } from "./mahjong-call-announcement";
import { MahjongStandingTile } from "./mahjong-standing-tile";
import { useDrawArrival } from "./use-draw-arrival";
import { settlementTitle } from "./mahjong-winning-hand";
import { MahjongSettlementPanel } from "./mahjong-settlement-panel";
import { useDrawResultLead } from "./use-draw-result-lead";
import { useSettlementPresentation } from "./use-settlement-presentation";
import { drawRevealAt } from "./settlement-presentation";
import { winningHand } from "./mahjong-winning-hand";
import { MahjongFaceUpFlightTile } from "./mahjong-solid-flight-tile";

const windNames = ["東", "南", "西", "北"];
const choiceNames: Record<Choice["type"], string> = {
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
type CommandInput = MahjongCommand extends infer Command
  ? Command extends { nonce: string }
    ? Omit<Command, "nonce" | "roomId">
    : never
  : never;

function roundTitle(game: GameView) {
  return `${windNames[game.roundWind] || "東"}${game.roundNumber} 局`;
}

function phaseTitle(game: GameView) {
  if (game.settlementFlow?.stage === "scores") return "分数结算";
  if (game.settlement) return game.settlement.kind === "win" ? "和了结算" : "流局结算";
  const labels: Record<string, string> = {
    zimo: "摸牌",
    gangzimo: "杠后摸牌",
    dapai: "等待回应",
    fulou: "鸣牌后出牌",
    gang: "抢杠判断",
    hule: "确认和了",
    pingju: "确认流局",
    jieju: "本场结束",
  };
  return labels[game.phase] || "牌局进行中";
}

function MahjongRoot() {
  const { session, loading: sessionLoading, error: sessionError, refreshSession } = useSession();
  const [response, setResponse] = useState<MahjongResponse | null>(null);
  const [nickname, setNickname] = useState("");
  const [variant, setVariant] = useState<GameVariant>("yonma");
  const [showRules, setShowRules] = useState(false);
  const [mode, setMode] = useState<GameMode>("east");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [choiceRecoveryEpoch, setChoiceRecoveryEpoch] = useState(0);
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [motionCanAnimate, setMotionCanAnimate] = useState(false);
  const [openingIntent,setOpeningIntent]=useState<string|null>(null);
  const [motionIntent, setMotionIntent] = useState<DiscardMotionIntent | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const finishDialog = useRef<HTMLDialogElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketHasBaseline = useRef(false);
  const latestMotionIntent = useRef<DiscardMotionIntent | null>(null);
  const responseRef = useRef<MahjongResponse | null>(null);
  const responseRevision = useRef(0);
  const getSequence = useRef(0);
  const pendingMutation = useRef<number | null>(null);
  const failedChoiceRecovery = useRef<{
    roomId: string; gameInstanceId: GameView["gameInstanceId"]; handId: GameView["handId"];
    ownSeat: number; decisionId: string; choiceId: string;
  } | null>(null);
  const [socketEpoch, setSocketEpoch] = useState(0);
  const room = response?.room || null;
  const isMember = session?.user.role === "member";
  const soundRootRef=useRef<HTMLDivElement>(null);
  const tableAudio=useTableAudio({room,connected,canAnimate:motionCanAnimate,rootRef:soundRootRef});

  const applyResponse = useCallback((next: MahjongResponse, expectedRevision?: number, motion: { canAnimate: boolean; intent?: DiscardMotionIntent | null } = { canAnimate: false }) => {
    if (expectedRevision !== undefined && expectedRevision !== responseRevision.current) return false;
    const current = responseRef.current;
    if (current?.room && next.room?.id === current.room.id && next.room.version < current.room.version) return false;
    const sameMotionSnapshot = Boolean(current?.room && next.room
      && current.room.id === next.room.id
      && current.room.version === next.room.version
      && current.room.game?.gameInstanceId === next.room.game?.gameInstanceId
      && current.room.game?.handId === next.room.game?.handId);
    // A different membership retires the old stream immediately, before React runs effect cleanup.
    if ((current?.room?.id ?? null) !== (next.room?.id ?? null)) {
      const oldSocket = socketRef.current;
      socketRef.current = null;
      oldSocket?.disconnect();
      setConnected(false);
      setSocketEpoch(epoch => epoch + 1);
    }
    const opening=next.room ? acceptedRoundOpening(current?.room??null,next.room,motion.canAnimate) : null;
    if(opening) setOpeningIntent(opening);
    else if(!sameMotionSnapshot && (!motion.canAnimate || current?.room?.game?.decisionId!==next.room?.game?.decisionId)) setOpeningIntent(null);
    responseRef.current = next;
    const failed = failedChoiceRecovery.current;
    if (failed && pendingMutation.current === null) {
      // Only accepted authoritative snapshots consume this marker; failed/stale reads retain it.
      failedChoiceRecovery.current = null;
      const recovered = next.room;
      if (recovered?.id === failed.roomId
        && recovered.game?.gameInstanceId === failed.gameInstanceId
        && recovered.game?.handId === failed.handId
        && recovered.mySeat === failed.ownSeat
        && recovered.game?.decisionId === failed.decisionId
        && recovered.game.choices.some(choice => choice.id === failed.choiceId)) {
        setChoiceRecoveryEpoch(epoch => epoch + 1);
      }
    }
    responseRevision.current++;
    setResponse(next);
    if (!sameMotionSnapshot) {
      setMotionCanAnimate(motion.canAnimate);
      setMotionIntent(motion.intent ?? null);
    }
    return true;
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    const revision = responseRevision.current;
    const sequence = ++getSequence.current;
    const isCurrent = () => revision === responseRevision.current && sequence === getSequence.current && pendingMutation.current === null;
    try {
      const next = await apiRequest<MahjongResponse>("/api/mahjong", { method: "GET" });
      if (!isCurrent()) return;
      if (applyResponse(next, revision)) {
        if (!quiet) setNotice("");
        return next;
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (!quiet) setNotice(errorMessage(error));
      if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) void refreshSession();
    }
  }, [applyResponse, refreshSession]);

  useEffect(() => {
    if (!session || !isMember) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      responseRevision.current++;
      window.clearInterval(interval);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, isMember, refresh]);

  useEffect(() => {
    if (!response?.serviceRunning || !session || !isMember) {
      const oldSocket = socketRef.current;
      socketRef.current = null;
      oldSocket?.disconnect();
      socketHasBaseline.current = false;
      setConnected(false);
      setMotionCanAnimate(false);
      return;
    }
    const socket = io({ path: asset("/online/socket.io"), addTrailingSlash: false, transports: ["websocket", "polling"], tryAllTransports: true, reconnection: true, reconnectionDelayMax: 4_000 });
    socketRef.current = socket;
    const isCurrent = () => socketRef.current === socket;
    let transportReady = false;
    socket.on("connect", () => {
      if (!isCurrent()) return;
      transportReady = true;
      socketHasBaseline.current = false;
      setMotionCanAnimate(false);
      setConnected(false);
      void refresh(true);
    });
    socket.on("disconnect", () => { if (isCurrent()) { transportReady = false; socketHasBaseline.current = false; setConnected(false); setMotionCanAnimate(false); } });
    socket.on("connect_error", () => { if (isCurrent()) { transportReady = false; socketHasBaseline.current = false; setConnected(false); setMotionCanAnimate(false); } });
    socket.on("mahjong:state", (next: MahjongResponse) => {
      if (!isCurrent() || !transportReady) return;
      const accepted = applyResponse(next, undefined, { canAnimate: socketHasBaseline.current, intent: latestMotionIntent.current });
      if (!accepted || !isCurrent()) return;
      socketHasBaseline.current = true;
      if (isCurrent()) setConnected(true);
    });
    socket.on("mahjong:error", (payload: { message?: string }) => {
      if (!isCurrent()) return;
      setNotice(payload.message || "实时牌局连接暂时中断，正在恢复。");
      void refresh(true);
    });
    return () => {
      if (isCurrent()) socketRef.current = null;
      socket.disconnect();
    };
  }, [response?.serviceRunning, session, isMember, refresh, applyResponse, socketEpoch]);

  useEffect(() => {
    if (!confirmFinish || !finishDialog.current) return;
    const dialog = finishDialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [confirmFinish]);

  const send = useCallback(async (command: CommandInput, motionIntent: DiscardMotionIntent | null = null) => {
    const roomIdRequired = command.action !== "create" && command.action !== "join";
    const roomId = room?.id;
    if (roomIdRequired && !roomId) {
      setNotice("请先进入牌桌，再进行操作。");
      return;
    }
    if (pendingMutation.current !== null) return;
    const revision = ++responseRevision.current;
    pendingMutation.current = revision;
    failedChoiceRecovery.current = null;
    latestMotionIntent.current = motionIntent;
    let reconcile = false;
    setBusy(true);
    setNotice("");
    try {
      const next = await apiRequest<MahjongResponse>("/api/mahjong", {
        method: "POST",
        body: JSON.stringify({ ...command, ...(roomIdRequired ? { roomId } : {}), nonce: crypto.randomUUID() }),
      });
      // Socket delivery may already have observed this command or a later membership.
      reconcile = !applyResponse(next, revision, { canAnimate: true, intent: motionIntent });
    } catch (error) {
      if (responseRevision.current === revision) setNotice(errorMessage(error));
      if (command.action === "respond" && room?.game) {
        failedChoiceRecovery.current = {
          roomId: room.id, gameInstanceId: room.game.gameInstanceId, handId: room.game.handId,
          ownSeat: room.mySeat, decisionId: command.decisionId, choiceId: command.choiceId,
        };
      }
      reconcile = true;
    } finally {
      pendingMutation.current = null;
      setBusy(false);
      // Re-read after completion rather than guessing whether a delayed POST is newer than a socket.
      if (reconcile) await refresh(true);
    }
  }, [room, refresh, applyResponse]);

  const closeRoom = () => {
    setConfirmFinish(false);
    void send({ action: "finish" });
  };

  if (sessionLoading) {
    return <main className={`mahjong-page${room?.game ? "" : " mahjong-paper"}`}><div className="mahjong-loading"><LoaderCircle size={22} className="mahjong-spin"/><span>正在准备牌桌…</span></div></main>;
  }
  if (!session) return <main className="mahjong-page mahjong-paper"><div className="mahjong-entry"><h1>联机牌桌</h1><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await apiRequest('/api/session',{method:'POST',body:JSON.stringify({name:nickname})});await refreshSession();}catch(e){setNotice(errorMessage(e));}finally{setBusy(false);}}}><label>你的昵称<input value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={24} required autoComplete="nickname" /></label><button disabled={busy} type="submit">进入牌桌</button></form><p role="alert">{notice}</p><Link href={asset("/")}>返回日麻记分</Link></div></main>;
  if (!isMember) return <main className="mahjong-page" />;
  if (!response) return <main className="mahjong-page"><div className="mahjong-loading"><span>{notice || "牌桌暂时无法连接。"}</span><button className="mahjong-button mahjong-button--gold" type="button" onClick={() => void refresh()}>重新加载</button></div></main>;

  const ownSeat = room?.mySeat ?? -1;
  const host = Boolean(room && session && room.hostUserId === session.user.id);

  return <main className={`mahjong-page${room?.game ? "" : " mahjong-paper"}`}>
    <div className="mahjong-shell" ref={soundRootRef}>
      <header className="mahjong-header">
        <Link href={asset("/")} className="mahjong-brand" aria-label="返回日麻记分"><span className="mahjong-brand__mark"><Dices size={17}/></span><span>日麻记分 <i>/</i> 联机牌桌</span></Link>
        <button type="button" className="mahjong-rules-trigger" onClick={event => { event.currentTarget.focus(); setShowRules(true); }}><CircleHelp size={14}/>查看规则</button>
        <div className={`mahjong-link-state${connected ? " is-connected" : response.serviceRunning ? " is-reconnecting" : ""}`} role="status">
          {connected ? <><Wifi size={14}/>实时同步</> : response.serviceRunning ? <><WifiOff size={14}/>正在恢复连接</> : <><Radio size={14}/>等待开桌</>}
        </div>
      </header>

      {notice || sessionError ? <div className="mahjong-notice" role="alert"><CircleHelp size={16}/><span>{notice || sessionError}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={16}/></button></div> : null}

      {!room ? <Lobby
        mode={mode}
        variant={variant}
        onVariant={setVariant}
        busy={busy}
        joinCode={joinCode}
        onMode={setMode}
        onJoinCode={(value) => setJoinCode(value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8))}
        onCreate={() => void send({ action: "create", mode, variant })}
        onJoin={() => void send({ action: "join", code: joinCode.trim().toUpperCase() })}
      /> : room.status === "lobby" ? <WaitingRoom
        room={room}
        busy={busy}
        host={host}
        ownSeat={ownSeat}
        onReady={(ready) => void send({ action: "ready", ready })}
        onStart={() => void send({ action: "start" })}
        onAddBot={(seat) => void send({ action: "add-bot", seat })}
        onRemoveBot={(seat) => void send({ action: "remove-bot", seat })}
        onFillBots={() => void send({ action: "fill-bots" })}
        onLeave={() => void send({ action: "leave" })}
        onFinish={() => setConfirmFinish(true)}
      /> : <GameRoom
        tableAudio={tableAudio}
        room={room}
        busy={busy}
        host={host}
        ownSeat={ownSeat}
        connected={connected}
        motionCanAnimate={motionCanAnimate}
        openingIntent={openingIntent}
        motionIntent={motionIntent}
        choiceRecoveryEpoch={choiceRecoveryEpoch}
        onChoice={(choice, intent) => room.game && void send({ action: "respond", decisionId: room.game.decisionId, choiceId: choice.id }, intent ?? null)}
        onFinish={() => setConfirmFinish(true)}
        onRules={() => setShowRules(true)}
        onRematch={() => void send({ action: "rematch" })}
        onLeave={() => void send({ action: "leave" })}
      />}

      <footer className="mahjong-footer">
        <span>全员离线 10 分钟或服务重启后，本局结束。</span>
      </footer>
    </div>

    {showRules ? <MahjongRules variant={room?.variant || variant} onClose={() => setShowRules(false)}/> : null}
    {confirmFinish ? <dialog ref={finishDialog} className="mahjong-confirm" aria-labelledby="mahjong-finish-title" onCancel={(event) => { event.preventDefault(); setConfirmFinish(false); }}>
      <div className="mahjong-confirm__seal"><DoorOpen size={20}/></div>
      <p className="mahjong-kicker">结束牌桌</p>
      <h2 id="mahjong-finish-title">确定解散这张牌桌？</h2>
      <p>解散后本局结束，牌局进度不会保存。</p>
      <div className="mahjong-confirm__actions"><button type="button" className="mahjong-button mahjong-button--quiet" onClick={() => setConfirmFinish(false)}>继续打牌</button><button type="button" className="mahjong-button mahjong-button--danger" disabled={busy} onClick={closeRoom}>{busy ? "正在解散…" : "解散牌桌"}</button></div>
    </dialog> : null}
  </main>;
}

export function MahjongClient() {
  return <SessionProvider requireHome={false}><MahjongRoot/></SessionProvider>;
}

function Lobby({ mode, variant, busy, joinCode, onMode, onVariant, onJoinCode, onCreate, onJoin }: {
  variant: GameVariant; onVariant: (variant: GameVariant) => void;
  mode: GameMode; busy: boolean; joinCode: string;
  onMode: (mode: GameMode) => void; onJoinCode: (value: string) => void; onCreate: () => void; onJoin: () => void;
}) {
  return <section className="mahjong-lobby">
    <div className="mahjong-lobby__copy">
      <p className="mahjong-kicker"><span/> {variant === "sanma" ? "三人" : "四人"}日麻</p>
      <h1>联机牌桌</h1>
      <p>邀请朋友，或让电脑补齐空位。</p>
      <div className="mahjong-lobby__facts"><span><Swords size={15}/>真人与电脑</span><span><Sparkles size={15}/>赤宝牌</span><span><Clock3 size={15}/>东风或半庄</span></div>
    </div>
    <div className="mahjong-lobby__panel">
      <div className="mahjong-panel-heading"><div><p className="mahjong-kicker">开桌</p><h2>开始一场新牌局</h2></div><span className="mahjong-panel-heading__icon"><Dices size={21}/></span></div>
      <fieldset className="mahjong-mode-picker mahjong-variant-picker" disabled={busy}>
        <legend>选择人数</legend>
        <button type="button" aria-label="三人" aria-pressed={variant === "sanma"} className={variant === "sanma" ? "is-selected" : ""} onClick={() => onVariant("sanma")}><strong>三人</strong><small>日本三麻 · 可拔北</small></button>
        <button type="button" aria-label="四人" aria-pressed={variant === "yonma"} className={variant === "yonma" ? "is-selected" : ""} onClick={() => onVariant("yonma")}><strong>四人</strong><small>日本四麻 · 经典牌桌</small></button>
      </fieldset>
      <fieldset className="mahjong-mode-picker" disabled={busy}>
        <legend>选择局长</legend>
        <button className={mode === "east" ? "is-selected" : ""} type="button" aria-pressed={mode === "east"} onClick={() => onMode("east")}><strong>东风战</strong><small>东场 · 可连庄</small></button>
        <button className={mode === "hanchan" ? "is-selected" : ""} type="button" aria-pressed={mode === "hanchan"} onClick={() => onMode("hanchan")}><strong>半庄战</strong><small>完整 · 南场结束</small></button>
      </fieldset>
      <button className="mahjong-button mahjong-button--gold mahjong-create" type="button" disabled={busy} onClick={onCreate}>{busy ? <LoaderCircle size={17} className="mahjong-spin"/> : <Sparkles size={17}/>}创建{variant === "sanma" ? "三人" : ""}{mode === "east" ? "东风" : "半庄"}牌桌<ArrowRight size={17}/></button>
      <div className="mahjong-divider"><span>或者加入朋友的牌桌</span></div>
      <label className="mahjong-code-label" htmlFor="mahjong-join-code">输入 8 位房间码</label>
      <div className="mahjong-join-form"><input id="mahjong-join-code" inputMode="text" autoComplete="off" maxLength={8} value={joinCode} onChange={(event) => onJoinCode(event.target.value)} placeholder="例：N7K4Q2TP"/><button type="button" aria-label="加入牌桌" disabled={busy || joinCode.length !== 8} onClick={onJoin}>{busy ? <LoaderCircle size={17} className="mahjong-spin"/> : <ArrowRight size={17}/>}</button></div>
      <p className="mahjong-panel-note">创建牌桌后，把房间码分享给朋友。</p>
    </div>
  </section>;
}

function WaitingRoom({ room, busy, host, ownSeat, onReady, onStart, onAddBot, onRemoveBot, onFillBots, onLeave, onFinish }: {
  room: RoomView; busy: boolean; host: boolean; ownSeat: number;
  onAddBot: (seat: number) => void; onRemoveBot: (seat: number) => void; onFillBots: () => void;
  onReady: (ready: boolean) => void; onStart: () => void; onLeave: () => void; onFinish: () => void;
}) {
  const capacity = room.variant === "sanma" ? 3 : 4;
  const roomSeats = Array.from({ length: capacity }, (_, seat) => room.members.find((member) => member.seat === seat) || null);
  const readyCount = room.members.filter((member) => member.ready).length;
  const mine = room.members.find((member) => member.seat === ownSeat);
  return <section className="mahjong-waiting">
    <div className="mahjong-room-header"><div><p className="mahjong-kicker">{room.variant === "sanma" ? "三人日麻" : "四人日麻"} · {room.mode === "east" ? "东风战" : "半庄战"}</p><h1>等朋友坐下</h1><p>{capacity === 3 ? "三人" : "四人"}牌桌 · 分享房间码邀请朋友，或添加电脑补位。</p></div><div className="mahjong-room-code"><span>房间码</span><strong data-testid="mahjong-room-code">{room.code}</strong><button type="button" aria-label="复制房间码" onClick={() => void navigator.clipboard?.writeText(room.code)}><Copy size={14}/></button></div></div>
    <div className={`mahjong-seat-grid${capacity === 3 ? " is-sanma" : ""}`} aria-label="牌桌座位">
      {roomSeats.map((member, seat) => <SeatCard key={seat} member={member} seat={seat} isMe={seat === ownSeat} waiting busy={busy} onAddBot={host ? () => onAddBot(seat) : undefined} onRemoveBot={host ? () => onRemoveBot(seat) : undefined} />)}
    </div>
    <div className="mahjong-waiting__bottom"><div className="mahjong-ready-count"><span className="mahjong-ready-count__ring"><span>{readyCount}</span>/{capacity}</span><div><strong>{readyCount === capacity ? `${capacity === 3 ? "三" : "四"}家已齐` : `还差 ${capacity - readyCount} 位准备`}</strong><small>全部准备后，房主可以开始</small></div></div><div className="mahjong-waiting__actions">
      {host && room.members.length < capacity ? <button type="button" className="mahjong-button mahjong-button--quiet" disabled={busy} onClick={onFillBots}>电脑补齐空位</button> : null}
      {mine ? <button className={`mahjong-button ${mine.ready ? "mahjong-button--quiet" : "mahjong-button--gold"}`} type="button" disabled={busy} onClick={() => onReady(!mine.ready)}>{mine.ready ? <><Check size={17}/>已准备 · 点击取消</> : <><Check size={17}/>准备好了</>}</button> : null}
      {host ? <button className="mahjong-button mahjong-button--start" type="button" disabled={busy || readyCount !== capacity || room.members.length !== capacity} onClick={onStart}>开始对局<ArrowRight size={17}/></button> : <span className="mahjong-host-note"><Crown size={14}/>等待房主开始</span>}
      <button className="mahjong-icon-button" type="button" aria-label="解散牌桌" disabled={busy || !host} title={host ? "解散牌桌" : "仅房主可解散"} onClick={onFinish}><X size={17}/></button>
      {!host ? <button className="mahjong-button mahjong-button--quiet" type="button" disabled={busy} onClick={onLeave}>离开</button> : null}
    </div></div>
  </section>;
}

function SeatCard({ member, seat, isMe, waiting = false, player, active = false, busy = false, onAddBot, onRemoveBot }: {
  member?: RoomMember | null; seat: number; isMe: boolean; waiting?: boolean; player?: PublicPlayer; active?: boolean; busy?: boolean; onAddBot?: () => void; onRemoveBot?: () => void;
}) {
  const wind = player?.wind ?? seat;
  return <article className={`mahjong-seat-card${member ? " is-occupied" : ""}${isMe ? " is-self" : ""}${active ? " is-active" : ""}${waiting ? " is-waiting" : ""}`} data-testid={waiting ? `mahjong-seat-${seat}` : `mahjong-player-${seat}`} data-turn={active ? "true" : "false"}>
    <span className="mahjong-seat-card__wind">{windNames[wind] || windNames[seat]}家</span>
    <span className="mahjong-seat-card__avatar">{member?.displayName.slice(0, 1) || (player ? "牌" : "＋")}</span>
    <span className="mahjong-seat-card__identity"><strong>{member?.displayName || (player ? "牌友" : "等一位牌友")}{isMe ? <small>我</small> : null}</strong><span>{player ? `${player.score.toLocaleString()} 点` : member ? "已入座" : "房间开放中"}</span></span>
    {member ? <span className={`mahjong-seat-card__ready${member.ready ? " is-ready" : ""}`}>{member.kind === "bot" ? <><Check size={12}/>电脑 · 自动准备</> : member.ready ? <><Check size={12}/>已准备</> : waiting ? "等待准备" : member.connected ? "在线" : "暂时离线"}</span> : null}
    {waiting && !member && onAddBot ? <button type="button" className="mahjong-seat-bot-button" disabled={busy} onClick={onAddBot}>添加电脑</button> : null}
    {waiting && member?.kind === "bot" && onRemoveBot ? <button type="button" className="mahjong-seat-bot-button" disabled={busy} onClick={onRemoveBot}>移除电脑</button> : null}
    {player?.riichi ? <span className="mahjong-seat-card__riichi">立直</span> : null}
  </article>;
}

export function GameRoom({ tableAudio, room, busy, host, ownSeat, connected, motionCanAnimate = connected, openingIntent = null, motionIntent = null, choiceRecoveryEpoch = 0, onChoice, onFinish, onRules, onRematch, onLeave }: {
  tableAudio?: TableAudioControls;
  onRules?: () => void;
  room: RoomView; busy: boolean; host: boolean; ownSeat: number; connected: boolean;
  motionCanAnimate?: boolean; openingIntent?: string|null; motionIntent?: DiscardMotionIntent | null; choiceRecoveryEpoch?: number;
  onChoice: (choice: Choice, intent?: DiscardMotionIntent | null) => void; onFinish: () => void; onRematch: () => void; onLeave: () => void;
}) {
  const game = room.game;
  const opening=useRoundOpening({room,ownSeat,connected,intent:openingIntent});
  const liveOpening=Boolean(game)&&openingIntent===openingKey(room,ownSeat)&&isOpeningGame(game,room.variant);
  const rack=game?handRack(game,opening.age,liveOpening):[];
  const lastRackTile=rack.at(-1);
  const lastDiscardValue=lastRackTile?lastRackTile.value+(lastRackTile.logicalDraw?"_":""):undefined;
  const openingRack=useOpeningSort(opening.age,JSON.stringify([room.id,ownSeat,game?.gameInstanceId,game?.handId,game?.decisionId]),connected);
  useDoraSheenClock(connected && room.status === "playing" && Boolean(game));
  const tableScreen = useTableScreen(Boolean(game));
  const tablecloth = useTablecloth();
  const feedback = useTableFeedback(game, room.members, ownSeat, room.id, {connected, canAnimate: motionCanAnimate});
  const [inspectedSeat, setInspectedSeat] = useState<number | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [pendingCallType, setPendingCallType] = useState<Choice["type"] | null>(null);
  const pendingCallTrigger = useRef<HTMLButtonElement>(null);
  const [selectedHandTile, setSelectedHandTile] = useState<{ tileId: string; choiceId: string } | null>(null);
  const [hoveredChoiceId, setHoveredChoiceId] = useState<string | null>(null);
  const [showCurrentWaits, setShowCurrentWaits] = useState(false);
  const currentHandWaits = useMemo(() => game ? currentWaits(game, ownSeat, room.variant) : [], [game, ownSeat, room.variant]);
  const singleDiscardPeek = useMemo(() => game ? singleDiscardWaits(game,ownSeat,room.variant,riichiMode ? "riichi" : "discard") : [], [game,ownSeat,room.variant,riichiMode]);
  const waitCache = useMemo(() => new Map<string, ReturnType<typeof discardWaits>>(), [game, ownSeat, room.variant]);
  useEffect(() => { setHoveredChoiceId(null); setShowCurrentWaits(false); }, [game?.decisionId, room.id, ownSeat, riichiMode, connected, busy]);
  const [dragPreview, setDragPreview] = useState<{ tileId: string; x: number; y: number } | null>(null);
  const [overDiscardTarget, setOverDiscardTarget] = useState(false);
  const [choiceSubmitted, setChoiceSubmitted] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const audioRootRef = useRef<HTMLElement>(null);
  useMahjongActionPlacement(audioRootRef,Boolean(game)&&room.status!=="finished",`${room.id}:${room.variant}:${ownSeat}:${game?.decisionId}:${room.version}:${riichiMode}:${pendingCallType}:${tableScreen.rotated}`);

  const audio = useTableAudio({room,connected,canAnimate:motionCanAnimate,rootRef:audioRootRef,shared:tableAudio});
  const dealtSound=useRef<string|null>(null);
  useEffect(()=>{
    if(opening.age===null||opening.age>=1200)return;
    const wave=Math.floor(opening.age/300),id=JSON.stringify([openingIntent,wave]);
    if(dealtSound.current===id)return;dealtSound.current=id;
    if(opening.age-wave*300<100)audio.dealWave(id,ownSeat);
  },[opening.age,openingIntent,ownSeat,audio.dealWave]);
  const nukiMotion = useNukiMotion({room, ownSeat, connected, canAnimate: motionCanAnimate, tableRef});
  const publicCallMotion = usePublicCallMotion({room, ownSeat, connected, canAnimate: motionCanAnimate, tableRef});
  const drawArrival = useDrawArrival(game, room.id, ownSeat, {connected, canAnimate: motionCanAnimate, heldDecisionId: nukiMotion.heldDecisionId});
  const automatic = useAutomaticPlay({room,ownSeat,connected,lastDiscardValue,busy: opening.holding || busy || nukiMotion.heldDecisionId === game?.decisionId || drawArrival.arriving,onChoice: choice => {
    if (choice.type === "discard") {
      const source = [...(audioRootRef.current?.querySelectorAll<HTMLButtonElement>(".mahjong-hand button[data-choice-id]") ?? [])].filter(button => button.dataset.choiceId === choice.id).at(-1);
      if (source) { submitHandChoice(choice, source); return; }
    }
    onChoice(choice);
  }});
  const tableShortcut = useBlankTableDoubleTap({recoveryEpoch:choiceRecoveryEpoch,scope:JSON.stringify([room.id,ownSeat,game?.gameInstanceId,game?.decisionId,tableScreen.rotated]),disabled:opening.holding||busy||!connected||room.status!=="playing"||!game||Boolean(game.settlement)||nukiMotion.heldDecisionId===game?.decisionId||drawArrival.arriving,onDoubleTap:()=>{
    if (!game || submittedChoiceRef.current) return false;
    const action=blankTableAction(game,ownSeat,riichiMode,Boolean(pendingCallType),lastDiscardValue);
    if (!action) return false;
    automatic.manual();
    if (action.kind === "return-picker") { setPendingCallType(null); return false; }
    if (action.kind === "return-riichi") { setRiichiMode(false); return false; }
    if (action.kind !== "choice") return false;
    if (action.choice.type === "discard") {
      const source=[...(audioRootRef.current?.querySelectorAll<HTMLButtonElement>(".mahjong-hand button[data-choice-id]")??[])].filter(button=>button.dataset.choiceId===action.choice.id).at(-1);
      if (!source) return false;
      drawArrival.cancel();nukiMotion.cancel();
      submitHandChoice(action.choice,source);
    } else { setPendingCallType(null);publicCallMotion.cancel();onChoice(action.choice); }
    return true;
  }});
  const discardMotion = useDiscardMotion({ room, ownSeat, connected, canAnimate: motionCanAnimate, intent: motionIntent, tableRef });
  const finishDiscardAudio = useCallback((id:string)=>{audio.land(id);discardMotion.finishFlight(id);},[audio.land,discardMotion.finishFlight]);
  const finishCallAudio = useCallback((id:string)=>{audio.land(id);publicCallMotion.finishFlight(id);},[audio.land,publicCallMotion.finishFlight]);
  const finishNukiAudio = useCallback((id:string)=>{audio.land(id);nukiMotion.finishFlight(id);},[audio.land,nukiMotion.finishFlight]);
  const drawLead = useDrawResultLead(game, discardMotion.flight);
  const drawPresentation = useSettlementPresentation({flow: game?.settlementFlow?.stage === "draw" ? game.settlementFlow : undefined, settlement: game?.settlement ?? null, connected, busy, onChoice, leadInMs: drawLead});
  const revealedHands = game?.settlement?.drawInfo && (game.settlementFlow?.stage !== "draw" || drawPresentation.elapsed >= drawRevealAt(game.settlement)) ? game.settlement.drawInfo.revealedHands : [];
  const handReflow = useHandReflow({ room, ownSeat, connected, canAnimate: motionCanAnimate, intent: motionIntent, tableRef });
  useLayoutEffect(() => {
    const table = tableRef.current;
    // Hiding the completed table is a result transition, not a stale tile
    // geometry change. Disconnect before that resize can cancel ranking cues.
    if (room.status === "finished" || !table || typeof ResizeObserver === "undefined") return;
    let size: DOMRect | null = null;
    const observer = new ResizeObserver(() => {
      const next = table.getBoundingClientRect();
      // The initial observation establishes the fitted frame. It is not a
      // user resize and must not revoke an in-flight opening audio unlock.
      if (size && (Math.abs(next.width - size.width) > .5 || Math.abs(next.height - size.height) > .5)) { audio.invalidate(); drawArrival.cancel(); }
      size = next;
    });
    observer.observe(table);
    return () => observer.disconnect();
  }, [drawArrival.cancel, audio.invalidate, room.status]);
  const selectedHandTileRef = useRef<{ tileId: string; choiceId: string } | null>(null);
  const activeTilePointerRef = useRef<{ pointerId: number; tileId: string; choice: Choice; startX: number; startY: number; space: TableSpace | null; rackTop: number; dragged: boolean; element: HTMLButtonElement } | null>(null);
  const pressedHandChoiceRef = useRef<{tileId:string;choiceId:string;confirmed:boolean}|null>(null);
  const submittedChoiceRef = useRef(false);
  const suppressPointerClickRef = useRef(false);
  const wasBusyRef = useRef(busy);
  const clearHandSelection = useCallback(() => {
    pressedHandChoiceRef.current = null;
    selectedHandTileRef.current = null;
    setSelectedHandTile(null);
  }, []);
  const handHover = useHandHover({
    scope: JSON.stringify([room.id, ownSeat, game?.gameInstanceId, game?.decisionId, riichiMode, game?.choices.map(choice=>choice.id)]),
    disabled: opening.holding || busy || !connected || choiceSubmitted || room.status !== "playing" || Boolean(game?.settlement) || drawArrival.arriving || nukiMotion.heldDecisionId === game?.decisionId,
    onSelect: selection => { selectedHandTileRef.current=selection; setSelectedHandTile(selection); },
    onClear: clearHandSelection,
  });
  const hoverHandTile = (tileId: string | null, choice: Choice | null) => {
    setHoveredChoiceId(choice?.id ?? null);
    if (tileId && choice) handHover.enter({tileId,choiceId:choice.id});
    else handHover.leave();
  };
  useEffect(() => {
    const cancel = () => {
      const active = activeTilePointerRef.current;
      if (!active) return;
      activeTilePointerRef.current = null;
      suppressPointerClickRef.current = true;
      clearHandSelection();
      setDragPreview(null);
      setOverDiscardTarget(false);
      try { active.element.releasePointerCapture?.(active.pointerId); } catch { /* The browser may have already cancelled capture. */ }
    };
    const events = ["resize", "orientationchange", "fullscreenchange", "webkitfullscreenchange", "blur", "pagehide"];
    const visibilityChanged = () => { if (document.visibilityState === "hidden") cancel(); };
    document.addEventListener("visibilitychange", visibilityChanged);
    for (const event of events) window.addEventListener(event, cancel);
    const orientation = window.screen.orientation;
    orientation?.addEventListener?.("change", cancel);
    const table = tableRef.current;
    let size = table?.getBoundingClientRect();
    const observer = table && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
      const next = table.getBoundingClientRect();
      if (size && (Math.abs(next.width - size.width) > .5 || Math.abs(next.height - size.height) > .5)) cancel();
      size = next;
    }) : null;
    if (table) observer?.observe(table);
    return () => {
      for (const event of events) window.removeEventListener(event, cancel);
      document.removeEventListener("visibilitychange", visibilityChanged);
      orientation?.removeEventListener?.("change", cancel);
      observer?.disconnect();
    };
  }, [clearHandSelection, room.id, Boolean(game)]);
  useEffect(() => { setRiichiMode(false); setPendingCallType(null); }, [game?.decisionId, room.id]);
  useEffect(() => { if (!connected) { setPendingCallType(null); setRiichiMode(false); } }, [connected]);
  useEffect(() => {
    clearHandSelection();
    activeTilePointerRef.current = null;
    submittedChoiceRef.current = false;
    setChoiceSubmitted(false);
    setDragPreview(null);
    setOverDiscardTarget(false);
    suppressPointerClickRef.current = false;
  }, [clearHandSelection, game?.decisionId, room.id]);
  useEffect(() => {
    if (busy || !connected) {
      clearHandSelection();
      activeTilePointerRef.current = null;
      setDragPreview(null);
      setOverDiscardTarget(false);
    }
    if (wasBusyRef.current && !busy) {
      submittedChoiceRef.current = false;
      setChoiceSubmitted(false);
    }
    wasBusyRef.current = busy;
  }, [busy, connected, clearHandSelection]);

  const submitHandChoice = (choice: Choice, source: HTMLButtonElement) => {
    if (opening.holding || busy || !connected || submittedChoiceRef.current) return;
    publicCallMotion.cancel();
    handReflow.captureBeforeInput();
    submittedChoiceRef.current = true;
    setChoiceSubmitted(true);
    const sourceGeometry = measureDiscardElement(source);
    const intent: DiscardMotionIntent | null = (choice.type === "discard" || choice.type === "riichi")
      && game?.gameInstanceId && Number.isInteger(game.handId)
      && sourceGeometry
      ? {
        roomId: room.id,
        roomVersion: room.version,
        gameInstanceId: game.gameInstanceId,
        handId: game.handId!,
        decisionId: game.decisionId,
        seat: ownSeat,
        choiceId: choice.id,
        tileValue: choice.value || "",
        sourceTileId: source.dataset.handInstanceId || "",
        sourceRect: sourceGeometry.rect,
        sourceGeometry: sourceGeometry.geometry,
        sourcePaint: sourceGeometry.paint,
        environmentEpoch: discardMotion.environmentEpoch(),
      }
      : null;
    clearHandSelection();
    if (intent) onChoice(choice, intent);
    else onChoice(choice);
  };
  const activateHandTile = (tileId: string, choice: Choice, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (opening.holding || busy || !connected || submittedChoiceRef.current) return;
    handReflow.captureBeforeInput();
    drawArrival.cancel();
    const pressed = pressedHandChoiceRef.current;
    pressedHandChoiceRef.current = null;
    if (suppressPointerClickRef.current && event.detail > 0) {
      suppressPointerClickRef.current = false;
      return;
    }
    const selected = selectedHandTileRef.current;
    const confirmed = pressed ? pressed.tileId === tileId && pressed.choiceId === choice.id && pressed.confirmed : selected?.tileId === tileId && selected.choiceId === choice.id;
    if (confirmed) {
      submitHandChoice(choice, event.currentTarget);
      return;
    }
    const next = { tileId, choiceId: choice.id };
    selectedHandTileRef.current = next;
    setSelectedHandTile(next);
  };
  const startHandPointer = (tileId: string, choice: Choice, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (opening.holding || busy || !connected || submittedChoiceRef.current || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    handHover.press(event.pointerType);
    const selected = selectedHandTileRef.current;
    pressedHandChoiceRef.current = {tileId,choiceId:choice.id,confirmed:selected?.tileId===tileId && selected.choiceId===choice.id};
    drawArrival.cancel();
    suppressPointerClickRef.current = false;
    const space = audioRootRef.current ? tableSpace(audioRootRef.current) : null;
    const rackBounds = event.currentTarget.closest(".mahjong-hand")?.getBoundingClientRect();
    activeTilePointerRef.current = {
      pointerId: event.pointerId ?? 0, tileId, choice,
      startX: event.clientX, startY: event.clientY,
      space, rackTop: rackBounds ? (space ? tableRect(space, rackBounds).y : rackBounds.top) : Number.NaN,
      dragged: false, element: event.currentTarget,
    };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Pointer capture is unavailable in some embedded browsers. */ }
    handReflow.captureBeforeInput();
    // Freeze the unlifted rack and confirmation state before showing press feedback.
    const next = {tileId,choiceId:choice.id};
    selectedHandTileRef.current = next;
    setSelectedHandTile(next);
  };
  // Native hit testing follows the actual projected felt, rather than the
  // surface's axis-aligned bounding box. Freeze the rack boundary on press:
  // lifting or dragging its last tile must not move the release threshold.
  const isPlayableDiscardRelease = (active: NonNullable<typeof activeTilePointerRef.current>, clientX: number, clientY: number) => {
    const localY = active.space ? tablePoint(active.space, clientX, clientY).y : clientY;
    if (![active.rackTop, clientX, clientY, localY].every(Number.isFinite) || localY >= active.rackTop) return false;
    const surface = tableRef.current?.querySelector(".mahjong-table__surface");
    const target = document.elementFromPoint?.(clientX, clientY);
    return Boolean(surface && target && surface.contains(target)
      && !target.closest("button, a, input, select, textarea, [role='button'], .mahjong-opponent-rack, .mahjong-player__melds, .mahjong-hand-public-melds, .mahjong-nuki-tray"));
  };
  const moveHandPointer = (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeTilePointerRef.current;
    if (!active || active.tileId !== tileId || active.pointerId !== (event.pointerId ?? 0)) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    if (!active.dragged && dx * dx + dy * dy > 400) active.dragged = true;
    if (active.dragged) {
      const delta = active.space ? tableDelta(active.space, dx, dy) : {x: dx, y: dy};
      setDragPreview({ tileId, ...delta });
      setOverDiscardTarget(isPlayableDiscardRelease(active, event.clientX, event.clientY));
    }
  };
  const endHandPointer = (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeTilePointerRef.current;
    if (!active || active.tileId !== tileId || active.pointerId !== (event.pointerId ?? 0)) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    const dragged = active.dragged || dx * dx + dy * dy > 400;
    const landedInTable = isPlayableDiscardRelease(active, event.clientX, event.clientY);
    activeTilePointerRef.current = null;
    setDragPreview(null);
    setOverDiscardTarget(false);
    try { active.element.releasePointerCapture?.(event.pointerId); } catch { /* The pointer may already have been released. */ }
    if (!dragged) return;
    suppressPointerClickRef.current = true;
    window.setTimeout(() => { suppressPointerClickRef.current = false; }, 0);
    if (landedInTable) submitHandChoice(active.choice, active.element);
    else clearHandSelection();
  };
  const cancelHandPointer = (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeTilePointerRef.current;
    if (!active || active.tileId !== tileId || active.pointerId !== (event.pointerId ?? 0)) return;
    activeTilePointerRef.current = null;
    // Lost capture may precede a later click, even below the drag threshold.
    // Suppress it until the next press and clear any earlier tile selection.
    suppressPointerClickRef.current = true;
    clearHandSelection();
    setDragPreview(null);
    setOverDiscardTarget(false);
    try { active.element.releasePointerCapture?.(event.pointerId); } catch { /* Cancellation already released the pointer. */ }
  };
  if (!game) return <section className="mahjong-empty-game"><LoaderCircle size={20} className="mahjong-spin"/>正在载入牌局…</section>;
  const isFinished = room.status === "finished";
  const capacity = game.players.length;
  const relativeSeat = (seat: number) => (seat - ownSeat + capacity) % capacity;
  const byRelative = (offset: number) => game.players.find((player) => relativeSeat(player.seat) === offset);
  const ownPlayer = game.players.find((player) => player.seat === ownSeat);
  const fullOpeningSorted=liveOpening&&validOpeningDeal(game)&&rack.length===14&&(opening.age===null||opening.age>=1200);
  const discardChoices = game.choices.filter((choice) => choice.type === "discard");
  const riichiChoices = game.choices.filter((choice) => choice.type === "riichi");
  const otherChoices = game.choices.filter((choice) => !["discard", "riichi"].includes(choice.type));
  const tsumoChoice = otherChoices.find(choice => choice.type === "tsumo");
  const callGroups = new Map<Choice["type"], Choice[]>();
  for (const choice of otherChoices) {
    if (choice.type !== "tsumo" && !(game.settlement && choice.type === "ack")) callGroups.set(choice.type, [...(callGroups.get(choice.type) || []), choice]);
  }
  const pendingCalls = pendingCallType ? otherChoices.filter(choice => choice.type === pendingCallType) : [];
  const allowedChoices = riichiMode ? riichiChoices : discardChoices;
  const previewChoiceId = hoveredChoiceId ?? selectedHandTile?.choiceId;
  if (previewChoiceId && allowedChoices.some(choice=>choice.id===previewChoiceId) && !waitCache.has(previewChoiceId)) {
    waitCache.set(previewChoiceId, discardWaits(game,ownSeat,room.variant,previewChoiceId));
  }
  const canPreview = !opening.holding && connected && !busy && !choiceSubmitted && !isFinished && !game.settlement;
  const peekWaits = currentHandWaits.length ? currentHandWaits : singleDiscardPeek;
  const selectedWaits = canPreview ? showCurrentWaits ? peekWaits : previewChoiceId && allowedChoices.some(choice=>choice.id===previewChoiceId) ? waitCache.get(previewChoiceId) ?? [] : [] : [];

  const ownMember = room.members.find((member) => member.seat === ownSeat);
  const matchingTile = connected && !busy && !choiceSubmitted && !game.settlement && !isFinished && selectedHandTile
    ? tileMatchKey(allowedChoices.find(choice => choice.id === selectedHandTile.choiceId)?.value)
    : null;

  const cancelNukiInput = (event: { target: EventTarget | null }) => {
    if (event.target instanceof Element && event.target.closest(".mahjong-hand, .mahjong-action-dock")) {
      automatic.manual();
      drawArrival.cancel();
      nukiMotion.cancel();
      publicCallMotion.cancel();
      handReflow.cancel();
    }
  };
  const closeAutomaticMenu = (event: {target: EventTarget | null; currentTarget: HTMLElement}, escape = false) => {
    const menu = event.currentTarget.querySelector<HTMLDetailsElement>(".mahjong-automatic");
    if (!menu?.open) return;
    const inside = event.target instanceof Node && menu.contains(event.target);
    if (!inside || escape) {
      menu.open = false;
      if (inside && escape) menu.querySelector<HTMLElement>("summary")?.focus();
    }
  };
  return <section data-table-fitted={tableScreen.frame?"true":undefined} style={tableScreen.frame?{ "--mahjong-frame-width":`${tableScreen.frame.width}px`, "--mahjong-frame-height":`${tableScreen.frame.height}px`, "--mahjong-dvw":`${tableScreen.frame.width/100}px`, "--mahjong-dvh":`${tableScreen.frame.height/100}px`, "--mahjong-vw":`${tableScreen.frame.width/100}px`, "--mahjong-vh":`${tableScreen.frame.height/100}px` } as CSSProperties:undefined} data-table-rotated={tableScreen.rotated?"true":undefined} data-opening-full-sort={fullOpeningSorted?"true":undefined} data-opening-sorted={opening.age!==null&&opening.age>=1200?"true":undefined} data-round-opening={opening.age===null?undefined:Math.floor(opening.age)} data-tablecloth={tablecloth.cloth} ref={audioRootRef} onFocusCapture={closeAutomaticMenu} onPointerDownCapture={event=>{closeAutomaticMenu(event);tableShortcut.down(event);cancelNukiInput(event);}} onPointerUp={tableShortcut.up} onPointerCancel={tableShortcut.reset} onClickCapture={cancelNukiInput} onKeyDownCapture={event=>{closeAutomaticMenu(event,event.key === "Escape");tableShortcut.reset();cancelNukiInput(event);}} className={`mahjong-game${room.variant === "sanma" ? " is-sanma" : ""}${isFinished ? " is-finished" : ""}`}>
    <header className="mahjong-game__topline"><div className="mahjong-game__round"><span className="mahjong-game__round-seal">{windNames[game.roundWind] || "東"}</span><div><strong>{roundTitle(game)}</strong><span>{room.mode === "east" ? "東風戰" : "半莊戰"} <i>·</i> 本場 {game.honba}</span></div></div><div className="mahjong-game__tempo"><span>{game.remainingTiles}<small>剩余</small></span><span className="mahjong-game__tempo-divider"/><span>{game.riichiSticks}<small>立直棒</small></span><span className="mahjong-game__phase"><i className={connected ? "is-live" : ""}/>{phaseTitle(game)}</span></div><div className="mahjong-game__screen-actions">{onRules ? <button className="mahjong-screen-button mahjong-table-rules" type="button" aria-label="查看规则" title="查看规则" onClick={event => { clearHandSelection(); event.currentTarget.focus(); onRules(); }}><CircleHelp size={18}/></button> : null}<TableclothPicker cloth={tablecloth.cloth} onChoose={tablecloth.choose} onOpen={clearHandSelection}/>{canPreview && peekWaits.length > 0 ? <WaitPeekButton held={showCurrentWaits} onHold={setShowCurrentWaits}/> : null}{!isFinished ? <details className="mahjong-automatic"><summary onClick={event=>event.currentTarget.focus()}>便捷操作</summary><div role="group" aria-label="自动操作">{([['win','自动和牌'],['noCalls','不鸣牌'],['drawnDiscard','自动摸切'],...(room.variant==='sanma' ? [['north','自动拔北']] : [])] as [keyof typeof automatic.options,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={automatic.options[key]} onClick={()=>automatic.toggle(key)}>{label}<span>{automatic.options[key] ? '开' : '关'}</span></button>)}<button type="button" aria-pressed={handHover.twoClicks} title="关闭时鼠标悬停预选后单击出牌；触屏始终两次点按" onClick={()=>{clearHandSelection();handHover.toggle();}}>桌面二次点击出牌<span>{handHover.twoClicks ? "开" : "关"}</span></button><button type="button" aria-pressed={tableShortcut.enabled} title="双击桌布过牌或切出最后一张牌；选牌时先返回" onClick={tableShortcut.toggle}>双击过牌／摸切<span>{tableShortcut.enabled ? "开" : "关"}</span></button></div></details> : null}<button className="mahjong-screen-button mahjong-audio-toggle" type="button" onClick={audio.toggle} aria-label={audio.enabled ? "关闭音效" : "开启音效"} aria-pressed={!audio.enabled} title={audio.enabled ? "关闭音效" : "开启音效"}>{audio.enabled ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><button className="mahjong-screen-button" type="button" disabled={tableScreen.pending} onClick={() => void tableScreen.enter()} aria-label="全屏横屏"><Expand size={16}/><span>全屏横屏</span></button>{host ? <button className="mahjong-icon-button mahjong-game__exit" type="button" aria-label="结束并解散牌桌" onClick={event => { event.currentTarget.focus(); onFinish(); }}><DoorOpen size={17}/></button> : room.status === "finished" ? <button className="mahjong-icon-button mahjong-game__exit" type="button" aria-label="离开已结束牌桌" onClick={onLeave}><DoorOpen size={17}/></button> : null}</div></header>

    {tableScreen.hint && !tableScreen.rotated ? <div className="mahjong-screen-hint" role="status" aria-label="屏幕方向提示" title={tableScreen.hint}>请旋转手机</div> : null}
    {!tableScreen.frame ? <aside className="mahjong-portrait-gate" aria-label="请横屏打牌"><Smartphone size={44}/><p className="mahjong-kicker">LANDSCAPE TABLE</p><h2>把手机横过来，坐上牌桌。</h2><p>横屏看清整桌、手牌与宝牌指示。</p><button type="button" className="mahjong-button mahjong-button--gold" disabled={tableScreen.pending} onClick={() => void tableScreen.enter()}><Expand size={17}/>进入横屏牌桌</button>{tableScreen.hint ? <p>{tableScreen.hint}</p> : <small>若浏览器不支持自动横屏，请旋转手机。</small>}{host ? <button type="button" className="mahjong-button mahjong-button--quiet" onClick={onFinish}>解散本桌</button> : null}</aside> : null}
    {!connected ? <div className="mahjong-reconnect" role="status" aria-label="连接状态"><WifiOff size={15}/>正在重连…</div> : null}

    {isFinished && game.ranking ? <MahjongFinalRanking ranking={game.ranking} flow={game.rankingFlow} members={room.members} ownSeat={ownSeat} host={host} connected={connected} busy={busy} onRematch={onRematch} onFinish={onFinish}/> : null}

    <div ref={tableRef} className={`mahjong-table${overDiscardTarget ? " is-discard-target" : ""}`} data-testid="mahjong-board" data-turn-seat={game.turnSeat} data-matching-tile={matchingTile ?? undefined} data-dora-tiles={visibleDoraFamilies(opening.doraVisible?game.doraIndicators:[], room.variant).join(" ")}>
      {feedback && feedback.kind!=="riichi" && !(feedback.kind==="win"&&game.settlementFlow?.winDeclarations?.length) ? feedback.actionLabel && ["call", "riichi", "nuki", "win"].includes(feedback.kind)
        ? <MahjongCallAnnouncement key={feedback.key} feedback={feedback} members={room.members} ownSeat={ownSeat}/>
        : <div key={feedback.key} className={`mahjong-table-feedback is-${feedback.kind}`} role="status" aria-label="牌桌动作" data-feedback-seat={feedback.seat}>{feedback.text}</div> : null}
      <MahjongDeclarations room={room} connected={connected} canAnimate={motionCanAnimate} ownSeat={ownSeat}/>
      <MahjongYakumanOpportunity room={room} waits={currentHandWaits} connected={connected} canAnimate={motionCanAnimate}/>
      {game.settlement?.drawInfo?.kind === "abort" ? <MahjongAbortAnnouncements settlement={game.settlement} flow={game.settlementFlow} elapsed={drawPresentation.elapsed} members={room.members} ownSeat={ownSeat} capacity={capacity} reducedMotion={drawPresentation.reducedMotion}/> : null}
      <div className="mahjong-table__surface" data-testid="mahjong-table-surface">
        <div className="mahjong-table__grain" aria-hidden="true"/>
        <div className="mahjong-table__seams mahjong-table__lane" aria-hidden="true"/>
        {Array.from({ length: capacity - 1 }, (_, index) => index + 1).map(offset => {
          const player = byRelative(offset);
          const position = offset === 1 ? "east" : capacity === 3 || offset === 3 ? "west" : "north";
          return <div key={offset} className={`mahjong-table__position mahjong-table__position--${position}`}><PlayerPanel revealKey={game.settlementFlow?.id} revealAge={game.settlementFlow?.stage === "draw" && game.settlement ? Math.max(0,drawPresentation.elapsed-drawRevealAt(game.settlement)) : 300} revealedHand={revealedHands.find(hand => hand.seat === player?.seat)?.hand} player={player} member={room.members.find(member => member.seat === player?.seat)} ownSeat={ownSeat} active={game.turnSeat === player?.seat} offset={offset} capacity={capacity} openingAge={opening.age} includeIdentity={false} onInspect={() => player && setInspectedSeat(player.seat)}/></div>;
        })}
        <div className="mahjong-table__own-public"><PlayerPanel player={ownPlayer} member={ownMember} ownSeat={ownSeat} active={game.turnSeat === ownSeat} offset={0} capacity={capacity} includeIdentity={false}/></div>
        <div className="mahjong-table__center" aria-label="场况台">
          <strong>{roundTitle(game)}</strong>
          <span className="mahjong-table__wall" aria-label={`剩余 ${game.remainingTiles} 张`}>余 <b>{game.remainingTiles}</b></span>
          {game.players.map(player => <span key={player.seat} data-seat={player.seat} className={`mahjong-center-seat mahjong-center-seat--${relativeSeat(player.seat)}${game.turnSeat === player.seat ? " is-active" : ""}`} aria-label={`${windNames[player.wind]}家 ${player.score.toLocaleString()} 点`}><span className="mahjong-center-seat__wind">{windNames[player.wind]}</span><b>{player.score.toLocaleString()}</b></span>)}
        </div>
        {game.players.map((player) => <River key={player.seat} player={player} offset={relativeSeat(player.seat)} capacity={capacity} roomId={room.id} gameInstanceId={game.gameInstanceId} handId={game.handId} hiddenEventIds={discardMotion.hiddenEventIds} />)}
      </div>
      {Array.from({ length: capacity - 1 }, (_, index) => index + 1).map(offset => {
        const player = byRelative(offset);
        const position = offset === 1 ? "east" : capacity === 3 || offset === 3 ? "west" : "north";
        return <div key={offset} className={`mahjong-table__position mahjong-table__position--${position}`}><PlayerIdentity player={player} member={room.members.find(member => member.seat === player?.seat)} ownSeat={ownSeat} active={game.turnSeat === player?.seat} offset={offset} capacity={capacity} onInspect={() => player && setInspectedSeat(player.seat)}/></div>;
      })}
      <div className="mahjong-table__dora" role="group" aria-label="宝牌指示牌" data-testid="mahjong-dora"><span>宝牌指示牌</span><div>{(opening.doraVisible?game.doraIndicators:[]).map((tile, index) => <TileFace key={`${tile}-${index}`} value={tile}/>)}{Array.from({length: Math.max(0, 5 - (opening.doraVisible?game.doraIndicators.length:0))}, (_, index) => <i className="mahjong-indicator-back" aria-hidden="true" key={`back-${index}`}/>)}</div><small>宝牌 <b>{(opening.doraVisible?game.doraIndicators:[]).map(tile => tileName(indicatorBonus(tile, room.variant))).join(" · ")}</b></small><div className="mahjong-table__counters" role="group" aria-label="场况计数"><span className="mahjong-table__counter" aria-label={`本场 ${game.honba}`}><small>本场</small><b>{game.honba}</b></span><span className="mahjong-table__counter" aria-label={`立直棒 ${game.riichiSticks}`}><i className="mahjong-table__stick" aria-hidden="true"/><small>立直棒</small><b>{game.riichiSticks}</b></span></div></div>
      <div className="mahjong-table__own"><PlayerIdentity player={ownPlayer} member={ownMember} ownSeat={ownSeat} active={game.turnSeat === ownSeat} offset={0} capacity={capacity} onInspect={() => ownPlayer && setInspectedSeat(ownPlayer.seat)}/>
        <div className="mahjong-hand-block">{selectedWaits.length ? <aside className="mahjong-wait-preview" role="status" aria-label="待牌预览"><span>待牌</span><div>{selectedWaits.map(wait=><span className="mahjong-wait-preview__item" key={wait.tile}><TileFace value={wait.tile}/><small>{wait.ronYaku ? `${wait.remaining} 张` : null}</small>{wait.furiten ? <b>振听</b> : null}{!wait.ronYaku ? <b>无役</b> : null}</span>)}</div></aside> : null}<div className="mahjong-hand-label"><span>你的手牌</span><small>{game.hand.length} 張{game.drawnTile ? " · 摸牌" : ""}</small></div><div className="mahjong-hand-line"><div ref={openingRack} className="mahjong-hand" data-testid="mahjong-hand" aria-label="你的手牌">
          {rack.map((item,index)=>{
            const {value:tile,tileId,logicalDraw,separated}=item;
            const choices=allowedChoices.filter(choice=>choice.value&&tileKey(choice.value)===tileKey(tile)&&choice.value.endsWith("_")===logicalDraw);
            const choice=choices[0];
            return <span key={item.key} className={`mahjong-rack-slot${logicalDraw?" mahjong-drawn-wrap":""}${logicalDraw&&nukiMotion.heldDecisionId===game.decisionId?" is-nuki-held":""}`} data-logical-draw={logicalDraw?"true":undefined}>
              {logicalDraw?<i>摸</i>:null}
              <HandActionTile tileId={tileId} value={tile} dealVisible={index<openingTileCount(opening.age,game.hand.length)} dealWave={opening.age===null?undefined:Math.floor(index/4)} choices={choices} disabled={opening.holding||busy||!connected||choiceSubmitted} drawn={separated} arriving={logicalDraw&&drawArrival.arriving} selected={Boolean(choice&&selectedHandTile?.tileId===tileId&&selectedHandTile.choiceId===choice.id)} drag={dragPreview?.tileId===tileId?dragPreview:null} onHover={hoverHandTile} onActivate={activateHandTile} onPointerStart={startHandPointer} onPointerMove={moveHandPointer} onPointerEnd={endHandPointer} onPointerCancel={cancelHandPointer}/>
            </span>;
          })}
        </div></div></div>
      </div>
    </div>

    {!opening.holding && !isFinished && (otherChoices.length > 0 || riichiChoices.length > 0 || game.settlement) ? <div className="mahjong-action-dock" aria-label="可执行操作">
      {tsumoChoice && !game.settlement ? <button type="button" className="mahjong-button mahjong-button--win mahjong-button--tsumo" disabled={busy || !connected || !tsumoChoice} data-choice-id={tsumoChoice?.id} data-choice-type={tsumoChoice?.type} title={tsumoChoice ? "点击自摸和牌" : game.turnSeat !== ownSeat ? "等待你的摸牌回合" : "当前没有合法自摸选项"} onClick={() => connected && !busy && tsumoChoice && onChoice(tsumoChoice)}>自摸</button> : null}
      {riichiChoices.length > 0 && !game.settlement ? <button type="button" className={`mahjong-button mahjong-button--riichi${riichiMode ? " is-selected" : ""}`} aria-pressed={riichiMode} disabled={busy || !connected || !riichiChoices.length} title={riichiChoices.length ? "选择高亮牌切出并宣告立直" : ownPlayer?.riichi ? "已经立直" : "当前没有合法立直选项"} onClick={() => connected && !busy && setRiichiMode((value) => !value)}>{riichiMode ? "选择立直牌" : "立直"}</button> : null}
      {[...callGroups].map(([type, choices]) => <button key={type} type="button"
        className={`mahjong-button ${type === "ron" ? "mahjong-button--win" : type === "pass" ? "mahjong-button--quiet" : "mahjong-button--action"}`}
        disabled={busy || !connected} data-choice-id={choices.length === 1 ? choices[0].id : undefined}
        data-choice-type={type} aria-label={choiceNames[type]} aria-haspopup={choices.length > 1 ? "dialog" : undefined}
        onClick={event => {
          if (!connected || busy) return;
          publicCallMotion.cancel();
          pendingCallTrigger.current = event.currentTarget;
          choices.length > 1 ? setPendingCallType(type) : onChoice(choices[0]);
        }}>
        <span className="mahjong-call-label">{choiceNames[type]}{choices.length > 1 ? <small>选择组合 · {choices.length}</small> : null}</span>
        <span className="mahjong-call-previews">{choices.map(choice => <MahjongCallOption key={choice.id} choice={choice}/>)}</span>
      </button>)}
      {riichiMode ? <button type="button" className="mahjong-action-dock__cancel" onClick={() => setRiichiMode(false)}>返回普通切牌</button> : null}
      {game.settlement && !game.settlementFlow ? <div className="mahjong-settlement" role="status"><span>{settlementTitle(game.settlement)}</span>{game.settlement.yaku.slice(0, 3).map((yaku) => <i key={yaku.name}>{mahjongTerm(yaku.name)}</i>)}</div> : null}
    </div> : null}

    {game.settlement ? <MahjongSettlementPanel leadInMs={drawLead} game={game} room={room} connected={connected} busy={busy} onChoice={choice => { publicCallMotion.cancel(); onChoice(choice); }}/> : null}
    {pendingCallType && pendingCalls.length > 1 ? <CallChoiceDialog returnFocus={pendingCallTrigger.current} type={pendingCallType} choices={pendingCalls} busy={busy} connected={connected} onClose={() => setPendingCallType(null)} onChoice={choice => { setPendingCallType(null); if (connected && !busy) { publicCallMotion.cancel(); onChoice(choice); } }}/> : null}
    {inspectedSeat !== null ? <PublicMeldDialog player={game.players.find(p => p.seat === inspectedSeat)} member={room.members.find(m => m.seat === inspectedSeat)} onClose={() => setInspectedSeat(null)}/> : null}
    {publicCallMotion.flight ? <DiscardFlightLayer doraTiles={visibleDoraFamilies(opening.doraVisible?game.doraIndicators:[], room.variant).join(" ")} kind="call" flight={publicCallMotion.flight} onFinish={finishCallAudio}/> : null}
    {nukiMotion.flight ? <DiscardFlightLayer doraTiles={visibleDoraFamilies(opening.doraVisible?game.doraIndicators:[], room.variant).join(" ")} kind="nuki" flight={nukiMotion.flight} onFinish={finishNukiAudio}/> : null}
    {discardMotion.flight ? <DiscardFlightLayer doraTiles={visibleDoraFamilies(opening.doraVisible?game.doraIndicators:[], room.variant).join(" ")} flight={discardMotion.flight} onFinish={finishDiscardAudio}/> : null}
  </section>;
}

type PlayerPanelProps = { openingAge?:number|null; revealKey?: string; revealAge?: number; revealedHand?: string; player?: PublicPlayer; member?: RoomMember; ownSeat: number; active: boolean; offset: number; capacity: number; onInspect?: () => void; includeIdentity?: boolean };

function PlayerIdentity({ player, member, ownSeat, offset, capacity, onInspect }: PlayerPanelProps) {
  if (!player) return null;
  const canInspect = (player.melds.length > 0 || (player.nuki ?? 0) > 0) && Boolean(onInspect);
  const Heading = canInspect ? "button" : "div";
  const relativeNames = capacity === 3 ? ["你", "下家", "上家"] : ["你", "下家", "对家", "上家"];
  return <>
    <Heading className="mahjong-player__head" {...(canInspect ? {type:"button" as const, onClick:onInspect, "aria-label":`查看${member?.displayName || "牌友"}的公开副露`} : {})}><span className="mahjong-player__wind" data-avatar={player.seat % 4} data-wind={windNames[player.wind] || "東"}>{windNames[player.wind] || "東"}</span><div><strong>{member?.displayName || (player.seat === ownSeat ? "你" : "牌友")}</strong><small>{relativeNames[offset] || "牌友"}{member?.kind === "bot" ? " · 电脑" : ""}{player.nuki !== undefined ? <span className="mahjong-player__nuki" aria-label={`公开拔北数量：${player.nuki}`} data-testid={`nuki-${player.seat}`}><span>北</span> × {player.nuki}</span> : null}</small></div><b>{player.score.toLocaleString()}</b>{canInspect ? <span className="mahjong-player__zoom" aria-hidden="true"><Expand size={10}/></span> : null}{player.riichi ? <i className="mahjong-player__riichi">立直</i> : null}</Heading>
    {member?.kind === "human" && !member.connected ? <small className="mahjong-player__offline">暂时离线 · 座位保留</small> : null}
  </>;
}

function PlayerPanel({ openingAge=null, revealKey, revealAge = 300, revealedHand, player, member, ownSeat, active, offset, capacity, onInspect, includeIdentity = true }: PlayerPanelProps) {
  if (!player) return null;
  return <div className={`mahjong-player${active ? " is-turn" : ""}${offset === 0 ? " is-you" : ""}`} data-seat={player.seat} data-testid={`player-${player.seat}`}>
    {includeIdentity ? <PlayerIdentity player={player} member={member} ownSeat={ownSeat} active={active} offset={offset} capacity={capacity} onInspect={onInspect}/> : null}
    {offset !== 0 ? <div className="mahjong-opponent-rack"><div className="mahjong-player__hidden" data-motion-rack-seat={player.seat} aria-label={`${member?.displayName || "牌友"}的手牌数量：${player.handCount}`}>
      {revealedHand ? <MountedDrawRack key={revealKey} age={revealAge} hand={revealedHand} seat={player.seat} name={member?.displayName || "牌友"}/> : Array.from({ length: Math.min(player.handCount, 14) }, (_, index) => {
        const drawn = player.hasDrawnTile === true && index === Math.min(player.handCount, 14) - 1;
        return <MahjongStandingTile key={index} drawn={drawn} dealVisible={index<openingTileCount(openingAge,player.handCount)} dealWave={openingAge===null?undefined:Math.floor(index/4)}/>;
      }) }
      <span>{player.handCount}</span>
    </div>
    {offset !== 0 && player.melds.length ? <div className="mahjong-player__melds" role="group" aria-label={`${member?.displayName || "牌友"}的副露`}>
      {player.melds.map((meld, index) => <MeldView key={`${index}-${meld}`} meld={meld} seat={player.seat} index={index}/>) }
    </div> : null}</div> : player.melds.length ? <div className="mahjong-hand-public-melds" role="group" aria-label="你的公开副露">{player.melds.map((meld, index) => <MeldView meld={meld} seat={player.seat} index={index} key={`${index}-${meld}`}/>)}</div> : null}
    {(player.nuki ?? 0) > 0 ? <div className="mahjong-nuki-tray" role="group" aria-label={`${member?.displayName || "牌友"}已拔北 ${player.nuki} 张`} data-nuki-seat={player.seat} data-testid={`nuki-tiles-${player.seat}`} style={{"--nuki-count": Math.min(4, player.nuki ?? 0)} as CSSProperties}><small>拔北 × {player.nuki}</small><div className="mahjong-nuki-tray__footprint"><div className="mahjong-nuki-tray__tiles">{Array.from({length: Math.min(4, player.nuki ?? 0)}, (_, index) => <span key={index} data-nuki-index={index}><span className="mahjong-nuki-volume" data-nuki-volume><MahjongFaceUpFlightTile value="z4"/></span></span>)}</div></div></div> : null}
  </div>;
}

export function PublicMeldDialog({player, member, onClose}: {player?: PublicPlayer; member?: RoomMember; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal?.(); }, []);
  return <dialog ref={dialog} className="mahjong-confirm mahjong-public-melds" aria-label={`${member?.displayName || "牌友"}的公开副露`} onCancel={event => {event.preventDefault(); onClose();}}>
    <button type="button" className="mahjong-icon-button mahjong-public-melds__close" aria-label="关闭副露详情" onClick={onClose}><X size={18}/></button>
    <p className="mahjong-kicker">PUBLIC MELDS</p><h2>{member?.displayName || "牌友"}的公开副露</h2>
    {(player?.nuki ?? 0) > 0 ? <div className="mahjong-public-melds__nuki" role="group" aria-label={`已拔北 ${player?.nuki} 张`}><small>拔北 × {player?.nuki}</small><div>{Array.from({length:Math.min(4,player?.nuki??0)},(_,index)=><TileFace value="z4" key={index}/>)}</div></div> : null}
    <div className="mahjong-public-melds__tiles">{player?.melds.map((meld,index) => <MeldView meld={meld} key={`${index}-${meld}`}/>)}</div>
  </dialog>;
}

function CallChoiceDialog({ returnFocus, type, choices, busy, connected, onClose, onChoice }: { returnFocus: HTMLButtonElement | null; type: Choice["type"]; choices: Choice[]; busy: boolean; connected: boolean; onClose: () => void; onChoice: (choice: Choice) => void }) {
  const picker = useRef<HTMLElement>(null);
  const title = `选择${choiceNames[type]}牌`;
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement;
    const panel = picker.current;
    panel?.querySelector<HTMLButtonElement>('button[data-choice-id]:not(:disabled)')?.focus();
    return () => {
      if ((panel?.contains(document.activeElement) || document.activeElement === document.body)
        && previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled')) previous.focus();
    };
  }, [returnFocus]);
  return <section ref={picker} role="dialog" aria-modal="false" className="mahjong-call-dialog" aria-label={title} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="mahjong-call-dialog__header"><h2>{title}</h2><button type="button" className="mahjong-call-dialog__back" aria-label="关闭选牌" onClick={onClose}>返回</button></div>
    <div className="mahjong-call-options">{choices.map(choice => <button key={choice.id} type="button"
      className="mahjong-button mahjong-button--action" disabled={busy || !connected}
      data-choice-id={choice.id} data-choice-type={type}
      aria-label={choice.value ? choiceDescription(choice.value) : choiceNames[type]}
      onClick={() => connected && !busy && onChoice(choice)}>
      <span className="mahjong-call-label">{choiceNames[type]}</span><MahjongCallOption choice={choice}/>
    </button>)}</div>
  </section>;
}

function displayShortTile(value: string) {
  const key = tileKey(value);
  const honor: Record<string, string> = { z1: "東", z2: "南", z3: "西", z4: "北", z5: "白", z6: "發", z7: "中" };
  if (honor[key]) return honor[key];
  const suit = key[0] === "m" ? "萬" : key[0] === "p" ? "筒" : "索";
  return `${key[1] === "0" ? "赤5" : key[1]}${suit}`;
}

function choiceDescription(value: string) {
  const match = value.match(/^([mpsz])([0-9+\-=]+)$/);
  if (!match) return value;
  return [...match[2].replace(/\D/g, "")].map((number) => displayShortTile(`${match[1]}${number}`)).join(" ");
}

function HandActionTile({ dealVisible=true, dealWave, tileId, value, choices, disabled, drawn = false, arriving = false, selected = false, drag, onHover, onActivate, onPointerStart, onPointerMove, onPointerEnd, onPointerCancel }: {
  dealVisible?:boolean;dealWave?:number;
  tileId: string; value: string; choices: Choice[]; disabled: boolean; drawn?: boolean; arriving?: boolean; selected?: boolean;
  drag: { tileId: string; x: number; y: number } | null;
  onHover: (tileId: string | null, choice: Choice | null) => void;
  onActivate: (tileId: string, choice: Choice, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerStart: (tileId: string, choice: Choice, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (tileId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const choice = choices[0];
  const dragging = Boolean(drag);
  const style = drag ? { "--mahjong-drag-x": `${drag.x}px`, "--mahjong-drag-y": `${drag.y}px` } as CSSProperties : undefined;
  return <TileFace value={value} className={`${drawn ? "is-drawn" : ""}${arriving ? " is-draw-arriving" : ""}${choice ? " is-playable" : " is-locked"}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`} type="button" disabled={!choice || disabled} data-deal-visible={dealVisible?undefined:"false"} data-deal-wave={dealWave} data-hand-instance-id={tileId} data-choice-id={choice?.id} data-choice-type={choice?.type} aria-pressed={selected} aria-label={`${choice?.type === "riichi" ? "立直后切出" : "切出"} ${tileName(value)}`} style={style} onPointerEnter={event => event.pointerType === "mouse" && !disabled && choice && onHover(tileId, choice)} onPointerLeave={event => event.pointerType === "mouse" && onHover(null, null)} onClick={event => choice && onActivate(tileId, choice, event)} onPointerDown={event => choice && onPointerStart(tileId, choice, event)} onPointerMove={event => onPointerMove(tileId, event)} onPointerUp={event => onPointerEnd(tileId, event)} onPointerCancel={event => onPointerCancel(tileId, event)} onLostPointerCapture={event => onPointerCancel(tileId, event)}/>;
}

function MountedDrawRack({age,hand,seat,name}:{age:number;hand:string;seat:number;name:string}) {
  const delay=useRef(-Math.min(300,Math.max(0,age)));
  return <div style={{"--draw-flip-age":`${delay.current}ms`} as CSSProperties} className="mahjong-draw-rack" data-draw-reveal-seat={seat} aria-label={`${name}的公开手牌`}>{winningHand({kind:"draw",name:"",hand,yaku:[],delta:[],uraIndicators:[]}).closed.map((tile,index)=><span key={`${index}-${tile}`} className="mahjong-draw-rack__tile"><MahjongFaceUpFlightTile value={tile}/></span>)}</div>;
}
