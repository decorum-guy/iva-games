/** Original COLOSSUS reliquary geometry. No external model or texture input. */
import * as T from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(v => { this.result=v; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then(v => { this.result='data:'+blob.type+';base64,'+Buffer.from(v).toString('base64'); this.onloadend?.() }) }
}
const out=new URL('../public/assets/colossus/models/',import.meta.url)
await mkdir(out,{recursive:true})
const stone=new T.MeshStandardMaterial({name:'ivory_stone',color:'#d8d1b7',roughness:.72,metalness:.06})
const bronze=new T.MeshStandardMaterial({name:'bronze_inlay',color:'#9d8351',roughness:.38,metalness:.74})
const dark=new T.MeshStandardMaterial({name:'recess',color:'#273b43',roughness:.85,metalness:.12})
const plate=new T.MeshStandardMaterial({name:'boss_armour',color:'#4b5960',roughness:.58,metalness:.48})
const heart=new T.MeshStandardMaterial({name:'boss_heart',color:'#d59255',emissive:'#9c3a19',emissiveIntensity:.55,roughness:.35,metalness:.35})
const mint=new T.MeshStandardMaterial({name:'ward',color:'#91bab4',emissive:'#284845',emissiveIntensity:.45,metalness:.35,roughness:.33})
function add(g,geo,mat,x=0,y=0,z=0,name='carving'){const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.name=name;g.add(m);return m}
function cyl(g,a,b,h,y,mat=stone,n=8,x=0,z=0,name='stone'){return add(g,new T.CylinderGeometry(a,b,h,n),mat,x,y,z,name)}
function box(g,w,h,d,x,y,z,mat=stone,name='stone'){return add(g,new T.BoxGeometry(w,h,d),mat,x,y,z,name)}
function ring(g,r,t,y,mat=bronze){const m=add(g,new T.TorusGeometry(r,t,5,24),mat,0,y,0,'inlay');m.rotation.x=Math.PI/2;return m}
function line(g,a,b,r,mat=bronze,name='engraving'){const d=new T.Vector3(...b).sub(new T.Vector3(...a));const m=add(g,new T.CylinderGeometry(r,r,d.length(),6),mat,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,name);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m}
function base(){const g=new T.Group();cyl(g,.30,.34,.09,.045,dark,8);cyl(g,.295,.30,.07,.125,bronze,8);cyl(g,.23,.29,.10,.21);cyl(g,.12,.23,.27,.395);cyl(g,.16,.12,.07,.565,bronze);for(let i=0;i<8;i++){const a=i*Math.PI/4;line(g,[Math.sin(a)*.235,.265,Math.cos(a)*.235],[Math.sin(a)*.125,.505,Math.cos(a)*.125],.009,bronze)}return g}
const models={}
for(const kind of ['pawn','knight','bishop','rook','queen','king']){
 const g=base();g.name=kind
 if(kind==='pawn'){cyl(g,.16,.13,.09,.64);add(g,new T.IcosahedronGeometry(.18,1),stone,0,.80,0,'pawn_head');box(g,.14,.20,.035,0,.48,.16,bronze,'shield');box(g,.03,.13,.045,0,.48,.18,mint,'ward_mark')}
 if(kind==='rook'){cyl(g,.23,.17,.25,.72,stone,8);cyl(g,.27,.22,.08,.88,bronze,8);cyl(g,.21,.21,.05,.925,dark,8);for(let i=0;i<4;i++){const a=i*Math.PI/2;const m=box(g,.15,.18,.13,Math.sin(a)*.20,1.005,Math.cos(a)*.20,stone,'merlon');m.rotation.y=a;}for(let i=0;i<4;i++){const a=i*Math.PI/2;box(g,.06,.14,.025,Math.sin(a)*.205,.74,Math.cos(a)*.205,bronze,'arch')}}
 if(kind==='bishop'){cyl(g,.18,.13,.14,.67);for(const s of [-1,1]){const shape=new T.Shape();shape.moveTo(s*.03,.72);shape.lineTo(s*.19,.79);shape.quadraticCurveTo(s*.19,.94,s*.025,1.15);shape.lineTo(s*.03,.72);const geom=new T.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:1,steps:1});geom.translate(0,0,-.08);add(g,geom,stone,0,0,0,'split_mitre')}box(g,.02,.26,.10,0,.90,0,mint,'mitre_light');ring(g,.18,.02,.74)}
 if(kind==='knight'){const shape=new T.Shape();shape.moveTo(-.15,.58);shape.lineTo(-.23,.86);shape.lineTo(-.15,1.14);shape.lineTo(-.04,1.04);shape.lineTo(.07,1.12);shape.lineTo(.16,.96);shape.lineTo(.27,.86);shape.lineTo(.21,.73);shape.lineTo(.06,.79);shape.lineTo(.015,.57);shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth:.21,bevelEnabled:true,bevelSegments:1,bevelSize:.014,bevelThickness:.014,steps:1});geo.translate(0,0,-.105);add(g,geo,stone,0,0,0,'horse');for(const s of [-1,1]){add(g,new T.SphereGeometry(.025,8,6),mint,.12,.94,s*.12,'eye');line(g,[-.18,.75,s*.12],[-.13,1.04,s*.12],.025,bronze,'mane');line(g,[-.08,.72,s*.12],[.19,.84,s*.12],.012,bronze,'bridle')}}
 if(kind==='queen'){cyl(g,.20,.13,.18,.70);ring(g,.20,.025,.81);cyl(g,.19,.16,.14,.90,stone,10);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;line(g,[Math.sin(a)*.17,.92,Math.cos(a)*.17],[Math.sin(a)*.23,1.14,Math.cos(a)*.23],.034,bronze,'crown_prong');add(g,new T.OctahedronGeometry(.052),mint,Math.sin(a)*.23,1.14,Math.cos(a)*.23,'crown_gem')}add(g,new T.OctahedronGeometry(.12),stone,0,1.01,0,'crown_heart')}
 if(kind==='king'){cyl(g,.20,.13,.25,.725);cyl(g,.225,.19,.09,.895,bronze);cyl(g,.17,.19,.13,1.005,stone);box(g,.095,.31,.095,0,1.205,0,stone,'cross');box(g,.30,.09,.095,0,1.245,0,stone,'cross');box(g,.038,.22,.012,0,1.205,.056,mint,'cross_ward');box(g,.17,.23,.035,0,.66,.153,bronze,'royal_seal');add(g,new T.OctahedronGeometry(.06),mint,0,.68,.185,'seal_gem')}
 await save(kind,g)
}
{
 const g=new T.Group();g.name='regent'
 for(const x of [-.57,.57])for(const z of [-.57,.57]){box(g,.42,.17,.46,x,.085,z,dark,'foot');box(g,.32,.35,.33,x,.33,z,plate,'armour_leg');cyl(g,.19,.16,.12,.54,bronze,8,x,z,'joint')}
 cyl(g,.70,.62,.25,.69,dark,8);cyl(g,.69,.80,.39,1.00,plate,8);cyl(g,.53,.68,.22,1.30,plate,8);ring(g,.65,.035,1.21);cyl(g,.25,.39,.21,1.51,bronze,8);add(g,new T.IcosahedronGeometry(.31,1),heart,0,1.11,0,'heart');box(g,.48,.16,.35,0,1.69,-.06,plate,'head');box(g,.33,.035,.02,0,1.69,.126,heart,'eyes');for(let i=0;i<8;i++){const a=i*Math.PI/4;const m=box(g,.11,.55,.055,Math.sin(a)*.755,1.03,Math.cos(a)*.755,bronze,'armour_seam');m.rotation.y=a;}for(const s of [-1,1]){box(g,.27,.55,.45,s*.79,1.05,0,plate,'armour_shoulder');box(g,.24,.13,.65,s*.79,.79,.20,bronze,'ram');}await save('regent',g)
}
{
 const g=new T.Group();g.name='spire';cyl(g,.22,.33,.14,.07,dark,6);cyl(g,.12,.22,.37,.325,plate,6);add(g,new T.OctahedronGeometry(.20),heart,0,.63,0,'heart');for(const s of [-1,1]){line(g,[s*.23,.17,.06],[s*.12,1.12,0],.055,plate,'armour_frame');const sh=new T.Shape();sh.moveTo(s*.06,.82);sh.lineTo(s*.34,1.08);sh.lineTo(s*.08,1.62);sh.lineTo(s*.13,1.01);sh.closePath();const geo=new T.ExtrudeGeometry(sh,{depth:.07,bevelEnabled:true,bevelSize:.006,bevelThickness:.006,bevelSegments:1,steps:1});geo.translate(0,0,-.035);add(g,geo,bronze,0,0,0,'blade');}box(g,.13,.25,.12,0,1.12,0,plate,'visor');box(g,.11,.025,.015,0,1.17,.071,heart,'eye');await save('spire',g)
}
{
 const g=new T.Group();g.name='archivist';for(const z of [-.46,.46]){cyl(g,.23,.33,.12,.06,dark,8,0,z,'foot');cyl(g,.18,.22,.30,.27,bronze,8,0,z,'support')}
 box(g,.27,.72,1.04,0,.73,0,dark,'spine');add(g,new T.IcosahedronGeometry(.24,1),heart,0,1.08,0,'heart');for(const s of [-1,1])for(let i=0;i<4;i++){const p=box(g,.055,.74,1.18,s*(.15+i*.07),.83+.035*i,0,i===3?plate:stone,i===3?'armour_cover':'page');p.rotation.z=s*(.12+i*.06);for(let j=0;j<3;j++)line(g,[s*(.19+i*.07),.62+j*.16,-.42],[s*(.19+i*.07),.62+j*.16,.42],.008,bronze,'script');}cyl(g,.13,.20,.18,1.33,bronze,8);add(g,new T.OctahedronGeometry(.16),heart,0,1.52,0,'flame');await save('archivist',g)
}
async function save(id,g){g.updateMatrixWorld(true);let triangles=0;g.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3});const b=new T.Box3().setFromObject(g);const data=Buffer.from(await new GLTFExporter().parseAsync(g,{binary:true,onlyVisible:true}));await writeFile(new URL(id+'.glb',out),data);models[id]={file:id+'.glb',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),triangles,bounds:{min:b.min.toArray(),max:b.max.toArray()}}}
await writeFile(new URL('manifest.json',out),JSON.stringify({source:'Original COLOSSUS procedural geometry; no third-party data',generator:'scripts/generate-colossus-models.mjs',units:'one cell = one unit',models},null,2)+'\n')
console.log(JSON.stringify(Object.fromEntries(Object.entries(models).map(([k,v])=>[k,{bytes:v.bytes,triangles:v.triangles}]))))

