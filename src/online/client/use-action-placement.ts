'use client';
import {useLayoutEffect,type RefObject} from 'react';
import {tableSpace,tableRect} from './table-space';
import {placeMahjongActions,type PlacementRect} from './action-placement';
export const actionPlacementProtectedSelector='.mahjong-notice,.mahjong-reconnect,.mahjong-screen-hint,.mahjong-game__topline,.mahjong-table__dora,.mahjong-table__center,.mahjong-player__head,.mahjong-river__tile,.mahjong-opponent-rack .mahjong-standing-tile,.mahjong-table__surface [data-meld-volume],.mahjong-table__surface [data-meld-surface="cap"],[data-nuki-index] .mahjong-discard-flight__face-up-cap,.mahjong-nuki-tray > small,.mahjong-hand [data-tile-face]';
const properties=['position','left','right','top','bottom','width','height','transform','transition-property','pointer-events'];
const rect=(el:Element):PlacementRect=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
/** Layout runs on local UI changes, resize and font arrival, never a timer loop. */
export function useMahjongActionPlacement(root:RefObject<HTMLElement|null>,enabled:boolean,generation:string){
 useLayoutEffect(()=>{
  const game=root.current;if(!enabled||!game)return;
  const shell=game.closest('.mahjong-shell')??game;
  const original=new Map<HTMLElement,Map<string,string>>();let frame=0,stopped=false;
  const restore=()=>{for(const [button,values]of original)for(const [name,value]of values)value?button.style.setProperty(name,value):button.style.removeProperty(name);game.querySelector('.mahjong-action-dock')?.removeAttribute('data-action-layout');};
  const layout=()=>{
   if(stopped||!game.isConnected||(game.dataset.tableFitted!=='true'&&game.dataset.tableRotated!=='true'&&window.matchMedia&&!window.matchMedia('(orientation: landscape)').matches))return;
   const dock=game.querySelector<HTMLElement>('.mahjong-action-dock');if(!dock)return;
   const buttons=[...dock.querySelectorAll<HTMLElement>(':scope > button')];if(!buttons.length)return;
   restore();
   const space=tableSpace(game);
   const localRect=(el:Element)=>(space.rotated||game.dataset.tableFitted==='true')?tableRect(space,el.getBoundingClientRect()):rect(el);
   const actions=buttons.map((button,i)=>({id:String(i),...localRect(button)})).filter(a=>a.w>0&&a.h>0);
   const obstacles=[...shell.querySelectorAll(actionPlacementProtectedSelector)].filter(el=>!el.closest('.mahjong-action-dock')).map(localRect).filter(r=>r.w>0&&r.h>0);
   const style=getComputedStyle(game),inset=(name:string)=>Math.max(8,parseFloat(style.getPropertyValue(name))||0);
   const left=inset('--action-safe-left'),top=inset('--action-safe-top'),right=inset('--action-safe-right'),bottom=inset('--action-safe-bottom');
   game.dataset.actionLayoutRuns=String((Number(game.dataset.actionLayoutRuns)||0)+1);
   const before=performance.now(),placed=placeMahjongActions(actions,obstacles,{x:left,y:top,w:(game.dataset.tableFitted==='true'||space.rotated?space.width:innerWidth)-left-right,h:(game.dataset.tableFitted==='true'||space.rotated?space.height:innerHeight)-top-bottom});
   game.dataset.actionLayoutMs=String(performance.now()-before);
   game.dataset.actionLayoutState=placed?'ready':'unplaced';
   if(!placed)return; // Preserve every original action if no clear packing exists.
   if(placed.every((a,i)=>a.x===actions[i].x&&a.y===actions[i].y))return;
   dock.dataset.actionLayout='measured';
   for(const a of placed){
    const button=buttons[Number(a.id)];
    if(!original.has(button))original.set(button,new Map(properties.map(name=>[name,button.style.getPropertyValue(name)])));
    Object.assign(button.style,{position:'fixed',left:`${a.x}px`,top:`${a.y}px`,right:'auto',bottom:'auto',width:`${a.w}px`,height:`${a.h}px`,transform:'none',transitionProperty:'border-color, background, opacity',pointerEvents:'auto'});
   }
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;layout();});};
  const observer=new MutationObserver(schedule);observer.observe(shell,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);resize?.observe(game);
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  document.fonts?.addEventListener('loadingdone',schedule);
  layout();
  return()=>{stopped=true;cancelAnimationFrame(frame);observer.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);document.fonts?.removeEventListener('loadingdone',schedule);restore();};
 },[root,enabled,generation]);
}
