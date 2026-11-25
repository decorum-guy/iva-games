import { describe, expect, it } from 'vitest';
import { applyResolvedCommand, createPosition } from '../core';
import type { CaptureEvent, PieceInput } from '../core';
import { translator } from '../i18n/catalog';
import { describeEvent, materialBalance, trophies } from './projections';

const kings = [
  { side: 'white', type: 'king', square: 'h1' },
  { side: 'black', type: 'king', square: 'a8' },
] as const satisfies readonly PieceInput[];

const take = (events: readonly { type: string }[]) => events.find(event => event.type === 'capture') as CaptureEvent;

describe('player ledgers and material', () => {
  it('keeps mercy en passant in the enemy ledger with its real square and both rule details', () => {
    const root = createPosition({
      pieces: [...kings, { side: 'white', type: 'pawn', square: 'e5' },
        { side: 'black', type: 'pawn', square: 'd5', affliction: 'devastated' }],
      enPassant: { availableTo: 'white', target: 'd6', pawnId: 'b-d5' },
    });
    const transition = applyResolvedCommand(root, { type: 'move', from: 'e5', to: 'd6' });
    const capture = take(transition.events);
    expect(capture).toMatchObject({ kind: 'enPassant', mercy: true, landing: 'd6', victim: { square: 'd5' } });
    expect(trophies([capture], 'white')).toEqual([{ type: 'pawn', count: 1 }]);
    expect(trophies([capture], 'black')).toEqual([]);
    expect(describeEvent(translator('en'), capture)).toBe('Mercy en passant · d5');
    expect(materialBalance(transition.state) - materialBalance(root)).toBe(1);
  });

  it('uses live ownership for material and the victim snapshot for a converted, promoted capture', () => {
    const root = createPosition({
      pieces: [...kings, { side: 'white', type: 'pawn', square: 'd7' },
        { side: 'black', type: 'rook', square: 'e6', affliction: 'berserk' }],
    });
    const promoted = applyResolvedCommand(root, { type: 'move', from: 'd7', to: 'd8', promotion: 'queen' });
    expect(materialBalance(promoted.state) - materialBalance(root)).toBe(8);
    expect(promoted.events.some(event => event.type === 'capture')).toBe(false);
    // A legal prepared position with the same promoted piece now in the other army.
    const blackQueen = promoted.state.pieces.find(piece => piece.id === 'w-d7')!;
    const converted = createPosition({ pieces: [...kings, { side: 'white', type: 'rook', square: 'd4', affliction: 'berserk' },
      { ...blackQueen, side: 'black', square: 'd6' }] });
    const capture = take(applyResolvedCommand(converted, { type: 'move', from: 'd4', to: 'd6' }).events);
    expect(capture.victim).toMatchObject({ id: 'w-d7', side: 'black', type: 'queen' });
    expect(trophies([capture], 'white')).toEqual([{ type: 'queen', count: 1 }]);
  });

  it('counts friendly losses in material without adding a trophy', () => {
    const root = createPosition({ pieces: [...kings, { side: 'white', type: 'rook', square: 'g4', affliction: 'bloodlust' },
      { side: 'white', type: 'knight', square: 'g6' }] });
    const transition = applyResolvedCommand(root, { type: 'move', from: 'g4', to: 'g6' });
    const capture = take(transition.events);
    expect(capture.friendly).toBe(true);
    expect(trophies([capture], 'white')).toEqual([]);
    expect(materialBalance(transition.state) - materialBalance(root)).toBe(-3);
  });
});
