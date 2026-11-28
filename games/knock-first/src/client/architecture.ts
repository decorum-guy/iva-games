import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { KnockLevel } from '../core/types';

/** Decorative construction only. Never enters collision, detection or acoustic data. */
export function buildArchitecture(level: KnockLevel, materials: Record<string, THREE.MeshStandardMaterial>): THREE.Group {
  const root = new THREE.Group(); root.name = 'Archive architectural finish';
  const bins = new Map<string, THREE.BufferGeometry[]>();
  const add = (mat: string, geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) => {
    if (geo.index) { const source=geo; geo=geo.toNonIndexed(); source.dispose(); }
    geo.rotateY(yaw); geo.translate(x, y, z); const bin = bins.get(mat) ?? []; bin.push(geo); bins.set(mat, bin);
  };
  const box = (mat: string, x:number,y:number,z:number,w:number,h:number,d:number,yaw=0) => add(mat,new RoundedBoxGeometry(w,h,d,1,Math.min(.018,w/5,h/5,d/5)),x,y,z,yaw);
  for (const wall of level.walls.filter(w=>!w.id.startsWith('prop-'))) {
    const {x,y,z}=wall.position, across=wall.size.x>wall.size.z, length=across?wall.size.x:wall.size.z, yaw=across?0:Math.PI/2;
    // Inset panels, recessed joints, continuous skirting and waterline seam.
    box('dark',x,y-1.49,z,length,.14,across?.31:wall.size.x,yaw);
    box('metal',x,y-.58,z,length,.055,.30,yaw);
    box('dark',x,y+1.44,z,length,.10,.31,yaw);
    for(const s of [-1,1]) {
      const offset=length/2-.045;
      box('metal',x+(across?s*offset:0),y,z+(across?0:s*offset),.07,3.13,.30,yaw);
    }
  }
  for(const zone of level.zones) {
    const {x,y,z}=zone.center;
    // Ceiling coffer and cable raceways leave floor clearance untouched.
    for(const side of [-1,1]) {
      box('dark',x+side*2.85,y+3.15,z,.24,.22,9.75);
      box('metal',x+side*2.85,y+3.025,z,.32,.035,9.7);
      for(let t=-4.5;t<=4.5;t+=.5) box('bronze',x+side*2.85,y+3.015,z+t,.35,.025,.025);
      for(let t=-4;t<=4;t+=2) {
        box('metal',x+t,y+3.22,z+side*2.8,.075,.15,4.15);
      }
    }
    if(zone.safe) for(const sx of [-1,1]) for(const sz of [-1,1]) {
      box('dark',x+sx*3,y+2.93,z+sz*3,.68,.16,.32);
      box('lamp',x+sx*3,y+2.835,z+sz*3,.52,.04,.21);
      for(const t of [-.22,0,.22]) box('dark',x+sx*3+t,y+2.80,z+sz*3,.018,.04,.28);
    }
    // Cross beams, bolted corner piers and damp basal plinths.
    for(const t of [-3,0,3]) box('metal',x,y+3.20,z+t,9.7,.18,.13);
    for(const sx of [-1,1])for(const sz of [-1,1]) {
      box('concrete',x+sx*4.83,y+1.6,z+sz*4.83,.30,3.2,.30);
      box('dark',x+sx*4.81,y+.21,z+sz*4.81,.37,.42,.37);
    }
  }
  for(const portal of level.portals.filter(p=>!p.channel)) {
    const a=new THREE.Vector3(portal.aPoint.x,portal.aPoint.y,portal.aPoint.z),b=new THREE.Vector3(portal.bPoint.x,portal.bPoint.y,portal.bPoint.z);
    const horizontal=Math.abs(a.x-b.x)>Math.abs(a.z-b.z), yaw=horizontal?Math.PI/2:0;
    for(const t of [0,.25,.5,.75,1]) {
      const p=a.clone().lerp(b,t);
      box('metal',p.x,p.y+3.10,p.z,3.04,.16,.16,yaw);
      for(const s of [-1,1]) {
        box('metal',p.x+(horizontal?0:s*1.45),p.y+1.56,p.z+(horizontal?s*1.45:0),.10,3.10,.12,yaw);
      }
    }
    // Two real overhead pipe runs, hanger straps and bolted flanges.
    const length=a.distanceTo(b);
    for(const s of [-1,1]) {
      const offset=new THREE.Vector3(horizontal?0:s*.95,2.75,horizontal?s*.95:0);
      const pipe=new THREE.CylinderGeometry(.065,.065,length,12);
      pipe.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));
      const mid=a.clone().lerp(b,.5).add(offset);add('metal',pipe,mid.x,mid.y,mid.z);
      for(const t of [.1,.5,.9]) {
        const p=a.clone().lerp(b,t).add(offset); const flange=new THREE.CylinderGeometry(.10,.10,.065,12);
        flange.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));add('bronze',flange,p.x,p.y,p.z);
        box('dark',p.x,p.y+.17,p.z,.035,.3,.035);
      }
    }
  }
  for(const [mat,geometries] of bins) {
    const geometry=mergeGeometries(geometries);if(!geometry)continue;
    const mesh=new THREE.Mesh(geometry,materials[mat]);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
    geometries.forEach(g=>g.dispose());
  }
  return root;
}
