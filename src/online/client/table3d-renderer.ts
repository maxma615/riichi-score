import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {TILE,TABLE,type TablePiece} from './table3d-layout';
import type {RoomView} from '../domain/types';
import {asset} from './api-client';

const tileFiles:Record<string,string>={z1:'Ton',z2:'Nan',z3:'Shaa',z4:'Pei',z5:'Haku',z6:'Hatsu',z7:'Chun'};
const tileFile=(value:string)=>tileFiles[value.slice(0,2)]||({m:'Man',p:'Pin',s:'Sou'}[value[0]]||'Blank')+(value[1]==='0'?'5-Dora':value[1]);
export type ScreenPoint={x:number;y:number};
export type ProjectedPiece={piece:TablePiece;points:ScreenPoint[];bounds:{left:number;top:number;width:number;height:number};depth:number;normalPoints:ScreenPoint[];hull:ScreenPoint[]};
function hull(points:ScreenPoint[]):ScreenPoint[]{
 const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o:ScreenPoint,a:ScreenPoint,b:ScreenPoint)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
 const lower:ScreenPoint[]=[],upper:ScreenPoint[]=[];
 for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
 for(const p of sorted.slice().reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const clothColors={midnight:0x17394a,plum:0x392b43,graphite:0x2b3338};

export const createTileBodyGeometry=()=>new RoundedBoxGeometry(TILE.width,TILE.height,TILE.depth,2,.065);

/** Real solid meshes. Face art is a texture on the +Z side, never a replacement
 * for the .6-unit body. Every physical object uses one depth-buffered camera. */
export class Table3DRenderer {
 readonly scene=new THREE.Scene();
 readonly camera=new THREE.PerspectiveCamera(35,1,.1,200);
 readonly renderer:THREE.WebGLRenderer;
 readonly tiles=new Map<string,{piece:TablePiece;group:THREE.Group}>();
 private geometry=createTileBodyGeometry();
 private backGeometry=new RoundedBoxGeometry(TILE.width*.98,TILE.height*.98,.13,2,.045);
 private faceGeometry=new THREE.PlaneGeometry(TILE.width*.88,TILE.height*.91);
 private ivory=new THREE.MeshStandardMaterial({color:0xfffae9,roughness:.32,metalness:0});
 private back=new THREE.MeshStandardMaterial({color:0xc47d35,roughness:.34,metalness:.04});
 private faceMaterials=new Map<string,THREE.MeshStandardMaterial>();
 private textures:THREE.Texture[]=[];
 private ownedGeometries:THREE.BufferGeometry[]=[];
 private ownedMaterials:THREE.Material[]=[];
 private felt:THREE.MeshStandardMaterial;
 private centerTexture:THREE.CanvasTexture;
 private centerCanvas:HTMLCanvasElement;
 private dropOutline:THREE.LineLoop;
 private shadowLight:THREE.DirectionalLight;
 private width=1;private height=1;private frame=0;private disposed=false;private lost=false;
 private restore=()=>{this.lost=false;this.requestRender();};
 private lose=(event:Event)=>{event.preventDefault();this.lost=true;cancelAnimationFrame(this.frame);this.frame=0;this.onFailure?.();};
 onRendered?:()=>void;
 onFailure?:()=>void;
 constructor(readonly canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure=1.25;
  this.renderer.shadowMap.enabled=true;
  this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.scene.background=new THREE.Color(0x101920);
  this.scene.add(new THREE.HemisphereLight(0xdcecff,0x6e5540,2.7));
  const sun=new THREE.DirectionalLight(0xfff0d0,3.1);
  this.shadowLight=sun;sun.position.set(-12,27,16);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-23;sun.shadow.camera.right=23;
  sun.shadow.camera.top=21;sun.shadow.camera.bottom=-21;sun.shadow.camera.near=1;sun.shadow.camera.far=65;
  sun.shadow.bias=-.0006;sun.shadow.normalBias=.035;
  this.scene.add(sun);
  const fill=new THREE.DirectionalLight(0xc7ddff,1.2);fill.position.set(12,13,-18);this.scene.add(fill);
  this.felt=new THREE.MeshStandardMaterial({color:clothColors.midnight,roughness:.95,metalness:0});
  // Procedural fabric has no downloaded artwork or runtime network dependency.
  const weave=document.createElement('canvas');weave.width=128;weave.height=128;
  const ctx=weave.getContext('2d')!;
  ctx.fillStyle='#c5cbd0';ctx.fillRect(0,0,128,128);
  for(let y=0;y<128;y+=2)for(let x=0;x<128;x+=2){ctx.fillStyle=(x+y)%4===0?'#adb7bf':'#d9dddf';ctx.fillRect(x,y,1,1);}
  const bump=new THREE.CanvasTexture(weave);bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.repeat.set(25,20);
  const color=bump.clone();color.colorSpace=THREE.SRGBColorSpace;color.needsUpdate=true;
  this.textures.push(bump,color);this.felt.map=color;this.felt.bumpMap=bump;this.felt.bumpScale=.045;
  this.box(TABLE.width+1,.7,TABLE.depth+1,0,-.4,0,new THREE.MeshStandardMaterial({color:0x1a2630,roughness:.5,metalness:.18}));
  const cloth=new THREE.Mesh(new THREE.PlaneGeometry(TABLE.width,TABLE.depth),this.felt);
  cloth.rotation.x=-Math.PI/2;cloth.receiveShadow=true;cloth.position.y=.005;this.scene.add(cloth);this.ownedGeometries.push(cloth.geometry);
  const outlineGeometry=new THREE.BufferGeometry().setFromPoints([[-16.9,.028,-12.9],[16.9,.028,-12.9],[16.9,.028,12.9],[-16.9,.028,12.9]].map(p=>new THREE.Vector3(...p)));
  const outlineMaterial=new THREE.LineBasicMaterial({color:0xffd489,transparent:true,opacity:.9});
  this.dropOutline=new THREE.LineLoop(outlineGeometry,outlineMaterial);this.dropOutline.visible=false;this.scene.add(this.dropOutline);
  this.ownedGeometries.push(outlineGeometry);this.ownedMaterials.push(outlineMaterial);
  const rim=new THREE.MeshStandardMaterial({color:0x48515b,roughness:.4,metalness:.28});
  this.ownedMaterials.push(rim,this.felt);
  this.box(TABLE.width+1,.3,.5,0,.02,-(TABLE.depth+.5)/2,rim);
  this.box(TABLE.width+1,.3,.5,0,.02,(TABLE.depth+.5)/2,rim);
  this.box(.5,.3,TABLE.depth,-(TABLE.width+.5)/2,.02,0,rim);
  this.box(.5,.3,TABLE.depth,(TABLE.width+.5)/2,.02,0,rim);
  // A raised central console participates in occlusion and receives the same light.
  const consoleBody=this.box(5,.36,4.9,0,.18,0,new THREE.MeshStandardMaterial({color:0x172c33,roughness:.4,metalness:.12}));
  consoleBody.receiveShadow=true;
  this.centerCanvas=document.createElement('canvas');this.centerCanvas.width=768;this.centerCanvas.height=768;
  this.centerTexture=new THREE.CanvasTexture(this.centerCanvas);this.centerTexture.colorSpace=THREE.SRGBColorSpace;this.textures.push(this.centerTexture);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(4.75,4.65),new THREE.MeshStandardMaterial({map:this.centerTexture,roughness:.65}));
  screen.rotation.x=-Math.PI/2;screen.position.y=.368;this.scene.add(screen);
  this.ownedGeometries.push(screen.geometry);this.ownedMaterials.push(screen.material);
  canvas.addEventListener('webglcontextlost',this.lose);
  canvas.addEventListener('webglcontextrestored',this.restore);
 }
 private box(w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.MeshStandardMaterial){
  const geometry=new RoundedBoxGeometry(w,h,d,2,.06);
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;
  this.scene.add(mesh);this.ownedGeometries.push(geometry);
  if(!this.ownedMaterials.includes(material))this.ownedMaterials.push(material);
  return mesh;
 }
 private face(value:string){
  const key=value.slice(0,2);let material=this.faceMaterials.get(key);if(material)return material;
  material=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,alphaTest:.03,roughness:.44,depthWrite:false});
  this.faceMaterials.set(key,material);
  const texture=new THREE.TextureLoader().load(asset('/online/assets/tiles/regular/'+tileFile(key)+'.svg'),()=>this.requestRender());
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  material.map=texture;this.textures.push(texture);return material;
 }
 setPieces(pieces:readonly TablePiece[]){
  const ids=new Set(pieces.map(p=>p.id));
  for(const[id,tile]of this.tiles)if(!ids.has(id)){this.scene.remove(tile.group);this.tiles.delete(id);}
  for(const piece of pieces){
   let tile=this.tiles.get(piece.id);
   if(tile&&(tile.piece.value!==piece.value||tile.piece.faceDown!==piece.faceDown)){this.scene.remove(tile.group);this.tiles.delete(piece.id);tile=undefined;}
   if(!tile){
    const group=new THREE.Group();
    const body=new THREE.Mesh(this.geometry,this.ivory);body.castShadow=true;body.receiveShadow=true;group.add(body);
    const orange=new THREE.Mesh(this.backGeometry,this.back);orange.position.z=-TILE.depth/2+.065;orange.castShadow=true;group.add(orange);
    if(piece.value){const face=new THREE.Mesh(this.faceGeometry,this.face(piece.value));face.position.z=TILE.depth/2+.003;group.add(face);}
    tile={piece,group};this.tiles.set(piece.id,tile);this.scene.add(group);
   }
   tile.piece=piece;tile.group.position.fromArray(piece.position);tile.group.rotation.set(...piece.rotation);
  }
  this.canvas.dataset.pieceCount=String(pieces.length);
  this.requestRender();
 }
 setDropTarget(visible:boolean){if(this.dropOutline.visible!==visible){this.dropOutline.visible=visible;this.requestRender();}}
 setVisibility(visible:(piece:TablePiece)=>boolean){
  let changed=false;for(const tile of this.tiles.values()){const next=visible(tile.piece);if(tile.group.visible!==next){tile.group.visible=next;changed=true;}}
  if(changed)this.requestRender();
 }
 setRoom(room:RoomView,ownSeat:number,cloth:keyof typeof clothColors){
  this.felt.color.setHex(clothColors[cloth]||clothColors.midnight);
  const game=room.game;if(!game)return;
  const ctx=this.centerCanvas.getContext('2d')!;
  ctx.fillStyle='#172e38';ctx.fillRect(0,0,768,768);ctx.strokeStyle='#769392';ctx.lineWidth=5;ctx.strokeRect(14,14,740,740);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f3ead1';ctx.font='500 68px serif';
  ctx.fillText(['东','南','西','北'][game.roundWind]+String(game.roundNumber)+'局',384,302);
  ctx.fillStyle='#b9d3d8';ctx.font='46px sans-serif';ctx.fillText('余 '+game.remainingTiles+' 张',384,390);
  ctx.font='36px sans-serif';ctx.fillText('本场 '+game.honba+'   供托 '+game.riichiSticks,384,463);
  const count=room.variant==='sanma'?3:4,wind=['东','南','西','北'];
  for(const p of game.players){
   const relative=(p.seat-ownSeat+count)%count;
   const angle=relative===1?-Math.PI/2:relative===2&&count===4?Math.PI:relative===0?0:Math.PI/2;
   ctx.save();ctx.translate(384,384);ctx.rotate(angle);
   ctx.fillStyle=p.seat===game.turnSeat?'#4b7e7c':'#253f4c';ctx.fillRect(-180,235,360,94);
   ctx.fillStyle='#f4eddc';ctx.font='bold 42px sans-serif';ctx.fillText(wind[p.wind]+' '+p.score.toLocaleString(),0,282);ctx.restore();
  }
  this.centerTexture.needsUpdate=true;this.requestRender();
 }
 resize(width:number,height:number){
  if(width<=0||height<=0)return;
  this.width=width;this.height=height;this.renderer.setSize(width,height,false);
  this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  const target=new THREE.Vector3(0,0,0),direction=new THREE.Vector3(0,.68,.734).normalize();
  let distance=40;
  for(let i=0;i<30;i++){
   this.camera.position.copy(direction).multiplyScalar(distance);this.camera.lookAt(target);this.camera.updateMatrixWorld();
   const points=[[-17.7,0,-13.7],[17.7,0,-13.7],[-17.7,0,13.7],[17.7,0,13.7],[-14,1.6,-11],[14,1.6,-11]];
   const outside=points.some(v=>{const p=new THREE.Vector3(...v).project(this.camera);return Math.abs(p.x)>.97||Math.abs(p.y)>.91;});
   if(!outside)break;distance*=1.055;
  }
  this.requestRender();
 }
 project(point:readonly number[]):ScreenPoint{
  const v=new THREE.Vector3(point[0],point[1],point[2]).project(this.camera);
  return{x:(v.x+1)*this.width/2,y:(1-v.y)*this.height/2};
 }
 projectedPieces():ProjectedPiece[]{
  this.scene.updateMatrixWorld(true);
  return [...this.tiles.values()].map(({piece,group})=>{
   // Expose the visible top face for lying pieces, and the back for concealed standing pieces.
   const back=piece.kind==='concealed'||piece.faceDown;
   const z=(back?-1:1)*(TILE.depth/2+.004);
   const local=[[-TILE.width/2,TILE.height/2,z],[TILE.width/2,TILE.height/2,z],[TILE.width/2,-TILE.height/2,z],[-TILE.width/2,-TILE.height/2,z]];
   const points=local.map(v=>this.project(new THREE.Vector3(...v).applyMatrix4(group.matrixWorld).toArray()));
   const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys);
   const normalPoints=local.slice(0,2).map(v=>this.project(new THREE.Vector3(v[0],v[1],v[2]+(back?-1:1)*TILE.depth).applyMatrix4(group.matrixWorld).toArray()));
   const depth=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)*TILE.depth/TILE.width;
   return{piece,points,bounds:{left,top,width:Math.max(...xs)-left,height:Math.max(...ys)-top},depth,normalPoints,hull:hull([-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>this.project(new THREE.Vector3(x*TILE.width/2,y*TILE.height/2,z*TILE.depth/2).applyMatrix4(group.matrixWorld).toArray())))))};
  });
 }
 feltPolygon(){return [[-TABLE.width/2,0,-TABLE.depth/2],[TABLE.width/2,0,-TABLE.depth/2],[TABLE.width/2,0,TABLE.depth/2],[-TABLE.width/2,0,TABLE.depth/2]].map(p=>this.project(p));}
 get contextLost(){return this.lost||this.renderer.getContext().isContextLost();}
 renderNow(){
  if(this.disposed||this.contextLost||document.visibilityState==='hidden')return false;
  this.renderer.render(this.scene,this.camera);
  // A context loss may be reported synchronously by a draw call.
  if(this.contextLost)return false;
  this.canvas.dataset.rendered='true';this.canvas.dataset.renderFrames=String(this.renderer.info.render.frame);this.onRendered?.();return true;
 }
 requestRender(){
  if(this.disposed||this.contextLost||this.frame)return;
  this.frame=requestAnimationFrame(()=>{this.frame=0;this.renderNow();});
 }
 dispose(){
  this.disposed=true;cancelAnimationFrame(this.frame);
  this.canvas.removeEventListener('webglcontextlost',this.lose);this.canvas.removeEventListener('webglcontextrestored',this.restore);
  this.geometry.dispose();this.backGeometry.dispose();this.faceGeometry.dispose();this.ivory.dispose();this.back.dispose();
  this.faceMaterials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());
  this.ownedGeometries.forEach(g=>g.dispose());this.ownedMaterials.forEach(m=>m.dispose());
  this.shadowLight.shadow.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.tiles.clear();
 }
}
