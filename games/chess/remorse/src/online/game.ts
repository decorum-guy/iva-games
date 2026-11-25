import { applyResolvedCommand, legalCommands } from '../core';
import type { Command, GameEvent } from '../core';
import type { GameView, ViewCheckpoint } from '../session/view';
import type { OnlineGameSnapshot, RoomSnapshot } from './protocol';
import { ONLINE_PROTOCOL, ONLINE_SAVE_VERSION } from './protocol';

/** A public server journal. It has no submit/undo method and no future RNG state. */
export class OnlineGame implements GameView {
  readonly record: GameView['record'];

  private constructor(
    readonly room: RoomSnapshot,
    private readonly history: readonly ViewCheckpoint[],
    cursor: number,
  ) {
    const game = room.game;
    this.record = {
      id: game.id, revision: cursor, cursor,
      createdAt: game.createdAt, updatedAt: game.updatedAt,
      config: { mode: 'online', provenance: 'online', human: room.you, level: null,
        names: { white: room.players.white?.name, black: room.players.black?.name } },
      root: game.root, rootLedger: [], actions: game.actions.slice(0, cursor),
      status: history[cursor].state.outcome ? 'finished' : room.status === 'expired' ? 'technical' : 'open',
    };
  }

  static fromRoom(room: RoomSnapshot, previous?: OnlineGame | null): OnlineGame {
    const game = room.game;
    if (game.revision !== game.actions.length) throw new Error('Invalid server revision');
    const reusable = previous?.room.game.id === game.id && previous.room.game.actions.length <= game.actions.length
      && previous.room.game.actions.every((action, index) => JSON.stringify(action) === JSON.stringify(game.actions[index]));
    const history: ViewCheckpoint[] = reusable ? [...previous.history] : [{ state: game.root, events: [] }];
    for (let index = history.length - 1; index < game.actions.length; index += 1) {
      const action = game.actions[index];
      const transition = applyResolvedCommand(history[index].state, action.command, action.roll?.face, action.actor);
      history.push({ state: transition.state, events: action.events });
    }
    // Current authority is the server; a corrupt/incompatible journal must not
    // silently invent a different board while replaying history locally.
    if (JSON.stringify(history.at(-1)!.state) !== JSON.stringify(game.state)) throw new Error('Inconsistent server history');
    return new OnlineGame(room, history, game.revision);
  }

  at(cursor: number): OnlineGame {
    return new OnlineGame(this.room, this.history, Math.max(0, Math.min(cursor, this.room.game.revision)));
  }

  get current(): ViewCheckpoint { return this.history[this.record.cursor]; }
  get state() { return this.current.state; }
  get events(): readonly GameEvent[] { return this.eventsAt(this.record.cursor); }
  eventsAt(cursor: number): readonly GameEvent[] {
    return this.history.slice(1, Math.min(this.record.cursor, cursor) + 1).flatMap(point => point.events);
  }
  legal(): readonly Command[] { return this.room.status === 'playing' ? legalCommands(this.state) : []; }
  review(cursor: number): ViewCheckpoint { return this.history[Math.max(0, Math.min(cursor, this.record.cursor))]; }
}

export function exportOnlineGame(game: OnlineGame): string {
  const snapshot: OnlineGameSnapshot = { ...game.room.game };
  return JSON.stringify({ version: ONLINE_SAVE_VERSION, protocol: ONLINE_PROTOCOL,
    kind: 'online-public-replay', roomId: game.room.id,
    players: { white: game.room.players.white?.name, black: game.room.players.black?.name }, game: snapshot }, null, 2);
}
