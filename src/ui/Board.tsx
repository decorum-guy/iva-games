import { Component, lazy, Suspense, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { cyclesRemaining, fileOf, rankOf, squareAt } from '../core';
import type { GameEvent, GameState, Piece, Square } from '../core';
import type { Translate } from '../i18n/catalog';
import type { SceneFocus, SceneMark } from '../scene/types';
import { PieceIcon, StateMark } from './pieces';

const BoardScene = lazy(() => import('../scene/BoardScene'));

class SceneLoaderBoundary extends Component<{ onFailure: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export interface BoardProps {
  readonly t: Translate;
  readonly state: GameState;
  readonly marks: readonly SceneMark[];
  readonly events: readonly GameEvent[];
  readonly flipped: boolean;
  readonly flat: boolean;
  readonly reducedMotion: boolean;
  readonly camera: 'studio' | 'tactical' | 'top';
  readonly low: boolean;
  readonly motionKey: string;
  readonly onSquare: (square: Square) => void;
  readonly onDragSquare: (from: Square, to: Square) => void;
  readonly onFailure: () => void;
  readonly onClear: () => void;
  readonly canMove: boolean;
  readonly overlay?: ReactNode;
  readonly focus?: SceneFocus;
}

function ariaSquare(t: Translate, square: Square, piece?: Piece) {
  return piece ? t('game.cell', {
    square, side: t(`side.${piece.side}`), piece: t(`piece.${piece.type}`), state: t(`state.${piece.affliction}`),
  }) : square;
}

const keyboardMoves: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

export function Board(props: BoardProps) {
  const { t, state, marks, flipped, onSquare } = props;
  const [focus, setFocus] = useState('e2');
  const [showFocus, setShowFocus] = useState(false);
  const pointerFocus = useRef(false);
  const pieces = useMemo(() => new Map(state.pieces.map(piece => [piece.square, piece])), [state.pieces]);
  const scenePieces = useMemo(() => state.pieces.map(piece => ({
    id: piece.id, square: piece.square, side: piece.side, kind: piece.type, affliction: piece.affliction,
    countdown: cyclesRemaining(piece, state) ?? undefined,
    exposed: piece.shameArmedAt !== null, curePending: piece.cureArmedAt !== null,
  })), [state]);
  const activeMarks: readonly SceneMark[] = showFocus ? [...marks, { square: focus, kind: 'focus' }] : marks;

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    const movement = keyboardMoves[event.key];
    if (movement) {
      const sign = flipped ? -1 : 1;
      const square = squareAt(fileOf(focus) + sign * movement[0], rankOf(focus) + sign * movement[1]) ?? focus;
      setFocus(square);
      setShowFocus(true);
      event.preventDefault();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onSquare(focus);
      setShowFocus(true);
    } else if (event.key === 'Escape') {
      props.onClear();
    }
  }

  function hideFocus(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setShowFocus(false);
  }

  return <section className={`board-stage ${props.flat ? 'flat-stage' : 'marble-stage'}`}
    data-focus-square={props.focus?.square} data-focus-subject={props.focus?.subject}
    tabIndex={0} aria-label={t('game.board')} aria-describedby="board-keys" data-keyboard={showFocus}
    onPointerDownCapture={() => { pointerFocus.current = true; setShowFocus(false); }}
    onKeyDown={handleKey} onFocus={event => {
      setShowFocus(!pointerFocus.current && event.target.matches(':focus-visible'));
      pointerFocus.current = false;
    }} onBlur={event => { pointerFocus.current = false; hideFocus(event); }}>
    <span id="board-keys" className="sr-only">{t('game.keyboard')}</span>
    {showFocus && <output className="sr-only" aria-live="polite">{ariaSquare(t, focus, pieces.get(focus))}</output>}
    {props.flat ? <div className="flat-board" data-renderer="2d">
      {Array.from({ length: 64 }, (_, index) => {
        const column = index % 8;
        const row = index >> 3;
        const file = flipped ? 7 - column : column;
        const rank = flipped ? row : 7 - row;
        const square = squareAt(file, rank)!;
        const piece = pieces.get(square);
        const kinds = activeMarks.filter(mark => mark.square === square).map(mark => mark.kind);
        const target = kinds.includes('friendly') ? 'game.allowedFriendly'
          : kinds.includes('capture') ? 'game.allowedCapture' : kinds.includes('move') ? 'game.allowed' : null;
        const label = ariaSquare(t, square, piece);
        return <button key={square} type="button" tabIndex={-1} data-square={square}
          aria-label={target ? `${label}, ${t(target)}` : label}
          className={`cell ${(file + rank) % 2 === 0 ? 'dark' : 'light'} ${kinds.map(kind => `mark-${kind}`).join(' ')}`}
          data-teaching-focus={props.focus?.square === square ? props.focus.subject : undefined}
          draggable={props.canMove && piece?.side === state.side} onDragStart={event => event.dataTransfer.setData('text/plain', square)}
          onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            if (props.canMove) props.onDragSquare(event.dataTransfer.getData('text/plain'), square);
          }}
          onClick={() => { setFocus(square); onSquare(square); }}>
          {column === 0 && <span className="rank" aria-hidden="true">{rank + 1}</span>}
          {row === 7 && <span className="file" aria-hidden="true">{square[0]}</span>}
          {piece && <>
            <PieceIcon type={piece.type} side={piece.side} className={piece.affliction} />
            {piece.affliction !== 'neutral' && <span className="cell-state"><StateMark state={piece.affliction} />
              {piece.affliction === 'devastated' && cyclesRemaining(piece, state)}</span>}
          </>}
        </button>;
      })}
    </div> : <SceneLoaderBoundary onFailure={props.onFailure}><Suspense fallback={<div className="scene-loading" role="status">{t('settings.loadingScene')}</div>}>
      <BoardScene pieces={scenePieces} marks={activeMarks} events={props.events} flipped={flipped}
        camera={props.camera} quality={props.low ? 'low' : 'high'} reducedMotion={props.reducedMotion}
        motionKey={props.motionKey} loadingLabel={t('settings.loadingScene')} onFailure={props.onFailure}
        focus={props.focus}
        onSquare={square => { setFocus(square); onSquare(square); }} onDragSquare={props.canMove ? props.onDragSquare : undefined} />
    </Suspense></SceneLoaderBoundary>}
    {props.overlay}
  </section>;
}
