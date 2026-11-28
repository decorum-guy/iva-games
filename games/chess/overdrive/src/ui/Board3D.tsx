import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Line, OrthographicCamera, useGLTF } from '@react-three/drei'
import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { isInCheck, PIECE_TYPES, type GameEvent, type GameState, type Piece, type PieceType, type Side } from '../core'
import { fallAngles, planKingFall, rimPose, stepFall, type FallPlayback, type KingFall } from './finale'
import { activationPulseAt, effectStrengthAt, motionTrails, piecePoseAt, progressAt, sceneTiming, squarePoint, type BoardMotion, type MotionTrail } from './motion'

const WHITE = new Color('#eef1eb'), BLUE = new Color('#245b86'), ORANGE = new Color('#f56b30'), BLACK = new Color('#000000')
const FRAME_WIDTH = 9.12
const CAMERA_POSITION = new Vector3(1.2, 17, 8.4)
const projectedWidth = FRAME_WIDTH * (CAMERA_POSITION.x + CAMERA_POSITION.z) / Math.hypot(CAMERA_POSITION.x, CAMERA_POSITION.z)
const projectedHeight = projectedWidth * CAMERA_POSITION.y / CAMERA_POSITION.length() + .45
const xy = (square: string): [number,number,number] => { const point=squarePoint(square); return [point.x,.07,point.z] }
export interface Board3DProps {
  playback: FallPlayback | null; onArenaMounted(ready: boolean): void
  state: GameState; selected: string | null; targets: readonly string[]; focusSquares: readonly string[]
  onSquare(square: string): void; flipped: boolean; motion: BoardMotion | null; reduced: boolean
}
function ArenaCamera() {
  const { width, height } = useThree(state => state.size)
  // Keep the rotated frame in view on both wide and tall canvases.
  const zoom = .97 * Math.min(width / projectedWidth, height / projectedHeight)
  return <OrthographicCamera makeDefault position={CAMERA_POSITION} zoom={zoom} near={.1} far={70} onUpdate={camera=>camera.lookAt(0,0,0)} />
}
interface FigureProps { piece:Piece;selected:boolean;active:boolean;checked?:boolean;defeated?:boolean;motion:BoardMotion|null;reduced:boolean;onSquare:(s:string)=>void }
function FigureBody({piece,modelType,selected,active,checked=false,defeated=false,motion,reduced}:FigureProps & {modelType:PieceType}) {
  const loaded=useGLTF(`/assets/overdrive/models/${modelType}.glb`)
  const root=useRef<Group>(null)
  const {body,surfaces}=useMemo(()=>{
    const clone=loaded.scene.clone(true)
    const surfaces:{mesh:Mesh;material:MeshStandardMaterial;baseScale:Vector3}[]=[]
    clone.traverse(node=>{
      if(!(node instanceof Mesh)) return
      node.castShadow=true;node.receiveShadow=true
      const original=node.material as MeshStandardMaterial
      const material=original.clone()
      if(material.name==='ceramic') material.color.copy(piece.side==='white'?WHITE:BLUE)
      if(material.name==='aluminium' && piece.side==='black') material.color.set('#5b8097')
      material.transparent=true
      node.material=material
      surfaces.push({mesh:node,material,baseScale:node.scale.clone()})
    })
    return {body:clone,surfaces}
  },[loaded.scene,piece.side])
  useEffect(()=>()=>{for(const surface of surfaces)surface.material.dispose()},[surfaces])
  useFrame(()=>{
    if(!root.current)return
    const elapsed=motion?performance.now()-motion.startedAt:0
    const pose=motion?piecePoseAt(motion,piece.id,elapsed,reduced):null
    root.current.visible=(pose?.presentationType??piece.type)===modelType && (pose?.visible??true)
    if(!root.current.visible)return
    const timing=motion?sceneTiming(motion.events,reduced):null
    const pulse=motion?activationPulseAt(motion,piece.id,elapsed,reduced):0
    const captured=motion?.events.some(event=>event.type==='capture'&&event.victim.id===piece.id)
    const previouslyActive=motion?.before.forms[piece.side]?.pieceId===piece.id && elapsed<(captured?timing!.contact:timing!.land)
    const powered=active||previouslyActive
    const showCheck=checked&&(!timing||elapsed>=timing.result)
    const showDefeat=defeated&&(!timing||elapsed>=timing.result)
    for(const {mesh,material:m,baseScale} of surfaces){
      m.opacity=pose?.opacity??1
      m.depthWrite=m.opacity>.98
      if(m.name==='power') {
        m.emissiveIntensity=(showDefeat?.03:powered?1.15:showCheck?.8:selected?.5:.10)+pulse*2
        if(mesh.name==='power_collar')mesh.scale.copy(baseScale).multiplyScalar(reduced?1:1+pulse*.35)
      }
      if(m.name==='ceramic'){
        m.emissive.copy(selected||powered||showCheck||pulse>0?ORANGE:BLACK)
        m.emissiveIntensity=(showCheck?.14:selected?.09:powered?.045:0)+pulse*.16
      }
    }
  })
  return <group ref={root}><primitive object={body}/></group>
}
function Figure(props:FigureProps & {fall:KingFall|null;playback:FallPlayback|null}) {
  const {piece,selected,active,fall,playback,motion,reduced,onSquare}=props
  const tip=useRef<Group>(null)
  const facing=useRef<Group>(null)
  const lastAngle=useRef<number|null>(null)
  useLayoutEffect(()=>{
    lastAngle.current=null
    if(tip.current){tip.current.position.set(0,0,0);tip.current.quaternion.identity()}
  },[fall])
  const axis=useMemo(()=>new Vector3(fall?.dz??0,0,-(fall?.dx??1)),[fall])
  const group=useRef<Group>(null)
  const beforeType=motion?.before.pieces.find(p=>p.id===piece.id)?.type
  const live=!motion||motion.after.pieces.some(p=>p.id===piece.id)
  useFrame(()=>{
    if(!group.current)return
    const elapsed=motion?performance.now()-motion.startedAt:0
    const pose=motion?piecePoseAt(motion,piece.id,elapsed,reduced):null
    const point=pose??{...squarePoint(piece.square),lift:0,scale:1,visible:true,presentationType:piece.type}
    group.current.position.set(point.x,.07+point.lift,point.z)
    group.current.scale.setScalar(point.scale)
    group.current.visible=point.visible
    if(facing.current)facing.current.rotation.y=point.presentationType==='knight'?(piece.side==='white'?Math.PI/4:-3*Math.PI/4):0
    if(!tip.current)return
    if(!fall){
      if(lastAngle.current!==null){
        tip.current.position.set(0,0,0);tip.current.quaternion.identity();lastAngle.current=null
      }
      return
    }
    const king=piece.id===fall.king
    // Lazy load, remount and reduced motion all respect the committed action.
    const waiting=motion&&elapsed<sceneTiming(motion.events,reduced).result
    const frame=waiting?0:playback&&!playback.settled?playback.elapsed:fall.duration
    if(frame===fall.duration&&lastAngle.current===(king?fall.angle:0))return
    const angles=fallAngles(fall,frame)
    const angle=king?angles.king:angles.neighbour
    if(lastAngle.current===angle)return
    const offset=rimPose(fall.dx,fall.dz,fall.rim,angle,king?.02*Math.min(1,angle/.08):0)
    tip.current.position.set(offset.x,offset.y,offset.z)
    tip.current.quaternion.setFromAxisAngle(axis,angle)
    lastAngle.current=angle
  })
  return <group ref={group} name={'piece-'+piece.id} position={xy(piece.square)} onClick={event=>{if(live){event.stopPropagation();onSquare(piece.square)}}}>
    <group ref={tip} name="contact-pivot"><group ref={facing} name="model-facing">
      <FigureBody {...props} modelType={piece.type}/>
      {beforeType&&beforeType!==piece.type&&<FigureBody {...props} modelType={beforeType}/>}
    </group></group>
    {(selected||active)&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.008,0]}><ringGeometry args={[.34,.37,40]}/><meshBasicMaterial color={selected?'#e96b33':'#ffd5a5'} transparent opacity={.85}/></mesh>}
  </group>
}
function CapacitorRail({side,energy,bank}:{side:Side;energy:number;bank:number}) {
  const z=side==='white'?4.43:-4.43
  return <group>
    {Array.from({length:bank*2},(_,i)=><group key={i} position={[(i-(bank*2-1)/2)*.27+(i<bank?-.12:.12),-.005,z]}>
      <mesh><boxGeometry args={[.21,.065,.16]}/><meshStandardMaterial color={i<energy?'#ed7b43':'#668091'} emissive={i<energy?'#ed6e29':'#000000'} emissiveIntensity={i<energy?.5:0} metalness={.4} roughness={.3}/></mesh>
    </group>)}
  </group>
}
function setOpacity(group:Group,opacity:number){
  group.traverse(node=>{if(node instanceof Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])material.opacity=opacity})
}
function ActionTrail({motion,trail,color}:{motion:BoardMotion;trail:MotionTrail;color:string}) {
  const group=useRef<Group>(null),head=useRef<Mesh>(null)
  const points=useMemo(()=>trail.points.map(p=>[p.x,.11+p.lift,p.z] as [number,number,number]),[trail])
  useFrame(()=>{
    if(!group.current)return
    const elapsed=performance.now()-motion.startedAt
    const timing=sceneTiming(motion.events,false)
    const amplitude=elapsed<trail.showAt?0:effectStrengthAt(timing,elapsed)
    group.current.visible=amplitude>.001
    setOpacity(group.current,amplitude*.5)
    const pose=piecePoseAt(motion,trail.pieceId,elapsed,false)
    if(head.current&&pose)head.current.position.set(pose.x,.105+pose.lift,pose.z)
  })
  return <group ref={group}>
    <Line points={points} color={color} lineWidth={2} transparent opacity={0} depthWrite={false}/>
    <mesh ref={head} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.27,.30,32]}/><meshBasicMaterial color={color} transparent opacity={0} depthWrite={false}/></mesh>
  </group>
}
function ActionEffect({motion,reduced}:{motion:BoardMotion|null;reduced:boolean}) {
  const group=useRef<Group>(null)
  const ability=motion?.events.find(event=>event.type==='ability')
  const promotion=motion?.events.find(event=>event.type==='promotion')
  const capture=motion?.events.find(event=>event.type==='capture')
  const forced=motion?.events.find((event):event is Extract<GameEvent,{type:'move'}>=>event.type==='move'&&event.forced)
  const form=motion?.events.find((event):event is Extract<GameEvent,{type:'form'}>=>event.type==='form'&&event.cause==='activate')
  const square=promotion?.square??(ability?.ability==='sweep'?forced?.to:ability?.ability==='raid'?capture?.victim.square:ability?.to)??capture?.victim.square??motion?.after.pieces.find(piece=>piece.id===form?.pieceId)?.square
  const trails=useMemo(()=>motion?motionTrails(motion,reduced):[],[motion,reduced])
  useFrame(()=>{
    if(!group.current||!motion)return
    const elapsed=performance.now()-motion.startedAt
    const timing=sceneTiming(motion.events,reduced)
    const start=promotion?timing.promotionStart:timing.contact
    const attack=reduced?20:45
    const amplitude=progressAt(elapsed,start,start+attack)*(1-progressAt(elapsed,Math.max(start+attack,timing.land),timing.effectEnd))
    group.current.visible=amplitude>.001
    group.current.scale.setScalar(reduced?1:.72+progressAt(elapsed,start,timing.effectEnd)*.75)
    setOpacity(group.current,amplitude*.72)
  })
  if(!motion||!square)return null
  const point=xy(square)
  const kind=ability?.ability
  const rays=kind==='ram'?4:kind==='cover'?3:kind==='rotation'?6:8
  return <>
    {trails.map(trail=><ActionTrail key={`${motion.id}/${trail.pieceId}`} motion={motion} trail={trail} color={trail.pieceId===ability?.pieceId?'#f47c3a':'#83bfd4'}/>)}
    <group ref={group} position={[point[0],.085,point[2]]}>
      <mesh rotation={[-Math.PI/2,0,0]} scale={kind==='ram'?[1,.62,1]:[1,1,1]}>
        <ringGeometry args={[.35,.375,36,1,0,kind==='sweep'?Math.PI*1.35:Math.PI*2]}/><meshBasicMaterial color="#f77e3c" transparent opacity={0} depthWrite={false}/>
      </mesh>
      {!reduced&&kind==='rotation'&&<mesh rotation={[-Math.PI/2,0,Math.PI]}><ringGeometry args={[.48,.495,36,1,0,Math.PI*1.4]}/><meshBasicMaterial color="#83bfd4" transparent opacity={0} depthWrite={false}/></mesh>}
      {!reduced&&Array.from({length:rays},(_,index)=><mesh key={index} position={[Math.cos(index*Math.PI*2/rays)*.46,.045,Math.sin(index*Math.PI*2/rays)*.46]} rotation={[0,-index*Math.PI*2/rays,0]}><boxGeometry args={[kind==='ram'?.22:.12,.018,.025]}/><meshBasicMaterial color="#ffb56a" transparent opacity={0} depthWrite={false}/></mesh>)}
    </group>
  </>
}
function Arena(props:Board3DProps) {
  const fall=useMemo(()=>planKingFall(props.state),[props.state])
  const {onArenaMounted,playback}=props
  const gl=useThree(s=>s.gl)
  useLayoutEffect(()=>{
    const canvas=gl.domElement
    const lost=()=>onArenaMounted(false)
    const restored=()=>onArenaMounted(true)
    onArenaMounted(!gl.getContext().isContextLost())
    canvas.addEventListener('webglcontextlost',lost)
    canvas.addEventListener('webglcontextrestored',restored)
    return ()=>{
      onArenaMounted(false)
      canvas.removeEventListener('webglcontextlost',lost)
      canvas.removeEventListener('webglcontextrestored',restored)
    }
  },[gl,onArenaMounted])
  useFrame(()=>{
    if(fall&&playback&&!playback.settled&&!document.hidden)stepFall(playback,fall,performance.now())
  },-1)
  const rotation=useRef<Group>(null)
  const currentAngle=useRef(props.flipped?Math.PI:0)
  useFrame((_,delta)=>{
    currentAngle.current+=( (props.flipped?Math.PI:0)-currentAngle.current)*Math.min(1,delta*8)
    if(rotation.current)rotation.current.rotation.y=props.reduced?(props.flipped?Math.PI:0):currentAngle.current
  })
  const targets=new Set(props.targets),focus=new Set(props.focusSquares)
  const pieces=[...props.state.pieces,...(props.motion?.before.pieces.filter(piece=>!props.state.pieces.some(current=>current.id===piece.id))??[])]
  const checked=isInCheck(props.state,props.state.side)
  return <group ref={rotation}>
    <mesh position={[0,-.20,0]} receiveShadow castShadow><boxGeometry args={[FRAME_WIDTH,.30,FRAME_WIDTH]}/><meshStandardMaterial color="#8eacbb" metalness={.62} roughness={.29}/></mesh>
    <mesh position={[0,-.06,0]} receiveShadow><boxGeometry args={[8.25,.08,8.25]}/><meshStandardMaterial color="#17374b" metalness={.55} roughness={.38}/></mesh>
    {Array.from({length:64},(_,i)=>{
      const x=i%8,y=Math.floor(i/8),square=String.fromCharCode(97+x)+(y+1),p=xy(square)
      const chosen=props.state.pieces.find(q=>q.square===square)?.id===props.selected
      const kingInCheck=checked&&props.state.pieces.some(piece=>piece.square===square&&piece.side===props.state.side&&piece.type==='king')
      const color=kingInCheck?'#cf3f39':chosen?'#c88753':(x+y)%2===0?'#456578':'#b4c7ce'
      return <group key={square} position={[p[0],0,p[2]]}>
        <mesh receiveShadow onClick={e=>{e.stopPropagation();props.onSquare(square)}}><boxGeometry args={[.982,.10,.982]}/><meshStandardMaterial color={color} metalness={.25} roughness={.33}/></mesh>
        {(targets.has(square)||focus.has(square))&&<mesh position={[0,.057,0]} rotation={[-Math.PI/2,0,0]}>
          {targets.has(square)?<circleGeometry args={[.105,24]}/>:<ringGeometry args={[.37,.39,4,1,Math.PI/4]}/>}<meshBasicMaterial color={targets.has(square)?'#e95e25':'#f7cb8c'} transparent opacity={.9} depthWrite={false}/>
        </mesh>}
      </group>
    })}
    {[-1,1].flatMap(x=>[-1,1].map(z=><mesh key={`${x}/${z}`} position={[x*4.38,-.025,z*4.38]} rotation={[-Math.PI/2,0,0]}><cylinderGeometry args={[.09,.09,.03,6]}/><meshStandardMaterial color="#294960" metalness={.9} roughness={.21}/></mesh>))}
    {[-1,1].flatMap(x=>Array.from({length:12},(_,i)=><mesh key={`${x}/${i}`} position={[x*4.4,-.042,(i-5.5)*.32]}><boxGeometry args={[.16,.012,.12]}/><meshStandardMaterial color="#365366" roughness={.5}/></mesh>))}
    <CapacitorRail side="white" energy={props.state.energy.white} bank={props.state.rulesVersion==='overdrive-v1'?5:3}/><CapacitorRail side="black" energy={props.state.energy.black} bank={props.state.rulesVersion==='overdrive-v1'?5:3}/>
    {pieces.map(piece=><Figure key={piece.id} piece={piece} selected={props.selected===piece.id} active={props.state.forms[piece.side]?.pieceId===piece.id} checked={piece.type==='king'&&piece.side===props.state.side&&checked} defeated={piece.id===fall?.king} fall={fall&&(piece.id===fall.king||piece.id===fall.support)?fall:null} playback={playback} {...{motion:props.motion,reduced:props.reduced,onSquare:props.onSquare}}/>)}
    <ActionEffect motion={props.motion} reduced={props.reduced}/>
  </group>
}
export default function Board3D(props:Board3DProps) {
  return <Canvas shadows dpr={[1,1.6]} gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.setClearColor(0x000000,0)}}>
    <ArenaCamera/><ambientLight intensity={1.0}/><hemisphereLight args={['#f5f9fa','#315a73',1.2]}/>
    <directionalLight position={[-4,10,5]} intensity={3.1} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-normalBias={.04}/>
    <directionalLight position={[6,4,-5]} intensity={1.9} color="#b8daee"/>
    <Suspense fallback={null}><Arena {...props}/><ContactShadows position={[0,-.39,0]} opacity={.30} scale={13} blur={2.3} far={2.6} resolution={256} frames={1}/></Suspense>
  </Canvas>
}

// Promotion may need a model absent from a teaching position. Load its resource before the contact frame.
for(const type of PIECE_TYPES)useGLTF.preload(`/assets/overdrive/models/${type}.glb`)
