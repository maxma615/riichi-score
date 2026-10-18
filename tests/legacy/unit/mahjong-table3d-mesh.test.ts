// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import * as table from '../../../src/online/client/table3d-renderer';
import {TILE} from '../../../src/online/client/table3d-layout';
describe('actual three dimensional tile body',()=>{
 it('has independent geometric width, height and depth, including curved edge normals',()=>{
  expect(typeof table.createTileBodyGeometry).toBe('function');
  const geometry=table.createTileBodyGeometry();geometry.computeBoundingBox();
  const size=geometry.boundingBox!.getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(TILE.width);expect(size.y).toBeCloseTo(TILE.height);expect(size.z).toBeCloseTo(TILE.depth);
  const normals=geometry.getAttribute('normal'),values=new Set<string>();
  for(let i=0;i<normals.count;i++)values.add([normals.getX(i),normals.getY(i),normals.getZ(i)].map(n=>n.toFixed(2)).join(','));
  expect(values.size).toBeGreaterThan(20);geometry.dispose();
 });
 it('intersects opposite physical surfaces instead of one flat image plane',()=>{
  expect(typeof table.createTileBodyGeometry).toBe('function');
  const geometry=table.createTileBodyGeometry(),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();
  const cast=(origin:THREE.Vector3,direction:THREE.Vector3)=>new THREE.Raycaster(origin,direction).intersectObject(mesh)[0].point;
  const front=cast(new THREE.Vector3(0,0,4),new THREE.Vector3(0,0,-1));
  const back=cast(new THREE.Vector3(0,0,-4),new THREE.Vector3(0,0,1));
  expect(front.z-back.z).toBeCloseTo(TILE.depth);expect(front.z).toBeGreaterThan(0);expect(back.z).toBeLessThan(0);
  geometry.dispose();material.dispose();
 });
});
