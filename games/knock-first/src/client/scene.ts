import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorAt, floorHeight, getLevel } from '../core/level';
import { predictPlayerPosition } from './prediction';
import type { Floor, KnockLevel, PlayerView, PublicActor, PublicBattery, Vec3 } from '../core/types';
import { FirstPersonControls } from './controls';
import { KnockAudio } from './audio';
import { restoreRigPose, solveArmGrip, solvePalmGrip, solveCarryStance } from './rig';
import { buildArchitecture } from './architecture';
import { createEchoMaterial, createWorldMaterials, makeSign, makePhysicalSign } from './materials';
import type { KnockControlInput, SceneAction, SceneContextStatus, SceneHandle, SceneSettings, SceneStats, SoundCaption, SoundTestKind } from './sceneTypes';

interface ModelInstance {
  root: THREE.Group;
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
  previousPosition: THREE.Vector3;
}

// A missing actor or collidable fixture must never turn into an invisible threat/obstacle.
const REQUIRED_MODELS = new Set(['arms', 'listener', 'operative', 'battery', 'cabinet', 'shelf', 'pump', 'resonator', 'socket', 'timer']);

export interface WorldCallbacks {
  input(input: KnockControlInput): void;
  action(action: SceneAction, down: boolean): void;
  pointerLock(locked: boolean): void;
  context(status: SceneContextStatus): void;
  ready(): void;
  caption(caption: SoundCaption): void;
  stats(stats: SceneStats): void;
  assetError(file: string): void;
}

function vector(position: Vec3): THREE.Vector3 { return new THREE.Vector3(position.x, position.y, position.z); }
function position(object: THREE.Object3D, value: Vec3): void { object.position.set(value.x, value.y, value.z); }
function floorGeometry(floor: Floor, thickness = 0.16): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(floor.width, thickness, floor.depth);
  const attr = geometry.getAttribute('position');
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, attr.getX(i) + floor.x, attr.getY(i) - thickness / 2 + floor.y + attr.getX(i) * floor.slopeX + attr.getZ(i) * floor.slopeZ, attr.getZ(i) + floor.z);
  geometry.computeVertexNormals(); return geometry;
}
function disposeTree(root: THREE.Object3D, additionalRoots: THREE.Object3D[] = [], extraMaterials: THREE.Material[] = []): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>(extraMaterials);
  const textures = new Set<THREE.Texture>();
  for (const tree of [root, ...additionalRoots]) tree.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    if (material instanceof THREE.ShaderMaterial) for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const geometry of geometries) geometry.dispose();
}

/** An isolated Three scene: all dynamic objects come from this participant's permitted view. */
export class KnockWorld implements SceneHandle {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.04, 110);
  private controls: FirstPersonControls;
  private audio: KnockAudio;
  private level: KnockLevel;
  private view: PlayerView;
  private settings: SceneSettings;
  private worldMaterials = createWorldMaterials();
  private loader = new GLTFLoader();
  private assets = new Map<string, Promise<GLTF | null>>();
  private loadedAssets = new Map<string, GLTF>();
  private alive = true;
  private enabled = false;
  private frame = 0;
  private previousFrame = 0;
  private inputAt = 0;
  private snapshotAt = performance.now();
  private frameTimes: number[] = [];
  private statAt = 0;
  private renderedFrames = 0;
  private resizeObserver: ResizeObserver;
  private ownPosition = new THREE.Vector3();
  private lastServerPosition = new THREE.Vector3();
  private eyeHeight = 1.58;
  private ownInitialised = false;
  private footprint = new THREE.Group();
  private doorRoots = new Map<string, THREE.Group>();
  private doorPanels = new Map<string, THREE.Group>();
  private doorEchoes = new Map<string, THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  private echoLines = new Map<string, THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  private actors = new Map<string, ModelInstance>();
  private batteries = new Map<string, ModelInstance>();
  private listenerModel: ModelInstance | null = null;
  private handModel: ModelInstance | null = null;
  private strikerModel: THREE.Object3D | null = null;
  private ownBeacon: THREE.Object3D | null = null;
  private signs = new THREE.Group();
  private propZones = new Map<string, THREE.Group>();
  private socketLights: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
  private lamps: THREE.PointLight[] = [];
  private flashlight = new THREE.SpotLight('#d9cbb0', 16, 2.6, 1.05, 0.65, 1.5);
  private marks = new Map<string, THREE.Group>();
  private timers = new Map<string, ModelInstance>();
  private handPulseAt = -10;
  private motionSpeed = 0;
  private handClearance = 1;
  private viewmodelDepthScale = { value: 1 };
  private clearanceRay = new THREE.Ray();
  private clearanceBox = new THREE.Box3();
  private clearanceHit = new THREE.Vector3();
  private contextLost = false;
  private assetsFailed = false;
  private modelsLoading = true;

  constructor(private container: HTMLDivElement, view: PlayerView, settings: SceneSettings, private callbacks: WorldCallbacks) {
    this.view = view; this.settings = settings; this.level = getLevel(view.levelId);
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setClearColor('#03090d', 1); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = settings.quality === 'high'; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', settings.language === 'ru' ? 'Вид от первого лица. WASD — движение, мышь — обзор.' : 'First-person view. WASD to move, mouse to look.');
    this.renderer.domElement.dataset.knockScene = 'true';
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none;';
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#03090d');
    this.scene.fog = new THREE.FogExp2('#061119', 0.055);
    this.scene.add(this.camera); this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight('#6c9499', '#101d20', 0.15));
    const fill = new THREE.PointLight('#e2d2ba', 2.0, 1.1, 2); fill.position.set(-0.2, 0.15, -0.1); fill.layers.set(1); this.camera.add(fill); const handAmbient=new THREE.HemisphereLight('#adc1c7','#243139',.65); handAmbient.layers.set(1); this.scene.add(handAmbient);
    this.flashlight.position.set(0.1, -0.15, -0.1); this.flashlight.target.position.set(0, -0.1, -1);
    this.flashlight.castShadow = settings.quality === 'high'; this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.04; this.flashlight.shadow.bias = -0.001;
    this.camera.add(this.flashlight, this.flashlight.target);
    for (let i = 0; i < 4; i++) { const lamp = new THREE.PointLight('#d9a46e', 0, 6, 2); this.scene.add(lamp); this.lamps.push(lamp); }
    this.audio = new KnockAudio(() => this.settings, caption => this.callbacks.caption(caption));
    this.controls = new FirstPersonControls(this.renderer.domElement, () => this.settings, {
      action: (action, down) => this.callbacks.action(action, down),
      pointerLock: locked => this.callbacks.pointerLock(locked),
      gesture: () => { void this.audio.unlock(); },
    });
    this.controls.setLook(view.self.yaw, view.self.pitch);
    this.buildGeometry(); this.scene.add(buildArchitecture(this.level, this.worldMaterials)); this.buildSigns(); this.buildFootprint();
    void document.fonts.ready.then(() => { if (this.alive) this.buildSigns(); });
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.callbacks.context('restoring');
    void this.loadModels().then(() => {
      if (!this.alive || this.assetsFailed) return;
      this.modelsLoading = false;
      this.callbacks.ready();
      if (!this.contextLost) this.callbacks.context('ready');
    }).catch(() => this.failAssets('scene-models'));
    this.frame = requestAnimationFrame(this.animate);
  }

  update(view: PlayerView): void {
    if (view.self.controllerEpoch !== this.view.self.controllerEpoch || vector(view.self.position).distanceTo(this.lastServerPosition) > 4) {
      this.ownInitialised = false; this.controls.setLook(view.self.yaw, view.self.pitch);
    }
    const knownEvents = new Set(this.view.events.map(event => event.id));
    if (view.events.some(event => !knownEvents.has(event.id) && event.actorId === view.self.id && ['knock', 'resonator', 'click'].includes(event.type) && view.time - event.at < 0.4)) this.handPulseAt = performance.now() / 1000;
    if (view.tick !== this.view.tick) this.snapshotAt = performance.now();
    this.view = view; this.audio.update(view); this.lastServerPosition.copy(vector(view.self.position));
  }

  updateSettings(settings: SceneSettings): void {
    const localeChanged = this.settings.language !== settings.language;
    const qualityChanged = this.settings.quality !== settings.quality;
    this.settings = settings; this.audio.updateSettings();
    if (localeChanged) {
      this.buildSigns();
      this.renderer.domElement.setAttribute('aria-label', settings.language === 'ru' ? 'Вид от первого лица. WASD — движение, мышь — обзор.' : 'First-person view. WASD to move, mouse to look.');
    }
    if (qualityChanged) { this.renderer.shadowMap.enabled = settings.quality === 'high'; this.flashlight.castShadow = settings.quality === 'high'; this.resize(); }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && !this.contextLost && !this.assetsFailed && !this.modelsLoading;
    this.controls.setActive(this.enabled);
  }
  look(dx: number, dy: number): void { this.controls.look(dx, dy); }
  move(x: number, forward: number): void { this.controls.move(x, forward); }
  setRun(value: boolean): void { this.controls.setRun(value); }
  setQuiet(value: boolean): void { this.controls.setQuiet(value); }
  setInteract(value: boolean): void { this.controls.setInteract(value); }
  requestControl(): void { if (!this.contextLost && !this.assetsFailed && !this.modelsLoading) this.controls.request(); }
  releaseControl(): void { this.controls.release(); }
  unlockAudio(): Promise<void> { return this.audio.unlock(); }
  soundTest(kind: SoundTestKind): Promise<void> { return this.audio.test(kind); }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(this.settings.quality === 'low' ? Math.min(1, window.devicePixelRatio) : Math.min(1.5, window.devicePixelRatio));
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  private addBox(group: THREE.Object3D, size: Vec3, at: Vec3, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material); position(mesh, at);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
  }

  private buildGeometry(): void {
    const batches = new Map<string, THREE.BufferGeometry[]>();
    const append = (key: string, geometry: THREE.BufferGeometry) => { const entries = batches.get(key) ?? []; entries.push(geometry); batches.set(key, entries); };
    const floorGeometries = new Map<string, THREE.BufferGeometry>();
    const wallGeometries = new Map<string, THREE.BufferGeometry>();
    for (const floor of this.level.floors) {
      const geometry = floorGeometry(floor); floorGeometries.set(floor.id, geometry);
      append(floor.material === 'metal' ? 'metal' : 'floor', geometry);
      if (floor.material === 'water') {
        const water = floorGeometry({ ...floor, y: floor.y + 0.025 }, 0.012); append('water', water);
      }
      const ceiling = floorGeometry({ ...floor, y: floor.y + 3.38 }, 0.08); append('dark', ceiling);
    }
    for (const wall of this.level.walls) {
      const geometry = new THREE.BoxGeometry(wall.size.x, wall.size.y, wall.size.z);
      geometry.rotateY(wall.yaw); geometry.translate(wall.position.x, wall.position.y, wall.position.z);
      wallGeometries.set(wall.id, geometry);
      if (!wall.id.startsWith('prop-')) append(wall.material, geometry);
    }
    for (const [kind, geometries] of batches) {
      const merged = mergeGeometries(geometries, false); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.worldMaterials[kind]); mesh.castShadow = kind !== 'water'; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    for (const cluster of this.level.echoClusters) {
      const edges: THREE.BufferGeometry[] = [];
      for (const id of cluster.floorIds) { const geometry = floorGeometries.get(id); if (geometry) edges.push(new THREE.EdgesGeometry(geometry, 25)); }
      for (const id of cluster.wallIds) { const geometry = wallGeometries.get(id); if (geometry) edges.push(new THREE.EdgesGeometry(geometry, 25)); }
      const merged = mergeGeometries(edges, false); if (!merged) continue;
      const material = createEchoMaterial(); material.uniforms.uCenter.value.copy(vector(cluster.center));
      const line = new THREE.LineSegments(merged, material); line.visible = false; line.renderOrder = 3;
      this.scene.add(line); this.echoLines.set(cluster.id, line);
      for (const edge of edges) edge.dispose();
    }
    new THREE.TextureLoader().load('/knock-first/textures/echo-front-mask.png', mask => {
      if (!this.alive) { mask.dispose(); return; }
      mask.wrapS = THREE.RepeatWrapping;
      for (const line of this.echoLines.values()) { line.material.uniforms.uMask.value.dispose(); line.material.uniforms.uMask.value = mask; }
    }, undefined, () => this.callbacks.assetError('echo-front-mask.png'));
    for (const geometry of floorGeometries.values()) geometry.dispose();
    for (const geometry of wallGeometries.values()) geometry.dispose();
    for (const portal of this.level.portals.filter(p => !p.channel)) {
      const root = new THREE.Group(); position(root, portal.position); root.rotation.y = portal.yaw;
      this.addBox(root, { x: 0.16, y: 3.15, z: 0.24 }, { x: -1.57, y: 1.575, z: 0 }, this.worldMaterials.bronze);
      this.addBox(root, { x: 0.16, y: 3.15, z: 0.24 }, { x: 1.57, y: 1.575, z: 0 }, this.worldMaterials.bronze);
      this.addBox(root, { x: 3.3, y: 0.16, z: 0.24 }, { x: 0, y: 3.13, z: 0 }, this.worldMaterials.bronze);
      if (portal.door) {
        const panel = new THREE.Group();
        this.addBox(panel, { x: 2.98, y: 2.96, z: 0.14 }, { x: 0, y: 1.48, z: 0 }, this.worldMaterials.metal);
        for (const y of [0.3, 1.5, 2.7]) this.addBox(panel, { x: 2.65, y: 0.08, z: 0.22 }, { x: 0, y, z: 0 }, this.worldMaterials.dark);
        for (const x of [-0.92, 0.92]) this.addBox(panel, { x: 0.08, y: 0.4, z: 0.12 }, { x, y: 1.3, z: 0.15 }, this.worldMaterials.bronze);
        const echoGeometry = new THREE.BoxGeometry(2.99, 2.97, 0.16); echoGeometry.translate(0, 1.485, 0);
        const edges = new THREE.EdgesGeometry(echoGeometry); echoGeometry.dispose();
        const echoMaterial = createEchoMaterial(); echoMaterial.uniforms.uCenter.value.copy(vector(portal.position));
        const echo = new THREE.LineSegments(edges, echoMaterial); echo.visible = false; echo.renderOrder = 3;
        panel.add(echo); this.doorEchoes.set(portal.id, echo);
        root.add(panel); this.doorPanels.set(portal.id, panel);
      }
      this.doorRoots.set(portal.id, root);
      this.scene.add(root);
      // Real inclined rails share the corridor's exact floor endpoints.
      if (Math.abs(portal.aPoint.y - portal.bPoint.y) > 0.01) {
        const horizontal = Math.abs(portal.aPoint.x - portal.bPoint.x) > Math.abs(portal.aPoint.z - portal.bPoint.z);
        for (const side of [-1, 1]) {
          const start = vector(portal.aPoint).add(new THREE.Vector3(horizontal ? 0 : side * 1.48, 1, horizontal ? side * 1.48 : 0));
          const end = vector(portal.bPoint).add(new THREE.Vector3(horizontal ? 0 : side * 1.48, 1, horizontal ? side * 1.48 : 0));
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, start.distanceTo(end), 8), this.worldMaterials.bronze);
          rail.position.copy(start.clone().add(end).multiplyScalar(0.5)); rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()); this.scene.add(rail);
          for (const t of [0, 0.33, 0.66, 1]) this.addBox(this.scene, { x: 0.04, y: 1, z: 0.04 }, { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t - 0.5, z: start.z + (end.z - start.z) * t }, this.worldMaterials.bronze);
        }
      }
    }
    for (const zone of this.level.zones) {
      const props = new THREE.Group(); this.scene.add(props); this.propZones.set(zone.id, props);
      const light = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.12, 12), this.worldMaterials.lamp);
      light.position.set(zone.center.x, zone.center.y + 3.12, zone.center.z); props.add(light);
      this.addBox(props, { x: 1.6, y: 0.05, z: 0.22 }, { x: zone.center.x, y: zone.center.y + 3.25, z: zone.center.z }, this.worldMaterials.dark);
    }
    const lift = this.level.zones.find(z => z.safe)!;
    // Amber chevrons define the safe boundary without a screen overlay.
    for (const portal of this.level.portals.filter(p => p.a === lift.id || p.b === lift.id)) {
      const point = portal.a === lift.id ? portal.aPoint : portal.bPoint;
      const horizontal = Math.abs(point.x - lift.center.x) > Math.abs(point.z - lift.center.z);
      for (let i = -5; i <= 5; i++) {
        const stripe = this.addBox(this.scene, { x: horizontal ? 0.18 : 0.14, y: 0.008, z: horizontal ? 0.14 : 0.18 }, { x: point.x + (horizontal ? 0 : i * 0.25), y: point.y + 0.006, z: point.z + (horizontal ? i * 0.25 : 0) }, this.worldMaterials.lamp);
        stripe.rotation.y = Math.PI / 4;
      }
    }
    for (const socket of this.level.sockets) {
      const material = new THREE.MeshStandardMaterial({ color: '#d89d51', emissive: '#d89d51', emissiveIntensity: 0.7 });
      const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), material); indicator.position.set(socket.x, socket.y + 1.13, socket.z); this.scene.add(indicator); this.socketLights.push(indicator);
    }
  }

  private buildSigns(): void {
    this.scene.remove(this.signs); disposeTree(this.signs); this.signs = new THREE.Group(); this.scene.add(this.signs);
    const ru = this.settings.language === 'ru';
    for (const portal of this.level.portals.filter(p => !p.channel)) for (const fromA of [true, false]) {
      const here = this.level.zones.find(z => z.id === (fromA ? portal.a : portal.b))!;
      const there = this.level.zones.find(z => z.id === (fromA ? portal.b : portal.a))!;
      const entry = fromA ? portal.aPoint : portal.bPoint;
      const inward = vector(here.center).sub(vector(entry)).normalize();
      const sign = makePhysicalSign(`${there.id}  ${there.name[this.settings.language]}`, there.safe ? (ru ? 'БЕЗОПАСНАЯ ГРАНИЦА' : 'SAFE BOUNDARY') : (ru ? 'АРХИВНЫЙ КОМПЛЕКС' : 'ARCHIVE COMPLEX'), there.safe ? '#e6be80' : '#d5e0d6');
      sign.position.set(entry.x + inward.x * 0.25, entry.y + 2.62, entry.z + inward.z * 0.25);
      sign.rotation.y = Math.atan2(inward.x, inward.z);
      for(const x of [-.62,.62]) this.addBox(sign,{x:.035,y:.23,z:.035},{x,y:.43,z:-.045},this.worldMaterials.dark);
      this.signs.add(sign);
    }
    for (const resonator of this.level.resonators) {
      const sign=makePhysicalSign('Q',ru?'СТУК':'KNOCK','#e4d3a9',.29);
      sign.position.set(resonator.position.x-.13,resonator.position.y+.47,resonator.position.z);
      sign.rotation.y=-Math.PI/2;
      this.addBox(sign,{x:.055,y:.045,z:.16},{x:0,y:0,z:-.09},this.worldMaterials.dark);
      this.signs.add(sign);
    }
    for (const portal of this.level.portals.filter(p => p.channel)) for (const point of [portal.aPoint, portal.bPoint]) {
      const zone = this.level.zones.find(z => Math.hypot(z.center.x - point.x, z.center.z - point.z) < 6)!;
      const toward = vector(zone.center).sub(vector(point));
      const sign = makeSign(ru ? 'ЗВУКОВОЙ КАНАЛ' : 'SOUND CHANNEL', ru ? 'Звук проходит. Эхо — нет.' : 'Sound passes. Echo does not.', '#aac9cc');
      sign.scale.setScalar(0.65); sign.position.set(point.x, point.y - 0.6, point.z); sign.rotation.y = Math.atan2(toward.x, toward.z); this.signs.add(sign);
    }
  }

  private buildFootprint(): void {
    for (const x of [-0.11, 0.11]) this.addBox(this.footprint, { x: 0.14, y: 0.12, z: 0.3 }, { x, y: 0.08, z: 0.06 }, this.worldMaterials.dark);
    for (const x of [-0.12, 0.12]) {
      const trouser = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.72, 7), this.worldMaterials.dark); trouser.position.set(x, 0.5, 0.07); this.footprint.add(trouser);
    }
    this.addBox(this.footprint, { x: 0.38, y: 0.42, z: 0.22 }, { x: 0, y: 1.02, z: 0.08 }, this.worldMaterials.metal);
    this.scene.add(this.footprint);
  }

  private asset(file: string): Promise<GLTF | null> {
    const found = this.assets.get(file); if (found) return found;
    const request = this.loader.loadAsync(`/knock-first/models/${file}.glb`).then(asset => {
      if (!this.alive) { disposeTree(asset.scene); return null; }
      this.loadedAssets.set(file, asset); return asset;
    }).catch(() => {
      if (REQUIRED_MODELS.has(file)) this.failAssets(`${file}.glb`);
      else if (this.alive) this.callbacks.assetError(`${file}.glb`);
      return null;
    });
    this.assets.set(file, request); return request;
  }

  private failAssets(file: string): void {
    if (!this.alive || this.assetsFailed) return;
    this.assetsFailed = true;
    this.setEnabled(false);
    this.callbacks.assetError(file);
    this.callbacks.context('unavailable');
  }

  private async instance(file: string, fallback?: () => THREE.Group): Promise<ModelInstance> {
    const gltf = await this.asset(file); const body = gltf ? cloneSkeleton(gltf.scene) : fallback?.() ?? new THREE.Group();
    body.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; } });
    const root = new THREE.Group(); root.add(body);
    const mixer = gltf?.animations.length ? new THREE.AnimationMixer(body) : null;
    const actions = new Map<string, THREE.AnimationAction>();
    if (mixer) for (const clip of gltf!.animations) actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
    const model: ModelInstance = { root, body, mixer, actions, clip: '', previousPosition: new THREE.Vector3() };
    this.playClip(model, 'idle'); return model;
  }

  /** Separate depth projection keeps a first-person asset's authored screen scale.
   * World projection and world depth remain intact; carry uses ordinary depth. */
  private configureViewmodel(root: THREE.Object3D): void {
    root.traverse(object=>{
      object.layers.set(1);if(!(object instanceof THREE.Mesh))return;
      object.castShadow=false;
      const configure=(source:THREE.Material)=>{
        const material=source.clone();
        material.onBeforeCompile=shader=>{
          shader.uniforms.uViewmodelDepthScale=this.viewmodelDepthScale;
          shader.vertexShader='uniform float uViewmodelDepthScale;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
            float vmDepth=max(0.041,-mvPosition.z*uViewmodelDepthScale);
            gl_Position.z=((110.0+0.04)/(110.0-0.04)-2.0*110.0*0.04/((110.0-0.04)*vmDepth))*gl_Position.w;
          `);
        };
        material.customProgramCacheKey=()=> 'knock-viewmodel-depth-v1';return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(configure):configure(object.material);
    });
  }

  private async loadModels(): Promise<void> {
    const [hands, listener] = await Promise.all([this.instance('arms'), this.instance('listener'), this.asset('operative'), this.asset('battery')]);
    if (!this.alive || this.assetsFailed) return;
    this.handModel = hands; this.configureViewmodel(hands.body); this.camera.add(hands.root);
    hands.root.position.set(0, 0, 0); hands.root.renderOrder = 2;
    this.listenerModel = listener; this.scene.add(listener.root); listener.root.visible = false;
    const [striker, beacon, door, frame] = await Promise.all([this.asset('striker'), this.asset('beacon'), this.asset('door'), this.asset('door-frame')]);
    if (!this.alive) return;
    if (striker) {
      const hand = hands.body.getObjectByName('ToolGrip_R') ?? hands.body.getObjectByName('right_hand');
      if (hand) { this.strikerModel = striker.scene.clone(true); this.strikerModel.position.set(0.08, 0, 0); this.strikerModel.rotation.z = Math.PI / 2; this.configureViewmodel(this.strikerModel); hand.add(this.strikerModel); }
    }
    if (beacon) { this.ownBeacon = beacon.scene.clone(true); this.scene.add(this.ownBeacon); this.ownBeacon.visible = false; }
    for (const root of this.doorRoots.values()) if (frame) {
      for (const child of [...root.children]) if (child instanceof THREE.Mesh) { child.geometry.dispose(); root.remove(child); }
      root.add(frame.scene.clone(true));
    }
    for (const panel of this.doorPanels.values()) if (door) {
      for (const child of [...panel.children]) if (child instanceof THREE.Mesh) { child.geometry.dispose(); panel.remove(child); }
      panel.add(door.scene.clone(true));
    }
    const statics: Promise<void>[] = [];
    const addModel = async (name: string, at: Vec3, yaw = 0, scale = 1, parent: THREE.Object3D = this.scene) => {
      const asset = await this.asset(name); if (!asset || !this.alive) return;
      const model = asset.scene.clone(true); position(model, at); model.rotation.y = yaw; model.scale.setScalar(scale);
      model.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = mesh.receiveShadow = true; } }); parent.add(model);
    };
    const lift = this.level.zones.find(z => z.safe)!;
    statics.push(addModel('lift', lift.center), addModel('cabinet', this.level.cabinet));
    statics.push(addModel('archive-box', { ...this.level.cabinet, y: this.level.cabinet.y + 1.3 }));
    for (const socket of this.level.sockets) statics.push(addModel('socket', socket));
    for (const resonator of this.level.resonators) statics.push(addModel('resonator', { ...resonator.position, y: resonator.position.y - 1.05 }, Math.PI / 2, 1, this.propZones.get(resonator.zoneId)));
    for (const pedestal of this.level.pedestals) statics.push(addModel('pallet', { ...pedestal.position, y: pedestal.position.y - 0.202 }, 0, 1, this.propZones.get(pedestal.zoneId)));
    for (const zone of this.level.zones.filter(z => !z.safe)) {
      const group = this.propZones.get(zone.id)!;
      for (const side of [-1, 1]) {
        const at = { x: zone.center.x + side * 4.35, y: zone.center.y, z: zone.center.z + 3.4 };
        statics.push(addModel(zone.material === 'water' ? 'pump' : 'shelf', at, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1, group));
      }
      // Wall and ceiling fixtures are outside all capsule/handle travel clearances.
      statics.push(addModel('pipe', { x: zone.center.x - 4.96, y: zone.center.y + 1.8, z: zone.center.z - 2.7 }, 0, 0.8, group));
      statics.push(addModel('vent', { x: zone.center.x, y: zone.center.y + 1.95, z: zone.center.z + 4.93 }, 0, 1, group));
      statics.push(addModel('cable', { x: zone.center.x - 3.6, y: zone.center.y + 2.9, z: zone.center.z }, 0, 1, group));
      statics.push(addModel('valve', { x: zone.center.x + 4.96, y: zone.center.y + 1.8, z: zone.center.z - 3 }, -Math.PI / 2, 0.75, group));
      statics.push(addModel('lamp', { x: zone.center.x, y: zone.center.y + 2.68, z: zone.center.z }, 0, 1, group));
      if (zone.id.charCodeAt(0) % 3 === 0) statics.push(addModel('fan', { x: zone.center.x - 2.7, y: zone.center.y + 1.86, z: zone.center.z + 4.9 }, 0, 1, group));
      if (zone.id.charCodeAt(0) % 3 === 1) statics.push(addModel('control-panel', { x: zone.center.x + 4.96, y: zone.center.y + 1.95, z: zone.center.z - 1 }, -Math.PI / 2, 1, group));
      if (zone.id.charCodeAt(0) % 3 === 2) {
        statics.push(addModel('ladder', { x: zone.center.x - 4.3, y: zone.center.y, z: zone.center.z + 2.85 }, Math.PI / 2, 0.8, group));
        statics.push(addModel('extinguisher', { x: zone.center.x + 4.17, y: zone.center.y + 0.8, z: zone.center.z + 3.4 }, -Math.PI / 2, 1, group));
      }
    }
    await Promise.all(statics);
  }

  private playClip(model: ModelInstance, name: string, once = false): void {
    if (model.clip === name) return;
    const action = model.actions.get(name) ?? model.actions.get('idle'); if (!action) return;
    const previous = model.actions.get(model.clip); previous?.fadeOut(0.14);
    action.reset(); action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); action.clampWhenFinished = once; action.fadeIn(0.14).play(); model.clip = name;
  }

  private fallbackBattery(): THREE.Group {
    const group = new THREE.Group();
    this.addBox(group, { x: 0.95, y: 0.43, z: 0.55 }, { x: 0, y: 0.215, z: 0 }, this.worldMaterials.metal);
    for (const x of [-0.62, 0.62]) {
      this.addBox(group, { x: 0.05, y: 0.05, z: 0.34 }, { x, y: 0.32, z: 0 }, this.worldMaterials.bronze);
      for (const z of [-0.145, 0.145]) this.addBox(group, { x: 0.2, y: 0.04, z: 0.04 }, { x: x * 0.85, y: 0.32, z }, this.worldMaterials.bronze);
    }
    return group;
  }

  private updateActors(delta: number): void {
    const ids = new Set(this.view.actors.map(actor => actor.id));
    for (const [id, model] of this.actors) if (!ids.has(id)) model.root.visible = false;
    for (const actor of this.view.actors) {
      if (actor.id === this.view.self.id) continue;
      let model = this.actors.get(actor.id);
      if (!model) {
        const placeholder: ModelInstance = { root: new THREE.Group(), body: new THREE.Group(), mixer: null, actions: new Map(), clip: '', previousPosition: vector(actor.position) };
        this.actors.set(actor.id, placeholder);
        void this.instance('operative').then(loaded => {
          if (!this.alive) return;
          loaded.previousPosition.copy(vector(actor.position)); position(loaded.root, actor.position); loaded.root.visible = this.view.actors.some(current => current.id === actor.id); this.actors.set(actor.id, loaded); this.scene.add(loaded.root);
          void this.asset('beacon').then(asset => { if (!asset || !this.alive) return; const beacon = asset.scene.clone(true); beacon.name = 'rescue-beacon'; beacon.position.set(0.22, 0.05, 0.08); loaded.root.add(beacon); });
        });
        model = placeholder;
      }
      const old = model.root.position.clone(); model.root.visible = true;
      model.root.position.lerp(vector(actor.position), 1 - Math.exp(-delta * 22));
      model.root.rotation.y = this.carryFacing(actor) ?? actor.yaw;
      const moving = old.distanceToSquared(model.root.position) > 0.000001;
      const pose = actor.pose === 'quiet' ? 'crouch' : actor.pose;
      this.playClip(model, pose ?? (actor.status === 'downed' ? 'down' : actor.carrying ? 'carry' : actor.botIntent.includes('help') ? 'revive' : moving ? 'walk' : 'idle'), actor.status === 'downed');
      restoreRigPose(model.body); model.mixer?.update(delta);
      this.updateActorTag(model, actor);
      const label = model.root.getObjectByName('player-label');
      if (label) { label.visible = model.root.position.distanceTo(this.camera.position) < 4.5; label.quaternion.copy(this.camera.quaternion); label.rotation.y -= model.root.rotation.y; }
      const beacon = model.root.getObjectByName('rescue-beacon'); if (beacon) beacon.visible = actor.status !== 'active';
      if (actor.carrying) {
        const battery = this.view.batteries.find(b => b.id === actor.carrying);
        if (battery) {
          solveCarryStance(model.body, model.root.position.y - this.batteryFloor(battery), point => {
            const floor = floorAt(this.level, point.x, point.z); return floor ? floorHeight(floor, point.x, point.z) + 0.105 : point.y;
          });
        }
        this.gripForActor(model, actor);
      }
    }
    if (this.listenerModel) {
      const listener = this.view.listener;
      this.listenerModel.root.visible = !!listener;
      if (listener) {
        const previous = this.listenerModel.root.position.clone();
        const target = vector(listener.position);
        if (this.listenerModel.root.position.distanceTo(target) > 6) this.listenerModel.root.position.copy(target);
        else this.listenerModel.root.position.lerp(target, 1 - Math.exp(-delta * 25));
        this.listenerModel.root.rotation.y = listener.yaw;
        const speed = previous.distanceTo(this.listenerModel.root.position) / Math.max(delta, 0.01);
        this.playClip(this.listenerModel, listener.lunging ? 'lunge' : speed > 2.6 ? 'run' : speed > 0.1 ? 'walk' : 'listen', listener.lunging); this.listenerModel.mixer?.update(delta);
      }
    }
  }

  private updateActorTag(model: ModelInstance, actor: PublicActor): void {
    if (!model.root.parent) return;
    const text = actor.kind === 'bot' || actor.assistant ? `${actor.name} · ${this.settings.language === 'ru' ? 'БОТ' : 'BOT'}` : actor.name;
    if (model.root.userData.labelKey === text) return;
    const previous = model.root.getObjectByName('player-label');
    if (previous) { model.root.remove(previous); disposeTree(previous); }
    const label = makeSign(text, '', '#c8d9ce'); label.scale.setScalar(0.22); label.position.set(0, 1.94, 0); label.name = 'player-label';
    model.root.add(label); model.root.userData.labelKey = text;
  }

  private updateBatteries(delta: number): void {
    const visible = new Set(this.view.batteries.map(b => b.id));
    for (const [id, model] of this.batteries) if (!visible.has(id)) model.root.visible = false;
    for (const battery of this.view.batteries) {
      let model = this.batteries.get(battery.id);
      if (!model) {
        const root = this.fallbackBattery(); this.scene.add(root);
        const initial: ModelInstance = { root, body: root, mixer: null, actions: new Map(), clip: '', previousPosition: vector(battery.position) };
        position(root, battery.position); this.batteries.set(battery.id, initial); model = initial;
        void this.instance('battery', () => this.fallbackBattery()).then(loaded => {
          if (!this.alive) return; loaded.root.position.copy(initial.root.position); loaded.root.rotation.copy(initial.root.rotation);
          this.scene.remove(initial.root);
          initial.root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
          loaded.root.visible = this.view.batteries.some(current => current.id === battery.id); this.batteries.set(battery.id, loaded); this.scene.add(loaded.root);
        });
      }
      model.root.visible = true;
      const target = vector(battery.position); target.y += battery.holders.some(Boolean) ? 0.33 : battery.installed ? 0.14 : 0;
      model.root.position.lerp(target, 1 - Math.exp(-delta * 28)); model.root.rotation.y = battery.yaw;
    }
    this.socketLights.forEach((light, index) => { const color = this.view.sockets[index] ? '#b2e5ce' : '#d89d51'; light.material.color.set(color); light.material.emissive.set(color); });
    const timerIds = new Set(this.view.timers.map(timer => timer.id));
    for (const [id, model] of this.timers) if (!timerIds.has(id)) { this.scene.remove(model.root); this.timers.delete(id); }
    for (const timer of this.view.timers) if (!this.timers.has(timer.id)) {
      const pending: ModelInstance = { root: new THREE.Group(), body: new THREE.Group(), mixer: null, actions: new Map(), clip: '', previousPosition: vector(timer.position) };
      this.timers.set(timer.id, pending);
      void this.instance('timer').then(model => { if (!this.alive || !this.view.timers.some(t => t.id === timer.id)) return; position(model.root, timer.position); this.scene.add(model.root); this.timers.set(timer.id, model); });
    }
  }

  private gripForActor(model: ModelInstance, actor: PublicActor): void {
    const battery = this.view.batteries.find(b => b.id === actor.carrying); if (!battery) return;
    const index = battery.holders.indexOf(actor.id); if (index < 0) return;
    this.applyGrip(model, battery, index);
  }

  private carryFacing(actor: PublicActor): number | null {
    const battery = this.view.batteries.find(b => b.id === actor.carrying);
    const handle = battery?.holders.indexOf(actor.id) ?? -1;
    return battery && handle >= 0 ? battery.yaw + (handle === 0 ? -Math.PI / 2 : Math.PI / 2) : null;
  }

  private batteryFloor(battery: PublicBattery): number {
    return (this.batteries.get(battery.id)?.root.position.y ?? battery.position.y + 0.33) - 0.33;
  }

  private applyGrip(model: ModelInstance, battery: PublicBattery, handle: number): void {
    const side = handle === 0 ? -1 : 1;
    const c = Math.cos(battery.yaw), s = Math.sin(battery.yaw);
    const root = this.batteries.get(battery.id)?.root;
    root?.updateWorldMatrix(true, false);
    // Follow the rendered interpolation of the same authoritative battery transform.
    const center = root ? root.localToWorld(new THREE.Vector3(side * 0.62, 0.32, 0)) : new THREE.Vector3(battery.position.x + side * 0.62 * c, battery.position.y + 0.65, battery.position.z - side * 0.62 * s);
    // The two carriers face each other, so the left/right grip order is reversed.
    const crossbar = new THREE.Vector3(s, 0, c).multiplyScalar(handle === 0 ? 0.11 : -0.11);
    const orientation=model.root.getWorldQuaternion(new THREE.Quaternion());
    for(const arm of ['left','right'] as const){
      const target=center.clone().addScaledVector(crossbar,arm==='left'?-1:1);
      if(!solvePalmGrip(model.body,arm,target,orientation)) solveArmGrip(model.body,arm,target);
    }
  }

  private updateEcho(time: number): void {
    for (const line of this.echoLines.values()) line.visible = false;
    for (const line of this.doorEchoes.values()) line.visible = false;
    for (const echo of this.view.echoes) for (const cluster of echo.clusters) {
      const line = this.echoLines.get(cluster.id); if (!line || time < cluster.arrivalAt - 0.2 || time > cluster.expiresAt + 0.15) continue;
      if (line.visible && line.material.uniforms.uArrival.value > cluster.arrivalAt) continue;
      line.visible = true; line.material.uniforms.uTime.value = time; line.material.uniforms.uArrival.value = cluster.arrivalAt;
      line.material.uniforms.uSource.value.copy(vector(echo.source));
      line.material.uniforms.uStrength.value = this.settings.softEcho ? (this.settings.contrast ? 0.85 : 0.65) : (this.settings.contrast ? 1.25 : 1);
    }
    for (const [id, line] of this.doorEchoes) {
      const portal = this.level.portals.find(p => p.id === id)!;
      const near = this.level.echoClusters.filter(c => Math.hypot(c.center.x - portal.position.x, c.center.z - portal.position.z) < 2.6).map(c => c.id);
      for (const echo of this.view.echoes) {
        const cluster = echo.clusters.find(c => near.includes(c.id) && time >= c.arrivalAt - 0.2 && time <= c.expiresAt);
        if (!cluster) continue;
        line.visible = true; line.material.uniforms.uTime.value = time; line.material.uniforms.uArrival.value = cluster.arrivalAt;
        line.material.uniforms.uSource.value.copy(vector(echo.source)); line.material.uniforms.uStrength.value = this.settings.softEcho ? 0.8 : 1;
      }
    }
  }

  private updateMarks(): void {
    const ids = new Set(this.view.marks.map(mark => mark.id));
    for (const [id, group] of this.marks) if (!ids.has(id)) { this.scene.remove(group); disposeTree(group); this.marks.delete(id); }
    for (const mark of this.view.marks) {
      let group = this.marks.get(mark.id);
      if (!group) {
        group = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 4, 16), new THREE.MeshBasicMaterial({ color: mark.kind === 'danger' ? '#e0a15c' : '#91d7ec', depthTest: true })); ring.rotation.x = Math.PI / 2; group.add(ring);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 5), new THREE.MeshBasicMaterial({ color: '#91d7ec' })); stem.position.y = 0.3; group.add(stem);
        this.marks.set(mark.id, group); this.scene.add(group);
      }
      position(group, { ...mark.position, y: mark.position.y + 0.06 });
    }
  }

  private predictPosition(input: KnockControlInput, age: number): THREE.Vector3 {
    if (!this.enabled) return vector(this.view.self.position);
    return vector(predictPlayerPosition(this.level, this.view, input, age));
  }

  private measureHandClearance(): number {
    this.camera.updateWorldMatrix(true,false);
    const direction=this.camera.getWorldDirection(new THREE.Vector3()); let closest=1;
    for(const x of [-.24,0,.24]){
      const origin=this.camera.localToWorld(new THREE.Vector3(x,-.22,0));this.clearanceRay.set(origin,direction);
      for(const wall of this.level.walls){
        const center=vector(wall.position),half=vector(wall.size).multiplyScalar(.5);
        this.clearanceBox.set(center.clone().sub(half),center.clone().add(half));
        const hit=this.clearanceRay.intersectBox(this.clearanceBox,this.clearanceHit);
        if(hit)closest=Math.min(closest,origin.distanceTo(hit));
      }
      for(const [id,panel] of this.doorPanels){
        const portal=this.level.portals.find(p=>p.id===id)!;
        const center=vector(portal.position).add(new THREE.Vector3(0,panel.position.y+1.48,0));
        const half=new THREE.Vector3(portal.yaw ? .09 : 1.5,1.48,portal.yaw?1.5:.09);
        this.clearanceBox.set(center.clone().sub(half),center.clone().add(half));
        const hit=this.clearanceRay.intersectBox(this.clearanceBox,this.clearanceHit);
        if(hit)closest=Math.min(closest,origin.distanceTo(hit));
      }
    }
    return closest;
  }

  private tuckHands(delta: number): void {
    const measured=this.measureHandClearance();
    // Fast enough on approach to avoid crossing the surface, slow on release.
    this.handClearance=THREE.MathUtils.damp(this.handClearance,measured,measured<this.handClearance?35:10,delta);
    this.flashlight.intensity=16*Math.min(1,Math.pow(Math.max(.05,measured-.1)/.9,2));
    this.viewmodelDepthScale.value=this.view.self.carrying?1:Math.min(1,Math.max(.12,this.handClearance-.035)/.9);
    if(!this.handModel || this.view.self.carrying || this.view.self.status!=='active' || this.handClearance>.85)return;
    const proximity=1-THREE.MathUtils.smoothstep(this.handClearance,.3,.85);
    for(const side of ['left','right'] as const){
      const hand=this.handModel.body.getObjectByName(`${side}_hand`);if(!hand)continue;
      this.handModel.root.updateWorldMatrix(true,true);
      const orientation=hand.getWorldQuaternion(new THREE.Quaternion());
      const axis=new THREE.Vector3(0,0,1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
      orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,proximity*(side==='right'?.20:-.08)));
      const point=hand.getWorldPosition(new THREE.Vector3());
      // A restrained wrist response; never pull the entire hands toward the lens.
      solveArmGrip(this.handModel.body,side,point,orientation);
    }
  }

  private animate = (now: number): void => {
    if (!this.alive) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.previousFrame ? Math.min(0.05, (now - this.previousFrame) / 1000) : 1 / 60;
    if (this.previousFrame && now - this.previousFrame < 250 && !document.hidden) this.frameTimes.push(now - this.previousFrame);
    this.previousFrame = now;
    if (this.contextLost || this.assetsFailed) return;
    const input = this.controls.input();
    if (now - this.inputAt >= 1000 / 30) { this.inputAt = now; this.callbacks.input(input); }
    const age = Math.max(0, (now - this.snapshotAt) / 1000);
    const predicted = this.predictPosition(input, age);
    const previousPosition=this.ownPosition.clone();
    if (!this.ownInitialised) { this.ownPosition.copy(predicted); this.ownInitialised = true; }
    else this.ownPosition.lerp(predicted, 1 - Math.exp(-delta * 40));
    const targetEye = this.view.self.status === 'downed' ? 0.48 : 1.58;
    this.eyeHeight = this.settings.reducedMotion ? targetEye : THREE.MathUtils.damp(this.eyeHeight, targetEye, 10, delta);
    const travelled=this.ownInitialised?this.ownPosition.distanceTo(previousPosition)/Math.max(delta,.001):0;
    this.motionSpeed=THREE.MathUtils.damp(this.motionSpeed,Math.min(5,travelled),14,delta);
    const moving=this.motionSpeed>.18 && Math.hypot(input.moveX,input.moveZ)>.05;
    const bob = moving && !this.settings.reducedMotion && !this.view.self.carrying ? Math.sin(now * (input.run ? 0.012 : 0.008)) * 0.004 : 0;
    this.camera.position.copy(this.ownPosition).add(new THREE.Vector3(0, this.eyeHeight + bob, 0));
    this.camera.rotation.set(input.pitch, input.yaw, 0, 'YXZ');
    const fov = Math.max(52, Math.min(74, this.settings.fov)); if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.audio.listener({ x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }, input.yaw, input.pitch);
    this.footprint.position.copy(this.ownPosition); this.footprint.rotation.y = this.carryFacing(this.view.self) ?? input.yaw; this.footprint.visible = input.pitch < -0.8;
    const nearest = this.level.zones.flatMap(zone => zone.safe
      ? [-1,1].flatMap(x=>[-1,1].map(z=>({zone,at:new THREE.Vector3(zone.center.x+x*3,zone.center.y+2.8,zone.center.z+z*3)})))
      : [{zone,at:vector(zone.center).add(new THREE.Vector3(0,2.65,0))}])
      .map(light=>({...light,distance:light.at.distanceTo(this.camera.position)})).sort((a,b)=>a.distance-b.distance);
    this.lamps.forEach((lamp,index)=>{
      const light=nearest[index]; const active=!!light && light.distance<14 && (this.settings.quality==='high'||index<2);
      lamp.intensity=active?(light.zone.safe?16:10):0;
      if(light){lamp.position.copy(light.at);lamp.distance=light.zone.safe?8:5;}
    });
    const closeResonator=this.level.resonators.find(r=>vector(r.position).distanceTo(this.camera.position)<4 && this.level.zones.find(z=>z.id===r.zoneId)?.safe);
    if(closeResonator){const lamp=this.lamps[3];lamp.position.copy(vector(closeResonator.position)).add(new THREE.Vector3(-.6,1,.2));lamp.intensity=8;lamp.distance=2.6;}
    for (const [id, group] of this.propZones) {
      const zone = this.level.zones.find(z => z.id === id)!; group.visible = Math.hypot(zone.center.x - this.ownPosition.x, zone.center.z - this.ownPosition.z) < (this.settings.quality === 'low' ? 23 : 35);
    }
    for (const door of this.view.doors) {
      const panel = this.doorPanels.get(door.id); if (!panel) continue;
      let openness = door.open ? 1 : 0;
      if (door.moving) { const remaining = Math.max(0, door.completeAt - this.view.time - Math.min(age, 0.15)); openness = door.targetOpen ? 1 - Math.min(1, remaining / 0.7) : Math.min(1, remaining / 0.7); }
      panel.position.y = 3.06 * openness;
    }
    this.updateBatteries(delta); this.updateActors(delta); this.updateMarks();
    if (this.handModel) {
      const carryYaw = this.carryFacing(this.view.self);
      if (carryYaw !== null) {
        // Hands remain on the handles while the player looks around independently.
        if (this.handModel.root.parent !== this.scene) this.scene.add(this.handModel.root);
        const battery = this.view.batteries.find(b => b.id === this.view.self.carrying)!;
        this.handModel.root.position.copy(this.ownPosition); this.handModel.root.position.y = Math.min(this.ownPosition.y, this.batteryFloor(battery));
        this.handModel.root.position.add(new THREE.Vector3(-Math.sin(carryYaw) * 0.03, 1.48, -Math.cos(carryYaw) * 0.03));
        this.handModel.root.rotation.set(0, carryYaw, 0);
      } else {
        if (this.handModel.root.parent !== this.camera) this.camera.add(this.handModel.root);
        this.handModel.root.position.set(0, -.015, -.08); this.handModel.root.rotation.set(0, 0, 0);
      }
      this.handModel.root.visible = this.view.self.status !== 'returning';
      const pulse = now / 1000 - this.handPulseAt < 0.55;
      const clip = this.view.self.status === 'downed' ? 'down' : this.view.self.carrying ? 'carry' : this.view.self.hold?.type === 'revive' ? 'revive' : pulse ? 'knock' : moving ? input.run ? 'run' : input.quiet ? 'crouch' : 'walk' : 'idle';
      this.playClip(this.handModel, clip, clip === 'knock' || clip === 'down'); restoreRigPose(this.handModel.body); this.handModel.mixer?.update(delta);
      if (this.view.self.carrying) this.gripForActor(this.handModel, this.view.self);
    }
    this.tuckHands(delta);
    if (this.strikerModel) this.strikerModel.visible = !this.view.self.carrying && this.view.self.status === 'active';
    if (this.ownBeacon) { this.ownBeacon.visible = this.view.self.status !== 'active'; this.ownBeacon.position.copy(this.ownPosition).add(new THREE.Vector3(0.35, 0.03, -0.25)); }
    this.updateEcho(this.view.time + Math.min(age, 0.15));
    this.renderer.info.reset(); this.camera.layers.set(0); this.renderer.render(this.scene, this.camera);
    // Viewmodel has its own metered key light, preventing the short-range world
    // flashlight from bleaching gloves at twenty centimetres from its origin.
    const background=this.scene.background; this.scene.background=null;
    this.renderer.autoClear=false; this.camera.layers.set(1);
    this.renderer.render(this.scene,this.camera); this.camera.layers.set(0);
    this.renderer.autoClear=true; this.scene.background=background; this.renderedFrames++;
    if (now - this.statAt > 2000) {
      this.statAt = now; const times = this.frameTimes.slice(-240).sort((a, b) => a - b); this.frameTimes = this.frameTimes.slice(-240);
      const stats = { frames: this.renderedFrames, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, frameP95Ms: times[Math.floor(times.length * 0.95)] ?? 0, width: this.container.clientWidth, height: this.container.clientHeight, quality: this.settings.quality };
      this.renderer.domElement.dataset.drawCalls = String(stats.drawCalls); this.renderer.domElement.dataset.frameP95 = stats.frameP95Ms.toFixed(2); this.callbacks.stats(stats);
    }
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault(); this.contextLost = true; this.setEnabled(false); this.callbacks.context('lost');
  };
  private onContextRestored = (): void => {
    if (this.assetsFailed) { this.callbacks.context('unavailable'); return; }
    this.callbacks.context('restoring'); this.contextLost = false; this.ownInitialised = false;
    try {
      this.renderer.compile(this.scene, this.camera);
      if (!this.modelsLoading) this.callbacks.context('ready');
    } catch { this.failAssets('webgl-restore'); }
  };

  dispose(): void {
    this.alive = false; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.destroy(); this.audio.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const model of [...this.actors.values(), ...this.batteries.values(), ...this.timers.values(), this.handModel, this.listenerModel]) model?.mixer?.stopAllAction();
    disposeTree(this.scene, [...this.loadedAssets.values()].map(asset => asset.scene), Object.values(this.worldMaterials));
    this.loadedAssets.clear(); this.assets.clear(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
