export type SceneLanguage = 'ru' | 'en';

export interface SceneSettings {
  language: SceneLanguage;
  quality: 'high' | 'low';
  sensitivity: number;
  fov: number;
  pointerLock: boolean;
  reducedMotion: boolean;
  softEcho: boolean;
  contrast: boolean;
  muted: boolean;
  mono: boolean;
  quietAudio: boolean;
  volume: number;
  captions: boolean;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  language: 'ru', quality: 'high', sensitivity: 1, fov: 65,
  pointerLock: true, reducedMotion: false, softEcho: true,
  contrast: false, muted: false, mono: false, quietAudio: true,
  volume: 0.75, captions: true,
};

/** Movement is local to the camera: +X right, +Z forward. Angles are radians. */
export interface KnockControlInput {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  run: boolean;
  quiet: boolean;
  interact: boolean;
}

export type SceneAction = 'interact' | 'knock' | 'timer' | 'mark' | 'map' | 'pause';
export type SoundTestKind = 'left' | 'door' | 'neighbour';
export type SceneContextStatus = 'ready' | 'lost' | 'restoring' | 'unavailable';

export interface SceneStats {
  frames: number;
  drawCalls: number;
  triangles: number;
  frameP95Ms: number;
  width: number;
  height: number;
  quality: 'high' | 'low';
}

export interface SceneHandle {
  look(dx: number, dy: number): void;
  move(x: number, forward: number): void;
  setRun(value: boolean): void;
  setQuiet(value: boolean): void;
  setInteract(value: boolean): void;
  requestControl(): void;
  releaseControl(): void;
  unlockAudio(): Promise<void>;
  soundTest(kind: SoundTestKind): Promise<void>;
}

export interface SoundCaption {
  id: string;
  label: string;
  direction: 'left' | 'right' | 'front' | 'behind' | 'near';
  vertical: 'above' | 'below' | 'level';
  strength: 'faint' | 'clear' | 'loud';
  occluded: boolean;
  until: number;
}
