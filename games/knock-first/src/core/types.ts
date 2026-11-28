/** Knock First v1: public geometry and JSON-serializable authoritative state. Metres, Y up. */
export interface Vec3 { x: number; y: number; z: number }
export type RouteId = 'archive' | 'pump' | 'relay';
export type Difficulty = 'calm' | 'normal' | 'tense';
export type Locale = 'ru' | 'en';
export interface KnockSettings { route: RouteId; difficulty: Difficulty; practice: boolean; tutorial: boolean }
export interface Floor { id: string; zoneId: string; x: number; z: number; width: number; depth: number; y: number; slopeX: number; slopeZ: number; material: 'concrete' | 'metal' | 'water'; corridor: boolean }
export interface Wall { id: string; zoneId: string; position: Vec3; size: Vec3; yaw: number; material: 'concrete' | 'metal' | 'archive' }
export interface Zone { id: string; name: Record<Locale,string>; center: Vec3; width: number; depth: number; material: Floor['material']; safe: boolean; lightRadius: number }
export interface Portal { id: string; a: string; b: string; position: Vec3; aPoint: Vec3; bPoint: Vec3; width: number; yaw: number; door: boolean; initiallyClosed: boolean; channel: boolean; channelLength: number }
export interface Resonator { id: string; zoneId: string; position: Vec3; normal: Vec3 }
export interface Pedestal { id: string; zoneId: string; position: Vec3; group: 0 | 1 }
export interface EchoCluster { id: string; zoneId: string; center: Vec3; floorIds: string[]; wallIds: string[] }
export interface KnockLevel { id: RouteId | 'tutorial'; name: Record<Locale,string>; zones: Zone[]; portals: Portal[]; floors: Floor[]; walls: Wall[]; resonators: Resonator[]; pedestals: Pedestal[]; sockets: Vec3[]; cabinet: Vec3; spawns: Vec3[]; patrol: string[]; echoClusters: EchoCluster[]; safeZoneId: string }
export interface MissionParticipant { participantId: string; displayName: string; playerId?: string | null; seatIndex?: number; controller?: {kind: 'human' | 'bot'; [key: string]: unknown}; kind?: 'human' | 'bot' }
/** Desired world-space horizontal direction. yaw=0 looks toward -Z; radians, pitch is Three camera pitch. */
export interface PlayerInput { seq: number; controllerEpoch: number; moveX: number; moveZ: number; yaw: number; pitch: number; run: boolean; quiet: boolean; hand: boolean }
export type ActorStatus = 'active' | 'downed' | 'returning';
export interface HoldAction { type: 'install' | 'revive'; targetId: string; progress: number; duration: number; origin: Vec3 }
export interface Actor { id: string; name: string; playerId: string | null; seatIndex: number; kind: 'human' | 'bot'; assistant: boolean; position: Vec3; yaw: number; pitch: number; zoneId: string; status: ActorStatus; stamina: number; carrying: string | null; timer: boolean; connected: boolean; controllerEpoch: number; input: PlayerInput; lastInputAt: number; disconnectedAt: number | null; lastRunAt: number; lastStepAt: number; lastKnockAt: number; downedRemaining: number; protectedUntil: number; returnAt: number | null; ready: boolean; hold: HoldAction | null; saves: number; knownBatteries: string[]; seenZones: string[]; botIntent: string; botNextAt: number; botTarget: Vec3 | null; botStuckAt: number; botPrevious: Vec3; botThreat: {position: Vec3; until: number; observed: boolean} | null; botRescue: {id: string; position: Vec3; until: number} | null; markTimes: number[]; notice: string | null; noticedUntil: number }
export interface DoorState { id: string; open: boolean; moving: boolean; targetOpen: boolean; completeAt: number; blockedUntil: number | null; actorId: string | null; revision: number }
export interface Battery { id: string; group: 0 | 1; position: Vec3; yaw: number; zoneId: string; holders: [string | null,string | null]; leader: string | null; installed: boolean; socket: number | null; revision: number; lastStable: Vec3; lastNoiseAt: number; moving: boolean; obstruction: 'opposed' | 'angle' | 'blocked' | null }
export type NoiseType = 'quiet-step' | 'step' | 'run' | 'water-step' | 'click' | 'knock' | 'resonator' | 'door' | 'door-push' | 'drag' | 'carry' | 'stop' | 'drop' | 'timer' | 'listener-step' | 'chase' | 'call';
export interface NoiseEvent { id: string; tick: number; at: number; type: NoiseType; zoneId: string; position: Vec3; power: number; echoRadius: number; actorId?: string }
export interface EchoWave { id: string; at: number; source: Vec3; zoneId: string; radius: number; clusters: {id: string; distance: number; arrivalAt: number; expiresAt: number}[] }
export interface SoundCue { id: string; tick: number; at: number; type: NoiseType; position: Vec3; strength: 'soft' | 'medium' | 'loud'; residual: number; occluded: boolean; channel: boolean; direction: 'left' | 'right' | 'ahead' | 'behind'; elevation: 'above' | 'below' | 'level' }
export interface PlacedTimer { id: string; ownerId: string; position: Vec3; zoneId: string; firesAt: number }
export type ListenerMode = 'patrol' | 'investigate' | 'search' | 'chase' | 'return';
export interface Listener { position: Vec3; yaw: number; zoneId: string; mode: ListenerMode; target: Vec3 | null; targetActorId: string | null; path: Vec3[]; pathIndex: number; patrolIndex: number; lastHeardAt: number; lastHeardPower: number; lastSeenAt: number; searchUntil: number; pauseUntil: number; lungeAt: number | null; lungeTargetId: string | null; cooldownUntil: number; lastStepAt: number; cause: string; searchIndex: number }
export interface TeamMark { id: string; actorId: string; kind: 'battery' | 'here' | 'danger' | 'handle' | 'help'; position: Vec3; zoneId: string; expiresAt: number }
export interface MissionEvent { id: string; tick: number; at: number; type: string; actorId?: string; targetId?: string; value?: number; zoneId?: string }
export interface MissionOutcome { kind: 'full' | 'partial' | 'defeat'; reason: string; batteries: number; evacuated: string[]; remaining: number; saves: number; echoes: MissionEvent[]; tick: number }
export type CommandPayload =
 | { type: 'ready' }
 | { type: 'knock' }
 | { type: 'interact'; targetId?: string; handle?: number }
 | { type: 'hand'; down: boolean; targetId?: string }
 | { type: 'takeHandle'; batteryId: string; handle: number }
 | { type: 'drop' }
 | { type: 'door'; doorId: string }
 | { type: 'install'; socket?: number }
 | { type: 'revive'; actorId: string }
 | { type: 'takeTimer' }
 | { type: 'placeTimer' }
 | { type: 'mark'; kind: TeamMark['kind']; position?: Vec3 }
 | { type: 'call' }
 | { type: 'pause'; paused: boolean }
 | { type: 'tutorial'; action: 'sound' | 'skip' | 'restart' };
export interface MissionCommand { actionId: string; controllerEpoch: number; expectedRevision?: number; payload: CommandPayload }
export interface CommandReceipt { actionId: string; ok: boolean; code: string; tick: number; revision: number }
export interface TutorialState { step: number; completed: boolean; distanceQuiet: number; origin: Vec3; hadPair: boolean; released: boolean; lastEvent: string | null }
export interface MissionState { version: 'knock-first@1'; contentVersion: 'knock-first-content@1'; wireVersion: 'knock-first-wire@1'; settings: KnockSettings; seed: number; random: number; tick: number; time: number; phase: 'preparation' | 'active' | 'finished'; preparationRemaining: number; remaining: number; resumeRemaining: number; paused: boolean; revision: number; actors: Actor[]; doors: DoorState[]; doorRevision: number; batteries: Battery[]; sockets: [string | null,string | null]; cabinetTimers: number; timers: PlacedTimer[]; listener: Listener; noises: NoiseEvent[]; echoes: EchoWave[]; discoveredZones: string[]; marks: TeamMark[]; events: MissionEvent[]; charges: number; evacuationSince: number | null; receipts: Record<string,{fingerprint: string; participantId: string; receipt: CommandReceipt}>; resonanceReady: Record<string,number>; outcome: MissionOutcome | null; tutorial: TutorialState | null; nextEvent: number; warningFlags: number[] }
export interface PublicActor { pose?: 'idle' | 'walk' | 'run' | 'quiet' | 'carry' | 'revive' | 'down'; id: string; name: string; seatIndex: number; kind: 'human' | 'bot'; assistant: boolean; position: Vec3; yaw: number; pitch: number; zoneId: string; status: ActorStatus; carrying: string | null; downedRemaining: number; protectedUntil: number; botIntent: string; connected: boolean }
export interface TeamMember { id: string; name: string; seatIndex: number; kind: 'human' | 'bot'; assistant: boolean; status: ActorStatus; connected: boolean; carrying: boolean; inLift: boolean; downedRemaining: number; ready: boolean; saves: number }
export interface PublicBattery { id: string; position: Vec3; yaw: number; zoneId: string; holders: [string | null,string | null]; installed: boolean; socket: number | null; revision: number; obstruction: Battery['obstruction'] }
export interface ActionPrompt { type: 'door' | 'takeHandle' | 'drop' | 'install' | 'revive' | 'takeTimer' | 'none'; targetId: string | null; handle?: number; duration?: number; label: string }
export interface PlayerView { version: 'knock-first@1'; wireVersion: 'knock-first-wire@1'; levelId: KnockLevel['id']; settings: KnockSettings; tick: number; time: number; revision: number; phase: MissionState['phase']; preparationRemaining: number; remaining: number; resumeRemaining: number; paused: boolean; self: PublicActor & {stamina: number; timer: boolean; controllerEpoch: number; acknowledgedSeq: number; knockReadyIn: number; hold: HoldAction | null; notice: string | null}; team: TeamMember[]; actors: PublicActor[]; batteries: PublicBattery[]; doors: DoorState[]; sockets: [string|null,string|null]; cabinetTimers: number; charges: number; listener: null | {position: Vec3; yaw: number; lunging: boolean; visibleUntil: number}; cues: SoundCue[]; echoes: EchoWave[]; marks: TeamMark[]; timers: PlacedTimer[]; discoveredZones: string[]; objectiveSectors: string[][]; prompt: ActionPrompt; knockKind: 'resonator' | 'knock' | 'click' | 'call'; events: MissionEvent[]; outcome: MissionOutcome | null; tutorial: TutorialState | null }
