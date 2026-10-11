/** Viewport rectangles only; game decisions and tile identities never enter here. */
export type PlacementRect={x:number;y:number;w:number;h:number};
export type ActionPlacement=PlacementRect&{id:string};
export function rectanglesOverlap(a:PlacementRect,b:PlacementRect,gap=2){
 return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
}
/** Expanded edges are cached once; comparisons retain their original precision. */
export function buildObstacleHitTest(obstacles:PlacementRect[]){
 const edges=new Float64Array(obstacles.length*4);
 for(let i=0;i<obstacles.length;i++){const r=obstacles[i],j=i*4;edges[j]=r.x-2;edges[j+1]=r.y-2;edges[j+2]=r.x+r.w+2;edges[j+3]=r.y+r.h+2;}
 return (a:PlacementRect)=>{const right=a.x+a.w,bottom=a.y+a.h;for(let i=0;i<edges.length;i+=4){if(a.x<edges[i+2]&&right>edges[i]&&a.y<edges[i+3]&&bottom>edges[i+1])return true;}return false;};
}
const fits=(r:PlacementRect,b:PlacementRect)=>r.x>=b.x&&r.y>=b.y&&r.x+r.w<=b.x+b.w&&r.y+r.h<=b.y+b.h;
/** Keep valid CSS positions. Otherwise search a bounded beam of nearby clear
 * positions, placing wide previews first so small actions do not box them in. */
export function placeMahjongActions(actions:ActionPlacement[],obstacles:PlacementRect[],bounds:PlacementRect):ActionPlacement[]|null{
 const finite=(r:PlacementRect)=>[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0;
 if(!finite(bounds)||actions.some(a=>!finite(a)))return null;
 const blocked=obstacles.filter(finite),gap=2;
 if(actions.every((a,i)=>fits(a,bounds)&&!blocked.some(b=>rectanglesOverlap(a,b,gap))&&!actions.some((b,j)=>j<i&&rectanglesOverlap(a,b,gap))))return actions.map(a=>({...a}));
 const hitsObstacle=buildObstacleHitTest(blocked);
 const order=actions.map((a,index)=>({a,index})).sort((a,b)=>b.a.w*b.a.h-a.a.w*a.a.h||a.index-b.index);
 type State={placed:ActionPlacement[];score:number};let beam:State[]=[{placed:[],score:0}];
 for(const {a} of order){
  const xs=new Set([a.x,bounds.x,bounds.x+bounds.w-a.w]),ys=new Set([a.y,bounds.y,bounds.y+bounds.h-a.h]);
  for(const r of [...blocked,...actions]){xs.add(r.x-a.w-gap);xs.add(r.x+r.w+gap);ys.add(r.y-a.h-gap);ys.add(r.y+r.h+gap);}
  for(let x=bounds.x;x<=bounds.x+bounds.w-a.w;x+=16)xs.add(x);
  for(let y=bounds.y;y<=bounds.y+bounds.h-a.h;y+=16)ys.add(y);
  const candidates:{rect:ActionPlacement;score:number}[]=[];
  for(const x of xs)for(const y of ys){
   const rect={...a,x,y};if(!fits(rect,bounds)||hitsObstacle(rect))continue;
   candidates.push({rect,score:Math.abs(x-a.x)+1.5*Math.abs(y-a.y)});
  }
  candidates.sort((a,b)=>a.score-b.score||a.rect.y-b.rect.y||a.rect.x-b.rect.x);
  // Retain distant clear pockets as well as nearby points. A dense river can
  // otherwise fill the shortlist with tiny variations of the same dead end.
  const retained=new Set(candidates.slice(0,96)),buckets=new Map<string,number>();
  for(const candidate of candidates){
   const r=candidate.rect,key=`${Math.min(3,Math.floor((r.x+r.w/2-bounds.x)/bounds.w*4))}:${Math.min(3,Math.floor((r.y+r.h/2-bounds.y)/bounds.h*4))}`;
   const count=buckets.get(key)||0;if(count<16){retained.add(candidate);buckets.set(key,count+1);}
  }
  let worstScore=Infinity;
  const next:State[]=[],shortlist=[...retained].sort((a,b)=>a.score-b.score);
  for(const state of beam)for(const candidate of shortlist){
   const score=state.score+candidate.score;
   if(next.length>=24&&score>worstScore)break;
   if(state.placed.some(b=>rectanglesOverlap(candidate.rect,b,gap)))continue;
   next.push({placed:[...state.placed,candidate.rect],score});
   if(next.length>=24){next.sort((a,b)=>a.score-b.score);next.length=24;worstScore=next[23].score;}
  }
  next.sort((a,b)=>a.score-b.score);beam=next.slice(0,24);if(!beam.length)return null;
 }
 const result=new Map(beam[0].placed.map(a=>[a.id,a]));return actions.map(a=>result.get(a.id)!);
}
