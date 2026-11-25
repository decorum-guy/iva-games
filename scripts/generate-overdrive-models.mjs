/** Original Chess 2 geometry; no downloaded models or textures incorporated. */
import * as T from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(value).toString('base64'); this.onloadend?.() }) }
}
const out = new URL('../public/assets/overdrive/models/', import.meta.url)
await mkdir(out, { recursive: true })
const body = new T.MeshStandardMaterial({ name: 'ceramic', color: '#eaf0ee', metalness: .2, roughness: .29 })
const metal = new T.MeshStandardMaterial({ name: 'aluminium', color: '#a8b8c3', metalness: .82, roughness: .27 })
const core = new T.MeshStandardMaterial({ name: 'power', color: '#e16b36', metalness: .58, roughness: .3, emissive: '#ec6b2c', emissiveIntensity: .12 })
const dark = new T.MeshStandardMaterial({ name: 'inset', color: '#1a3a50', metalness: .45, roughness: .35 })
function mesh(group, geometry, material, xyz, name) {
  const item = new T.Mesh(geometry, material); item.name = name; item.position.set(...xyz); group.add(item); return item
}
function cylinder(g, top, bottom, height, y, material=body, name='body', segments=32) {
  return mesh(g, new T.CylinderGeometry(top,bottom,height,segments),material,[0,y,0],name)
}
function box(g,x,y,z,px,py,pz,material=body,name='body') { return mesh(g,new T.BoxGeometry(x,y,z),material,[px,py,pz],name) }
function ring(g,radius,tube,y,material=metal,name='ring') {
  const m=mesh(g,new T.TorusGeometry(radius,tube,8,40),material,[0,y,0],name);m.rotation.x=Math.PI/2;return m
}
function base() {
  const g=new T.Group()
  cylinder(g,.275,.31,.07,.035,metal,'foot');cylinder(g,.245,.275,.095,.1175,body,'mount')
  ring(g,.245,.018,.17,core,'power_collar');cylinder(g,.125,.23,.24,.29,body,'stem')
  cylinder(g,.125,.125,.08,.43,dark,'neck');ring(g,.127,.015,.435,core,'power_neck')
  return g
}
const models={}
for (const type of ['pawn','knight','bishop','rook','queen','king']) {
  const g=base();g.name=type
  if(type==='pawn') {
    cylinder(g,.165,.12,.07,.485,metal)
    mesh(g,new T.SphereGeometry(.172,24,16),body,[0,.61,0],'pawn_head')
    ring(g,.162,.009,.61,core,'power_cap')
  }
  if(type==='knight') {
    const shape=new T.Shape();shape.moveTo(-.17,.45);shape.lineTo(-.19,.79);shape.lineTo(-.08,1.0);shape.lineTo(.02,.88);shape.lineTo(.17,.79);shape.lineTo(.24,.6);shape.lineTo(.16,.54);shape.lineTo(.03,.66);shape.lineTo(-.035,.46);shape.closePath()
    const geo=new T.ExtrudeGeometry(shape,{depth:.2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.025,bevelThickness:.025});geo.translate(0,0,-.1)
    mesh(g,geo,body,[0,0,0],'horse_profile')
    for(const s of [-1,1]) mesh(g,new T.SphereGeometry(.023,10,8),core,[.09,.762,s*.128],'power_eye')
    for(let i=0;i<4;i++) box(g,.042,.1,.22,-.18+i*.018,.72+i*.053,0,metal,'mane_'+i)
  }
  if(type==='bishop') {
    cylinder(g,.20,.12,.10,.49,metal)
    for(const s of [-1,1]) {
      const shape=new T.Shape();shape.moveTo(s*.027,.55);shape.lineTo(s*.17,.60);shape.quadraticCurveTo(s*.24,.77,s*.032,.99);shape.lineTo(s*.027,.55)
      const geo=new T.ExtrudeGeometry(shape,{depth:.15,bevelEnabled:true,bevelSize:.012,bevelThickness:.015,bevelSegments:2,steps:1});geo.translate(0,0,-.075)
      mesh(g,geo,body,[0,0,0],'split_cap_'+s)
    }
    box(g,.025,.22,.12,0,.69,0,core,'power_split')
  }
  if(type==='rook') {
    cylinder(g,.22,.145,.25,.55,body)
    cylinder(g,.25,.22,.07,.71,metal)
    cylinder(g,.19,.19,.045,.74,dark,'turret_well')
    for(let i=0;i<4;i++) {const a=i*Math.PI/2;const m=box(g,.14,.13,.12,Math.sin(a)*.18,.81,Math.cos(a)*.18,body,'turret_'+i);m.rotation.y=a}
    for(let i=0;i<6;i++){const a=i*Math.PI/3;const m=box(g,.025,.15,.03,Math.sin(a)*.194,.58,Math.cos(a)*.194,core,'power_slot_'+i);m.rotation.y=a}
  }
  if(type==='queen') {
    cylinder(g,.19,.12,.17,.55,body);cylinder(g,.21,.16,.08,.67,metal)
    cylinder(g,.055,.07,.10,.74,metal,'crown_support')
    for(let i=0;i<7;i++) {const a=i*Math.PI*2/7;const m=mesh(g,new T.ConeGeometry(.054,.26,5),body,[Math.sin(a)*.17,.83,Math.cos(a)*.17],'crown_'+i);m.rotation.z=-Math.sin(a)*.18;m.rotation.x=Math.cos(a)*.18;mesh(g,new T.SphereGeometry(.035,10,8),core,[Math.sin(a)*.185,.965,Math.cos(a)*.185],'power_tip_'+i)}
    mesh(g,new T.SphereGeometry(.10,20,14),body,[0,.83,0],'crown_heart')
  }
  if(type==='king') {
    cylinder(g,.18,.12,.22,.57,body);ring(g,.18,.025,.69,metal)
    cylinder(g,.13,.18,.12,.77,body)
    box(g,.105,.28,.105,0,.96,0,body,'cross_vertical');box(g,.29,.095,.105,0,.99,0,body,'cross_horizontal')
    box(g,.035,.15,.012,0,.985,.06,core,'power_cross')
  }
  g.updateMatrixWorld(true)
  const bounds=new T.Box3().setFromObject(g);const size=bounds.getSize(new T.Vector3())
  let triangles=0;g.traverse(o=>{if(o.isMesh) triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
  const result=await new GLTFExporter().parseAsync(g,{binary:true,onlyVisible:true})
  const bytes=Buffer.from(result);await writeFile(new URL(type+'.glb',out),bytes)
  models[type]={file:type+'.glb',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),triangles,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray()}}
}
await writeFile(new URL('manifest.json',out),JSON.stringify({generator:'scripts/generate-overdrive-models.mjs',source:'Original procedural geometry created for Chess 2 OVERDRIVE; no third-party model data',units:'cell=1',models},null,2)+'\n')
console.log(JSON.stringify(models,null,2))
