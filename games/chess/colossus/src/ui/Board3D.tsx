import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as T from 'three';
import { BOSSES, bossCells, squareName } from '../core';
import type { Boss, Unit } from '../core';
import { Board2D } from './Board2D';
import { nextBoardSquare, squareLabel } from './boardHelpers';
import type { BoardProps } from './boardHelpers';
import { battleFeedback } from './battleFeedback';
import type { BattleFeedback, UnitFeedback } from './battleFeedback';
import { copy } from './i18n';

const names = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const materials = {
  ivory: { base: '#273d44', trim: '#aa8d56', light: '#90a094', dark: '#35515b', roughness: .79 },
  jade: { base: '#1d4039', trim: '#93b69b', light: '#93b59d', dark: '#28534c', roughness: .45 },
  bronze: { base: '#493e2d', trim: '#c6a565', light: '#c0b18d', dark: '#625942', roughness: .51 },
};
const at = (square: number): [number, number, number] => [square % 8 - 3.5, .11, 3.5 - Math.floor(square / 8)];
const noRaycast = () => undefined;

function Camera() {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof T.OrthographicCamera)) return;
    camera.position.set(0, 11.8, 10.4);
    camera.lookAt(0, .2, 0);
    camera.updateMatrixWorld(true);
    const bounds = new T.Box3();
    for (const x of [-4.6, 4.6]) for (const y of [-.65, 2.2]) for (const z of [-4.6, 4.6]) {
      bounds.expandByPoint(new T.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    const center = bounds.getCenter(new T.Vector3());
    camera.position.addScaledVector(new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), center.y);
    camera.zoom = Math.min(size.width / (bounds.max.x - bounds.min.x + .35), size.height / (bounds.max.y - bounds.min.y + .3));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [camera, size]);
  return null;
}

function ContextWatch({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onLost]);
  return null;
}

function modelClone(scene: T.Group) {
  const result = scene.clone(true);
  result.traverse(object => {
    if (object instanceof T.Mesh) {
      object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone();
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return result;
}
function eachMaterial(model: T.Group, apply: (material: T.MeshStandardMaterial) => void) {
  model.traverse(object => {
    if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof T.MeshStandardMaterial) apply(material);
    }
  });
}
function useOwnedModel(scene: T.Group) {
  const model = useMemo(() => modelClone(scene), [scene]);
  useEffect(() => () => eachMaterial(model, material => material.dispose()), [model]);
  return model;
}

function Figure({ unit, selected, reduced, theme, reaction, onSquare, disabled, htmlPortal }: {
  unit: Unit; selected: boolean; reduced: boolean; theme: string; reaction?: UnitFeedback;
  onSquare: BoardProps['onSquare']; disabled?: boolean; htmlPortal: RefObject<HTMLElement>;
}) {
  const { scene } = useGLTF(`/assets/colossus/models/${names[unit.type]}.glb`);
  const model = useOwnedModel(scene);
  const group = useRef<T.Group>(null), motion = useRef<T.Group>(null), burst = useRef<T.Group>(null);
  const age = useRef(10), floating = useRef<HTMLSpanElement>(null);
  const previousSquare = useRef(unit.square ?? unit.startSquare);
  const existed = useRef(unit.hp > 0), alpha = useRef(unit.hp > 0 ? 1 : 0);
  useEffect(() => { age.current = reaction ? 0 : 10; }, [reaction]);
  if (unit.square !== null) previousSquare.current = unit.square;
  else if (reaction?.square !== null && reaction?.square !== undefined) previousSquare.current = reaction.square;
  const position = at(previousSquare.current), initial = useRef(position);
  useEffect(() => {
    eachMaterial(model, material => {
      if (material.name === 'ivory_stone') {
        material.color.set(theme === 'jade' ? '#a0c8ae' : theme === 'bronze' ? '#d1b777' : '#e5ddbd');
        material.color.lerp(new T.Color('#9d7065'), (1 - unit.hp / unit.maxHp) * .25);
        if (unit.shield) material.color.lerp(new T.Color('#8fc5a5'), .5);
        if (unit.invulnerable) material.color.lerp(new T.Color('#b7f1ed'), .55);
        if (unit.activated) material.color.multiplyScalar(.79);
        material.emissive.set(unit.invulnerable ? '#78b5ba' : unit.shield ? '#67967c' : selected ? '#80632c' : '#000000');
        material.emissiveIntensity = unit.invulnerable ? .38 : unit.shield ? .27 : selected ? .19 : 0;
        material.metalness = unit.invulnerable ? .3 : unit.shield ? .19 : .08;
        material.roughness = unit.invulnerable ? .3 : unit.shield ? .45 : .77;
      }
      if (material.name === 'bronze_inlay') {
        material.color.set(unit.attackBonus ? '#f4ca79' : '#b69b63');
        material.emissive.set(unit.attackBonus ? '#d99943' : '#000000');
        material.emissiveIntensity = unit.attackBonus ? .5 : 0;
      }
      if (material.name === 'recess') {
        material.color.set(unit.armorTip ? '#9b89b7' : '#2e4548');
        material.emissive.set(unit.armorTip ? '#8a6cc4' : '#000000');
        material.emissiveIntensity = unit.armorTip ? .55 : 0;
      }
      material.userData.baseEmissive = material.emissive.clone();
      material.userData.baseIntensity = material.emissiveIntensity;
    });
  }, [model, unit.hp, unit.maxHp, unit.activated, unit.invulnerable, unit.shield, unit.attackBonus, unit.armorTip, selected, theme]);
  useFrame((_, delta) => {
    const root = group.current;
    if (!root) return;
    const smooth = reduced ? 1 : 1 - Math.exp(-delta * 13);
    if (unit.hp > 0) existed.current = true;
    age.current += delta;
    const time = age.current;
    const pulse = !reduced && time < .4 ? Math.sin(Math.PI * time / .4) : 0;
    const waitForStrike = unit.type === 'N' && reaction?.attack && time < .18 && !reduced;
    if (!waitForStrike) root.position.lerp(new T.Vector3(...position), smooth);
    if (motion.current) {
      const direction = reaction?.direction ?? [0, 0];
      const attack = reaction?.attack ? pulse : 0, hurt = reaction?.damage ? pulse : 0;
      const promotion = !reduced && reaction?.promotion && time < .65 ? Math.sin(Math.PI * time / .65) * .2 : 0;
      motion.current.position.set(direction[0] * (attack * .24 - hurt * .07), attack * .07 + promotion, direction[1] * (attack * .24 - hurt * .07));
      motion.current.rotation.set(-direction[1] * attack * .12, 0, direction[0] * attack * .12 + hurt * .08);
    }
    if (floating.current) {
      floating.current.style.opacity = String(reduced ? time < .8 ? 1 : 0 : Math.max(0, 1 - time / .9));
      floating.current.style.transform = reduced ? 'none' : `translateY(${-time * 19}px)`;
    }
    if (burst.current) {
      burst.current.visible = !!reaction?.promotion && time < .85;
      burst.current.scale.setScalar(reduced ? 1 : 1 + time * .75);
      burst.current.traverse(object => { if (object instanceof T.Mesh && object.material instanceof T.MeshBasicMaterial) object.material.opacity = Math.max(0, .8 - time); });
    }
    root.rotation.z = T.MathUtils.lerp(root.rotation.z, unit.hp <= 0 ? Math.PI * .46 : 0, smooth);
    alpha.current = reduced ? unit.hp > 0 ? 1 : 0 : T.MathUtils.lerp(alpha.current, unit.hp > 0 ? 1 : 0, smooth * .5);
    root.visible = existed.current && alpha.current > .015;
    eachMaterial(model, material => {
      const transparent = alpha.current < .99;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = alpha.current;
      const color = material.userData.baseEmissive as T.Color | undefined;
      if (color) material.emissive.copy(color);
      material.emissiveIntensity = Number(material.userData.baseIntensity ?? 0);
      const hit = reaction && (reaction.damage > 0 || reaction.absorbed > 0 || reaction.invulnerable || reaction.promotion) && time < .6;
      if (hit && (material.name === 'ivory_stone' || material.name === 'bronze_inlay')) {
        material.emissive.lerp(new T.Color(reaction.promotion ? '#f1d78f' : reaction.damage ? '#c7654c' : '#a8d6c1'), reduced ? .55 : 1 - time / .6);
        material.emissiveIntensity += reduced ? .35 : (1 - time / .6) * .75;
      }
    });
  });
  return <group ref={group} position={initial.current} scale={.84}
    onClick={event => { if (unit.square === null || unit.hp <= 0) return; event.stopPropagation(); if (!disabled) onSquare(unit.square); }}
    onPointerOver={event => { if (unit.square === null || unit.hp <= 0) return; event.stopPropagation(); if (!disabled) document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    <group ref={motion}><primitive object={model}/></group>
    <group ref={burst} visible={false} position={[0, .13, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}><ringGeometry args={[.35, .39, 40]}/><meshBasicMaterial color="#ffe1a0" transparent opacity={.75} depthWrite={false}/></mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} raycast={noRaycast}><ringGeometry args={[.49, .52, 4]}/><meshBasicMaterial color="#c3e1c9" transparent opacity={.6} depthWrite={false}/></mesh>
    </group>
    {reaction && (reaction.damage > 0 || reaction.absorbed > 0 || reaction.invulnerable || reaction.promotion) && <Html portal={htmlPortal} position={[0, 2.05, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className={`scene-impact ${reaction.promotion ? 'promotion' : reaction.damage ? 'wound' : 'ward'}`} ref={floating}>{reaction.promotion ? '✦' : <>{reaction.damage ? `−${reaction.damage}` : ''}{reaction.absorbed ? ` ⬡${reaction.absorbed}` : ''}{reaction.invulnerable ? '◇' : ''}</>}</span></Html>}
    {unit.hp > 0 && <>
      <Html portal={htmlPortal} position={[0, 1.62, 0]} center zIndexRange={[3, 0]} className="scene-hp-wrap" style={{ pointerEvents: 'none' }}><span className={`scene-hp ${unit.activated ? 'spent' : ''}`}><b>{unit.hp}</b>{unit.shield > 0 && <em>⬡{unit.shield}</em>}{unit.invulnerable > 0 && <em>◇{unit.invulnerable}</em>}{unit.attackBonus > 0 && <em>+{unit.attackBonus}</em>}{unit.armorTip && <em>⌁</em>}{unit.activated && <i>✓</i>}</span></Html>
      {(selected || unit.shield > 0 || unit.invulnerable > 0) && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .015, 0]} raycast={noRaycast}><ringGeometry args={[.38, .42, 32]}/><meshBasicMaterial color={unit.invulnerable ? '#a4e6e4' : unit.shield ? '#b4d7b2' : '#f1d393'} transparent opacity={.9}/></mesh>}
    </>}
  </group>;
}

function Enemy({ boss, reduced, rest, feedback, onSquare, targets, disabled, htmlPortal }: {
  boss: Boss; reduced: boolean; rest: boolean; feedback: BattleFeedback | null;
  onSquare: BoardProps['onSquare']; targets: number[]; disabled?: boolean; htmlPortal: RefObject<HTMLElement>;
}) {
  const { scene } = useGLTF(`/assets/colossus/models/${boss.id}.glb`);
  const model = useOwnedModel(scene);
  const group = useRef<T.Group>(null), motion = useRef<T.Group>(null), floating = useRef<HTMLSpanElement>(null), age = useRef(10);
  const definition = BOSSES[boss.id], position = at(boss.anchor);
  position[0] += (definition.width - 1) / 2; position[2] -= (definition.height - 1) / 2;
  const initial = useRef(position);
  useEffect(() => { age.current = feedback ? 0 : 10; }, [feedback]);
  useEffect(() => {
    eachMaterial(model, material => {
      if (material.name === 'boss_armour') {
        material.color.set(rest ? '#647f74' : boss.armor ? '#53666b' : '#4e4842');
        material.roughness = boss.armor ? .55 : .95;
        material.emissive.set(rest ? '#304c3e' : '#000000'); material.emissiveIntensity = rest ? .18 : 0;
      }
      if (material.name === 'boss_heart') {
        material.emissive.set(boss.hp <= 0 ? '#000000' : rest ? '#9cdbb3' : '#e0a566');
        material.emissiveIntensity = boss.hp <= 0 ? 0 : rest ? .65 : boss.armor ? .7 : 1.4;
      }
      if (material.name === 'armour_fracture') {
        material.color.set(boss.armor ? '#2b4149' : '#d09960');
        material.emissive.set(boss.armor ? '#000000' : '#b46a35'); material.emissiveIntensity = boss.armor ? 0 : .8;
      }
      material.userData.baseEmissive = material.emissive.clone(); material.userData.baseIntensity = material.emissiveIntensity;
    });
  }, [model, boss.armor, boss.hp, rest]);
  useFrame((_, delta) => {
    if (!group.current) return;
    age.current += delta;
    const time = age.current, smooth = reduced ? 1 : 1 - Math.exp(-delta * 8);
    group.current.position.lerp(new T.Vector3(...position), smooth);
    group.current.rotation.z = T.MathUtils.lerp(group.current.rotation.z, boss.hp <= 0 ? Math.PI / 2.6 : 0, smooth);
    group.current.scale.lerp(new T.Vector3().setScalar(boss.hp <= 0 ? .86 : 1), smooth);
    const hit = !!feedback && (feedback.bossDamage > 0 || feedback.bossArmor > 0);
    const pulse = !reduced && time < .45 ? Math.sin(Math.PI * time / .45) : 0;
    if (motion.current) {
      motion.current.rotation.z = hit ? pulse * .075 : 0;
      motion.current.rotation.x = feedback?.bossStrike ? pulse * .11 : 0;
      motion.current.position.y = feedback?.bossStrike ? pulse * .07 : 0;
    }
    if (floating.current) { floating.current.style.opacity = String(reduced ? time < .85 ? 1 : 0 : Math.max(0, 1 - time / .95)); floating.current.style.transform = reduced ? 'none' : `translateY(${-time * 17}px)`; }
    eachMaterial(model, material => {
      const color = material.userData.baseEmissive as T.Color | undefined;
      if (color) material.emissive.copy(color);
      material.emissiveIntensity = Number(material.userData.baseIntensity ?? 0);
      if (hit && time < .6) { material.emissive.lerp(new T.Color(feedback!.bossDamage ? '#d7774e' : '#e5c380'), reduced ? .5 : 1 - time / .6); material.emissiveIntensity += reduced ? .3 : (1 - time / .6) * .75; }
    });
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); if (disabled) return;
    const body = bossCells(boss);
    const nearest = body.slice().sort((a, b) => {
      const ap = at(a), bp = at(b);
      return Math.hypot(ap[0] - event.point.x, ap[2] - event.point.z) - Math.hypot(bp[0] - event.point.x, bp[2] - event.point.z);
    })[0];
    onSquare(targets.includes(nearest) ? nearest : targets.find(square => body.includes(square)) ?? nearest);
  };
  return <group ref={group} position={initial.current} onClick={click} onPointerOver={event => { event.stopPropagation(); if (!disabled) document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    <group ref={motion}><primitive object={model}/></group>
    {feedback && (feedback.bossArmor > 0 || feedback.bossDamage > 0) && <Html portal={htmlPortal} position={[0, 2.75, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className="scene-impact boss-impact" ref={floating}>{feedback.bossArmor > 0 ? `⬡ −${feedback.bossArmor}` : ''}{feedback.bossDamage > 0 ? ` ♥ −${feedback.bossDamage}` : ''}</span></Html>}
  </group>;
}

function FireCell({ square, reduced }: { square: number; reduced: boolean }) {
  const group = useRef<T.Group>(null), material = useRef<T.MeshBasicMaterial>(null), position = at(square);
  useFrame(({ clock }) => {
    if (group.current) group.current.scale.y = reduced ? 1 : 1 + Math.sin(clock.elapsedTime * 4 + square) * .13;
    if (material.current) material.current.opacity = reduced ? .65 : .6 + Math.sin(clock.elapsedTime * 3 + square) * .1;
  });
  return <group ref={group} position={[position[0], .12, position[2]]}>
    <mesh position={[-.17, .12, .09]} raycast={noRaycast}><coneGeometry args={[.13, .32, 5]}/><meshBasicMaterial ref={material} color="#f4c478" transparent opacity={.65} depthWrite={false}/></mesh>
    <mesh position={[.14, .08, -.11]} raycast={noRaycast}><coneGeometry args={[.095, .22, 4]}/><meshBasicMaterial color="#e99259" transparent opacity={.6} depthWrite={false}/></mesh>
  </group>;
}
function GuideMarker({ reduced }: { reduced: boolean }) {
  const material = useRef<T.MeshBasicMaterial>(null);
  useFrame(({ clock }) => { if (material.current) material.current.opacity = reduced ? .95 : .75 + Math.sin(clock.elapsedTime * 3.6) * .2; });
  return <mesh position={[0, .111, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} raycast={noRaycast}><ringGeometry args={[.6, .65, 4]}/><meshBasicMaterial ref={material} color="#ffe6a1" transparent opacity={.95} depthWrite={false}/></mesh>;
}
function ResponseEffects({ feedback, reduced, boss }: { feedback: BattleFeedback | null; reduced: boolean; boss: Boss }) {
  const group = useRef<T.Group>(null), fracture = useRef<T.Mesh>(null), age = useRef(10);
  useEffect(() => { age.current = feedback ? 0 : 10; }, [feedback]);
  useFrame((_, delta) => {
    age.current += delta;
    if (!group.current) return;
    group.current.visible = age.current < .8;
    group.current.traverse(object => { if (object instanceof T.Mesh && object.material instanceof T.MeshBasicMaterial) object.material.opacity = reduced ? .65 : Math.max(0, .8 - age.current); });
    if (fracture.current) fracture.current.scale.setScalar(reduced ? 1 : 1 + age.current * .8);
  });
  if (!feedback) return null;
  const center = at(boss.anchor), definition = BOSSES[boss.id]; center[0] += (definition.width - 1) / 2; center[2] -= (definition.height - 1) / 2;
  return <group ref={group}>
    {feedback.rays.map((ray, index) => {
      const a = at(ray[0]), b = at(ray.at(-1)!), length = Math.hypot(b[0] - a[0], b[2] - a[2]) + .7;
      return <mesh key={`ray${index}`} position={[(a[0] + b[0]) / 2, .22, (a[2] + b[2]) / 2]} rotation={[0, Math.atan2(b[0] - a[0], b[2] - a[2]), 0]} raycast={noRaycast}><boxGeometry args={[.075, .06, length]}/><meshBasicMaterial color="#f6ce99" transparent opacity={.75} depthWrite={false}/></mesh>;
    })}
    {feedback.fire.map(square => { const position = at(square); return <mesh key={`fire${square}`} position={[position[0], .12, position[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}><ringGeometry args={[.24, .43, 8]}/><meshBasicMaterial color="#ffd197" transparent opacity={.7} depthWrite={false}/></mesh>; })}
    {feedback.bossArmorBroken && <mesh ref={fracture} position={[center[0], .14, center[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}><ringGeometry args={[.8, .86, 8]}/><meshBasicMaterial color="#ffe5a3" transparent opacity={.8} depthWrite={false}/></mesh>}
  </group>;
}

function Arena({ palette }: { palette: typeof materials.ivory }) {
  return <group>
    <mesh position={[0, -.24, 0]} receiveShadow raycast={noRaycast}><boxGeometry args={[8.7, .48, 8.7]}/><meshStandardMaterial color={palette.base} roughness={.85}/></mesh>
    <mesh position={[0, -.48, 0]} raycast={noRaycast}><boxGeometry args={[8.93, .11, 8.93]}/><meshStandardMaterial color={palette.trim} metalness={.62} roughness={.43}/></mesh>
    <mesh position={[0, -.59, 0]} raycast={noRaycast}><boxGeometry args={[8.67, .12, 8.67]}/><meshStandardMaterial color="#162f36" roughness={.9}/></mesh>
    {[-1, 1].map(sign => <group key={sign}>
      <mesh position={[sign * 4.16, .015, 0]} receiveShadow raycast={noRaycast}><boxGeometry args={[.25, .17, 8.55]}/><meshStandardMaterial color={palette.base} roughness={.72}/></mesh>
      <mesh position={[0, .015, sign * 4.16]} receiveShadow raycast={noRaycast}><boxGeometry args={[8.55, .17, .25]}/><meshStandardMaterial color={palette.base} roughness={.72}/></mesh>
      <mesh position={[sign * 4.27, .105, 0]} raycast={noRaycast}><boxGeometry args={[.025, .015, 8.5]}/><meshStandardMaterial color={palette.trim} metalness={.7} roughness={.36}/></mesh>
      <mesh position={[0, .105, sign * 4.27]} raycast={noRaycast}><boxGeometry args={[8.5, .015, .025]}/><meshStandardMaterial color={palette.trim} metalness={.7} roughness={.36}/></mesh>
    </group>)}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}-${z}`} position={[x * 4.23, .1, z * 4.23]}>
      <mesh raycast={noRaycast}><cylinderGeometry args={[.18, .24, .19, 8]}/><meshStandardMaterial color={palette.trim} metalness={.65} roughness={.4}/></mesh>
      <mesh position={[0, .12, 0]} raycast={noRaycast}><octahedronGeometry args={[.08]}/><meshStandardMaterial color="#a0c9b9" emissive="#78a391" emissiveIntensity={.4} roughness={.25}/></mesh>
    </group>))}
  </group>;
}

function Scene(p: BoardProps & { htmlPortal: RefObject<HTMLElement> }) {
  const htmlPortal = p.htmlPortal;
  const body = bossCells(p.state.boss), threats = new Set(p.preview?.threatenedCells ?? []), palette = materials[p.theme ?? 'ivory'];
  const previous = useRef(p.state);
  const feedback = useMemo(() => battleFeedback(previous.current, p.state), [p.state]);
  useEffect(() => { previous.current = p.state; }, [p.state]);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  const selectedSquare = p.state.units.find(unit => unit.id === p.selected)?.square;
  return <>
    <Camera/>
    <ambientLight intensity={.75}/><hemisphereLight args={['#d5e5df', '#263b40', 1.5]}/>
    <directionalLight position={[-4, 9, 6]} intensity={2.8} color="#fff0cf" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-.0008}/>
    <directionalLight position={[3, 5, -5]} intensity={1.7} color="#9fc8d0"/>
    <pointLight position={[0, 3, -3]} intensity={12} distance={9} color="#ddb47b"/>
    <Arena palette={palette}/>
    {Array.from({ length: 64 }, (_, square) => {
      const position = at(square), selected = selectedSquare === square, target = p.targets.includes(square), attack = p.attackTargets.includes(square), fire = p.state.fire.includes(square);
      return <group key={square} position={[position[0], 0, position[2]]}>
        <mesh receiveShadow onClick={event => { event.stopPropagation(); if (!p.disabled) p.onSquare(square); }} onPointerOver={event => { event.stopPropagation(); if (!p.disabled) document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
          <boxGeometry args={[.976, .18, .976]}/><meshStandardMaterial color={selected ? '#c0a269' : (Math.floor(square / 8) + square % 8) % 2 ? palette.light : palette.dark} roughness={palette.roughness}/>
        </mesh>
        {(threats.has(square) || fire) && <mesh position={[0, .094, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}><planeGeometry args={[.91, .91]}/><meshBasicMaterial color={fire ? '#d89652' : '#b96d59'} transparent opacity={fire ? .43 : .27} depthWrite={false}/></mesh>}
        {threats.has(square) && [-.25, 0, .25].map((x, i) => <mesh key={i} position={[x, .098, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} raycast={noRaycast}><planeGeometry args={[.032, .7]}/><meshBasicMaterial color={fire ? '#f2c88c' : '#dfad8f'} transparent opacity={.65} depthWrite={false}/></mesh>)}
        {(target || attack) && <mesh position={[0, .105, 0]} rotation={[-Math.PI / 2, 0, attack ? Math.PI / 4 : 0]} raycast={noRaycast}><ringGeometry args={attack ? [.58, .63, 4] : [.09, .15, 24]}/><meshBasicMaterial color={attack ? '#ffe3a2' : '#e1edd0'} depthWrite={false}/></mesh>}
        {body.includes(square) && <mesh position={[0, .096, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} raycast={noRaycast}><ringGeometry args={[.61, .64, 4]}/><meshBasicMaterial color="#e0ba78" transparent opacity={.55} depthWrite={false}/></mesh>}
        {p.guideSquares?.includes(square) && <GuideMarker reduced={!!p.reducedMotion}/>}
      </group>;
    })}
    {Array.from({ length: 8 }, (_, i) => <group key={`coords${i}`}><Html portal={htmlPortal} position={[i - 3.5, .13, 4.18]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}><span className="scene-coordinate">{String.fromCharCode(97 + i)}</span></Html><Html portal={htmlPortal} position={[-4.19, .13, 3.5 - i]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}><span className="scene-coordinate">{i + 1}</span></Html></group>)}
    {p.state.fire.map(square => <FireCell key={square} square={square} reduced={!!p.reducedMotion}/>)}
    <ResponseEffects feedback={feedback} reduced={!!p.reducedMotion} boss={p.state.boss}/>
    <Suspense fallback={null}>
      <Enemy htmlPortal={htmlPortal} key={p.state.boss.id} boss={p.state.boss} reduced={!!p.reducedMotion} rest={p.state.intent.rest} feedback={feedback} onSquare={p.onSquare} targets={p.attackTargets} disabled={p.disabled}/>
      {p.state.units.map(unit => <Figure htmlPortal={htmlPortal} key={unit.id} unit={unit} selected={unit.id === p.selected} reduced={!!p.reducedMotion} theme={p.theme ?? 'ivory'} reaction={feedback?.units[unit.id]} onSquare={p.onSquare} disabled={p.disabled}/>)}
    </Suspense>
  </>;
}

export function Board3D(p: BoardProps) {
  const [lost, setLost] = useState(false), [focus, setFocus] = useState(4);
  const keyboard = useRef<HTMLDivElement>(null);
  const [htmlPortal, setHtmlPortal] = useState<RefObject<HTMLElement> | null>(null);
  const attachHtmlPortal = useCallback((element: HTMLDivElement | null) => {
    // Retain the target even after its DOM wrapper detaches: R3F can finish its
    // own teardown later. React owns this empty layer; only Drei owns its children.
    if (element) setHtmlPortal(current => current?.current === element ? current : { current: element });
  }, []);
  const onLost = useCallback(() => setLost(true), []);
  if (lost) return <><div className="board-scene-fallback-note" role="status">{copy[p.lang].fallback3d}</div><Board2D {...p}/></>;
  return <div className="board-scene" data-testid="board-3d">
    <div ref={attachHtmlPortal} className="scene-html-layer" data-testid="board-3d-labels" aria-hidden="true"/>
    {htmlPortal && <Canvas orthographic shadows dpr={[1, 1.5]} camera={{ position: [0, 11.8, 10.4], zoom: 45, near: .1, far: 80 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.toneMapping = T.ACESFilmicToneMapping; gl.toneMappingExposure = 1.12; }}>
      <ContextWatch onLost={onLost}/><Scene {...p} htmlPortal={htmlPortal}/>
    </Canvas>}
    <div ref={keyboard} className="sr-only scene-keyboard-grid" role="grid" aria-label={p.lang === 'ru' ? 'Доступная доска' : 'Accessible board'} aria-disabled={!!p.disabled}>
      {Array.from({ length: 8 }, (_, row) => <div key={row} role="row">{Array.from({ length: 8 }, (_, file) => {
        const square = (7 - row) * 8 + file, unit = p.state.units.find(item => item.square === square);
        return <button type="button" role="gridcell" key={square} onClick={() => !p.disabled && p.onSquare(square)} aria-selected={unit?.id === p.selected} tabIndex={square === focus ? 0 : -1} onFocus={() => setFocus(square)} aria-label={squareLabel(p, square)} data-square={squareName(square)} onKeyDown={event => {
          const next = nextBoardSquare(square, event.key, event.ctrlKey || event.metaKey);
          if (next !== null) { event.preventDefault(); setFocus(next); keyboard.current?.querySelector<HTMLButtonElement>(`[data-square="${squareName(next)}"]`)?.focus(); }
        }}>{squareName(square)}</button>;
      })}</div>)}
    </div>
  </div>;
}
