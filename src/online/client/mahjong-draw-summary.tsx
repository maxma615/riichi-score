import type {GameView, RoomView} from "../domain/types";
import {winningHand} from "./mahjong-winning-hand";
import {TileFace} from "./mahjong-tile";
import {MahjongMeld} from "./mahjong-meld";

export function MahjongDrawSummary({game, room}: {game:GameView;room:RoomView}) {
  const result=game.settlement!, draw=result.drawInfo!;
  if (draw.kind === "abort") return <p className="mahjong-draw-cause">{result.name}</p>;
  return <div className="mahjong-draw-summary" aria-label="各席听牌状态">
    {game.players.slice().sort((a,b)=>a.seat-b.seat).map(player=>{
      const publicHand=draw.revealedHands.find(h=>h.seat===player.seat);
      const hand=publicHand ? winningHand({...result,hand:publicHand.hand}) : null;
      const tenpai=result.tenpaiSeats?.includes(player.seat);
      return <article key={player.seat} data-draw-seat={player.seat} className={tenpai ? "is-tenpai" : "is-noten"}>
        <header><strong title={room.members.find(m=>m.seat===player.seat)?.displayName}>{room.members.find(m=>m.seat===player.seat)?.displayName || `座位 ${player.seat+1}`}</strong><b>{tenpai ? "听牌" : "未听牌"}</b></header>
        {hand ? <div className="mahjong-draw-summary__hand" aria-label="公开手牌">{hand.closed.map((tile,i)=><TileFace value={tile} key={`${i}-${tile}`}/>)}{hand.melds.map((meld,i)=><MahjongMeld meld={meld} key={`${i}-${meld}`}/>)}</div> : null}
        {publicHand?.waits.length ? <div className="mahjong-draw-summary__waits" aria-label="待牌"><small>待牌</small>{publicHand.waits.map(tile=><TileFace value={tile} key={tile}/>)}</div> : null}
      </article>;
    })}
  </div>;
}
