// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as projection from '../../../src/online/client/table3d-projection';
import { measureDiscardElement } from '../../../src/online/client/use-discard-motion';

let table: HTMLDivElement, face: HTMLSpanElement;
let bounds = { left: 10, top: 20, width: 600, height: 400 };
const quad = { topLeft: {x:500,y:100}, topRight:{x:500,y:140}, bottomRight:{x:440,y:140}, bottomLeft:{x:440,y:100} };
const tile = { rect:{left:440,top:100,width:60,height:40}, geometry:{width:40,height:60,angle:90,scale:1,quad,depth:12} };
const felt = [{x:100,y:50},{x:500,y:50},{x:550,y:350},{x:50,y:350}];
beforeEach(()=>{
  expect(projection.publishProjectedTile).toBeTypeOf('function');
  bounds={left:10,top:20,width:600,height:400};
  const game=document.createElement('section');game.className='mahjong-game';
  table=document.createElement('div');table.className='mahjong-table';game.append(table);document.body.append(game);
  face=document.createElement('span');face.className='mahjong-tile';table.append(face);
  table.getBoundingClientRect=()=>({...bounds,x:bounds.left,y:bounds.top,right:bounds.left+bounds.width,bottom:bounds.top+bounds.height,toJSON(){}});
});
afterEach(()=>document.body.replaceChildren());
describe('projected table motion geometry',()=>{
  it('measures the real rotated tile face instead of its transparent DOM proxy',()=>{
    projection.publishProjectedTile(face,tile);
    const measurement=measureDiscardElement(face);
    expect(measurement?.rect).toEqual({left:440,top:100,width:60,height:40});
    expect(measurement?.geometry).toEqual(tile.geometry);
    expect(projection.projectedRect(face)).toMatchObject({left:440,right:500,top:100,bottom:140,width:60,height:40});
  });
  it('accepts viewport felt points and rejects both outside and projected blockers',()=>{
    projection.publishProjectedTable(table,{felt,blocked:[[{x:200,y:200},{x:250,y:200},{x:250,y:250},{x:200,y:250}]]});
    expect(projection.projectedDiscardTarget(table,300,200)).toBe(true);
    expect(projection.projectedDiscardTarget(table,70,80)).toBe(false);
    expect(projection.projectedDiscardTarget(table,220,220)).toBe(false);
    expect(projection.projectedDiscardTarget(table,200,220)).toBe(false);
  });
  it('keeps corner identity when the complete table is rotated',()=>{
    table.closest<HTMLElement>('.mahjong-game')!.dataset.tableRotated='true';
    projection.publishProjectedTile(face,tile);
    expect(projection.readProjectedTile(face)?.geometry.quad?.topLeft).toEqual({x:500,y:100});
    expect(projection.readProjectedTile(face)?.geometry.quad?.bottomLeft).toEqual({x:440,y:100});
  });
  it('clears all prior tile endpoints and hit regions before a new scene',()=>{
    projection.publishProjectedTile(face,tile);projection.publishProjectedTable(table,{felt,blocked:[]});
    projection.clearProjectedTable(table);
    expect(projection.readProjectedTile(face)).toBeNull();
    expect(projection.projectedDiscardTarget(table,300,200)).toBeNull();
    projection.publishProjectedTable(table,{felt,blocked:[]});
    expect(projection.readProjectedTile(face)).toBeNull();
  });
  it('invalidates stale coordinates after resize, rotation and element removal',()=>{
    projection.publishProjectedTile(face,tile);bounds={...bounds,width:700};
    expect(projection.readProjectedTile(face)).toBeNull();
    projection.publishProjectedTile(face,tile);
    table.closest<HTMLElement>('.mahjong-game')!.dataset.tableRotated='true';
    expect(projection.readProjectedTile(face)).toBeNull();
    projection.publishProjectedTile(face,tile);face.remove();
    expect(projection.readProjectedTile(face)).toBeNull();
  });
  it('uses projected child bounds for action-placement wrappers',()=>{
    const wrapper=document.createElement('span');table.append(wrapper);wrapper.append(face);
    projection.publishProjectedTile(face,tile);
    expect(projection.projectedRect(wrapper)).toMatchObject({left:440,top:100,width:60,height:40});
  });
  it('rejects invalid polygons and does not accept nonfinite pointer coordinates',()=>{
    projection.publishProjectedTable(table,{felt,blocked:[]});
    expect(projection.projectedDiscardTarget(table,NaN,200)).toBe(false);
    projection.publishProjectedTable(table,{felt:[{x:0,y:0},{x:0,y:0}],blocked:[]});
    expect(projection.projectedDiscardTarget(table,300,200)).toBeNull();
  });
});
