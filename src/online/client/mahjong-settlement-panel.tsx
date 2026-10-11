"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSettlementPresentation } from "./use-settlement-presentation";
import { detailValueAt, drawSummaryAt, NAGASHI_YAKU_MS, NAGASHI_TITLE_MS } from "./settlement-presentation";
import { MahjongDrawSummary } from "./mahjong-draw-summary";
import type { Choice, GameView, RoomView } from "../domain/types";
import { winningHand, settlementTitle } from "./mahjong-winning-hand";
import { TileFace, tileName } from "./mahjong-tile";
import { MahjongMeld as MeldView } from "./mahjong-meld";
const number = (value: number) => value.toLocaleString("en-US");

export function MahjongSettlementPanel({ game, room, connected, busy, onChoice, leadInMs = 0 }: { game: GameView; room: RoomView; connected: boolean; busy: boolean; onChoice: (choice: Choice) => void; leadInMs?: number }) {
  const settlement = game.settlement;
  const ack = game.choices.find(choice => choice.type === "ack");
  const flow = !game.ranking && settlement ? game.settlementFlow : undefined;
  const winIntro=settlement?.kind==='win'&&flow?.stage==='detail'&&flow.detailIndex===0&&Boolean(flow.winDeclarations?.length)?1200:0;
  const presentation = useSettlementPresentation({ flow, settlement: game.ranking ? null : settlement, ack: game.ranking ? undefined : ack, connected, busy, onChoice, leadInMs: flow?.stage === "draw" ? leadInMs : winIntro });
  const phaseKey=flow ? `${flow.id}:${flow.stage}:${flow.detailIndex}` : "legacy-settlement";
  const [maximum,setMaximum]=useState({key:phaseKey,elapsed:presentation.elapsed});
  const age=maximum.key===phaseKey ? Math.max(maximum.elapsed,presentation.elapsed) : presentation.elapsed;
  useEffect(()=>setMaximum({key:phaseKey,elapsed:age}),[phaseKey,age]);
  const mountedFade=useRef<{key:string;delay:number}|null>(null);
  if (!settlement || game.ranking) {mountedFade.current=null;return null;}
  if(winIntro&&presentation.rawElapsed<winIntro){mountedFade.current=null;return null;}
  const scoresStage = flow?.stage === "scores";
  const detailStage = flow?.stage === "detail";
  const drawStage = flow?.stage === "draw";
  const nagashiDetail = detailStage && settlement.drawInfo?.kind === "nagashi";
  const abort = drawStage && settlement.drawInfo?.kind === "abort";
  if (drawStage && presentation.elapsed < drawSummaryAt(settlement)) {mountedFade.current=null;return null;}
  if (!abort) mountedFade.current=null;
  else if (mountedFade.current?.key!==phaseKey) mountedFade.current={key:phaseKey,delay:-Math.min(500,Math.max(0,age-drawSummaryAt(settlement)))};
  const hanText = String(settlement.han ?? "");
  const yakuYakumanCount = settlement.yaku.reduce((count, yaku) => count + ((String(yaku.han).match(/\*+/)?.[0].length || 0)), 0);
  const yakumanCount = Math.max((hanText.match(/\*+/)?.[0].length || 0), yakuYakumanCount, /役満|役满/.test(hanText) ? 1 : 0);
  const hanLabel = yakumanCount ? `${yakumanCount > 1 ? `${yakumanCount}倍` : ""}役满` : `${hanText || "—"} 翻`;
  const winning = winningHand(settlement);
  const winner = settlement.winnerSeat === undefined ? null : room.members.find((member) => member.seat === settlement.winnerSeat);
  return <section key={phaseKey} style={abort ? {"--abort-cause-age":`${mountedFade.current!.delay}ms`} as CSSProperties : undefined} className={`mahjong-settlement-panel${flow ? ` is-${flow.stage}` : ""}${abort ? " is-abort" : ""}`} data-settlement-stage={flow?.stage} aria-label={scoresStage ? "本局收支" : nagashiDetail ? "流满贯详情" : detailStage ? "和牌详情" : drawStage ? abort ? "流局原因" : "听牌结果" : "本局结算"}>
    <div key={game.decisionId} className="mahjong-settlement-panel__content">
      <header key={game.decisionId} className="mahjong-settlement-panel__heading"><p className="mahjong-kicker">{scoresStage ? "本局收支" : "本局结算"}</p>{detailStage ? <small className="mahjong-settlement-panel__page">第 {flow.detailIndex + 1} / 共 {flow.detailCount} 位</small> : null}<h2 className={!scoresStage && settlement.kind === "win" ? "mahjong-settlement-panel__win-title" : undefined}>{scoresStage ? "点数结算" : nagashiDetail ? "流满贯" : drawStage ? abort ? "途中流局" : "荒牌流局" : settlementTitle(settlement)}</h2>{!scoresStage && (settlement.kind === "win" || nagashiDetail) ? <strong className="mahjong-settlement-panel__winner">{winner?.displayName || `座位 ${(settlement.winnerSeat ?? 0) + 1}`} {nagashiDetail ? "" : `· ${settlementTitle(settlement)}`}</strong> : null}<p>{scoresStage ? "本局各席收支" : nagashiDetail ? <span data-testid="nagashi-mangan-title" className={presentation.elapsed >= NAGASHI_TITLE_MS ? "is-revealed" : "is-pending"}>满贯</span> : drawStage ? abort ? "" : "听牌结果" : settlement.kind === "win" ? `${hanLabel}${settlement.fu ? ` · ${settlement.fu} 符` : ""}` : settlement.name}</p>{!scoresStage && (settlement.kind === "win" || nagashiDetail) && settlement.points !== undefined ? <div className={`mahjong-settlement-panel__value${detailStage ? presentation.elapsed >= detailValueAt(settlement) ? " is-revealed" : " is-pending" : ""}`}><small>牌型点数</small><b>{number(settlement.points)} 点</b></div> : null}</header>
      {drawStage && settlement.drawInfo ? <MahjongDrawSummary game={game} room={room}/> : null}
      {!detailStage && !drawStage ? <div className={`mahjong-settlement-panel__delta${room.variant === "sanma" ? " is-sanma" : ""}`} aria-label="本次各席收支">{game.players.slice().sort((a,b) => a.seat - b.seat).map(player => {
        const delta = (scoresStage ? flow.delta[player.seat] : settlement.delta[player.seat]) ?? 0;
        const before = scoresStage ? flow.oldScores[player.seat] : player.score;
        const after = scoresStage ? presentation.scores[player.seat] : player.score + delta;
        return <span key={player.seat} data-settlement-seat={player.seat}>
          <small>座位 {player.seat + 1} · {room.members.find(member => member.seat === player.seat)?.displayName || (player.seat === room.mySeat ? "你" : `座位 ${player.seat + 1}`)}</small>
          <em className="mahjong-settlement-panel__balance-before">结算前 {number(before)}</em>
          <b className={delta > 0 ? "is-positive" : delta < 0 ? "is-negative" : ""}>{delta > 0 ? "获得 +" : delta < 0 ? "支付 −" : "不变 "}{number(Math.abs(delta))}</b>
          <em className="mahjong-settlement-panel__balance-after">{scoresStage ? <>{!presentation.reducedMotion && presentation.elapsed < 2160 ? "分数 " : "结算后 "}<strong data-testid={`settlement-score-${player.seat}`}>{number(after)}</strong></> : `结算后 ${number(after)}`}</em>
        </span>;
      })}</div> : null}
      {!flow ? <p className="mahjong-settlement-panel__explanation">全部席位确认后，本次收支才计入分数。{settlement.kind === "win" ? `牌型点数单独显示；实际收支包含本场 ${game.honba}、立直棒 ${game.riichiSticks}。` : "流局收支按各席结算。"}{room.variant === "sanma" && settlement.winMethod === "tsumo" ? "三麻采用自摸损，缺少第四家的付款。" : ""}</p> : null}
      {!scoresStage && (winning.closed.length || winning.melds.length) ? <div className="mahjong-winning-hand"><div><small>{winner?.displayName || "和牌"}的手牌</small>{winning.winningTile ? <small>和牌：{tileName(winning.winningTile)}</small> : null}</div><div className="mahjong-winning-hand__row"><div className="mahjong-winning-hand__closed" role="group" aria-label="闭手">{winning.closed.map((tile, index) => <TileFace value={tile} key={`${index}-${tile}`} />)}</div>{winning.winningTile ? <span className="mahjong-winning-hand__tile" data-testid="mahjong-winning-tile"><TileFace value={winning.winningTile}/></span> : null}{winning.melds.length ? <div className="mahjong-winning-hand__melds">{winning.melds.map((meld, index) => <MeldView meld={meld} key={`${index}-${meld}`}/>)}</div> : null}</div></div> : null}
      {!scoresStage && settlement.kind === "win" ? <div className="mahjong-result-indicators">
        {[{label:"宝牌指示牌",tiles:game.doraIndicators},{label:"里宝牌指示牌",tiles:settlement.uraIndicators}].map(({label,tiles}) => <div className="mahjong-ura-indicators" role="group" aria-label={label} key={label}>
          <small>{label}</small><div>{tiles.map((tile,index) => <TileFace value={tile} key={`${index}-${tile}`}/>)}{Array.from({length:Math.max(0,5-tiles.length)},(_,index) => <i className="mahjong-indicator-back" aria-hidden="true" key={`back-${index}`}/>)}</div>
        </div>)}
      </div> : null}
      {nagashiDetail ? <ul><li data-testid="nagashi-yaku" className={presentation.elapsed >= NAGASHI_YAKU_MS ? "is-revealed" : "is-pending"}><span>流满贯</span></li></ul> : null}
      {!scoresStage && settlement.yaku.length ? <ul>{settlement.yaku.map((yaku, index) => {
        const units = String(yaku.han).match(/\*+/)?.[0].length || 0;
        return <li key={`${game.decisionId}:${index}:${yaku.name}`} className={detailStage ? presentation.elapsed >= 300 + Math.min(index,14) * 180 ? "is-revealed" : "is-pending" : undefined} style={detailStage ? {"--reveal-index": Math.min(index,14)} as CSSProperties : undefined}><span>{yaku.name}</span><b>{units ? `${units > 1 ? `${units}倍` : ""}役满` : `${yaku.han} 翻`}</b></li>;
      })}</ul> : null}
    </div>
    {ack || flow ? <footer className="mahjong-settlement-panel__actions">{flow ? <small role="status">{!ack ? "等待其他玩家" : !connected ? "正在重连" : !presentation.ready ? "正在展示" : busy || !presentation.canConfirm ? "正在确认" : `${presentation.countdown} 秒后继续`}</small> : null}{ack ? <button type="button" className="mahjong-button mahjong-button--gold" data-choice-id={ack.id} data-choice-type={ack.type} disabled={!presentation.canConfirm} onClick={presentation.submit}>继续{flow && presentation.ready && presentation.canConfirm ? ` · ${presentation.countdown}` : ""}</button> : null}</footer> : null}
  </section>;
}
