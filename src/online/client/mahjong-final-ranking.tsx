"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import type { GameView, RoomMember } from "../domain/types";
import { rankingBoundaries, rankingReadyAt, rankingRowAt } from "./final-ranking-presentation";
export type FinalRankingProps = { ranking: NonNullable<GameView["ranking"]>; flow?: GameView["rankingFlow"]; members: RoomMember[]; ownSeat: number; host: boolean; connected: boolean; busy: boolean; onRematch: () => void; onFinish: () => void };

export function MahjongFinalRanking({ranking, flow, members, ownSeat, host, connected, busy, onRematch, onFinish}: FinalRankingProps) {
  const key = flow?.id ?? "legacy-final";
  // Older snapshots remain usable without manufacturing a new server clock.
  const serverAge = flow?.elapsedMs ?? rankingReadyAt(ranking.length);
  const [clock, setClock] = useState({key, age: serverAge});
  const [fade, setFade] = useState({key, age: serverAge});
  const fadeAge = fade.key === key ? Math.max(fade.age, serverAge) : serverAge;
  useEffect(() => {setFade({key, age:fadeAge});}, [key, fadeAge]);
  const anchor = useRef<{key:string; age:number; at:number} | null>(null);
  const age = clock.key === key ? Math.max(clock.age, serverAge) : serverAge;
  const readyAt = rankingReadyAt(ranking.length);
  useEffect(() => {
    const at = performance.now(), previous = anchor.current;
    const initial = previous?.key === key ? Math.max(serverAge, previous.age + at - previous.at) : serverAge;
    anchor.current = {key, age:initial, at};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const boundaries = rankingBoundaries(ranking.length);
    const update = () => {
      if (cancelled) return;
      const elapsed = initial + performance.now() - at;
      setClock({key, age:elapsed});
      const next = boundaries.find(boundary => boundary > elapsed);
      if (next !== undefined) timer = setTimeout(update, next - elapsed);
    };
    update();
    return () => {cancelled = true; clearTimeout(timer);};
  }, [key, serverAge, ranking.length]);
  const ready = age >= readyAt;
  return <section key={key} className="mahjong-ranking" aria-label="最终名次" data-ranking-id={key} style={{"--ranking-start-age":`${-Math.min(fadeAge,1000)}ms`} as CSSProperties}>
    <header className="mahjong-ranking__heading"><p className="mahjong-kicker">FINAL TABLE</p><h1>最终<em>名次</em></h1></header>
    <ol className="mahjong-ranking__list">{[...ranking].sort((a,b)=>a.rank-b.rank).map((row,index)=>{
      const visible = age >= rankingRowAt(index);
      const own = row.seat === ownSeat;
      const name = members.find(member=>member.seat===row.seat)?.displayName ?? (own?"你":"牌友");
      return <li className={`mahjong-ranking__row${visible?" is-visible":""}`} key={row.seat} aria-hidden={!visible} data-ranking-visible={visible} data-own-seat={own}>
        <span className="mahjong-ranking__place">{String(row.rank).padStart(2,"0")}</span>
        <strong title={name}>{name}{own?<small>你</small>:null}</strong><b>{row.score.toLocaleString("en-US")} 点</b>
      </li>;
    })}</ol>
    <div className="mahjong-ranking__actions" aria-hidden={!ready}>{ready ? <>
      {host?<><button type="button" className="mahjong-button mahjong-button--gold" disabled={busy||!connected} onClick={onRematch}><RefreshCw size={16}/>再开一场</button><button type="button" className="mahjong-button mahjong-button--quiet" disabled={busy||!connected} onClick={onFinish}>解散牌桌</button></>:<span>等待房主发起下一场</span>}
    </>:null}</div>
  </section>;
}
