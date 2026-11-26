import { Suspense,useEffect,useMemo,useRef } from 'react';
import { Canvas,useFrame,useThree } from '@react-three/fiber';
import { Html,useGLTF } from '@react-three/drei';
import * as T from 'three';
import { BOSSES,bossCells,squareName } from '../core';
import type { Boss,Unit } from '../core';
import { squareLabel,type BoardProps } from './Board2D';
import { battleFeedback } from './battleFeedback';
import type { BattleFeedback,UnitFeedback } from './battleFeedback';
const names={K:'king',Q:'queen',R:'rook',B:'bishop',N:'knight',P:'pawn'};
const materials={ivory:{base:'#29363d',trim:'#8e784d',light:'#9b9f94',dark:'#3b5056',roughness:.8},jade:{base:'#203e39',trim:'#79a78e',light:'#91b6a0',dark:'#244b48',roughness:.34},bronze:{base:'#493928',trim:'#ba904d',light:'#c7b18a',dark:'#624c33',roughness:.44}};
const at=(sq:number):[number,number,number]=>[sq%8-3.5,.10,3.5-Math.floor(sq/8)];
function Camera(){
 const {camera,size}=useThree();
 useEffect(()=>{if(camera instanceof T.OrthographicCamera){camera.zoom=Math.min(size.width/10.5,size.height/10.5);camera.position.set(4.8,10.6,11.4);camera.lookAt(0,0,0);camera.updateProjectionMatrix();}},[camera,size]);
 return null;
}
function modelClone(scene:T.Group){const result=scene.clone(true);result.traverse(o=>{if(o instanceof T.Mesh){o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.castShadow=true;o.receiveShadow=true;}});return result;}
function Figure({unit,selected,reduced,theme,reaction}:{unit:Unit;selected:boolean;reduced:boolean;theme:string;reaction?:UnitFeedback}){
 const {scene}=useGLTF('/assets/colossus/models/'+names[unit.type]+'.glb');const model=useMemo(()=>modelClone(scene),[scene]);
 const group=useRef<T.Group>(null);const motion=useRef<T.Group>(null);const age=useRef(10);const floating=useRef<HTMLSpanElement>(null);const previousSquare=useRef(unit.square??unit.startSquare);const existed=useRef(unit.hp>0);const alpha=useRef(unit.hp>0?1:0);
 useEffect(()=>{age.current=reaction?0:10;},[reaction]);
 if(unit.square!==null)previousSquare.current=unit.square;else if(reaction?.square!==null&&reaction?.square!==undefined)previousSquare.current=reaction.square;
 const pos=at(previousSquare.current);const initialPosition=useRef(pos);
 useEffect(()=>{model.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!(m instanceof T.MeshStandardMaterial))continue;
   if(m.name==='ivory_stone'){
    m.color.set(theme==='jade'?'#77b3a0':theme==='bronze'?'#c19e58':'#dfd8bf');
    m.color.lerp(new T.Color('#9c675d'),(1-unit.hp/unit.maxHp)*.28);
    if(unit.shield)m.color.lerp(new T.Color('#72c3a4'),.55);
    if(unit.invulnerable)m.color.lerp(new T.Color('#9ae6ec'),.65);
    if(unit.activated)m.color.multiplyScalar(.72);
    m.emissive.set(unit.invulnerable?'#5aafb9':unit.shield?'#458b70':selected?'#725222':'#000000');
    m.emissiveIntensity=unit.invulnerable?.55:unit.shield?.4:selected?.28:0;
    m.metalness=unit.invulnerable?.45:unit.shield?.22:.06;m.roughness=unit.invulnerable?.25:unit.shield?.4:.82;
   }
   if(m.name==='bronze_inlay'){m.color.set(unit.attackBonus?'#ffd083':'#b29863');m.emissive.set(unit.attackBonus?'#e59632':'#000000');m.emissiveIntensity=unit.attackBonus?.65:0;}
   if(m.name==='recess'){m.color.set(unit.armorTip?'#9a8cbe':'#313431');m.emissive.set(unit.armorTip?'#8d6bc2':'#000000');m.emissiveIntensity=unit.armorTip?.7:0;}
   m.userData.baseEmissive=m.emissive.clone();m.userData.baseIntensity=m.emissiveIntensity;
  }}});},[model,unit.hp,unit.maxHp,unit.activated,unit.invulnerable,unit.shield,unit.attackBonus,unit.armorTip,selected,theme]);
 useEffect(()=>()=>{model.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});},[model]);
 useFrame((_,delta)=>{const g=group.current;if(!g)return;const t=reduced?1:1-Math.exp(-delta*13);if(unit.hp>0)existed.current=true;
  age.current+=delta;const time=age.current;const impact=!reduced&&time<.38?Math.sin(Math.PI*time/.38):0;
  const waitForStrike=unit.type==='N'&&reaction?.attack&&time<.2&&!reduced;
  if(!waitForStrike)g.position.lerp(new T.Vector3(...pos),t);
  if(motion.current){const direction=reaction?.direction??[0,0];const attackPulse=reaction?.attack?impact:0;const hurtPulse=reaction?.damage?impact:0;motion.current.position.set(direction[0]*(attackPulse*.24-hurtPulse*.08),attackPulse*.07,direction[1]*(attackPulse*.24-hurtPulse*.08));motion.current.rotation.set(-direction[1]*attackPulse*.14,0,direction[0]*attackPulse*.14+hurtPulse*.08);}
  if(floating.current){floating.current.style.opacity=String(reduced?(time<.75?1:0):Math.max(0,1-time/.8));floating.current.style.transform=reduced?'none':'translateY('+(-time*18)+'px)';}
  g.rotation.z=T.MathUtils.lerp(g.rotation.z,unit.hp<=0?Math.PI*.46:0,t);
  alpha.current=T.MathUtils.lerp(alpha.current,unit.hp>0?1:0,t*.55);g.visible=existed.current&&alpha.current>.015;
  model.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=alpha.current<.99;m.opacity=alpha.current;if(m instanceof T.MeshStandardMaterial&&m.name==='ivory_stone'){const color=m.userData.baseEmissive as T.Color|undefined;if(color)m.emissive.copy(color);m.emissiveIntensity=Number(m.userData.baseIntensity??0);const hit=reaction&&(reaction.damage>0||reaction.absorbed>0||reaction.invulnerable)&&time<.55;if(hit){m.emissive.lerp(new T.Color(reaction.damage?'#d45639':'#91d3d1'),reduced?.6:1-time/.55);m.emissiveIntensity+=reduced?.45:(1-time/.55)*.85;}}}}});
 });
 return <group ref={group} position={initialPosition.current} scale={.72}>
 <group ref={motion}><primitive object={model}/></group>
 {reaction&&(reaction.damage>0||reaction.absorbed>0||reaction.invulnerable)&&<Html position={[0,2.05,0]} center style={{pointerEvents:'none'}}><span className={'scene-impact '+(reaction.damage?'wound':'ward')} ref={floating}>{reaction.damage?'−'+reaction.damage:''}{reaction.absorbed?' ⬡'+reaction.absorbed:''}{reaction.invulnerable?'◇':''}</span></Html>}
 {unit.hp>0&&<><Html position={[0,1.68,0]} center className="scene-hp-wrap" style={{pointerEvents:'none'}}><span className={'scene-hp '+(unit.activated?'spent':'')}><b>{unit.hp}</b>{unit.shield>0&&<em>⬡{unit.shield}</em>}{unit.invulnerable>0&&<em>◇{unit.invulnerable}</em>}{unit.attackBonus>0&&<em>↑{unit.attackBonus}</em>}{unit.armorTip&&<em>⌁</em>}{unit.activated&&<i>•</i>}</span></Html>
 {(selected||unit.shield>0||unit.invulnerable>0)&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.02,0]}><ringGeometry args={[.36,.40,32]}/><meshBasicMaterial color={unit.invulnerable?'#8dd2dc':unit.shield?'#a6cdb0':'#e9c785'} transparent opacity={.85}/></mesh>}
 </>}
 </group>
}
function Enemy({boss,reduced,rest,feedback}:{boss:Boss;reduced:boolean;rest:boolean;feedback:BattleFeedback|null}){
 const {scene}=useGLTF('/assets/colossus/models/'+boss.id+'.glb');const model=useMemo(()=>modelClone(scene),[scene]);const g=useRef<T.Group>(null);const motion=useRef<T.Group>(null);const age=useRef(10);const floating=useRef<HTMLSpanElement>(null);
 const definition=BOSSES[boss.id];const p=at(boss.anchor);p[0]+=(definition.width-1)/2;p[2]-=(definition.height-1)/2;const initialPosition=useRef(p);
 useEffect(()=>{age.current=feedback?0:10;},[feedback]);
 useEffect(()=>{model.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!(m instanceof T.MeshStandardMaterial))continue;
  if(m.name==='boss_armour'){m.color.set(rest?'#55766b':boss.armor?'#4b5960':'#352e2b');m.roughness=boss.armor?.52:.95;m.emissive.set(rest?'#22483b':'#000000');m.emissiveIntensity=rest?.22:0;}
  if(m.name==='boss_heart'){m.emissive.set(rest?'#71ba9a':'#b65b39');m.emissiveIntensity=rest?.42:boss.armor?.5:1.2;}
  m.userData.baseEmissive=m.emissive.clone();m.userData.baseIntensity=m.emissiveIntensity;
 }}});},[model,boss.armor,rest]);
 useEffect(()=>()=>{model.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});},[model]);
 useFrame((_,d)=>{if(!g.current)return;age.current+=d;const time=age.current,t=reduced?1:1-Math.exp(-d*7);g.current.position.lerp(new T.Vector3(...p),t);g.current.rotation.z=T.MathUtils.lerp(g.current.rotation.z,boss.hp<=0?Math.PI/2:0,t);g.current.scale.lerp(new T.Vector3(...(boss.hp<=0?[.8,.8,.8]:[1,1,1])),t);
  const hit=!!feedback&&(feedback.bossDamage>0||feedback.bossArmor>0);const pulse=!reduced&&time<.42?Math.sin(Math.PI*time/.42):0;
  if(motion.current){motion.current.rotation.z=hit?pulse*.09:0;motion.current.rotation.x=feedback?.bossStrike?pulse*.12:0;motion.current.position.y=feedback?.bossStrike?pulse*.07:0;}
  if(floating.current){floating.current.style.opacity=String(reduced?(time<.8?1:0):Math.max(0,1-time/.85));floating.current.style.transform=reduced?'none':'translateY('+(-time*16)+'px)';}
  model.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof T.MeshStandardMaterial){const color=m.userData.baseEmissive as T.Color|undefined;if(color)m.emissive.copy(color);m.emissiveIntensity=Number(m.userData.baseIntensity??0);if(hit&&time<.5){m.emissive.lerp(new T.Color(feedback!.bossDamage?'#dc623d':'#e4bf70'),reduced?.6:1-time/.5);m.emissiveIntensity+=reduced?.4:1-time/.5;}}});
 });
 return <group ref={g} position={initialPosition.current}><group ref={motion}><primitive object={model}/></group>{feedback&&(feedback.bossArmor>0||feedback.bossDamage>0)&&<Html position={[0,3.1,0]} center style={{pointerEvents:'none'}}><span className="scene-impact boss-impact" ref={floating}>{feedback.bossArmor>0?'⬡ −'+feedback.bossArmor:''}{feedback.bossDamage>0?' ♥ −'+feedback.bossDamage:''}</span></Html>}</group>
}
function FireCell({square,reduced}:{square:number;reduced:boolean}){
 const group=useRef<T.Group>(null),material=useRef<T.MeshBasicMaterial>(null);const p=at(square);
 useFrame(({clock})=>{if(group.current)group.current.scale.y=reduced?1:1+Math.sin(clock.elapsedTime*4+square)*.13;if(material.current)material.current.opacity=reduced?.6:.55+Math.sin(clock.elapsedTime*3+square)*.1;});
 return <group ref={group} position={[p[0],.12,p[2]]}><mesh position={[-.12,.15,.07]}><coneGeometry args={[.13,.36,5]}/><meshBasicMaterial ref={material} color="#e3a54e" transparent opacity={.6} depthWrite={false}/></mesh><mesh position={[.12,.09,-.09]}><coneGeometry args={[.09,.23,4]}/><meshBasicMaterial color="#ec7944" transparent opacity={.55} depthWrite={false}/></mesh></group>
}
function ResponseEffects({feedback,reduced}:{feedback:BattleFeedback|null;reduced:boolean}){
 const group=useRef<T.Group>(null),age=useRef(10);
 useEffect(()=>{age.current=feedback?0:10;},[feedback]);
 useFrame((_,d)=>{age.current+=d;if(!group.current)return;group.current.visible=age.current<.75;group.current.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshBasicMaterial)o.material.opacity=reduced?.6:Math.max(0,.8-age.current);});});
 if(!feedback)return null;
 return <group ref={group}>{feedback.rays.map((ray,index)=>{const a=at(ray[0]),b=at(ray.at(-1)!);const length=Math.hypot(b[0]-a[0],b[2]-a[2])+.7;return <mesh key={'ray'+index} position={[(a[0]+b[0])/2,.22,(a[2]+b[2])/2]} rotation={[0,Math.atan2(b[0]-a[0],b[2]-a[2]),0]}><boxGeometry args={[.09,.07,length]}/><meshBasicMaterial color="#f2ba81" transparent opacity={.75} depthWrite={false}/></mesh>;})}{feedback.fire.map(square=>{const p=at(square);return <mesh key={'fire'+square} position={[p[0],.12,p[2]]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.24,.43,8]}/><meshBasicMaterial color="#ffb15c" transparent opacity={.7} depthWrite={false}/></mesh>;})}</group>
}
function Scene(p:BoardProps){
 const body=bossCells(p.state.boss);const threats=new Set(p.preview?.threatenedCells??[]);const palette=materials[p.theme??'ivory'];
 const previous=useRef(p.state);const feedback=useMemo(()=>battleFeedback(previous.current,p.state),[p.state.revision]);useEffect(()=>{previous.current=p.state;},[p.state]);
 return <><Camera/><color attach="background" args={['#182126']}/><fog attach="fog" args={['#182126',16,34]}/>
 <ambientLight intensity={1.45}/><hemisphereLight args={['#d6e1e4','#3a3121',1.0]}/><directionalLight position={[-4,9,6]} intensity={2.5} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-.001}/>
 <pointLight position={[3,4,-5]} intensity={20} color="#e3b37a"/>
 <mesh position={[0,-.25,0]} receiveShadow><boxGeometry args={[8.6,.5,8.6]}/><meshStandardMaterial color={palette.base} roughness={.9}/></mesh>
 <mesh position={[0,-.40,0]}><boxGeometry args={[8.8,.16,8.8]}/><meshStandardMaterial color={palette.trim} metalness={.65} roughness={.38}/></mesh>
 {Array.from({length:64},(_,sq)=>{const pt=at(sq);const chosen=p.state.units.find(u=>u.id===p.selected)?.square===sq;const target=p.targets.includes(sq);const attack=p.attackTargets.includes(sq);const fire=p.state.fire.includes(sq);return <group key={sq} position={[pt[0],0,pt[2]]}>
 <mesh receiveShadow onClick={e=>{e.stopPropagation();if(!p.disabled)p.onSquare(sq);}} onPointerOver={e=>{e.stopPropagation();document.body.style.cursor='pointer';}} onPointerOut={()=>{document.body.style.cursor='auto';}}>
 <boxGeometry args={[.96,.16,.96]}/><meshStandardMaterial color={chosen?'#bc9d5e':(Math.floor(sq/8)+sq%8)%2?palette.light:palette.dark} roughness={palette.roughness}/></mesh>
 {threats.has(sq)&&<mesh position={[0,.085,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.88,.88]}/><meshBasicMaterial color={fire?'#da8944':'#bd6460'} transparent opacity={fire?.55:.24} depthWrite={false}/></mesh>}
 {threats.has(sq)&&[-.25,0,.25].map((x,i)=><mesh key={i} position={[x,.091,0]} rotation={[-Math.PI/2,0,Math.PI/4]}><planeGeometry args={[.035,.72]}/><meshBasicMaterial color={fire?'#f5be6a':'#df9285'} transparent opacity={.5}/></mesh>)}
 {(target||attack)&&<mesh position={[0,.104,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={attack?[.31,.35,4]:[.08,.13,24]}/><meshBasicMaterial color={attack?'#ffe0a0':'#e0e8ce'} depthTest={false}/></mesh>}
 {body.includes(sq)&&<mesh position={[0,.086,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.42,.46,4]}/><meshBasicMaterial color="#c7a16b" transparent opacity={.4}/></mesh>}
 </group>})}
 {Array.from({length:8},(_,i)=><group key={'coords'+i}><Html position={[i-3.5,.02,4.24]} center style={{pointerEvents:'none'}}><span className="scene-coordinate">{String.fromCharCode(97+i)}</span></Html><Html position={[-4.24,.02,3.5-i]} center style={{pointerEvents:'none'}}><span className="scene-coordinate">{i+1}</span></Html></group>)}
 {p.state.fire.map(square=><FireCell key={square} square={square} reduced={!!p.reducedMotion}/>)}<ResponseEffects feedback={feedback} reduced={!!p.reducedMotion}/>
 <Suspense fallback={null}><Enemy key={p.state.boss.id} boss={p.state.boss} reduced={!!p.reducedMotion} rest={p.state.intent.rest} feedback={feedback}/>{p.state.units.map(u=><Figure key={u.id} unit={u} selected={u.id===p.selected} reduced={!!p.reducedMotion} theme={p.theme??'ivory'} reaction={feedback?.units[u.id]}/>)}</Suspense>
 </>
}
export function Board3D(p:BoardProps){
 return <div className="board-scene" data-testid="board-3d"><Canvas orthographic shadows dpr={[1,1.5]} camera={{position:[4.8,10.6,11.4],zoom:45,near:.1,far:80}} gl={{antialias:true,alpha:false}}><Scene {...p}/></Canvas>
 <div className="sr-only" role="grid" aria-label={p.lang==='ru'?'Доступная доска':'Accessible board'}>{Array.from({length:64},(_,sq)=><button type="button" role="gridcell" key={sq} onClick={()=>!p.disabled&&p.onSquare(sq)} aria-label={squareLabel(p,sq)} data-square={squareName(sq)}>{squareName(sq)}</button>)}</div>
 </div>
}

