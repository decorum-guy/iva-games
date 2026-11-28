import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PlayerView } from '../core/types';
import { KnockWorld } from './scene';
import type { KnockControlInput, SceneAction, SceneContextStatus, SceneHandle, SceneSettings, SceneStats, SoundCaption } from './sceneTypes';

export interface SceneProps {
  view: PlayerView;
  settings: SceneSettings;
  enabled: boolean;
  onInput(input: KnockControlInput): void;
  onAction(action: SceneAction, down: boolean): void;
  onPointerLockChange?(locked: boolean): void;
  onContextStatus?(status: SceneContextStatus): void;
  onReady?(): void;
  onCaption?(caption: SoundCaption): void;
  onStats?(stats: SceneStats): void;
  onAssetError?(file: string): void;
}

export const KnockScene = forwardRef<SceneHandle, SceneProps>(function KnockScene(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<KnockWorld | null>(null);
  const current = useRef(props); current.current = props;
  useImperativeHandle(ref, () => ({
    look: (dx, dy) => world.current?.look(dx, dy),
    move: (x, forward) => world.current?.move(x, forward),
    setRun: value => world.current?.setRun(value),
    setQuiet: value => world.current?.setQuiet(value),
    setInteract: value => world.current?.setInteract(value),
    requestControl: () => world.current?.requestControl(),
    releaseControl: () => world.current?.releaseControl(),
    unlockAudio: () => world.current?.unlockAudio() ?? Promise.resolve(),
    soundTest: kind => world.current?.soundTest(kind) ?? Promise.resolve(),
  }), []);
  useEffect(() => {
    if (!host.current) return;
    try {
      world.current = new KnockWorld(host.current, current.current.view, current.current.settings, {
        input: input => current.current.onInput(input), action: (action, down) => current.current.onAction(action, down),
        pointerLock: locked => current.current.onPointerLockChange?.(locked), context: status => current.current.onContextStatus?.(status),
        ready: () => current.current.onReady?.(), caption: caption => current.current.onCaption?.(caption),
        stats: stats => current.current.onStats?.(stats), assetError: file => current.current.onAssetError?.(file),
      });
      world.current.setEnabled(current.current.enabled);
    } catch {
      current.current.onContextStatus?.('unavailable');
    }
    return () => { world.current?.dispose(); world.current = null; };
  }, [props.view.levelId]);
  useEffect(() => { world.current?.update(props.view); }, [props.view]);
  useEffect(() => { world.current?.updateSettings(props.settings); }, [props.settings]);
  useEffect(() => { world.current?.setEnabled(props.enabled); }, [props.enabled]);
  return <div ref={host} className="knock-scene" data-testid="knock-scene" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#03090d' }} />;
});

export default KnockScene;
export type { SceneHandle, SceneSettings, SceneStats, SoundCaption } from './sceneTypes';
