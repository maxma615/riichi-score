import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {RoomView} from '../domain/types';
import {table3dLayout,type TablePiece} from './table3d-layout';
import {Table3DRenderer,type ScreenPoint} from './table3d-renderer';
import {publishProjectedTile,publishProjectedTable,clearProjectedTable} from './table3d-projection';
import type {Tablecloth} from './tablecloth';

type Props={room:RoomView;ownSeat:number;tableRef:RefObject<HTMLDivElement|null>;cloth:Tablecloth;openingAge:number|null;revealedHands:ReadonlyArray<{seat:number;hand:string}>;hiddenEventIds:ReadonlySet<string>;discardTarget:boolean};
function proxy(table:HTMLElement,p:TablePiece):HTMLElement|null{
 const seat=String(p.seat);
 if(p.kind==='river')return [...table.querySelectorAll<HTMLElement>('[data-discard-event-id]')].find(e=>e.dataset.discardEventId===p.eventId)?.querySelector('.mahjong-tile')??null;
 if(p.kind==='concealed')return table.querySelectorAll<HTMLElement>('[data-motion-rack-seat="'+seat+'"] > i')[p.index??0]?.querySelector('[data-motion-surface]')??null;
 if(p.kind==='nuki')return table.querySelector('[data-nuki-seat="'+seat+'"] [data-nuki-index="'+p.index+'"] .mahjong-tile');
 if(p.kind==='meld'){
  const group=table.querySelector('[data-meld-seat="'+seat+'"][data-meld-index="'+p.meldIndex+'"]');
  const slot=group?.querySelector('.mahjong-meld__tiles')?.children[p.slotIndex??0];
  const target=p.layer?slot?.querySelector('[data-layer="'+p.layer+'"]'):slot;
  return target?.querySelector<HTMLElement>('.mahjong-tile, .mahjong-meld__back-cap')??null;
 }
 return null;
}
export function MahjongTableWebGL(props:Props){
 const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<Table3DRenderer|null>(null),latest=useRef(props);latest.current=props;
 const [error,setError]=useState(false);
 const revealKey=props.revealedHands.map(h=>h.seat+":"+h.hand).join("|");
 useLayoutEffect(()=>{
  const node=canvas.current,table=node?.closest<HTMLDivElement>('.mahjong-table'),game=table?.closest<HTMLElement>('.mahjong-game');
  if(!node||!table||!game)return;
  let scene:Table3DRenderer;
  const fallback=()=>{delete game.dataset.tableRenderer;clearProjectedTable(table);setError(true);};
  try{scene=new Table3DRenderer(node);renderer.current=scene;}catch{fallback();return;}
  const toViewport=(p:ScreenPoint):ScreenPoint=>{
   const r=table.getBoundingClientRect(),rotated=game.dataset.tableRotated==='true';
   return rotated?{x:r.right-p.y,y:r.top+p.x}:{x:r.left+p.x,y:r.top+p.y};
  };
  const sync=()=>{
   const current=latest.current;
   if(scene.contextLost||game.dataset.tableRenderer!=="webgl"){clearProjectedTable(table);return;}
   clearProjectedTable(table);
   const blocked:ScreenPoint[][]=[];
   for(const result of scene.projectedPieces()){
    const {piece,points,depth,normalPoints}=result,node=proxy(table,piece),mapped=points.map(toViewport);
    if(piece.kind==='concealed'||piece.kind==='meld'||piece.kind==='nuki')blocked.push(result.hull.map(toViewport));
    if(!node)continue;
    const xs=mapped.map(p=>p.x),ys=mapped.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys);
    const quad={topLeft:mapped[0],topRight:mapped[1],bottomRight:mapped[2],bottomLeft:mapped[3]};
    const edge=(a:ScreenPoint,b:ScreenPoint)=>Math.hypot(b.x-a.x,b.y-a.y);
    publishProjectedTile(node,{rect:{left,top,width:Math.max(...xs)-left,height:Math.max(...ys)-top},
     geometry:{width:Math.max(1,(edge(mapped[0],mapped[1])+edge(mapped[3],mapped[2]))/2),height:Math.max(1,(edge(mapped[0],mapped[3])+edge(mapped[1],mapped[2]))/2),
      angle:Math.atan2(mapped[1].y-mapped[0].y,mapped[1].x-mapped[0].x)*180/Math.PI,scale:1,quad,depth:Math.max(1,depth),normal:{depth:Math.max(1,depth),topLeft:toViewport(normalPoints[0]),topRight:toViewport(normalPoints[1])}}});
   }
   const felt=scene.feltPolygon();
   table.style.setProperty('--table-felt-clip','polygon('+felt.map(p=>p.x+'px '+p.y+'px').join(',')+')');
   publishProjectedTable(table,{felt:felt.map(toViewport),blocked});
   scene.setVisibility(piece=>{
    const face=proxy(table,piece);
    if(piece.eventId&&current.hiddenEventIds.has(piece.eventId))return false;
    return !face||!(face.closest('.is-discard-motion-hidden')||getComputedStyle(face).visibility==='hidden');
   });
  };
  const resize=()=>{scene.resize(table.clientWidth,table.clientHeight);sync();};
  scene.onRendered=()=>{game.dataset.tableRenderer='webgl';setError(false);sync();};
  scene.onFailure=fallback;
  const observer=new ResizeObserver(resize);observer.observe(table);
  const mutation=new MutationObserver(entries=>{if(entries.some(e=>(e.target as Element).closest?.('.mahjong-table__surface'))){sync();scene.requestRender();}});
  mutation.observe(table,{subtree:true,attributes:true,attributeFilter:['class','style']});
  const visible=()=>{if(document.visibilityState!=='hidden'){resize();scene.requestRender();}};
  document.addEventListener('visibilitychange',visible);window.addEventListener('resize',resize);
  resize();
  return()=>{observer.disconnect();mutation.disconnect();document.removeEventListener('visibilitychange',visible);window.removeEventListener('resize',resize);clearProjectedTable(table);table.style.removeProperty('--table-felt-clip');delete game.dataset.tableRenderer;scene.dispose();renderer.current=null;};
 },[props.tableRef]);
 useLayoutEffect(()=>{
  const scene=renderer.current,table=canvas.current?.closest<HTMLDivElement>('.mahjong-table');if(!scene||!table)return;
  // Meshes remain registered while their DOM flight proxy is temporarily hidden.
  scene.setPieces(table3dLayout(props.room,props.ownSeat,{openingAge:props.openingAge,revealedHands:props.revealedHands}));
  scene.setRoom(props.room,props.ownSeat,props.cloth);
  scene.resize(table.clientWidth,table.clientHeight);
  // Synchronous render publishes projection before parent motion layout effects.
  scene.renderNow();
 },[props.room,props.ownSeat,props.openingAge,revealKey,props.hiddenEventIds,props.cloth,props.tableRef]);
 useLayoutEffect(()=>renderer.current?.setDropTarget(props.discardTarget),[props.discardTarget]);
 return <><canvas ref={canvas} className={"mahjong-table-webgl"+(error?" is-failed":"")} aria-label="三维麻将牌桌" data-testid="mahjong-webgl"/>{error?<small className="mahjong-webgl-error" role="status">三维渲染未能启动，请检查浏览器硬件加速</small>:null}</>;
}
