import { applyAction, createTutorialWorld, deserializeWorld, resetInputStream, serializeWorld, stepWorld, tutorialProgress, viewForPlayer } from '../core/index'
import type { Action, ActionResult, Input, World, WorldView } from '../core/types'
import type { SessionClient } from './transport'

export type LessonProgress = ReturnType<typeof tutorialProgress>
export const TUTORIAL_SAVE = 'iva.forpost.tutorial.v1'
export class TutorialSession implements SessionClient {
  private world: World
  private latest: WorldView | null = null
  private inputValue: Input = { moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, fireHeld: false, firePressSeq: 0 }
  private timer: ReturnType<typeof setInterval>
  constructor(lesson: number, private onView: (view: WorldView) => void, private onProgress: (progress: LessonProgress) => void, resume = false) {
    this.world = createTutorialWorld(lesson, 'learner')
    if (resume) { try { const saved = localStorage.getItem(TUTORIAL_SAVE); if (saved) { const restored = deserializeWorld(saved); if (restored.mode === 'tutorial') this.world = restored } } catch { /* Invalid lesson saves restart the isolated lesson only. */ } }
    // The restored world belongs to a new local input stream, just like a resumed room.
    resetInputStream(this.world, 'learner')
    this.publish(); this.timer = setInterval(() => { stepWorld(this.world, { learner: this.inputValue }); this.publish(); if (this.world.tick % 30 === 0) this.save() }, 1000 / 30)
  }
  private publish(): void { this.latest = viewForPlayer(this.world, 'learner'); this.onView(this.latest); this.onProgress(tutorialProgress(this.world)) }
  private save(): void { try { localStorage.setItem(TUTORIAL_SAVE, serializeWorld(this.world)) } catch { /* The active exercise remains playable. */ } }
  input(input: Input): void { this.inputValue = { ...input } }
  action(action: Action): Promise<ActionResult> { const result = applyAction(this.world, 'learner', { ...action, actionId: crypto.randomUUID() }); this.publish(); this.save(); return Promise.resolve(result) }
  getView(): WorldView | null { return this.latest }
  claim(): void {}
  close(): void { clearInterval(this.timer); this.save() }
}
