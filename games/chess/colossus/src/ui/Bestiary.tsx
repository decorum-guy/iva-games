import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BOSSES, BOSS_CARD_LIST, DIFFICULTIES, HUNT_BOSSES } from '../core';
import type { Difficulty, HuntBossId, Language } from '../core';
import { Card } from './Card';
import { copy } from './i18n';
import { Modal } from './Modal';
import { BossIcon } from './PieceIcon';
import { bossWinDifficulties } from './records';
import type { ResultRecord } from './records';
import './bestiary.css';

export interface BestiaryProps {
  language: Language;
  difficulty: Difficulty;
  records: readonly ResultRecord[];
  initialBoss: HuntBossId;
  onClose: () => void;
  reducedMotion?: boolean;
}

type Direction = -1 | 1;
type Selection = { index: number; previous: number | null; direction: Direction; revision: number };

function Portrait({ boss, language, titleId }: { boss: HuntBossId; language: Language; titleId?: string }) {
  return <>
    <div className="bestiary-effigy"><BossIcon id={boss}/></div>
    <h3 id={titleId} className="bestiary-boss-name">{BOSSES[boss].name[language]}</h3>
  </>;
}

/** The roster is shared with the hunt menu; tutorial guardians never enter this browser. */
export function Bestiary({ language, difficulty, records, initialBoss, onClose, reducedMotion = false }: BestiaryProps) {
  const c = copy[language];
  const [selection, setSelection] = useState<Selection>(() => ({
    index: Math.max(0, HUNT_BOSSES.indexOf(initialBoss)), previous: null, direction: 1, revision: 0,
  }));
  const browserRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const bossId = HUNT_BOSSES[selection.index];
  const boss = BOSSES[bossId];
  const level = DIFFICULTIES[difficulty];
  const wins = bossWinDifficulties(records, bossId);
  const cards = BOSS_CARD_LIST.filter(card => card.boss === bossId);
  const previousLabel = language === 'ru' ? 'Предыдущий босс' : 'Previous boss';
  const nextLabel = language === 'ru' ? 'Следующий босс' : 'Next boss';
  const position = language === 'ru'
    ? `${selection.index + 1} из ${HUNT_BOSSES.length}`
    : `${selection.index + 1} of ${HUNT_BOSSES.length}`;

  const navigate = useCallback((direction: Direction) => {
    if (HUNT_BOSSES.length < 2) return;
    setSelection(current => ({
      index: (current.index + direction + HUNT_BOSSES.length) % HUNT_BOSSES.length,
      previous: current.index,
      direction,
      revision: current.revision + 1,
    }));
  }, []);

  useLayoutEffect(() => {
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  }, [selection.index]);

  useEffect(() => {
    // Include the Modal's close button while keeping arrow shortcuts inside this dialog.
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      const dialog = browserRef.current?.closest('[role="dialog"]');
      if (!(target instanceof Element) || !dialog?.contains(target)) return;
      if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"]')) return;
      event.preventDefault();
      const direction: Direction = event.key === 'ArrowRight' ? 1 : -1;
      // A card from the previous boss is about to unmount: keep keyboard focus in the dialog.
      if (detailsRef.current?.contains(target)) (direction === 1 ? nextRef : previousRef).current?.focus();
      navigate(direction);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [navigate]);

  return <Modal title={c.bestiary} onClose={onClose} className="bestiary-dialog">
    <div ref={browserRef} className="bestiary-browser" data-testid="bestiary-browser" data-boss={bossId}
      data-direction={selection.direction === 1 ? 'next' : 'previous'} data-reduced-motion={reducedMotion}>
      <div className="bestiary-selector" data-testid="bestiary-selector" role="group" aria-label={c.boss}>
        <button ref={previousRef} type="button" className="bestiary-arrow" data-testid="bestiary-previous"
          aria-label={previousLabel} aria-controls={`${id}-details`} disabled={HUNT_BOSSES.length < 2} onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.5 5-7 7 7 7"/></svg>
        </button>
        <div className="bestiary-stage">
          <div className="bestiary-portrait-window">
            {selection.previous !== null && <div key={`out-${selection.revision}`} className="bestiary-portrait bestiary-portrait-out" aria-hidden="true">
              <Portrait boss={HUNT_BOSSES[selection.previous]} language={language}/>
            </div>}
            <div key={`in-${selection.revision}`} className={`bestiary-portrait${selection.revision ? ' bestiary-portrait-in' : ''}`}>
              <Portrait boss={bossId} language={language} titleId={`${id}-boss`}/>
            </div>
          </div>
          <span className="bestiary-position" data-testid="bestiary-position" aria-hidden="true">{selection.index + 1}<span>/</span>{HUNT_BOSSES.length}</span>
        </div>
        <button ref={nextRef} type="button" className="bestiary-arrow" data-testid="bestiary-next"
          aria-label={nextLabel} aria-controls={`${id}-details`} disabled={HUNT_BOSSES.length < 2} onClick={() => navigate(1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 5 7 7-7 7"/></svg>
        </button>
      </div>
      <span className="bestiary-announcement" role="status" aria-live="polite" aria-atomic="true">{boss.name[language]}, {position}</span>
      <div ref={detailsRef} id={`${id}-details`} className="bestiary-details" data-testid="bestiary-details"
        role="region" aria-labelledby={`${id}-boss`} tabIndex={0} onKeyDown={event => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          event.currentTarget.scrollTop = event.key === 'Home' ? 0 : event.currentTarget.scrollHeight;
        }}>
        <div key={selection.revision} className={`bestiary-detail-content${selection.revision ? ' bestiary-detail-in' : ''}`}>
          <p className="bestiary-description">{boss.description[language]}</p>
          <dl className="bestiary-stats">
            <div><dt>{c.difficulty}</dt><dd>{level.name[language]}</dd></div>
            <div><dt>{language === 'ru' ? 'Размер' : 'Size'}</dt><dd>{boss.width} × {boss.height}</dd></div>
            <div><dt>{c.armour}</dt><dd>{Math.ceil(boss.armor * level.numerator / level.denominator)}</dd></div>
            <div><dt>{c.health}</dt><dd>{Math.ceil(boss.hp * level.numerator / level.denominator)} <small>HP</small></dd></div>
          </dl>
          <section className="bestiary-victories" aria-labelledby={`${id}-victories`}>
            <h3 id={`${id}-victories`}>{c.defeatedOn}</h3>
            <ul className="bestiary-achievements">{Object.entries(DIFFICULTIES).map(([key, value]) => {
              const won = wins.has(key as Difficulty);
              return <li key={key} className={won ? 'earned' : ''}>
                <span className="bestiary-medal" aria-hidden="true">{won ? '✦' : '◇'}</span>
                <span>{value.name[language]}<span className="bestiary-announcement">: {won ? c.earned : c.notDefeated}</span></span>
              </li>;
            })}</ul>
          </section>
          {cards.length > 0 && <section className="bestiary-card-section" aria-labelledby={`${id}-cards`}>
            <h3 id={`${id}-cards`}>{c.bossCards}</h3>
            <p>{c.bossCardRule}</p>
            <div className="bestiary-cards">{cards.map(card => <Card key={card.id} card={card} lang={language}/>)}</div>
          </section>}
        </div>
      </div>
    </div>
  </Modal>;
}
