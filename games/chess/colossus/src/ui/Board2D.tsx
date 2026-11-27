import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { bossCells, squareName, BOSSES } from '../core';
import { PieceIcon, BossIcon } from './PieceIcon';
import { copy } from './i18n';
import { battleFeedback } from './battleFeedback';
import { nextBoardSquare, squareLabel } from './boardHelpers';
import type { BoardProps } from './boardHelpers';
import './board.css';

export type { BoardProps } from './boardHelpers';

export function Board2D(p: BoardProps) {
  const [focus, setFocus] = useState(4);
  const [size, setSize] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const previous = useRef(p.state);
  const feedback = useMemo(() => battleFeedback(previous.current, p.state), [p.state]);
  const lastPositions = useRef(new Map(p.state.units.map(u => [u.id, u.square ?? u.startSquare])));
  const body = bossCells(p.state.boss);
  const definition = BOSSES[p.state.boss.id];
  useEffect(() => {
    previous.current = p.state;
    p.state.units.forEach(u => { if (u.square !== null) lastPositions.current.set(u.id, u.square); });
  }, [p.state]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setSize(Math.max(0, Math.floor(Math.min(bounds.width - 34, bounds.height - 30))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bossStyle: CSSProperties = {
    left: `${(p.state.boss.anchor % 8) * 12.5}%`,
    top: `${(8 - Math.floor(p.state.boss.anchor / 8) - definition.height) * 12.5}%`,
    width: `${definition.width * 12.5}%`, height: `${definition.height * 12.5}%`,
  };
  return <div ref={host} className={`board-flat-wrap board-theme-${p.theme ?? 'ivory'} ${p.reducedMotion ? 'board-reduced' : ''} ${size > 0 && size < 280 ? 'board-compact' : ''}`} role="group" aria-label={copy[p.lang].board}>
    <div className="board-flat-frame" style={{ width: size || undefined, height: size || undefined, '--cell-size': `${size / 8}px` } as CSSProperties}>
      <div ref={grid} className="board-flat" role="grid" aria-label={copy[p.lang].board} aria-rowcount={8} aria-colcount={8} aria-disabled={!!p.disabled} data-testid="board-2d">
        {Array.from({ length: 8 }, (_, row) => <div role="row" aria-rowindex={row + 1} className="board-row" key={row}>
          {Array.from({ length: 8 }, (_, file) => {
            const sq = (7 - row) * 8 + file;
            const unit = p.state.units.find(u => u.square === sq);
            const target = p.targets.includes(sq), attack = p.attackTargets.includes(sq);
            const threat = p.preview?.threatenedCells.includes(sq), fire = p.state.fire.includes(sq);
            return <button type="button" role="gridcell" key={sq} data-square={squareName(sq)} aria-colindex={file + 1}
              aria-label={squareLabel(p, sq)} aria-selected={unit?.id === p.selected} tabIndex={focus === sq ? 0 : -1}
              className={['square', (7 - row + file) % 2 ? 'light' : 'dark', target ? 'legal' : '', attack ? 'attack-target' : '', threat ? 'threat' : '', fire ? 'burning' : '', unit?.id === p.selected ? 'unit-selected' : '', body.includes(sq) ? 'boss-square' : '', p.guideSquares?.includes(sq) ? 'guide-square' : ''].join(' ')}
              onFocus={() => setFocus(sq)} onClick={() => !p.disabled && p.onSquare(sq)}
              onKeyDown={event => {
                const next = nextBoardSquare(sq, event.key, event.ctrlKey || event.metaKey);
                if (next !== null) {
                  event.preventDefault(); setFocus(next);
                  grid.current?.querySelector<HTMLButtonElement>(`[data-square="${squareName(next)}"]`)?.focus();
                }
              }}>
              {(threat || fire) && <span className="threat-pattern" aria-hidden="true"/>}
              {fire && <span className="flat-fire" aria-hidden="true">♨</span>}
              {target && !unit && <span className="legal-dot" aria-hidden="true"/>}
              {attack && <span className="attack-mark" aria-hidden="true"/>}
            </button>;
          })}
        </div>)}
        <div className={`flat-boss-footprint ${p.state.intent.rest ? 'resting' : ''} ${p.state.boss.armor === 0 ? 'unarmoured' : ''} ${p.state.boss.hp <= 0 ? 'defeated' : ''}`} style={bossStyle} aria-hidden="true" data-boss={p.state.boss.id}>
          <span className="boss-ground-seal"/>
          <BossIcon id={p.state.boss.id} className="flat-boss" stretch/>
          {feedback && (feedback.bossDamage > 0 || feedback.bossArmor > 0) && <span key={p.state.revision} className={`flat-impact boss-impact ${feedback.bossArmorBroken ? 'armour-broken' : ''}`}>{feedback.bossDamage ? `−${feedback.bossDamage}` : `⬡ −${feedback.bossArmor}`}</span>}
        </div>
        <div className="flat-army-layer" aria-hidden="true">
          {p.state.units.map(unit => {
            const square = unit.square ?? lastPositions.current.get(unit.id) ?? unit.startSquare;
            const effect = feedback?.units[unit.id];
            return <div key={unit.id} className={`flat-piece-position ${unit.hp <= 0 ? 'fallen' : ''}`} style={{ left: `${square % 8 * 12.5}%`, top: `${(7 - Math.floor(square / 8)) * 12.5}%` }}>
              <span className={['flat-unit', unit.activated ? 'activated' : '', unit.invulnerable ? 'immune' : '', unit.shield ? 'shielded' : '', p.selected === unit.id ? 'selected' : ''].join(' ')}>
                <PieceIcon kind={unit.type}/>
                <span className="unit-health"><b>{unit.hp}</b>{unit.shield > 0 && <em>⬡{unit.shield}</em>}{unit.invulnerable > 0 && <em>◇{unit.invulnerable}</em>}<i style={{ '--health': `${Math.max(0, unit.hp / unit.maxHp) * 100}%` } as CSSProperties}/></span>
                {unit.activated && <span className="activated-dot">✓</span>}
                {unit.attackBonus > 0 && <span className="unit-boost">+{unit.attackBonus}</span>}
                {effect && (effect.damage > 0 || effect.absorbed > 0 || effect.promotion) && <span key={p.state.revision} className={`flat-impact ${effect.damage ? 'wound' : 'ward'} ${effect.promotion ? 'promotion' : ''}`}>{effect.promotion ? '✦' : effect.damage ? `−${effect.damage}` : `⬡ ${effect.absorbed}`}</span>}
              </span>
            </div>;
          })}
        </div>
      </div>
      <div className="flat-coordinates" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <span key={`file-${i}`} className="flat-file-label" style={{ left: `${(i + .5) * 12.5}%` }}>{String.fromCharCode(97 + i)}</span>)}
        {Array.from({ length: 8 }, (_, i) => <span key={`rank-${i}`} className="flat-rank-label" style={{ top: `${(i + .5) * 12.5}%` }}>{8 - i}</span>)}
      </div>
    </div>
  </div>;
}
