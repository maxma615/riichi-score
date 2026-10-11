import Majiang from '@kobalab/majiang-core';
import type {RoomView} from '../domain/types';
import {createDiscardEventId, type DiscardMotionEvent} from './discard-motion';

export type PublicCallEvent = {
  id: string; kind: 'append' | 'kakan'; seat: number; index: number; meld: string; tile?: string;
  source?: DiscardMotionEvent;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const valid = (meld: string) => (Majiang.Shoupai as unknown as {valid_mianzi:(m:string)=>string|undefined}).valid_mianzi(meld) === meld;
function direction(from: number, to: number, capacity: number) {
  const offset = (from - to + capacity) % capacity;
  return offset === 1 ? '+' : capacity === 4 && offset === 2 ? '=' : '-';
}

/** Proves an accepted public group, independently of any concealed supplying tiles. */
export function acceptedPublicCallEvent(before: RoomView | null, after: RoomView): PublicCallEvent | null {
  return provePublicCall(before,after,false);
}

/** A declared added kan is pending until its legal robbing window resolves. */
export function acceptedPendingKakanEvent(before:RoomView|null,after:RoomView):PublicCallEvent|null{
  if(after.game?.phase!=='gang')return null;
  const event=provePublicCall(before,after,true);
  return event?.kind==='kakan'?event:null;
}
function provePublicCall(before: RoomView | null, after: RoomView, pendingKakan:boolean): PublicCallEvent | null {
  const old = before?.game, game = after.game;
  if (!before || !old || !game || before.status !== 'playing' || after.status !== 'playing'
    || before.id !== after.id || before.variant !== after.variant || before.mySeat !== after.mySeat
    || after.version !== before.version + 1 || !old.gameInstanceId || old.gameInstanceId !== game.gameInstanceId
    || !Number.isInteger(old.handId) || old.handId! < 1 || old.handId !== game.handId
    || !old.decisionId || !game.decisionId || old.decisionId === game.decisionId || old.settlement || game.settlement) return null;
  const capacity = after.variant === 'sanma' ? 3 : 4;
  if (old.players.length !== capacity || game.players.length !== capacity
    || new Set(old.players.map(p => p.seat)).size !== capacity || new Set(game.players.map(p => p.seat)).size !== capacity
    || old.players.some(p => !Number.isInteger(p.seat) || p.seat < 0 || p.seat >= capacity)) return null;
  let event: PublicCallEvent | null = null;
  const claims: Array<{seat:number;index:number;tile:string;marker:string}> = [];
  for (const prior of old.players) {
    const player = game.players.find(p => p.seat === prior.seat);
    if (!player || (prior.nuki ?? 0) !== (player.nuki ?? 0) || prior.riichi !== player.riichi
      || prior.discards.length !== player.discards.length) return null;
    for (let index = 0; index < prior.discards.length; index++) {
      const tile = prior.discards[index], current = player.discards[index];
      if (tile === current) continue;
      if (/[+\-=]$/.test(tile) || !/[+\-=]$/.test(current) || current.slice(0,-1) !== tile) return null;
      claims.push({seat:prior.seat,index,tile,marker:current.slice(-1)});
    }
    if (same(prior.melds, player.melds)) continue;
    if (event || player.seat !== game.turnSeat) return null;
    let index: number, kind: PublicCallEvent['kind'];
    if (player.melds.length === prior.melds.length + 1 && same(prior.melds,player.melds.slice(0,-1))) {
      index = prior.melds.length; kind = 'append';
    } else if (player.melds.length === prior.melds.length) {
      const changed = player.melds.flatMap((m,i) => m !== prior.melds[i] ? [i] : []);
      if (changed.length !== 1) return null;
      index = changed[0]; kind = 'kakan';
      if (!/^[mpsz]\d{3}[+\-=]$/.test(prior.melds[index])
        || !/^[mpsz]\d{3}[+\-=]\d$/.test(player.melds[index])
        || player.melds[index].slice(0,-1) !== prior.melds[index] || !valid(prior.melds[index])) return null;
    } else return null;
    const meld = player.melds[index];
    if (!valid(meld) || (meld.match(/0/g)?.length ?? 0) > 1) return null;
    const marker = meld.match(/[+\-=]/)?.[0];
    const kan = (meld.match(/\d/g)?.length ?? 0) === 4;
    if (kan ? game.phase !== 'gangzimo' && !(pendingKakan && kind==='kakan' && game.phase==='gang') : game.phase !== 'fulou') return null;
    if (kind === 'kakan' || !marker) {
      if (!['zimo','gang','gangzimo','nukizimo'].includes(old.phase) || old.turnSeat !== player.seat) return null;
    } else if (old.phase !== 'dapai') return null;
    const tile = kind === 'kakan' ? meld[0] + meld.slice(-1) : marker ? meld[0] + meld[meld.search(/[+\-=]/) - 1] : undefined;
    event = {id:`call:${after.id}:${game.gameInstanceId}:${game.handId}:${player.seat}:${index}:${meld}`,kind,seat:player.seat,index,meld,tile};
  }
  if (!event) return null;
  if (event.kind === 'kakan' || !event.tile) return claims.length ? null : event;
  const marker = event.meld.match(/[+\-=]/)![0];
  const matching = claims.filter(claim => claim.seat !== event.seat && claim.seat === old.turnSeat
    && claim.index === old.players.find(p=>p.seat===claim.seat)!.discards.length - 1
    && claim.tile.replace(/[_*]+$/g,'') === event.tile
    && marker === direction(claim.seat,event.seat,capacity)
    // Yonma He.fulou stores the meld source marker verbatim; sanma
    // stores the caller relative to the discarder. Seat proof is independent.
    && claim.marker === (after.variant === 'yonma' ? marker : direction(event.seat,claim.seat,capacity)));
  if (claims.length === 1 && matching.length === 1) {
    const {seat,index,tile} = matching[0];
    const identity = {roomId:after.id,gameInstanceId:game.gameInstanceId!,handId:game.handId!,seat,index};
    event.source = {...identity,id:createDiscardEventId(identity),tile};
  }
  return event;
}
