import { useId, type CSSProperties, type ReactNode } from 'react';
import type { BossId, UnitType } from '../core/types';

export const pieceSymbols: Record<UnitType, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };

const figures: Record<UnitType, ReactNode> = {
  P: <><path d="M28 56 34 34h12l6 22-4 5H32Z"/><circle cx="40" cy="24" r="12"/><path d="M29 37h22v5H29Z" className="icon-brass"/><path d="m40 19 4 5-4 5-4-5Z" className="icon-gem"/><path d="m35 45-3 11M44 46l3 10" className="icon-engraving"/></>,
  R: <><path d="M26 59 29 30h22l3 29ZM24 15h9v8h5v-8h5v8h5v-8h9v20H24Z"/><path d="M26 33h28v5H26Z" className="icon-brass"/><path d="M36 57V45a4 4 0 0 1 8 0v12Z" className="icon-recess"/><path d="M31 42v11M49 42v11" className="icon-engraving"/></>,
  B: <><path d="m27 59 8-20c-15-12-6-24 7-35 7 10 19 25 4 35l7 20Z"/><path d="m40 14-4 13 7 4-7 9" className="icon-mitre"/><path d="M28 43h24v5H28Z" className="icon-brass"/><path d="m40 51 4 4-4 5-4-5Z" className="icon-gem"/></>,
  N: <><path d="M25 61 28 49 18 40l10-24 7 5 7-13 4 13 15 16-6 12-15-8 9 20Z"/><path d="m25 38 9-19 5 8-7 17 5 10" className="icon-mane"/><path d="m33 45 15 5M43 29l12 10" className="icon-engraving"/><circle cx="46" cy="32" r="2.6" className="icon-gem"/><path d="m49 44 8-2" className="icon-engraving"/></>,
  Q: <><path d="m26 60 5-23-10-17 14 8 5-17 5 17 14-8-10 17 5 23Z"/><path d="M27 36h26v6H27Z" className="icon-brass"/><path d="m40 45 5 6-5 6-5-6Z" className="icon-gem"/><circle cx="20" cy="17" r="3" className="icon-brass"/><circle cx="40" cy="9" r="3" className="icon-brass"/><circle cx="60" cy="17" r="3" className="icon-brass"/></>,
  K: <><path d="m26 60 6-20h16l6 20ZM31 39l-5-9h28l-5 9ZM36 27V17h-9v-7h9V3h8v7h9v7h-9v10Z"/><path d="M29 37h22v6H29Z" className="icon-brass"/><path d="m40 47 6 3v7l-6 4-6-4v-7Z" className="icon-brass"/><path d="M40 49v8m-3-5h6" className="icon-ward"/></>,
};

/** Original engraved expedition set, shared by board, roster and promotion picker. */
export function PieceIcon({ kind, className = '' }: { kind: UnitType; className?: string }) {
  const id = useId().replace(/:/g, '');
  return <svg className={`piece-icon ${className}`} viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-ivory`} x1="0" y1="0" x2="1" y2=".8">
        <stop stopColor="var(--piece-highlight, #fff4d7)"/><stop offset=".48" stopColor="currentColor"/><stop offset="1" stopColor="var(--piece-shadow, #a8a18b)"/>
      </linearGradient>
      <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e2c887"/><stop offset="1" stopColor="#8b7046"/></linearGradient>
    </defs>
    <g fill={`url(#${id}-ivory)`} stroke="var(--piece-outline, #494b40)" strokeWidth="1.55" strokeLinejoin="round" strokeLinecap="round" style={{ '--icon-brass': `url(#${id}-brass)` } as CSSProperties}>
      <path d="M25 58h30l3 8H22Z"/><path d="M20 66h40l4 8H16Z"/>
      {figures[kind]}
      <path d="M23 66h34M22 70h36" className="icon-engraving"/>
    </g>
  </svg>;
}

/** Add a boss's engraving here; both board renderers read its footprint from BOSSES. */
const bossGlyphs: Record<BossId, ReactNode> = {
  regent: <>
    <path d="M12 63h18v24H9ZM70 63h18l3 24H70ZM24 79h15v16H21ZM61 79h15l3 16H61Z" className="boss-recess"/>
    <path d="m17 43 11-12 11 9-5 39-17-5ZM83 43 72 31 61 40l5 39 17-5Z"/>
    <path d="m22 37 15-19h26l15 19-5 37-23 13-23-13Z"/>
    <path d="M37 18 32 7l13 7 5-10 5 10 13-7-5 11M25 42l25 14 25-14M50 57v27" className="boss-inlay"/>
    <path d="m30 39 20-9 20 9-20 12Z" className="boss-facet"/>
    <path d="M36 37h28v10H36Z" className="boss-recess"/><path d="M39 41h8m6 0h8" className="boss-eye"/>
    <path d="m50 61 6 7-6 8-6-8Z" className="boss-core"/><path d="M20 53v12M80 53v12M32 80l6-8M68 80l-6-8" className="boss-inlay"/>
  </>,
  spire: <>
    <path d="m25 88 15-23-5-25 15-27 15 27-5 25 15 23Z"/>
    <path d="M45 65 31 50 17 8l5 48 17 21ZM55 65 69 50 83 8l-5 48-17 21Z" className="boss-blade"/>
    <path d="m50 12-7 32 7 13 7-13Z" className="boss-facet"/><path d="m41 40 9 5 9-5M43 64l7 14 7-14" className="boss-inlay"/>
    <path d="M44 47h12" className="boss-eye"/><path d="m50 55 5 7-5 7-5-7Z" className="boss-core"/>
    <path d="M24 88h52l5 7H19Z" className="boss-recess"/><path d="M30 89h40" className="boss-inlay"/>
  </>,
  archivist: <>
    <path d="M43 20h14v69H43Z" className="boss-recess"/><path d="m46 28-26-10-6 55 32 18ZM54 28l26-10 6 55-32 18Z"/>
    <path d="m39 25-23-9-5 54 28 15ZM61 25l23-9 5 54-28 15Z" className="boss-facet"/>
    <path d="m19 29 15 6m-16 7 15 6m-16 8 15 5m-15 8 15 5M81 29l-15 6m16 7-15 6m16 8-15 5m15 8-15 5" className="boss-inlay"/>
    <path d="M47 29v56M53 29v56" className="boss-inlay"/>
    <path d="M50 4c-1 10-10 12-10 19a10 10 0 0 0 20 0c0-6-5-8-5-13-1 7-4 8-5 10 1-5 2-9 0-16Z" className="boss-core"/>
    <path d="M33 88h34l6 7H27Z" className="boss-recess"/><path d="M38 91h24" className="boss-inlay"/>
  </>,
  sentinel: <>
    <path d="M37 74h10v17H32ZM53 74h10l5 17H53Z" className="boss-recess"/>
    <path d="M32 32h36l-4 42-14 9-14-9Z" className="boss-wood"/>
    <path d="M24 39h11v29H23ZM65 39h11l1 29H65Z" className="boss-facet"/>
    <path d="M31 24a19 19 0 0 1 38 0v15H31Z" className="boss-wood"/>
    <path d="M30 25h40v7H30ZM34 49h32v6H34ZM37 73h26M40 36l-1 11m10 10v18m10-17 2 13" className="boss-inlay"/>
    <circle cx="50" cy="25" r="10" className="boss-recess"/><circle cx="50" cy="25" r="5" className="boss-teaching-core"/>
    <path d="m50 58 8 4v8l-8 6-8-6v-8Z" className="boss-teaching-core"/>
    <path d="M36 9 32 3m32 6 4-6M24 45l-9 7v15l9 7 9-7V52Z" className="boss-inlay"/>
  </>,
};

export function BossIcon({ id, className = '', stretch = false }: { id: BossId; className?: string; stretch?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return <svg className={`boss-icon ${className}`} viewBox="0 0 100 100" preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'} aria-hidden="true" focusable="false" data-boss={id}>
    <defs>
      <linearGradient id={`${uid}-boss-stone`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#8d9d99"/><stop offset=".45" stopColor="currentColor"/><stop offset="1" stopColor="#243c43"/></linearGradient>
      <linearGradient id={`${uid}-boss-metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f4d393"/><stop offset="1" stopColor="#8c6f45"/></linearGradient>
      <linearGradient id={`${uid}-boss-wood`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#bdb08a"/><stop offset="1" stopColor="#7d7559"/></linearGradient>
    </defs>
    <g fill={`url(#${uid}-boss-stone)`} stroke="#23343a" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" style={{ '--boss-brass': `url(#${uid}-boss-metal)`, '--boss-wood': `url(#${uid}-boss-wood)` } as CSSProperties}>
      {bossGlyphs[id]}
    </g>
  </svg>;
}
